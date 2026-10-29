import type { DeliveryPayload } from "./types.ts";

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
 * Centrally managed WhatsApp Ticket Confirmation Template.
 * Formats clean, official message with emojis, verification link, and verified support info.
 */
export function renderWhatsAppTicketMessage(payload: DeliveryPayload): string {
  const safeName = payload.customerName.trim();
  const ticketList = payload.ticketNumbers.map((num) => `• *${num}*`).join("\n");
  const count = payload.ticketNumbers.length;

  // Strict verified SSFI contact details
  const supportEmail = payload.supportEmail?.trim() || "Senthangstudents@gmail.com";
  const supportPhone =
    payload.supportPhone && payload.supportPhone.trim() !== "" && payload.supportPhone !== "+91 98765 43210"
      ? payload.supportPhone.trim()
      : null;

  const lines = [
    `🎟️ *SSFI LUCKY DRAW — TICKET CONFIRMATION*`,
    ``,
    `Dear ${safeName},`,
    `Thank you for your generous contribution to the *Senthang Students Fellowship India (SSFI)*!`,
    `Your payment for Order *${payload.orderNumber}* has been verified by SSFI administration.`,
    ``,
    `📋 *Campaign:* ${payload.campaignName}`,
    `🎫 *Official Tickets Allocated (${count}):*`,
    ticketList,
    ``,
    `💰 *Verified Amount Paid:* ₹${payload.amountInr.toLocaleString("en-IN")}`,
    `📅 *Issued At:* ${payload.issuedAtIst}`,
    payload.sellerAttribution ? `🤝 *Attributed Seller:* ${payload.sellerAttribution}` : ``,
    ``,
    `🔍 *View & Verify Your Tickets:*`,
    `${payload.ticketAccessUrl}`,
    ``,
    `Keep this link safe to check draw results and show your ticket entry on event day.`,
    ``,
    `📞 *SSFI Support & Enquiries:*`,
    supportPhone ? `WhatsApp/Call: ${supportPhone}` : ``,
    `Email: ${supportEmail}`,
  ];

  if (payload.isSimulated) {
    lines.push(``);
    lines.push(`_[DEV NOTICE: This is a simulated message generated in development mode. No real WhatsApp transmission occurred.]_`);
  }

  return lines.filter((l) => l !== "").join("\n");
}

/**
 * Centrally managed Email Ticket Confirmation Template.
 * Returns both rich branded HTML and plain-text alternatives.
 */
export function renderEmailTicketMessage(payload: DeliveryPayload): {
  subject: string;
  html: string;
  text: string;
} {
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

  // Plain-text counterpart
  const ticketTextList = payload.ticketNumbers.map((num) => `  * ${num}`).join("\n");
  const text = [
    `SSFI LUCKY DRAW — TICKET CONFIRMATION`,
    `=====================================`,
    `Dear ${payload.customerName},`,
    ``,
    `Your contribution for Order ${payload.orderNumber} has been verified, and your lucky draw tickets are officially issued.`,
    ``,
    `Campaign: ${payload.campaignName}`,
    `Amount Paid: ₹${payload.amountInr.toLocaleString("en-IN")}`,
    `Issued At: ${payload.issuedAtIst}`,
    payload.sellerAttribution ? `Attributed Seller: ${payload.sellerAttribution}\n` : ``,
    `Allocated Ticket Numbers (${payload.ticketNumbers.length}):`,
    ticketTextList,
    ``,
    `View and verify your tickets online:`,
    `${payload.ticketAccessUrl}`,
    ``,
    `For any queries, contact SSFI Support at ${supportEmail}${rawSupportPhone ? ` or ${rawSupportPhone}` : ""}.`,
    payload.isSimulated ? `\n[DEV NOTICE: Simulated message in development mode.]` : ``,
  ].filter((l) => l !== "").join("\n");

  // Rich HTML template
  const ticketHtmlItems = payload.ticketNumbers
    .map(
      (num) => `
        <div style="background-color: #fffaf7; border: 1px solid #e8d6c5; border-radius: 8px; padding: 12px; text-align: center; margin: 4px;">
          <span style="font-family: monospace; font-size: 18px; font-weight: bold; color: #7c1619;">${escapeHtml(
            num
          )}</span>
        </div>
      `
    )
    .join("");

  const simulationBanner = payload.isSimulated
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
          Your Lucky Draw Tickets (${payload.ticketNumbers.length})
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
          Keep your ticket numbers safe. Winning numbers will be announced at the grand lucky draw event.
        </p>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background-color: #fffaf7; border-top: 1px solid #eadbcf; padding: 20px 24px; text-align: center; font-size: 12px; color: #705a54;">
        <p style="margin: 0 0 4px;"><strong>Senthang Students Fellowship India (SSFI)</strong></p>
        <p style="margin: 0;">Support: <a href="mailto:${supportEmail}" style="color: #7c1619;">${supportEmail}</a>${
          safeSupportPhone ? ` | ${safeSupportPhone}` : ""
        }</p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
