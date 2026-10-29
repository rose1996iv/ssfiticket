"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAnyRole, requireAuth, requireRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatIstDateTime } from "@/lib/date/timezone";
import { dispatchOrderTicketDeliveries } from "@/lib/delivery/service";
import { manualUpiConfig } from "@/lib/config/payment";

const saleSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters.").max(120),
  whatsapp: z.string().trim().regex(/^[0-9+ -]{7,20}$/, "Enter a valid phone/WhatsApp number."),
  email: z.string().trim().email("Enter a valid email address.").optional().or(z.literal("")),
  quantity: z.coerce.number().int().min(1, "Minimum 1 ticket.").max(1000, "Maximum 1,000 tickets per seller order."),
});

const utrSchema = z.object({
  orderId: z.string().uuid("Invalid order ID."),
  utr: z
    .string()
    .trim()
    .min(6, "UTR / Reference must be at least 6 characters.")
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/, "UTR must only contain alphanumeric characters or hyphens."),
  payerName: z.string().trim().max(120).optional(),
});

async function currentSellerId() {
  const user = await requireRole("SELLER");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("sellers")
    .select("id, is_active")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[Seller Operations Diagnostic] Seller profile lookup failed:", {
      code: error.code,
      message: error.message,
    });
    throw new Error("Unable to verify seller profile at this time.");
  }

  if (!data) {
    throw new Error("Your seller account is unavailable.");
  }

  if (!data.is_active) {
    throw new Error("Your seller account is currently inactive.");
  }

  return data.id as string;
}

export async function createSale(formData: FormData) {
  const parsed = saleSchema.safeParse({
    name: formData.get("name"),
    whatsapp: formData.get("whatsapp"),
    email: formData.get("email"),
    quantity: formData.get("quantity"),
  });

  if (!parsed.success) {
    const firstError = parsed.error.issues?.[0]?.message ?? parsed.error.message ?? "Please enter valid customer information and quantity.";
    throw new Error(firstError);
  }

  const sellerId = await currentSellerId();
  const admin = createSupabaseAdminClient();

  // 1. Strict Server-Side Campaign State Verification
  // Execute scheduled transition check to auto-activate DRAFT or auto-close overdue ACTIVE campaigns
  try {
    await admin.rpc("process_scheduled_campaign_transitions");
  } catch (rpcErr) {
    console.warn("[Seller Order Diagnostic] Pre-flight schedule transition warning:", rpcErr);
  }

  const { data: campaign, error: campaignErr } = await admin
    .from("campaigns")
    .select("id, status, total_ticket_limit, sold_ticket_count, start_at, end_at")
    .eq("public_id", "ssfi-fundraising-lucky-draw")
    .maybeSingle();

  if (campaignErr) {
    console.error("[Seller Order Diagnostic] Campaign lookup failed:", {
      code: campaignErr.code,
      message: campaignErr.message,
    });
    throw new Error("Unable to verify fundraising campaign status. Please try again later.");
  }

  if (!campaign) {
    console.error("[Seller Order Diagnostic] Campaign 'ssfi-fundraising-lucky-draw' not found in database.");
    throw new Error("Fundraising campaign configuration was not found.");
  }

  if (campaign.status !== "ACTIVE") {
    console.warn(`[Seller Order Diagnostic] Sale rejected: Campaign status is '${campaign.status}' (must be 'ACTIVE').`);
    if (campaign.status === "PAUSED") {
      throw new Error("Ticket sales are temporarily paused. Please check back shortly.");
    }
    if (campaign.status === "DRAFT") {
      throw new Error("Ticket sales have not officially opened yet. This campaign is currently in preview.");
    }
    if (campaign.status === "CLOSED" || campaign.status === "ARCHIVED" || campaign.status === "CANCELLED") {
      throw new Error("Ticket sales for this lucky draw have ended.");
    }
    throw new Error(`Ticket sales are currently not active (campaign status: ${campaign.status}).`);
  }

  // Schedule Window Check for ACTIVE campaigns
  const now = new Date();
  if (campaign.start_at && now < new Date(campaign.start_at)) {
    const opensAt = formatIstDateTime(campaign.start_at);
    console.warn(`[Seller Order Diagnostic] Order rejected: Sales have not opened yet (opens on ${opensAt}).`);
    throw new Error(`Ticket sales have not opened yet. Sales are scheduled to open on ${opensAt}.`);
  }

  if (campaign.end_at && now >= new Date(campaign.end_at)) {
    const closedAt = formatIstDateTime(campaign.end_at);
    console.warn(`[Seller Order Diagnostic] Order rejected: Sales ended on ${closedAt}.`);
    throw new Error(`Ticket sales for this lucky draw have ended (closed on ${closedAt}).`);
  }

  const remaining = Math.max(0, campaign.total_ticket_limit - campaign.sold_ticket_count);
  if (parsed.data.quantity > remaining) {
    throw new Error(`Sorry, the requested quantity (${parsed.data.quantity}) exceeds remaining campaign capacity (${remaining} tickets available).`);
  }

  // 2. Call RPC create_seller_order
  const { data, error } = await admin.rpc("create_seller_order", {
    p_seller_id: sellerId,
    p_name: parsed.data.name,
    p_whatsapp: parsed.data.whatsapp,
    p_email: parsed.data.email || "",
    p_quantity: parsed.data.quantity,
  });

  if (error || !data) {
    console.error("[Seller Order Diagnostic] RPC create_seller_order failed:", {
      code: error?.code,
      message: error?.message,
      hint: error?.hint,
    });

    const errorMsg = error?.message ?? "Failed to create sale.";
    if (errorMsg.includes("capacity")) {
      throw new Error("Sorry, the requested quantity exceeds remaining campaign ticket capacity.");
    }
    if (errorMsg.includes("have not opened yet")) {
      throw new Error("Ticket sales have not opened yet for this campaign.");
    }
    if (errorMsg.includes("have ended")) {
      throw new Error("Ticket sales for this lucky draw have ended.");
    }
    if (errorMsg.includes("active campaign not found")) {
      throw new Error("Ticket sales are currently not active for this campaign.");
    }
    if (errorMsg.includes("seller is inactive")) {
      throw new Error("Your seller account is currently inactive.");
    }
    if (error?.code === "42501" || errorMsg.includes("permission denied")) {
      throw new Error("Order creation failed due to database authorization restrictions.");
    }
    throw new Error("Unable to create this sale. Please try again.");
  }

  redirect(`/seller/orders/${data}/payment`);
}

export async function submitManualUpi(formData: FormData): Promise<{
  success: boolean;
  error?: string;
  redirectUrl?: string;
}> {
  const parsed = utrSchema.safeParse({
    orderId: formData.get("orderId"),
    utr: formData.get("utr"),
    payerName: formData.get("payerName"),
  });

  if (!parsed.success) {
    const firstError = parsed.error.issues?.[0]?.message ?? parsed.error.message ?? "Enter a valid UTR/reference.";
    return { success: false, error: firstError };
  }

  // Preview / Development mock mode validation
  if (manualUpiConfig.isMock) {
    const trimmed = parsed.data.utr.trim();
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

  const sellerId = await currentSellerId();
  const admin = createSupabaseAdminClient();

  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("id, status")
    .eq("id", parsed.data.orderId)
    .eq("seller_id", sellerId)
    .maybeSingle();

  if (orderErr || !order) {
    return { success: false, error: "This order does not belong to your seller account." };
  }

  if (order.status !== "PENDING_PAYMENT") {
    if (order.status === "PAYMENT_SUBMITTED") {
      return {
        success: false,
        error: "A payment reference has already been submitted for this order and is currently under review.",
      };
    }
    return { success: false, error: "This order is not eligible for payment submission." };
  }

  const { error } = await admin.rpc("submit_manual_upi", {
    p_order_id: parsed.data.orderId,
    p_utr: parsed.data.utr.trim(),
    p_payer_name: parsed.data.payerName?.trim() || "",
  });

  if (error) {
    console.error("[Seller Order Diagnostic] RPC submit_manual_upi failed:", {
      code: error.code,
      message: error.message,
    });
    if (
      error.message.includes("UTR is already attached") ||
      error.message.includes("payments_manual_upi_utr_unique") ||
      error.code === "23505"
    ) {
      return {
        success: false,
        error:
          "This Transaction ID / UTR has already been submitted. Please check your payment receipt and enter a different valid reference.",
      };
    }
    if (error.code === "22P02" || error.message.includes("enum payment_status")) {
      return {
        success: false,
        error:
          "Payment submission failed due to a database trigger transition conflict. Please ensure database migration 202610290006 is applied.",
      };
    }
    return { success: false, error: "This payment cannot be submitted in its current state." };
  }

  revalidatePath(`/seller/orders/${parsed.data.orderId}`);
  return {
    success: true,
    redirectUrl: `/seller/orders/${parsed.data.orderId}?submitted=1`,
  };
}

export async function verifyPayment(formData: FormData) {
  await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);
  const paymentId = z.string().uuid().safeParse(formData.get("paymentId"));
  if (!paymentId.success) throw new Error("Invalid payment.");
  const user = await requireAuth();
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("verify_payment_and_issue", {
    p_payment_id: paymentId.data,
    p_actor: user.id,
  });
  if (error) {
    console.error("[Operations Diagnostic] verify_payment_and_issue failed:", {
      code: error.code,
      message: error.message,
    });
    throw new Error("Payment verification failed. It may already have been processed.");
  }

  // Lookup order ID to trigger automated ticket delivery dispatch
  const { data: paymentRecord } = await admin
    .from("payments")
    .select("order_id")
    .eq("id", paymentId.data)
    .maybeSingle();

  if (paymentRecord?.order_id) {
    try {
      await dispatchOrderTicketDeliveries(paymentRecord.order_id, {
        actorUserId: user.id,
      });
    } catch (deliveryErr) {
      console.warn("[Operations Diagnostic] Automated delivery dispatch warning:", deliveryErr);
    }

    // Revalidate customer order page and seller workspace to eliminate stale cache
    revalidatePath(`/buy/order/${paymentRecord.order_id}`);
    revalidatePath(`/seller/orders/${paymentRecord.order_id}`);
  }

  revalidatePath("/admin/payments");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/tickets");
  revalidatePath("/admin");
  redirect("/admin/payments?verified=1");
}

export async function rejectPayment(formData: FormData) {
  await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);
  const parsed = z
    .object({
      paymentId: z.string().uuid(),
      reason: z.string().trim().min(3).max(500),
    })
    .safeParse({ paymentId: formData.get("paymentId"), reason: formData.get("reason") });

  if (!parsed.success) throw new Error("A rejection reason is required.");
  const user = await requireAuth();
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("reject_payment", {
    p_payment_id: parsed.data.paymentId,
    p_actor: user.id,
    p_reason: parsed.data.reason,
  });
  if (error) {
    console.error("[Operations Diagnostic] reject_payment failed:", {
      code: error.code,
      message: error.message,
    });
    throw new Error("Payment rejection failed. It may already have been processed.");
  }

  const { data: rejectedPayment } = await admin
    .from("payments")
    .select("order_id")
    .eq("id", parsed.data.paymentId)
    .maybeSingle();

  if (rejectedPayment?.order_id) {
    revalidatePath(`/buy/order/${rejectedPayment.order_id}`);
    revalidatePath(`/seller/orders/${rejectedPayment.order_id}`);
  }

  revalidatePath("/admin/payments");
  revalidatePath("/admin");
  redirect("/admin/payments?rejected=1");
}
