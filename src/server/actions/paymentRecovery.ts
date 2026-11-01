"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAnyRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveEnvironmentAppUrl } from "@/lib/config/appUrl";
import { manualUpiConfig } from "@/lib/config/payment";
import { emailSchema, whatsappSchema } from "@/lib/validation/contact";
import {
  buildPaymentRecoveryUrl,
  checkTokenRateLimit,
  generateSecureRecoveryToken,
  hashRecoveryToken,
  isValidTokenFormat,
} from "@/lib/payment/recoveryToken";

// Schema for generating recovery link
const generateLinkSchema = z.object({
  orderId: z.string().uuid("Invalid order ID."),
  expiresDays: z.coerce.number().int().min(1).max(30).default(7),
});

// Schema for revoking recovery link
const revokeLinkSchema = z.object({
  orderId: z.string().uuid("Invalid order ID."),
});

// Schema for payment details completion submission
const paymentCompletionSchema = z.object({
  orderId: z.string().uuid("Invalid order ID."),
  token: z.string().trim().optional(),
  utr: z
    .string()
    .trim()
    .transform((val) => val.replace(/\s+/g, "").toUpperCase())
    .pipe(
      z
        .string()
        .min(6, "UTR / Transaction Reference must be at least 6 characters.")
        .max(32, "UTR cannot exceed 32 characters.")
        .regex(/^[A-Z0-9-]+$/, "UTR must only contain alphanumeric characters or hyphens.")
    ),
  email: emailSchema,
  whatsapp: whatsappSchema,
  payerName: z
    .string()
    .trim()
    .min(2, "Payer name must be at least 2 characters.")
    .max(120, "Payer name cannot exceed 120 characters."),
});

export type GenerateRecoveryLinkResult = {
  success: boolean;
  error?: string;
  recoveryUrl?: string;
  expiresAt?: string;
  orderNumber?: string;
};

/**
 * Generates a high-entropy, cryptographically random payment recovery link for an order.
 * RBAC: Strictly restricted to SUPER_ADMIN and ADMIN.
 * Security: Stores ONLY the SHA-256 hash in the database, never the plaintext token.
 */
export async function generateOrderRecoveryLink(
  orderId: string,
  expiresDays = 7
): Promise<GenerateRecoveryLinkResult> {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const parsed = generateLinkSchema.safeParse({ orderId, expiresDays });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid parameters." };
  }

  // 1. Generate 32-byte cryptographically secure random token
  const rawToken = generateSecureRecoveryToken();
  const tokenHash = hashRecoveryToken(rawToken);

  const admin = createSupabaseAdminClient();

  // 2. Call secure atomic RPC to revoke previous tokens and store new SHA-256 hash
  const { data, error } = await admin.rpc("create_payment_recovery_link", {
    p_order_id: parsed.data.orderId,
    p_token_hash: tokenHash,
    p_actor_id: user.id,
    p_expires_days: parsed.data.expiresDays,
  });

  if (error || !data) {
    console.error("[Payment Recovery Diagnostic] RPC create_payment_recovery_link error:", error);
    return {
      success: false,
      error: error?.message ?? "Failed to generate recovery link.",
    };
  }

  const { baseUrl } = resolveEnvironmentAppUrl();
  const recoveryUrl = buildPaymentRecoveryUrl(baseUrl, rawToken);

  revalidatePath(`/admin/orders/${parsed.data.orderId}`);

  return {
    success: true,
    recoveryUrl,
    expiresAt: data.expires_at,
    orderNumber: data.order_number,
  };
}

/**
 * Revokes any active recovery link for an order.
 * RBAC: Strictly restricted to SUPER_ADMIN and ADMIN.
 */
export async function revokeOrderRecoveryLink(
  orderId: string
): Promise<{ success: boolean; error?: string }> {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const parsed = revokeLinkSchema.safeParse({ orderId });
  if (!parsed.success) {
    return { success: false, error: "Invalid order ID." };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("revoke_payment_recovery_link", {
    p_order_id: parsed.data.orderId,
    p_actor_id: user.id,
  });

  if (error) {
    console.error("[Payment Recovery Diagnostic] RPC revoke_payment_recovery_link error:", error);
    return { success: false, error: error.message };
  }

  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  return { success: true };
}

/**
 * Fetches the active recovery token status for display in Admin Order Details.
 * RBAC: Strictly restricted to SUPER_ADMIN and ADMIN.
 */
export async function getOrderRecoveryStatus(orderId: string) {
  await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("payment_recovery_tokens")
    .select("id, expires_at, revoked_at, used_at, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return { hasToken: false, active: false };
  }

  const now = new Date();
  const expiresAt = new Date(data.expires_at);
  const isRevoked = data.revoked_at !== null;
  const isExpired = expiresAt <= now;
  const isUsed = data.used_at !== null;
  const isActive = !isRevoked && !isExpired;

  return {
    hasToken: true,
    active: isActive,
    isRevoked,
    isExpired,
    isUsed,
    expiresAt: data.expires_at,
    createdAt: data.created_at,
  };
}

export type TokenLookupResult = {
  valid: boolean;
  status?: string;
  error?: string;
  orderId?: string;
  orderNumber?: string;
  quantity?: number;
  totalAmountPaise?: number;
  customerName?: string;
  customerPhone?: string;
  customerWhatsapp?: string;
  customerEmail?: string;
  sellerCode?: string;
  sellerDisplayName?: string;
  paymentStatus?: string;
  paymentUtr?: string;
  paymentPayerName?: string;
  paymentSubmittedAt?: string | null;
  tokenExpiresAt?: string;
};

/**
 * Validates and looks up details for a customer payment completion token.
 * Rate-limited to prevent token enumeration.
 */
export async function lookupRecoveryTokenDetails(rawToken: string): Promise<TokenLookupResult> {
  const trimmedToken = (rawToken || "").trim();

  // 1. Rate limiting check
  const rateLimit = checkTokenRateLimit(trimmedToken.slice(0, 16));
  if (!rateLimit.allowed) {
    return {
      valid: false,
      status: "RATE_LIMITED",
      error: `Too many attempts. Please try again in ${rateLimit.retryAfterSeconds} seconds.`,
    };
  }

  // 2. Format validation (64-char hexadecimal string)
  if (!isValidTokenFormat(trimmedToken)) {
    return {
      valid: false,
      status: "INVALID_FORMAT",
      error: "The payment completion link is invalid or malformed.",
    };
  }

  // 3. Compute SHA-256 hash for database lookup
  const tokenHash = hashRecoveryToken(trimmedToken);
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin.rpc("lookup_payment_recovery_token", {
    p_token_hash: tokenHash,
  });

  if (error || !data) {
    console.error("[Payment Recovery Diagnostic] RPC lookup_payment_recovery_token error:", error);
    return {
      valid: false,
      status: "LOOKUP_ERROR",
      error: "Unable to verify payment details link at this time.",
    };
  }

  if (!data.valid) {
    return {
      valid: false,
      status: data.status,
      error: data.error,
      orderNumber: data.order_number,
    };
  }

  return {
    valid: true,
    status: data.status,
    orderId: data.order_id,
    orderNumber: data.order_number,
    quantity: data.quantity,
    totalAmountPaise: data.total_amount_paise,
    customerName: data.customer_name,
    customerPhone: data.customer_phone,
    customerWhatsapp: data.customer_whatsapp,
    customerEmail: data.customer_email,
    sellerCode: data.seller_code,
    sellerDisplayName: data.seller_display_name,
    paymentStatus: data.payment_status,
    paymentUtr: data.payment_utr,
    paymentPayerName: data.payment_payer_name,
    paymentSubmittedAt: data.payment_submitted_at,
    tokenExpiresAt: data.token_expires_at,
  };
}

export type SubmitPaymentCompletionResult = {
  success: boolean;
  error?: string;
  orderNumber?: string;
  reopened?: boolean;
};

/**
 * Submits mandatory UTR, Email and WhatsApp details for an order.
 * Atomic, idempotent server-side operation.
 * Updates customer record and transitions payment/order to awaiting-admin-verification (SUBMITTED).
 * Never marks payment as VERIFIED or issues tickets!
 */
export async function submitPaymentCompletion(
  formData: FormData
): Promise<SubmitPaymentCompletionResult> {
  const rawToken = formData.get("token") ? String(formData.get("token")).trim() : undefined;
  const rawOrderId = formData.get("orderId");
  const rawUtr = formData.get("utr");
  const rawEmail = formData.get("email");
  const rawWhatsapp = formData.get("whatsapp");
  const rawPayerName = formData.get("payerName");

  const parsed = paymentCompletionSchema.safeParse({
    orderId: typeof rawOrderId === "string" ? rawOrderId : undefined,
    token: rawToken,
    utr: typeof rawUtr === "string" ? rawUtr : undefined,
    email: typeof rawEmail === "string" ? rawEmail : undefined,
    whatsapp: typeof rawWhatsapp === "string" ? rawWhatsapp : undefined,
    payerName: typeof rawPayerName === "string" ? rawPayerName : undefined,
  });

  if (!parsed.success) {
    const firstError = parsed.error.issues?.[0]?.message ?? "Please provide all required fields.";
    return { success: false, error: firstError };
  }

  const { orderId, token, utr, email, whatsapp, payerName } = parsed.data;

  // Rate limit check if token provided
  if (token) {
    const rateLimit = checkTokenRateLimit(token.slice(0, 16));
    if (!rateLimit.allowed) {
      return {
        success: false,
        error: `Too many submission attempts. Please try again in ${rateLimit.retryAfterSeconds} seconds.`,
      };
    }
  }

  // Mock mode guard in Preview / Development
  const isProd =
    process.env.VERCEL_ENV === "production" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "production";
  if (manualUpiConfig.isMock && !isProd) {
    const trimmed = utr.trim();
    if (trimmed.toUpperCase().includes("FAIL")) {
      return {
        success: false,
        error: "Simulated Mock Payment Failure: Test reference was rejected by test validation rules.",
      };
    }
    const isTestRef = /^(TEST|MOCK)[A-Za-z0-9-]*$/i.test(trimmed);
    if (!isTestRef) {
      return {
        success: false,
        error:
          "Preview mock payment mode is active. Please enter a recognized test reference starting with TEST or MOCK (e.g. TEST12345678).",
      };
    }
  }

  const tokenHash = token && isValidTokenFormat(token) ? hashRecoveryToken(token) : null;
  const admin = createSupabaseAdminClient();

  // Call atomic RPC
  const { data, error } = await admin.rpc("submit_payment_details_completion", {
    p_order_id: orderId,
    p_utr: utr,
    p_email: email,
    p_whatsapp: whatsapp,
    p_payer_name: payerName,
    p_token_hash: tokenHash,
  });

  if (error || !data) {
    console.error("[Payment Completion Diagnostic] RPC submit_payment_details_completion failed:", error);
    const msg = error?.message || "Failed to submit payment details.";
    if (
      msg.includes("already been submitted") ||
      msg.includes("payments_manual_upi_utr_unique") ||
      error?.code === "23505"
    ) {
      return {
        success: false,
        error:
          "This Transaction ID / UTR has already been submitted for another order. Please check your payment receipt and enter your unique reference.",
      };
    }
    return { success: false, error: msg };
  }

  // Revalidate public and admin pages
  revalidatePath(`/buy/order/${orderId}`);
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath(`/admin/payments`);

  return {
    success: true,
    orderNumber: data.order_number,
    reopened: data.reopened,
  };
}
