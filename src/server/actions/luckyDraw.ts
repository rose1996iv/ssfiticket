"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAnyRole, hasCurrentUserRole, requireAuth } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sortTicketsCanonically, computeCanonicalSnapshotHash, verifyDrawEvidence } from "@/lib/draw/canonical";
import { generateServerSeed, computeCombinedSeed, deriveWinningIndex } from "@/lib/draw/randomness";
import { enqueueWinnerNotification } from "@/lib/delivery/outbox";
import { renderEmailWinnerAnnouncedMessage } from "@/lib/delivery/templates";
import { formatIstDateTime } from "@/lib/date/timezone";
import { getCustomerOrderUrl } from "@/lib/config/appUrl";
import type {
  DrawOverviewData,
  PrizeItem,
  DrawSession,
  DrawResultRecord,
  EligibleTicketRosterItem,
  ManualExclusion,
  EligibilitySnapshot,
  DrawApproval,
  RandomnessEvidence,
} from "@/lib/draw/types";

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const UuidSchema = z.string().uuid("Invalid UUID identifier.");

const ManualExclusionSchema = z.object({
  drawId: UuidSchema,
  prizeId: UuidSchema,
  ticketId: UuidSchema,
  reason: z.string().trim().min(5, "Exclusion reason must be at least 5 characters.").max(500),
});

const ApprovalDecisionSchema = z.object({
  approvalId: UuidSchema,
  decision: z.enum(["APPROVED", "REJECTED"]),
  notes: z.string().trim().max(1000).optional().default(""),
});

const DrawExecutionSchema = z.object({
  drawId: UuidSchema,
  prizeId: UuidSchema,
  snapshotId: UuidSchema,
  clientEntropy: z.string().trim().max(500).optional(),
});

// Helper response type
export type ActionResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};

// ============================================================================
// 1. GET DRAW OVERVIEW
// ============================================================================

export async function getDrawOverview(campaignId?: string): Promise<ActionResponse<DrawOverviewData>> {
  try {
    const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);
    const isSuperAdmin = await hasCurrentUserRole("SUPER_ADMIN");
    const isAdmin = await hasCurrentUserRole("ADMIN");

    const admin = createSupabaseAdminClient();

    // 1. Resolve Target Campaign
    let targetCampaignId = campaignId;
    if (!targetCampaignId) {
      const { data: activeCampaign } = await admin
        .from("campaigns")
        .select("id")
        .in("status", ["ACTIVE", "CLOSED"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      targetCampaignId = activeCampaign?.id;
    }

    if (!targetCampaignId) {
      return {
        success: false,
        error: "No active or closed campaign found for lucky draw.",
      };
    }

    // 2. Fetch Campaign Details
    const { data: campaign, error: campErr } = await admin
      .from("campaigns")
      .select("id, name, public_id, status, total_ticket_limit, sold_ticket_count")
      .eq("id", targetCampaignId)
      .single();

    if (campErr || !campaign) {
      return { success: false, error: campErr?.message || "Campaign not found." };
    }

    // 3. Fetch Prizes (ordered by prize_number ascending: 1, 2, 3, 4, 5)
    const { data: prizesRaw, error: prizeErr } = await admin
      .from("prizes")
      .select("id, campaign_id, prize_number, title, description, cash_amount_paise, display_order, created_at")
      .eq("campaign_id", targetCampaignId)
      .order("prize_number", { ascending: true });

    if (prizeErr) {
      return { success: false, error: prizeErr.message };
    }
    const prizes: PrizeItem[] = prizesRaw || [];

    // 4. Fetch or Create Active Draw Session for Campaign
    let { data: drawSession } = await admin
      .from("draws")
      .select("*")
      .eq("campaign_id", targetCampaignId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!drawSession) {
      // Create initial draw session
      const { data: newSession, error: createDrawErr } = await admin
        .from("draws")
        .insert({
          campaign_id: targetCampaignId,
          name: `${campaign.name} — Official Lucky Draw`,
          status: "DRAFT",
        })
        .select()
        .single();

      if (createDrawErr) {
        return { success: false, error: createDrawErr.message };
      }
      drawSession = newSession;
    }

    // 5. Fetch Existing Draw Results
    const { data: resultsRaw, error: resErr } = await admin
      .from("draw_results")
      .select(`
        id,
        draw_id,
        campaign_id,
        prize_id,
        ticket_id,
        snapshot_id,
        selection_index,
        seed_commitment,
        seed_revealed,
        combined_seed,
        drawn_by,
        notified_at,
        notified_by,
        notification_outbox_id,
        created_at,
        prizes:prize_id (
          prize_number,
          title
        ),
        tickets:ticket_id (
          ticket_number,
          customer_id,
          seller_id,
          customers:customer_id (
            full_name,
            email,
            phone
          ),
          sellers:seller_id (
            display_name,
            seller_code
          )
        )
      `)
      .eq("campaign_id", targetCampaignId)
      .order("created_at", { ascending: true });

    if (resErr) {
      return { success: false, error: resErr.message };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: DrawResultRecord[] = (resultsRaw || []).map((r: any) => ({
      id: r.id,
      draw_id: r.draw_id,
      campaign_id: r.campaign_id,
      prize_id: r.prize_id,
      prize_number: r.prizes?.prize_number ?? 0,
      prize_title: r.prizes?.title ?? "Prize",
      ticket_id: r.ticket_id,
      ticket_number: r.tickets?.ticket_number ?? "",
      customer_id: r.tickets?.customer_id ?? "",
      customer_name: r.tickets?.customers?.full_name ?? "Supporter",
      customer_email: r.tickets?.customers?.email,
      customer_phone: r.tickets?.customers?.phone,
      seller_id: r.tickets?.seller_id,
      seller_name: r.tickets?.sellers?.display_name,
      seller_code: r.tickets?.sellers?.seller_code,
      snapshot_id: r.snapshot_id,
      selection_index: r.selection_index,
      seed_commitment: r.seed_commitment,
      seed_revealed: r.seed_revealed,
      combined_seed: r.combined_seed,
      drawn_by: r.drawn_by,
      notified_at: r.notified_at,
      notified_by: r.notified_by,
      notification_outbox_id: r.notification_outbox_id,
      created_at: r.created_at,
    }));

    // 6. Determine Next Prize in Ceremonial Sequence (5th -> 4th -> 3rd -> 2nd -> 1st)
    const drawnPrizeIds = new Set(results.map((r) => r.prize_id));
    const maxPrizeNumber = Math.max(...prizes.map((p) => p.prize_number), 5);

    // Sequence checks starting from maxPrizeNumber down to 1
    let nextPrize: PrizeItem | null = null;
    for (let pNum = maxPrizeNumber; pNum >= 1; pNum--) {
      const p = prizes.find((item) => item.prize_number === pNum);
      if (p && !drawnPrizeIds.has(p.id)) {
        nextPrize = p;
        break;
      }
    }

    // 7. Check Active Snapshot and Pending Approval for Next Prize
    let activeSnapshot: EligibilitySnapshot | null = null;
    let pendingApproval: DrawApproval | null = null;

    if (nextPrize && drawSession) {
      const { data: snap } = await admin
        .from("draw_eligibility_snapshots")
        .select("*")
        .eq("draw_id", drawSession.id)
        .eq("prize_id", nextPrize.id)
        .eq("is_locked", true)
        .maybeSingle();

      activeSnapshot = snap as EligibilitySnapshot | null;

      if (nextPrize.prize_number === 1 && activeSnapshot) {
        const { data: app } = await admin
          .from("draw_approvals")
          .select(`
            *,
            initiator:initiator_id (email),
            approver:approver_id (email)
          `)
          .eq("draw_id", drawSession.id)
          .eq("prize_id", nextPrize.id)
          .eq("snapshot_hash", activeSnapshot.snapshot_hash)
          .maybeSingle();

        if (app) {
          pendingApproval = {
            id: app.id,
            draw_id: app.draw_id,
            campaign_id: app.campaign_id,
            prize_id: app.prize_id,
            snapshot_id: app.snapshot_id,
            snapshot_hash: app.snapshot_hash,
            initiator_id: app.initiator_id,
            initiator_email: (app.initiator as { email?: string })?.email,
            approver_id: app.approver_id,
            approver_email: (app.approver as { email?: string })?.email,
            status: app.status,
            requested_at: app.requested_at,
            reviewed_at: app.reviewed_at,
            review_notes: app.review_notes,
          };
        }
      }
    }

    return {
      success: true,
      data: {
        campaign,
        prizes,
        drawSession: drawSession as DrawSession,
        results,
        nextPrize,
        activeSnapshot,
        pendingApproval,
        userRole: {
          isSuperAdmin,
          isAdmin,
          userId: user.id,
          email: user.email || "",
        },
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ============================================================================
// 2. GET ELIGIBLE TICKETS ROSTER
// ============================================================================

export async function getEligibleTickets(
  campaignId: string,
  prizeId: string,
  options?: {
    page?: number;
    limit?: number;
    search?: string;
    filter?: "ALL" | "ELIGIBLE_ONLY" | "EXCLUDED_ONLY" | "WON_ONLY";
  }
): Promise<ActionResponse<{ tickets: EligibleTicketRosterItem[]; totalCount: number; eligibleCount: number }>> {
  try {
    await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);
    const admin = createSupabaseAdminClient();

    // 1. Fetch previous winners in the campaign (disqualified from subsequent prizes)
    const { data: prevWinners } = await admin
      .from("draw_results")
      .select("ticket_id, prize_id, prizes:prize_id (prize_number)")
      .eq("campaign_id", campaignId);

    const winnerMap = new Map<string, number>();
    for (const w of prevWinners || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pNum = (w.prizes as any)?.prize_number ?? 0;
      winnerMap.set(w.ticket_id, pNum);
    }

    // 2. Fetch manual exclusions for this campaign & prize
    const { data: exclusions } = await admin
      .from("draw_manual_exclusions")
      .select("id, ticket_id, reason")
      .eq("campaign_id", campaignId)
      .or(`prize_id.is.null,prize_id.eq.${prizeId}`);

    const exclusionMap = new Map<string, { id: string; reason: string }>();
    for (const ex of exclusions || []) {
      exclusionMap.set(ex.ticket_id, { id: ex.id, reason: ex.reason });
    }

    // 3. Fetch all ISSUED tickets for this campaign
    let query = admin
      .from("tickets")
      .select(`
        id,
        ticket_number,
        campaign_id,
        customer_id,
        order_id,
        seller_id,
        status,
        customers:customer_id (
          full_name,
          phone
        ),
        sellers:seller_id (
          display_name,
          seller_code
        ),
        orders:order_id (
          order_number
        )
      `)
      .eq("campaign_id", campaignId)
      .eq("status", "ISSUED")
      .order("ticket_number", { ascending: true });

    if (options?.search) {
      query = query.ilike("ticket_number", `%${options.search.trim()}%`);
    }

    const { data: ticketsRaw, error: ticketErr } = await query;
    if (ticketErr) {
      return { success: false, error: ticketErr.message };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allRoster: EligibleTicketRosterItem[] = (ticketsRaw || []).map((t: any) => {
      const isWon = winnerMap.has(t.id);
      const isExcl = exclusionMap.has(t.id);
      const isEligible = !isWon && !isExcl;

      return {
        id: t.id,
        ticket_number: t.ticket_number,
        campaign_id: t.campaign_id,
        customer_id: t.customer_id,
        customer_name: t.customers?.full_name ?? "Supporter",
        customer_phone: t.customers?.phone ?? "",
        seller_id: t.seller_id,
        seller_name: t.sellers?.display_name ?? null,
        seller_code: t.sellers?.seller_code ?? null,
        order_id: t.order_id,
        order_number: t.orders?.order_number ?? "",
        is_excluded: isExcl,
        exclusion_reason: exclusionMap.get(t.id)?.reason,
        exclusion_id: exclusionMap.get(t.id)?.id,
        is_previous_winner: isWon,
        previous_prize_number: winnerMap.get(t.id),
        is_eligible: isEligible,
      };
    });

    const eligibleCount = allRoster.filter((r) => r.is_eligible).length;

    // Apply filter
    let filtered = allRoster;
    if (options?.filter === "ELIGIBLE_ONLY") {
      filtered = allRoster.filter((r) => r.is_eligible);
    } else if (options?.filter === "EXCLUDED_ONLY") {
      filtered = allRoster.filter((r) => r.is_excluded);
    } else if (options?.filter === "WON_ONLY") {
      filtered = allRoster.filter((r) => r.is_previous_winner);
    }

    const page = options?.page || 1;
    const limit = options?.limit || 50;
    const startIndex = (page - 1) * limit;
    const paged = filtered.slice(startIndex, startIndex + limit);

    return {
      success: true,
      data: {
        tickets: paged,
        totalCount: filtered.length,
        eligibleCount,
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ============================================================================
// 3. CREATE MANUAL EXCLUSION
// ============================================================================

export async function createManualExclusion(input: {
  drawId: string;
  prizeId: string;
  ticketId: string;
  reason: string;
}): Promise<ActionResponse<ManualExclusion>> {
  try {
    const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);
    const validated = ManualExclusionSchema.parse(input);

    const admin = createSupabaseAdminClient();

    // Check if snapshot is already locked for this prize
    const { data: existingSnap } = await admin
      .from("draw_eligibility_snapshots")
      .select("id")
      .eq("draw_id", validated.drawId)
      .eq("prize_id", validated.prizeId)
      .eq("is_locked", true)
      .maybeSingle();

    if (existingSnap) {
      return {
        success: false,
        error: "Cannot add exclusion: Eligibility snapshot for this prize is already locked and immutable.",
      };
    }

    // Fetch ticket campaign
    const { data: ticket } = await admin
      .from("tickets")
      .select("id, ticket_number, campaign_id")
      .eq("id", validated.ticketId)
      .single();

    if (!ticket) {
      return { success: false, error: "Ticket not found." };
    }

    const { data: exclusion, error: insertErr } = await admin
      .from("draw_manual_exclusions")
      .insert({
        campaign_id: ticket.campaign_id,
        prize_id: validated.prizeId,
        ticket_id: validated.ticketId,
        reason: validated.reason,
        excluded_by: user.id,
      })
      .select()
      .single();

    if (insertErr) {
      return { success: false, error: insertErr.message };
    }

    // Write audit log
    await admin.from("audit_logs").insert({
      actor_user_id: user.id,
      action: "TICKET_EXCLUDED",
      entity_type: "ticket",
      entity_id: validated.ticketId,
      metadata: {
        draw_id: validated.drawId,
        prize_id: validated.prizeId,
        ticket_number: ticket.ticket_number,
        reason: validated.reason,
      },
    });

    revalidatePath("/admin/draw");
    return { success: true, data: exclusion as ManualExclusion };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ============================================================================
// 4. REMOVE MANUAL EXCLUSION
// ============================================================================

export async function removeManualExclusion(exclusionId: string): Promise<ActionResponse<{ id: string }>> {
  try {
    const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);
    const admin = createSupabaseAdminClient();

    const { data: exclusion } = await admin
      .from("draw_manual_exclusions")
      .select("id, campaign_id, prize_id, ticket_id")
      .eq("id", exclusionId)
      .single();

    if (!exclusion) {
      return { success: false, error: "Exclusion not found." };
    }

    // Check if snapshot is locked
    const { data: lockedSnap } = await admin
      .from("draw_eligibility_snapshots")
      .select("id")
      .eq("campaign_id", exclusion.campaign_id)
      .eq("prize_id", exclusion.prize_id)
      .eq("is_locked", true)
      .maybeSingle();

    if (lockedSnap) {
      return {
        success: false,
        error: "Cannot remove exclusion: Snapshot for this prize is already locked and immutable.",
      };
    }

    const { error: delErr } = await admin.from("draw_manual_exclusions").delete().eq("id", exclusionId);
    if (delErr) {
      return { success: false, error: delErr.message };
    }

    await admin.from("audit_logs").insert({
      actor_user_id: user.id,
      action: "TICKET_EXCLUSION_REMOVED",
      entity_type: "ticket",
      entity_id: exclusion.ticket_id,
      metadata: {
        campaign_id: exclusion.campaign_id,
        prize_id: exclusion.prize_id,
        exclusion_id: exclusionId,
      },
    });

    revalidatePath("/admin/draw");
    return { success: true, data: { id: exclusionId } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ============================================================================
// 5. LOCK ELIGIBILITY SNAPSHOT
// ============================================================================

export async function lockEligibilitySnapshot(input: {
  drawId: string;
  prizeId: string;
}): Promise<ActionResponse<{ snapshotId: string; snapshotHash: string; eligibleCount: number }>> {
  try {
    const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);
    const admin = createSupabaseAdminClient();

    const validated = z
      .object({
        drawId: UuidSchema,
        prizeId: UuidSchema,
      })
      .parse(input);

    // 1. Fetch draw session & prize
    const { data: draw } = await admin.from("draws").select("id, campaign_id").eq("id", validated.drawId).single();
    if (!draw) return { success: false, error: "Draw session not found." };

    const { data: prize } = await admin.from("prizes").select("id, prize_number").eq("id", validated.prizeId).single();
    if (!prize) return { success: false, error: "Prize not found." };

    // 2. Check if snapshot is already locked
    const { data: existing } = await admin
      .from("draw_eligibility_snapshots")
      .select("id, snapshot_hash, total_eligible_count")
      .eq("draw_id", validated.drawId)
      .eq("prize_id", validated.prizeId)
      .eq("is_locked", true)
      .maybeSingle();

    if (existing) {
      return {
        success: true,
        data: {
          snapshotId: existing.id,
          snapshotHash: existing.snapshot_hash,
          eligibleCount: existing.total_eligible_count,
        },
      };
    }

    // 3. Query all previous winners for the campaign
    const { data: winners } = await admin
      .from("draw_results")
      .select("ticket_id")
      .eq("campaign_id", draw.campaign_id);

    const winnerSet = new Set((winners || []).map((w) => w.ticket_id));

    // 4. Query manual exclusions for this draw and prize
    const { data: exclusions } = await admin
      .from("draw_manual_exclusions")
      .select("ticket_id")
      .eq("campaign_id", draw.campaign_id)
      .or(`prize_id.is.null,prize_id.eq.${validated.prizeId}`);

    const exclusionSet = new Set((exclusions || []).map((e) => e.ticket_id));

    // 5. Query all ISSUED tickets for this campaign
    const { data: tickets } = await admin
      .from("tickets")
      .select("id, ticket_number")
      .eq("campaign_id", draw.campaign_id)
      .eq("status", "ISSUED");

    if (!tickets || tickets.length === 0) {
      return { success: false, error: "No issued tickets found in campaign." };
    }

    // Filter eligible candidates
    const eligibleTickets = tickets.filter(
      (t) => !winnerSet.has(t.id) && !exclusionSet.has(t.id)
    );

    if (eligibleTickets.length === 0) {
      return { success: false, error: "Zero eligible tickets available for this prize draw." };
    }

    // 6. Sort canonically and compute canonical snapshot hash
    const canonicalRoster = sortTicketsCanonically(eligibleTickets);
    const ticketNumbers = canonicalRoster.map((t) => t.ticket_number);
    const ticketIds = canonicalRoster.map((t) => t.id);
    const snapshotHash = computeCanonicalSnapshotHash(ticketNumbers);

    // 7. Call authoritative Phase 9C RPC
    const { data: snapshotId, error: rpcErr } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: validated.drawId,
      p_prize_id: validated.prizeId,
      p_snapshot_hash: snapshotHash,
      p_ticket_ids: ticketIds,
      p_ticket_numbers: ticketNumbers,
      p_actor: user.id,
    });

    if (rpcErr) {
      return { success: false, error: rpcErr.message };
    }

    revalidatePath("/admin/draw");
    return {
      success: true,
      data: {
        snapshotId,
        snapshotHash,
        eligibleCount: canonicalRoster.length,
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ============================================================================
// 6. REQUEST FIRST PRIZE DUAL APPROVAL (POLICY A)
// ============================================================================

export async function requestFirstPrizeApproval(input: {
  drawId: string;
  prizeId: string;
  snapshotId: string;
}): Promise<ActionResponse<{ approvalId: string }>> {
  try {
    const user = await requireAuth();
    const isSuperAdmin = await hasCurrentUserRole("SUPER_ADMIN");

    if (!isSuperAdmin) {
      return {
        success: false,
        error: "Four-eyes Policy Violation: Only a SUPER_ADMIN can initiate 1st Prize dual approval.",
      };
    }

    const validated = z
      .object({
        drawId: UuidSchema,
        prizeId: UuidSchema,
        snapshotId: UuidSchema,
      })
      .parse(input);

    const admin = createSupabaseAdminClient();

    const { data: approvalId, error: rpcErr } = await admin.rpc("admin_request_first_prize_approval", {
      p_draw_id: validated.drawId,
      p_prize_id: validated.prizeId,
      p_snapshot_id: validated.snapshotId,
      p_actor: user.id,
    });

    if (rpcErr) {
      return { success: false, error: rpcErr.message };
    }

    revalidatePath("/admin/draw");
    return { success: true, data: { approvalId } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ============================================================================
// 7. RECORD FIRST PRIZE DUAL APPROVAL (POLICY A)
// ============================================================================

export async function recordFirstPrizeApproval(input: {
  approvalId: string;
  decision: "APPROVED" | "REJECTED";
  notes?: string;
}): Promise<ActionResponse<{ success: boolean }>> {
  try {
    const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);
    const validated = ApprovalDecisionSchema.parse(input);

    const admin = createSupabaseAdminClient();

    // Check approval record
    const { data: approval } = await admin
      .from("draw_approvals")
      .select("initiator_id, status")
      .eq("id", validated.approvalId)
      .single();

    if (!approval) {
      return { success: false, error: "Approval request not found." };
    }

    if (approval.initiator_id === user.id) {
      return {
        success: false,
        error: "Policy A Violation: Self-approval is strictly forbidden. A different administrator must review this request.",
      };
    }

    const { error: rpcErr } = await admin.rpc("admin_record_first_prize_approval", {
      p_approval_id: validated.approvalId,
      p_decision: validated.decision,
      p_notes: validated.notes,
      p_actor: user.id,
    });

    if (rpcErr) {
      return { success: false, error: rpcErr.message };
    }

    revalidatePath("/admin/draw");
    return { success: true, data: { success: true } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ============================================================================
// 8. EXECUTE PRIZE DRAW (CSPRNG WINNER SELECTION)
// ============================================================================

export async function executePrizeDraw(input: {
  drawId: string;
  prizeId: string;
  snapshotId: string;
  clientEntropy?: string;
}): Promise<ActionResponse<{
  resultId: string;
  winningTicketNumber: string;
  winningIndex: number;
  result: DrawResultRecord;
}>> {
  try {
    const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);
    const validated = DrawExecutionSchema.parse(input);

    const admin = createSupabaseAdminClient();

    // 1. Fetch draw session and prize
    const { data: draw } = await admin.from("draws").select("*").eq("id", validated.drawId).single();
    if (!draw) return { success: false, error: "Draw session not found." };

    const { data: prize } = await admin.from("prizes").select("*").eq("id", validated.prizeId).single();
    if (!prize) return { success: false, error: "Prize not found." };

    // 2. Fetch locked snapshot
    const { data: snapshot } = await admin
      .from("draw_eligibility_snapshots")
      .select("*")
      .eq("id", validated.snapshotId)
      .eq("is_locked", true)
      .single();

    if (!snapshot) {
      return { success: false, error: "Locked eligibility snapshot not found for this prize." };
    }

    // 3. First Prize dual-approval check
    if (prize.prize_number === 1) {
      const { data: approval } = await admin
        .from("draw_approvals")
        .select("status, initiator_id, approver_id")
        .eq("draw_id", validated.drawId)
        .eq("prize_id", validated.prizeId)
        .eq("snapshot_hash", snapshot.snapshot_hash)
        .eq("status", "APPROVED")
        .maybeSingle();

      if (!approval || approval.initiator_id === approval.approver_id) {
        return {
          success: false,
          error: "Dual authorization required: 1st Prize cannot be executed without confirmed approval by a separate administrator.",
        };
      }
    }

    // 4. Generate CSPRNG server entropy or use pre-committed seed
    let serverSeed: string;
    let seedCommitment: string;

    if (draw.seed_commitment && draw.seed_revealed) {
      // Re-use session seed if already pre-committed and revealed
      serverSeed = draw.seed_revealed;
      seedCommitment = draw.seed_commitment;
    } else {
      const entropy = generateServerSeed();
      serverSeed = entropy.serverSeed;
      seedCommitment = entropy.seedCommitment;
    }

    // 5. Operator / Client entropy contribution
    const clientEntropy = validated.clientEntropy || `${Date.now()}:${Math.floor(Math.random() * 1000000)}`;

    // 6. Compute combined seed & derive winning index deterministically (zero modulo bias)
    const combinedSeed = computeCombinedSeed(serverSeed, clientEntropy, snapshot.snapshot_hash, validated.prizeId);
    const winningIndex = deriveWinningIndex(combinedSeed, snapshot.total_eligible_count);

    // 7. Invoke authoritative Phase 9C execution RPC
    const { data: rpcRes, error: execErr } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: validated.drawId,
      p_prize_id: validated.prizeId,
      p_snapshot_id: validated.snapshotId,
      p_winning_index: winningIndex,
      p_seed_commitment: seedCommitment,
      p_seed_revealed: serverSeed,
      p_combined_seed: combinedSeed,
      p_actor: user.id,
      p_client_entropy: clientEntropy,
    });

    if (execErr) {
      return { success: false, error: execErr.message };
    }

    const { data: createdResult } = await admin
      .from("draw_results")
      .select(`
        *,
        prizes:prize_id (
          prize_number,
          title
        ),
        tickets:ticket_id (
          ticket_number,
          customer_id,
          seller_id,
          customers:customer_id (
            full_name,
            email,
            phone
          ),
          sellers:seller_id (
            display_name,
            seller_code
          )
        )
      `)
      .eq("id", rpcRes.result_id)
      .single();

    const resultRecord: DrawResultRecord = {
      id: createdResult?.id || rpcRes.result_id,
      draw_id: createdResult?.draw_id || validated.drawId,
      campaign_id: createdResult?.campaign_id || prize.campaign_id,
      prize_id: createdResult?.prize_id || validated.prizeId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prize_number: (createdResult?.prizes as any)?.prize_number ?? prize.prize_number,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prize_title: (createdResult?.prizes as any)?.title ?? prize.title,
      ticket_id: createdResult?.ticket_id || rpcRes.ticket_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ticket_number: (createdResult?.tickets as any)?.ticket_number ?? rpcRes.ticket_number,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      customer_id: (createdResult?.tickets as any)?.customer_id ?? "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      customer_name: (createdResult?.tickets as any)?.customers?.full_name ?? "Supporter",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      customer_email: (createdResult?.tickets as any)?.customers?.email,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      customer_phone: (createdResult?.tickets as any)?.customers?.phone,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      seller_id: (createdResult?.tickets as any)?.seller_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      seller_name: (createdResult?.tickets as any)?.sellers?.display_name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      seller_code: (createdResult?.tickets as any)?.sellers?.seller_code,
      snapshot_id: createdResult?.snapshot_id || validated.snapshotId,
      selection_index: createdResult?.selection_index ?? winningIndex,
      seed_commitment: createdResult?.seed_commitment || seedCommitment,
      seed_revealed: createdResult?.seed_revealed || serverSeed,
      combined_seed: createdResult?.combined_seed || combinedSeed,
      drawn_by: createdResult?.drawn_by || user.id,
      notified_at: createdResult?.notified_at ?? null,
      notified_by: createdResult?.notified_by ?? null,
      notification_outbox_id: createdResult?.notification_outbox_id ?? null,
      created_at: createdResult?.created_at || new Date().toISOString(),
    };

    revalidatePath("/admin/draw");

    return {
      success: true,
      data: {
        resultId: rpcRes.result_id,
        winningTicketNumber: rpcRes.ticket_number,
        winningIndex,
        result: resultRecord,
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ============================================================================
// 9. VERIFY DRAW EVIDENCE
// ============================================================================

export async function verifyDrawEvidenceAction(evidenceId: string): Promise<ActionResponse<{
  isValid: boolean;
  evidence: RandomnessEvidence;
  details: string[];
}>> {
  try {
    const admin = createSupabaseAdminClient();

    const { data: evidence, error: evErr } = await admin
      .from("draw_randomness_evidence")
      .select(`
        *,
        snapshot:snapshot_id (snapshot_hash)
      `)
      .eq("id", evidenceId)
      .single();

    if (evErr || !evidence) {
      return { success: false, error: "Randomness evidence not found." };
    }

    const snapshotHash = (evidence.snapshot as { snapshot_hash?: string })?.snapshot_hash || "";

    const verification = verifyDrawEvidence({
      serverSeedCommitment: evidence.server_seed_commitment,
      serverSeedRevealed: evidence.server_seed_revealed,
      clientEntropy: evidence.client_entropy,
      combinedSeed: evidence.combined_seed,
      snapshotHash,
      prizeId: evidence.prize_id,
      totalCandidates: evidence.total_candidates,
      selectedIndex: evidence.selected_index,
      winningTicketNumber: evidence.winning_ticket_number,
    });

    return {
      success: true,
      data: {
        isValid: verification.isValid,
        evidence: evidence as RandomnessEvidence,
        details: verification.details,
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ============================================================================
// 10. PREVIEW WINNER NOTIFICATION
// ============================================================================

export async function previewWinnerNotification(resultId: string): Promise<ActionResponse<{
  recipient: string;
  customerName: string;
  ticketNumber: string;
  prizeTitle: string;
  subject: string;
  text: string;
}>> {
  try {
    await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);
    const admin = createSupabaseAdminClient();

    const { data: result, error: fetchErr } = await admin
      .from("draw_results")
      .select(`
        id,
        created_at,
        prizes:prize_id (prize_number, title),
        tickets:ticket_id (
          ticket_number,
          order_id,
          customers:customer_id (full_name, email),
          sellers:seller_id (display_name, seller_code)
        ),
        campaigns:campaign_id (name)
      `)
      .eq("id", resultId)
      .single();

    if (fetchErr || !result) {
      return { success: false, error: "Result not found." };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customer = (result.tickets as any)?.customers;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prize = result.prizes as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const campaign = result.campaigns as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ticket = result.tickets as any;
    const seller = ticket?.sellers;

    const recipient = customer?.email || "";
    const drawDateFormatted = formatIstDateTime(result.created_at);
    const ticketAccessUrl = getCustomerOrderUrl(ticket?.order_id || "");

    const { subject, text } = renderEmailWinnerAnnouncedMessage({
      customerName: customer?.full_name || "Valued Supporter",
      ticketNumber: ticket?.ticket_number || "SSFI-TICKET",
      prizeTitle: prize?.title || "Lucky Draw Prize",
      prizeNumber: prize?.prize_number || 1,
      campaignName: campaign?.name || "SSFI Lucky Draw",
      drawDateFormatted,
      ticketAccessUrl,
      sellerName: seller ? `${seller.display_name} (${seller.seller_code})` : null,
      supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE || undefined,
      supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "Senthangstudents@gmail.com",
    });

    return {
      success: true,
      data: {
        recipient,
        customerName: customer?.full_name || "Supporter",
        ticketNumber: ticket?.ticket_number || "",
        prizeTitle: prize?.title || "",
        subject,
        text,
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ============================================================================
// 11. DISPATCH WINNER NOTIFICATION
// ============================================================================

export async function dispatchWinnerNotification(resultId: string): Promise<ActionResponse<{ outboxId: string }>> {
  try {
    const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

    const res = await enqueueWinnerNotification(resultId, user.id);
    if (!res.success) {
      return { success: false, error: res.error || "Failed to dispatch notification." };
    }

    revalidatePath("/admin/draw");
    return { success: true, data: { outboxId: res.outboxId || "" } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

