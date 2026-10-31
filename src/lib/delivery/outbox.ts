import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatIstDateTime } from "@/lib/date/timezone";
import { getCustomerOrderUrl } from "@/lib/config/appUrl";
import {
  sendEmailViaGmailApi,
  getGmailApiConfig,
} from "./providers/gmail";
import {
  renderEmailOrderCreatedMessage,
  renderEmailPaymentApprovedMessage,
  renderEmailTicketMessage,
} from "./templates";
import type { DeliveryPayload } from "./types";

export type EmailEventType =
  | "ORDER_CREATED"
  | "PAYMENT_APPROVED"
  | "TICKETS_ISSUED"
  | "ADMIN_TEST";

export type EmailJobStatus =
  | "QUEUED"
  | "SENDING"
  | "SENT"
  | "FAILED"
  | "RETRY"
  | "SIMULATED";

export type EmailJobRecord = {
  id: string;
  idempotency_key: string;
  order_id: string | null;
  customer_id: string | null;
  event_type: EmailEventType;
  recipient: string;
  subject: string;
  body_text: string;
  body_html: string;
  status: EmailJobStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  sent_at: string | null;
  provider: string;
  provider_message_id: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CustomerEmailSettings = {
  isLiveEnabled: boolean;
  events: {
    ORDER_CREATED: boolean;
    PAYMENT_APPROVED: boolean;
    TICKETS_ISSUED: boolean;
  };
};

export type CustomerEmailMetrics = {
  totalSent: number;
  totalQueued: number;
  totalFailed: number;
  totalRetrying: number;
  totalSimulated: number;
  lastSentAtIst: string | null;
};

export type CustomerEmailLogItem = {
  id: string;
  orderNumber: string | null;
  orderId: string | null;
  eventType: EmailEventType;
  recipientMasked: string;
  status: EmailJobStatus;
  attemptCount: number;
  maxAttempts: number;
  provider: string;
  providerMessageId: string | null;
  errorMessage: string | null;
  createdAtIst: string;
  sentAtIst: string | null;
};

/**
 * Retrieves the current customer email operational settings from database or environment.
 * Default: Safe disabled (false) unless explicitly toggled by admin in database or environment.
 */
export async function getCustomerEmailSettings(): Promise<CustomerEmailSettings> {
  const admin = createSupabaseAdminClient();

  // Environment variable override (can force live or simulated)
  const envLive = process.env.GMAIL_CUSTOMER_LIVE_SEND_ENABLED === "true";

  let dbLive = false;
  let dbEvents = {
    ORDER_CREATED: true,
    PAYMENT_APPROVED: true,
    TICKETS_ISSUED: true,
  };

  try {
    const { data: rows, error } = await admin
      .from("system_settings")
      .select("key, value")
      .in("key", ["customer_email_live_enabled", "customer_email_events"]);

    if (!error && rows) {
      for (const row of rows) {
        if (row.key === "customer_email_live_enabled") {
          dbLive = Boolean(row.value);
        } else if (row.key === "customer_email_events" && typeof row.value === "object" && row.value !== null) {
          dbEvents = {
            ...dbEvents,
            ...(row.value as Record<string, boolean>),
          };
        }
      }
    }
  } catch (err) {
    // If table does not exist or network error, fallback to safe defaults
    console.warn("[Email Outbox] Settings lookup warning (using safe fallback):", err);
  }

  return {
    isLiveEnabled: envLive || dbLive,
    events: dbEvents,
  };
}

/**
 * Updates the master live customer email sending gate in system_settings.
 * Requires explicit confirmation code when enabling live delivery.
 */
export async function updateCustomerEmailLiveGate(
  enabled: boolean,
  confirmCode: string | undefined,
  actorUserId: string
): Promise<{ success: boolean; error?: string }> {
  const admin = createSupabaseAdminClient();

  if (enabled && confirmCode !== "CONFIRM_ENABLE_LIVE_EMAIL") {
    return {
      success: false,
      error: "To enable live customer emails, you must type 'CONFIRM_ENABLE_LIVE_EMAIL' in the confirmation box.",
    };
  }

  try {
    const { error } = await admin
      .from("system_settings")
      .upsert(
        {
          key: "customer_email_live_enabled",
          value: enabled,
          description: "Master gate for live customer transactional emails in production",
          updated_by: actorUserId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      );

    if (error) {
      console.error("[Email Outbox] Failed to update live gate:", error);
      return { success: false, error: "Failed to update email settings in database." };
    }

    // Write audit log
    await admin.from("audit_logs").insert({
      actor_user_id: actorUserId,
      action: enabled ? "CUSTOMER_EMAIL_LIVE_ENABLED" : "CUSTOMER_EMAIL_LIVE_DISABLED",
      entity_type: "system_settings",
      entity_id: "customer_email_live_enabled",
      metadata: {
        previous_state: !enabled,
        new_state: enabled,
        timestamp: formatIstDateTime(new Date().toISOString()),
      },
    });

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Database error";
    return { success: false, error: msg };
  }
}

/**
 * Updates the per-event customer email notification toggles in system_settings.
 */
export async function updateCustomerEmailEventToggles(
  events: { ORDER_CREATED?: boolean; PAYMENT_APPROVED?: boolean; TICKETS_ISSUED?: boolean },
  actorUserId: string
): Promise<{ success: boolean; error?: string }> {
  const admin = createSupabaseAdminClient();
  const current = await getCustomerEmailSettings();

  const updatedEvents = {
    ...current.events,
    ...events,
  };

  try {
    const { error } = await admin
      .from("system_settings")
      .upsert(
        {
          key: "customer_email_events",
          value: updatedEvents,
          description: "Per-event customer transactional email notification toggles",
          updated_by: actorUserId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      );

    if (error) {
      return { success: false, error: "Failed to update notification toggles in database." };
    }

    await admin.from("audit_logs").insert({
      actor_user_id: actorUserId,
      action: "CUSTOMER_EMAIL_EVENTS_UPDATED",
      entity_type: "system_settings",
      entity_id: "customer_email_events",
      metadata: {
        events: updatedEvents,
        timestamp: formatIstDateTime(new Date().toISOString()),
      },
    });

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Database error";
    return { success: false, error: msg };
  }
}

/**
 * Enqueues a customer email job into the transactional outbox.
 * Enforces strict deduplication via unique idempotency keys.
 * Immediately triggers an initial dispatch attempt.
 */
export async function enqueueCustomerEmail(params: {
  orderId?: string | null;
  customerId?: string | null;
  eventType: EmailEventType;
  recipient: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  metadata?: Record<string, unknown>;
  idempotencySuffix?: string;
}): Promise<EmailJobRecord | null> {
  const admin = createSupabaseAdminClient();
  const cleanRecipient = params.recipient.trim().toLowerCase();

  // Validate email format
  if (!cleanRecipient || !cleanRecipient.includes("@")) {
    console.warn(`[Email Outbox] Invalid recipient email rejected: "${params.recipient}"`);
    return null;
  }

  // Generate deterministic idempotency key
  const baseKey = params.orderId
    ? `${params.eventType}:${params.orderId}`
    : `${params.eventType}:${cleanRecipient}:${Date.now()}`;
  const idempotencyKey = params.idempotencySuffix ? `${baseKey}:${params.idempotencySuffix}` : baseKey;

  try {
    // 1. Check if job already exists with this idempotency key
    const { data: existing } = await admin
      .from("customer_email_outbox")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      if (existing.status === "SENT" || existing.status === "SIMULATED") {
        console.log(
          `[Email Outbox] Job with idempotency key "${idempotencyKey}" already delivered (${existing.status}). Skipping duplicate enqueue.`
        );
        return existing as EmailJobRecord;
      }
      // If previously failed or queued, attempt processing existing job
      await processEmailJob(existing.id);
      return existing as EmailJobRecord;
    }

    // 2. Persist new outbox job
    const { data: created, error: insertErr } = await admin
      .from("customer_email_outbox")
      .insert({
        idempotency_key: idempotencyKey,
        order_id: params.orderId || null,
        customer_id: params.customerId || null,
        event_type: params.eventType,
        recipient: cleanRecipient,
        subject: params.subject,
        body_text: params.bodyText,
        body_html: params.bodyHtml,
        status: "QUEUED",
        attempt_count: 0,
        max_attempts: 3,
        next_attempt_at: new Date().toISOString(),
        provider: "gmail_api",
        metadata: params.metadata || {},
      })
      .select("*")
      .single();

    if (insertErr || !created) {
      console.error("[Email Outbox] Failed to insert outbox job:", insertErr);
      return null;
    }

    // 3. Immediately attempt dispatch
    await processEmailJob(created.id);

    return created as EmailJobRecord;
  } catch (err) {
    console.error("[Email Outbox] Enqueue exception:", err);
    return null;
  }
}

/**
 * Processes an individual email outbox job.
 * Enforces Preview simulation and Production live sending gates.
 * Never throws fatal errors that could corrupt upstream business flows.
 */
export async function processEmailJob(
  jobId: string,
  options?: { forceLive?: boolean; actorUserId?: string }
): Promise<{ success: boolean; status: EmailJobStatus; error?: string | null }> {
  const admin = createSupabaseAdminClient();

  // 1. Fetch job record
  const { data: job, error: fetchErr } = await admin
    .from("customer_email_outbox")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (fetchErr || !job) {
    return { success: false, status: "FAILED", error: "Outbox job not found." };
  }

  // Idempotency: skip if already sent
  if (job.status === "SENT") {
    return { success: true, status: "SENT" };
  }

  // 2. Check operational settings
  const settings = await getCustomerEmailSettings();
  const isEventEnabled = job.event_type === "ADMIN_TEST" || settings.events[job.event_type as keyof typeof settings.events] !== false;

  if (!isEventEnabled) {
    await admin
      .from("customer_email_outbox")
      .update({
        status: "QUEUED",
        error_message: `Notification for event ${job.event_type} is currently disabled in email settings.`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return { success: false, status: "QUEUED", error: "Notification event disabled." };
  }

  // 3. Environment & Gate Evaluation
  const isVercelPreview =
    process.env.VERCEL_ENV === "preview" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
  const isProduction =
    process.env.VERCEL_ENV === "production" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "production";
  const isDev = !isProduction && (process.env.NODE_ENV !== "production" || isVercelPreview);

  // In Preview or Development: Simulate unless approved test recipient
  if (isDev) {
    const allowedTestEmail = process.env.ALLOWED_TEST_EMAIL?.trim()?.toLowerCase();
    const isApprovedTester =
      Boolean(allowedTestEmail) &&
      job.recipient.trim().toLowerCase() === allowedTestEmail;

    if (!isApprovedTester && !options?.forceLive) {
      // Mark as SIMULATED (dry-run)
      await admin
        .from("customer_email_outbox")
        .update({
          status: "SIMULATED",
          sent_at: new Date().toISOString(),
          provider: "gmail_api_preview_simulated",
          provider_message_id: `sim-job-${job.id.slice(0, 8)}-${Date.now()}`,
          error_message: null,
          attempt_count: job.attempt_count + 1,
          last_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      console.log(
        `[Email Outbox] Job ${job.id} (${job.event_type}) simulated for recipient "${job.recipient}". No real email sent.`
      );
      return { success: true, status: "SIMULATED" };
    }
  }

  // In Production: Must verify master live gate
  if (isProduction && !settings.isLiveEnabled && !options?.forceLive) {
    await admin
      .from("customer_email_outbox")
      .update({
        status: "QUEUED",
        error_message: "Live customer email delivery is currently disabled by administrator in system settings.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    console.log(
      `[Email Outbox] Job ${job.id} held in QUEUED state: Live customer email gate is disabled.`
    );
    return {
      success: false,
      status: "QUEUED",
      error: "Live customer email gate is disabled.",
    };
  }

  // 4. Mark job as SENDING
  await admin
    .from("customer_email_outbox")
    .update({
      status: "SENDING",
      last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  // 5. Transmit via Gmail API
  const deliveryResult = await sendEmailViaGmailApi({
    recipient: job.recipient,
    subject: job.subject,
    text: job.body_text,
    html: job.body_html,
    isStaffAuthorized: true,
    dispatchType: "CUSTOMER_TRANSACTIONAL",
  });

  const nowIso = new Date().toISOString();

  if (deliveryResult.status === "SENT") {
    await admin
      .from("customer_email_outbox")
      .update({
        status: "SENT",
        sent_at: nowIso,
        provider: deliveryResult.provider,
        provider_message_id: deliveryResult.providerMessageId,
        error_message: null,
        attempt_count: job.attempt_count + 1,
        last_attempt_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", job.id);

    console.log(`[Email Outbox] Job ${job.id} (${job.event_type}) sent successfully to ${job.recipient}. Message ID: ${deliveryResult.providerMessageId}`);
    return { success: true, status: "SENT" };
  }

  if (deliveryResult.status === "SIMULATED") {
    await admin
      .from("customer_email_outbox")
      .update({
        status: "SIMULATED",
        sent_at: nowIso,
        provider: deliveryResult.provider,
        provider_message_id: deliveryResult.providerMessageId,
        error_message: null,
        attempt_count: job.attempt_count + 1,
        last_attempt_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", job.id);

    return { success: true, status: "SIMULATED" };
  }

  // Delivery Failure handling with bounded retries & backoff
  const newAttemptCount = job.attempt_count + 1;
  const shouldRetry = newAttemptCount < job.max_attempts;

  // Backoff: 5 minutes * attemptCount
  const backoffMinutes = Math.min(60, newAttemptCount * 5);
  const nextAttempt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

  const newStatus: EmailJobStatus = shouldRetry ? "RETRY" : "FAILED";

  await admin
    .from("customer_email_outbox")
    .update({
      status: newStatus,
      attempt_count: newAttemptCount,
      next_attempt_at: nextAttempt,
      error_message: deliveryResult.error || "Gmail API delivery failure",
      last_attempt_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", job.id);

  console.error(
    `[Email Outbox] Job ${job.id} failed (attempt ${newAttemptCount}/${job.max_attempts}). New status: ${newStatus}. Error: ${deliveryResult.error}`
  );

  return { success: false, status: newStatus, error: deliveryResult.error };
}

/**
 * Manually retries a failed or retrying email outbox job.
 * Requires verified administrator authorization.
 */
export async function retryFailedEmailJob(
  jobId: string,
  actorUserId: string
): Promise<{ success: boolean; error?: string }> {
  const admin = createSupabaseAdminClient();

  const { data: job, error: fetchErr } = await admin
    .from("customer_email_outbox")
    .select("id, status, attempt_count")
    .eq("id", jobId)
    .maybeSingle();

  if (fetchErr || !job) {
    return { success: false, error: "Outbox job not found." };
  }

  if (job.status === "SENT") {
    return { success: false, error: "Job has already been delivered." };
  }

  // Reset job to QUEUED with next_attempt_at = now
  await admin
    .from("customer_email_outbox")
    .update({
      status: "QUEUED",
      next_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  // Immediately attempt delivery
  const result = await processEmailJob(job.id, { forceLive: true, actorUserId });

  // Record audit log
  await admin.from("audit_logs").insert({
    actor_user_id: actorUserId,
    action: "CUSTOMER_EMAIL_JOB_MANUAL_RETRY",
    entity_type: "customer_email_outbox",
    entity_id: job.id,
    metadata: {
      result_status: result.status,
      success: result.success,
      error: result.error || null,
      timestamp: formatIstDateTime(new Date().toISOString()),
    },
  });

  return { success: result.success, error: result.error || undefined };
}

/**
 * Retrieves aggregate delivery metrics for the administrator dashboard.
 */
export async function getCustomerEmailMetrics(): Promise<CustomerEmailMetrics> {
  const admin = createSupabaseAdminClient();

  const metrics: CustomerEmailMetrics = {
    totalSent: 0,
    totalQueued: 0,
    totalFailed: 0,
    totalRetrying: 0,
    totalSimulated: 0,
    lastSentAtIst: null,
  };

  try {
    const { data: rows, error } = await admin
      .from("customer_email_outbox")
      .select("status, sent_at");

    if (!error && rows) {
      let maxSentDate: Date | null = null;

      for (const r of rows) {
        if (r.status === "SENT") {
          metrics.totalSent++;
          if (r.sent_at) {
            const d = new Date(r.sent_at);
            if (!maxSentDate || d > maxSentDate) maxSentDate = d;
          }
        } else if (r.status === "QUEUED") {
          metrics.totalQueued++;
        } else if (r.status === "FAILED") {
          metrics.totalFailed++;
        } else if (r.status === "RETRY") {
          metrics.totalRetrying++;
        } else if (r.status === "SIMULATED") {
          metrics.totalSimulated++;
        }
      }

      if (maxSentDate) {
        metrics.lastSentAtIst = formatIstDateTime(maxSentDate.toISOString());
      }
    }
  } catch (err) {
    console.warn("[Email Outbox] Metrics calculation warning:", err);
  }

  return metrics;
}

/**
 * Retrieves recent email delivery logs for the administrator dashboard.
 * Masked recipient email addresses ensure PII privacy in administrative views.
 */
export async function getRecentCustomerEmailLogs(limit = 15): Promise<CustomerEmailLogItem[]> {
  const admin = createSupabaseAdminClient();

  try {
    const { data: rows, error } = await admin
      .from("customer_email_outbox")
      .select(`
        id,
        order_id,
        event_type,
        recipient,
        status,
        attempt_count,
        max_attempts,
        provider,
        provider_message_id,
        error_message,
        created_at,
        sent_at,
        orders(order_number)
      `)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !rows) return [];

    return rows.map((r) => {
      const order = Array.isArray(r.orders) ? r.orders[0] : r.orders;
      const cleanEmail = (r.recipient || "").trim();
      const masked = cleanEmail.replace(/^(.{2})(.*)(@.*)$/, "$1***$3");

      return {
        id: r.id,
        orderNumber: order?.order_number || null,
        orderId: r.order_id,
        eventType: r.event_type as EmailEventType,
        recipientMasked: masked,
        status: r.status as EmailJobStatus,
        attemptCount: r.attempt_count,
        maxAttempts: r.max_attempts,
        provider: r.provider,
        providerMessageId: r.provider_message_id,
        errorMessage: r.error_message,
        createdAtIst: formatIstDateTime(r.created_at),
        sentAtIst: r.sent_at ? formatIstDateTime(r.sent_at) : null,
      };
    });
  } catch (err) {
    console.warn("[Email Outbox] Log query warning:", err);
    return [];
  }
}

/**
 * Triggers an official Administrative Test Email for live production verification.
 * Only sends to the authorized admin's email or an explicitly provided target.
 */
export async function executeAdminCustomerTestEmail(
  actorUserId: string,
  targetRecipient: string
): Promise<{ success: boolean; message: string; jobId?: string; error?: string }> {
  const cleanRecipient = targetRecipient.trim().toLowerCase();
  if (!cleanRecipient || !cleanRecipient.includes("@")) {
    return { success: false, message: "Please enter a valid email address for the test." };
  }

  const nowIst = formatIstDateTime(new Date().toISOString());
  const subject = `[SSFI Lucky Draw] Production Customer Email Verification [${Date.now().toString(36)}]`;

  const text = [
    `SSFI LUCKY DRAW — PRODUCTION CUSTOMER EMAIL TEST`,
    `================================================`,
    `This test email confirms that the automated transactional customer email service`,
    `is communicating successfully via Google OAuth 2.0 and the Gmail REST API.`,
    ``,
    `Environment: ${process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown"}`,
    `Recipient: ${cleanRecipient}`,
    `Dispatched At (IST): ${nowIst}`,
    `Authorized Operator ID: ${actorUserId}`,
    ``,
    `Sender: ${getGmailApiConfig().senderAddress}`,
    ``,
    `All automated customer email events (Order Created, Payment Approved, Tickets Issued)`,
    `are verified and ready for live operations.`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; background-color: #f7f3f0; padding: 24px; color: #35110f;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #eadbcf; border-radius: 12px; padding: 28px;">
    <h2 style="color: #7c1619; margin-top: 0;">SSFI Lucky Draw &mdash; Production Email Verification</h2>
    <p style="font-size: 14px; line-height: 1.5;">This confirmation email verifies that the automated customer transactional email service is active and communicating via Google OAuth 2.0.</p>
    <table style="width: 100%; font-size: 13px; background: #fffaf7; border: 1px solid #f0e7df; border-radius: 8px; padding: 12px; margin: 16px 0;">
      <tr><td style="color: #705a54;">Environment:</td><td><strong>${process.env.VERCEL_ENV || process.env.NODE_ENV}</strong></td></tr>
      <tr><td style="color: #705a54;">Recipient:</td><td><code>${cleanRecipient}</code></td></tr>
      <tr><td style="color: #705a54;">Timestamp (IST):</td><td><strong>${nowIst}</strong></td></tr>
      <tr><td style="color: #705a54;">Sender:</td><td><code>${getGmailApiConfig().senderAddress}</code></td></tr>
    </table>
    <p style="font-size: 12px; color: #705a54; margin-bottom: 0;">Authorized Administrative Test &bull; SSFI Production Email Service.</p>
  </div>
</body>
</html>`;

  const job = await enqueueCustomerEmail({
    eventType: "ADMIN_TEST",
    recipient: cleanRecipient,
    subject,
    bodyText: text,
    bodyHtml: html,
    metadata: {
      actor_user_id: actorUserId,
      test_type: "admin_customer_email_verification",
    },
    idempotencySuffix: `test-${Date.now()}`,
  });

  if (!job) {
    return { success: false, message: "Failed to queue test email." };
  }

  // If in production and forceLive, ensure immediate send
  const processResult = await processEmailJob(job.id, { forceLive: true, actorUserId });

  return {
    success: processResult.success,
    message: processResult.success
      ? `Test email dispatched successfully to ${cleanRecipient} (Status: ${processResult.status}).`
      : `Test email attempt failed: ${processResult.error}`,
    jobId: job.id,
    error: processResult.error || undefined,
  };
}

// ============================================================================
// CONVENIENCE WORKFLOW EVENT ENQUEUE HELPERS
// ============================================================================

/**
 * Automatically enqueues an Order Created (Order Received) email to the customer.
 */
export async function enqueueOrderCreatedNotification(orderId: string): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { data: order, error } = await admin
    .from("orders")
    .select(`
      id,
      order_number,
      total_amount_paise,
      created_at,
      status,
      campaigns(name),
      customers(id, full_name, email, phone, whatsapp_number),
      sellers(display_name, seller_code),
      order_items(quantity)
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) {
    console.warn("[Email Outbox] Order lookup failed for ORDER_CREATED notification:", error);
    return;
  }

  const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
  const seller = Array.isArray(order.sellers) ? order.sellers[0] : order.sellers;
  const campaign = Array.isArray(order.campaigns) ? order.campaigns[0] : order.campaigns;
  const items = (order.order_items as unknown as Array<{ quantity: number }>) || [];
  const ticketQuantity = items.reduce((sum, item) => sum + (item.quantity || 0), 0) || 1;

  const recipient = customer?.email?.trim();
  if (!recipient) {
    // Customer has no email address provided
    return;
  }

  const orderAccessUrl = getCustomerOrderUrl(order.id);
  const totalAmountInr = (order.total_amount_paise || 10000) / 100;
  const createdAtIst = formatIstDateTime(order.created_at || new Date().toISOString());

  const templatePayload = {
    orderNumber: order.order_number,
    orderId: order.id,
    customerName: customer?.full_name || "Valued Supporter",
    ticketQuantity,
    totalAmountInr,
    paymentMethod: "Manual UPI",
    paymentInstructions: {
      upiId: process.env.NEXT_PUBLIC_SSFI_UPI_ID || "6909251270@ptaxis",
      accountName: process.env.NEXT_PUBLIC_SSFI_UPI_DISPLAY_NAME || "HLAWN THA DAWT",
      instructions: "Transfer exact amount to the official SSFI account and submit your 12-digit UTR on your order page.",
    },
    paymentStatus: order.status || "PENDING",
    orderAccessUrl,
    campaignName: campaign?.name || "SSFI Lucky Draw",
    createdAtIst,
    supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "Senthangstudents@gmail.com",
    supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE || undefined,
    sellerAttribution: seller ? `${seller.display_name} (${seller.seller_code})` : null,
  };

  const { subject, html, text } = renderEmailOrderCreatedMessage(templatePayload);

  await enqueueCustomerEmail({
    orderId: order.id,
    customerId: customer?.id || null,
    eventType: "ORDER_CREATED",
    recipient,
    subject,
    bodyText: text,
    bodyHtml: html,
    metadata: {
      order_number: order.order_number,
      ticket_quantity: ticketQuantity,
      total_amount_inr: totalAmountInr,
    },
  });
}

/**
 * Automatically enqueues a Payment Approved (Confirmation) email to the customer.
 */
export async function enqueuePaymentApprovedNotification(
  orderId: string,
  actorUserId?: string
): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { data: order, error } = await admin
    .from("orders")
    .select(`
      id,
      order_number,
      total_amount_paise,
      campaigns(name),
      customers(id, full_name, email),
      sellers(display_name, seller_code),
      payments(amount_paise, verified_at, payment_method),
      order_items(quantity)
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) {
    console.warn("[Email Outbox] Order lookup failed for PAYMENT_APPROVED notification:", error);
    return;
  }

  const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
  const seller = Array.isArray(order.sellers) ? order.sellers[0] : order.sellers;
  const campaign = Array.isArray(order.campaigns) ? order.campaigns[0] : order.campaigns;
  const payment = Array.isArray(order.payments) ? order.payments[0] : order.payments;
  const items = (order.order_items as unknown as Array<{ quantity: number }>) || [];
  const ticketQuantity = items.reduce((sum, item) => sum + (item.quantity || 0), 0) || 1;

  const recipient = customer?.email?.trim();
  if (!recipient) return;

  const orderAccessUrl = getCustomerOrderUrl(order.id);
  const confirmedAmountInr = ((payment?.amount_paise ?? order.total_amount_paise) || 10000) / 100;
  const confirmedAtIst = formatIstDateTime(payment?.verified_at || new Date().toISOString());

  const templatePayload = {
    orderNumber: order.order_number,
    orderId: order.id,
    customerName: customer?.full_name || "Valued Supporter",
    ticketQuantity,
    confirmedAmountInr,
    paymentMethod: payment?.payment_method || "Manual UPI",
    paymentConfirmedAtIst: confirmedAtIst,
    orderAccessUrl,
    campaignName: campaign?.name || "SSFI Lucky Draw",
    supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "Senthangstudents@gmail.com",
    supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE || undefined,
    sellerAttribution: seller ? `${seller.display_name} (${seller.seller_code})` : null,
  };

  const { subject, html, text } = renderEmailPaymentApprovedMessage(templatePayload);

  await enqueueCustomerEmail({
    orderId: order.id,
    customerId: customer?.id || null,
    eventType: "PAYMENT_APPROVED",
    recipient,
    subject,
    bodyText: text,
    bodyHtml: html,
    metadata: {
      order_number: order.order_number,
      confirmed_amount_inr: confirmedAmountInr,
      verified_by: actorUserId || null,
    },
  });
}

/**
 * Automatically enqueues a Tickets Issued (Delivery) email to the customer.
 */
export async function enqueueTicketsIssuedNotification(
  orderId: string,
  actorUserId?: string
): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { data: order, error } = await admin
    .from("orders")
    .select(`
      id,
      order_number,
      status,
      total_amount_paise,
      campaigns(name),
      customers(id, full_name, email, phone, whatsapp_number),
      sellers(display_name, seller_code),
      payments(amount_paise, verified_at),
      tickets(id, ticket_number, status, issued_at)
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) {
    console.warn("[Email Outbox] Order lookup failed for TICKETS_ISSUED notification:", error);
    return;
  }

  const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
  const seller = Array.isArray(order.sellers) ? order.sellers[0] : order.sellers;
  const campaign = Array.isArray(order.campaigns) ? order.campaigns[0] : order.campaigns;
  const payment = Array.isArray(order.payments) ? order.payments[0] : order.payments;

  // Strict guard: Never send ticket delivery before payment approval
  const isPaymentApproved = Boolean(payment?.verified_at) || order.status === "TICKETS_ISSUED";
  if (!isPaymentApproved) {
    console.warn(
      `[Email Outbox] Strict Guard: Blocking TICKETS_ISSUED notification. Order ${order.order_number} has not been approved (Status: ${order.status}).`
    );
    return;
  }
  const rawTickets = (order.tickets as unknown as Array<{ id: string; ticket_number: string; status: string; issued_at: string }>) || [];

  const activeTickets = rawTickets.filter((t) => t.status === "ISSUED" || t.status === "ACTIVE");
  if (activeTickets.length === 0) {
    console.warn("[Email Outbox] Skipping TICKETS_ISSUED: No active issued tickets found for order:", orderId);
    return;
  }

  const recipient = customer?.email?.trim();
  if (!recipient) return;

  const ticketAccessUrl = getCustomerOrderUrl(order.id);
  const issuedAtIst = formatIstDateTime(
    payment?.verified_at || activeTickets[0]?.issued_at || new Date().toISOString()
  );

  const deliveryPayload: DeliveryPayload = {
    orderId: order.id,
    orderNumber: order.order_number,
    customerName: customer?.full_name || "Valued Supporter",
    whatsappNumber: customer?.whatsapp_number || customer?.phone || "",
    email: recipient,
    ticketNumbers: activeTickets.map((t) => t.ticket_number),
    amountInr: (payment?.amount_paise ?? order.total_amount_paise) / 100,
    campaignName: campaign?.name || "SSFI Lucky Draw",
    issuedAtIst,
    ticketAccessUrl,
    sellerAttribution: seller ? `${seller.display_name} (${seller.seller_code})` : null,
    supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE || undefined,
    supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "Senthangstudents@gmail.com",
  };

  const { subject, html, text } = renderEmailTicketMessage(deliveryPayload);

  await enqueueCustomerEmail({
    orderId: order.id,
    customerId: customer?.id || null,
    eventType: "TICKETS_ISSUED",
    recipient,
    subject,
    bodyText: text,
    bodyHtml: html,
    metadata: {
      order_number: order.order_number,
      ticket_count: activeTickets.length,
      ticket_numbers: activeTickets.map((t) => t.ticket_number),
      actor_user_id: actorUserId || null,
    },
  });
}

