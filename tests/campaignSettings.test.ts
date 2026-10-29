import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCampaignSchedule,
  formatIstDateTime,
  toIstDatetimeLocalString,
  fromIstDatetimeLocalToIso,
} from "../src/lib/date/timezone.ts";

type Role = "SUPER_ADMIN" | "ADMIN" | "FUNDRAISING_MANAGER" | "SELLER" | "CUSTOMER";

type CampaignState = {
  id: string;
  public_id: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "CLOSED" | "CANCELLED";
  start_at: string | null;
  end_at: string | null;
  total_ticket_limit: number;
  sold_ticket_count: number;
};

type SellerState = {
  id: string;
  seller_code: string;
  is_active: boolean;
};

/**
 * Pure simulation of Campaign Settings authorization guard.
 * Only SUPER_ADMIN and ADMIN are permitted to modify campaign settings.
 */
function authorizeCampaignModification(userRole: Role): { authorized: boolean; error?: string } {
  if (userRole === "SUPER_ADMIN" || userRole === "ADMIN") {
    return { authorized: true };
  }
  return {
    authorized: false,
    error: "Unauthorized: Administrator privileges required to manage campaign settings.",
  };
}

/**
 * Pure simulation of schedule validation.
 */
function validateScheduleInputs(
  startAtIst: string,
  endAtIst: string
): { valid: boolean; startIso?: string | null; endIso?: string | null; error?: string } {
  const startIso = fromIstDatetimeLocalToIso(startAtIst);
  const endIso = fromIstDatetimeLocalToIso(endAtIst);

  if (startIso && endIso) {
    const startTime = new Date(startIso).getTime();
    const endTime = new Date(endIso).getTime();
    if (endTime <= startTime) {
      return {
        valid: false,
        error: "Closing date and time must be strictly after the opening date and time.",
      };
    }
  }

  return { valid: true, startIso, endIso };
}

/**
 * Pure simulation of order placement guard across public and seller channels.
 */
function validateOrderPlacement(
  seller: SellerState | null,
  campaign: CampaignState | null,
  quantity: number,
  currentTime: Date
): { allowed: boolean; error?: string } {
  if (!seller) {
    return { allowed: false, error: "Seller account unavailable or not found." };
  }
  if (!seller.is_active) {
    return { allowed: false, error: "The seller associated with this order is currently inactive." };
  }
  if (!campaign) {
    return { allowed: false, error: "Fundraising campaign configuration was not found." };
  }

  // 1. Status Check
  if (campaign.status !== "ACTIVE") {
    if (campaign.status === "PAUSED") {
      return { allowed: false, error: "Ticket sales are temporarily paused. Please check back shortly." };
    }
    if (campaign.status === "DRAFT") {
      return { allowed: false, error: "Ticket sales have not officially opened yet. This campaign is currently in preview." };
    }
    if (campaign.status === "CLOSED" || campaign.status === "CANCELLED") {
      return { allowed: false, error: "Ticket sales for this lucky draw have ended." };
    }
    return { allowed: false, error: `Ticket sales are currently not active (campaign status: ${campaign.status}).` };
  }

  // 2. Schedule Window Check
  if (campaign.start_at && currentTime < new Date(campaign.start_at)) {
    const opensAt = formatIstDateTime(campaign.start_at);
    return { allowed: false, error: `Ticket sales have not opened yet. Sales are scheduled to open on ${opensAt}.` };
  }

  if (campaign.end_at && currentTime >= new Date(campaign.end_at)) {
    const closedAt = formatIstDateTime(campaign.end_at);
    return { allowed: false, error: `Ticket sales for this lucky draw have ended (closed on ${closedAt}).` };
  }

  // 3. Capacity Check
  const remaining = Math.max(0, campaign.total_ticket_limit - campaign.sold_ticket_count);
  if (quantity < 1 || quantity > remaining) {
    return { allowed: false, error: `Sorry, the requested quantity (${quantity}) exceeds remaining campaign capacity (${remaining} tickets available).` };
  }

  return { allowed: true };
}

test("Unauthorized users, staff managers, and sellers cannot modify campaign settings", () => {
  assert.equal(authorizeCampaignModification("SUPER_ADMIN").authorized, true);
  assert.equal(authorizeCampaignModification("ADMIN").authorized, true);

  const managerAuth = authorizeCampaignModification("FUNDRAISING_MANAGER");
  assert.equal(managerAuth.authorized, false);
  assert.ok(managerAuth.error?.includes("Administrator privileges required"));

  const sellerAuth = authorizeCampaignModification("SELLER");
  assert.equal(sellerAuth.authorized, false);
  assert.ok(sellerAuth.error?.includes("Administrator privileges required"));

  const customerAuth = authorizeCampaignModification("CUSTOMER");
  assert.equal(customerAuth.authorized, false);
});

test("Schedule validation accepts valid opening/closing windows and rejects closing before opening", () => {
  // Valid schedule: 01 Nov 2026 10:00 to 15 Nov 2026 23:59 IST
  const validRes = validateScheduleInputs("2026-11-01T10:00", "2026-11-15T23:59");
  assert.equal(validRes.valid, true);
  assert.ok(validRes.startIso?.includes("2026-11-01"));
  assert.ok(validRes.endIso?.includes("2026-11-15"));

  // Invalid: Closing before opening
  const invalidRes = validateScheduleInputs("2026-11-15T10:00", "2026-11-01T10:00");
  assert.equal(invalidRes.valid, false);
  assert.equal(invalidRes.error, "Closing date and time must be strictly after the opening date and time.");

  // Invalid: Closing equal to opening
  const equalRes = validateScheduleInputs("2026-11-01T10:00", "2026-11-01T10:00");
  assert.equal(equalRes.valid, false);
  assert.equal(equalRes.error, "Closing date and time must be strictly after the opening date and time.");
});

test("Timezone conversion to and from IST datetime-local string preserves exact moments", () => {
  // 10:00 AM IST on 01 Nov 2026 is 04:30 AM UTC
  const iso = fromIstDatetimeLocalToIso("2026-11-01T10:00");
  assert.equal(iso, "2026-11-01T04:30:00.000Z");

  // Re-converting 04:30 AM UTC back to IST datetime-local format gives exactly "2026-11-01T10:00"
  const formattedInput = toIstDatetimeLocalString(iso);
  assert.equal(formattedInput, "2026-11-01T10:00");
});

test("DRAFT, PAUSED, CLOSED, and CANCELLED statuses block sales regardless of timestamps", () => {
  const seller: SellerState = { id: "s-1", seller_code: "SELLER-001", is_active: true };
  const mockNow = new Date("2026-11-05T12:00:00Z");

  const baseCampaign: CampaignState = {
    id: "c-1",
    public_id: "ssfi-fundraising-lucky-draw",
    status: "DRAFT",
    start_at: "2026-11-01T00:00:00Z",
    end_at: "2026-11-15T00:00:00Z",
    total_ticket_limit: 1000,
    sold_ticket_count: 0,
  };

  // DRAFT
  const draftRes = validateOrderPlacement(seller, baseCampaign, 2, mockNow);
  assert.equal(draftRes.allowed, false);
  assert.ok(draftRes.error?.includes("preview") || draftRes.error?.includes("draft"));

  // PAUSED
  const pausedRes = validateOrderPlacement(seller, { ...baseCampaign, status: "PAUSED" }, 2, mockNow);
  assert.equal(pausedRes.allowed, false);
  assert.ok(pausedRes.error?.includes("paused"));

  // CLOSED
  const closedRes = validateOrderPlacement(seller, { ...baseCampaign, status: "CLOSED" }, 2, mockNow);
  assert.equal(closedRes.allowed, false);
  assert.ok(closedRes.error?.includes("ended"));

  // CANCELLED
  const cancelledRes = validateOrderPlacement(seller, { ...baseCampaign, status: "CANCELLED" }, 2, mockNow);
  assert.equal(cancelledRes.allowed, false);
  assert.ok(cancelledRes.error?.includes("ended"));
});

test("ACTIVE campaign before opening timestamp strictly blocks order creation", () => {
  const seller: SellerState = { id: "s-1", seller_code: "SELLER-001", is_active: true };
  const campaign: CampaignState = {
    id: "c-1",
    public_id: "ssfi-fundraising-lucky-draw",
    status: "ACTIVE",
    start_at: "2026-11-01T04:30:00Z", // 10:00 AM IST
    end_at: "2026-11-15T18:29:00Z", // 11:59 PM IST
    total_ticket_limit: 1000,
    sold_ticket_count: 0,
  };

  // Current time is 31 Oct 2026 (before opening)
  const beforeOpening = new Date("2026-10-31T10:00:00Z");
  const res = validateOrderPlacement(seller, campaign, 2, beforeOpening);
  assert.equal(res.allowed, false);
  assert.ok(res.error?.includes("sales have not opened yet") || res.error?.includes("Ticket sales have not opened yet"));
  assert.ok(res.error?.includes("01 Nov 2026"));
});

test("ACTIVE campaign within schedule window permits order creation when all guards pass", () => {
  const seller: SellerState = { id: "s-1", seller_code: "SELLER-001", is_active: true };
  const campaign: CampaignState = {
    id: "c-1",
    public_id: "ssfi-fundraising-lucky-draw",
    status: "ACTIVE",
    start_at: "2026-11-01T04:30:00Z",
    end_at: "2026-11-15T18:29:00Z",
    total_ticket_limit: 1000,
    sold_ticket_count: 250,
  };

  // Current time is 05 Nov 2026 (inside schedule)
  const insideSchedule = new Date("2026-11-05T10:00:00Z");
  const res = validateOrderPlacement(seller, campaign, 5, insideSchedule);
  assert.equal(res.allowed, true);
  assert.equal(res.error, undefined);
});

test("ACTIVE campaign at or after closing timestamp blocks order creation", () => {
  const seller: SellerState = { id: "s-1", seller_code: "SELLER-001", is_active: true };
  const campaign: CampaignState = {
    id: "c-1",
    public_id: "ssfi-fundraising-lucky-draw",
    status: "ACTIVE",
    start_at: "2026-11-01T04:30:00Z",
    end_at: "2026-11-15T18:29:00Z",
    total_ticket_limit: 1000,
    sold_ticket_count: 250,
  };

  // Current time is 16 Nov 2026 (after closing)
  const afterClosing = new Date("2026-11-16T10:00:00Z");
  const res = validateOrderPlacement(seller, campaign, 1, afterClosing);
  assert.equal(res.allowed, false);
  assert.ok(res.error?.includes("have ended"));
});

test("Inactive seller cannot place orders even when campaign is ACTIVE and within schedule", () => {
  const inactiveSeller: SellerState = { id: "s-2", seller_code: "SELLER-002", is_active: false };
  const campaign: CampaignState = {
    id: "c-1",
    public_id: "ssfi-fundraising-lucky-draw",
    status: "ACTIVE",
    start_at: "2026-11-01T04:30:00Z",
    end_at: "2026-11-15T18:29:00Z",
    total_ticket_limit: 1000,
    sold_ticket_count: 0,
  };

  const insideSchedule = new Date("2026-11-05T10:00:00Z");
  const res = validateOrderPlacement(inactiveSeller, campaign, 2, insideSchedule);
  assert.equal(res.allowed, false);
  assert.ok(res.error?.includes("inactive"));
});

test("evaluateCampaignSchedule correctly classifies all states and targets", () => {
  const startAt = "2026-11-01T04:30:00.000Z";
  const endAt = "2026-11-15T18:29:00.000Z";

  // 1. DRAFT with scheduled future opening
  const draftScheduled = evaluateCampaignSchedule("DRAFT", startAt, endAt, new Date("2026-10-25T00:00:00Z"));
  assert.equal(draftScheduled.scheduleStatus, "DRAFT");
  assert.equal(draftScheduled.isSellingOpen, false);
  assert.equal(draftScheduled.countdownType, "OPENING");
  assert.equal(draftScheduled.countdownTarget, startAt);

  // 2. ACTIVE opening soon
  const activeUpcoming = evaluateCampaignSchedule("ACTIVE", startAt, endAt, new Date("2026-10-31T00:00:00Z"));
  assert.equal(activeUpcoming.scheduleStatus, "UPCOMING");
  assert.equal(activeUpcoming.isSellingOpen, false);
  assert.equal(activeUpcoming.countdownType, "OPENING");

  // 3. ACTIVE live selling window
  const activeLive = evaluateCampaignSchedule("ACTIVE", startAt, endAt, new Date("2026-11-05T00:00:00Z"));
  assert.equal(activeLive.scheduleStatus, "LIVE");
  assert.equal(activeLive.isSellingOpen, true);
  assert.equal(activeLive.countdownType, "CLOSING");
  assert.equal(activeLive.countdownTarget, endAt);

  // 4. ACTIVE expired selling window
  const activeExpired = evaluateCampaignSchedule("ACTIVE", startAt, endAt, new Date("2026-11-16T00:00:00Z"));
  assert.equal(activeExpired.scheduleStatus, "EXPIRED");
  assert.equal(activeExpired.isSellingOpen, false);
  assert.equal(activeExpired.countdownTarget, null);

  // 5. PAUSED
  const paused = evaluateCampaignSchedule("PAUSED", startAt, endAt, new Date("2026-11-05T00:00:00Z"));
  assert.equal(paused.scheduleStatus, "PAUSED");
  assert.equal(paused.isSellingOpen, false);
  assert.equal(paused.countdownTarget, null);

  // 6. CLOSED
  const closed = evaluateCampaignSchedule("CLOSED", startAt, endAt, new Date("2026-11-05T00:00:00Z"));
  assert.equal(closed.scheduleStatus, "CLOSED");
  assert.equal(closed.isSellingOpen, false);
});

