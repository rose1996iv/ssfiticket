import crypto from "crypto";
import { checkOrderAccessRateLimit, getClientIpFromHeaders } from "./rateLimit.ts";

export type AccessMode = "READ" | "WRITE" | "CONSUME_WRITE";

export type VerifyTokenResult = {
  authorized: boolean;
  code: string;
  access_mode?: AccessMode;
  token_id?: string;
  order_id?: string;
  order_number?: string;
  order_status?: string;
  expires_at?: string;
  write_consumed_at?: string | null;
  error?: string;
};

export type OrderAccessRole = "STAFF" | "SELLER" | "CUSTOMER";

export type OrderAccessResult = {
  authorized: boolean;
  role?: OrderAccessRole;
  code: string;
  error?: string;
  tokenId?: string;
  rawToken?: string;
  orderStatus?: string;
};

/**
 * 256-bit CSPRNG token generator (64-character lowercase hexadecimal string)
 */
export function generateOrderAccessToken(): string {
  return crypto.randomBytes(32).toString("hex").toLowerCase();
}

/**
 * SHA-256 token hashing
 */
export function hashOrderAccessToken(rawToken: string): string {
  const clean = (rawToken || "").trim().toLowerCase();
  return crypto.createHash("sha256").update(clean, "utf8").digest("hex");
}

/**
 * Validates hexadecimal format of 64-char token
 */
export function isValidAccessTokenFormat(token?: string | null): boolean {
  if (!token || typeof token !== "string") return false;
  const clean = token.trim();
  return clean.length === 64 && /^[0-9a-f]{64}$/i.test(clean);
}

/**
 * Constant-time hash comparison helper
 */
export function safeCompareHexDigests(hashA: string, hashB: string): boolean {
  if (typeof hashA !== "string" || typeof hashB !== "string") return false;
  if (hashA.length !== 64 || hashB.length !== 64) return false;
  try {
    const bufA = Buffer.from(hashA, "hex");
    const bufB = Buffer.from(hashB, "hex");
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Generates the order-scoped cookie name
 */
export function getOrderCookieName(orderId: string): string {
  return `ssfi_order_access_${orderId.toLowerCase()}`;
}

/**
 * Cookie options conforming to Phase 5 specification:
 * HttpOnly; Secure (in prod); SameSite=Lax; Path=/; Max-Age=7 days
 */
export function getOrderCookieOptions() {
  const isProd =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "production";

  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
  };
}

/**
 * Sets the order access cookie in the Next.js cookie store (Server Actions & Route Handlers)
 */
export async function setOrderAccessCookie(orderId: string, rawToken: string): Promise<void> {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const cookieName = getOrderCookieName(orderId);
  cookieStore.set(cookieName, rawToken.trim().toLowerCase(), getOrderCookieOptions());
}

/**
 * Retrieves the order access cookie from the Next.js cookie store
 */
export async function getOrderAccessCookie(orderId: string): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const cookieName = getOrderCookieName(orderId);
    const cookie = cookieStore.get(cookieName);
    return cookie?.value ? cookie.value.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Clears the order access cookie
 */
export async function clearOrderAccessCookie(orderId: string): Promise<void> {
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const cookieName = getOrderCookieName(orderId);
    cookieStore.delete(cookieName);
  } catch {
    // Non-fatal if cookies cannot be modified
  }
}

/**
 * Issues a new order access token, revoking prior active tokens for the order.
 * Uses atomic DB RPC `issue_customer_order_access_token` with fallback.
 */
export async function issueOrderAccessToken(
  orderId: string,
  options?: { expiresInDays?: number }
): Promise<{ tokenId: string; expiresAt: string; rawToken: string; orderNumber?: string }> {
  const rawToken = generateOrderAccessToken();
  const tokenHash = hashOrderAccessToken(rawToken);
  const days = options?.expiresInDays ?? 7;

  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const admin = createSupabaseAdminClient();

  // Try calling the atomic RPC
  const { data: rpcData, error: rpcError } = await admin.rpc(
    "issue_customer_order_access_token",
    {
      p_order_id: orderId,
      p_token_hash: tokenHash,
      p_expires_in_days: days,
    }
  );

  if (!rpcError && rpcData) {
    return {
      tokenId: rpcData.token_id,
      expiresAt: rpcData.expires_at,
      rawToken,
      orderNumber: rpcData.order_number,
    };
  }

  // Fallback for environments where the migration RPC has not yet been applied
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  // Revoke prior active tokens
  await admin
    .from("payment_recovery_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .is("revoked_at", null);

  const { data: inserted, error: insertError } = await admin
    .from("payment_recovery_tokens")
    .insert({
      order_id: orderId,
      token_hash: tokenHash,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw new Error(`Failed to issue order access token: ${insertError?.message || "Unknown error"}`);
  }

  return {
    tokenId: inserted.id,
    expiresAt,
    rawToken,
  };
}

/**
 * Verifies order payment access against database records.
 * Uses atomic RPC `verify_order_payment_access` with graceful fallback.
 */
export async function verifyOrderPaymentAccess(
  orderId: string,
  rawToken: string,
  mode: AccessMode = "READ"
): Promise<VerifyTokenResult> {
  if (!orderId || !isValidAccessTokenFormat(rawToken)) {
    return {
      authorized: false,
      code: "INVALID_PARAMETERS",
    };
  }

  const tokenHash = hashOrderAccessToken(rawToken);
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const admin = createSupabaseAdminClient();

  // 1. Try atomic DB RPC
  try {
    const { data: rpcData, error: rpcError } = await admin.rpc(
      "verify_order_payment_access",
      {
        p_order_id: orderId,
        p_token_hash: tokenHash,
        p_access_mode: mode,
      }
    );

    if (!rpcError && rpcData) {
      return rpcData as VerifyTokenResult;
    }
  } catch {
    // Proceed to direct query fallback
  }

  // 2. Direct database query fallback
  const { data: tokenRow } = await admin
    .from("payment_recovery_tokens")
    .select("id, order_id, expires_at, used_at, revoked_at")
    .eq("order_id", orderId)
    .eq("token_hash", tokenHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tokenRow) {
    return { authorized: false, code: "UNAUTHORIZED" };
  }

  if (tokenRow.revoked_at) {
    return { authorized: false, code: "TOKEN_REVOKED" };
  }

  if (new Date(tokenRow.expires_at) <= new Date()) {
    return { authorized: false, code: "TOKEN_EXPIRED" };
  }

  const { data: order } = await admin
    .from("orders")
    .select("status, order_number")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) {
    return { authorized: false, code: "ORDER_NOT_FOUND" };
  }

  if (["CANCELLED", "REFUNDED", "VOID"].includes(order.status)) {
    return {
      authorized: false,
      code: "ORDER_INACTIVE",
      order_status: order.status,
    };
  }

  if (mode === "READ") {
    return {
      authorized: true,
      code: "AUTHORIZED_READ",
      access_mode: "READ",
      token_id: tokenRow.id,
      order_id: tokenRow.order_id,
      order_number: order.order_number,
      order_status: order.status,
      expires_at: tokenRow.expires_at,
      write_consumed_at: tokenRow.used_at,
    };
  }

  // Mode WRITE or CONSUME_WRITE
  if (tokenRow.used_at) {
    return {
      authorized: false,
      code: "TOKEN_WRITE_ALREADY_CONSUMED",
      order_status: order.status,
      write_consumed_at: tokenRow.used_at,
    };
  }

  if (order.status !== "PENDING_PAYMENT") {
    return {
      authorized: false,
      code: "ORDER_NOT_EDITABLE",
      order_status: order.status,
    };
  }

  if (mode === "CONSUME_WRITE") {
    const consumedAt = new Date().toISOString();
    // REV-2C-05: Concurrency-safe atomic conditional consume (only succeeds if used_at IS NULL)
    const { data: consumedRow, error: consumeErr } = await admin
      .from("payment_recovery_tokens")
      .update({ used_at: consumedAt, updated_at: consumedAt })
      .eq("id", tokenRow.id)
      .is("used_at", null)
      .select("id")
      .maybeSingle();

    if (consumeErr || !consumedRow) {
      return {
        authorized: false,
        code: "TOKEN_WRITE_ALREADY_CONSUMED",
        order_status: order.status,
      };
    }

    return {
      authorized: true,
      code: "AUTHORIZED_WRITE_CONSUMED",
      access_mode: "CONSUME_WRITE",
      token_id: tokenRow.id,
      order_id: tokenRow.order_id,
      order_number: order.order_number,
      order_status: order.status,
      write_consumed_at: consumedAt,
    };
  }

  return {
    authorized: true,
    code: "AUTHORIZED_WRITE",
    access_mode: "WRITE",
    token_id: tokenRow.id,
    order_id: tokenRow.order_id,
    order_number: order.order_number,
    order_status: order.status,
  };
}

export interface VerifyOrderAccessDeps {
  getAuthenticatedUser: () => Promise<{ id: string } | null>;
  isProfileActive: (userId: string) => Promise<boolean>;
  isStaffUser: (userId: string) => Promise<boolean>;
  hasSellerRole: (userId: string) => Promise<boolean>;
  getActiveSellerByProfileId: (userId: string) => Promise<{ id: string; is_active: boolean } | null>;
  getOrderSellerId: (orderId: string) => Promise<string | null>;
  getOrderCookie: (orderId: string) => Promise<string | null>;
  verifyToken: (orderId: string, rawToken: string, mode: AccessMode) => Promise<VerifyTokenResult>;
}

/**
 * Comprehensive authorization validator checking Staff, Owning Seller,
 * and Customer Token access with rate-limiting.
 * Enforces active profile check (`profiles.is_active`), authoritative `has_role('SELLER')`,
 * canonical `sellers.profile_id`, and `sellers.is_active === true`.
 */
export async function verifyOrderAccess(
  orderId: string,
  mode: AccessMode = "READ",
  options?: {
    rawToken?: string | null;
    requestHeaders?: Headers | null;
    skipRateLimit?: boolean;
    deps?: Partial<VerifyOrderAccessDeps>;
  }
): Promise<OrderAccessResult> {
  if (!orderId) {
    return { authorized: false, code: "MISSING_ORDER_ID" };
  }

  const customDeps = options?.deps;

  // 1. Check logged-in user session (Staff or Seller)
  try {
    let user: { id: string } | null = null;
    let supabaseClient: Awaited<ReturnType<(typeof import("@/lib/supabase/server"))["createSupabaseServerClient"]>> | null = null;
    let adminClient: ReturnType<(typeof import("@/lib/supabase/admin"))["createSupabaseAdminClient"]> | null = null;

    if (customDeps?.getAuthenticatedUser) {
      user = await customDeps.getAuthenticatedUser();
    } else {
      const { createSupabaseServerClient } = await import("@/lib/supabase/server");
      supabaseClient = await createSupabaseServerClient();
      const { data } = await supabaseClient.auth.getUser();
      user = data.user ? { id: data.user.id } : null;
    }

    if (user) {
      const getAdmin = async () => {
        if (!adminClient) {
          const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
          adminClient = createSupabaseAdminClient();
        }
        return adminClient;
      };

      // REV-2C-05: Verify profiles.is_active === true for BOTH Staff and Seller
      const profileActive = customDeps?.isProfileActive
        ? await customDeps.isProfileActive(user.id)
        : await (async () => {
            const admin = await getAdmin();
            const { data } = await admin
              .from("profiles")
              .select("is_active")
              .eq("id", user.id)
              .maybeSingle();
            return data?.is_active === true;
          })();

      if (profileActive) {
        // Check Staff roles: SUPER_ADMIN, ADMIN, FUNDRAISING_MANAGER
        const isStaff = customDeps?.isStaffUser
          ? await customDeps.isStaffUser(user.id)
          : await (async () => {
              const admin = await getAdmin();
              const { data } = await admin.rpc("is_staff", { p_user_id: user.id });
              return data === true;
            })();

        if (isStaff === true) {
          return {
            authorized: true,
            role: "STAFF",
            code: "AUTHORIZED_STAFF",
          };
        }

        // REV-2C-05: Check authoritative SELLER role AND active canonical sellers.profile_id ownership
        const hasSellerRole = customDeps?.hasSellerRole
          ? await customDeps.hasSellerRole(user.id)
          : await (async () => {
              const admin = await getAdmin();
              const { data } = await admin.rpc("has_role", {
                p_user_id: user.id,
                p_role: "SELLER",
              });
              return data === true;
            })();

        if (hasSellerRole) {
          const sellerRow = customDeps?.getActiveSellerByProfileId
            ? await customDeps.getActiveSellerByProfileId(user.id)
            : await (async () => {
                const admin = await getAdmin();
                const { data } = await admin
                  .from("sellers")
                  .select("id, is_active")
                  .eq("profile_id", user.id)
                  .maybeSingle();
                return data ? { id: data.id, is_active: data.is_active === true } : null;
              })();

          if (sellerRow && sellerRow.is_active === true) {
            const orderSellerId = customDeps?.getOrderSellerId
              ? await customDeps.getOrderSellerId(orderId)
              : await (async () => {
                  const admin = await getAdmin();
                  const { data } = await admin
                    .from("orders")
                    .select("seller_id")
                    .eq("id", orderId)
                    .maybeSingle();
                  return data?.seller_id ?? null;
                })();

            if (orderSellerId && orderSellerId === sellerRow.id) {
              return {
                authorized: true,
                role: "SELLER",
                code: "AUTHORIZED_SELLER",
              };
            }
          }
        }
      }
    }
  } catch {
    // Non-fatal: Not an authenticated user or running in non-auth context
  }

  // 2. Customer Token Flow
  // Check token from option parameter or HttpOnly cookie
  const token =
    options?.rawToken ||
    (customDeps?.getOrderCookie
      ? await customDeps.getOrderCookie(orderId)
      : await getOrderAccessCookie(orderId));

  if (!token) {
    return {
      authorized: false,
      code: "UNAUTHORIZED_NO_TOKEN",
      error: "No access token provided for this order.",
    };
  }

  if (!isValidAccessTokenFormat(token)) {
    return {
      authorized: false,
      code: "INVALID_TOKEN_FORMAT",
      error: "The provided access token format is invalid.",
    };
  }

  // 3. Rate limiting check
  if (!options?.skipRateLimit) {
    const clientIp = getClientIpFromHeaders(options?.requestHeaders);
    const rateLimit = await checkOrderAccessRateLimit({
      orderId,
      clientIp,
    });

    if (!rateLimit.allowed) {
      return {
        authorized: false,
        code: "RATE_LIMITED",
        error: "Too many attempts for this order. Please try again later.",
      };
    }
  }

  // 4. Verify token against database
  const verification = customDeps?.verifyToken
    ? await customDeps.verifyToken(orderId, token, mode)
    : await verifyOrderPaymentAccess(orderId, token, mode);

  if (verification.authorized) {
    return {
      authorized: true,
      role: "CUSTOMER",
      code: verification.code,
      tokenId: verification.token_id,
      rawToken: token,
      orderStatus: verification.order_status,
    };
  }

  return {
    authorized: false,
    code: verification.code,
    error: verification.code,
    orderStatus: verification.order_status,
  };
}
