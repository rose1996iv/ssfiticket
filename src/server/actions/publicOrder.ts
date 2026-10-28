"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SELLER_CODE_REGEX } from "@/lib/validation/referral";

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

  if (sellerErr || !seller) {
    throw new Error(`Referral code "${parsed.data.sellerCode}" was not found.`);
  }

  if (!seller.is_active) {
    throw new Error(`The seller associated with "${parsed.data.sellerCode}" is currently inactive.`);
  }

  // 2. Execute order creation RPC with verified seller_id
  const { data: orderId, error: orderErr } = await admin.rpc("create_seller_order", {
    p_seller_id: seller.id,
    p_name: parsed.data.name,
    p_whatsapp: parsed.data.whatsapp,
    p_email: parsed.data.email || "",
    p_quantity: parsed.data.quantity,
  });

  if (orderErr || !orderId) {
    const errorMsg = orderErr?.message ?? "Failed to create order.";
    if (errorMsg.includes("capacity")) {
      throw new Error("Sorry, the requested quantity exceeds remaining campaign ticket capacity.");
    }
    if (errorMsg.includes("not found")) {
      throw new Error("Ticket sales are currently not active.");
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
