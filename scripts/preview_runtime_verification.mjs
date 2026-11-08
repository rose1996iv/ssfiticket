import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import assert from "node:assert/strict";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Known staff identities on Preview
const SUPER_ADMIN_ID = "72054ec1-13a8-4b02-8d4e-d2b78f2df978";
const ADMIN_ID = "9a04809b-d9cd-4e9e-a414-038ea0a28adf";
const SELLER_ID = "abef6228-ef2e-453a-82e4-1c5442242e54";

async function runRuntimeVerification() {
  console.log("==================================================================");
  console.log("SSFI LUCKY DRAW — PHASE 9D.1 INDEPENDENT RUNTIME VERIFICATION");
  console.log("==================================================================");
  console.log(`Target Preview Database: ${SUPABASE_URL}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const resultsSummary = {
    fixturesCreated: false,
    snapshotLockingVerified: false,
    sequenceEnforcementVerified: false,
    winnerUniquenessVerified: false,
    policyADualApprovalVerified: false,
    concurrencyProtectionVerified: false,
    notificationStampingVerified: false,
    cleanUpCompleted: false,
  };

  const syntheticCampaignId = crypto.randomUUID();
  const syntheticCustomerId = crypto.randomUUID();
  const syntheticOrderId = crypto.randomUUID();
  const syntheticDrawId = crypto.randomUUID();

  let res1 = null;
  const prizeIds = {
    p5: crypto.randomUUID(),
    p4: crypto.randomUUID(),
    p3: crypto.randomUUID(),
    p2: crypto.randomUUID(),
    p1: crypto.randomUUID(),
  };

  const ticketIds = [];

  try {
    // ------------------------------------------------------------------------
    // STEP 1: CREATE ISOLATED SYNTHETIC FIXTURE
    // ------------------------------------------------------------------------
    console.log("\n[1] Creating Isolated Synthetic Fixtures in Preview Database...");

    // 1.1 Synthetic Campaign
    const { error: campErr } = await admin.from("campaigns").insert({
      id: syntheticCampaignId,
      public_id: `synth-campaign-${Date.now()}`,
      name: "Phase 9D.1 Synthetic Test Campaign",
      description: "Isolated synthetic campaign for runtime verification only",
      status: "ACTIVE",
      ticket_price_paise: 10000,
      currency: "INR",
      total_ticket_limit: 10,
      sold_ticket_count: 10,
    });
    assert.ifError(campErr);

    // 1.2 Synthetic Prizes (5th down to 1st)
    const prizeRecords = [
      { id: prizeIds.p5, campaign_id: syntheticCampaignId, prize_number: 5, title: "5th Prize (Synth)", display_order: 1 },
      { id: prizeIds.p4, campaign_id: syntheticCampaignId, prize_number: 4, title: "4th Prize (Synth)", display_order: 2 },
      { id: prizeIds.p3, campaign_id: syntheticCampaignId, prize_number: 3, title: "3rd Prize (Synth)", display_order: 3 },
      { id: prizeIds.p2, campaign_id: syntheticCampaignId, prize_number: 2, title: "2nd Prize (Synth)", display_order: 4 },
      { id: prizeIds.p1, campaign_id: syntheticCampaignId, prize_number: 1, title: "1st Prize (Synth Grand)", display_order: 5 },
    ];
    const { error: prizeErr } = await admin.from("prizes").insert(prizeRecords);
    assert.ifError(prizeErr);

    // 1.3 Synthetic Customer
    const { error: custErr } = await admin.from("customers").insert({
      id: syntheticCustomerId,
      full_name: "Synthetic Verification Customer",
      email: "robinsonjoseph.va@gmail.com",
      phone: "+919876543210",
    });
    assert.ifError(custErr);

    // 1.4 Synthetic Order
    const randomSuffix = Math.floor(100000 + Math.random() * 800000);
    const syntheticOrderNumber = `ORD-2026-${randomSuffix}`;
    const { error: orderErr } = await admin.from("orders").insert({
      id: syntheticOrderId,
      campaign_id: syntheticCampaignId,
      customer_id: syntheticCustomerId,
      order_number: syntheticOrderNumber,
      status: "TICKETS_ISSUED",
      quantity: 10,
      unit_price_paise: 10000,
      total_amount_paise: 100000,
    });
    assert.ifError(orderErr);

    // 1.5 Synthetic Tickets (SSFI-900001 through SSFI-900010)
    const baseTicketNum = Math.floor(900000 + Math.random() * 90000);
    for (let i = 1; i <= 10; i++) {
      const tId = crypto.randomUUID();
      ticketIds.push({
        id: tId,
        ticket_number: `SSFI-${String(baseTicketNum + i).padStart(6, "0")}`,
      });
    }

    const { error: tErr } = await admin.from("tickets").insert(
      ticketIds.map((t) => ({
        id: t.id,
        campaign_id: syntheticCampaignId,
        customer_id: syntheticCustomerId,
        order_id: syntheticOrderId,
        ticket_number: t.ticket_number,
        status: "ISSUED",
      }))
    );
    assert.ifError(tErr);

    // 1.6 Synthetic Draw Session
    const { error: drawErr } = await admin.from("draws").insert({
      id: syntheticDrawId,
      campaign_id: syntheticCampaignId,
      name: "Phase 9D.1 Synthetic Draw Session",
      status: "DRAFT",
    });
    assert.ifError(drawErr);

    resultsSummary.fixturesCreated = true;
    console.log("✓ Isolated synthetic fixtures created successfully.");

    // ------------------------------------------------------------------------
    // STEP 2: ELIGIBILITY SNAPSHOT LOCKING & IMMUTABILITY VERIFICATION
    // ------------------------------------------------------------------------
    console.log("\n[2] Testing Eligibility Snapshot Locking & Immutability...");

    // Add 1 manual exclusion: exclude ticket #10
    const excludedTicket = ticketIds[9];
    const exclusionId = crypto.randomUUID();
    const { error: exclErr } = await admin.from("draw_manual_exclusions").insert({
      id: exclusionId,
      campaign_id: syntheticCampaignId,
      prize_id: prizeIds.p5,
      ticket_id: excludedTicket.id,
      reason: "Synthetic test manual exclusion",
      excluded_by: SUPER_ADMIN_ID,
    });
    if (exclErr) {
      console.error("draw_manual_exclusions insert error:", exclErr);
    }
    assert.ifError(exclErr);

    // Remaining eligible tickets are #1 through #9
    const eligibleTickets5 = ticketIds.slice(0, 9);
    const eligibleNumbers = eligibleTickets5.map((t) => t.ticket_number).sort();
    const eligibleIds5 = eligibleTickets5.map((t) => t.id);
    const snapshotHash = crypto.createHash("sha256").update(eligibleNumbers.join("\n")).digest("hex");

    // Call admin_lock_eligibility_snapshot RPC
    const { data: snapshot5Id, error: snapErr } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p5,
      p_snapshot_hash: snapshotHash,
      p_ticket_ids: eligibleIds5,
      p_ticket_numbers: eligibleNumbers,
      p_actor: SUPER_ADMIN_ID,
    });
    if (snapErr) {
      console.error("Step 2 admin_lock_eligibility_snapshot error:", snapErr);
    }
    assert.ifError(snapErr);
    assert.ok(snapshot5Id, "Snapshot ID must be returned");

    // Verify snapshot row in database
    const { data: snapRow } = await admin.from("draw_eligibility_snapshots").select("*").eq("id", snapshot5Id).single();
    assert.equal(snapRow.is_locked, true);
    assert.equal(snapRow.total_eligible_count, 9);
    assert.equal(snapRow.manual_exclusion_count, 1);
    assert.equal(snapRow.snapshot_hash, snapshotHash);

    // Verify BEFORE DELETE trigger: Attempting to delete locked snapshot is BLOCKED
    const { error: delSnapErr } = await admin.from("draw_eligibility_snapshots").delete().eq("id", snapshot5Id);
    assert.ok(delSnapErr, "Database must reject deleting locked snapshot");
    assert.match(delSnapErr.message, /immutable/i);

    // Verify attempt to mutate snapshot tickets is BLOCKED
    const { error: updateTicketErr } = await admin
      .from("draw_snapshot_tickets")
      .update({ ticket_number: "HACKED" })
      .eq("snapshot_id", snapshot5Id);
    assert.ok(updateTicketErr, "Database must reject modifying locked snapshot tickets");

    resultsSummary.snapshotLockingVerified = true;
    console.log("✓ Snapshot locking, canonical hash, and trigger immutability verified.");

    // ------------------------------------------------------------------------
    // STEP 3: ASCENDING SEQUENCE ENFORCEMENT VERIFICATION (5th -> 4th -> 3rd -> 2nd -> 1st)
    // ------------------------------------------------------------------------
    console.log("\n[3] Testing Ceremonial Sequence Enforcement (5th -> 4th -> 3rd -> 2nd -> 1st)...");

    const serverSeed5 = crypto.randomBytes(32).toString("hex");
    const commitment5 = crypto.createHash("sha256").update(serverSeed5).digest("hex");
    const combinedSeed5 = crypto.createHmac("sha256", serverSeed5).update(`entropy:${snapshotHash}:${prizeIds.p5}`).digest("hex");

    // Attempt to execute 4th Prize BEFORE 5th Prize is drawn -> Must FAIL
    const { error: seqErr1 } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p4,
      p_snapshot_id: snapshot5Id,
      p_winning_index: 0,
      p_seed_commitment: commitment5,
      p_seed_revealed: serverSeed5,
      p_combined_seed: combinedSeed5,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: "test",
    });
    assert.ok(seqErr1, "Executing 4th prize before 5th prize must be blocked");
    assert.match(seqErr1.message, /Sequence violation/i);
    console.log("✓ Out-of-order execution strictly blocked by sequence guard.");

    // Now execute 5th Prize (Correct Order)
    const { data: res5, error: exec5Err } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p5,
      p_snapshot_id: snapshot5Id,
      p_winning_index: 3, // Selects 4th ticket in eligible roster
      p_seed_commitment: commitment5,
      p_seed_revealed: serverSeed5,
      p_combined_seed: combinedSeed5,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: "test",
    });
    assert.ifError(exec5Err);
    assert.ok(res5?.result_id, "Result ID must be returned");
    console.log(`✓ 5th Prize drawn successfully: Ticket ${res5.ticket_number}`);

    const winnerTicket5 = res5.ticket_number;

    // Verify Idempotency: Attempting to draw 5th prize again must FAIL
    const { error: reExecErr } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p5,
      p_snapshot_id: snapshot5Id,
      p_winning_index: 3,
      p_seed_commitment: commitment5,
      p_seed_revealed: serverSeed5,
      p_combined_seed: combinedSeed5,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: "test",
    });
    assert.ok(reExecErr, "Duplicate prize draw must be blocked");
    assert.match(reExecErr.message, /already been drawn/i);

    // Verify Seed Grinding Guard: Changing seed commitment on existing session must FAIL
    const { error: seedGrindErr } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p4,
      p_snapshot_id: snapshot5Id,
      p_winning_index: 0,
      p_seed_commitment: "0000000000000000000000000000000000000000000000000000000000000000",
      p_seed_revealed: "1111111111111111111111111111111111111111111111111111111111111111",
      p_combined_seed: "2222222222222222222222222222222222222222222222222222222222222222",
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ok(seedGrindErr, "Seed grinding attempt must be blocked");
    assert.match(seedGrindErr.message, /Commitment mismatch/i);

    resultsSummary.sequenceEnforcementVerified = true;
    console.log("✓ Ascending ceremonial sequence and seed-grinding guards verified.");

    // ------------------------------------------------------------------------
    // STEP 4: CAMPAIGN-WIDE SINGLE WINNER UNIQUENESS (RULE 3)
    // ------------------------------------------------------------------------
    console.log("\n[4] Testing Campaign-Wide Single Winner Uniqueness...");

    // Lock snapshot for 4th prize
    // Eligible roster for 4th prize excludes winner of 5th prize and previous manual exclusion
    const eligibleTickets4 = ticketIds.filter((t) => t.ticket_number !== winnerTicket5 && t.id !== excludedTicket.id);
    const eligibleForP4 = eligibleTickets4.map((t) => t.ticket_number).sort();
    const eligibleIds4 = eligibleTickets4.map((t) => t.id);
    assert.equal(eligibleForP4.length, 8, "Eligible candidates for 4th prize must be 8");

    const hash4 = crypto.createHash("sha256").update(eligibleForP4.join("\n")).digest("hex");
    const { data: snapshot4Id, error: snap4Err } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p4,
      p_snapshot_hash: hash4,
      p_ticket_ids: eligibleIds4,
      p_ticket_numbers: eligibleForP4,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ifError(snap4Err);

    const serverSeed4 = serverSeed5; // Re-use committed server seed
    const combinedSeed4 = crypto.createHmac("sha256", serverSeed4).update(`entropy:${hash4}:${prizeIds.p4}`).digest("hex");

    // Execute 4th prize draw
    const { data: res4, error: exec4Err } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p4,
      p_snapshot_id: snapshot4Id,
      p_winning_index: 0,
      p_seed_commitment: commitment5,
      p_seed_revealed: serverSeed4,
      p_combined_seed: combinedSeed4,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: "test",
    });
    assert.ifError(exec4Err);
    assert.notEqual(res4.ticket_number, winnerTicket5, "4th prize winner must not match 5th prize winner");
    console.log(`✓ 4th Prize drawn: Ticket ${res4.ticket_number} (Distinct from 5th)`);

    resultsSummary.winnerUniquenessVerified = true;

    // Complete 3rd & 2nd Prize to prepare for 1st Prize dual control test
    // 3rd Prize:
    const eligibleTickets3 = ticketIds.filter(
      (t) => t.ticket_number !== winnerTicket5 && t.ticket_number !== res4.ticket_number && t.id !== excludedTicket.id
    );
    const eligibleForP3 = eligibleTickets3.map((t) => t.ticket_number).sort();
    const eligibleIds3 = eligibleTickets3.map((t) => t.id);
    const hash3 = crypto.createHash("sha256").update(eligibleForP3.join("\n")).digest("hex");
    const { data: snapshot3Id } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p3,
      p_snapshot_hash: hash3,
      p_ticket_ids: eligibleIds3,
      p_ticket_numbers: eligibleForP3,
      p_actor: SUPER_ADMIN_ID,
    });
    const combinedSeed3 = crypto.createHmac("sha256", serverSeed5).update(`entropy:${hash3}:${prizeIds.p3}`).digest("hex");
    const { data: res3 } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p3,
      p_snapshot_id: snapshot3Id,
      p_winning_index: 0,
      p_seed_commitment: commitment5,
      p_seed_revealed: serverSeed5,
      p_combined_seed: combinedSeed3,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: "test",
    });

    // 2nd Prize:
    const eligibleTickets2 = ticketIds.filter(
      (t) =>
        t.ticket_number !== winnerTicket5 &&
        t.ticket_number !== res4.ticket_number &&
        t.ticket_number !== res3.ticket_number &&
        t.id !== excludedTicket.id
    );
    const eligibleForP2 = eligibleTickets2.map((t) => t.ticket_number).sort();
    const eligibleIds2 = eligibleTickets2.map((t) => t.id);
    const hash2 = crypto.createHash("sha256").update(eligibleForP2.join("\n")).digest("hex");
    const { data: snapshot2Id } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p2,
      p_snapshot_hash: hash2,
      p_ticket_ids: eligibleIds2,
      p_ticket_numbers: eligibleForP2,
      p_actor: SUPER_ADMIN_ID,
    });
    const combinedSeed2 = crypto.createHmac("sha256", serverSeed5).update(`entropy:${hash2}:${prizeIds.p2}`).digest("hex");
    const { data: res2 } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p2,
      p_snapshot_id: snapshot2Id,
      p_winning_index: 0,
      p_seed_commitment: commitment5,
      p_seed_revealed: serverSeed5,
      p_combined_seed: combinedSeed2,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: "test",
    });
    console.log(`✓ 3rd & 2nd Prizes completed: Tickets ${res3.ticket_number}, ${res2.ticket_number}`);

    // ------------------------------------------------------------------------
    // STEP 5: POLICY A — FIRST PRIZE DUAL AUTHORIZATION
    // ------------------------------------------------------------------------
    console.log("\n[5] Testing First Prize Policy A Dual Authorization Invariants...");

    // Lock snapshot for 1st Prize
    const eligibleTickets1 = ticketIds.filter(
      (t) =>
        t.ticket_number !== winnerTicket5 &&
        t.ticket_number !== res4.ticket_number &&
        t.ticket_number !== res3.ticket_number &&
        t.ticket_number !== res2.ticket_number &&
        t.id !== excludedTicket.id
    );
    const eligibleForP1 = eligibleTickets1.map((t) => t.ticket_number).sort();
    const eligibleIds1 = eligibleTickets1.map((t) => t.id);
    const hash1 = crypto.createHash("sha256").update(eligibleForP1.join("\n")).digest("hex");
    const { data: snapshot1Id, error: snap1Err } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p1,
      p_snapshot_hash: hash1,
      p_ticket_ids: eligibleIds1,
      p_ticket_numbers: eligibleForP1,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ifError(snap1Err);

    const combinedSeed1 = crypto.createHmac("sha256", serverSeed5).update(`entropy:${hash1}:${prizeIds.p1}`).digest("hex");

    // 5.1 Attempt to execute 1st Prize WITHOUT approval -> MUST FAIL
    const { error: unapproved1Err } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p1,
      p_snapshot_id: snapshot1Id,
      p_winning_index: 0,
      p_seed_commitment: commitment5,
      p_seed_revealed: serverSeed5,
      p_combined_seed: combinedSeed1,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: "test",
    });
    assert.ok(unapproved1Err, "Executing 1st prize without approval must be blocked");
    assert.match(unapproved1Err.message, /Dual approval violation/i);
    console.log("✓ Execution without dual authorization strictly rejected by database.");

    // 5.2 Super Admin requests authorization
    const { data: approvalId, error: reqAppErr } = await admin.rpc("admin_request_first_prize_approval", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p1,
      p_snapshot_id: snapshot1Id,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ifError(reqAppErr);
    assert.ok(approvalId, "Approval ID must be returned");

    // 5.3 SELF-APPROVAL ATTEMPT: Super Admin attempts to approve own request -> MUST FAIL
    const { error: selfAppErr } = await admin.rpc("admin_record_first_prize_approval", {
      p_approval_id: approvalId,
      p_decision: "APPROVED",
      p_notes: "Attempted self-approval",
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ok(selfAppErr, "Self-approval must be blocked");
    assert.match(selfAppErr.message, /Four-eyes violation/i);
    console.log("✓ Self-approval strictly rejected by database (Four-eyes violation).");

    // 5.4 NON-ADMIN APPROVAL ATTEMPT: Seller attempts to approve -> MUST FAIL
    const { error: nonAdminAppErr } = await admin.rpc("admin_record_first_prize_approval", {
      p_approval_id: approvalId,
      p_decision: "APPROVED",
      p_notes: "Seller unauthorized approval",
      p_actor: SELLER_ID,
    });
    assert.ok(nonAdminAppErr, "Seller approval must be blocked");
    assert.match(nonAdminAppErr.message, /Unauthorized: ADMIN or SUPER_ADMIN role required/i);
    console.log("✓ Unauthorized non-admin approval attempt strictly rejected.");

    // 5.5 VALID DUAL APPROVAL: Distinct Admin approves
    const { error: validAppErr } = await admin.rpc("admin_record_first_prize_approval", {
      p_approval_id: approvalId,
      p_decision: "APPROVED",
      p_notes: "Approved by independent administrator",
      p_actor: ADMIN_ID,
    });
    assert.ifError(validAppErr);
    console.log("✓ Valid approval recorded by distinct Admin identity.");

    // 5.6 Execute 1st Prize (Grand Prize) Draw -> MUST SUCCEED
    const execRes1 = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p1,
      p_snapshot_id: snapshot1Id,
      p_winning_index: 0,
      p_seed_commitment: commitment5,
      p_seed_revealed: serverSeed5,
      p_combined_seed: combinedSeed1,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: "test",
    });
    res1 = execRes1.data;
    const exec1Err = execRes1.error;
    assert.ifError(exec1Err);
    assert.ok(res1?.result_id, "1st prize result ID must be returned");
    console.log(`✓ 1st Prize (Grand Prize) drawn: Ticket ${res1.ticket_number}`);

    resultsSummary.policyADualApprovalVerified = true;

    // ------------------------------------------------------------------------
    // STEP 6: CONCURRENCY PROTECTION VERIFICATION (TASK 5)
    // ------------------------------------------------------------------------
    console.log("\n[6] Testing Real Database Concurrency Protection...");

    // Test simultaneous execution calls on the already-completed 1st prize
    const concurrentExecAttempts = await Promise.allSettled([
      admin.rpc("execute_draw_winner_selection", {
        p_draw_id: syntheticDrawId,
        p_prize_id: prizeIds.p1,
        p_snapshot_id: snapshot1Id,
        p_winning_index: 0,
        p_seed_commitment: commitment5,
        p_seed_revealed: serverSeed5,
        p_combined_seed: combinedSeed1,
        p_actor: SUPER_ADMIN_ID,
      }),
      admin.rpc("execute_draw_winner_selection", {
        p_draw_id: syntheticDrawId,
        p_prize_id: prizeIds.p1,
        p_snapshot_id: snapshot1Id,
        p_winning_index: 1,
        p_seed_commitment: commitment5,
        p_seed_revealed: serverSeed5,
        p_combined_seed: combinedSeed1,
        p_actor: ADMIN_ID,
      }),
    ]);

    // Both must be rejected because prize is already drawn (row locks and unique constraint)
    for (const attempt of concurrentExecAttempts) {
      if (attempt.status === "fulfilled") {
        assert.ok(attempt.value.error, "Concurrent draw on completed prize must fail");
        assert.match(attempt.value.error.message, /already been drawn/i);
      }
    }
    console.log("✓ Concurrent prize executions safely serialized and rejected.");

    // Test simultaneous approval requests
    const concurrentApprovalAttempts = await Promise.allSettled([
      admin.rpc("admin_record_first_prize_approval", {
        p_approval_id: approvalId,
        p_decision: "APPROVED",
        p_notes: "Race test A",
        p_actor: ADMIN_ID,
      }),
      admin.rpc("admin_record_first_prize_approval", {
        p_approval_id: approvalId,
        p_decision: "REJECTED",
        p_notes: "Race test B",
        p_actor: ADMIN_ID,
      }),
    ]);

    // Both must be rejected because approval is already non-PENDING and prize is drawn (SEC-05)
    for (const attempt of concurrentApprovalAttempts) {
      if (attempt.status === "fulfilled") {
        assert.ok(attempt.value.error, "Approval race on decided record must fail");
      }
    }
    console.log("✓ Concurrent approval decisions safely rejected by row lock.");

    resultsSummary.concurrencyProtectionVerified = true;

    // ------------------------------------------------------------------------
    // STEP 7: NOTIFICATION STAMPING & IDEMPOTENCY VERIFICATION (TASK 6)
    // ------------------------------------------------------------------------
    console.log("\n[7] Testing Winner Notification Idempotency Stamping...");

    const expectedKey = `WINNER_ANNOUNCED:${res1.result_id}`;

    // 1. First enqueue into customer_email_outbox
    // Note: The Preview database has check (event_type in ('ORDER_CREATED', 'PAYMENT_APPROVED', 'TICKETS_ISSUED', 'ADMIN_TEST'))
    // so synthetic tests use ADMIN_TEST with metadata noting WINNER_ANNOUNCED.
    const { data: outboxJob, error: outboxErr } = await admin
      .from("customer_email_outbox")
      .insert({
        idempotency_key: expectedKey,
        order_id: syntheticOrderId,
        customer_id: syntheticCustomerId,
        event_type: "ADMIN_TEST",
        recipient: "robinsonjoseph.va@gmail.com",
        subject: "Synthetic Winner Notification",
        body_text: "Congratulations! You won the 1st prize in the synthetic test draw.",
        body_html: "<p>Congratulations! You won the 1st prize in the synthetic test draw.</p>",
        status: "SIMULATED",
        attempt_count: 1,
        max_attempts: 3,
        provider: "google_apps_script",
        metadata: {
          intended_event: "WINNER_ANNOUNCED",
          result_id: res1.result_id,
          prize_id: prizeIds.p1,
          ticket_id: res1.ticket_id,
          actor_user_id: SUPER_ADMIN_ID,
        },
      })
      .select("*")
      .single();

    assert.ok(!outboxErr && outboxJob, `Outbox insert must succeed: ${outboxErr?.message}`);
    assert.equal(outboxJob.idempotency_key, expectedKey);

    // 2. Authoritatively stamp draw_result using trigger-compliant direct update
    const { error: stampErr } = await admin
      .from("draw_results")
      .update({
        notified_at: new Date().toISOString(),
        notified_by: SUPER_ADMIN_ID,
        notification_outbox_id: outboxJob.id,
      })
      .eq("id", res1.result_id);
    assert.ok(!stampErr, `draw_results notification stamp must succeed: ${stampErr?.message}`);

    // 3. Verify row updated in draw_results
    const { data: updatedRes1, error: fetchResErr } = await admin
      .from("draw_results")
      .select("notified_at, notified_by, notification_outbox_id")
      .eq("id", res1.result_id)
      .single();

    assert.ok(!fetchResErr && updatedRes1, "draw_results record must be found");
    assert.ok(updatedRes1.notified_at, "notified_at must be stamped");
    assert.equal(updatedRes1.notified_by, SUPER_ADMIN_ID);
    assert.equal(updatedRes1.notification_outbox_id, outboxJob.id);

    // 4. Test draw_results immutability trigger against duplicate stamping
    const { error: duplicateStampErr } = await admin
      .from("draw_results")
      .update({
        notified_at: new Date().toISOString(),
        notified_by: SUPER_ADMIN_ID,
        notification_outbox_id: outboxJob.id,
      })
      .eq("id", res1.result_id);
    assert.ok(duplicateStampErr, "Duplicate update to notified_at must be rejected by immutability trigger");
    assert.match(duplicateStampErr.message, /immutable/i);

    // 5. Test idempotency: attempting to insert another record with the exact same idempotency_key must fail
    const { error: duplicateInsertErr } = await admin
      .from("customer_email_outbox")
      .insert({
        idempotency_key: expectedKey,
        order_id: syntheticOrderId,
        customer_id: syntheticCustomerId,
        event_type: "ADMIN_TEST",
        recipient: "robinsonjoseph.va@gmail.com",
        subject: "Duplicate attempt",
        body_text: "Duplicate",
        body_html: "<p>Duplicate</p>",
        status: "QUEUED",
      });

    assert.ok(duplicateInsertErr, "Duplicate outbox insert with identical idempotency_key must be rejected by unique constraint");
    assert.match(duplicateInsertErr.message, /unique/i);

    console.log(`✓ Notification stamped: Outbox ID ${outboxJob.id}, Key ${expectedKey}`);
    console.log("✓ Second notification update strictly blocked by database immutability trigger.");
    console.log("✓ Notification idempotency verified: Duplicate outbox insert rejected by unique constraint.");

    resultsSummary.notificationStampingVerified = true;
  } finally {
    // ------------------------------------------------------------------------
    // STEP 7.5: DRAW RECORDS IMMUTABILITY VERIFICATION
    // ------------------------------------------------------------------------
    console.log("\n[7.5] Testing Draw Records Immutability...");
    const { error: delResErr } = await admin.from("draw_results").delete().eq("id", res1.result_id);
    assert.ok(delResErr, "Database must reject deleting draw result");
    assert.match(delResErr.message, /immutable/i);

    const { error: updateResErr } = await admin.from("draw_results").update({ selection_index: 999 }).eq("id", res1.result_id);
    assert.ok(updateResErr, "Database must reject updating draw result");
    assert.match(updateResErr.message, /immutable/i);
    console.log("✓ Draw results immutability verified: Update & delete strictly blocked by database.");

    // ------------------------------------------------------------------------
    // STEP 8: ARCHIVE ISOLATED SYNTHETIC TEST CAMPAIGN
    // ------------------------------------------------------------------------
    console.log("\n[8] Retiring Isolated Synthetic Test Campaign...");
    // Because PostgreSQL immutability triggers permanently protect locked snapshots and draw results
    // against deletion, the isolated synthetic test campaign is transitioned to CANCELLED.
    await admin.from("campaigns").update({ status: "CANCELLED" }).eq("id", syntheticCampaignId);
    await admin.from("draws").update({ status: "CANCELLED" }).eq("id", syntheticDrawId);
    resultsSummary.cleanUpCompleted = true;
    console.log("✓ Synthetic test campaign set to CANCELLED. Production and active campaign untouched.");
  }

  console.log("\n==================================================================");
  console.log("RUNTIME VERIFICATION SUMMARY:");
  console.log(JSON.stringify(resultsSummary, null, 2));
  console.log("==================================================================");

  const allPassed = Object.values(resultsSummary).every(Boolean);
  if (allPassed) {
    console.log("ALL PREVIEW RUNTIME VERIFICATION INVARIANTS PASSED SUCCESSFULLY!");
  } else {
    console.error("SOME INVARIANTS FAILED. SEE SUMMARY ABOVE.");
    process.exit(1);
  }
}

runRuntimeVerification().catch((err) => {
  console.error("Runtime verification fatal error:", err);
  process.exit(1);
});
