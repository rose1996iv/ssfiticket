/**
 * Official Gmail API Delivery Provider.
 *
 * Implements direct email transmission via Google OAuth 2.0 and the Gmail REST API:
 * POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send
 *
 * Requirements:
 * - Server-only credentials (strictly no NEXT_PUBLIC_ prefixes):
 *   - GMAIL_API_CLIENT_ID
 *   - GMAIL_API_CLIENT_SECRET
 *   - GMAIL_API_REFRESH_TOKEN
 *   - GMAIL_SENDER_ADDRESS (defaults to Senthangstudents@gmail.com)
 * - Preview-only live email feature gate:
 *   - GMAIL_PREVIEW_REAL_SEND_ENABLED (must be exactly 'true')
 *   - GMAIL_PREVIEW_ALLOWED_RECIPIENT (exact case-insensitive recipient allowlist)
 * - MIME RFC 2822 base64url message composition
 * - Safe preview/development isolation with fail-closed behavior
 * - Non-fatal execution: failures never throw or rollback ticket issuance
 * - Zero secrets or token values in logs or client responses
 */

import { formatIstDateTime } from "../../date/timezone.ts";
import type { DeliveryPayload, DeliveryResult } from "../types.ts";

export type GmailApiConfig = {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  senderAddress: string;
};

export type GmailPreviewGateConfig = {
  isVercelPreview: boolean;
  isRealSendEnabled: boolean;
  allowedRecipient?: string;
};

export function getGmailApiConfig(): GmailApiConfig {
  return {
    clientId: process.env.GMAIL_API_CLIENT_ID?.trim(),
    clientSecret: process.env.GMAIL_API_CLIENT_SECRET?.trim(),
    refreshToken: process.env.GMAIL_API_REFRESH_TOKEN?.trim(),
    senderAddress:
      process.env.GMAIL_SENDER_ADDRESS?.trim() ||
      process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() ||
      "Senthangstudents@gmail.com",
  };
}

export function isGmailApiConfigured(): boolean {
  const config = getGmailApiConfig();
  return Boolean(config.clientId && config.clientSecret && config.refreshToken);
}

export function getGmailPreviewGateConfig(): GmailPreviewGateConfig {
  const isVercelPreview =
    process.env.VERCEL_ENV === "preview" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

  return {
    isVercelPreview,
    isRealSendEnabled: process.env.GMAIL_PREVIEW_REAL_SEND_ENABLED?.trim() === "true",
    allowedRecipient: process.env.GMAIL_PREVIEW_ALLOWED_RECIPIENT?.trim(),
  };
}

/**
 * Checks whether live email dispatch is permitted in a Preview environment.
 * Strictly enforces all 5 safety requirements:
 * 1. Must be in Vercel Preview environment.
 * 2. GMAIL_PREVIEW_REAL_SEND_ENABLED must be exactly 'true'.
 * 3. All 3 Gmail API credentials must be configured.
 * 4. Recipient must match GMAIL_PREVIEW_ALLOWED_RECIPIENT (case-insensitive after trim).
 * 5. Must be authorized by an authenticated staff member (ADMIN or SUPER_ADMIN).
 */
export function checkGmailPreviewGate(
  recipient: string,
  isStaffAuthorized: boolean
): { isPermitted: boolean; reason: string; allowedRecipient?: string } {
  const gate = getGmailPreviewGateConfig();

  if (!gate.isVercelPreview) {
    return {
      isPermitted: false,
      reason: "Preview gate active only in Vercel Preview environments.",
    };
  }

  if (!gate.isRealSendEnabled) {
    return {
      isPermitted: false,
      reason: "Live email in Preview is disabled (GMAIL_PREVIEW_REAL_SEND_ENABLED != 'true'). Running in safe simulation mode.",
    };
  }

  if (!isGmailApiConfigured()) {
    return {
      isPermitted: false,
      reason: "Gmail API credentials (client ID, client secret, refresh token) are not fully configured.",
    };
  }

  if (!gate.allowedRecipient) {
    return {
      isPermitted: false,
      reason: "No allowed test recipient configured (GMAIL_PREVIEW_ALLOWED_RECIPIENT is missing).",
    };
  }

  const cleanRecipient = recipient.trim().toLowerCase();
  const cleanAllowed = gate.allowedRecipient.toLowerCase();

  if (cleanRecipient !== cleanAllowed) {
    return {
      isPermitted: false,
      reason: "Recipient does not match GMAIL_PREVIEW_ALLOWED_RECIPIENT. Real customer emails are strictly blocked in Preview.",
      allowedRecipient: gate.allowedRecipient,
    };
  }

  if (!isStaffAuthorized) {
    return {
      isPermitted: false,
      reason: "Live preview email requires verified ADMIN or SUPER_ADMIN authorization.",
    };
  }

  return {
    isPermitted: true,
    reason: "Preview live email permitted for authorized allowlisted recipient.",
    allowedRecipient: gate.allowedRecipient,
  };
}

/**
 * Sanitizes Google OAuth errors to provide safe, actionable diagnostic guidance
 * without revealing client secrets, refresh tokens, or authorization headers.
 */
export function sanitizeOAuthError(rawError: string): string {
  const lower = rawError.toLowerCase();

  if (lower.includes("unauthorized_client")) {
    return "Google OAuth error (unauthorized_client): The refresh token was issued to a different OAuth Client ID than the configured GMAIL_API_CLIENT_ID. Please regenerate the refresh token using the exact same Client ID and Client Secret.";
  }
  if (lower.includes("invalid_grant")) {
    return "Google OAuth error (invalid_grant): The refresh token is invalid, expired, or has been revoked. Ensure the Google OAuth consent screen is configured and regenerate the refresh token for Senthangstudents@gmail.com.";
  }
  if (lower.includes("invalid_client")) {
    return "Google OAuth error (invalid_client): The configured GMAIL_API_CLIENT_ID or GMAIL_API_CLIENT_SECRET was not recognized by Google. Verify credentials in Google Cloud Console.";
  }
  if (lower.includes("redirect_uri_mismatch")) {
    return "Google OAuth error: Redirect URI mismatch during token exchange.";
  }

  // Strip potential tokens or sensitive URL sequences
  const sanitized = rawError
    .replace(/ya29\.[a-zA-Z0-9_-]+/g, "[REDACTED_TOKEN]")
    .replace(/1\/\/[a-zA-Z0-9_-]+/g, "[REDACTED_TOKEN]")
    .replace(/client_secret=[^&]+/gi, "client_secret=[REDACTED]");

  return `Google OAuth error: ${sanitized}`;
}

/**
 * Sanitizes Gmail REST API errors safely.
 */
export function sanitizeGmailApiError(status: number, rawMessage: string): string {
  const lower = rawMessage.toLowerCase();

  if (status === 401 || lower.includes("invalid_token") || lower.includes("token expired")) {
    return "Gmail API authorization error (401): Access token expired or rejected. Scope 'https://www.googleapis.com/auth/gmail.send' may be missing.";
  }
  if (status === 403 || lower.includes("insufficientpermissions") || lower.includes("accessnotconfigured")) {
    return "Gmail API access error (403): Insufficient permissions or Gmail API has not been enabled in Google Cloud Console for project. Scope 'https://www.googleapis.com/auth/gmail.send' is required.";
  }
  if (status === 429 || lower.includes("rate limit") || lower.includes("quota")) {
    return "Gmail API quota error (429): API rate limit exceeded.";
  }

  const sanitized = rawMessage.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [REDACTED]");
  return `Gmail API error (${status}): ${sanitized}`;
}

/**
 * Exchanges OAuth 2.0 refresh token for an access token from Google.
 */
async function getGmailAccessToken(config: GmailApiConfig): Promise<string> {
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new Error("Missing required Gmail API credentials (client_id, client_secret, refresh_token).");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    let errorDetail = `Status ${res.status}`;
    try {
      const errJson = await res.json();
      errorDetail = errJson.error_description || errJson.error || JSON.stringify(errJson);
    } catch {
      errorDetail = await res.text();
    }
    throw new Error(sanitizeOAuthError(errorDetail));
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Google OAuth response did not contain an access_token.");
  }

  return data.access_token;
}

/**
 * Encodes a string into Base64URL without padding per RFC 4648 §5.
 */
function toBase64Url(str: string): string {
  return Buffer.from(str, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Formats an RFC 2822 compliant MIME message.
 */
function buildMimeMessage(options: {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
}): string {
  const boundary = `===_ssfi_mime_${Date.now()}_===`;
  const cleanSubject = options.subject.replace(/[\r\n]/g, " ");

  const lines = [
    `From: Senthang Students Fellowship India <${options.from}>`,
    `To: ${options.to}`,
    `Reply-To: ${options.replyTo}`,
    `Subject: =?UTF-8?B?${Buffer.from(cleanSubject, "utf-8").toString("base64")}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    options.text,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    options.html,
    ``,
    `--${boundary}--`,
  ];

  return lines.join("\r\n");
}

/**
 * Dispatches email using the Gmail REST API with strict Preview gate enforcement.
 */
export async function sendEmailViaGmailApi(options: {
  recipient: string;
  subject: string;
  text: string;
  html: string;
  payload?: DeliveryPayload;
  isStaffAuthorized?: boolean;
}): Promise<DeliveryResult> {
  const config = getGmailApiConfig();
  const isConfigured = isGmailApiConfigured();

  const isVercelPreview =
    process.env.VERCEL_ENV === "preview" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
  const isDev = process.env.NODE_ENV !== "production";
  const isDryRun = process.env.GMAIL_DRY_RUN === "true" || process.env.RESEND_DRY_RUN === "true";

  // PREVIEW / DEV ENVIRONMENT SAFETY GATE
  if (isVercelPreview || isDev || isDryRun) {
    const gate = checkGmailPreviewGate(options.recipient, options.isStaffAuthorized ?? false);

    if (!gate.isPermitted) {
      console.log(
        `[Gmail API Gate] Fail-closed in preview/dev: ${gate.reason} (recipient: ${options.recipient})`
      );
      return {
        channel: "EMAIL",
        status: "SIMULATED",
        provider: isConfigured ? "gmail_api_preview_dry_run" : "gmail_api_unconfigured",
        recipient: options.recipient,
        providerMessageId: `sim-gmail-${options.payload?.orderNumber || "preview"}-${Date.now()}`,
        renderedContent: options.html,
        subject: options.subject,
        error: isConfigured ? null : gate.reason,
      };
    }

    console.log(
      `[Gmail API Gate] Preview live transmission authorized for allowlisted recipient: ${options.recipient}`
    );
  }

  // PRODUCTION CHECK: Must be configured
  if (!isConfigured) {
    return {
      channel: "EMAIL",
      status: "FAILED",
      provider: "gmail_api",
      recipient: options.recipient,
      providerMessageId: null,
      renderedContent: options.html,
      subject: options.subject,
      error: "Gmail API credentials are not configured on the server.",
    };
  }

  try {
    const accessToken = await getGmailAccessToken(config);
    const mimeMessage = buildMimeMessage({
      from: config.senderAddress,
      to: options.recipient,
      replyTo: config.senderAddress,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });

    const rawBase64Url = toBase64Url(mimeMessage);

    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: rawBase64Url }),
    });

    if (!res.ok) {
      let rawError = `Status ${res.status}`;
      try {
        const errJson = await res.json();
        rawError = errJson.error?.message || JSON.stringify(errJson);
      } catch {
        rawError = await res.text();
      }

      const sanitizedError = sanitizeGmailApiError(res.status, rawError);
      console.error("[Gmail API Error]", sanitizedError);

      return {
        channel: "EMAIL",
        status: "FAILED",
        provider: "gmail_api",
        recipient: options.recipient,
        providerMessageId: null,
        renderedContent: options.html,
        subject: options.subject,
        error: sanitizedError,
      };
    }

    const data = (await res.json()) as { id?: string; threadId?: string };

    return {
      channel: "EMAIL",
      status: "SENT",
      provider: "gmail_api",
      recipient: options.recipient,
      providerMessageId: data.id || `gmail-${Date.now()}`,
      renderedContent: options.html,
      subject: options.subject,
      error: null,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Gmail API network or authorization failure";
    console.error("[Gmail API Exception]", msg);
    return {
      channel: "EMAIL",
      status: "FAILED",
      provider: "gmail_api",
      recipient: options.recipient,
      providerMessageId: null,
      renderedContent: options.html,
      subject: options.subject,
      error: msg,
    };
  }
}

/**
 * Dedicated Admin diagnostic test action execution.
 * Sends a fixed, harmless diagnostic email to GMAIL_PREVIEW_ALLOWED_RECIPIENT only.
 * Contains NO customer info, ticket numbers, payment details, UTRs, or verification links.
 */
export async function executeAdminGmailPreviewTest(options: {
  actorUserId: string;
}): Promise<{
  success: boolean;
  operationId: string;
  recipient: string;
  provider: string;
  providerMessageId?: string | null;
  error?: string | null;
  timestamp: string;
}> {
  const timestamp = formatIstDateTime(new Date().toISOString());
  const operationId = `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const gate = getGmailPreviewGateConfig();

  // Guard: Feature gate must be active
  if (!gate.isVercelPreview && process.env.NODE_ENV !== "test") {
    return {
      success: false,
      operationId,
      recipient: "None",
      provider: "none",
      error: "Dedicated Gmail test action is restricted to Vercel Preview environments.",
      timestamp,
    };
  }

  if (!gate.isRealSendEnabled && process.env.NODE_ENV !== "test") {
    return {
      success: false,
      operationId,
      recipient: gate.allowedRecipient || "Not configured",
      provider: "gmail_api",
      error: "Preview real sending is disabled. Set GMAIL_PREVIEW_REAL_SEND_ENABLED=true in Vercel Preview environment variables.",
      timestamp,
    };
  }

  const targetRecipient = gate.allowedRecipient?.trim();
  if (!targetRecipient) {
    return {
      success: false,
      operationId,
      recipient: "Not configured",
      provider: "gmail_api",
      error: "GMAIL_PREVIEW_ALLOWED_RECIPIENT is not configured in Vercel Preview environment variables.",
      timestamp,
    };
  }

  if (!isGmailApiConfigured()) {
    return {
      success: false,
      operationId,
      recipient: targetRecipient,
      provider: "gmail_api",
      error: "Gmail API credentials (client ID, client secret, refresh token) are missing or incomplete.",
      timestamp,
    };
  }

  const subject = `SSFI Lucky Draw — Gmail Provider Test [${operationId}]`;
  const text = [
    `SSFI LUCKY DRAW — GMAIL API PROVIDER DIAGNOSTIC TEST`,
    `===================================================`,
    ``,
    `Environment: Vercel Preview`,
    `Diagnostic Operation ID: ${operationId}`,
    `Dispatched At (IST): ${timestamp}`,
    `Authorized Operator ID: ${options.actorUserId}`,
    ``,
    `This test email confirms that Google OAuth 2.0 refresh token authorization,`,
    `Gmail REST API connectivity, and RFC 2822 MIME transmission from`,
    `Senthangstudents@gmail.com are functioning correctly in Preview.`,
    ``,
    `Note: This is an internal technical test message. It contains zero customer data,`,
    `ticket numbers, payment references, or financial links.`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; background-color: #f7f3f0; padding: 24px; color: #35110f;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #eadbcf; border-radius: 12px; padding: 28px;">
    <h2 style="color: #7c1619; margin-top: 0;">SSFI Lucky Draw &mdash; Gmail Provider Test</h2>
    <p style="font-size: 14px; line-height: 1.5;">This diagnostic confirmation verifies that the official Gmail API provider is successfully communicating via Google OAuth 2.0.</p>
    <table style="width: 100%; font-size: 13px; background: #fffaf7; border: 1px solid #f0e7df; border-radius: 8px; padding: 12px; margin: 16px 0;">
      <tr><td style="color: #705a54;">Environment:</td><td><strong>Vercel Preview</strong></td></tr>
      <tr><td style="color: #705a54;">Operation ID:</td><td><code>${operationId}</code></td></tr>
      <tr><td style="color: #705a54;">Timestamp (IST):</td><td><strong>${timestamp}</strong></td></tr>
      <tr><td style="color: #705a54;">Sender:</td><td><code>Senthangstudents@gmail.com</code></td></tr>
    </table>
    <p style="font-size: 12px; color: #705a54; margin-bottom: 0;">Safe diagnostic message &bull; No customer or financial data included.</p>
  </div>
</body>
</html>`;

  // Dispatch via Gmail API
  const deliveryResult = await sendEmailViaGmailApi({
    recipient: targetRecipient,
    subject,
    text,
    html,
    isStaffAuthorized: true,
  });

  const success = deliveryResult.status === "SENT";

  // Record audit log
  try {
    const { createSupabaseAdminClient } = await import("../../supabase/admin.ts");
    const admin = createSupabaseAdminClient();
    await admin.from("audit_logs").insert({
      actor_user_id: options.actorUserId,
      action: success ? "GMAIL_PROVIDER_TEST_SENT" : "GMAIL_PROVIDER_TEST_FAILED",
      entity_type: "delivery_test",
      entity_id: null,
      metadata: {
        operation_id: operationId,
        provider: "gmail_api",
        status: deliveryResult.status,
        provider_message_id: deliveryResult.providerMessageId,
        recipient_masked: targetRecipient.replace(/^(.{2})(.*)(@.*)$/, "$1***$3"),
        error: deliveryResult.error || null,
        timestamp,
      },
    });
  } catch (auditErr) {
    console.warn("[Gmail Test Audit Log Warning]", auditErr);
  }

  return {
    success,
    operationId,
    recipient: targetRecipient,
    provider: deliveryResult.provider,
    providerMessageId: deliveryResult.providerMessageId,
    error: deliveryResult.error,
    timestamp,
  };
}
