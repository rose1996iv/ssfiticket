import { renderWhatsAppTicketMessage } from "./templates.ts";
import type { DeliveryPayload } from "./types.ts";

/**
 * Normalizes a phone number to standard international WhatsApp format without
 * plus signs, dashes, spaces, or leading zeroes.
 *
 * Rules:
 * - Strips all non-digit characters.
 * - If 10 digits (standard Indian mobile starting with 6, 7, 8, or 9), prefixes country code 91.
 * - If 11 digits starting with 0, removes leading zero and prefixes 91.
 * - Preserves existing country code if already present.
 */
export function formatWhatsAppPhoneNumber(rawPhone: string): string {
  if (!rawPhone) return "";
  const digits = rawPhone.replace(/\D/g, "");

  // Standard Indian 10-digit mobile
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return `91${digits}`;
  }

  // 11 digits starting with 0 (e.g. 09876543210)
  if (digits.length === 11 && digits.startsWith("0")) {
    return `91${digits.slice(1)}`;
  }

  // If already prefixed with 91 and 12 digits
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits;
  }

  return digits;
}

/**
 * Builds the official 100% FREE WhatsApp Click-to-Chat URL:
 * https://wa.me/PHONE_NUMBER?text=ENCODED_MESSAGE
 *
 * Requirements:
 * - Zero paid WhatsApp Business API.
 * - Zero Twilio or recurring subscriptions.
 * - Formatted message with customer name, order number, ticket numbers, verification URL.
 * - Opens WhatsApp Web or WhatsApp Desktop/Mobile app for manual review & sending.
 */
export function buildWhatsAppClickToChatUrl(payload: DeliveryPayload): {
  url: string;
  recipientPhone: string;
  messageText: string;
} {
  const recipientPhone = formatWhatsAppPhoneNumber(payload.whatsappNumber);
  const messageText = renderWhatsAppTicketMessage(payload);
  const encodedMessage = encodeURIComponent(messageText);

  const url = recipientPhone
    ? `https://wa.me/${recipientPhone}?text=${encodedMessage}`
    : `https://wa.me/?text=${encodedMessage}`;

  return {
    url,
    recipientPhone,
    messageText,
  };
}
