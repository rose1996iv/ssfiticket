import QRCode from "qrcode";
import { getBaseAppUrl } from "../config/appUrl.ts";

/**
 * Builds the canonical public verification URL for an official SSFI ticket.
 */
export function getTicketVerificationUrl(ticketNumber: string, baseUrl?: string): string {
  const cleanHost = getBaseAppUrl(baseUrl);
  return `${cleanHost}/verify/${encodeURIComponent(ticketNumber.trim().toUpperCase())}`;
}

/**
 * Generates an SVG string representation of a ticket verification QR code.
 */
export async function generateTicketQrSvg(ticketNumber: string, baseUrl?: string): Promise<string> {
  const url = getTicketVerificationUrl(ticketNumber, baseUrl);
  return QRCode.toString(url, {
    type: "svg",
    width: 240,
    margin: 2,
    color: {
      dark: "#7c1619",
      light: "#ffffff",
    },
  });
}

/**
 * Generates a base64 PNG Data URL of a ticket verification QR code.
 * Suitable for `<img src={...} />` rendering or email embedding.
 */
export async function generateTicketQrDataUrl(ticketNumber: string, baseUrl?: string): Promise<string> {
  const url = getTicketVerificationUrl(ticketNumber, baseUrl);
  return QRCode.toDataURL(url, {
    width: 240,
    margin: 2,
    color: {
      dark: "#7c1619",
      light: "#ffffff",
    },
  });
}

