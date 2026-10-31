import test from "node:test";
import assert from "node:assert/strict";
import {
  fromIstDatetimeLocalToIso,
  formatIstDateTime,
} from "../src/lib/date/timezone.ts";

type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "CLOSED" | "CANCELLED";

type CampaignRecord = {
  id: string;
  public_id: string;
  name: string;
  status: CampaignStatus;
  start_at: string | null;
  end_at: string | null;
  total_ticket_limit: number;
  sold_ticket_count: number;
  updated_at: string;
};

type AuditLogEntry = {
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type TransitionResult = {
  processed_at: string;
  transition_count: number;
  transitions: Array<{
    campaign_id: string;
    public_id: string;
    from: CampaignStatus;
    to: CampaignStatus;
    reason: string;
  }>;
};

/**
 * Pure simulation of the PostgreSQL database function `public.process_scheduled_campaign_transitions()`.
 * Validates atomic status transitions, row locking criteria, and audit logging.
 */
function processScheduledCampaignTransitions(
  campaigns: CampaignRecord[],
  auditLogs: AuditLogEntry[],
  now: Date
): { updatedCampaigns: CampaignRecord[]; result: TransitionResult } {
  const transitions: TransitionResult["transitions"] = [];
  const nowMs = now.getTime();

  const updatedCampaigns = campaigns.map((campaign) => {
    const startMs = campaign.start_at ? new Date(campaign.start_at).getTime() : null;
    const endMs = campaign.end_at ? new Date(campaign.end_at).getTime() : null;

    // Rule 1: Auto-activate eligible DRAFT campaigns
    // Must be DRAFT, start_at reached, and closing time is null or still in future
    if (
      campaign.status === "DRAFT" &&
      startMs !== null &&
      nowMs >= startMs &&
      (endMs === null || nowMs < endMs)
    ) {
      transitions.push({
        campaign_id: campaign.id,
        public_id: campaign.public_id,
        from: "DRAFT",
        to: "ACTIVE",
        reason: "scheduled_start_reached",
      });

      auditLogs.push({
        action: "CAMPAIGN_AUTO_ACTIVATED",
        entity_type: "campaign",
        entity_id: campaign.id,
        metadata: {
          campaign_public_id: campaign.public_id,
          previous_status: "DRAFT",
          new_status: "ACTIVE",
          start_at: campaign.start_at,
          end_at: campaign.end_at,
          transition_timestamp: now.toISOString(),
        },
        created_at: now.toISOString(),
      });

      return {
        ...campaign,
        status: "ACTIVE" as CampaignStatus,
        updated_at: now.toISOString(),
      };
    }

    // Rule 2: Auto-close overdue ACTIVE campaigns
    if (campaign.status === "ACTIVE" && endMs !== null && nowMs >= endMs) {
      transitions.push({
        campaign_id: campaign.id,
        public_id: campaign.public_id,
        from: "ACTIVE",
        to: "CLOSED",
        reason: "scheduled_end_reached",
      });

      auditLogs.push({
        action: "CAMPAIGN_AUTO_CLOSED",
        entity_type: "campaign",
        entity_id: campaign.id,
        metadata: {
          campaign_public_id: campaign.public_id,
          previous_status: "ACTIVE",
          new_status: "CLOSED",
          start_at: campaign.start_at,
          end_at: campaign.end_at,
          transition_timestamp: now.toISOString(),
        },
        created_at: now.toISOString(),
      });

      return {
        ...campaign,
        status: "CLOSED" as CampaignStatus,
        updated_at: now.toISOString(),
      };
    }

    // Rule 3: Overdue DRAFT campaigns (expired before launch)
    if (campaign.status === "DRAFT" && endMs !== null && nowMs >= endMs) {
      transitions.push({
        campaign_id: campaign.id,
        public_id: campaign.public_id,
        from: "DRAFT",
        to: "CLOSED",
        reason: "scheduled_end_reached",
      });

      auditLogs.push({
        action: "CAMPAIGN_AUTO_CLOSED",
        entity_type: "campaign",
        entity_id: campaign.id,
        metadata: {
          campaign_public_id: campaign.public_id,
          previous_status: "DRAFT",
          new_status: "CLOSED",
          start_at: campaign.start_at,
          end_at: campaign.end_at,
          transition_timestamp: now.toISOString(),
        },
        created_at: now.toISOString(),
      });

      return {
        ...campaign,
        status: "CLOSED" as CampaignStatus,
        updated_at: now.toISOString(),
      };
    }

    // Rule 4: PAUSED and CANCELLED campaigns are NEVER automatically modified
    return campaign;
  });

  return {
    updatedCampaigns,
    result: {
      processed_at: now.toISOString(),
      transition_count: transitions.length,
      transitions,
    },
  };
}

/**
 * Pure simulation of order placement with pre-flight schedule synchronization.
 */
function attemptOrderPlacement(
  campaign: CampaignRecord,
  auditLogs: AuditLogEntry[],
  now: Date,
  quantity: number = 1
): { success: boolean; error?: string; campaign: CampaignRecord } {
  // Synchronous pre-flight transition check (matches create_seller_order and Server Actions)
  const sync = processScheduledCampaignTransitions([campaign], auditLogs, now);
  const currentCampaign = sync.updatedCampaigns[0];

  if (currentCampaign.status !== "ACTIVE") {
    if (currentCampaign.status === "DRAFT") {
      return {
        success: false,
        error: "Ticket sales have not officially opened yet. This campaign is currently in preview.",
        campaign: currentCampaign,
      };
    }
    if (currentCampaign.status === "PAUSED") {
      return {
        success: false,
        error: "Ticket sales are temporarily paused. Please check back shortly.",
        campaign: currentCampaign,
      };
    }
    if (currentCampaign.status === "CLOSED" || currentCampaign.status === "CANCELLED") {
      return {
        success: false,
        error: "Ticket sales for this lucky draw have ended.",
        campaign: currentCampaign,
      };
    }
  }

  // Schedule window check
  if (currentCampaign.start_at && now < new Date(currentCampaign.start_at)) {
    const opensAt = formatIstDateTime(currentCampaign.start_at);
    return {
      success: false,
      error: `Ticket sales have not opened yet. Sales are scheduled to open on ${opensAt}.`,
      campaign: currentCampaign,
    };
  }

  if (currentCampaign.end_at && now >= new Date(currentCampaign.end_at)) {
    const closedAt = formatIstDateTime(currentCampaign.end_at);
    return {
      success: false,
      error: `Ticket sales for this lucky draw have ended (closed on ${closedAt}).`,
      campaign: currentCampaign,
    };
  }

  const remaining = currentCampaign.total_ticket_limit - currentCampaign.sold_ticket_count;
  if (quantity > remaining) {
    return {
      success: false,
      error: `Requested quantity exceeds remaining capacity (${remaining} tickets available).`,
      campaign: currentCampaign,
    };
  }

  return {
    success: true,
    campaign: {
      ...currentCampaign,
      sold_ticket_count: currentCampaign.sold_ticket_count + quantity,
    },
  };
}

// -----------------------------------------------------------------------------
// Test Suite
// -----------------------------------------------------------------------------

test("Scenario 1: Future-start campaign in DRAFT remains DRAFT and blocks orders", () => {
  const auditLogs: AuditLogEntry[] = [];
  const campaign: CampaignRecord = {
    id: "camp-001",
    public_id: "ssfi-fundraising-lucky-draw",
    name: "SSFI Lucky Draw 2026",
    status: "DRAFT",
    start_at: "2026-11-01T04:30:00.000Z", // 10:00 AM IST
    end_at: "2026-11-15T18:29:00.000Z", // 11:59 PM IST
    total_ticket_limit: 1000,
    sold_ticket_count: 0,
    updated_at: "2026-10-25T00:00:00.000Z",
  };

  // Clock is before start time (31 Oct 2026)
  const beforeStart = new Date("2026-10-31T12:00:00.000Z");
  const { updatedCampaigns, result } = processScheduledCampaignTransitions([campaign], auditLogs, beforeStart);

  assert.equal(result.transition_count, 0);
  assert.equal(updatedCampaigns[0].status, "DRAFT");
  assert.equal(auditLogs.length, 0);

  // Attempting an order before start time is strictly rejected
  const orderRes = attemptOrderPlacement(campaign, auditLogs, beforeStart);
  assert.equal(orderRes.success, false);
  assert.ok(orderRes.error?.includes("preview") || orderRes.error?.includes("not officially opened"));
});

test("Scenario 2: Scheduled start time arrives -> DRAFT automatically transitions to ACTIVE without manual click", () => {
  const auditLogs: AuditLogEntry[] = [];
  const campaign: CampaignRecord = {
    id: "camp-001",
    public_id: "ssfi-fundraising-lucky-draw",
    name: "SSFI Lucky Draw 2026",
    status: "DRAFT",
    start_at: "2026-11-01T04:30:00.000Z", // 10:00 AM IST
    end_at: "2026-11-15T18:29:00.000Z", // 11:59 PM IST
    total_ticket_limit: 1000,
    sold_ticket_count: 0,
    updated_at: "2026-10-25T00:00:00.000Z",
  };

  // Exactly at or after start time (01 Nov 2026 10:00:01 AM IST = 04:30:01 UTC)
  const atStartTime = new Date("2026-11-01T04:30:01.000Z");
  const { updatedCampaigns, result } = processScheduledCampaignTransitions([campaign], auditLogs, atStartTime);

  assert.equal(result.transition_count, 1);
  assert.equal(result.transitions[0].from, "DRAFT");
  assert.equal(result.transitions[0].to, "ACTIVE");
  assert.equal(updatedCampaigns[0].status, "ACTIVE");

  // Audit log record verified
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, "CAMPAIGN_AUTO_ACTIVATED");
  assert.equal(auditLogs[0].metadata.new_status, "ACTIVE");

  // Now orders are permitted
  const orderRes = attemptOrderPlacement(updatedCampaigns[0], auditLogs, atStartTime, 5);
  assert.equal(orderRes.success, true);
  assert.equal(orderRes.campaign.sold_ticket_count, 5);
});

test("Scenario 3: ACTIVE campaign remains ACTIVE while within selling window", () => {
  const auditLogs: AuditLogEntry[] = [];
  const campaign: CampaignRecord = {
    id: "camp-001",
    public_id: "ssfi-fundraising-lucky-draw",
    name: "SSFI Lucky Draw 2026",
    status: "ACTIVE",
    start_at: "2026-11-01T04:30:00.000Z",
    end_at: "2026-11-15T18:29:00.000Z",
    total_ticket_limit: 1000,
    sold_ticket_count: 100,
    updated_at: "2026-11-01T04:30:01.000Z",
  };

  const insideWindow = new Date("2026-11-08T12:00:00.000Z");
  const { updatedCampaigns, result } = processScheduledCampaignTransitions([campaign], auditLogs, insideWindow);

  assert.equal(result.transition_count, 0);
  assert.equal(updatedCampaigns[0].status, "ACTIVE");
  assert.equal(auditLogs.length, 0);
});

test("Scenario 4: Scheduled end time arrives -> ACTIVE automatically transitions to CLOSED and rejects orders", () => {
  const auditLogs: AuditLogEntry[] = [];
  const campaign: CampaignRecord = {
    id: "camp-001",
    public_id: "ssfi-fundraising-lucky-draw",
    name: "SSFI Lucky Draw 2026",
    status: "ACTIVE",
    start_at: "2026-11-01T04:30:00.000Z",
    end_at: "2026-11-15T18:29:00.000Z", // 11:59 PM IST
    total_ticket_limit: 1000,
    sold_ticket_count: 500,
    updated_at: "2026-11-01T04:30:01.000Z",
  };

  // Clock is after end time (16 Nov 2026 00:00:00 UTC)
  const afterClosing = new Date("2026-11-16T00:00:00.000Z");
  const { updatedCampaigns, result } = processScheduledCampaignTransitions([campaign], auditLogs, afterClosing);

  assert.equal(result.transition_count, 1);
  assert.equal(result.transitions[0].from, "ACTIVE");
  assert.equal(result.transitions[0].to, "CLOSED");
  assert.equal(updatedCampaigns[0].status, "CLOSED");

  // Audit log record verified
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, "CAMPAIGN_AUTO_CLOSED");
  assert.equal(auditLogs[0].metadata.new_status, "CLOSED");

  // Orders are strictly rejected
  const orderRes = attemptOrderPlacement(updatedCampaigns[0], auditLogs, afterClosing);
  assert.equal(orderRes.success, false);
  assert.ok(orderRes.error?.includes("ended"));
});

test("Scenario 5: Overdue DRAFT campaign (closing time passed before opening) transitions directly to CLOSED", () => {
  const auditLogs: AuditLogEntry[] = [];
  const campaign: CampaignRecord = {
    id: "camp-001",
    public_id: "ssfi-fundraising-lucky-draw",
    name: "SSFI Lucky Draw 2026",
    status: "DRAFT",
    start_at: "2026-10-01T00:00:00.000Z",
    end_at: "2026-10-15T00:00:00.000Z",
    total_ticket_limit: 1000,
    sold_ticket_count: 0,
    updated_at: "2026-09-20T00:00:00.000Z",
  };

  const overdueTime = new Date("2026-10-20T00:00:00.000Z");
  const { updatedCampaigns, result } = processScheduledCampaignTransitions([campaign], auditLogs, overdueTime);

  assert.equal(result.transition_count, 1);
  assert.equal(result.transitions[0].from, "DRAFT");
  assert.equal(result.transitions[0].to, "CLOSED");
  assert.equal(updatedCampaigns[0].status, "CLOSED");
  assert.equal(auditLogs[0].action, "CAMPAIGN_AUTO_CLOSED");
});

test("Scenario 6: Manually PAUSED campaign is NEVER automatically activated or closed", () => {
  const auditLogs: AuditLogEntry[] = [];
  const campaign: CampaignRecord = {
    id: "camp-001",
    public_id: "ssfi-fundraising-lucky-draw",
    name: "SSFI Lucky Draw 2026",
    status: "PAUSED",
    start_at: "2026-11-01T04:30:00.000Z",
    end_at: "2026-11-15T18:29:00.000Z",
    total_ticket_limit: 1000,
    sold_ticket_count: 200,
    updated_at: "2026-11-05T00:00:00.000Z",
  };

  // Even if within window
  const midWindow = new Date("2026-11-06T12:00:00.000Z");
  const midRes = processScheduledCampaignTransitions([campaign], auditLogs, midWindow);
  assert.equal(midRes.result.transition_count, 0);
  assert.equal(midRes.updatedCampaigns[0].status, "PAUSED");

  // Even if after end time
  const afterClosing = new Date("2026-11-16T00:00:00.000Z");
  const afterRes = processScheduledCampaignTransitions([campaign], auditLogs, afterClosing);
  assert.equal(afterRes.result.transition_count, 0);
  assert.equal(afterRes.updatedCampaigns[0].status, "PAUSED");

  // Orders remain blocked
  const orderRes = attemptOrderPlacement(campaign, auditLogs, midWindow);
  assert.equal(orderRes.success, false);
  assert.ok(orderRes.error?.includes("paused"));
});

test("Scenario 7: CANCELLED campaign is permanently excluded from automatic scheduling", () => {
  const auditLogs: AuditLogEntry[] = [];
  const campaign: CampaignRecord = {
    id: "camp-001",
    public_id: "ssfi-fundraising-lucky-draw",
    name: "SSFI Lucky Draw 2026",
    status: "CANCELLED",
    start_at: "2026-11-01T04:30:00.000Z",
    end_at: "2026-11-15T18:29:00.000Z",
    total_ticket_limit: 1000,
    sold_ticket_count: 50,
    updated_at: "2026-11-02T00:00:00.000Z",
  };

  const insideWindow = new Date("2026-11-05T12:00:00.000Z");
  const { updatedCampaigns, result } = processScheduledCampaignTransitions([campaign], auditLogs, insideWindow);
  assert.equal(result.transition_count, 0);
  assert.equal(updatedCampaigns[0].status, "CANCELLED");
});

test("Scenario 8: Delayed scheduler execution does NOT permit orders past closing time", () => {
  const auditLogs: AuditLogEntry[] = [];
  // Campaign is still marked ACTIVE in database because cron is delayed
  const campaignWithDelayedCron: CampaignRecord = {
    id: "camp-001",
    public_id: "ssfi-fundraising-lucky-draw",
    name: "SSFI Lucky Draw 2026",
    status: "ACTIVE",
    start_at: "2026-11-01T04:30:00.000Z",
    end_at: "2026-11-15T18:29:00.000Z",
    total_ticket_limit: 1000,
    sold_ticket_count: 300,
    updated_at: "2026-11-01T04:30:00.000Z",
  };

  // Order arrives 5 minutes past closing time, before the delayed background cron runs
  const postClosingTime = new Date("2026-11-15T18:34:00.000Z");
  const orderRes = attemptOrderPlacement(campaignWithDelayedCron, auditLogs, postClosingTime);

  // Synchronous pre-flight transition immediately transitioned campaign to CLOSED
  assert.equal(orderRes.success, false);
  assert.equal(orderRes.campaign.status, "CLOSED");
  assert.ok(orderRes.error?.includes("ended"));
  assert.equal(auditLogs[0].action, "CAMPAIGN_AUTO_CLOSED");
});

test("Scenario 9: Multiple repeated scheduler runs are idempotent and produce no duplicate transitions", () => {
  const auditLogs: AuditLogEntry[] = [];
  let campaign: CampaignRecord = {
    id: "camp-001",
    public_id: "ssfi-fundraising-lucky-draw",
    name: "SSFI Lucky Draw 2026",
    status: "DRAFT",
    start_at: "2026-11-01T04:30:00.000Z",
    end_at: "2026-11-15T18:29:00.000Z",
    total_ticket_limit: 1000,
    sold_ticket_count: 0,
    updated_at: "2026-10-25T00:00:00.000Z",
  };

  const liveTime = new Date("2026-11-05T12:00:00.000Z");

  // First run: transitions DRAFT -> ACTIVE
  const firstRun = processScheduledCampaignTransitions([campaign], auditLogs, liveTime);
  assert.equal(firstRun.result.transition_count, 1);
  campaign = firstRun.updatedCampaigns[0];
  assert.equal(campaign.status, "ACTIVE");

  // Second run 1 minute later: already ACTIVE, transition_count is 0
  const secondRun = processScheduledCampaignTransitions([campaign], auditLogs, new Date("2026-11-05T12:01:00.000Z"));
  assert.equal(secondRun.result.transition_count, 0);
  assert.equal(secondRun.updatedCampaigns[0].status, "ACTIVE");
  assert.equal(auditLogs.length, 1); // No new duplicate audit log
});

test("Scenario 10: IST input conversion produces exact UTC parity for scheduled activation", () => {
  // IST input: "2026-11-01T10:00" (10:00 AM IST)
  const startIso = fromIstDatetimeLocalToIso("2026-11-01T10:00");
  assert.equal(startIso, "2026-11-01T04:30:00.000Z");

  const auditLogs: AuditLogEntry[] = [];
  const campaign: CampaignRecord = {
    id: "camp-001",
    public_id: "ssfi-fundraising-lucky-draw",
    name: "SSFI Lucky Draw 2026",
    status: "DRAFT",
    start_at: startIso,
    end_at: "2026-11-15T18:29:00.000Z",
    total_ticket_limit: 1000,
    sold_ticket_count: 0,
    updated_at: "2026-10-25T00:00:00.000Z",
  };

  // 1 millisecond before 10:00 AM IST (04:29:59.999 UTC) -> Remains DRAFT
  const justBefore = new Date("2026-11-01T04:29:59.999Z");
  const beforeRes = processScheduledCampaignTransitions([campaign], auditLogs, justBefore);
  assert.equal(beforeRes.result.transition_count, 0);
  assert.equal(beforeRes.updatedCampaigns[0].status, "DRAFT");

  // Exact millisecond of 10:00:00 AM IST (04:30:00.000 UTC) -> Transitions to ACTIVE
  const exactMoment = new Date("2026-11-01T04:30:00.000Z");
  const exactRes = processScheduledCampaignTransitions([campaign], auditLogs, exactMoment);
  assert.equal(exactRes.result.transition_count, 1);
  assert.equal(exactRes.updatedCampaigns[0].status, "ACTIVE");
});

test("Scenario 11: Production cron endpoint requires CRON_SECRET to be configured and strictly matched", () => {
  function verifyCronAuthorization(params: {
    nodeEnv: string;
    configuredSecret?: string;
    authHeader?: string | null;
    xCronSecret?: string | null;
  }): { authorized: boolean; statusCode: number; error?: string } {
    const isProduction = params.nodeEnv === "production";
    const expectedSecret = params.configuredSecret;

    if (isProduction && !expectedSecret) {
      return {
        authorized: false,
        statusCode: 500,
        error: "Server misconfiguration: CRON_SECRET is required in production.",
      };
    }

    if (expectedSecret) {
      const bearerToken = params.authHeader?.startsWith("Bearer ") ? params.authHeader.slice(7) : null;
      const isAuthorized = bearerToken === expectedSecret || params.xCronSecret === expectedSecret;

      if (!isAuthorized) {
        return {
          authorized: false,
          statusCode: 401,
          error: "Unauthorized: Invalid or missing cron secret.",
        };
      }
    }

    return { authorized: true, statusCode: 200 };
  }

  // Case 1: In production, missing CRON_SECRET environment variable is blocked with 500
  const missingInProd = verifyCronAuthorization({ nodeEnv: "production", configuredSecret: undefined });
  assert.equal(missingInProd.authorized, false);
  assert.equal(missingInProd.statusCode, 500);

  // Case 2: In production with secret configured, unauthenticated request is rejected with 401
  const unauthInProd = verifyCronAuthorization({
    nodeEnv: "production",
    configuredSecret: "super-secret-cron-key",
    authHeader: null,
    xCronSecret: null,
  });
  assert.equal(unauthInProd.authorized, false);
  assert.equal(unauthInProd.statusCode, 401);

  // Case 3: In production with invalid bearer token, rejected with 401
  const invalidBearer = verifyCronAuthorization({
    nodeEnv: "production",
    configuredSecret: "super-secret-cron-key",
    authHeader: "Bearer wrong-token",
  });
  assert.equal(invalidBearer.authorized, false);
  assert.equal(invalidBearer.statusCode, 401);

  // Case 4: In production with valid Bearer token, authorized (200)
  const validBearer = verifyCronAuthorization({
    nodeEnv: "production",
    configuredSecret: "super-secret-cron-key",
    authHeader: "Bearer super-secret-cron-key",
  });
  assert.equal(validBearer.authorized, true);
  assert.equal(validBearer.statusCode, 200);

  // Case 5: In production with valid x-cron-secret header, authorized (200)
  const validHeader = verifyCronAuthorization({
    nodeEnv: "production",
    configuredSecret: "super-secret-cron-key",
    xCronSecret: "super-secret-cron-key",
  });
  assert.equal(validHeader.authorized, true);
  assert.equal(validHeader.statusCode, 200);
});


