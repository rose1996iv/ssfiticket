import { z } from "zod";

export const UUID_SCHEMA = z.string().uuid("Invalid order identifier.");

export type WhatsAppActorRole = "SUPER_ADMIN" | "ADMIN" | "FUNDRAISING_MANAGER" | "SELLER";

export interface WhatsAppAuthContext {
  userId: string;
  userEmail: string | null;
  profileActive: boolean;
  roles: readonly string[];
  sellerRecord: { id: string; is_active: boolean } | null;
}

export interface WhatsAppOrderTarget {
  id: string;
  campaign_id: string;
  seller_id: string | null;
  status: string;
  tickets?: ReadonlyArray<{
    id: string;
    order_id?: string | null;
    campaign_id?: string | null;
    ticket_number: string;
    status: string;
    issued_at?: string | null;
  }>;
}

export type WhatsAppAuthzResult =
  | {
      authorized: true;
      actorUserId: string;
      actorRole: WhatsAppActorRole;
      actorEmail: string | null;
    }
  | {
      authorized: false;
      code: "UNAUTHENTICATED" | "INACTIVE_ACCOUNT" | "FORBIDDEN" | "INVALID_ORDER_ID" | "ORDER_NOT_FOUND" | "TICKET_RELATIONSHIP_MISMATCH";
      error: string;
    };

const STAFF_ROLES: readonly WhatsAppActorRole[] = ["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"];

/**
 * Pure, deterministic authorization evaluator for WhatsApp ticket delivery actions.
 * Enforces:
 *   1. Valid authenticated user identity (never trusts client-supplied IDs/roles)
 *   2. Active profile check
 *   3. Role authorization: SUPER_ADMIN / ADMIN / FUNDRAISING_MANAGER or active owning SELLER
 *   4. Strict deny-by-default for CUSTOMER, unknown, or inactive accounts
 *   5. Object-level ownership (SELLER must own order.seller_id via canonical sellers.profile_id)
 *   6. Ticket-to-order and ticket-to-campaign relationship integrity
 */
export function evaluateWhatsAppDeliveryAuthorization(
  orderId: string,
  auth: WhatsAppAuthContext | null,
  order: WhatsAppOrderTarget | null
): WhatsAppAuthzResult {
  if (!UUID_SCHEMA.safeParse(orderId).success) {
    return {
      authorized: false,
      code: "INVALID_ORDER_ID",
      error: "Invalid order reference.",
    };
  }

  if (!auth || !auth.userId) {
    return {
      authorized: false,
      code: "UNAUTHENTICATED",
      error: "Authentication required to perform ticket delivery actions.",
    };
  }

  if (!auth.profileActive) {
    return {
      authorized: false,
      code: "INACTIVE_ACCOUNT",
      error: "Your account is inactive. Please contact an SSFI administrator.",
    };
  }

  const roleSet = new Set(auth.roles);
  const staffRole = STAFF_ROLES.find((r) => roleSet.has(r));
  const isSeller = roleSet.has("SELLER");

  if (!staffRole && !isSeller) {
    return {
      authorized: false,
      code: "FORBIDDEN",
      error: "You do not have permission to perform WhatsApp ticket delivery actions.",
    };
  }

  if (!order) {
    return {
      authorized: false,
      code: "ORDER_NOT_FOUND",
      error: "Order not found.",
    };
  }

  if (order.id !== orderId) {
    return {
      authorized: false,
      code: "TICKET_RELATIONSHIP_MISMATCH",
      error: "Order reference mismatch.",
    };
  }

  // Object-level ownership for non-staff sellers
  if (!staffRole) {
    if (!auth.sellerRecord || !auth.sellerRecord.is_active) {
      return {
        authorized: false,
        code: "FORBIDDEN",
        error: "Active seller profile required to access this order.",
      };
    }

    if (!order.seller_id || order.seller_id !== auth.sellerRecord.id) {
      return {
        authorized: false,
        code: "FORBIDDEN",
        error: "You are not authorized to access ticket delivery for this order.",
      };
    }
  }

  // Verify every associated ticket belongs to the intended order and campaign
  if (Array.isArray(order.tickets)) {
    for (const ticket of order.tickets) {
      if (ticket.order_id && ticket.order_id !== order.id) {
        return {
          authorized: false,
          code: "TICKET_RELATIONSHIP_MISMATCH",
          error: "Ticket ownership verification failed.",
        };
      }
      if (ticket.campaign_id && ticket.campaign_id !== order.campaign_id) {
        return {
          authorized: false,
          code: "TICKET_RELATIONSHIP_MISMATCH",
          error: "Ticket campaign verification failed.",
        };
      }
    }
  }

  return {
    authorized: true,
    actorUserId: auth.userId,
    actorRole: staffRole ?? "SELLER",
    actorEmail: auth.userEmail,
  };
}
