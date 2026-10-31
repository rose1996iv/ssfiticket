"use server";

import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatIstDateTime } from "@/lib/date/timezone";
import {
  validateCampaignStatusPayload,
  validateCampaignSchedulePayload,
  type CampaignActionResponse,
  type CampaignStatus,
} from "@/lib/campaign/validation";

export type { CampaignActionResponse, CampaignStatus };

/**
 * Updates the campaign opening (start_at) and closing (end_at) schedule.
 * Enforces Asia/Kolkata (IST) parsing and end_at > start_at invariant.
 * Restricts access to SUPER_ADMIN and ADMIN roles only.
 */
export async function updateCampaignSchedule(formData: FormData): Promise<CampaignActionResponse> {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const validation = validateCampaignSchedulePayload({
    campaignId: formData.get("campaignId"),
    publicId: formData.get("publicId"),
    startAt: formData.get("startAt"),
    endAt: formData.get("endAt"),
  });

  if (!validation.valid || !validation.data) {
    return {
      success: false,
      error: validation.error ?? "Invalid schedule input.",
    };
  }

  const { startIso, endIso, campaignId, publicId } = validation.data;
  const admin = createSupabaseAdminClient();

  // 1. Fetch current campaign
  let query = admin
    .from("campaigns")
    .select("id, public_id, start_at, end_at, status");

  if (campaignId) {
    query = query.eq("id", campaignId);
  } else if (publicId) {
    query = query.eq("public_id", publicId);
  } else {
    query = query.eq("public_id", "ssfi-fundraising-lucky-draw");
  }

  const { data: campaign, error: fetchErr } = await query.maybeSingle();

  if (fetchErr || !campaign) {
    console.error("[Campaign Settings Diagnostic] Failed to lookup campaign:", fetchErr);
    return {
      success: false,
      error: "Unable to locate fundraising campaign configuration.",
    };
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
    return {
      success: false,
      error: "Failed to save campaign schedule. Please check input parameters.",
    };
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
    return {
      success: false,
      error: "Failed to process scheduled campaign transitions.",
      transitionCount: 0,
      transitions: [],
    };
  }

  const payload = data as {
    processed_at?: string;
    transition_count?: number;
    transitions?: Array<{ campaign_id: string; public_id: string; from: string; to: string; reason: string }>;
  } | null;

  const count = Number(payload?.transition_count ?? 0);

  if (count > 0) {
    revalidatePath("/admin/campaign-settings");
    revalidatePath("/buy");
    revalidatePath("/seller");
    revalidatePath("/seller/orders/new");
  }

  return {
    success: true,
    transitionCount: count,
    transitions: payload?.transitions ?? [],
  };
}

/**
 * Updates the campaign lifecycle status (DRAFT, ACTIVE, PAUSED, CLOSED, CANCELLED).
 * Enforces safety confirmation for critical state transitions.
 * Restricts access to SUPER_ADMIN and ADMIN roles only.
 */
export async function updateCampaignStatus(formData: FormData): Promise<CampaignActionResponse> {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const validation = validateCampaignStatusPayload({
    campaignId: formData.get("campaignId"),
    publicId: formData.get("publicId"),
    status: formData.get("status"),
    confirmCode: formData.get("confirmCode"),
  });

  if (!validation.valid || !validation.data) {
    return {
      success: false,
      error: validation.error ?? "Invalid status option.",
    };
  }

  const { status: targetStatus, campaignId, publicId } = validation.data;
  const admin = createSupabaseAdminClient();

  // 1. Fetch current campaign
  let query = admin
    .from("campaigns")
    .select("id, public_id, status, start_at, end_at, sold_ticket_count");

  if (campaignId) {
    query = query.eq("id", campaignId);
  } else if (publicId) {
    query = query.eq("public_id", publicId);
  } else {
    query = query.eq("public_id", "ssfi-fundraising-lucky-draw");
  }

  const { data: campaign, error: fetchErr } = await query.maybeSingle();

  if (fetchErr || !campaign) {
    console.error("[Campaign Settings Diagnostic] Failed to lookup campaign:", fetchErr);
    return {
      success: false,
      error: "Unable to locate fundraising campaign configuration.",
    };
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
      return {
        success: false,
        error: `Cannot activate campaign because the scheduled closing time (${endFormatted}) has already passed. Please update the schedule first.`,
      };
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
    return {
      success: false,
      error: "Failed to change campaign status. Please try again.",
    };
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
