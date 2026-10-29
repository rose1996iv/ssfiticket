"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAnyRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fromIstDatetimeLocalToIso, formatIstDateTime } from "@/lib/date/timezone";

const allowedStatuses = ["DRAFT", "ACTIVE", "PAUSED", "CLOSED", "CANCELLED"] as const;
type CampaignStatus = (typeof allowedStatuses)[number];

const scheduleSchema = z.object({
  startAt: z.string().optional().or(z.literal("")),
  endAt: z.string().optional().or(z.literal("")),
});

const statusSchema = z.object({
  status: z.enum(allowedStatuses, { error: "Invalid campaign status." }),
  confirmCode: z.string().optional(),
});

/**
 * Updates the campaign opening (start_at) and closing (end_at) schedule.
 * Enforces Asia/Kolkata (IST) parsing and end_at > start_at invariant.
 * Restricts access to SUPER_ADMIN and ADMIN roles only.
 */
export async function updateCampaignSchedule(formData: FormData) {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const parsed = scheduleSchema.safeParse({
    startAt: formData.get("startAt"),
    endAt: formData.get("endAt"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid schedule input.");
  }

  const startIso = fromIstDatetimeLocalToIso(parsed.data.startAt);
  const endIso = fromIstDatetimeLocalToIso(parsed.data.endAt);

  if (startIso && endIso) {
    const startTime = new Date(startIso).getTime();
    const endTime = new Date(endIso).getTime();
    if (endTime <= startTime) {
      throw new Error("Closing date and time must be strictly after the opening date and time.");
    }
  }

  const admin = createSupabaseAdminClient();

  // 1. Fetch current campaign
  const { data: campaign, error: fetchErr } = await admin
    .from("campaigns")
    .select("id, public_id, start_at, end_at, status")
    .eq("public_id", "ssfi-fundraising-lucky-draw")
    .maybeSingle();

  if (fetchErr || !campaign) {
    console.error("[Campaign Settings Diagnostic] Failed to lookup campaign:", fetchErr);
    throw new Error("Unable to locate fundraising campaign configuration.");
  }

  // 2. Perform atomic update
  const { error: updateErr } = await admin
    .from("campaigns")
    .update({
      start_at: startIso,
      end_at: endIso,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaign.id);

  if (updateErr) {
    console.error("[Campaign Settings Diagnostic] Failed to update schedule:", updateErr);
    throw new Error("Failed to save campaign schedule. Please check input parameters.");
  }

  // 3. Trigger immediate automated schedule transition check if schedule is already in window
  try {
    await admin.rpc("process_scheduled_campaign_transitions");
  } catch (rpcErr) {
    console.warn("[Campaign Settings Diagnostic] Post-schedule update transition check warning:", rpcErr);
  }

  // 4. Write structured audit log entry
  try {
    await admin.from("audit_logs").insert({
      actor_user_id: user.id,
      action: "CAMPAIGN_SCHEDULE_UPDATED",
      entity_type: "campaign",
      entity_id: campaign.id,
      metadata: {
        old_start_at: campaign.start_at,
        new_start_at: startIso,
        old_end_at: campaign.end_at,
        new_end_at: endIso,
        start_ist_formatted: formatIstDateTime(startIso),
        end_ist_formatted: formatIstDateTime(endIso),
      },
    });
  } catch (auditErr) {
    console.warn("[Campaign Settings Diagnostic] Non-fatal audit log insert failure:", auditErr);
  }

  revalidatePath("/admin/campaign-settings");
  revalidatePath("/buy");
  revalidatePath("/seller");
  revalidatePath("/seller/orders/new");

  return {
    success: true,
    message: "Campaign schedule updated successfully.",
  };
}

/**
 * Triggers atomic synchronization of scheduled campaign transitions.
 * Promotes DRAFT to ACTIVE when start_at arrives, and ACTIVE to CLOSED when end_at arrives.
 * Callable by administrative staff or internal scheduler cron routes.
 */
export async function syncCampaignSchedule() {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("process_scheduled_campaign_transitions");

  if (error) {
    console.error("[Campaign Schedule Sync Diagnostic] RPC failed:", error);
    throw new Error("Failed to process scheduled campaign transitions.");
  }

  const payload = data as {
    processed_at?: string;
    transition_count?: number;
    transitions?: Array<{ campaign_id: string; public_id: string; from: string; to: string; reason: string }>;
  } | null;

  if (payload && Number(payload.transition_count) > 0) {
    revalidatePath("/admin/campaign-settings");
    revalidatePath("/buy");
    revalidatePath("/seller");
    revalidatePath("/seller/orders/new");
  }

  return {
    success: true,
    transitionCount: payload?.transition_count ?? 0,
    transitions: payload?.transitions ?? [],
  };
}

/**
 * Updates the campaign lifecycle status (DRAFT, ACTIVE, PAUSED, CLOSED, CANCELLED).
 * Enforces safety confirmation for critical state transitions.
 * Restricts access to SUPER_ADMIN and ADMIN roles only.
 */
export async function updateCampaignStatus(formData: FormData) {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const parsed = statusSchema.safeParse({
    status: formData.get("status"),
    confirmCode: formData.get("confirmCode"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid status option.");
  }

  const targetStatus = parsed.data.status as CampaignStatus;
  const admin = createSupabaseAdminClient();

  // 1. Fetch current campaign
  const { data: campaign, error: fetchErr } = await admin
    .from("campaigns")
    .select("id, public_id, status, start_at, end_at, sold_ticket_count")
    .eq("public_id", "ssfi-fundraising-lucky-draw")
    .maybeSingle();

  if (fetchErr || !campaign) {
    console.error("[Campaign Settings Diagnostic] Failed to lookup campaign:", fetchErr);
    throw new Error("Unable to locate fundraising campaign configuration.");
  }

  if (campaign.status === targetStatus) {
    return {
      success: true,
      message: `Campaign is already in ${targetStatus} status.`,
    };
  }

  // 2. Validate state transitions & confirmation rules
  if (targetStatus === "ACTIVE") {
    // Prevent activating with an expired closing date
    if (campaign.end_at && new Date(campaign.end_at).getTime() <= Date.now()) {
      const endFormatted = formatIstDateTime(campaign.end_at);
      throw new Error(
        `Cannot activate campaign because the scheduled closing time (${endFormatted}) has already passed. Please update the schedule first.`
      );
    }
  }

  if (targetStatus === "CLOSED") {
    if (parsed.data.confirmCode?.trim().toUpperCase() !== "CLOSE") {
      throw new Error("To close the campaign, you must type 'CLOSE' in the confirmation box.");
    }
  }

  if (targetStatus === "CANCELLED") {
    if (parsed.data.confirmCode?.trim().toUpperCase() !== "CANCEL") {
      throw new Error("To cancel the campaign, you must type 'CANCEL' in the confirmation box.");
    }
  }

  // 3. Perform atomic update
  const { error: updateErr } = await admin
    .from("campaigns")
    .update({
      status: targetStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaign.id);

  if (updateErr) {
    console.error("[Campaign Settings Diagnostic] Failed to update campaign status:", updateErr);
    throw new Error("Failed to change campaign status. Please try again.");
  }

  // 4. Write audit log entry
  try {
    await admin.from("audit_logs").insert({
      actor_user_id: user.id,
      action: "CAMPAIGN_STATUS_UPDATED",
      entity_type: "campaign",
      entity_id: campaign.id,
      metadata: {
        old_status: campaign.status,
        new_status: targetStatus,
        sold_ticket_count: campaign.sold_ticket_count,
      },
    });
  } catch (auditErr) {
    console.warn("[Campaign Settings Diagnostic] Non-fatal audit log insert failure:", auditErr);
  }

  revalidatePath("/admin/campaign-settings");
  revalidatePath("/buy");
  revalidatePath("/seller");
  revalidatePath("/seller/orders/new");

  return {
    success: true,
    message: `Campaign status successfully changed to ${targetStatus}.`,
  };
}

