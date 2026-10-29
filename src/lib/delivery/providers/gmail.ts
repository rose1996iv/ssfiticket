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
 * - MIME RFC 2822 base64url message composition
 * - Safe preview/development isolation with dry-run support
 * - Honest status reporting: if credentials are unconfigured, reports status accurately
 * - Non-fatal execution: failures will never throw or rollback ticket issuance or payment verification
 */

import type { DeliveryPayload, DeliveryResult } from "../types";

export type GmailApiConfig = {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  senderAddress: string;
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

/**
 * Exchanges OAuth 2.0 refresh token for a fresh access token from Google.
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
    let errorDetail = `OAuth token exchange failed with status ${res.status}`;
    try {
      const errJson = await res.json();
      errorDetail = errJson.error_description || errJson.error || JSON.stringify(errJson);
    } catch {
      errorDetail = await res.text();
    }
    throw new Error(`Google OAuth error: ${errorDetail}`);
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
 * Sends an email using the Gmail REST API (users.messages.send).
 */
export async function sendEmailViaGmailApi(options: {
  recipient: string;
  subject: string;
  text: string;
  html: string;
  payload: DeliveryPayload;
}): Promise<DeliveryResult> {
  const config = getGmailApiConfig();
  const isConfigured = isGmailApiConfigured();

  // Environment safety check
  const isVercelPreview =
    process.env.VERCEL_ENV === "preview" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
  const isDevOrPreview = process.env.NODE_ENV !== "production" || isVercelPreview;
  const isDryRun = process.env.GMAIL_DRY_RUN === "true" || process.env.RESEND_DRY_RUN === "true";

  // If in Preview/Development or dry-run, simulate dispatch safely
  if (isDevOrPreview || isDryRun || !isConfigured) {
    const allowedTestEmail = process.env.ALLOWED_TEST_EMAIL?.trim();
    const isApprovedTestRecipient =
      Boolean(allowedTestEmail) &&
      options.recipient.toLowerCase() === allowedTestEmail!.toLowerCase();

    // If configured and explicit test recipient matches in dev, allow live transmission
    if (isConfigured && !isDryRun && isApprovedTestRecipient) {
      console.log(`[Gmail API] Live test email permitted for approved recipient: ${options.recipient}`);
    } else {
      console.log(
        `[Gmail API] Safe mode active (isDevOrPreview=${isDevOrPreview}, isDryRun=${isDryRun}, isConfigured=${isConfigured}). Simulated dispatch for: ${options.recipient}`
      );
      return {
        channel: "EMAIL",
        status: "SIMULATED",
        provider: isConfigured ? "gmail_api_dry_run" : "gmail_api_unconfigured",
        recipient: options.recipient,
        providerMessageId: `sim-gmail-${options.payload.orderNumber}-${Date.now()}`,
        renderedContent: options.html,
        subject: options.subject,
        error: isConfigured ? null : "Gmail API credentials not configured on server (simulation mode).",
      };
    }
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
      let errorDetail = `Gmail API error status ${res.status}`;
      try {
        const errJson = await res.json();
        errorDetail = errJson.error?.message || JSON.stringify(errJson);
      } catch {
        errorDetail = await res.text();
      }

      console.error("[Gmail API Provider Error]", {
        status: res.status,
        message: errorDetail,
      });

      return {
        channel: "EMAIL",
        status: "FAILED",
        provider: "gmail_api",
        recipient: options.recipient,
        providerMessageId: null,
        renderedContent: options.html,
        subject: options.subject,
        error: `Gmail API error (status ${res.status}): ${errorDetail}`,
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
    const msg = err instanceof Error ? err.message : "Gmail API delivery failed";
    console.error("[Gmail API Provider Exception]", msg);
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

