import type { DeliveryPayload } from "./types.ts";
import { resolveEnvironmentAppUrl } from "../config/appUrl.ts";

/**
 * Escapes HTML characters for safe template rendering.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Resolves origin base URL for ticket verification links with strict environment isolation:
 * - Production environment: Strictly resolves to https://ssfiticket.vercel.app.
 * - Preview / Development environment: Strictly uses Preview origin, NEVER Production.
 * - Prevents simulated preview tickets from ever generating canonical production URLs.
 */
export function resolveDeliveryBaseUrl(payload: DeliveryPayload): string {
  if (payload.ticketAccessUrl && payload.ticketAccessUrl.trim() !== "") {
    try {
      const parsedOrigin = new URL(payload.ticketAccessUrl).origin;
      // Safety guard: If ticket payload is marked simulated, strictly forbid production URL
      if (payload.isSimulated && parsedOrigin.includes("ssfiticket.vercel.app")) {
        const env = resolveEnvironmentAppUrl();
        return env.isProduction ? "https://preview.ssfiticket.internal" : env.baseUrl;
      }
      return parsedOrigin;
    } catch {
      // Fall through to environment resolution
    }
  }

  const env = resolveEnvironmentAppUrl();
  if (payload.isSimulated && env.isProduction) {
    return "https://preview.ssfiticket.internal";
  }
  return env.baseUrl;
}

/**
 * Centrally managed WhatsApp Ticket Confirmation Template.
 * Formats a clean, professional, official plain-text message.
 * Strictly ZERO emojis, clean bold syntax (*text*), blank lines for paragraph separation,
 * direct verification links for every allocated ticket, and confirmed draw date (19 December 2026).
 */
export function renderWhatsAppTicketMessage(payload: DeliveryPayload): string {
  const safeName = payload.customerName.trim();
  const baseUrl = resolveDeliveryBaseUrl(payload);

  // Strict verified SSFI contact details
  const supportEmail = payload.supportEmail?.trim() || "Senthangstudents@gmail.com";
  const supportPhone =
    payload.supportPhone && payload.supportPhone.trim() !== "" && payload.supportPhone !== "+91 98765 43210"
      ? payload.supportPhone.trim()
      : null;

  const isMultiTicket = payload.ticketNumbers.length > 1;

  const ticketSections: string[] = isMultiTicket
    ? [
        `*Allocated Tickets (${payload.ticketNumbers.length}) & Direct Verification Links:*`,
        ...payload.ticketNumbers.map(
          (num) => `• *${num}*: ${baseUrl}/verify/${encodeURIComponent(num)}`
        ),
      ]
    : [
        `*Ticket Number:* ${payload.ticketNumbers[0]}`,
        `*Direct Verification Link:*`,
        `${baseUrl}/verify/${encodeURIComponent(payload.ticketNumbers[0] || "")}`,
      ];

  const lines = [
    `*SSFI LUCKY DRAW — TICKET CONFIRMATION*`,
    ``,
    `Dear ${safeName},`,
    ``,
    `Thank you for your generous contribution. Your payment for Order *${payload.orderNumber}* has been verified, and your lucky draw tickets are officially issued.`,
    ``,
    `*Campaign:* ${payload.campaignName}`,
    `*Confirmed Draw Date:* 19 December 2026`,
    `*Verified Amount:* ₹${payload.amountInr.toLocaleString("en-IN")}`,
    `*Status:* PAYMENT VERIFIED & TICKETS ISSUED`,
    payload.sellerAttribution ? `*Attributed Seller:* ${payload.sellerAttribution}` : null,
    ``,
    ...ticketSections,
    ``,
    `*View Full Order & Scannable QR:*`,
    `${payload.ticketAccessUrl}`,
    ``,
    `*Official SSFI Channels:*`,
    `YouTube: https://www.youtube.com/@SenthangStudentsSSFI`,
    `Facebook: https://www.facebook.com/senthangstudents`,
    `Support Email: ${supportEmail}`,
    supportPhone ? `Support Phone: ${supportPhone}` : null,
    ``,
    `Please retain this message and your ticket numbers. We wish you the very best in the draw!`,
  ];

  // Preserve intentional empty lines for clean paragraph spacing in WhatsApp
  return lines.filter((l): l is string => l !== null && l !== undefined).join("\n");
}

/**
 * Centrally managed Email Ticket Confirmation Template.
 * Returns both rich branded HTML and plain-text alternatives.
 * Strictly zero emojis, direct verification links per ticket, and confirmed draw date (19 December 2026).
 */
export function renderEmailTicketMessage(payload: DeliveryPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const baseUrl = resolveDeliveryBaseUrl(payload);
  const safeName = escapeHtml(payload.customerName.trim());
  const safeOrder = escapeHtml(payload.orderNumber);
  const safeCampaign = escapeHtml(payload.campaignName);
  const safeDate = escapeHtml(payload.issuedAtIst);
  const safeUrl = escapeHtml(payload.ticketAccessUrl);

  // Strict verified SSFI contact details
  const supportEmail = escapeHtml(payload.supportEmail?.trim() || "Senthangstudents@gmail.com");
  const rawSupportPhone =
    payload.supportPhone && payload.supportPhone.trim() !== "" && payload.supportPhone !== "+91 98765 43210"
      ? payload.supportPhone.trim()
      : null;
  const safeSupportPhone = rawSupportPhone ? escapeHtml(rawSupportPhone) : null;

  const subject = `[SSFI Lucky Draw] Official Ticket Confirmation — Order ${payload.orderNumber}`;

  // Plain-text counterpart with direct links
  const ticketTextList = payload.ticketNumbers
    .map((num) => `  * ${num}: ${baseUrl}/verify/${encodeURIComponent(num)}`)
    .join("\n");

  const text = [
    `SSFI LUCKY DRAW — TICKET CONFIRMATION`,
    `=====================================`,
    `Dear ${payload.customerName},`,
    ``,
    `Your contribution for Order ${payload.orderNumber} has been verified, and your lucky draw tickets are officially issued.`,
    ``,
    `Campaign: ${payload.campaignName}`,
    `Confirmed Draw Date: 19 December 2026`,
    `Amount Paid: ₹${payload.amountInr.toLocaleString("en-IN")}`,
    `Issued At: ${payload.issuedAtIst}`,
    payload.sellerAttribution ? `Attributed Seller: ${payload.sellerAttribution}\n` : ``,
    `Allocated Ticket Numbers (${payload.ticketNumbers.length}):`,
    ticketTextList,
    ``,
    `View and verify your tickets online:`,
    `${payload.ticketAccessUrl}`,
    ``,
    `Official SSFI Channels:`,
    `YouTube: https://www.youtube.com/@SenthangStudentsSSFI`,
    `Facebook: https://www.facebook.com/senthangstudents`,
    `Email: ${supportEmail}${rawSupportPhone ? ` | Phone: ${rawSupportPhone}` : ""}`,
  ].filter((l) => l !== "").join("\n");

  // Rich HTML template with direct links per ticket
  const ticketHtmlItems = payload.ticketNumbers
    .map((num) => {
      const directVerifyUrl = `${baseUrl}/verify/${encodeURIComponent(num)}`;
      return `
        <div style="background-color: #fffaf7; border: 1px solid #e8d6c5; border-radius: 10px; padding: 14px; text-align: center; margin: 8px 0;">
          <span style="font-family: monospace; font-size: 19px; font-weight: bold; color: #7c1619;">${escapeHtml(num)}</span>
          <div style="margin-top: 6px;">
            <a href="${directVerifyUrl}" target="_blank" style="font-size: 12px; color: #7c1619; text-decoration: underline; font-weight: 600;">
              Verify Ticket Online (${escapeHtml(num)}) &rarr;
            </a>
          </div>
        </div>
      `;
    })
    .join("");

  const isProduction =
    process.env.VERCEL_ENV === "production" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "production";

  const simulationBanner =
    !isProduction && payload.isSimulated
      ? `
      <div style="background-color: #fef3c7; border: 1px solid #f59e0b; color: #92400e; padding: 10px 14px; border-radius: 8px; font-size: 12px; margin-bottom: 20px; text-align: center;">
        <strong>Development Mode Notice:</strong> This email was simulated via the local test provider. No real email was dispatched.
      </div>
    `
      : ``;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f7f3f0; margin: 0; padding: 24px; color: #35110f; -webkit-font-smoothing: antialiased;">
  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; border: 1px solid #eadbcf; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
    <!-- Header -->
    <tr>
      <td style="background-color: #7c1619; padding: 32px 24px; text-align: center; color: #ffffff;">
        <p style="margin: 0; font-size: 11px; font-weight: bold; letter-spacing: 2px; color: #f3ce75; text-transform: uppercase;">Senthang Students Fellowship India</p>
        <h1 style="margin: 8px 0 0; font-size: 24px; font-weight: bold; color: #ffffff;">Official Ticket Confirmation</h1>
        <p style="margin: 4px 0 0; font-family: monospace; font-size: 13px; color: #fceeee;">Order: ${safeOrder}</p>
      </td>
    </tr>

    <!-- Content Body -->
    <tr>
      <td style="padding: 32px 28px;">
        ${simulationBanner}

        <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5;">Dear <strong>${safeName}</strong>,</p>
        <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #594541;">
          Thank you for supporting the <strong>${safeCampaign}</strong>. We are delighted to confirm that your payment has been approved and your official tickets have been registered.
        </p>

        <!-- Order Summary Box -->
        <table width="100%" style="background-color: #fffaf7; border: 1px solid #f0e7df; border-radius: 12px; padding: 16px; margin-bottom: 24px; font-size: 13px;">
          <tr>
            <td style="color: #705a54; padding-bottom: 8px;">Campaign:</td>
            <td style="font-weight: bold; text-align: right; padding-bottom: 8px;">${safeCampaign}</td>
          </tr>
          <tr>
            <td style="color: #705a54; padding-bottom: 8px;">Confirmed Draw Date:</td>
            <td style="font-weight: bold; color: #7c1619; text-align: right; padding-bottom: 8px;">19 December 2026</td>
          </tr>
          <tr>
            <td style="color: #705a54; padding-bottom: 8px;">Verified Amount:</td>
            <td style="font-weight: bold; color: #7c1619; text-align: right; padding-bottom: 8px;">₹${payload.amountInr.toLocaleString(
              "en-IN"
            )}</td>
          </tr>
          <tr>
            <td style="color: #705a54; padding-bottom: 8px;">Issued Timestamp (IST):</td>
            <td style="font-weight: bold; text-align: right; padding-bottom: 8px;">${safeDate}</td>
          </tr>
          ${
            payload.sellerAttribution
              ? `<tr>
            <td style="color: #705a54;">Attributed Seller:</td>
            <td style="font-weight: bold; text-align: right;">${escapeHtml(payload.sellerAttribution)}</td>
          </tr>`
              : ""
          }
        </table>

        <!-- Tickets Grid -->
        <p style="margin: 0 0 8px; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #705a54;">
          Your Lucky Draw Tickets &amp; Verification Links (${payload.ticketNumbers.length})
        </p>
        <div style="margin-bottom: 24px;">
          ${ticketHtmlItems}
        </div>

        <!-- Action Button -->
        <table align="center" border="0" cellpadding="0" cellspacing="0" style="margin: 28px auto;">
          <tr>
            <td align="center" style="border-radius: 10px; background-color: #7c1619;">
              <a href="${safeUrl}" target="_blank" style="display: inline-block; padding: 14px 28px; font-size: 14px; font-weight: bold; color: #ffffff; text-decoration: none; border-radius: 10px;">
                View &amp; Verify Tickets Online
              </a>
            </td>
          </tr>
        </table>

        <p style="margin: 20px 0 0; font-size: 12px; line-height: 1.6; color: #705a54; text-align: center;">
          Keep your ticket numbers safe. Winning numbers will be announced at the grand lucky draw ceremony on <strong>19 December 2026</strong>.
        </p>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background-color: #fffaf7; border-top: 1px solid #eadbcf; padding: 20px 24px; text-align: center; font-size: 12px; color: #705a54;">
        <p style="margin: 0 0 4px;"><strong>Senthang Students Fellowship India (SSFI)</strong></p>
        <p style="margin: 0 0 6px;">Support: <a href="mailto:${supportEmail}" style="color: #7c1619;">${supportEmail}</a>${
          safeSupportPhone ? ` | ${safeSupportPhone}` : ""
        }</p>
        <p style="margin: 0; font-size: 11px;">
          <a href="https://www.youtube.com/@SenthangStudentsSSFI" target="_blank" style="color: #7c1619; text-decoration: none; font-weight: 600;">Official YouTube</a> &bull;
          <a href="https://www.facebook.com/senthangstudents" target="_blank" style="color: #7c1619; text-decoration: none; font-weight: 600; margin-left: 6px;">Official Facebook</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
