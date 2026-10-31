import { z } from "zod";

/**
 * Validates that a string has:
 * - Allowed characters: digits, spaces, hyphens, optional leading plus, and optional parentheses.
 * - Between 7 and 15 actual digits (consistent with ITU-T E.164 international standard).
 * - Not punctuation-only.
 */
export function validateWhatsAppDigits(val: string): boolean {
  if (!val) return false;
  const digits = val.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export const WHATSAPP_ALLOWED_CHARS_REGEX = /^\+?[0-9\s\-()]{7,25}$/;

export const whatsappSchema = z
  .string()
  .trim()
  .min(7, "WhatsApp number is required and must be an active phone number.")
  .max(25, "WhatsApp number cannot exceed 25 characters.")
  .regex(
    WHATSAPP_ALLOWED_CHARS_REGEX,
    "Please enter a valid active WhatsApp number (digits with optional +, spaces, hyphens, or parentheses)."
  )
  .refine(validateWhatsAppDigits, {
    message: "WhatsApp number must contain between 7 and 15 digits.",
  });

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email address is required.")
  .max(255, "Email address cannot exceed 255 characters.")
  .email("Please enter a valid email address.")
  .toLowerCase();

