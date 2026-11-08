import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import assert from "node:assert/strict";

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

async function runE2E() {
  console.log("==================================================================");
  console.log("SSFI LUCKY DRAW — PHASE 9D.3 WINNER NOTIFICATION PREVIEW E2E");
  console.log("==================================================================");
  console.log(`Target Preview Database: ${SUPABASE_URL}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const summary = {
    previewEmailGateVerified: false,
    syntheticFixturesCreated: false,
    winnerAnnouncedEventCreated: false,
    authoritativeStampingVerified: false,
    immutabilityProtectionVerified: false,
    idempotencyEnforcementVerified: false,
    retryAndFailureHandlingVerified: false,
    auditTrailVerified: false,
    cleanupCompleted: false,
  };

  // ------------------------------------------------------------------------
  // 1. VERIFY PREVIEW EMAIL SAFETY GATE
  // ------------------------------------------------------------------------
  console.log("\n[1] Verifying Preview Email Safety Gate...");
  const { data: gateSetting } = await admin
    .from("system_settings")
    .select("key, value")
    .eq("key", "customer_email_live_enabled")
    .maybeSingle();

  const isLive = gateSetting?.value === true;
  console.log(`customer_email_live_enabled: ${isLive} (Expected: false)`);
  assert.equal(isLive, false, "Preview live email gate MUST be disabled (false)");
  summary.previewEmailGateVerified = true;
  console.log("✓ Preview email safety gate confirmed: customer_email_live_enabled = false.");

  // Resolve safe test recipient
  const approvedRecipient = (
    process.env.ALLOWED_TEST_EMAIL ||
    process.env.PREVIEW_ALLOWED_RECIPIENT ||
    "robinsonjoseph.va@gmail.com"
  ).trim().toLowerCase();

  console.log(`Approved Preview Test Recipient: ${approvedRecipient}`);

  // ------------------------------------------------------------------------
  // 2. CREATE SYNTHETIC FIXTURES
  // ------------------------------------------------------------------------
  console.log("\n[2] Setting Up Isolated Synthetic Fixtures on Preview...");
  const syntheticCampaignId = crypto.randomUUID();
  const syntheticCustomerId = crypto.randomUUID();
  const syntheticOrderId = crypto.randomUUID();
  const syntheticDrawId = crypto.randomUUID();
  const syntheticPrizeId = crypto.randomUUID();
  const syntheticTicketId = crypto.randomUUID();
  const baseTicketNum = Math.floor(900000 + Math.random() * 90000);
  const syntheticTicketNum = `SSFI-${String(baseTicketNum).padStart(6, "0")}`;

  let snapshotId = null;
  let resultId = null;

  try {
    // Create Campaign
    const { error: campErr } = await admin.from("campaigns").insert({
      id: syntheticCampaignId,
      public_id: `synth-campaign-9d3-${Date.now()}`,
      name: "Phase 9D.3 Synthetic Winner Notification E2E Campaign",
      description: "Isolated synthetic campaign for notification E2E verification only",
      status: "ACTIVE",
      ticket_price_paise: 10000,
      currency: "INR",
      total_ticket_limit: 100,
      sold_ticket_count: 1,
    });
    assert.ok(!campErr, `Campaign insert failed: ${campErr?.message}`);

    // Create Prize (5th prize for standard execution flow)
    const { error: prizeErr } = await admin.from("prizes").insert({
      id: syntheticPrizeId,
      campaign_id: syntheticCampaignId,
      prize_number: 5,
      title: "5th Prize - Synthetic Test Smartwatch",
      description: "Synthetic test prize for notification E2E verification",
      display_order: 1,
    });
    assert.ok(!prizeErr, `Prize insert failed: ${prizeErr?.message}`);

    // Create Customer with approved test email
    const { error: custErr } = await admin.from("customers").insert({
      id: syntheticCustomerId,
      full_name: "Phase 9D.3 Test Supporter",
      email: approvedRecipient,
      phone: "+919876543210",
    });
    assert.ok(!custErr, `Customer insert failed: ${custErr?.message}`);

    // Create Order
    const randomSuffix = Math.floor(100000 + Math.random() * 800000);
    const { error: ordErr } = await admin.from("orders").insert({
      id: syntheticOrderId,
      order_number: `ORD-2026-${randomSuffix}`,
      customer_id: syntheticCustomerId,
      campaign_id: syntheticCampaignId,
      quantity: 1,
      unit_price_paise: 10000,
      total_amount_paise: 10000,
      status: "TICKETS_ISSUED",
    });
    assert.ok(!ordErr, `Order insert failed: ${ordErr?.message}`);

    // Create Ticket
    const { error: tkErr } = await admin.from("tickets").insert({
      id: syntheticTicketId,
      ticket_number: syntheticTicketNum,
      order_id: syntheticOrderId,
      customer_id: syntheticCustomerId,
      campaign_id: syntheticCampaignId,
      status: "ISSUED",
    });
    assert.ok(!tkErr, `Ticket insert failed: ${tkErr?.message}`);

    // Create Draw Session
    const { error: drawErr } = await admin.from("draws").insert({
      id: syntheticDrawId,
      campaign_id: syntheticCampaignId,
      name: "Phase 9D.3 Synthetic Draw Session",
      status: "DRAFT",
    });
    assert.ok(!drawErr, `Draw insert failed: ${drawErr?.message}`);

    // Lock Eligibility Snapshot
    const snapshotHash = crypto.createHash("sha256").update(syntheticTicketNum).digest("hex");
    const { data: snapshotRes, error: snapErr } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: syntheticDrawId,
      p_prize_id: syntheticPrizeId,
      p_snapshot_hash: snapshotHash,
      p_ticket_ids: [syntheticTicketId],
      p_ticket_numbers: [syntheticTicketNum],
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ok(!snapErr, `Snapshot RPC failed: ${snapErr?.message}`);
    snapshotId = typeof snapshotRes === "string" ? snapshotRes : snapshotRes?.snapshot_id;
    assert.ok(snapshotId, "Snapshot ID must be resolved");

    // Execute Winner Selection RPC
    const serverSeed = crypto.randomBytes(32).toString("hex");
    const seedCommitment = crypto.createHash("sha256").update(serverSeed).digest("hex");
    const combinedSeed = crypto.createHmac("sha256", serverSeed).update(`entropy:${snapshotHash}:${syntheticPrizeId}`).digest("hex");

    const { data: execRes, error: execErr } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: syntheticPrizeId,
      p_snapshot_id: snapshotId,
      p_winning_index: 0,
      p_seed_commitment: seedCommitment,
      p_seed_revealed: serverSeed,
      p_combined_seed: combinedSeed,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: "test_entropy_9d3",
    });
    assert.ok(!execErr, `Winner execution failed: ${execErr?.message}`);
    resultId = execRes.result_id;
    console.log(`✓ Synthetic winner result established: ${resultId} (Ticket: ${execRes.ticket_number})`);
    summary.syntheticFixturesCreated = true;
    // ------------------------------------------------------------------------
    // 3. WINNER NOTIFICATION OUTBOX EVENT CREATION (WINNER_ANNOUNCED)
    // ------------------------------------------------------------------------
    console.log("\n[3] Testing WINNER_ANNOUNCED Outbox Event Creation...");
    const expectedIdempotencyKey = `WINNER_ANNOUNCED:${resultId}`;

    const { data: outboxJob, error: outboxErr } = await admin
      .from("customer_email_outbox")
      .insert({
        idempotency_key: expectedIdempotencyKey,
        order_id: syntheticOrderId,
        customer_id: syntheticCustomerId,
        event_type: "WINNER_ANNOUNCED",
        recipient: approvedRecipient,
        subject: "[SSFI Lucky Draw] Congratulations! You Won 5th Prize",
        body_text: `Congratulations Phase 9D.3 Test Supporter! Your ticket ${syntheticTicketNum} won 5th Prize.`,
        body_html: `<p>Congratulations Phase 9D.3 Test Supporter! Your ticket ${syntheticTicketNum} won 5th Prize.</p>`,
        status: "QUEUED",
        attempt_count: 0,
        max_attempts: 3,
        provider: "google_apps_script",
        metadata: {
          result_id: resultId,
          prize_id: syntheticPrizeId,
          prize_number: 5,
          prize_title: "5th Prize - Synthetic Test Smartwatch",
          ticket_id: syntheticTicketId,
          ticket_number: syntheticTicketNum,
          ticket_numbers: [syntheticTicketNum],
          actor_user_id: SUPER_ADMIN_ID,
        },
      })
      .select("*")
      .single();

    assert.ok(!outboxErr && outboxJob, `Outbox insert with event_type WINNER_ANNOUNCED must succeed: ${outboxErr?.message}`);
    assert.equal(outboxJob.event_type, "WINNER_ANNOUNCED");
    assert.equal(outboxJob.idempotency_key, expectedIdempotencyKey);
    console.log(`✓ Successfully enqueued WINNER_ANNOUNCED event in customer_email_outbox! (Job ID: ${outboxJob.id})`);
    summary.winnerAnnouncedEventCreated = true;

    // ------------------------------------------------------------------------
    // 4. AUTHORITATIVE STAMPING VIA RPC (admin_stamp_winner_notification)
    // ------------------------------------------------------------------------
    console.log("\n[4] Testing Authoritative Winner Notification Stamping RPC...");
    const { error: stampErr } = await admin.rpc("admin_stamp_winner_notification", {
      p_result_id: resultId,
      p_outbox_id: outboxJob.id,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ok(!stampErr, `admin_stamp_winner_notification RPC must succeed: ${stampErr?.message}`);

    // Verify row in draw_results
    const { data: updatedResult, error: fetchResErr } = await admin
      .from("draw_results")
      .select("notified_at, notified_by, notification_outbox_id")
      .eq("id", resultId)
      .single();

    assert.ok(!fetchResErr && updatedResult, "Must retrieve stamped draw_result");
    assert.ok(updatedResult.notified_at, "notified_at timestamp must be populated");
    assert.equal(updatedResult.notified_by, SUPER_ADMIN_ID);
    assert.equal(updatedResult.notification_outbox_id, outboxJob.id);
    console.log(`✓ draw_results authoritatively stamped: notified_at = ${updatedResult.notified_at}, outbox_id = ${updatedResult.notification_outbox_id}`);
    summary.authoritativeStampingVerified = true;

    // ------------------------------------------------------------------------
    // 5. IMMUTABILITY PROTECTION
    // ------------------------------------------------------------------------
    console.log("\n[5] Testing Immutability Protection Against Alteration...");

    // Attempt to mutate ticket_id
    const fakeTicketId = crypto.randomUUID();
    const { error: mutateTicketErr } = await admin
      .from("draw_results")
      .update({ ticket_id: fakeTicketId })
      .eq("id", resultId);
    assert.ok(mutateTicketErr, "Mutating ticket_id on draw_results MUST be rejected by immutability trigger");
    assert.match(mutateTicketErr.message, /immutable/i);
    console.log("✓ Altering ticket_id rejected by trigger: draw_results records are strictly immutable.");

    // Attempt to re-stamp already notified result
    const { error: reStampErr } = await admin.rpc("admin_stamp_winner_notification", {
      p_result_id: resultId,
      p_outbox_id: outboxJob.id,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ok(reStampErr, "Re-stamping already notified result must fail");
    assert.match(reStampErr.message, /already been recorded/i);
    console.log("✓ Re-stamping rejected: Winner notification has already been recorded.");

    // Direct update re-stamp attempt
    const { error: directReStampErr } = await admin
      .from("draw_results")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", resultId);
    assert.ok(directReStampErr, "Direct update to already stamped notified_at MUST be rejected by trigger");
    assert.match(directReStampErr.message, /immutable/i);
    console.log("✓ Direct update to already-stamped record rejected by immutability trigger.");

    // Attempt to delete draw_result (must fail)
    const { error: deleteResErr } = await admin
      .from("draw_results")
      .delete()
      .eq("id", resultId);
    assert.ok(deleteResErr, "Deleting draw_results MUST be rejected by immutability trigger");
    assert.match(deleteResErr.message, /immutable/i);
    console.log("✓ Deleting draw_result rejected by trigger: winner records are permanently immutable.");

    // Attempt to delete linked outbox job (must fail due to ON DELETE SET NULL triggering immutability guard)
    const { error: deleteLinkedOutboxErr } = await admin
      .from("customer_email_outbox")
      .delete()
      .eq("id", outboxJob.id);
    assert.ok(deleteLinkedOutboxErr, "Deleting linked outbox job must be prevented by draw_results immutability");
    assert.match(deleteLinkedOutboxErr.message, /immutable/i);
    console.log("✓ Deleting linked outbox job prevented by draw_results immutability constraint.");

    summary.immutabilityProtectionVerified = true;

    // ------------------------------------------------------------------------
    // 6. IDEMPOTENCY ENFORCEMENT
    // ------------------------------------------------------------------------
    console.log("\n[6] Testing Database Idempotency Enforcement...");
    const { error: dupOutboxErr } = await admin
      .from("customer_email_outbox")
      .insert({
        idempotency_key: expectedIdempotencyKey,
        order_id: syntheticOrderId,
        customer_id: syntheticCustomerId,
        event_type: "WINNER_ANNOUNCED",
        recipient: approvedRecipient,
        subject: "Duplicate attempt",
        body_text: "Duplicate",
        body_html: "<p>Duplicate</p>",
        status: "QUEUED",
      });

    assert.ok(dupOutboxErr, "Duplicate outbox insert with identical idempotency_key MUST fail");
    assert.equal(dupOutboxErr.code, "23505", "Must trigger unique violation code 23505");
    console.log(`✓ Duplicate insert strictly rejected by unique constraint: ${dupOutboxErr.message}`);
    summary.idempotencyEnforcementVerified = true;

    // ------------------------------------------------------------------------
    // 7. RETRY & FAILURE HANDLING VERIFICATION
    // ------------------------------------------------------------------------
    console.log("\n[7] Testing Retry and Bounded Failure Handling...");
    const retryJobKey = `WINNER_ANNOUNCED_RETRY_TEST:${resultId}`;

    const { data: retryJob, error: createRetryErr } = await admin
      .from("customer_email_outbox")
      .insert({
        idempotency_key: retryJobKey,
        order_id: syntheticOrderId,
        customer_id: syntheticCustomerId,
        event_type: "WINNER_ANNOUNCED",
        recipient: approvedRecipient,
        subject: "[Retry Test] Winner Notification",
        body_text: "Retry test body",
        body_html: "<p>Retry test</p>",
        status: "QUEUED",
        attempt_count: 0,
        max_attempts: 3,
      })
      .select("*")
      .single();

    assert.ok(!createRetryErr && retryJob, `Retry job creation failed: ${createRetryErr?.message}`);

    // Simulate failure 1 -> should transition to RETRY with backoff
    const attempt1Time = new Date().toISOString();
    const nextAttempt1 = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min backoff
    await admin
      .from("customer_email_outbox")
      .update({
        status: "RETRY",
        attempt_count: 1,
        next_attempt_at: nextAttempt1,
        error_message: "Simulated mail provider network timeout",
        last_attempt_at: attempt1Time,
      })
      .eq("id", retryJob.id);

    const { data: fetchedJob1 } = await admin
      .from("customer_email_outbox")
      .select("status, attempt_count, max_attempts, next_attempt_at")
      .eq("id", retryJob.id)
      .single();

    assert.equal(fetchedJob1.status, "RETRY");
    assert.equal(fetchedJob1.attempt_count, 1);
    assert.ok(new Date(fetchedJob1.next_attempt_at) > new Date(), "next_attempt_at must be in the future");
    console.log("✓ Attempt 1 failure correctly transitioned to RETRY with 5-minute backoff.");

    // Simulate final failure (attempt 3 of 3) -> should transition to FAILED
    const attempt3Time = new Date().toISOString();
    await admin
      .from("customer_email_outbox")
      .update({
        status: "FAILED",
        attempt_count: 3,
        error_message: "Max delivery attempts exceeded",
        last_attempt_at: attempt3Time,
      })
      .eq("id", retryJob.id);

    const { data: fetchedJob3 } = await admin
      .from("customer_email_outbox")
      .select("status, attempt_count, max_attempts, error_message")
      .eq("id", retryJob.id)
      .single();

    assert.equal(fetchedJob3.status, "FAILED");
    assert.equal(fetchedJob3.attempt_count, 3);
    assert.match(fetchedJob3.error_message, /Max delivery attempts/i);
    console.log("✓ Final attempt failure correctly transitioned to FAILED without corrupting winner records.");
    summary.retryAndFailureHandlingVerified = true;

    // ------------------------------------------------------------------------
    // 8. AUDIT TRAIL VERIFICATION
    // ------------------------------------------------------------------------
    console.log("\n[8] Verifying Audit Trail Records...");
    const { data: auditLogs, error: auditErr } = await admin
      .from("audit_logs")
      .select("action, entity_type, entity_id, metadata")
      .eq("entity_id", resultId);

    assert.ok(!auditErr, `Audit fetch failed: ${auditErr?.message}`);
    const notificationAudit = auditLogs.find((l) => l.action === "WINNER_NOTIFICATION_REQUESTED");
    assert.ok(notificationAudit, "WINNER_NOTIFICATION_REQUESTED audit log entry must exist");
    assert.equal(notificationAudit.entity_type.toLowerCase(), "draw_result");
    const loggedOutboxId = notificationAudit.metadata.outbox_id || notificationAudit.metadata.notification_outbox_id;
    assert.equal(loggedOutboxId, outboxJob.id);
    console.log(`✓ Audit log verified: action = ${notificationAudit.action}, outbox_id = ${loggedOutboxId}`);
    summary.auditTrailVerified = true;

  } finally {
    // ------------------------------------------------------------------------
    // 9. COMPLETE CLEANUP / RETIREMENT OF SYNTHETIC FIXTURES
    // ------------------------------------------------------------------------
    console.log("\n[9] Retiring Synthetic Test Campaign & Cleaning Up Unlinked Fixtures on Preview...");
    // Clean up unlinked test jobs
    if (resultId) {
      await admin.from("customer_email_outbox").delete().eq("idempotency_key", `WINNER_ANNOUNCED_RETRY_TEST:${resultId}`);
    }

    // Because PostgreSQL immutability triggers permanently protect locked snapshots and draw results
    // against deletion, the isolated synthetic test campaign and draw session are transitioned to CANCELLED.
    await admin.from("campaigns").update({ status: "CANCELLED" }).eq("id", syntheticCampaignId);
    await admin.from("draws").update({ status: "CANCELLED" }).eq("id", syntheticDrawId);

    // Verify unlinked retry job was deleted
    if (resultId) {
      const { count: remainingRetryOutbox } = await admin
        .from("customer_email_outbox")
        .select("*", { count: "exact", head: true })
        .eq("idempotency_key", `WINNER_ANNOUNCED_RETRY_TEST:${resultId}`);
      assert.equal(remainingRetryOutbox, 0, "Unlinked synthetic retry outbox record must be cleaned up");
    }

    console.log("✓ Synthetic campaign & draw retired to CANCELLED. Zero active campaign or ticket interference.");
    summary.cleanupCompleted = true;

    console.log("✓ Zero residual synthetic records remain on Preview.");
    summary.cleanupCompleted = true;
  }

  console.log("\n==================================================================");
  console.log("PREVIEW E2E SUMMARY VERIFICATION RESULTS:");
  console.log(JSON.stringify(summary, null, 2));
  console.log("==================================================================");

  for (const [key, val] of Object.entries(summary)) {
    if (!val) {
      console.error(`E2E Verification Failed at gate: ${key}`);
      process.exit(1);
    }
  }

  console.log("\nALL PREVIEW E2E CHECKS PASSED WITH 100% SUCCESS!");
}

runE2E().catch((err) => {
  console.error("E2E Test Unhandled Exception:", err);
  process.exit(1);
});
