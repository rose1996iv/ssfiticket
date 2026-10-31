import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatIstDateTime } from "@/lib/date/timezone";
import { getCustomerOrderUrl } from "../config/appUrl.ts";
import {
  DeliveryChannel,
  DeliveryPayload,
  DeliveryResult,
  DeliveryStatus,
} from "./types";
import {
  renderWhatsAppTicketMessage,
  renderEmailTicketMessage,
} from "./templates";
import { isGmailApiConfigured, sendEmailViaGmailApi } from "./providers/gmail";

/**
 * Dispatches ticket delivery across official SSFI channels (WhatsApp and Email).
 * Uses simulated local providers by default for safe localhost testing without credentials.
 * Connects to live providers (WhatsApp Cloud API / Resend) only when credentials are explicitly set.
 */
export async function dispatchOrderTicketDeliveries(
  orderId: string,
  options?: {
    forceChannel?: DeliveryChannel;
    resend?: boolean;
    actorUserId?: string | null;
  }
): Promise<DeliveryResult[]> {
  const admin = createSupabaseAdminClient();

  // 1. Fetch complete order, customer, payment, campaign, seller, and ticket records
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
    console.error("[Delivery Service Diagnostic] Order lookup failed:", {
      orderId,
      code: orderErr?.code,
      message: orderErr?.message,
    });
    throw new Error("Unable to locate order for ticket delivery.");
  }

  const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
  const seller = Array.isArray(order.sellers) ? order.sellers[0] : order.sellers;
  const payment = Array.isArray(order.payments) ? order.payments[0] : order.payments;
  const campaign = Array.isArray(order.campaigns) ? order.campaigns[0] : order.campaigns;
  const rawTickets = (order.tickets as unknown as Array<{ id: string; ticket_number: string; status: string; issued_at: string }>) || [];

  // Filter only active, non-voided issued tickets
  const activeTickets = rawTickets.filter((t) => t.status === "ISSUED" || t.status === "ACTIVE");

  if (activeTickets.length === 0) {
    throw new Error("Cannot dispatch delivery: No active issued tickets found for this order.");
  }

  const ticketAccessUrl = getCustomerOrderUrl(order.id);

  const issuedAt = payment?.verified_at || activeTickets[0]?.issued_at || new Date().toISOString();

  // Determine if running in simulated or live mode
  const isVercelPreview =
    process.env.VERCEL_ENV === "preview" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
  const isProduction =
    process.env.VERCEL_ENV === "production" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "production";
  const isDev = !isProduction && (process.env.NODE_ENV !== "production" || isVercelPreview);
  const hasLiveWhatsApp = Boolean(process.env.WHATSAPP_API_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  const hasGmailApi = isGmailApiConfigured();
  const hasLiveEmail = Boolean(process.env.RESEND_API_KEY || hasGmailApi);

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
    isSimulated: !isProduction && (isDev || !hasLiveEmail),
  };

  // Deduping: Fetch existing delivery records to prevent duplicate sends on retries
  const { data: existingDeliveries } = await admin
    .from("ticket_deliveries")
    .select("channel, status, provider_message_id, sent_at")
    .eq("order_id", order.id);

  const channelsToDeliver: DeliveryChannel[] = options?.forceChannel
    ? [options.forceChannel]
    : ["WHATSAPP", ...(payload.email ? (["EMAIL"] as const) : [])];

  const results: DeliveryResult[] = [];

  for (const channel of channelsToDeliver) {
    // If this is NOT an explicit resend, skip if already sent successfully (or simulated)
    if (!options?.resend) {
      const existing = existingDeliveries?.find(
        (d) =>
          d.channel === channel &&
          (d.status === "SENT" || d.status === "DELIVERED" || d.status === "SIMULATED")
      );
      if (existing) {
        console.log(
          `[Delivery Service] Skipping ${channel} for order ${order.order_number}: already delivered or simulated (sent at ${existing.sent_at}, ID: ${existing.provider_message_id}).`
        );
        results.push({
          channel: existing.channel as DeliveryChannel,
          status: existing.status as DeliveryStatus,
          provider: "existing",
          recipient: channel === "EMAIL" ? (payload.email || "customer") : payload.whatsappNumber,
          providerMessageId: existing.provider_message_id,
          renderedContent: "",
          subject: "",
          error: null,
        });
        continue;
      }
    }

    let result: DeliveryResult;

    if (channel === "WHATSAPP") {
      result = await executeWhatsAppDelivery(payload, hasLiveWhatsApp, isDev);
    } else {
      result = await executeEmailDelivery(payload, hasLiveEmail, isDev, {
        isStaffAuthorized: Boolean(options?.actorUserId),
      });
    }

    // Upsert into ticket_deliveries
    const { error: upsertErr } = await admin
      .from("ticket_deliveries")
      .upsert(
        {
          order_id: order.id,
          customer_id: customer.id,
          channel: result.channel,
          recipient: result.recipient,
          status: result.status,
          provider: result.provider,
          provider_message_id: result.providerMessageId,
          subject: result.subject || null,
          rendered_content: result.renderedContent,
          attempt_count: (options?.resend ? 2 : 1),
          last_attempt_at: new Date().toISOString(),
          sent_at: result.status === "SENT" || result.status === "SIMULATED" ? new Date().toISOString() : null,
          error_message: result.error || null,
          metadata: {
            is_simulated: result.status === "SIMULATED",
            resend: Boolean(options?.resend),
            ticket_count: activeTickets.length,
          },
        },
        { onConflict: "order_id,channel" }
      );

    if (upsertErr) {
      console.error("[Delivery Service Diagnostic] Upsert to ticket_deliveries failed:", {
        orderId: order.id,
        channel: result.channel,
        code: upsertErr.code,
        message: upsertErr.message,
      });
    }

    // Write audit log
    try {
      await admin.from("audit_logs").insert({
        actor_user_id: options?.actorUserId || null,
        action: result.status === "SIMULATED" ? "TICKET_DELIVERY_SIMULATED" : "TICKET_DELIVERED",
        entity_type: "ticket_delivery",
        entity_id: order.id,
        metadata: {
          channel: result.channel,
          recipient: result.recipient,
          status: result.status,
          provider: result.provider,
          resend: Boolean(options?.resend),
          ticket_count: activeTickets.length,
        },
      });
    } catch (auditErr) {
      console.warn("[Delivery Service Diagnostic] Non-fatal audit log insertion warning:", auditErr);
    }

    results.push(result);
  }

  return results;
}

/**
 * Handles WhatsApp delivery execution (Mock or Live).
 */
async function executeWhatsAppDelivery(
  payload: DeliveryPayload,
  hasLiveConfig: boolean,
  isDev: boolean
): Promise<DeliveryResult> {
  const content = renderWhatsAppTicketMessage(payload);
  const recipient = payload.whatsappNumber;

  if (!recipient) {
    return {
      channel: "WHATSAPP",
      status: "FAILED",
      provider: "none",
      recipient: "None",
      providerMessageId: null,
      renderedContent: content,
      error: "No WhatsApp or phone number recorded for customer.",
    };
  }

  // Live WhatsApp Provider check
  if (hasLiveConfig && !isDev) {
    try {
      // Live Cloud API implementation
      const token = process.env.WHATSAPP_API_TOKEN;
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

      // In staging/dev mode, verify allowed test phone if defined
      const allowedTestPhone = process.env.ALLOWED_TEST_PHONE;
      if (allowedTestPhone && recipient !== allowedTestPhone) {
        console.warn(
          `[Delivery Service] Skipping live WhatsApp to ${recipient}: does not match ALLOWED_TEST_PHONE (${allowedTestPhone}). Falling back to simulation.`
        );
        return {
          channel: "WHATSAPP",
          status: "SIMULATED",
          provider: "mock_restricted_recipient",
          recipient,
          providerMessageId: `sim-wa-test-guard-${Date.now()}`,
          renderedContent: content,
          error: null,
        };
      }

      const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient.replace(/[^0-9]/g, ""),
          type: "text",
          text: { body: content },
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error("[WhatsApp Provider Error]", errorText);
        return {
          channel: "WHATSAPP",
          status: "FAILED",
          provider: "whatsapp_cloud",
          recipient,
          providerMessageId: null,
          renderedContent: content,
          error: `WhatsApp API returned status ${res.status}`,
        };
      }

      const json = await res.json();
      const messageId = json.messages?.[0]?.id || `wa-${Date.now()}`;

      return {
        channel: "WHATSAPP",
        status: "SENT",
        provider: "whatsapp_cloud",
        recipient,
        providerMessageId: messageId,
        renderedContent: content,
        error: null,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "WhatsApp delivery failed";
      return {
        channel: "WHATSAPP",
        status: "FAILED",
        provider: "whatsapp_cloud",
        recipient,
        providerMessageId: null,
        renderedContent: content,
        error: msg,
      };
    }
  }

  // Default Mock / Localhost Provider
  return {
    channel: "WHATSAPP",
    status: "SIMULATED",
    provider: "mock",
    recipient,
    providerMessageId: `sim-wa-${payload.orderNumber}-${Date.now()}`,
    renderedContent: content,
    error: null,
  };
}

/**
 * Handles Email delivery execution (Mock, Live Resend, or Dry-Run).
 */
async function executeEmailDelivery(
  payload: DeliveryPayload,
  hasLiveConfig: boolean,
  isDev: boolean,
  options?: { isStaffAuthorized?: boolean }
): Promise<DeliveryResult> {
  const { subject, html, text } = renderEmailTicketMessage(payload);
  const recipient = payload.email?.trim() || null;

  if (!recipient) {
    return {
      channel: "EMAIL",
      status: "FAILED",
      provider: "none",
      recipient: "None",
      providerMessageId: null,
      renderedContent: text,
      subject,
      error: "No email address recorded for customer.",
    };
  }

  // 1. Official Gmail API adapter (uses Google OAuth2 with Senthangstudents@gmail.com)
  if (isGmailApiConfigured()) {
    return await sendEmailViaGmailApi({
      recipient,
      subject,
      text,
      html,
      payload,
      isStaffAuthorized: options?.isStaffAuthorized ?? false,
    });
  }

  // 2. Dry run / Preview / Development environment safety guard (Resend / Mock fallback)
  const isVercelPreview =
    process.env.VERCEL_ENV === "preview" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
  const isDevOrPreview = process.env.NODE_ENV !== "production" || isVercelPreview || isDev;
  const isDryRun = process.env.RESEND_DRY_RUN === "true";

  // In Preview or Development or Dry Run, strictly protect real customer inboxes:
  if (isDevOrPreview || isDryRun) {
    const allowedTestEmail = process.env.ALLOWED_TEST_EMAIL?.trim();

    // Only allow live transmission if an explicit allowed test email is configured AND matches
    const isApprovedTestRecipient =
      Boolean(allowedTestEmail) &&
      recipient.toLowerCase() === allowedTestEmail!.toLowerCase();

    if (hasLiveConfig && !isDryRun && isApprovedTestRecipient) {
      console.log(
        `[Delivery Service] Live test email permitted for approved recipient: ${recipient}`
      );
    } else {
      console.log(
        `[Delivery Service] Preview/Dev mode: email to "${recipient}" was simulated (dry-run). Real customer email was not contacted.`
      );
      return {
        channel: "EMAIL",
        status: "SIMULATED",
        provider: "mock_preview_dry_run",
        recipient,
        providerMessageId: `sim-em-${payload.orderNumber}-${Date.now()}`,
        renderedContent: html,
        subject,
        error: null,
      };
    }
  }

  // 2. Live Resend Email Provider execution
  if (hasLiveConfig) {
    try {
      const apiKey = process.env.RESEND_API_KEY;
      let fromEmail =
        process.env.EMAIL_FROM ||
        process.env.DELIVERY_FROM_EMAIL ||
        "SSFI Lucky Draw <onboarding@resend.dev>";

      // Safety check: do not impersonate gmail.com as sender on Resend
      if (fromEmail.toLowerCase().includes("@gmail.com")) {
        console.warn(
          "[Delivery Service] Warning: EMAIL_FROM cannot use @gmail.com on Resend. Falling back to default sender while preserving reply-to."
        );
        fromEmail = "SSFI Lucky Draw <onboarding@resend.dev>";
      }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [recipient],
          reply_to: "Senthangstudents@gmail.com",
          subject,
          html,
          text,
        }),
      });

      if (!res.ok) {
        let errorDetail = `Status ${res.status}`;
        try {
          const errJson = await res.json();
          errorDetail = errJson.message || errJson.error || JSON.stringify(errJson);
        } catch {
          errorDetail = await res.text();
        }

        console.error("[Resend Provider Error]", {
          status: res.status,
          message: errorDetail,
        });

        return {
          channel: "EMAIL",
          status: "FAILED",
          provider: "resend",
          recipient,
          providerMessageId: null,
          renderedContent: html,
          subject,
          error: `Email provider returned status ${res.status}: ${errorDetail}`,
        };
      }

      const json = await res.json();
      return {
        channel: "EMAIL",
        status: "SENT",
        provider: "resend",
        recipient,
        providerMessageId: json.id || `em-${Date.now()}`,
        renderedContent: html,
        subject,
        error: null,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Email delivery network error";
      console.error("[Delivery Service Error] Live email dispatch failed:", msg);
      return {
        channel: "EMAIL",
        status: "FAILED",
        provider: "resend",
        recipient,
        providerMessageId: null,
        renderedContent: html,
        subject,
        error: msg,
      };
    }
  }

  // Fallback: If live config is missing in production
  return {
    channel: "EMAIL",
    status: "FAILED",
    provider: "resend",
    recipient,
    providerMessageId: null,
    renderedContent: html,
    subject,
    error: "Resend email provider not configured (missing RESEND_API_KEY).",
  };
}
