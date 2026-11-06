import { z } from "zod";
import { emailSchema, whatsappSchema } from "./contact.ts";

/**
 * Locked fields that must NEVER be accepted or modified through any
 * Admin Customer / Ticket Contact management operation.
 */
export const LOCKED_IMMUTABLE_KEYS = [
  "ticket_number",
  "ticketNumber",
  "ticket_qr_token",
  "verification_token",
  "order_number",
  "orderNumber",
  "amount_paise",
  "total_amount_paise",
  "unit_price_paise",
  "payment_status",
  "verified_at",
  "verified_by",
  "issued_at",
  "seller_id",
  "snapshot_seller_id",
  "snapshot_seller_code",
  "snapshot_upi_id",
  "utr_reference",
  "storage_path",
] as const;

export const customerContactFieldsSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Customer name must be at least 2 characters.")
    .max(120, "Customer name cannot exceed 120 characters."),
  email: emailSchema,
  whatsapp: whatsappSchema,
  reason: z
    .string()
    .trim()
    .min(5, "A modification reason (at least 5 characters) is mandatory for audit compliance.")
    .max(500, "Modification reason cannot exceed 500 characters."),
});

export const masterCustomerProfileUpdateSchema = customerContactFieldsSchema.extend({
  scope: z.literal("CUSTOMER_PROFILE"),
  customerId: z.string().uuid("Valid customer ID is required."),
  orderId: z.string().uuid().optional(),
});

export const singleTicketContactUpdateSchema = customerContactFieldsSchema.extend({
  scope: z.literal("TICKET_CONTACT"),
  ticketId: z.string().uuid("Valid ticket ID is required."),
  orderId: z.string().uuid().optional(),
});

/**
 * Rejects any payload attempting to supply or mutate locked ticket/order/payment identity fields.
 */
export function assertNoLockedFieldsPresent(
  payload: Record<string, unknown>
): { ok: true } | { ok: false; lockedKey: string; error: string } {
  for (const key of LOCKED_IMMUTABLE_KEYS) {
    if (key in payload && payload[key] !== undefined) {
      return {
        ok: false,
        lockedKey: key,
        error: `Security violation: '${key}' is a locked immutable field and cannot be modified.`,
      };
    }
  }
  return { ok: true };
}

export const COLLAB_NOTE_TYPES = [
  "SELLER_REVIEW_NOTE",
  "SELLER_RECOMMENDATION",
  "ADMIN_INSTRUCTION",
  "CLARIFICATION_REQUEST",
  "SELLER_RESPONSE",
  "SUPPORTING_EVIDENCE",
  "ISSUE_RESOLVED",
  "CUSTOMER_NOTICE",
] as const;

export const COLLAB_VISIBILITIES = [
  "ADMIN_ONLY",
  "SELLER_AND_ADMIN",
  "CUSTOMER_VISIBLE",
] as const;

export type CollabNoteType = (typeof COLLAB_NOTE_TYPES)[number];
export type CollabVisibility = (typeof COLLAB_VISIBILITIES)[number];

/**
 * Pure RBAC visibility filter helper.
 */
export function filterNotesByViewerRole<
  T extends { visibility: CollabVisibility }
>(notes: T[], viewerRole: "STAFF" | "SELLER" | "CUSTOMER"): T[] {
  if (viewerRole === "STAFF") {
    return notes;
  }
  if (viewerRole === "SELLER") {
    return notes.filter(
      (n) => n.visibility === "SELLER_AND_ADMIN" || n.visibility === "CUSTOMER_VISIBLE"
    );
  }
  return notes.filter((n) => n.visibility === "CUSTOMER_VISIBLE");
}

