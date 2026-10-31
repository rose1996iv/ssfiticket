"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAnyRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchOrderTicketDeliveries } from "@/lib/delivery/service";
import { DeliveryChannel } from "@/lib/delivery/types";

const voidTicketSchema = z.object({
  ticketId: z.string().uuid("Invalid ticket ID format."),
  reason: z
    .string()
    .trim()
    .min(3, "Reason must be at least 3 characters.")
    .max(500, "Reason cannot exceed 500 characters."),
});

const reissueTicketSchema = z.object({
  ticketId: z.string().uuid("Invalid ticket ID format."),
  reason: z
    .string()
    .trim()
    .min(3, "Reissue reason must be at least 3 characters.")
    .max(500, "Reason cannot exceed 500 characters."),
});

const resendDeliverySchema = z.object({
  orderId: z.string().uuid("Invalid order ID format."),
  channel: z.enum(["WHATSAPP", "EMAIL"]).optional(),
});

const updateNotesSchema = z.object({
  ticketId: z.string().uuid("Invalid ticket ID format."),
  notes: z.string().trim().max(1000, "Notes cannot exceed 1000 characters."),
});

/**
 * Soft-voids an issued ticket entry with an audited reason.
 * Strictly restricted to SUPER_ADMIN and ADMIN roles.
 */
export async function adminVoidTicketAction(formData: FormData) {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const parsed = voidTicketSchema.safeParse({
    ticketId: formData.get("ticketId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid void ticket parameters.");
  }

  const admin = createSupabaseAdminClient();

  // Call PostgreSQL procedure for atomic validation and state transition
  const { error: rpcErr } = await admin.rpc("admin_void_ticket", {
    p_ticket_id: parsed.data.ticketId,
    p_actor: user.id,
    p_reason: parsed.data.reason,
  });

  if (rpcErr) {
    console.error("[Ticket Action Diagnostic] admin_void_ticket RPC failed:", {
      code: rpcErr.code,
      message: rpcErr.message,
    });
    throw new Error(rpcErr.message || "Failed to void ticket.");
  }

  revalidatePath("/admin/tickets");
  revalidatePath("/admin/orders");
  revalidatePath("/buy");

  return {
    success: true,
    message: "Ticket successfully voided. Audit log entry recorded.",
  };
}

/**
 * Voids an incorrect/damaged ticket and atomically issues a replacement ticket.
 * Automatically triggers delivery of the updated ticket allocation.
 * Strictly restricted to SUPER_ADMIN and ADMIN roles.
 */
export async function adminReissueTicketAction(formData: FormData) {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const parsed = reissueTicketSchema.safeParse({
    ticketId: formData.get("ticketId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid reissue parameters.");
  }

  const admin = createSupabaseAdminClient();

  // Call PostgreSQL procedure for atomic void and reissue
  const { data: newTicketId, error: rpcErr } = await admin.rpc("admin_reissue_ticket", {
    p_ticket_id: parsed.data.ticketId,
    p_actor: user.id,
    p_reason: parsed.data.reason,
  });

  if (rpcErr || !newTicketId) {
    console.error("[Ticket Action Diagnostic] admin_reissue_ticket RPC failed:", {
      code: rpcErr?.code,
      message: rpcErr?.message,
    });
    throw new Error(rpcErr?.message || "Failed to reissue ticket.");
  }

  // Lookup order ID to trigger delivery update
  const { data: ticket } = await admin
    .from("tickets")
    .select("order_id")
    .eq("id", newTicketId)
    .single();

  if (ticket?.order_id) {
    try {
      await dispatchOrderTicketDeliveries(ticket.order_id, {
        resend: true,
        actorUserId: user.id,
      });

      const { enqueueTicketsIssuedNotification } = await import("@/lib/delivery/outbox");
      await enqueueTicketsIssuedNotification(ticket.order_id, user.id);
    } catch (deliveryErr) {
      console.warn("[Ticket Action Diagnostic] Post-reissue delivery dispatch warning:", deliveryErr);
    }
  }

  revalidatePath("/admin/tickets");
  revalidatePath("/admin/orders");
  revalidatePath("/buy");

  return {
    success: true,
    newTicketId,
    message: "Ticket successfully reissued. Replacement ticket generated and delivery triggered.",
  };
}

/**
 * Manually resends ticket delivery for an order without issuing new tickets.
 * Strictly restricted to SUPER_ADMIN and ADMIN roles.
 */
export async function adminResendDeliveryAction(formData: FormData) {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const parsed = resendDeliverySchema.safeParse({
    orderId: formData.get("orderId"),
    channel: formData.get("channel") || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid resend parameters.");
  }

  const results = await dispatchOrderTicketDeliveries(parsed.data.orderId, {
    forceChannel: parsed.data.channel as DeliveryChannel | undefined,
    resend: true,
    actorUserId: user.id,
  });

  if (!parsed.data.channel || parsed.data.channel === "EMAIL") {
    try {
      const { enqueueTicketsIssuedNotification } = await import("@/lib/delivery/outbox");
      await enqueueTicketsIssuedNotification(parsed.data.orderId, user.id);
    } catch (err) {
      console.warn("[Tickets Action] Resend email outbox warning:", err);
    }
  }

  revalidatePath("/admin/tickets");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/payments");

  return {
    success: true,
    results,
    message: `Delivery successfully resent to ${results.length} channel(s).`,
  };
}

/**
 * Updates administrative notes attached to a ticket.
 * Strictly restricted to SUPER_ADMIN and ADMIN roles.
 */
export async function adminUpdateTicketNotesAction(formData: FormData) {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const parsed = updateNotesSchema.safeParse({
    ticketId: formData.get("ticketId"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid notes parameters.");
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("tickets")
    .update({ admin_notes: parsed.data.notes, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.ticketId);

  if (error) {
    throw new Error("Failed to update ticket notes.");
  }

  // Record audit log
  try {
    await admin.from("audit_logs").insert({
      actor_user_id: user.id,
      action: "TICKET_NOTES_UPDATED",
      entity_type: "ticket",
      entity_id: parsed.data.ticketId,
      metadata: { notes: parsed.data.notes },
    });
  } catch (auditErr) {
    console.warn("[Ticket Action Diagnostic] Audit log insertion warning:", auditErr);
  }

  revalidatePath("/admin/tickets");
  return { success: true, message: "Ticket notes updated." };
}

