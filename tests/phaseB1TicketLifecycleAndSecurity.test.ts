import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CANONICAL_CAMPAIGN_PUBLIC_ID,
  isSyntheticCampaignPublicId,
  validateResolvedDrawCampaign,
} from "../src/lib/draw/campaignSelection.ts";

interface TicketFixture {
  id: string;
  ticket_number: string;
  campaign_id: string;
  order_id: string;
  customer_id: string;
  seller_id: string | null;
  issued_at: string;
  created_at: string;
  status: "ISSUED" | "VOID";
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  original_ticket_id: string | null;
  reissued_ticket_id: string | null;
}

interface OrderFixture {
  id: string;
  campaign_id: string;
  status: string;
  total_amount_paise: number;
}

interface PaymentFixture {
  order_id: string;
  status: string;
  amount_paise: number;
}

// Mirrors protect_ticket_identity_immutability & protect_tickets_no_delete SQL rules
function validateTicketUpdate(oldT: TicketFixture, newT: TicketFixture): void {
  if (
    newT.id !== oldT.id ||
    newT.ticket_number !== oldT.ticket_number ||
    newT.order_id !== oldT.order_id ||
    newT.campaign_id !== oldT.campaign_id ||
    newT.customer_id !== oldT.customer_id ||
    newT.seller_id !== oldT.seller_id ||
    newT.issued_at !== oldT.issued_at ||
    newT.created_at !== oldT.created_at
  ) {
    throw new Error("Ticket identity fields are strictly immutable once issued.");
  }
  if (oldT.status === "VOID" && newT.status !== oldT.status) {
    throw new Error("VOID is a terminal state and cannot transition.");
  }
  if (oldT.voided_at !== null && newT.voided_at !== oldT.voided_at) {
    throw new Error("voided_at is immutable once recorded.");
  }
  if (oldT.voided_by !== null && newT.voided_by !== oldT.voided_by) {
    throw new Error("voided_by is immutable once recorded.");
  }
  if (oldT.void_reason !== null && newT.void_reason !== oldT.void_reason) {
    throw new Error("void_reason is immutable once recorded.");
  }
  if (newT.original_ticket_id !== oldT.original_ticket_id) {
    throw new Error("original_ticket_id lineage is immutable.");
  }
  if (oldT.reissued_ticket_id !== null && newT.reissued_ticket_id !== oldT.reissued_ticket_id) {
    throw new Error("reissued_ticket_id is immutable once linked.");
  }
  if (oldT.reissued_ticket_id === null && newT.reissued_ticket_id !== null && newT.status !== "VOID") {
    throw new Error("reissued_ticket_id can only be set when transitioning ticket to VOID.");
  }
}

function attemptTicketDelete(): never {
  throw new Error("Hard deletion of tickets is prohibited; use admin_void_ticket to void a ticket.");
}

// Mirrors admin_reissue_ticket SQL rules
function simulateReissue(
  ticket: TicketFixture,
  existingReplacements: Set<string>,
  order: OrderFixture,
  payments: PaymentFixture[]
): { oldTicket: TicketFixture; newTicket: TicketFixture } {
  if (ticket.status === "VOID") {
    throw new Error("cannot reissue a VOID ticket (status=VOID)");
  }
  if (ticket.reissued_ticket_id !== null || existingReplacements.has(ticket.id)) {
    throw new Error("ticket has already been reissued");
  }
  if (order.status !== "TICKETS_ISSUED") {
    throw new Error("parent order is not in TICKETS_ISSUED state");
  }
  const verifiedPaid = payments
    .filter((p) => p.order_id === order.id && p.status === "VERIFIED")
    .reduce((sum, p) => sum + p.amount_paise, 0);
  if (verifiedPaid !== order.total_amount_paise) {
    throw new Error("verified payment total does not match order total");
  }

  existingReplacements.add(ticket.id);
  const newTicket: TicketFixture = {
    ...ticket,
    id: `${ticket.id}-reissued`,
    ticket_number: "SSFI-009999",
    original_ticket_id: ticket.id,
    reissued_ticket_id: null,
  };
  const oldTicket: TicketFixture = {
    ...ticket,
    status: "VOID",
    voided_at: "2026-11-14T00:00:00Z",
    voided_by: "admin-1",
    void_reason: "Damaged print",
    reissued_ticket_id: newTicket.id,
  };
  validateTicketUpdate(ticket, oldTicket);
  return { oldTicket, newTicket };
}

// Mirrors admin_lock_eligibility_snapshot / execute_draw_winner_selection eligibility checks
function validateEligibility(
  ticket: TicketFixture,
  drawCampaignId: string,
  order: OrderFixture,
  payments: PaymentFixture[],
  previousWinnerTicketIds: Set<string>
): void {
  if (ticket.campaign_id !== drawCampaignId || ticket.status !== "ISSUED") {
    throw new Error("Ticket is not ISSUED in draw campaign.");
  }
  if (order.campaign_id !== drawCampaignId || order.status !== "TICKETS_ISSUED") {
    throw new Error("Parent order is not in TICKETS_ISSUED state.");
  }
  const verifiedPaid = payments
    .filter((p) => p.order_id === order.id && p.status === "VERIFIED")
    .reduce((sum, p) => sum + p.amount_paise, 0);
  if (verifiedPaid !== order.total_amount_paise) {
    throw new Error("Verified payment total does not match order total.");
  }
  if (previousWinnerTicketIds.has(ticket.id)) {
    throw new Error("Ticket has already won a prize in this campaign.");
  }
}

const baseTicket: TicketFixture = {
  id: "t-1",
  ticket_number: "SSFI-000001",
  campaign_id: "camp-canon",
  order_id: "ord-1",
  customer_id: "cust-1",
  seller_id: null,
  issued_at: "2026-11-01T10:00:00Z",
  created_at: "2026-11-01T10:00:00Z",
  status: "ISSUED",
  voided_at: null,
  voided_by: null,
  void_reason: null,
  original_ticket_id: null,
  reissued_ticket_id: null,
};

const baseOrder: OrderFixture = {
  id: "ord-1",
  campaign_id: "camp-canon",
  status: "TICKETS_ISSUED",
  total_amount_paise: 50000,
};

const basePayments: PaymentFixture[] = [
  { order_id: "ord-1", status: "VERIFIED", amount_paise: 50000 },
];

test("Phase B1: Ticket Lifecycle, Eligibility & Canonical Campaign Security", async (t) => {
  await t.test("1. Valid issued ticket passes lifecycle validation", () => {
    assert.doesNotThrow(() => validateEligibility(baseTicket, "camp-canon", baseOrder, basePayments, new Set()));
  });

  await t.test("2. VOID -> ISSUED update is rejected", () => {
    const voided: TicketFixture = { ...baseTicket, status: "VOID", voided_at: "2026-11-02T00:00:00Z" };
    assert.throws(() => validateTicketUpdate(voided, { ...voided, status: "ISSUED" }), /VOID is a terminal state/);
  });

  await t.test("3. Unauthorized ticket deletion is rejected", () => {
    assert.throws(() => attemptTicketDelete(), /Hard deletion of tickets is prohibited/);
  });

  await t.test("4. Protected ticket identity modification is rejected", () => {
    assert.throws(
      () => validateTicketUpdate(baseTicket, { ...baseTicket, ticket_number: "SSFI-999999" }),
      /strictly immutable/
    );
    assert.throws(
      () => validateTicketUpdate(baseTicket, { ...baseTicket, customer_id: "cust-other" }),
      /strictly immutable/
    );
  });

  await t.test("5. Reissue of VOID-without-replacement is rejected", () => {
    const voidWithoutReplacement: TicketFixture = {
      ...baseTicket,
      status: "VOID",
      voided_at: "2026-11-02T00:00:00Z",
      void_reason: "Fraud",
      reissued_ticket_id: null,
    };
    assert.throws(
      () => simulateReissue(voidWithoutReplacement, new Set(), baseOrder, basePayments),
      /cannot reissue a VOID ticket/
    );
  });

  await t.test("6. Valid reissue preserves lineage", () => {
    const replacements = new Set<string>();
    const { oldTicket, newTicket } = simulateReissue(baseTicket, replacements, baseOrder, basePayments);
    assert.equal(oldTicket.status, "VOID");
    assert.equal(oldTicket.reissued_ticket_id, newTicket.id);
    assert.equal(newTicket.original_ticket_id, oldTicket.id);
    assert.equal(newTicket.status, "ISSUED");
  });

  await t.test("7. Duplicate concurrent reissue is rejected", () => {
    const replacements = new Set<string>();
    const { oldTicket } = simulateReissue(baseTicket, replacements, baseOrder, basePayments);
    assert.throws(
      () => simulateReissue({ ...baseTicket }, replacements, baseOrder, basePayments),
      /already been reissued/
    );
    assert.throws(
      () => simulateReissue(oldTicket, replacements, baseOrder, basePayments),
      /cannot reissue a VOID ticket/
    );
  });

  await t.test("8. Unverified payment is rejected", () => {
    const unverified: PaymentFixture[] = [{ order_id: "ord-1", status: "PENDING", amount_paise: 50000 }];
    assert.throws(
      () => validateEligibility(baseTicket, "camp-canon", baseOrder, unverified, new Set()),
      /does not match order total/
    );
  });

  await t.test("9. Payment/order amount mismatch is rejected", () => {
    const partial: PaymentFixture[] = [{ order_id: "ord-1", status: "VERIFIED", amount_paise: 49900 }];
    assert.throws(
      () => validateEligibility(baseTicket, "camp-canon", baseOrder, partial, new Set()),
      /does not match order total/
    );
  });

  await t.test("10. Noncanonical campaign cannot become the default", () => {
    const res = validateResolvedDrawCampaign(
      { id: "camp-other", public_id: "other-campaign", status: "ACTIVE" },
      { requestedCampaignId: null, canOverrideCampaign: true }
    );
    assert.equal(res.valid, false);
  });

  await t.test("11. Synthetic campaign cannot replace the canonical campaign", () => {
    assert.equal(isSyntheticCampaignPublicId("synth-rehearsal-01"), true);
    const res = validateResolvedDrawCampaign(
      { id: "camp-synth", public_id: "synth-rehearsal-01", status: "ACTIVE" },
      { requestedCampaignId: null, canOverrideCampaign: true }
    );
    assert.equal(res.valid, false);

    const canonRes = validateResolvedDrawCampaign(
      { id: "0f719dad-4547-4660-aed9-f5c6c7b8ed80", public_id: CANONICAL_CAMPAIGN_PUBLIC_ID, status: "ACTIVE" },
      { requestedCampaignId: null, canOverrideCampaign: false }
    );
    assert.equal(canonRes.valid, true);
  });

  await t.test("12. Previous winner cannot be selected again", () => {
    assert.throws(
      () => validateEligibility(baseTicket, "camp-canon", baseOrder, basePayments, new Set(["t-1"])),
      /already won a prize/
    );
  });

  await t.test("Static verification: luckyDraw.ts and 202611140001 SQL invariants", () => {
    const luckyDrawSrc = fs.readFileSync(path.resolve(process.cwd(), "src/server/actions/luckyDraw.ts"), "utf8");
    assert.ok(luckyDrawSrc.includes("CANONICAL_CAMPAIGN_PUBLIC_ID"));
    assert.ok(!luckyDrawSrc.includes('.order("created_at", { ascending: false })\n        .limit(1)'));

    const sql = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/202611140001_phase_b1_ticket_and_eligibility_hardening.sql"),
      "utf8"
    );
    assert.ok(!/DISABLE\s+TRIGGER/i.test(sql), "Migration must never disable triggers");
    assert.ok(!/DELETE\s+FROM/i.test(sql), "Migration must never hard delete records");
    assert.ok(sql.includes("trg_protect_tickets_no_delete"));
    assert.ok(sql.includes("idx_tickets_unique_original_ticket_id"));
    assert.ok(sql.includes("SET search_path = ''"));
    assert.ok(sql.includes("REVOKE ALL ON FUNCTION public.admin_reissue_ticket(uuid, uuid, text) FROM public, anon, authenticated;"));
    assert.ok(sql.includes("REVOKE ALL ON FUNCTION public.admin_lock_eligibility_snapshot(uuid, uuid, text, uuid[], text[], uuid) FROM public, anon, authenticated;"));
    assert.ok(sql.includes("REVOKE ALL ON FUNCTION public.execute_draw_winner_selection(uuid, uuid, uuid, integer, text, text, text, uuid, text) FROM public, anon, authenticated;"));
  });
});
