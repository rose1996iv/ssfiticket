import crypto from "node:crypto";
import { formatIstDateTime } from "../../date/timezone.ts";
import type { DeliveryPayload, DeliveryResult } from "../types.ts";

export type AppsScriptConfig = {
  webAppUrl?: string;
  sharedSecret?: string;
  senderName: string;
  replyTo: string;
};

export type AppsScriptHealth = {
  isConfigured: boolean;
  senderName: string;
  replyTo: string;
  status: "HEALTHY" | "UNCONFIGURED" | "UNAUTHORIZED" | "QUOTA_EXCEEDED" | "ERROR";
  message: string;
  remainingDailyQuota?: number;
  checkedAtIst: string;
};

export type AppsScriptSendOptions = {
  recipient: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey?: string;
  eventType?: "ORDER_CREATED" | "PAYMENT_APPROVED" | "TICKETS_ISSUED" | "WINNER_ANNOUNCED" | "ADMIN_TEST";
  orderNumber?: string | null;
  ticketNumbers?: string[];
  payload?: DeliveryPayload;
  isStaffAuthorized?: boolean;
  dispatchType?: "PREVIEW_DIAGNOSTIC" | "CUSTOMER_TRANSACTIONAL";
};

/**
 * Reads server-only Google Apps Script configuration.
 * Strictly forbids NEXT_PUBLIC_ secret or endpoint variables.
 */
export function getAppsScriptConfig(): AppsScriptConfig {
  return {
    webAppUrl: process.env.APPS_SCRIPT_WEB_APP_URL?.trim(),
    sharedSecret: process.env.APPS_SCRIPT_SHARED_SECRET?.trim(),
    senderName:
      process.env.APPS_SCRIPT_SENDER_NAME?.trim() ||
      "Senthang Students Fellowship India (SSFI)",
    replyTo:
      process.env.APPS_SCRIPT_REPLY_TO?.trim() ||
      process.env.GMAIL_SENDER_ADDRESS?.trim() ||
      process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() ||
      "Senthangstudents@gmail.com",
  };
}

/**
 * Checks whether the Google Apps Script Web App provider is configured on the server.
 */
export function isAppsScriptConfigured(): boolean {
  const cfg = getAppsScriptConfig();
  return Boolean(
    cfg.webAppUrl &&
      cfg.webAppUrl.startsWith("https://script.google.com/") &&
      cfg.sharedSecret &&
      cfg.sharedSecret.length >= 16
  );
}

/**
 * Computes HMAC-SHA256 signature for authenticating Next.js -> Apps Script requests.
 */
export function computeAppsScriptSignature(
  timestamp: number,
  idempotencyKey: string,
  recipient: string,
  sharedSecret: string
): string {
  const signingInput = `${timestamp}.${idempotencyKey}.${recipient.trim().toLowerCase()}`;
  return crypto
    .createHmac("sha256", sharedSecret)
    .update(signingInput, "utf-8")
    .digest("hex");
}

/**
 * Sanitizes errors from Google Apps Script to ensure secrets or deployment tokens are never exposed.
 */
export function sanitizeAppsScriptError(rawError: string): string {
  return rawError
    .replace(/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/gi, "https://script.google.com/macros/s/[REDACTED]/exec")
    .replace(/https:\/\/script\.googleusercontent\.com\/macros\/echo\?[^\s"']+/gi, "https://script.googleusercontent.com/macros/echo?[REDACTED]");
}

/**
 * Resolves the approved Preview test recipient from environment configuration.
 */
export function getApprovedPreviewRecipient(): string | undefined {
  const candidate =
    process.env.ALLOWED_TEST_EMAIL?.trim() ||
    process.env.PREVIEW_ALLOWED_RECIPIENT?.trim() ||
    process.env.APPS_SCRIPT_PREVIEW_ALLOWED_RECIPIENT?.trim() ||
    process.env.GMAIL_PREVIEW_ALLOWED_RECIPIENT?.trim();
  return candidate ? candidate.toLowerCase() : undefined;
}

/**
 * Verifies Google Apps Script Web App connectivity, shared secret authentication, and remaining daily MailApp quota.
 */
export async function checkAppsScriptHealth(): Promise<AppsScriptHealth> {
  const cfg = getAppsScriptConfig();
  const checkedAtIst = formatIstDateTime(new Date().toISOString());

  if (!cfg.webAppUrl || !cfg.sharedSecret) {
    return {
      isConfigured: false,
      senderName: cfg.senderName,
      replyTo: cfg.replyTo,
      status: "UNCONFIGURED",
      message:
        "Google Apps Script Web App credentials (APPS_SCRIPT_WEB_APP_URL, APPS_SCRIPT_SHARED_SECRET) are not configured on the server.",
      checkedAtIst,
    };
  }

  if (!cfg.webAppUrl.startsWith("https://script.google.com/")) {
    return {
      isConfigured: false,
      senderName: cfg.senderName,
      replyTo: cfg.replyTo,
      status: "ERROR",
      message: "APPS_SCRIPT_WEB_APP_URL must begin with https://script.google.com/.",
      checkedAtIst,
    };
  }

  try {
    const timestamp = Date.now();
    const idempotencyKey = `health-check-${timestamp}`;
    const recipient = cfg.replyTo.toLowerCase();
    const signature = computeAppsScriptSignature(
      timestamp,
      idempotencyKey,
      recipient,
      cfg.sharedSecret
    );

    const res = await fetch(cfg.webAppUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      redirect: "follow",
      body: JSON.stringify({
        action: "HEALTH_CHECK",
        idempotencyKey,
        recipient,
        auth: {
          secret: cfg.sharedSecret,
          timestamp,
          signature,
        },
      }),
    });

    if (!res.ok) {
      return {
        isConfigured: true,
        senderName: cfg.senderName,
        replyTo: cfg.replyTo,
        status: "ERROR",
        message: `Google Apps Script Web App returned HTTP ${res.status}. Verify Web App deployment permissions ('Anyone').`,
        checkedAtIst,
      };
    }

    const data = (await res.json()) as {
      ok?: boolean;
      status?: string;
      error?: string;
      senderName?: string;
      replyTo?: string;
      remainingDailyQuota?: number;
    };

    if (!data.ok) {
      const status =
        data.status === "UNAUTHORIZED" || data.status === "INVALID_SIGNATURE"
          ? "UNAUTHORIZED"
          : data.status === "QUOTA_EXCEEDED"
          ? "QUOTA_EXCEEDED"
          : "ERROR";
      return {
        isConfigured: true,
        senderName: cfg.senderName,
        replyTo: cfg.replyTo,
        status,
        message: sanitizeAppsScriptError(data.error || "Apps Script health check failed."),
        checkedAtIst,
      };
    }

    return {
      isConfigured: true,
      senderName: data.senderName || cfg.senderName,
      replyTo: data.replyTo || cfg.replyTo,
      status: "HEALTHY",
      message: `Google Apps Script Web App verified. Remaining daily email quota: ${
        data.remainingDailyQuota ?? "unknown"
      }.`,
      remainingDailyQuota: data.remainingDailyQuota,
      checkedAtIst,
    };
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : "Apps Script network error";
    return {
      isConfigured: true,
      senderName: cfg.senderName,
      replyTo: cfg.replyTo,
      status: "ERROR",
      message: sanitizeAppsScriptError(rawMsg),
      checkedAtIst,
    };
  }
}

/**
 * Dispatches transactional customer email via the Google Apps Script Web App (`doPost`).
 * Enforces strict Preview recipient allowlisting and HMAC-SHA256 request signing.
 */
export async function sendEmailViaAppsScript(
  options: AppsScriptSendOptions
): Promise<DeliveryResult> {
  const cfg = getAppsScriptConfig();
  const isConfigured = isAppsScriptConfigured();
  const cleanRecipient = options.recipient.trim().toLowerCase();

  const isVercelPreview =
    process.env.VERCEL_ENV === "preview" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
  const isProduction =
    process.env.VERCEL_ENV === "production" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "production";
  const isDev = !isProduction && (process.env.NODE_ENV !== "production" || isVercelPreview);
  const isDryRun =
    process.env.APPS_SCRIPT_DRY_RUN === "true" ||
    process.env.GMAIL_DRY_RUN === "true" ||
    process.env.RESEND_DRY_RUN === "true";

  const approvedPreviewRecipient = getApprovedPreviewRecipient();

  // 1. PREVIEW / DEVELOPMENT SAFETY GATE
  if (isDev || isDryRun) {
    const isApprovedTester =
      Boolean(approvedPreviewRecipient) &&
      cleanRecipient === approvedPreviewRecipient &&
      !isDryRun;

    if (!isApprovedTester) {
      console.log(
        `[Apps Script Email Gate] Preview/Dev mode: customer email to "${cleanRecipient}" was safely simulated. Real customer was not contacted.`
      );
      return {
        channel: "EMAIL",
        status: "SIMULATED",
        provider: "google_apps_script_preview_simulated",
        recipient: cleanRecipient,
        providerMessageId: `sim-gas-${options.orderNumber || options.payload?.orderNumber || "job"}-${Date.now()}`,
        renderedContent: options.html,
        subject: options.subject,
        error: null,
      };
    }

    console.log(
      `[Apps Script Email Gate] Preview/Dev live delivery permitted for approved test recipient: ${cleanRecipient}`
    );
  }

  // 2. CONFIGURATION CHECK
  if (!isConfigured || !cfg.webAppUrl || !cfg.sharedSecret) {
    return {
      channel: "EMAIL",
      status: "FAILED",
      provider: "google_apps_script",
      recipient: cleanRecipient,
      providerMessageId: null,
      renderedContent: options.html,
      subject: options.subject,
      error:
        "Google Apps Script Web App is not configured (missing APPS_SCRIPT_WEB_APP_URL or APPS_SCRIPT_SHARED_SECRET).",
    };
  }

  const timestamp = Date.now();
  const eventType = options.eventType || "TICKETS_ISSUED";
  const orderNumber = options.orderNumber || options.payload?.orderNumber || null;
  const ticketNumbers = options.ticketNumbers || options.payload?.ticketNumbers || [];
  const idempotencyKey =
    options.idempotencyKey ||
    (options.payload?.orderId ? `${eventType}:${options.payload.orderId}` : `${eventType}:${cleanRecipient}:${timestamp}`);

  const signature = computeAppsScriptSignature(
    timestamp,
    idempotencyKey,
    cleanRecipient,
    cfg.sharedSecret
  );

  try {
    const res = await fetch(cfg.webAppUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      redirect: "follow",
      body: JSON.stringify({
        action: "SEND_TICKET_EMAIL",
        eventType,
        idempotencyKey,
        environment: isProduction ? "production" : "preview",
        allowedPreviewRecipient: approvedPreviewRecipient || null,
        recipient: cleanRecipient,
        subject: options.subject,
        textBody: options.text,
        htmlBody: options.html,
        orderNumber,
        ticketNumbers,
        customerName: options.payload?.customerName || null,
        ticketAccessUrl: options.payload?.ticketAccessUrl || null,
        senderName: cfg.senderName,
        replyTo: cfg.replyTo,
        auth: {
          secret: cfg.sharedSecret,
          timestamp,
          signature,
        },
      }),
    });

    if (!res.ok) {
      const rawText = await res.text().catch(() => `HTTP ${res.status}`);
      const sanitized = sanitizeAppsScriptError(rawText.slice(0, 240));
      return {
        channel: "EMAIL",
        status: "FAILED",
        provider: "google_apps_script",
        recipient: cleanRecipient,
        providerMessageId: null,
        renderedContent: options.html,
        subject: options.subject,
        error: `Google Apps Script HTTP ${res.status}: ${sanitized}`,
      };
    }

    const data = (await res.json()) as {
      ok?: boolean;
      status?: string;
      messageId?: string;
      error?: string;
    };

    if (!data.ok || data.status !== "SENT") {
      const errDetail = sanitizeAppsScriptError(
        data.error || `Apps Script returned status ${data.status || "UNKNOWN"}`
      );
      return {
        channel: "EMAIL",
        status: "FAILED",
        provider: "google_apps_script",
        recipient: cleanRecipient,
        providerMessageId: null,
        renderedContent: options.html,
        subject: options.subject,
        error: errDetail,
      };
    }

    return {
      channel: "EMAIL",
      status: "SENT",
      provider: "google_apps_script",
      recipient: cleanRecipient,
      providerMessageId: data.messageId || `gas-${Date.now()}`,
      renderedContent: options.html,
      subject: options.subject,
      error: null,
    };
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : "Google Apps Script network failure";
    return {
      channel: "EMAIL",
      status: "FAILED",
      provider: "google_apps_script",
      recipient: cleanRecipient,
      providerMessageId: null,
      renderedContent: options.html,
      subject: options.subject,
      error: sanitizeAppsScriptError(rawMsg),
    };
  }
}
