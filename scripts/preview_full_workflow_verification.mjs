import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { computeCombinedSeed, deriveWinningIndex } from "../src/lib/draw/randomness.ts";
import { verifyDrawEvidence, computeCanonicalSnapshotHash } from "../src/lib/draw/canonical.ts";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Strict Production Air-Gap check
if (SUPABASE_URL.includes("fohpqheglxhfdecadhzw")) {
  console.error("CRITICAL ERROR: Production project fohpqheglxhfdecadhzw detected. Halting immediately.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Known staff identities on Preview
const SUPER_ADMIN_ID = "72054ec1-13a8-4b02-8d4e-d2b78f2df978";
const ADMIN_ID = "9a04809b-d9cd-4e9e-a414-038ea0a28adf";

async function runFullVerification() {
  console.log("==================================================================");
  console.log("SSFI LUCKY DRAW — PHASE 9E FULL WORKFLOW VERIFICATION");
  console.log("==================================================================");
  console.log(`Target Preview Database: ${SUPABASE_URL}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const report = {
    prizeSequence: false,
    winnerUniqueness: false,
    policyADualApproval: false,
    randomnessAndReproducibility: false,
    immutableRecordsAndAudit: false,
    retirementAndCleanup: false,
  };

  const syntheticCampaignId = crypto.randomUUID();
  const syntheticCustomerId = crypto.randomUUID();
  const syntheticOrderId = crypto.randomUUID();
  const syntheticDrawId = crypto.randomUUID();

  const prizeIds = {
    p5: crypto.randomUUID(),
    p4: crypto.randomUUID(),
    p3: crypto.randomUUID(),
    p2: crypto.randomUUID(),
    p1: crypto.randomUUID(),
  };

  const ticketRecords = [];
  const drawnWinners = new Map(); // prize_number -> result
  const snapshots = new Map(); // prize_number -> snapshot_id

  try {
    // ------------------------------------------------------------------------
    // SETUP: Create Synthetic Campaign, 5 Prizes, Customer, Order & 20 Tickets
    // ------------------------------------------------------------------------
    console.log("\n[SETUP] Initializing Isolated Synthetic Campaign with 5 Prizes & 20 Tickets...");

    // 1. Campaign
    const { error: campErr } = await admin.from("campaigns").insert({
      id: syntheticCampaignId,
      public_id: `synth-p9e-${Date.now()}`,
      name: "Phase 9E Full Verification Campaign",
      description: "Isolated synthetic campaign for full lucky draw verification",
      status: "ACTIVE",
      ticket_price_paise: 10000,
      currency: "INR",
      total_ticket_limit: 100,
      sold_ticket_count: 20,
    });
    assert.ok(!campErr, `Campaign insert failed: ${campErr?.message}`);

    // 2. 5 Prizes (5th down to 1st)
    const prizeRows = [
      { id: prizeIds.p5, campaign_id: syntheticCampaignId, prize_number: 5, title: "5th Prize - Smart Watch", display_order: 1 },
      { id: prizeIds.p4, campaign_id: syntheticCampaignId, prize_number: 4, title: "4th Prize - Mountain Bicycle", display_order: 2 },
      { id: prizeIds.p3, campaign_id: syntheticCampaignId, prize_number: 3, title: "3rd Prize - 55-inch 4K TV", display_order: 3 },
      { id: prizeIds.p2, campaign_id: syntheticCampaignId, prize_number: 2, title: "2nd Prize - Laptop", display_order: 4 },
      { id: prizeIds.p1, campaign_id: syntheticCampaignId, prize_number: 1, title: "1st Prize - Honda Activa 6G", display_order: 5 },
    ];
    const { error: prizeErr } = await admin.from("prizes").insert(prizeRows);
    assert.ok(!prizeErr, `Prizes insert failed: ${prizeErr?.message}`);

    // 3. Customer
    const { error: custErr } = await admin.from("customers").insert({
      id: syntheticCustomerId,
      full_name: "Phase 9E Test Participant",
      email: "robinsonjoseph.va@gmail.com",
      phone: "+919876543210",
    });
    assert.ok(!custErr, `Customer insert failed: ${custErr?.message}`);

    // 4. Order
    const randomSuffix = Math.floor(100000 + Math.random() * 800000);
    const { error: ordErr } = await admin.from("orders").insert({
      id: syntheticOrderId,
      order_number: `ORD-2026-${randomSuffix}`,
      customer_id: syntheticCustomerId,
      campaign_id: syntheticCampaignId,
      quantity: 20,
      unit_price_paise: 10000,
      total_amount_paise: 200000,
      status: "TICKETS_ISSUED",
    });
    assert.ok(!ordErr, `Order insert failed: ${ordErr?.message}`);

    // 5. 20 Tickets (SSFI-920001 through SSFI-920020)
    const baseTicketNum = Math.floor(920000 + Math.random() * 70000);
    for (let i = 1; i <= 20; i++) {
      ticketRecords.push({
        id: crypto.randomUUID(),
        campaign_id: syntheticCampaignId,
        customer_id: syntheticCustomerId,
        order_id: syntheticOrderId,
        ticket_number: `SSFI-${String(baseTicketNum + i).padStart(6, "0")}`,
        status: "ISSUED",
      });
    }
    const { error: tkErr } = await admin.from("tickets").insert(ticketRecords);
    assert.ok(!tkErr, `Tickets insert failed: ${tkErr?.message}`);

    // 6. Draw Session with Pre-Committed CSPRNG Seed
    const sessionServerSeed = crypto.randomBytes(32).toString("hex");
    const sessionSeedCommitment = crypto.createHash("sha256").update(sessionServerSeed).digest("hex");

    const { error: drawErr } = await admin.from("draws").insert({
      id: syntheticDrawId,
      campaign_id: syntheticCampaignId,
      name: "Phase 9E Ceremonial Draw Session",
      status: "DRAFT",
      seed_commitment: sessionSeedCommitment,
      seed_revealed: sessionServerSeed,
    });
    assert.ok(!drawErr, `Draw insert failed: ${drawErr?.message}`);
    console.log("✓ Synthetic test campaign, 5 prizes, order, and 20 tickets created successfully.");

    // ========================================================================
    // DOMAIN 1: PRIZE SEQUENCE VERIFICATION (5th -> 4th -> 3rd -> 2nd -> 1st)
    // ========================================================================
    console.log("\n==================================================================");
    console.log("DOMAIN 1: PRIZE SEQUENCE ENFORCEMENT VERIFICATION");
    console.log("==================================================================");

    // Lock eligibility snapshot for 5th prize (all 20 tickets eligible)
    const roster5Numbers = ticketRecords.map((t) => t.ticket_number).sort();
    const roster5Ids = roster5Numbers.map((num) => ticketRecords.find((t) => t.ticket_number === num).id);
    const hash5 = computeCanonicalSnapshotHash(roster5Numbers);

    const { data: snap5Id, error: snap5Err } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p5,
      p_snapshot_hash: hash5,
      p_ticket_ids: roster5Ids,
      p_ticket_numbers: roster5Numbers,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ok(!snap5Err && snap5Id, `Lock snapshot 5 failed: ${snap5Err?.message}`);
    snapshots.set(5, typeof snap5Id === "string" ? snap5Id : snap5Id.snapshot_id);
    console.log(`✓ 5th Prize snapshot locked (Total candidates: ${roster5Numbers.length}, Hash: ${hash5.slice(0, 16)}...)`);

    // 1A. Try drawing 4th prize before 5th prize -> MUST BE BLOCKED
    console.log("Testing Out-Of-Order Draw: Attempting to draw 4th Prize before 5th Prize...");
    const combinedSeed4Premature = computeCombinedSeed(sessionServerSeed, "client_ent", hash5, prizeIds.p4);
    const { error: seqErr4 } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p4,
      p_snapshot_id: snapshots.get(5),
      p_winning_index: 0,
      p_seed_commitment: sessionSeedCommitment,
      p_seed_revealed: sessionServerSeed,
      p_combined_seed: combinedSeed4Premature,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ok(seqErr4, "Drawing 4th Prize before 5th Prize MUST be rejected by sequence guard");
    assert.match(seqErr4.message, /Sequence violation/i);
    console.log(`✓ Out-of-order 4th Prize draw blocked: "${seqErr4.message}"`);

    // 1B. Try drawing 1st prize before 5th prize -> MUST BE BLOCKED
    console.log("Testing Out-Of-Order Draw: Attempting to draw 1st Prize before 5th Prize...");
    const combinedSeed1Premature = computeCombinedSeed(sessionServerSeed, "client_ent", hash5, prizeIds.p1);
    const { error: seqErr1 } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p1,
      p_snapshot_id: snapshots.get(5),
      p_winning_index: 0,
      p_seed_commitment: sessionSeedCommitment,
      p_seed_revealed: sessionServerSeed,
      p_combined_seed: combinedSeed1Premature,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ok(seqErr1, "Drawing 1st Prize before 5th Prize MUST be rejected by sequence guard");
    assert.match(seqErr1.message, /Sequence violation/i);
    console.log(`✓ Premature 1st Prize draw blocked: "${seqErr1.message}"`);

    // 1C. Execute 5th Prize Draw -> MUST SUCCEED
    const clientEntropy5 = "e2e_entropy_prize_5";
    const combinedSeed5 = computeCombinedSeed(sessionServerSeed, clientEntropy5, hash5, prizeIds.p5);
    const winningIdx5 = deriveWinningIndex(combinedSeed5, roster5Numbers.length);

    const { data: res5, error: execErr5 } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p5,
      p_snapshot_id: snapshots.get(5),
      p_winning_index: winningIdx5,
      p_seed_commitment: sessionSeedCommitment,
      p_seed_revealed: sessionServerSeed,
      p_combined_seed: combinedSeed5,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: clientEntropy5,
    });
    assert.ok(!execErr5 && res5, `5th prize draw execution failed: ${execErr5?.message}`);
    drawnWinners.set(5, res5);
    console.log(`✓ 5th Prize drawn successfully: Ticket ${res5.ticket_number} (Index: ${winningIdx5})`);

    // 1D. Duplicate draw rejection: Try drawing 5th prize again -> MUST BE BLOCKED
    console.log("Testing Duplicate Draw: Attempting to draw 5th Prize a second time...");
    const { error: dupDrawErr5 } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p5,
      p_snapshot_id: snapshots.get(5),
      p_winning_index: winningIdx5,
      p_seed_commitment: sessionSeedCommitment,
      p_seed_revealed: sessionServerSeed,
      p_combined_seed: combinedSeed5,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ok(dupDrawErr5, "Duplicate prize draw MUST be rejected");
    assert.match(dupDrawErr5.message, /already been drawn/i);
    console.log(`✓ Duplicate 5th Prize draw strictly blocked: "${dupDrawErr5.message}"`);

    report.prizeSequence = true;

    // ========================================================================
    // DOMAIN 2: WINNER UNIQUENESS & CAMPAIGN-WIDE EXCLUSION
    // ========================================================================
    console.log("\n==================================================================");
    console.log("DOMAIN 2: WINNER UNIQUENESS & PREVIOUS WINNER EXCLUSION");
    console.log("==================================================================");

    const winner5TicketId = res5.ticket_id;
    console.log(`5th Prize winning ticket ID: ${winner5TicketId} (${res5.ticket_number})`);

    // Build 4th prize roster: Filter out 5th prize winner (19 remaining tickets)
    const roster4Numbers = ticketRecords
      .filter((t) => t.id !== winner5TicketId)
      .map((t) => t.ticket_number)
      .sort();
    assert.equal(roster4Numbers.length, 19, "4th prize roster must exclude 5th prize winner (19 tickets)");
    assert.ok(!roster4Numbers.includes(res5.ticket_number), "5th prize winner ticket must NOT be in 4th roster");
    const roster4Ids = roster4Numbers.map((num) => ticketRecords.find((t) => t.ticket_number === num).id);
    const hash4 = computeCanonicalSnapshotHash(roster4Numbers);

    const { data: snap4Id, error: snap4Err } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p4,
      p_snapshot_hash: hash4,
      p_ticket_ids: roster4Ids,
      p_ticket_numbers: roster4Numbers,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ok(!snap4Err && snap4Id, `Lock snapshot 4 failed: ${snap4Err?.message}`);
    snapshots.set(4, typeof snap4Id === "string" ? snap4Id : snap4Id.snapshot_id);

    // 2A. Test Direct DB Constraint: Attempting to insert duplicate campaign winner must fail
    console.log("Testing Campaign Single Winner Invariant: Attempting duplicate winner insertion via UNIQUE constraint...");
    const { error: directDupWinnerErr } = await admin.from("draw_results").insert({
      draw_id: syntheticDrawId,
      campaign_id: syntheticCampaignId,
      prize_id: prizeIds.p4,
      ticket_id: winner5TicketId, // already won 5th prize
      snapshot_id: snapshots.get(4),
      selection_index: 0,
      seed_commitment: sessionSeedCommitment,
      seed_revealed: sessionServerSeed,
      combined_seed: "test_seed",
      drawn_by: SUPER_ADMIN_ID,
    });
    assert.ok(directDupWinnerErr, "Duplicate winner in same campaign must be rejected by UNIQUE (campaign_id, ticket_id)");
    assert.equal(directDupWinnerErr.code, "23505", "Must trigger unique violation 23505");
    console.log(`✓ Database Rule 3 enforcement verified: Duplicate winner rejected by constraint draw_results_campaign_ticket_unique.`);

    // 2B. Draw 4th Prize normally
    const clientEntropy4 = "e2e_entropy_prize_4";
    const combinedSeed4 = computeCombinedSeed(sessionServerSeed, clientEntropy4, hash4, prizeIds.p4);
    const winningIdx4 = deriveWinningIndex(combinedSeed4, roster4Numbers.length);

    const { data: res4, error: execErr4 } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p4,
      p_snapshot_id: snapshots.get(4),
      p_winning_index: winningIdx4,
      p_seed_commitment: sessionSeedCommitment,
      p_seed_revealed: sessionServerSeed,
      p_combined_seed: combinedSeed4,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: clientEntropy4,
    });
    assert.ok(!execErr4 && res4, `4th prize draw failed: ${execErr4?.message}`);
    drawnWinners.set(4, res4);
    console.log(`✓ 4th Prize drawn: Ticket ${res4.ticket_number} (Different from 5th: ${res4.ticket_id !== winner5TicketId})`);

    // Draw 3rd Prize (18 candidates remaining)
    const prevWinners3 = [res5.ticket_id, res4.ticket_id];
    const roster3Numbers = ticketRecords.filter((t) => !prevWinners3.includes(t.id)).map((t) => t.ticket_number).sort();
    const roster3Ids = roster3Numbers.map((num) => ticketRecords.find((t) => t.ticket_number === num).id);
    const hash3 = computeCanonicalSnapshotHash(roster3Numbers);
    const { data: snap3Id } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p3,
      p_snapshot_hash: hash3,
      p_ticket_ids: roster3Ids,
      p_ticket_numbers: roster3Numbers,
      p_actor: SUPER_ADMIN_ID,
    });
    snapshots.set(3, typeof snap3Id === "string" ? snap3Id : snap3Id.snapshot_id);

    const clientEntropy3 = "e2e_entropy_prize_3";
    const combinedSeed3 = computeCombinedSeed(sessionServerSeed, clientEntropy3, hash3, prizeIds.p3);
    const winningIdx3 = deriveWinningIndex(combinedSeed3, roster3Numbers.length);
    const { data: res3, error: execErr3 } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p3,
      p_snapshot_id: snapshots.get(3),
      p_winning_index: winningIdx3,
      p_seed_commitment: sessionSeedCommitment,
      p_seed_revealed: sessionServerSeed,
      p_combined_seed: combinedSeed3,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: clientEntropy3,
    });
    assert.ok(!execErr3 && res3);
    drawnWinners.set(3, res3);
    console.log(`✓ 3rd Prize drawn: Ticket ${res3.ticket_number}`);

    // Draw 2nd Prize (17 candidates remaining)
    const prevWinners2 = [res5.ticket_id, res4.ticket_id, res3.ticket_id];
    const roster2Numbers = ticketRecords.filter((t) => !prevWinners2.includes(t.id)).map((t) => t.ticket_number).sort();
    const roster2Ids = roster2Numbers.map((num) => ticketRecords.find((t) => t.ticket_number === num).id);
    const hash2 = computeCanonicalSnapshotHash(roster2Numbers);
    const { data: snap2Id } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p2,
      p_snapshot_hash: hash2,
      p_ticket_ids: roster2Ids,
      p_ticket_numbers: roster2Numbers,
      p_actor: SUPER_ADMIN_ID,
    });
    snapshots.set(2, typeof snap2Id === "string" ? snap2Id : snap2Id.snapshot_id);

    const clientEntropy2 = "e2e_entropy_prize_2";
    const combinedSeed2 = computeCombinedSeed(sessionServerSeed, clientEntropy2, hash2, prizeIds.p2);
    const winningIdx2 = deriveWinningIndex(combinedSeed2, roster2Numbers.length);
    const { data: res2, error: execErr2 } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p2,
      p_snapshot_id: snapshots.get(2),
      p_winning_index: winningIdx2,
      p_seed_commitment: sessionSeedCommitment,
      p_seed_revealed: sessionServerSeed,
      p_combined_seed: combinedSeed2,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: clientEntropy2,
    });
    assert.ok(!execErr2 && res2);
    drawnWinners.set(2, res2);
    console.log(`✓ 2nd Prize drawn: Ticket ${res2.ticket_number}`);

    // Verify all 4 winners drawn so far are completely distinct tickets
    const distinctTicketIds = new Set([res5.ticket_id, res4.ticket_id, res3.ticket_id, res2.ticket_id]);
    assert.equal(distinctTicketIds.size, 4, "All drawn winners must be unique tickets");
    console.log("✓ Winner Uniqueness verified: 4 distinct winners across 4 prizes.");

    report.winnerUniqueness = true;

    // ========================================================================
    // DOMAIN 3: FIRST PRIZE POLICY A TWO-PERSON DUAL CONTROL VERIFICATION
    // ========================================================================
    console.log("\n==================================================================");
    console.log("DOMAIN 3: FIRST PRIZE POLICY A DUAL CONTROL VERIFICATION");
    console.log("==================================================================");

    // Build 1st prize roster (16 candidates remaining)
    const prevWinners1 = [res5.ticket_id, res4.ticket_id, res3.ticket_id, res2.ticket_id];
    const roster1Numbers = ticketRecords.filter((t) => !prevWinners1.includes(t.id)).map((t) => t.ticket_number).sort();
    const roster1Ids = roster1Numbers.map((num) => ticketRecords.find((t) => t.ticket_number === num).id);
    const hash1 = computeCanonicalSnapshotHash(roster1Numbers);

    const { data: snap1Id, error: snap1Err } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p1,
      p_snapshot_hash: hash1,
      p_ticket_ids: roster1Ids,
      p_ticket_numbers: roster1Numbers,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ok(!snap1Err && snap1Id, `Lock snapshot 1 failed: ${snap1Err?.message}`);
    snapshots.set(1, typeof snap1Id === "string" ? snap1Id : snap1Id.snapshot_id);
    console.log(`✓ 1st Prize snapshot locked (16 candidates, Hash: ${hash1.slice(0, 16)}...)`);

    const clientEntropy1 = "e2e_entropy_prize_1";
    const combinedSeed1 = computeCombinedSeed(sessionServerSeed, clientEntropy1, hash1, prizeIds.p1);
    const winningIdx1 = deriveWinningIndex(combinedSeed1, roster1Numbers.length);

    // 3A. Attempt to execute 1st Prize WITHOUT approval -> MUST FAIL
    console.log("Testing 1st Prize Execution WITHOUT Dual Approval...");
    const { error: noApprovalErr } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p1,
      p_snapshot_id: snapshots.get(1),
      p_winning_index: winningIdx1,
      p_seed_commitment: sessionSeedCommitment,
      p_seed_revealed: sessionServerSeed,
      p_combined_seed: combinedSeed1,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: clientEntropy1,
    });
    assert.ok(noApprovalErr, "1st Prize execution without approval MUST fail");
    assert.match(noApprovalErr.message, /Dual approval violation/i);
    console.log(`✓ Unapproved 1st Prize draw strictly blocked: "${noApprovalErr.message}"`);

    // 3B. Request First Prize Approval by SUPER_ADMIN
    console.log("Requesting 1st Prize Dual Approval by SUPER_ADMIN...");
    const { data: approvalId, error: reqAppErr } = await admin.rpc("admin_request_first_prize_approval", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p1,
      p_snapshot_id: snapshots.get(1),
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ok(!reqAppErr && approvalId, `Approval request failed: ${reqAppErr?.message}`);
    console.log(`✓ Approval requested (Approval ID: ${approvalId})`);

    // 3C. Attempt Self-Approval: Initiator tries to approve their own request -> MUST FAIL
    console.log("Testing Policy A Self-Approval Rejection: Initiator attempting to approve own request...");
    const { error: selfAppErr } = await admin.rpc("admin_record_first_prize_approval", {
      p_approval_id: approvalId,
      p_decision: "APPROVED",
      p_notes: "Illegal self approval attempt",
      p_actor: SUPER_ADMIN_ID, // SAME actor as initiator
    });
    assert.ok(selfAppErr, "Self-approval MUST be rejected by four-eyes check");
    assert.match(selfAppErr.message, /Four-eyes violation/i);
    console.log(`✓ Self-approval strictly rejected: "${selfAppErr.message}"`);

    // 3D. Test Snapshot Hash Binding: Approval must be bound to exact snapshot hash
    // Verify that pending approval is tied to hash1
    const { data: approvalRow } = await admin.from("draw_approvals").select("*").eq("id", approvalId).single();
    assert.equal(approvalRow.snapshot_hash, hash1, "Approval must be bound to exact snapshot hash");
    console.log(`✓ Approval hash binding verified: ${approvalRow.snapshot_hash}`);

    // 3E. Authorized Separate Review: A distinct ADMIN approves the request
    console.log("Recording 1st Prize Approval by distinct ADMIN...");
    const { error: adminAppErr } = await admin.rpc("admin_record_first_prize_approval", {
      p_approval_id: approvalId,
      p_decision: "APPROVED",
      p_notes: "Approved by distinct administrator after verifying candidates",
      p_actor: ADMIN_ID, // DIFFERENT actor
    });
    assert.ok(!adminAppErr, `Separate admin approval failed: ${adminAppErr?.message}`);
    console.log("✓ 1st Prize approval successfully recorded by distinct ADMIN.");

    // 3F. Execute 1st Prize Draw with Confirmed Dual Approval -> MUST SUCCEED
    console.log("Executing 1st Prize Winner Selection with Confirmed Dual Approval...");
    const { data: res1, error: execErr1 } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p1,
      p_snapshot_id: snapshots.get(1),
      p_winning_index: winningIdx1,
      p_seed_commitment: sessionSeedCommitment,
      p_seed_revealed: sessionServerSeed,
      p_combined_seed: combinedSeed1,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: clientEntropy1,
    });
    assert.ok(!execErr1 && res1, `1st prize draw execution failed: ${execErr1?.message}`);
    drawnWinners.set(1, res1);
    console.log(`✓ 1st Prize GRAND WINNER drawn: Ticket ${res1.ticket_number} (Index: ${winningIdx1})`);

    // Verify draw session transitioned to EXECUTED
    const { data: finalDrawSession } = await admin.from("draws").select("status, executed_at").eq("id", syntheticDrawId).single();
    assert.equal(finalDrawSession.status, "EXECUTED", "Draw session status must be EXECUTED upon 1st prize completion");
    assert.ok(finalDrawSession.executed_at, "Draw session executed_at must be populated");
    console.log("✓ Draw session transitioned to EXECUTED with executed_at timestamp.");

    report.policyADualApproval = true;

    // ========================================================================
    // DOMAIN 4: RANDOMNESS & REPRODUCIBILITY VERIFICATION
    // ========================================================================
    console.log("\n==================================================================");
    console.log("DOMAIN 4: RANDOMNESS & REPRODUCIBILITY VERIFICATION");
    console.log("==================================================================");

    // Fetch all 5 randomness evidence records
    const { data: evidenceList, error: evErr } = await admin
      .from("draw_randomness_evidence")
      .select(`
        *,
        snapshot:snapshot_id (snapshot_hash)
      `)
      .eq("draw_id", syntheticDrawId)
      .order("created_at", { ascending: true });

    assert.ok(!evErr && evidenceList, "Randomness evidence records must be retrieved");
    assert.equal(evidenceList.length, 5, "Exactly 5 randomness evidence records must exist (one per prize)");

    for (const ev of evidenceList) {
      const snapHash = ev.snapshot?.snapshot_hash || "";
      const verification = verifyDrawEvidence({
        serverSeedCommitment: ev.server_seed_commitment,
        serverSeedRevealed: ev.server_seed_revealed,
        clientEntropy: ev.client_entropy,
        combinedSeed: ev.combined_seed,
        snapshotHash: snapHash,
        prizeId: ev.prize_id,
        totalCandidates: ev.total_candidates,
        selectedIndex: ev.selected_index,
        winningTicketNumber: ev.winning_ticket_number,
      });

      assert.ok(verification.isValid, `Evidence verification must be VALID for prize ${ev.prize_id}`);
      assert.ok(verification.commitmentMatches, "Server seed commitment must match");
      assert.ok(verification.combinedSeedMatches, "Combined seed HMAC must match");
      assert.ok(verification.indexMatches, "Winning index derivation must reproduce exactly");
      console.log(`✓ Prize ${ev.prize_id.slice(0, 8)} Cryptographic Evidence VERIFIED (Index: ${ev.selected_index}, Winner: ${ev.winning_ticket_number})`);
    }

    // Test tamper detection: modified combined seed must be flagged as INVALID
    const tampered = verifyDrawEvidence({
      serverSeedCommitment: evidenceList[0].server_seed_commitment,
      serverSeedRevealed: evidenceList[0].server_seed_revealed,
      clientEntropy: "tampered_entropy",
      combinedSeed: evidenceList[0].combined_seed,
      snapshotHash: evidenceList[0].snapshot?.snapshot_hash || "",
      prizeId: evidenceList[0].prize_id,
      totalCandidates: evidenceList[0].total_candidates,
      selectedIndex: evidenceList[0].selected_index,
      winningTicketNumber: evidenceList[0].winning_ticket_number,
    });
    assert.equal(tampered.isValid, false, "Tampered evidence MUST fail verification");
    console.log("✓ Tamper detection confirmed: Altered client entropy correctly failed verification.");

    report.randomnessAndReproducibility = true;

    // ========================================================================
    // DOMAIN 5: IMMUTABLE RECORDS & AUTHORITATIVE AUDIT TRAIL VERIFICATION
    // ========================================================================
    console.log("\n==================================================================");
    console.log("DOMAIN 5: IMMUTABLE RECORDS & AUDIT TRAIL VERIFICATION");
    console.log("==================================================================");

    // 5A. Immutability of draw_results: Attempting UPDATE on core fields must be blocked
    const sampleResultId = res1.result_id;
    const { error: updateTicketErr } = await admin
      .from("draw_results")
      .update({ ticket_id: crypto.randomUUID() })
      .eq("id", sampleResultId);
    assert.ok(updateTicketErr, "Updating ticket_id on draw_results MUST be rejected by immutability trigger");
    assert.match(updateTicketErr.message, /immutable/i);
    console.log("✓ draw_results update rejected by trigger: Winner records are strictly immutable.");

    // Attempting DELETE on draw_results must be blocked
    const { error: deleteResErr } = await admin
      .from("draw_results")
      .delete()
      .eq("id", sampleResultId);
    assert.ok(deleteResErr, "Deleting draw_results MUST be rejected by immutability trigger");
    assert.match(deleteResErr.message, /immutable/i);
    console.log("✓ draw_results deletion rejected by trigger: Winner deletion is strictly prohibited.");

    // 5B. Immutability of snapshots: Attempting to modify locked snapshot tickets must be blocked
    const { error: updateSnapTicketErr } = await admin
      .from("draw_snapshot_tickets")
      .update({ ticket_number: "ILLEGAL_MUTATION" })
      .eq("snapshot_id", snapshots.get(1));
    assert.ok(updateSnapTicketErr, "Modifying locked snapshot tickets MUST be rejected by trigger");
    assert.match(updateSnapTicketErr.message, /cannot be modified or deleted|immutable/i);
    console.log("✓ Snapshot tickets modification rejected by trigger: Locked snapshots are strictly protected.");

    // 5C. Authoritative Audit Trail: Verify audit log entries
    const { data: auditEntries, error: auditErr } = await admin
      .from("audit_logs")
      .select("action, entity_type, entity_id")
      .eq("actor_user_id", SUPER_ADMIN_ID);
    assert.ok(!auditErr && auditEntries, "Audit logs must be queryable");

    const auditActions = new Set(auditEntries.map((a) => a.action));
    assert.ok(auditActions.has("SNAPSHOT_LOCKED"), "Audit log must contain SNAPSHOT_LOCKED");
    assert.ok(auditActions.has("APPROVAL_REQUESTED"), "Audit log must contain APPROVAL_REQUESTED");
    assert.ok(auditActions.has("DRAW_EXECUTED"), "Audit log must contain DRAW_EXECUTED");
    console.log("✓ Authoritative Audit Logs verified: SNAPSHOT_LOCKED, APPROVAL_REQUESTED, and DRAW_EXECUTED all recorded.");

    report.immutableRecordsAndAudit = true;

  } finally {
    // ========================================================================
    // DOMAIN 6: SYNTHETIC RETIREMENT & CLEANUP
    // ========================================================================
    console.log("\n==================================================================");
    console.log("DOMAIN 6: SYNTHETIC RETIREMENT & CLEANUP");
    console.log("==================================================================");
    // Because PostgreSQL immutability triggers permanently protect locked snapshots and draw results
    // against deletion, the isolated synthetic test campaign and draw session are transitioned to CANCELLED.
    await admin.from("campaigns").update({ status: "CANCELLED" }).eq("id", syntheticCampaignId);
    await admin.from("draws").update({ status: "CANCELLED" }).eq("id", syntheticDrawId);
    console.log("✓ Synthetic campaign & draw session safely retired to CANCELLED.");
    console.log("✓ Production database (fohpqheglxhfdecadhzw) remained 100% untouched throughout verification.");
    report.retirementAndCleanup = true;
  }

  console.log("\n==================================================================");
  console.log("PHASE 9E FULL WORKFLOW VERIFICATION SUMMARY:");
  console.log(JSON.stringify(report, null, 2));
  console.log("==================================================================");

  const allPassed = Object.values(report).every(Boolean);
  if (!allPassed) {
    console.error("SOME VERIFICATION DOMAINS FAILED!");
    process.exit(1);
  }

  console.log("\nALL PHASE 9E FULL WORKFLOW VERIFICATION GATES PASSED WITH 100% SUCCESS!");
}

runFullVerification().catch((err) => {
  console.error("Phase 9E Verification Fatal Error:", err);
  process.exit(1);
});
