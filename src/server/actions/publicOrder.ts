"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SELLER_CODE_REGEX } from "@/lib/validation/referral";
import { formatIstDateTime } from "@/lib/date/timezone";

const publicOrderSchema = z.object({
  sellerCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(SELLER_CODE_REGEX, "Invalid seller referral code format."),
  name: z.string().trim().min(2, "Name must be at least 2 characters.").max(120),
  whatsapp: z
    .string()
    .trim()
    .regex(/^[0-9+ -]{7,20}$/, "Enter a valid phone/WhatsApp number."),
  email: z.string().trim().email("Enter a valid email address.").optional().or(z.literal("")),
  quantity: z.coerce.number().int().min(1, "Minimum 1 ticket.").max(100, "Maximum 100 tickets per online order."),
});

const publicUtrSchema = z.object({
  orderId: z.string().uuid("Invalid order ID."),
  utr: z
    .string()
    .trim()
    .min(6, "UTR / Reference must be at least 6 characters.")
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/, "UTR must only contain alphanumeric characters or hyphens."),
  payerName: z.string().trim().max(120).optional(),
});

/**
 * Creates an order initiated publicly by a customer scanning a seller's referral QR code.
 * Strictly verifies the seller referral code on the server before attributing the order.
 */
export async function createPublicCustomerOrder(formData: FormData) {
  const parsed = publicOrderSchema.safeParse({
    sellerCode: formData.get("sellerCode"),
    name: formData.get("name"),
    whatsapp: formData.get("whatsapp"),
    email: formData.get("email"),
    quantity: formData.get("quantity"),
  });

  if (!parsed.success) {
    const firstError = parsed.error.issues?.[0]?.message ?? parsed.error.message ?? "Please check the form inputs.";
    throw new Error(firstError);
  }

  const admin = createSupabaseAdminClient();

  // 1. Verify seller is active and valid on the server
  const { data: seller, error: sellerErr } = await admin
    .from("sellers")
    .select("id, is_active, seller_code")
    .eq("seller_code", parsed.data.sellerCode)
    .maybeSingle();

  if (sellerErr) {
    console.error("[Public Order Diagnostic] Seller lookup failed:", {
      code: sellerErr.code,
      message: sellerErr.message,
    });
    throw new Error("Unable to verify seller referral code at this time.");
  }

  if (!seller) {
    throw new Error(`Referral code "${parsed.data.sellerCode}" was not found.`);
  }

  if (!seller.is_active) {
    throw new Error(`The seller associated with "${parsed.data.sellerCode}" is currently inactive.`);
  }

  // 2. Strict Server-Side Campaign State Verification
  // Execute scheduled transition check to auto-activate DRAFT or auto-close overdue ACTIVE campaigns
  try {
    await admin.rpc("process_scheduled_campaign_transitions");
  } catch (rpcErr) {
    console.warn("[Public Order Diagnostic] Pre-flight schedule transition warning:", rpcErr);
  }

  const { data: campaign, error: campaignErr } = await admin
    .from("campaigns")
    .select("id, status, total_ticket_limit, sold_ticket_count, start_at, end_at")
    .eq("public_id", "ssfi-fundraising-lucky-draw")
    .maybeSingle();

  if (campaignErr) {
    console.error("[Public Order Diagnostic] Campaign lookup failed:", {
      code: campaignErr.code,
      message: campaignErr.message,
    });
    throw new Error("Unable to verify fundraising campaign status. Please try again later.");
  }

  if (!campaign) {
    console.error("[Public Order Diagnostic] Campaign 'ssfi-fundraising-lucky-draw' not found in database.");
    throw new Error("Fundraising campaign configuration was not found.");
  }

  if (campaign.status !== "ACTIVE") {
    console.warn(`[Public Order Diagnostic] Order rejected: Campaign status is '${campaign.status}' (must be 'ACTIVE').`);
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
    console.warn(`[Public Order Diagnostic] Order rejected: Sales have not opened yet (opens on ${opensAt}).`);
    throw new Error(`Ticket sales have not opened yet. Sales are scheduled to open on ${opensAt}.`);
  }

  if (campaign.end_at && now >= new Date(campaign.end_at)) {
    const closedAt = formatIstDateTime(campaign.end_at);
    console.warn(`[Public Order Diagnostic] Order rejected: Sales ended on ${closedAt}.`);
    throw new Error(`Ticket sales for this lucky draw have ended (closed on ${closedAt}).`);
  }

  const remaining = Math.max(0, campaign.total_ticket_limit - campaign.sold_ticket_count);
  if (parsed.data.quantity > remaining) {
    throw new Error(`Sorry, the requested quantity (${parsed.data.quantity}) exceeds remaining campaign capacity (${remaining} tickets available).`);
  }

  // 3. Execute order creation RPC with verified seller_id and active campaign
  const { data: orderId, error: orderErr } = await admin.rpc("create_seller_order", {
    p_seller_id: seller.id,
    p_name: parsed.data.name,
    p_whatsapp: parsed.data.whatsapp,
    p_email: parsed.data.email || "",
    p_quantity: parsed.data.quantity,
  });

  if (orderErr || !orderId) {
    console.error("[Public Order Diagnostic] RPC create_seller_order failed:", {
      code: orderErr?.code,
      message: orderErr?.message,
      hint: orderErr?.hint,
    });

    const errorMsg = orderErr?.message ?? "Failed to create order.";
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
      throw new Error("The attributed seller is currently inactive.");
    }
    if (orderErr?.code === "42501" || errorMsg.includes("permission denied")) {
      throw new Error("Order creation failed due to database authorization restrictions.");
    }
    throw new Error("Unable to create your order at this time. Please try again.");
  }

  redirect(`/buy/order/${orderId}`);
}

/**
 * Submits a manual UPI payment UTR reference for a public customer order.
 * Transitions payment to SUBMITTED for staff manual verification.
 */
export async function submitPublicUpiPayment(formData: FormData) {
  const parsed = publicUtrSchema.safeParse({
    orderId: formData.get("orderId"),
    utr: formData.get("utr"),
    payerName: formData.get("payerName"),
  });

  if (!parsed.success) {
    const firstError = parsed.error.issues?.[0]?.message ?? parsed.error.message ?? "Invalid payment reference.";
    throw new Error(firstError);
  }

  const admin = createSupabaseAdminClient();

  // Check order exists
  const { data: order, error: orderLookupErr } = await admin
    .from("orders")
    .select("id, status")
    .eq("id", parsed.data.orderId)
    .maybeSingle();

  if (orderLookupErr || !order) {
    throw new Error("Order not found.");
  }

  if (order.status !== "PENDING_PAYMENT" && order.status !== "PAYMENT_SUBMITTED") {
    throw new Error("This order is not eligible for payment submission.");
  }

  // Submit manual UPI via RPC
  const { error: rpcErr } = await admin.rpc("submit_manual_upi", {
    p_order_id: parsed.data.orderId,
    p_utr: parsed.data.utr,
    p_payer_name: parsed.data.payerName || "",
  });

  if (rpcErr) {
    const message = rpcErr.message;
    if (message.includes("UTR is already attached")) {
      throw new Error("This UTR / Transaction Reference has already been submitted for another order.");
    }
    throw new Error("Payment reference submission failed. Please try again.");
  }

  revalidatePath(`/buy/order/${parsed.data.orderId}`);
  redirect(`/buy/order/${parsed.data.orderId}?submitted=1`);
}
