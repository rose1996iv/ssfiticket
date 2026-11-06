"use server";

import { revalidatePath } from "next/cache";
import { hasCurrentUserRole, requireAnyRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  assertNoLockedFieldsPresent,
  masterCustomerProfileUpdateSchema,
  singleTicketContactUpdateSchema,
} from "@/lib/validation/customerManagement";

export type ContactUpdateResult = {
  success: boolean;
  error?: string;
  auditId?: string;
  updatedScope?: "CUSTOMER_PROFILE" | "TICKET_CONTACT";
};

/**
 * Operation 1: Customer Profile Update
 * Updates the customer's master contact information in `public.customers`
 * and writes an append-only audit log entry with old/new values and reason.
 */
export async function updateMasterCustomerProfile(
  rawPayload: Record<string, unknown>
): Promise<ContactUpdateResult> {
  try {
    const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);
    const isSuperAdmin = await hasCurrentUserRole("SUPER_ADMIN");
    const actorRole = isSuperAdmin ? "SUPER_ADMIN" : "ADMIN";

    const lockedCheck = assertNoLockedFieldsPresent(rawPayload);
    if (!lockedCheck.ok) {
      return { success: false, error: lockedCheck.error };
    }

    const parsed = masterCustomerProfileUpdateSchema.safeParse({
      ...rawPayload,
      scope: "CUSTOMER_PROFILE",
    });

    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || "Invalid customer contact details.";
      return { success: false, error: msg };
    }

    const { customerId, orderId, fullName, email, whatsapp, reason } = parsed.data;
    const admin = createSupabaseAdminClient();

    const { data: existingCustomer, error: fetchErr } = await admin
      .from("customers")
      .select("id, full_name, email, whatsapp_number, phone")
      .eq("id", customerId)
      .maybeSingle();

    if (fetchErr || !existingCustomer) {
      return { success: false, error: "Customer record not found." };
    }

    const oldValues = {
      full_name: existingCustomer.full_name,
      email: existingCustomer.email,
      whatsapp_number: existingCustomer.whatsapp_number,
      phone: existingCustomer.phone,
    };

    const newValues = {
      full_name: fullName,
      email,
      whatsapp_number: whatsapp,
      phone: whatsapp,
    };

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await admin
      .from("customers")
      .update({
        ...newValues,
        updated_at: nowIso,
      })
      .eq("id", customerId);

    if (updateErr) {
      return { success: false, error: updateErr.message || "Failed to update customer profile." };
    }

    const { data: auditRow, error: auditErr } = await admin
      .from("audit_logs")
      .insert({
        actor_user_id: user.id,
        action: "CUSTOMER_PROFILE_UPDATED",
        entity_type: "customer",
        entity_id: customerId,
        metadata: {
          scope: "CUSTOMER_PROFILE",
          actor_role: actorRole,
          customer_id: customerId,
          order_id: orderId ?? null,
          old_value: oldValues,
          new_value: newValues,
          reason,
          updated_at: nowIso,
        },
      })
      .select("id")
      .single();

    if (auditErr) {
      console.error("[Customer Management] Audit log insert error:", auditErr);
    }

    revalidatePath("/admin/customers");
    revalidatePath("/admin/orders");
    revalidatePath("/admin/tickets");
    if (orderId) {
      revalidatePath(`/admin/orders/${orderId}`);
    }

    return {
      success: true,
      auditId: auditRow?.id,
      updatedScope: "CUSTOMER_PROFILE",
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update master customer profile.",
    };
  }
}

/**
 * Operation 2: Ticket Contact Update
 * Updates contact information associated with ONE specific ticket only
 * (`public.tickets` contact override fields) without altering the master
 * `public.customers` record or any other tickets belonging to that customer.
 */
export async function updateSingleTicketContact(
  rawPayload: Record<string, unknown>
): Promise<ContactUpdateResult> {
  try {
    const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);
    const isSuperAdmin = await hasCurrentUserRole("SUPER_ADMIN");
    const actorRole = isSuperAdmin ? "SUPER_ADMIN" : "ADMIN";

    const lockedCheck = assertNoLockedFieldsPresent(rawPayload);
    if (!lockedCheck.ok) {
      return { success: false, error: lockedCheck.error };
    }

    const parsed = singleTicketContactUpdateSchema.safeParse({
      ...rawPayload,
      scope: "TICKET_CONTACT",
    });

    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || "Invalid ticket contact details.";
      return { success: false, error: msg };
    }

    const { ticketId, orderId, fullName, email, whatsapp, reason } = parsed.data;
    const admin = createSupabaseAdminClient();

    const { data: ticketRow, error: fetchErr } = await admin
      .from("tickets")
      .select(
        "id, ticket_number, order_id, customer_id, contact_full_name, contact_email, contact_whatsapp, customers(full_name, email, whatsapp_number, phone)"
      )
      .eq("id", ticketId)
      .maybeSingle();

    if (fetchErr || !ticketRow) {
      return { success: false, error: "Ticket record not found." };
    }

    const masterCust = Array.isArray(ticketRow.customers)
      ? ticketRow.customers[0]
      : ticketRow.customers;

    const oldValues = {
      contact_full_name: ticketRow.contact_full_name ?? masterCust?.full_name ?? null,
      contact_email: ticketRow.contact_email ?? masterCust?.email ?? null,
      contact_whatsapp:
        ticketRow.contact_whatsapp ?? masterCust?.whatsapp_number ?? masterCust?.phone ?? null,
      had_ticket_override: Boolean(
        ticketRow.contact_full_name || ticketRow.contact_email || ticketRow.contact_whatsapp
      ),
    };

    const newValues = {
      contact_full_name: fullName,
      contact_email: email,
      contact_whatsapp: whatsapp,
    };

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await admin
      .from("tickets")
      .update({
        contact_full_name: fullName,
        contact_email: email,
        contact_whatsapp: whatsapp,
        contact_updated_at: nowIso,
        contact_updated_by: user.id,
        contact_update_reason: reason,
        updated_at: nowIso,
      })
      .eq("id", ticketId);

    if (updateErr) {
      return { success: false, error: updateErr.message || "Failed to update ticket contact." };
    }

    const resolvedOrderId = orderId ?? (ticketRow.order_id as string);

    const { data: auditRow, error: auditErr } = await admin
      .from("audit_logs")
      .insert({
        actor_user_id: user.id,
        action: "TICKET_CONTACT_UPDATED",
        entity_type: "ticket",
        entity_id: ticketId,
        metadata: {
          scope: "TICKET_CONTACT",
          actor_role: actorRole,
          ticket_id: ticketId,
          ticket_number: ticketRow.ticket_number,
          order_id: resolvedOrderId,
          customer_id: ticketRow.customer_id,
          old_value: oldValues,
          new_value: newValues,
          reason,
          updated_at: nowIso,
        },
      })
      .select("id")
      .single();

    if (auditErr) {
      console.error("[Ticket Contact Management] Audit log insert error:", auditErr);
    }

    revalidatePath("/admin/tickets");
    revalidatePath("/admin/orders");
    revalidatePath("/admin/customers");
    if (resolvedOrderId) {
      revalidatePath(`/admin/orders/${resolvedOrderId}`);
    }

    return {
      success: true,
      auditId: auditRow?.id,
      updatedScope: "TICKET_CONTACT",
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update single ticket contact.",
    };
  }
}
