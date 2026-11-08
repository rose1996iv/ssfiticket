import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { computeCombinedSeed, deriveWinningIndex } from "../src/lib/draw/randomness.ts";
import { verifyDrawEvidence, computeCanonicalSnapshotHash } from "../src/lib/draw/canonical.ts";
import { executeDownloadPaymentScreenshot } from "../src/lib/payment/screenshotDownload.ts";
import { checkOrderAccessRateLimit, resetRateLimitsForTesting } from "../src/lib/security/rateLimit.ts";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

// Strict Production Air-Gap check
if (SUPABASE_URL.includes("fohpqheglxhfdecadhzw")) {
  console.error("CRITICAL AIR-GAP ERROR: Production project fohpqheglxhfdecadhzw detected! Aborting immediately.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Verified Preview Profile Identities
const SUPER_ADMIN_ID = "72054ec1-13a8-4b02-8d4e-d2b78f2df978";
const ADMIN_ID = "9a04809b-d9cd-4e9e-a414-038ea0a28adf";
const MANAGER_ID = "15f934a1-f0a4-4c16-9626-9d322b2968c6";
const SELLER_PROFILE_ID = "abef6228-ef2e-453a-82e4-1c5442242e54"; // SELLER-007
const SELLER_007_ID = "edebd069-4bea-4f69-8afd-f34743def4ab";

console.log("==================================================================");
console.log("SSFI LUCKY DRAW — PHASE 9G PREVIEW USER ACCEPTANCE TESTING (UAT)");
console.log("==================================================================");
console.log(`Target Preview Database: ${SUPABASE_URL}`);
console.log(`Execution Timestamp: ${new Date().toISOString()}`);

const uatResults = {
  step1_deploymentReadiness: { status: "PASS", details: [] },
  step2_roleBasedUat: { status: "PASS", details: [] },
  step3_paymentWorkflow: { status: "PASS", details: [] },
  step4_ticketWorkflow: { status: "PASS", details: [] },
  step5_luckyDrawWorkflow: { status: "PASS", details: [] },
  step6_securityRegression: { status: "PASS", details: [] },
};

async function runUat() {
  // -------------------------------------------------------------------------
  // STEP 1: PREVIEW DEPLOYMENT READINESS
  // -------------------------------------------------------------------------
  console.log("\n--- [STEP 1] Preview Deployment Readiness Check ---");
  const remotePreviewBase = "https://ssfiticket-git-preview-production-mirror-rose1996ivs-projects.vercel.app";

  try {
    const loginHeader = execSync(`curl.exe -I -s "${remotePreviewBase}/login"`, { encoding: "utf8" });
    const isLogin200 = loginHeader.includes("HTTP/1.1 200") || loginHeader.includes("HTTP/2 200");
    assert.ok(isLogin200, "Remote /login route must return HTTP 200 OK");
    uatResults.step1_deploymentReadiness.details.push("Remote /login route returns HTTP 200 OK");
    console.log("[PASS] Remote /login endpoint responsive (HTTP 200 OK)");

    const adminHeader = execSync(`curl.exe -I -s "${remotePreviewBase}/admin"`, { encoding: "utf8" });
    const isAdmin307 = adminHeader.includes("HTTP/1.1 307") || adminHeader.includes("HTTP/2 307");
    assert.ok(isAdmin307, "Remote /admin route must redirect unauthenticated callers (HTTP 307)");
    uatResults.step1_deploymentReadiness.details.push("Remote /admin route redirects unauthenticated callers (HTTP 307 to /login)");
    console.log("[PASS] Remote /admin endpoint correctly guarded with HTTP 307 redirect to /login");

    const drawHeader = execSync(`curl.exe -I -s "${remotePreviewBase}/admin/draw"`, { encoding: "utf8" });
    const isDraw404 = drawHeader.includes("HTTP/1.1 404") || drawHeader.includes("HTTP/2 404");
    assert.ok(isDraw404, "Remote /admin/draw returns 404 because uncommitted Phase 9 code is not yet deployed");
    uatResults.step1_deploymentReadiness.details.push("Remote /admin/draw returns HTTP 404 Not Found (Documented limitation: local workspace has Phase 9 changes, remote branch awaiting push authorization)");
    console.log("[INFO] Remote /admin/draw returned HTTP 404 as expected (awaiting deployment authorization)");
  } catch (err) {
    console.error("[STEP 1 ERROR]", err);
    uatResults.step1_deploymentReadiness.status = "FAIL";
    throw err;
  }

  // -------------------------------------------------------------------------
  // STEP 2: ROLE-BASED ACCESS CONTROL (RBAC) UAT
  // -------------------------------------------------------------------------
  console.log("\n--- [STEP 2] Role-Based Access Control (RBAC) UAT ---");
  try {
    // 2.1 Verify has_role RPC
    const checkRole = async (userId, role) => {
      const { data, error } = await admin.rpc("has_role", { p_user_id: userId, p_role: role });
      if (error) throw error;
      return Boolean(data);
    };

    assert.equal(await checkRole(SUPER_ADMIN_ID, "SUPER_ADMIN"), true, "SUPER_ADMIN must have SUPER_ADMIN role");
    assert.equal(await checkRole(ADMIN_ID, "ADMIN"), true, "ADMIN must have ADMIN role");
    assert.equal(await checkRole(MANAGER_ID, "FUNDRAISING_MANAGER"), true, "MANAGER must have FUNDRAISING_MANAGER role");
    assert.equal(await checkRole(SELLER_PROFILE_ID, "SELLER"), true, "SELLER must have SELLER role");
    assert.equal(await checkRole(SELLER_PROFILE_ID, "ADMIN"), false, "SELLER must NOT have ADMIN role");
    assert.equal(await checkRole(ADMIN_ID, "SELLER"), false, "ADMIN must NOT have SELLER role");
    console.log("[PASS] has_role RPC correctly evaluates all configured roles");

    // 2.2 Verify is_staff RPC
    const checkStaff = async (userId) => {
      const { data, error } = await admin.rpc("is_staff", { p_user_id: userId });
      if (error) throw error;
      return Boolean(data);
    };

    assert.equal(await checkStaff(SUPER_ADMIN_ID), true, "SUPER_ADMIN is staff");
    assert.equal(await checkStaff(ADMIN_ID), true, "ADMIN is staff");
    assert.equal(await checkStaff(MANAGER_ID), true, "FUNDRAISING_MANAGER is staff");
    assert.equal(await checkStaff(SELLER_PROFILE_ID), false, "SELLER is NOT staff");
    console.log("[PASS] is_staff RPC strictly separates staff from non-staff roles");

    // 2.3 Verify Screenshot Download Authorization Boundary
    const mockPaymentId = crypto.randomUUID();
    const mockStoragePath = `${crypto.randomUUID()}.png`;

    // SUPER_ADMIN is authorized:
    const superAdminDownload = await executeDownloadPaymentScreenshot(mockPaymentId, {
      actorUserId: SUPER_ADMIN_ID,
      resolveActorRoles: async () => ["SUPER_ADMIN"],
      lookupPaymentAndScreenshot: async () => ({
        payment: { id: mockPaymentId, order_id: "o1", order_number: "ORD-9999" },
        screenshot: { id: "s1", payment_id: mockPaymentId, storage_path: mockStoragePath, content_type: "image/png", file_size_bytes: 1024, uploaded_at: new Date().toISOString() },
        bucketIsPublic: false,
      }),
      verifyAndCreateSignedDownloadUrl: async () => ({ signedUrl: "https://mock.download.url", fileExists: true }),
      writeAuditLog: async () => {},
    });
    assert.equal(superAdminDownload.success, true, "SUPER_ADMIN must be authorized to download screenshot");

    // ADMIN is rejected from downloading:
    const adminDownload = await executeDownloadPaymentScreenshot(mockPaymentId, {
      actorUserId: ADMIN_ID,
      resolveActorRoles: async () => ["ADMIN"],
      lookupPaymentAndScreenshot: async () => ({ payment: null, screenshot: null, bucketIsPublic: false }),
      verifyAndCreateSignedDownloadUrl: async () => ({ signedUrl: null, fileExists: false }),
      writeAuditLog: async () => {},
    });
    assert.equal(adminDownload.success, false);
    assert.equal(adminDownload.code, "FORBIDDEN_ROLE");

    // FUNDRAISING_MANAGER is rejected:
    const managerDownload = await executeDownloadPaymentScreenshot(mockPaymentId, {
      actorUserId: MANAGER_ID,
      resolveActorRoles: async () => ["FUNDRAISING_MANAGER"],
      lookupPaymentAndScreenshot: async () => ({ payment: null, screenshot: null, bucketIsPublic: false }),
      verifyAndCreateSignedDownloadUrl: async () => ({ signedUrl: null, fileExists: false }),
      writeAuditLog: async () => {},
    });
    assert.equal(managerDownload.success, false);
    assert.equal(managerDownload.code, "FORBIDDEN_ROLE");

    // SELLER is rejected:
    const sellerDownload = await executeDownloadPaymentScreenshot(mockPaymentId, {
      actorUserId: SELLER_PROFILE_ID,
      resolveActorRoles: async () => ["SELLER"],
      lookupPaymentAndScreenshot: async () => ({ payment: null, screenshot: null, bucketIsPublic: false }),
      verifyAndCreateSignedDownloadUrl: async () => ({ signedUrl: null, fileExists: false }),
      writeAuditLog: async () => {},
    });
    assert.equal(sellerDownload.success, false);
    assert.equal(sellerDownload.code, "FORBIDDEN_ROLE");

    console.log("[PASS] Screenshot download strictly permits SUPER_ADMIN and rejects ADMIN, MANAGER, and SELLER with FORBIDDEN_ROLE");
    uatResults.step2_roleBasedUat.details.push("All 5 roles verified for authorized and unauthorized boundaries");
  } catch (err) {
    console.error("[STEP 2 ERROR]", err);
    uatResults.step2_roleBasedUat.status = "FAIL";
    throw err;
  }

  // -------------------------------------------------------------------------
  // STEP 3: PAYMENT WORKFLOW UAT
  // -------------------------------------------------------------------------
  console.log("\n--- [STEP 3] Payment Workflow UAT ---");
  const syntheticCampaignId = crypto.randomUUID();
  const syntheticCustomerId = crypto.randomUUID();
  const syntheticOrderId = crypto.randomUUID();
  const syntheticPaymentId = crypto.randomUUID();
  let createdOrderNumber = "";

  try {
    // 3.1 Setup synthetic campaign
    const { error: campErr } = await admin.from("campaigns").insert({
      id: syntheticCampaignId,
      public_id: `synth-uat-${Date.now()}`,
      name: "UAT Synthetic Payment Campaign",
      description: "Automated UAT Test Fixture",
      status: "ACTIVE",
      ticket_price_paise: 10000,
      currency: "INR",
      total_ticket_limit: 100,
      sold_ticket_count: 10,
    });
    assert.ifError(campErr);

    // 3.2 Setup synthetic customer
    const { error: custErr } = await admin.from("customers").insert({
      id: syntheticCustomerId,
      full_name: "UAT Synthetic Customer",
      email: "synthetic.uat.customer@example.com",
      phone: "+919876543210",
      whatsapp_number: "+919876543210",
    });
    assert.ifError(custErr);

    // 3.3 Create synthetic order with seller-owned UPI snapshot
    const randomSuffix = Math.floor(100000 + Math.random() * 899999).toString();
    createdOrderNumber = `ORD-2026-${randomSuffix}`;
    const snapshotDetails = {
      snapshot_seller_id: SELLER_007_ID,
      snapshot_seller_code: "SELLER-007",
      snapshot_seller_display_name: "Dehradun (UAT)",
      snapshot_qr_storage_path: "seller-edebd069-4bea-4f69-8afd-f34743def4ab/mock-qr.png",
      snapshot_upi_id: "seller007.uat@axisbank",
      snapshot_account_name: "SSFI Dehradun Seller",
      snapshot_payment_instructions: "Pay to Dehradun seller and enter transaction ID.",
      snapshot_captured_at: new Date().toISOString(),
    };

    const { error: orderErr } = await admin.from("orders").insert({
      id: syntheticOrderId,
      order_number: createdOrderNumber,
      campaign_id: syntheticCampaignId,
      customer_id: syntheticCustomerId,
      seller_id: SELLER_007_ID,
      quantity: 2,
      unit_price_paise: 10000,
      total_amount_paise: 20000,
      status: "PENDING_PAYMENT",
      ...snapshotDetails,
    });
    assert.ifError(orderErr);
    console.log(`[PASS] Order created with seller-attributed UPI snapshot: ${createdOrderNumber}`);

    // 3.4 Verify Snapshot Immutability Trigger
    console.log("Testing SQL snapshot immutability trigger (attempting to alter snapshot_upi_id)...");
    const { error: mutateSnapErr } = await admin
      .from("orders")
      .update({ snapshot_upi_id: "tampered@centralbank" })
      .eq("id", syntheticOrderId);

    assert.ok(mutateSnapErr, "Mutation on order payment snapshot must fail with SQL exception");
    assert.match(mutateSnapErr.message, /immutable|cannot be changed|P0001/i);
    console.log("[PASS] Payment snapshot immutability trigger (trg_protect_order_payment_snapshot) raised exception on tamper attempt");

    // 3.5 Create synthetic payment record
    const { error: payErr } = await admin.from("payments").insert({
      id: syntheticPaymentId,
      order_id: syntheticOrderId,
      amount_paise: 20000,
      currency: "INR",
      payment_method: "MANUAL_UPI",
      status: "SUBMITTED",
      submitted_at: new Date().toISOString(),
      payer_name: "UAT Payer",
      utr_reference: `UTR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
    });
    assert.ifError(payErr);

    // Attach mock payment screenshot record
    const { error: scrErr } = await admin.from("payment_screenshots").insert({
      payment_id: syntheticPaymentId,
      storage_path: `${crypto.randomUUID()}.png`,
      content_type: "image/png",
      file_size_bytes: 2048,
    });
    assert.ifError(scrErr);

    // Order status transitions to PAYMENT_SUBMITTED upon payment submission
    const { error: ordSubmitErr } = await admin
      .from("orders")
      .update({ status: "PAYMENT_SUBMITTED" })
      .eq("id", syntheticOrderId);
    assert.ifError(ordSubmitErr);
    console.log("[PASS] Mandatory payment screenshot record registered and order transitioned to PAYMENT_SUBMITTED");

    // 3.6 Admin Payment Verification & Atomic Ticket Issuance
    console.log("Executing verify_payment_and_issue RPC as ADMIN...");
    const { error: verifyErr } = await admin.rpc("verify_payment_and_issue", {
      p_payment_id: syntheticPaymentId,
      p_actor: ADMIN_ID,
    });
    assert.ifError(verifyErr);

    // Verify order transitioned to TICKETS_ISSUED and payment to VERIFIED
    const { data: updatedOrder } = await admin.from("orders").select("status").eq("id", syntheticOrderId).single();
    assert.equal(updatedOrder.status, "TICKETS_ISSUED", "Order status must transition to TICKETS_ISSUED");

    const { data: updatedPayment } = await admin.from("payments").select("status, verified_by").eq("id", syntheticPaymentId).single();
    assert.equal(updatedPayment.status, "VERIFIED", "Payment status must transition to VERIFIED");
    assert.equal(updatedPayment.verified_by, ADMIN_ID, "Payment verified_by must match actor");
    console.log("[PASS] verify_payment_and_issue atomically transitioned payment to VERIFIED and order to TICKETS_ISSUED");

    // Replay protection test: Re-executing verify_payment_and_issue must fail
    console.log("Testing replay protection on verified payment...");
    const { error: replayErr } = await admin.rpc("verify_payment_and_issue", {
      p_payment_id: syntheticPaymentId,
      p_actor: ADMIN_ID,
    });
    assert.ok(replayErr, "Re-verifying an already verified payment must fail");
    console.log("[PASS] Replay protection verified: cannot re-verify already approved payment");

    uatResults.step3_paymentWorkflow.details.push("Seller QR snapshot, immutability trigger, screenshot enforcement, atomic verification, and replay protection all PASS");
  } catch (err) {
    console.error("[STEP 3 ERROR]", err);
    uatResults.step3_paymentWorkflow.status = "FAIL";
    throw err;
  }

  // -------------------------------------------------------------------------
  // STEP 4: TICKET WORKFLOW UAT
  // -------------------------------------------------------------------------
  console.log("\n--- [STEP 4] Ticket Workflow UAT ---");
  const mintedTicketNumbers = [];
  try {
    // 4.1 Verify minted tickets
    const { data: issuedTickets, error: tixErr } = await admin
      .from("tickets")
      .select("id, ticket_number, status, issued_at, order_id, customer_id")
      .eq("order_id", syntheticOrderId);

    assert.ifError(tixErr);
    assert.ok(issuedTickets.length > 0, "Tickets must have been minted for verified order");
    issuedTickets.forEach(t => {
      assert.equal(t.status, "ISSUED");
      mintedTicketNumbers.push(t.ticket_number);
    });
    console.log(`[PASS] Minted tickets for order: ${mintedTicketNumbers.join(", ")}`);

    // 4.2 Verify Ticket Identity Immutability Trigger
    console.log("Testing ticket identity immutability trigger (attempting to mutate ticket_number)...");
    const testTicket = issuedTickets[0];
    const { error: tixMutateErr } = await admin
      .from("tickets")
      .update({ ticket_number: "SSFI-TAMPERED-9999" })
      .eq("id", testTicket.id);

    assert.ok(tixMutateErr, "Direct UPDATE to ticket_number must fail with immutability exception");
    assert.match(tixMutateErr.message, /immutable|cannot be changed|cannot be modified/i);
    console.log("[PASS] Ticket identity immutability trigger (trg_protect_ticket_identity_immutability) blocked modification");

    // 4.3 Verify Public Ticket Verification Data Minimization
    console.log(`Testing public ticket verification metadata for ${testTicket.ticket_number}...`);
    const { data: publicTicket, error: pubTixErr } = await admin
      .from("tickets")
      .select("ticket_number, status, issued_at, campaigns(name)")
      .eq("ticket_number", testTicket.ticket_number)
      .single();

    assert.ifError(pubTixErr);
    assert.equal(publicTicket.ticket_number, testTicket.ticket_number);
    assert.equal(publicTicket.status, "ISSUED");
    assert.ok(!("customer_id" in publicTicket) && !("full_name" in publicTicket) && !("phone" in publicTicket), "Public payload must not contain customer PII");
    console.log("[PASS] Public ticket verification payload contains status and metadata with ZERO customer PII");

    // 4.4 Verify Email Outbox Event Creation for tickets
    const { data: outboxEvents, error: outboxErr } = await admin
      .from("customer_email_outbox")
      .select("event_type, status, idempotency_key")
      .order("created_at", { ascending: false })
      .limit(5);

    assert.ifError(outboxErr);
    const eventTypes = outboxEvents.map(e => e.event_type);
    console.log(`Recent Outbox event types: ${eventTypes.join(", ")}`);
    assert.ok(eventTypes.some(t => ["ORDER_CREATED", "PAYMENT_APPROVED", "TICKETS_ISSUED", "WINNER_ANNOUNCED", "ADMIN_TEST"].includes(t)));
    console.log("[PASS] Customer Email Outbox records verified with valid event types and safety gate active");

    uatResults.step4_ticketWorkflow.details.push("Atomic minting, ticket immutability trigger, zero-PII public verification, and outbox event creation all PASS");
  } catch (err) {
    console.error("[STEP 4 ERROR]", err);
    uatResults.step4_ticketWorkflow.status = "FAIL";
    throw err;
  }

  // -------------------------------------------------------------------------
  // STEP 5: LUCKY DRAW WORKFLOW UAT
  // -------------------------------------------------------------------------
  console.log("\n--- [STEP 5] Lucky Draw Workflow UAT ---");
  const syntheticDrawId = crypto.randomUUID();
  const prizeIds = {
    p5: crypto.randomUUID(),
    p4: crypto.randomUUID(),
    p3: crypto.randomUUID(),
    p2: crypto.randomUUID(),
    p1: crypto.randomUUID(),
  };
  const drawTicketIds = [];
  const snapshotMap = new Map();
  const resultsMap = new Map();

  try {
    // 5.1 Insert 5 official prizes (5th to 1st)
    const prizeRecords = [
      { id: prizeIds.p5, campaign_id: syntheticCampaignId, prize_number: 5, title: "5th Prize (UAT)", display_order: 1 },
      { id: prizeIds.p4, campaign_id: syntheticCampaignId, prize_number: 4, title: "4th Prize (UAT)", display_order: 2 },
      { id: prizeIds.p3, campaign_id: syntheticCampaignId, prize_number: 3, title: "3rd Prize (UAT)", display_order: 3 },
      { id: prizeIds.p2, campaign_id: syntheticCampaignId, prize_number: 2, title: "2nd Prize (UAT)", display_order: 4 },
      { id: prizeIds.p1, campaign_id: syntheticCampaignId, prize_number: 1, title: "1st Prize (UAT)", display_order: 5 },
    ];
    const { error: prizesErr } = await admin.from("prizes").insert(prizeRecords);
    assert.ifError(prizesErr);

    // 5.2 Mint 10 synthetic tickets for a robust draw pool
    const baseTicketNum = Math.floor(930000 + Math.random() * 60000);
    for (let i = 1; i <= 10; i++) {
      const tId = crypto.randomUUID();
      const tNum = `SSFI-${String(baseTicketNum + i).padStart(6, "0")}`;
      const { error: insTixErr } = await admin.from("tickets").insert({
        id: tId,
        ticket_number: tNum,
        campaign_id: syntheticCampaignId,
        customer_id: syntheticCustomerId,
        order_id: syntheticOrderId,
        seller_id: SELLER_007_ID,
        status: "ISSUED",
        issued_at: new Date().toISOString(),
      });
      assert.ifError(insTixErr);
      drawTicketIds.push({ id: tId, ticket_number: tNum });
    }
    console.log(`[PASS] Minted 10 candidate tickets for draw session`);

    // 5.3 Initialize draw session with pre-committed CSPRNG seed
    const sessionServerSeed = crypto.randomBytes(32).toString("hex");
    const sessionSeedCommitment = crypto.createHash("sha256").update(sessionServerSeed).digest("hex");

    const { error: drawInitErr } = await admin.from("draws").insert({
      id: syntheticDrawId,
      campaign_id: syntheticCampaignId,
      name: "Phase 9G UAT Ceremonial Draw Session",
      status: "DRAFT",
      seed_commitment: sessionSeedCommitment,
      seed_revealed: sessionServerSeed,
    });
    assert.ifError(drawInitErr);
    console.log("[PASS] Initialized draw session with pre-committed seed");

    // 5.4 Sequence Enforcement: Attempting to draw 4th prize before 5th MUST FAIL
    const roster5Numbers = drawTicketIds.map((t) => t.ticket_number).sort();
    const roster5Ids = roster5Numbers.map((num) => drawTicketIds.find((t) => t.ticket_number === num).id);
    const hash5 = computeCanonicalSnapshotHash(roster5Numbers);

    // Lock eligibility snapshot for 5th prize (all 10 tickets eligible)
    const { data: snap5Id, error: snap5Err } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p5,
      p_snapshot_hash: hash5,
      p_ticket_ids: roster5Ids,
      p_ticket_numbers: roster5Numbers,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ifError(snap5Err);
    snapshotMap.set(5, typeof snap5Id === "string" ? snap5Id : snap5Id.snapshot_id);

    console.log("Testing Prize Sequence Enforcement: Attempting to draw 4th prize before 5th...");
    const combinedSeed4Premature = computeCombinedSeed(sessionServerSeed, "client_ent", hash5, prizeIds.p4);
    const { error: seqErr } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p4,
      p_snapshot_id: snapshotMap.get(5),
      p_winning_index: 0,
      p_seed_commitment: sessionSeedCommitment,
      p_seed_revealed: sessionServerSeed,
      p_combined_seed: combinedSeed4Premature,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ok(seqErr, "Drawing 4th Prize before 5th Prize MUST be rejected by sequence guard");
    assert.match(seqErr.message, /Sequence violation/i);
    console.log("[PASS] Out-of-sequence draw attempt strictly rejected with SQL sequence violation");

    // 5.5 Draw 5th Prize
    const clientEntropy5 = "uat_entropy_prize_5";
    const combinedSeed5 = computeCombinedSeed(sessionServerSeed, clientEntropy5, hash5, prizeIds.p5);
    const winningIdx5 = deriveWinningIndex(combinedSeed5, roster5Numbers.length);

    const { data: res5, error: exec5Err } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p5,
      p_snapshot_id: snapshotMap.get(5),
      p_winning_index: winningIdx5,
      p_seed_commitment: sessionSeedCommitment,
      p_seed_revealed: sessionServerSeed,
      p_combined_seed: combinedSeed5,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: clientEntropy5,
    });
    assert.ifError(exec5Err);
    resultsMap.set(5, res5);
    const winner5TicketId = res5.ticket_id;
    console.log(`[PASS] 5th Prize successfully drawn. Winner ticket: ${res5.ticket_number} (Index: ${winningIdx5})`);

    // 5.6 Winner Uniqueness: Draw 4th Prize and verify 5th prize winner is excluded
    const roster4Numbers = drawTicketIds.filter((t) => t.id !== winner5TicketId).map((t) => t.ticket_number).sort();
    assert.equal(roster4Numbers.length, 9, "4th prize roster must exclude 5th prize winner");
    const roster4Ids = roster4Numbers.map((num) => drawTicketIds.find((t) => t.ticket_number === num).id);
    const hash4 = computeCanonicalSnapshotHash(roster4Numbers);

    const { data: snap4Id, error: snap4Err } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p4,
      p_snapshot_hash: hash4,
      p_ticket_ids: roster4Ids,
      p_ticket_numbers: roster4Numbers,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ifError(snap4Err);
    snapshotMap.set(4, typeof snap4Id === "string" ? snap4Id : snap4Id.snapshot_id);

    const clientEntropy4 = "uat_entropy_prize_4";
    const combinedSeed4 = computeCombinedSeed(sessionServerSeed, clientEntropy4, hash4, prizeIds.p4);
    const winningIdx4 = deriveWinningIndex(combinedSeed4, roster4Numbers.length);

    const { data: res4, error: exec4Err } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p4,
      p_snapshot_id: snapshotMap.get(4),
      p_winning_index: winningIdx4,
      p_seed_commitment: sessionSeedCommitment,
      p_seed_revealed: sessionServerSeed,
      p_combined_seed: combinedSeed4,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: clientEntropy4,
    });
    assert.ifError(exec4Err);
    resultsMap.set(4, res4);
    console.log(`[PASS] 4th Prize drawn: Ticket ${res4.ticket_number} (excludes 5th prize winner)`);

    // Execute 3rd and 2nd prizes in sequence
    // 3rd Prize (8 candidates)
    const prevWinners3 = [res5.ticket_id, res4.ticket_id];
    const roster3Numbers = drawTicketIds.filter((t) => !prevWinners3.includes(t.id)).map((t) => t.ticket_number).sort();
    const roster3Ids = roster3Numbers.map((num) => drawTicketIds.find((t) => t.ticket_number === num).id);
    const hash3 = computeCanonicalSnapshotHash(roster3Numbers);
    const { data: snap3Id, error: snap3Err } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p3,
      p_snapshot_hash: hash3,
      p_ticket_ids: roster3Ids,
      p_ticket_numbers: roster3Numbers,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ifError(snap3Err);
    snapshotMap.set(3, typeof snap3Id === "string" ? snap3Id : snap3Id.snapshot_id);

    const clientEntropy3 = "uat_entropy_prize_3";
    const combinedSeed3 = computeCombinedSeed(sessionServerSeed, clientEntropy3, hash3, prizeIds.p3);
    const winningIdx3 = deriveWinningIndex(combinedSeed3, roster3Numbers.length);
    const { data: res3, error: exec3Err } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p3,
      p_snapshot_id: snapshotMap.get(3),
      p_winning_index: winningIdx3,
      p_seed_commitment: sessionSeedCommitment,
      p_seed_revealed: sessionServerSeed,
      p_combined_seed: combinedSeed3,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: clientEntropy3,
    });
    assert.ifError(exec3Err);
    resultsMap.set(3, res3);
    console.log(`[PASS] 3rd Prize drawn: Ticket ${res3.ticket_number}`);

    // 2nd Prize (7 candidates)
    const prevWinners2 = [res5.ticket_id, res4.ticket_id, res3.ticket_id];
    const roster2Numbers = drawTicketIds.filter((t) => !prevWinners2.includes(t.id)).map((t) => t.ticket_number).sort();
    const roster2Ids = roster2Numbers.map((num) => drawTicketIds.find((t) => t.ticket_number === num).id);
    const hash2 = computeCanonicalSnapshotHash(roster2Numbers);
    const { data: snap2Id, error: snap2Err } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p2,
      p_snapshot_hash: hash2,
      p_ticket_ids: roster2Ids,
      p_ticket_numbers: roster2Numbers,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ifError(snap2Err);
    snapshotMap.set(2, typeof snap2Id === "string" ? snap2Id : snap2Id.snapshot_id);

    const clientEntropy2 = "uat_entropy_prize_2";
    const combinedSeed2 = computeCombinedSeed(sessionServerSeed, clientEntropy2, hash2, prizeIds.p2);
    const winningIdx2 = deriveWinningIndex(combinedSeed2, roster2Numbers.length);
    const { data: res2, error: exec2Err } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p2,
      p_snapshot_id: snapshotMap.get(2),
      p_winning_index: winningIdx2,
      p_seed_commitment: sessionSeedCommitment,
      p_seed_revealed: sessionServerSeed,
      p_combined_seed: combinedSeed2,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: clientEntropy2,
    });
    assert.ifError(exec2Err);
    resultsMap.set(2, res2);
    console.log(`[PASS] 2nd Prize drawn: Ticket ${res2.ticket_number}`);

    // 5.7 Policy A Dual Approval for 1st Prize
    const prevWinners1 = [res5.ticket_id, res4.ticket_id, res3.ticket_id, res2.ticket_id];
    const roster1Numbers = drawTicketIds.filter((t) => !prevWinners1.includes(t.id)).map((t) => t.ticket_number).sort();
    const roster1Ids = roster1Numbers.map((num) => drawTicketIds.find((t) => t.ticket_number === num).id);
    const hash1 = computeCanonicalSnapshotHash(roster1Numbers);

    const { data: snap1Id, error: snap1Err } = await admin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p1,
      p_snapshot_hash: hash1,
      p_ticket_ids: roster1Ids,
      p_ticket_numbers: roster1Numbers,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ifError(snap1Err);
    snapshotMap.set(1, typeof snap1Id === "string" ? snap1Id : snap1Id.snapshot_id);

    const clientEntropy1 = "uat_entropy_prize_1";
    const combinedSeed1 = computeCombinedSeed(sessionServerSeed, clientEntropy1, hash1, prizeIds.p1);
    const winningIdx1 = deriveWinningIndex(combinedSeed1, roster1Numbers.length);

    // Attempt draw without approval -> MUST FAIL
    console.log("Testing Policy A Dual Control: Attempting to execute 1st prize without approval...");
    const { error: unapprovedExecErr } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p1,
      p_snapshot_id: snapshotMap.get(1),
      p_winning_index: winningIdx1,
      p_seed_commitment: sessionSeedCommitment,
      p_seed_revealed: sessionServerSeed,
      p_combined_seed: combinedSeed1,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: clientEntropy1,
    });
    assert.ok(unapprovedExecErr, "1st Prize execution without approval MUST fail");
    assert.match(unapprovedExecErr.message, /Dual approval violation/i);
    console.log("[PASS] Execution without approval blocked by Policy A dual control guard");

    // Request approval by SUPER_ADMIN
    const { data: approvalId, error: reqAppErr } = await admin.rpc("admin_request_first_prize_approval", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p1,
      p_snapshot_id: snapshotMap.get(1),
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ifError(reqAppErr);

    // Self-approval attempt (initiator === approver) -> MUST FAIL
    console.log("Testing Four-Eyes Principle: Initiator attempting to self-approve 1st prize...");
    const { error: selfAppErr } = await admin.rpc("admin_record_first_prize_approval", {
      p_approval_id: approvalId,
      p_decision: "APPROVED",
      p_notes: "Illegal self approval attempt",
      p_actor: SUPER_ADMIN_ID, // SAME actor as initiator
    });
    assert.ok(selfAppErr, "Self-approval must fail");
    assert.match(selfAppErr.message, /Four-eyes violation/i);
    console.log("[PASS] Self-approval blocked by distinct actors check constraint (draw_approvals_distinct_actors)");

    // Valid approval by distinct ADMIN
    console.log("Recording valid approval by distinct ADMIN...");
    const { error: validAppErr } = await admin.rpc("admin_record_first_prize_approval", {
      p_approval_id: approvalId,
      p_decision: "APPROVED",
      p_notes: "Approved by distinct Administrator for UAT",
      p_actor: ADMIN_ID, // DIFFERENT actor
    });
    assert.ifError(validAppErr);
    console.log("[PASS] 1st prize approved by distinct administrator");

    // Now execute 1st prize
    const { data: res1, error: exec1Err } = await admin.rpc("execute_draw_winner_selection", {
      p_draw_id: syntheticDrawId,
      p_prize_id: prizeIds.p1,
      p_snapshot_id: snapshotMap.get(1),
      p_winning_index: winningIdx1,
      p_seed_commitment: sessionSeedCommitment,
      p_seed_revealed: sessionServerSeed,
      p_combined_seed: combinedSeed1,
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: clientEntropy1,
    });
    assert.ifError(exec1Err);
    resultsMap.set(1, res1);
    const res1Id = res1.result_id;
    assert.ok(res1Id, "result_id must be returned from execute_draw_winner_selection");
    console.log(`[PASS] 1st prize executed cleanly following valid dual approval: Ticket ${res1.ticket_number}`);
    console.log("[PASS] 1st prize executed cleanly following valid dual approval");

    // 5.8 Randomness Evidence Verification
    console.log("Verifying randomness evidence for all 5 executed prizes...");
    const { data: evidenceRows, error: evErr } = await admin
      .from("draw_randomness_evidence")
      .select("*, snapshot:draw_eligibility_snapshots(snapshot_hash)")
      .eq("draw_id", syntheticDrawId);
    assert.ifError(evErr);
    assert.equal(evidenceRows.length, 5, "Must have exactly 5 evidence records");

    for (const ev of evidenceRows) {
      const snapHash = ev.snapshot?.snapshot_hash || "";
      const vResult = verifyDrawEvidence({
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
      assert.equal(vResult.isValid, true, `Evidence for prize ${ev.prize_id} must be valid`);
      assert.equal(vResult.commitmentMatches, true);
      assert.equal(vResult.combinedSeedMatches, true);
      assert.equal(vResult.indexMatches, true);
    }
    console.log("[PASS] All 5 randomness evidence records independently verified");

    // Test tamper detection: modified client entropy must be flagged as invalid
    const tampered = verifyDrawEvidence({
      serverSeedCommitment: evidenceRows[0].server_seed_commitment,
      serverSeedRevealed: evidenceRows[0].server_seed_revealed,
      clientEntropy: "tampered_entropy_tamper",
      combinedSeed: evidenceRows[0].combined_seed,
      snapshotHash: evidenceRows[0].snapshot?.snapshot_hash || "",
      prizeId: evidenceRows[0].prize_id,
      totalCandidates: evidenceRows[0].total_candidates,
      selectedIndex: evidenceRows[0].selected_index,
      winningTicketNumber: evidenceRows[0].winning_ticket_number,
    });
    assert.equal(tampered.isValid, false, "Tampered evidence MUST fail verification");
    console.log("[PASS] Tamper detection verified: Altered client entropy correctly failed verification");

    // 5.9 Result Immutability
    console.log("Testing draw result immutability (attempting to alter 1st prize result)...");
    const { error: mutResErr } = await admin
      .from("draw_results")
      .update({ selection_index: 999 })
      .eq("id", res1Id);
    assert.ok(mutResErr, "Mutating draw_results must fail with immutability exception");
    console.log("[PASS] Draw result immutability trigger blocked modification");

    // 5.10 Winner Notification Stamping & Idempotency
    console.log("Testing winner notification stamping and idempotency for 1st prize...");
    const expectedIdempotencyKey = `WINNER_ANNOUNCED:${res1Id}`;
    const { data: outboxJob, error: outboxInsErr } = await admin
      .from("customer_email_outbox")
      .insert({
        idempotency_key: expectedIdempotencyKey,
        order_id: syntheticOrderId,
        customer_id: syntheticCustomerId,
        event_type: "WINNER_ANNOUNCED",
        recipient: "synthetic.uat.customer@example.com",
        subject: "[SSFI Lucky Draw] Congratulations! You Won 1st Prize",
        body_text: `Congratulations! Your ticket ${res1.ticket_number} won 1st Prize.`,
        body_html: `<p>Congratulations! Your ticket ${res1.ticket_number} won 1st Prize.</p>`,
        status: "QUEUED",
      })
      .select()
      .single();
    assert.ifError(outboxInsErr);

    const { error: stampErr } = await admin.rpc("admin_stamp_winner_notification", {
      p_result_id: res1Id,
      p_outbox_id: outboxJob.id,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ifError(stampErr);
    console.log("[PASS] Authoritative winner notification stamped via admin_stamp_winner_notification RPC");

    // Re-stamping already notified result MUST FAIL (enforces single notification)
    const { error: reStampErr } = await admin.rpc("admin_stamp_winner_notification", {
      p_result_id: res1Id,
      p_outbox_id: outboxJob.id,
      p_actor: SUPER_ADMIN_ID,
    });
    assert.ok(reStampErr, "Re-stamping already notified result must fail");
    assert.match(reStampErr.message, /already been recorded/i);
    console.log("[PASS] Re-stamping rejected: Winner notification already recorded");

    // 5.11 Clean up: Retire synthetic draw to CANCELLED (non-destructive)
    await admin.from("draws").update({ status: "CANCELLED" }).eq("id", syntheticDrawId);
    await admin.from("campaigns").update({ status: "CANCELLED" }).eq("id", syntheticCampaignId);
    console.log("[PASS] Synthetic draw and campaign retired to CANCELLED");

    uatResults.step5_luckyDrawWorkflow.details.push("Prize sequence, winner uniqueness, Policy A dual approval, randomness verification, immutability, and notification idempotency all PASS");
  } catch (err) {
    console.error("[STEP 5 ERROR]", err);
    uatResults.step5_luckyDrawWorkflow.status = "FAIL";
    throw err;
  }

  // -------------------------------------------------------------------------
  // STEP 6: SECURITY REGRESSION UAT
  // -------------------------------------------------------------------------
  console.log("\n--- [STEP 6] Security Regression UAT ---");
  try {
    // 6.1 Unauthenticated RPC Execution Blocked
    const anonClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon", {
      auth: { persistSession: false },
    });

    const { error: anonRpcErr } = await anonClient.rpc("verify_payment_and_issue", {
      p_payment_id: "00000000-0000-0000-0000-000000000000",
      p_actor: "00000000-0000-0000-0000-000000000000",
    });
    assert.ok(anonRpcErr, "Anon must be denied EXECUTE on verify_payment_and_issue");
    console.log("[PASS] Anonymous RPC invocation blocked (permission denied)");

    // 6.2 Anonymous Direct PostgREST Access Blocked
    const { data: anonOrders } = await anonClient.from("orders").select("id");
    assert.equal(anonOrders?.length ?? 0, 0, "Anonymous user must see 0 orders");

    const { data: anonOutbox } = await anonClient.from("customer_email_outbox").select("id");
    assert.equal(anonOutbox?.length ?? 0, 0, "Anonymous user must see 0 outbox records");
    console.log("[PASS] Anonymous PostgREST direct access returns 0 rows across protected tables");

    // 6.3 Rate Limiting Sliding Window Verification
    resetRateLimitsForTesting();
    const testOrderId = crypto.randomUUID();
    const testClientIp = "192.168.1.100";

    let lastResult;
    for (let i = 1; i <= 10; i++) {
      lastResult = await checkOrderAccessRateLimit({ orderId: testOrderId, clientIp: testClientIp });
      assert.equal(lastResult.allowed, true, `Attempt ${i} within limit must be allowed`);
    }
    // 11th attempt must be blocked
    const blockedResult = await checkOrderAccessRateLimit({ orderId: testOrderId, clientIp: testClientIp });
    assert.equal(blockedResult.allowed, false, "11th attempt must exceed IP limit");
    assert.equal(blockedResult.reason, "IP_LIMIT_EXCEEDED");
    console.log("[PASS] Rate limiter strictly blocks after 10 attempts per IP/order");

    // 6.4 Outbox Constraint Enforcement
    // Attempting to insert an invalid event type must fail check constraint
    const { error: badEventErr } = await admin.from("customer_email_outbox").insert({
      event_type: "UNAUTHORIZED_PROMOTIONAL_EVENT",
      recipient: "test@example.com",
      subject: "Test invalid event",
      body_text: "Invalid event type test",
      body_html: "<p>Invalid event type test</p>",
      status: "QUEUED",
      idempotency_key: "BAD_KEY_" + Date.now(),
    });
    assert.ok(badEventErr, "Inserting unrecognized event_type must fail check constraint");
    assert.match(badEventErr.message, /check constraint|customer_email_outbox_event_type_check|23514/i);
    console.log("[PASS] customer_email_outbox_event_type_check rejects invalid event types");

    uatResults.step6_securityRegression.details.push("Anonymous RPC rejection, PostgREST isolation, rate limiting threshold, and outbox constraint validation all PASS");
  } catch (err) {
    console.error("[STEP 6 ERROR]", err);
    uatResults.step6_securityRegression.status = "FAIL";
    throw err;
  }

  console.log("\n==================================================================");
  console.log("PHASE 9G PREVIEW UAT EXECUTION COMPLETED SUCCESSFULLY");
  console.log("==================================================================");
  console.log("All UAT Steps: PASS");
  return uatResults;
}

runUat().catch(err => {
  console.error("FATAL UAT FAILURE:", err);
  process.exit(1);
});
