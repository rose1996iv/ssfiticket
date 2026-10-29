"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatIstDateTime } from "@/lib/date/timezone";
import { getCustomerOrderUrl } from "@/lib/config/appUrl";
import { buildWhatsAppClickToChatUrl } from "@/lib/delivery/whatsappUrl";
import type { DeliveryPayload } from "@/lib/delivery/types";

/**
 * Prepares the official WhatsApp Click-to-Chat payload for an issued order.
 * Strictly free: generates a wa.me URL for manual transmission by staff or seller.
 */
export async function prepareWhatsAppTicketDelivery(orderId: string) {
  const admin = createSupabaseAdminClient();

  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select(`
      id,
      order_number,
      total_amount_paise,
      status,
      campaigns(name),
      customers(id, full_name, phone, whatsapp_number, email),
      sellers(display_name, seller_code),
      payments(status, verified_at, amount_paise),
      tickets(id, ticket_number, status, issued_at)
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (orderErr || !order) {
    return { success: false, error: "Order not found." };
  }

  const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
  const seller = Array.isArray(order.sellers) ? order.sellers[0] : order.sellers;
  const payment = Array.isArray(order.payments) ? order.payments[0] : order.payments;
  const campaign = Array.isArray(order.campaigns) ? order.campaigns[0] : order.campaigns;
  const rawTickets = (order.tickets as unknown as Array<{ id: string; ticket_number: string; status: string; issued_at: string }>) || [];

  const activeTickets = rawTickets.filter((t) => t.status === "ISSUED" || t.status === "ACTIVE");

  if (activeTickets.length === 0) {
    return {
      success: false,
      error: "Tickets have not been issued yet for this order. Verification required first.",
    };
  }

  const ticketAccessUrl = getCustomerOrderUrl(order.id);
  const issuedAt = payment?.verified_at || activeTickets[0]?.issued_at || new Date().toISOString();

  const payload: DeliveryPayload = {
    orderId: order.id,
    orderNumber: order.order_number,
    customerName: customer?.full_name || "Valued Supporter",
    whatsappNumber: customer?.whatsapp_number || customer?.phone || "",
    email: customer?.email || null,
    ticketNumbers: activeTickets.map((t) => t.ticket_number),
    amountInr: (payment?.amount_paise ?? order.total_amount_paise) / 100,
    campaignName: campaign?.name || "SSFI Lucky Draw",
    issuedAtIst: formatIstDateTime(issuedAt),
    ticketAccessUrl,
    sellerAttribution: seller ? `${seller.display_name} (${seller.seller_code})` : null,
    supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE || undefined,
    supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "Senthangstudents@gmail.com",
    isSimulated: false,
  };

  const { url, recipientPhone, messageText } = buildWhatsAppClickToChatUrl(payload);

  // Record audit log for preparation
  const user = await getCurrentUser();
  try {
    await admin.from("audit_logs").insert({
      actor_user_id: user?.id || null,
      action: "TICKET_DELIVERY_PREPARED",
      entity_type: "order",
      entity_id: order.id,
      metadata: {
        channel: "WHATSAPP",
        provider: "wa.me_free",
        recipient_phone: recipientPhone,
        ticket_count: activeTickets.length,
      },
    });
  } catch (err) {
    console.warn("[Delivery Diagnostic] Failed to write preparation audit log:", err);
  }

  return {
    success: true,
    url,
    recipientPhone,
    messageText,
    ticketNumbers: payload.ticketNumbers,
    customerName: payload.customerName,
  };
}

/**
 * Records an audit log event and delivery status update when staff/seller opens
 * the WhatsApp Click-to-Chat link.
 */
export async function recordWhatsAppOpenedAction(orderId: string) {
  const admin = createSupabaseAdminClient();
  const user = await getCurrentUser();

  try {
    await admin.from("audit_logs").insert({
      actor_user_id: user?.id || null,
      action: "WHATSAPP_LINK_OPENED",
      entity_type: "order",
      entity_id: orderId,
      metadata: {
        channel: "WHATSAPP",
        provider: "wa.me_free",
        timestamp: new Date().toISOString(),
      },
    });

    // Update ticket_deliveries record if present
    await admin
      .from("ticket_deliveries")
      .update({
        status: "WHATSAPP_LINK_OPENED",
        last_attempt_at: new Date().toISOString(),
      })
      .eq("order_id", orderId)
      .eq("channel", "WHATSAPP");
  } catch (err) {
    console.warn("[Delivery Diagnostic] Failed to record WhatsApp link opened:", err);
  }

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath(`/seller/orders/${orderId}`);
  revalidatePath(`/buy/order/${orderId}`);
  return { success: true };
}

/**
 * Records when the staff member or seller manually confirms sending the WhatsApp message.
 */
export async function recordWhatsAppManuallySentAction(orderId: string) {
  const admin = createSupabaseAdminClient();
  const user = await getCurrentUser();

  try {
    await admin.from("audit_logs").insert({
      actor_user_id: user?.id || null,
      action: "TICKET_DELIVERY_MANUALLY_SENT",
      entity_type: "order",
      entity_id: orderId,
      metadata: {
        channel: "WHATSAPP",
        provider: "wa.me_free",
        confirmed_by: user?.email || "staff",
        timestamp: new Date().toISOString(),
      },
    });

    // Update ticket_deliveries to MANUALLY_SENT
    await admin
      .from("ticket_deliveries")
      .update({
        status: "MANUALLY_SENT",
        sent_at: new Date().toISOString(),
        last_attempt_at: new Date().toISOString(),
      })
      .eq("order_id", orderId)
      .eq("channel", "WHATSAPP");
  } catch (err) {
    console.warn("[Delivery Diagnostic] Failed to record WhatsApp manually sent:", err);
  }

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath(`/seller/orders/${orderId}`);
  revalidatePath(`/buy/order/${orderId}`);
  return { success: true };
}
