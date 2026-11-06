"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  getCurrentUser,
  hasAnyCurrentUserRole,
  hasCurrentUserRole,
  requireAnyRole,
} from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  COLLAB_NOTE_TYPES,
  COLLAB_VISIBILITIES,
  filterNotesByViewerRole,
  type CollabNoteType,
  type CollabVisibility,
} from "@/lib/validation/customerManagement";

export type { CollabNoteType, CollabVisibility };

export type OrderCollaborationNoteItem = {
  id: string;
  order_id: string;
  payment_id: string | null;
  author_user_id: string;
  author_role: string;
  author_name: string;
  note_type: CollabNoteType;
  visibility: CollabVisibility;
  body: string;
  evidence_reference: string | null;
  is_resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
};

export type AuditTimelineEvent = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_user_id: string | null;
  actor_label: string;
  created_at: string;
  metadata: Record<string, unknown>;
};

const createNoteSchema = z.object({
  orderId: z.string().uuid("Valid order ID is required."),
  paymentId: z.string().uuid().optional().nullable(),
  noteType: z.enum(COLLAB_NOTE_TYPES),
  visibility: z.enum(COLLAB_VISIBILITIES),
  body: z
    .string()
    .trim()
    .min(2, "Note message must be at least 2 characters.")
    .max(2000, "Note message cannot exceed 2000 characters."),
  evidenceReference: z
    .string()
    .trim()
    .max(500, "Evidence reference cannot exceed 500 characters.")
    .optional()
    .nullable(),
});

/**
 * Fetches order-specific collaboration notes with strict server-side role and ownership checks.
 */
export async function getOrderCollaborationNotes(
  orderId: string
): Promise<{ success: boolean; notes: OrderCollaborationNoteItem[]; error?: string }> {
  if (!z.string().uuid().safeParse(orderId).success) {
    return { success: false, notes: [], error: "Invalid order ID." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { success: false, notes: [], error: "Authentication required." };
  }

  const [isStaff, isSeller] = await Promise.all([
    hasAnyCurrentUserRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]),
    hasCurrentUserRole("SELLER"),
  ]);

  if (!isStaff && !isSeller) {
    return { success: false, notes: [], error: "Unauthorized." };
  }

  const admin = createSupabaseAdminClient();

  if (!isStaff && isSeller) {
    const { data: sellerRow } = await admin
      .from("sellers")
      .select("id")
      .eq("profile_id", user.id)
      .maybeSingle();

    if (!sellerRow) {
      return { success: false, notes: [], error: "Seller account not found." };
    }

    const { data: orderRow } = await admin
      .from("orders")
      .select("id, seller_id, snapshot_seller_id")
      .eq("id", orderId)
      .maybeSingle();

    if (
      !orderRow ||
      (orderRow.seller_id !== sellerRow.id && orderRow.snapshot_seller_id !== sellerRow.id)
    ) {
      return { success: false, notes: [], error: "Access denied for this order." };
    }
  }

  let query = admin
    .from("order_collaboration_notes")
    .select(
      "id, order_id, payment_id, author_user_id, author_role, note_type, visibility, body, evidence_reference, is_resolved, resolved_at, resolved_by, created_at"
    )
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (!isStaff) {
    query = query.in("visibility", ["SELLER_AND_ADMIN", "CUSTOMER_VISIBLE"]);
  }

  const { data, error } = await query;
  if (error || !data) {
    return { success: false, notes: [], error: error?.message || "Failed to load notes." };
  }

  const authorIds = Array.from(new Set(data.map((n) => n.author_user_id).filter(Boolean)));
  const authorMap = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", authorIds);
    for (const p of profiles ?? []) {
      authorMap.set(p.id, p.full_name || p.email || "User");
    }
  }

  const notes: OrderCollaborationNoteItem[] = data.map((row) => ({
    id: row.id as string,
    order_id: row.order_id as string,
    payment_id: (row.payment_id as string | null) ?? null,
    author_user_id: row.author_user_id as string,
    author_role: row.author_role as string,
    author_name: authorMap.get(row.author_user_id as string) || (row.author_role as string),
    note_type: row.note_type as CollabNoteType,
    visibility: row.visibility as CollabVisibility,
    body: row.body as string,
    evidence_reference: (row.evidence_reference as string | null) ?? null,
    is_resolved: Boolean(row.is_resolved),
    resolved_at: (row.resolved_at as string | null) ?? null,
    resolved_by: (row.resolved_by as string | null) ?? null,
    created_at: row.created_at as string,
  }));

  const filtered = filterNotesByViewerRole(notes, isStaff ? "STAFF" : "SELLER");
  return { success: true, notes: filtered };
}

/**
 * Posts a new order-specific collaboration note with strict role and visibility enforcement.
 */
export async function createOrderCollaborationNote(
  rawPayload: Record<string, unknown>
): Promise<{ success: boolean; error?: string; noteId?: string }> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const parsed = createNoteSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Invalid collaboration note.",
      };
    }

    const { orderId, paymentId, noteType, visibility, body, evidenceReference } = parsed.data;
    const [isSuperAdmin, isAdmin, isManager, isSeller] = await Promise.all([
      hasCurrentUserRole("SUPER_ADMIN"),
      hasCurrentUserRole("ADMIN"),
      hasCurrentUserRole("FUNDRAISING_MANAGER"),
      hasCurrentUserRole("SELLER"),
    ]);

    const isStaff = isSuperAdmin || isAdmin || isManager;

    if (!isStaff && !isSeller) {
      return { success: false, error: "Unauthorized to add review notes." };
    }

    const admin = createSupabaseAdminClient();

    let authorRole: "SUPER_ADMIN" | "ADMIN" | "FUNDRAISING_MANAGER" | "SELLER" = "SELLER";
    if (isSuperAdmin) authorRole = "SUPER_ADMIN";
    else if (isAdmin) authorRole = "ADMIN";
    else if (isManager) authorRole = "FUNDRAISING_MANAGER";

    if (!isStaff) {
      // Seller restrictions
      if (visibility === "ADMIN_ONLY" || visibility === "CUSTOMER_VISIBLE") {
        return {
          success: false,
          error: "Sellers can only post Seller & Admin review notes.",
        };
      }
      const allowedSellerTypes: CollabNoteType[] = [
        "SELLER_REVIEW_NOTE",
        "SELLER_RECOMMENDATION",
        "SELLER_RESPONSE",
        "SUPPORTING_EVIDENCE",
      ];
      if (!allowedSellerTypes.includes(noteType)) {
        return {
          success: false,
          error: "Invalid note type for Seller role.",
        };
      }

      const { data: sellerRow } = await admin
        .from("sellers")
        .select("id")
        .eq("profile_id", user.id)
        .maybeSingle();

      const { data: orderRow } = await admin
        .from("orders")
        .select("id, seller_id, snapshot_seller_id")
        .eq("id", orderId)
        .maybeSingle();

      if (
        !sellerRow ||
        !orderRow ||
        (orderRow.seller_id !== sellerRow.id && orderRow.snapshot_seller_id !== sellerRow.id)
      ) {
        return {
          success: false,
          error: "Access denied: this order does not belong to your seller account.",
        };
      }
    }

    const { data: inserted, error: insertErr } = await admin
      .from("order_collaboration_notes")
      .insert({
        order_id: orderId,
        payment_id: paymentId ?? null,
        author_user_id: user.id,
        author_role: authorRole,
        note_type: noteType,
        visibility,
        body: body.trim(),
        evidence_reference: evidenceReference?.trim() || null,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      return {
        success: false,
        error: insertErr?.message || "Failed to save collaboration note.",
      };
    }

    await admin.from("audit_logs").insert({
      actor_user_id: user.id,
      action: "ORDER_COLLABORATION_NOTE_ADDED",
      entity_type: "order",
      entity_id: orderId,
      metadata: {
        note_id: inserted.id,
        payment_id: paymentId ?? null,
        author_role: authorRole,
        note_type: noteType,
        visibility,
        has_evidence_reference: Boolean(evidenceReference?.trim()),
      },
    });

    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath(`/seller/orders/${orderId}`);
    if (paymentId) {
      revalidatePath(`/admin/payments/${paymentId}`);
    }

    return { success: true, noteId: inserted.id };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to post collaboration note.",
    };
  }
}

/**
 * Marks a collaboration note / clarification request as resolved and logs in audit_logs.
 */
export async function resolveOrderCollaborationNote(
  noteId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);
    if (!z.string().uuid().safeParse(noteId).success) {
      return { success: false, error: "Invalid note ID." };
    }

    const admin = createSupabaseAdminClient();
    const { data: existing } = await admin
      .from("order_collaboration_notes")
      .select("id, order_id, payment_id, note_type, is_resolved")
      .eq("id", noteId)
      .maybeSingle();

    if (!existing) {
      return { success: false, error: "Note not found." };
    }

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await admin
      .from("order_collaboration_notes")
      .update({
        is_resolved: true,
        resolved_at: nowIso,
        resolved_by: user.id,
        updated_at: nowIso,
      })
      .eq("id", noteId);

    if (updateErr) {
      return { success: false, error: updateErr.message };
    }

    await admin.from("audit_logs").insert({
      actor_user_id: user.id,
      action: "ORDER_REVIEW_ISSUE_RESOLVED",
      entity_type: "order",
      entity_id: existing.order_id,
      metadata: {
        note_id: noteId,
        note_type: existing.note_type,
        payment_id: existing.payment_id,
        resolved_at: nowIso,
      },
    });

    revalidatePath(`/admin/orders/${existing.order_id}`);
    revalidatePath(`/seller/orders/${existing.order_id}`);
    if (existing.payment_id) {
      revalidatePath(`/admin/payments/${existing.payment_id}`);
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to resolve review issue.",
    };
  }
}

/**
 * Retrieves the centralized append-only audit timeline for an order, its payment(s),
 * its issued ticket(s), and its customer record.
 */
export async function getOrderAuditTimeline(
  orderId: string
): Promise<{ success: boolean; events: AuditTimelineEvent[]; error?: string }> {
  try {
    await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);
    if (!z.string().uuid().safeParse(orderId).success) {
      return { success: false, events: [], error: "Invalid order ID." };
    }

    const admin = createSupabaseAdminClient();
    const { data: orderRow } = await admin
      .from("orders")
      .select("id, customer_id, payments(id), tickets(id)")
      .eq("id", orderId)
      .maybeSingle();

    if (!orderRow) {
      return { success: false, events: [], error: "Order not found." };
    }

    const entityIds = new Set<string>([orderId]);
    if (orderRow.customer_id) entityIds.add(orderRow.customer_id as string);

    const paymentsArr = Array.isArray(orderRow.payments)
      ? orderRow.payments
      : orderRow.payments
      ? [orderRow.payments]
      : [];
    for (const p of paymentsArr) {
      if (p?.id) entityIds.add(p.id as string);
    }

    const ticketsArr = Array.isArray(orderRow.tickets)
      ? orderRow.tickets
      : orderRow.tickets
      ? [orderRow.tickets]
      : [];
    for (const t of ticketsArr) {
      if (t?.id) entityIds.add(t.id as string);
    }

    const { data: logs, error } = await admin
      .from("audit_logs")
      .select("id, actor_user_id, action, entity_type, entity_id, metadata, created_at")
      .in("entity_id", Array.from(entityIds))
      .order("created_at", { ascending: false })
      .limit(100);

    if (error || !logs) {
      return { success: false, events: [], error: error?.message || "Failed to load audit logs." };
    }

    const actorIds = Array.from(
      new Set(logs.map((l) => l.actor_user_id).filter(Boolean) as string[])
    );
    const actorMap = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", actorIds);
      for (const p of profiles ?? []) {
        actorMap.set(p.id, p.full_name || p.email || p.id.slice(0, 8));
      }
    }

    const events: AuditTimelineEvent[] = logs.map((l) => ({
      id: l.id as string,
      action: l.action as string,
      entity_type: l.entity_type as string,
      entity_id: (l.entity_id as string | null) ?? null,
      actor_user_id: (l.actor_user_id as string | null) ?? null,
      actor_label: l.actor_user_id
        ? actorMap.get(l.actor_user_id as string) || `User ${(l.actor_user_id as string).slice(0, 8)}`
        : "System / Public Customer",
      created_at: l.created_at as string,
      metadata: (l.metadata as Record<string, unknown>) ?? {},
    }));

    return { success: true, events };
  } catch (err: unknown) {
    return {
      success: false,
      events: [],
      error: err instanceof Error ? err.message : "Failed to load audit timeline.",
    };
  }
}
