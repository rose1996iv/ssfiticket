"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatIstDateTime } from "@/lib/date/timezone";
import { getCustomerOrderUrl, resolveEnvironmentAppUrl } from "@/lib/config/appUrl";
import { buildWhatsAppClickToChatUrl } from "@/lib/delivery/whatsappUrl";
import {
  evaluateWhatsAppDeliveryAuthorization,
  UUID_SCHEMA,
  type WhatsAppAuthContext,
  type WhatsAppOrderTarget,
} from "@/lib/delivery/whatsappAuth";
import type { DeliveryPayload } from "@/lib/delivery/types";

/**
 * Resolves the trusted server-side authentication & authoritative RBAC context
 * using a SINGLE `auth.getUser()` call (REV-2C-07) and direct `has_role` RPCs.
 * Never accepts client-supplied user IDs, roles, or seller IDs.
 */
async function resolveTrustedWhatsAppAuthContext(): Promise<WhatsAppAuthContext | null> {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const admin = createSupabaseAdminClient();
  const [superRes, adminRes, managerRes, sellerRoleRes, profileRes] = await Promise.all([
    admin.rpc("has_role", { p_user_id: user.id, p_role: "SUPER_ADMIN" }),
    admin.rpc("has_role", { p_user_id: user.id, p_role: "ADMIN" }),
    admin.rpc("has_role", { p_user_id: user.id, p_role: "FUNDRAISING_MANAGER" }),
    admin.rpc("has_role", { p_user_id: user.id, p_role: "SELLER" }),
    admin.from("profiles").select("is_active").eq("id", user.id).maybeSingle(),
  ]);

  const roles: string[] = [];
  if (!superRes.error && superRes.data === true) roles.push("SUPER_ADMIN");
  if (!adminRes.error && adminRes.data === true) roles.push("ADMIN");
  if (!managerRes.error && managerRes.data === true) roles.push("FUNDRAISING_MANAGER");
  const isSeller = !sellerRoleRes.error && sellerRoleRes.data === true;
  if (isSeller) roles.push("SELLER");

  const sellerRes = isSeller
    ? await admin
        .from("sellers")
        .select("id, is_active")
        .eq("profile_id", user.id)
        .maybeSingle()
    : { data: null, error: null };

  const profileActive = !profileRes.error && profileRes.data?.is_active === true;

  return {
    userId: user.id,
    userEmail: user.email ?? null,
    profileActive,
    roles,
    sellerRecord: sellerRes.data
      ? { id: sellerRes.data.id, is_active: sellerRes.data.is_active === true }
      : null,
  };
}

/**
 * Prepares the official WhatsApp Click-to-Chat payload for an issued order.
 * Strictly free: generates a wa.me URL for manual transmission by authorized staff or owning seller.
 */
export async function prepareWhatsAppTicketDelivery(orderId: string) {
  if (!UUID_SCHEMA.safeParse(orderId).success) {
    return { success: false, error: "Invalid order reference." };
  }

  const authCtx = await resolveTrustedWhatsAppAuthContext();
  if (!authCtx) {
    return { success: false, error: "Authentication required to perform ticket delivery actions." };
  }

  const admin = createSupabaseAdminClient();

  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select(`
      id,
      campaign_id,
      seller_id,
      order_number,
      total_amount_paise,
      status,
      campaigns(name),
      customers(full_name, phone, whatsapp_number, email),
      sellers!orders_seller_id_fkey(display_name, seller_code),
      payments(status, verified_at, amount_paise),
      tickets(id, order_id, campaign_id, ticket_number, status, issued_at)
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (orderErr) {
    console.error("[Delivery Diagnostic] Order lookup failed:", { code: orderErr.code });
    return { success: false, error: "Unable to load order details for delivery." };
  }

  const rawTickets =
    (order?.tickets as unknown as Array<{
      id: string;
      order_id: string;
      campaign_id: string;
      ticket_number: string;
      status: string;
      issued_at: string;
    }>) || [];

  const authz = evaluateWhatsAppDeliveryAuthorization(
    orderId,
    authCtx,
    order
      ? ({
          id: order.id,
          campaign_id: order.campaign_id,
          seller_id: order.seller_id,
          status: order.status,
          tickets: rawTickets,
        } satisfies WhatsAppOrderTarget)
      : null
  );

  if (!authz.authorized || !order) {
    return {
      success: false,
      error: authz.authorized ? "Order not found." : authz.error,
    };
  }

  const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
  const seller = Array.isArray(order.sellers) ? order.sellers[0] : order.sellers;
  const payment = Array.isArray(order.payments) ? order.payments[0] : order.payments;
  const campaign = Array.isArray(order.campaigns) ? order.campaigns[0] : order.campaigns;

  const activeTickets = rawTickets.filter((t) => t.status === "ISSUED" || t.status === "ACTIVE");

  if (activeTickets.length === 0) {
    return {
      success: false,
      error: "Tickets have not been issued yet for this order. Verification required first.",
    };
  }

  // Environment-aware resolution ensuring link points to the environment owning the database
  const { baseUrl: envBaseUrl, isPreview, isSafePreviewUrlAvailable } = resolveEnvironmentAppUrl();

  // If in Preview and no safe preview domain is available, disable external delivery
  if (isPreview && !isSafePreviewUrlAvailable) {
    return {
      success: false,
      error:
        "External delivery is disabled because a safe Preview deployment URL is not configured. This preview order is for internal testing only.",
    };
  }

  const ticketAccessUrl = getCustomerOrderUrl(order.id, envBaseUrl);
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
    isSimulated: isPreview,
  };

  const { url, recipientPhone, messageText } = buildWhatsAppClickToChatUrl(payload);

  // Record audit log for preparation (without storing raw customer phone PII)
  try {
    await admin.from("audit_logs").insert({
      actor_user_id: authz.actorUserId,
      action: "TICKET_DELIVERY_PREPARED",
      entity_type: "order",
      entity_id: order.id,
      metadata: {
        channel: "WHATSAPP",
        provider: "wa.me_free",
        actor_role: authz.actorRole,
        ticket_count: activeTickets.length,
      },
    });
  } catch (err) {
    console.warn("[Delivery Diagnostic] Failed to write preparation audit log:", {
      error: err instanceof Error ? err.name : "UnknownError",
    });
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
 * Records an audit log event and delivery status update when authorized staff or owning seller
 * opens the WhatsApp Click-to-Chat link. Creates the `ticket_deliveries` row if absent so
 * zero-row updates are never silently masked (REV-2C-07).
 */
export async function recordWhatsAppOpenedAction(orderId: string): Promise<{
  success: boolean;
  deliveryRecordUpdated: boolean;
}> {
  if (!UUID_SCHEMA.safeParse(orderId).success) {
    throw new Error("Invalid order reference.");
  }

  const authCtx = await resolveTrustedWhatsAppAuthContext();
  if (!authCtx) {
    throw new Error("Authentication required to perform ticket delivery actions.");
  }

  const admin = createSupabaseAdminClient();

  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("id, campaign_id, seller_id, customer_id, status, customers(phone, whatsapp_number)")
    .eq("id", orderId)
    .maybeSingle();

  if (orderErr) {
    console.error("[Delivery Diagnostic] Order lookup failed:", { code: orderErr.code });
    throw new Error("Unable to load order for WhatsApp action.");
  }

  const authz = evaluateWhatsAppDeliveryAuthorization(
    orderId,
    authCtx,
    order
      ? {
          id: order.id,
          campaign_id: order.campaign_id,
          seller_id: order.seller_id,
          status: order.status,
        }
      : null
  );

  if (!authz.authorized || !order) {
    throw new Error(authz.authorized ? "Order not found for WhatsApp action." : authz.error);
  }

  if (order.status !== "TICKETS_ISSUED") {
    throw new Error("Cannot record WhatsApp delivery: Tickets have not been issued for this order.");
  }

  let deliveryRecordUpdated = false;
  const nowIso = new Date().toISOString();

  try {
    await admin.from("audit_logs").insert({
      actor_user_id: authz.actorUserId,
      action: "WHATSAPP_LINK_OPENED",
      entity_type: "order",
      entity_id: orderId,
      metadata: {
        channel: "WHATSAPP",
        provider: "wa.me_free",
        actor_role: authz.actorRole,
        timestamp: nowIso,
      },
    });

    const { data: existingDelivery } = await admin
      .from("ticket_deliveries")
      .select("id, status, metadata")
      .eq("order_id", orderId)
      .eq("channel", "WHATSAPP")
      .maybeSingle();

    const currentMetadata = (existingDelivery?.metadata as Record<string, unknown>) || {};
    const isAlreadyManuallySent =
      existingDelivery?.status === "SENT" && Boolean(currentMetadata.manual_send_confirmed);

    const updatedMetadata = isAlreadyManuallySent
      ? {
          ...currentMetadata,
          reopened_at: nowIso,
        }
      : {
          ...currentMetadata,
          whatsapp_action: "WHATSAPP_LINK_OPENED",
          opened_at: nowIso,
          opened_by_role: authz.actorRole,
        };

    if (existingDelivery) {
      const { data: updatedRow } = await admin
        .from("ticket_deliveries")
        .update({
          last_attempt_at: nowIso,
          metadata: updatedMetadata,
        })
        .eq("id", existingDelivery.id)
        .select("id")
        .maybeSingle();
      deliveryRecordUpdated = Boolean(updatedRow?.id);
    } else if (order.customer_id) {
      const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
      const recipient = customer?.whatsapp_number || customer?.phone || "whatsapp";
      const { data: insertedRow } = await admin
        .from("ticket_deliveries")
        .insert({
          order_id: orderId,
          customer_id: order.customer_id,
          channel: "WHATSAPP",
          recipient,
          status: "PENDING",
          provider: "wa.me_free",
          rendered_content: "WhatsApp Click-to-Chat link opened",
          attempt_count: 1,
          last_attempt_at: nowIso,
          metadata: updatedMetadata,
        })
        .select("id")
        .maybeSingle();
      deliveryRecordUpdated = Boolean(insertedRow?.id);
    }
  } catch (err) {
    console.warn("[Delivery Diagnostic] Failed to record WhatsApp link opened:", {
      error: err instanceof Error ? err.name : "UnknownError",
    });
  }

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath(`/seller/orders/${orderId}`);
  revalidatePath(`/buy/order/${orderId}`);
  return { success: true, deliveryRecordUpdated };
}

/**
 * Records when an authorized staff member or owning seller manually confirms sending the WhatsApp message.
 * Updates or creates the `ticket_deliveries` row with status SENT so zero-row updates never fail silently (REV-2C-07).
 */
export async function recordWhatsAppManuallySentAction(orderId: string): Promise<{
  success: boolean;
  alreadyConfirmed?: boolean;
  deliveryRecordUpdated?: boolean;
}> {
  if (!UUID_SCHEMA.safeParse(orderId).success) {
    throw new Error("Invalid order reference.");
  }

  const authCtx = await resolveTrustedWhatsAppAuthContext();
  if (!authCtx) {
    throw new Error("Authentication required to perform ticket delivery actions.");
  }

  const admin = createSupabaseAdminClient();

  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("id, campaign_id, seller_id, customer_id, status, customers(phone, whatsapp_number)")
    .eq("id", orderId)
    .maybeSingle();

  if (orderErr) {
    console.error("[Delivery Diagnostic] Order lookup failed:", { code: orderErr.code });
    throw new Error("Unable to load order for WhatsApp action.");
  }

  const authz = evaluateWhatsAppDeliveryAuthorization(
    orderId,
    authCtx,
    order
      ? {
          id: order.id,
          campaign_id: order.campaign_id,
          seller_id: order.seller_id,
          status: order.status,
        }
      : null
  );

  if (!authz.authorized || !order) {
    throw new Error(authz.authorized ? "Order not found for WhatsApp action." : authz.error);
  }

  if (order.status !== "TICKETS_ISSUED") {
    throw new Error("Cannot confirm WhatsApp delivery: Tickets have not been issued for this order.");
  }

  const { data: existingDelivery } = await admin
    .from("ticket_deliveries")
    .select("id, status, metadata")
    .eq("order_id", orderId)
    .eq("channel", "WHATSAPP")
    .maybeSingle();

  const currentMetadata = (existingDelivery?.metadata as Record<string, unknown>) || {};

  // Idempotency: Guard against duplicate confirmations
  if (existingDelivery?.status === "SENT" && Boolean(currentMetadata.manual_send_confirmed)) {
    return { success: true, alreadyConfirmed: true, deliveryRecordUpdated: false };
  }

  let deliveryRecordUpdated = false;
  const nowIso = new Date().toISOString();

  try {
    await admin.from("audit_logs").insert({
      actor_user_id: authz.actorUserId,
      action: "TICKET_DELIVERY_MANUALLY_SENT",
      entity_type: "order",
      entity_id: orderId,
      metadata: {
        channel: "WHATSAPP",
        provider: "wa.me_free",
        actor_role: authz.actorRole,
        timestamp: nowIso,
      },
    });

    const confirmedMetadata = {
      ...currentMetadata,
      whatsapp_action: "MANUALLY_CONFIRMED",
      manual_send_confirmed: true,
      confirmed_at: nowIso,
      confirmed_by_role: authz.actorRole,
    };

    if (existingDelivery) {
      const { data: updatedRow } = await admin
        .from("ticket_deliveries")
        .update({
          status: "SENT",
          sent_at: nowIso,
          last_attempt_at: nowIso,
          metadata: confirmedMetadata,
        })
        .eq("id", existingDelivery.id)
        .select("id")
        .maybeSingle();
      deliveryRecordUpdated = Boolean(updatedRow?.id);
    } else if (order.customer_id) {
      const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
      const recipient = customer?.whatsapp_number || customer?.phone || "whatsapp";
      const { data: insertedRow } = await admin
        .from("ticket_deliveries")
        .insert({
          order_id: orderId,
          customer_id: order.customer_id,
          channel: "WHATSAPP",
          recipient,
          status: "SENT",
          provider: "wa.me_free",
          rendered_content: "WhatsApp ticket delivery manually confirmed",
          attempt_count: 1,
          sent_at: nowIso,
          last_attempt_at: nowIso,
          metadata: confirmedMetadata,
        })
        .select("id")
        .maybeSingle();
      deliveryRecordUpdated = Boolean(insertedRow?.id);
    }
  } catch (err) {
    console.warn("[Delivery Diagnostic] Failed to record WhatsApp manually sent:", {
      error: err instanceof Error ? err.name : "UnknownError",
    });
  }

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath(`/seller/orders/${orderId}`);
  revalidatePath(`/buy/order/${orderId}`);
  return { success: true, alreadyConfirmed: false, deliveryRecordUpdated };
}
