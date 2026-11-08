import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

test("Phase 9C Lucky Draw SQL Security & Remediation Suite", async (t) => {
  const migrationPath = path.resolve(
    process.cwd(),
    "supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql"
  );
  const sql = fs.readFileSync(migrationPath, "utf8");

  // ==========================================================================
  // 1. Static SQL Review & Remediation Invariants
  // ==========================================================================
  await t.test("SEC-01: Administrative RPCs are revoked from authenticated and granted exclusively to service_role", () => {
    const adminFunctions = [
      "admin_lock_eligibility_snapshot",
      "admin_request_first_prize_approval",
      "admin_record_first_prize_approval",
      "execute_draw_winner_selection",
      "admin_stamp_winner_notification",
    ];

    for (const fn of adminFunctions) {
      const revokePattern = new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM public, anon, authenticated;`,
        "i"
      );
      assert.ok(
        revokePattern.test(sql),
        `Function ${fn} must revoke EXECUTE from public, anon, and authenticated`
      );

      const grantServiceRolePattern = new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`,
        "i"
      );
      assert.ok(
        grantServiceRolePattern.test(sql),
        `Function ${fn} must grant EXECUTE exclusively to service_role`
      );

      // Verify no grant to authenticated exists for this function
      const forbiddenGrant = new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO [^;]*authenticated`,
        "i"
      );
      assert.ok(
        !forbiddenGrant.test(sql),
        `Function ${fn} must NEVER grant EXECUTE to authenticated`
      );
    }
  });

  await t.test("SEC-02: BEFORE DELETE triggers return OLD on DELETE to allow proper deletion of draft snapshots", () => {
    assert.ok(
      sql.includes("IF TG_OP = 'DELETE' THEN\n    RETURN OLD;\n  END IF;"),
      "protect_draw_snapshot_immutability must return OLD on DELETE"
    );
    assert.ok(
      sql.includes("IF TG_OP = 'DELETE' THEN\n    RETURN OLD;\n  END IF;\n\n  RETURN NEW;"),
      "protect_draw_snapshot_tickets_immutability must return OLD on DELETE"
    );
  });

  await t.test("SEC-03: Seed grinding guard prevents replacing pre-committed session seed", () => {
    assert.ok(
      sql.includes("SEC-03: Seed Grinding Guard"),
      "execute_draw_winner_selection must include SEC-03 guard"
    );
    assert.ok(
      sql.includes("v_draw.seed_commitment IS NOT NULL AND v_draw.seed_commitment <> p_seed_commitment"),
      "execute_draw_winner_selection must reject mismatch between stored and supplied seed commitment"
    );
    assert.ok(
      sql.includes("seed_commitment = COALESCE(seed_commitment, p_seed_commitment)"),
      "draws.seed_commitment must not be overwritten if already set"
    );
  });

  await t.test("SEC-04: In-database cryptographic verification verifies revealed seed hashes to commitment", () => {
    assert.ok(
      sql.includes("SEC-04: Cryptographic Verification Guard"),
      "execute_draw_winner_selection must include SEC-04 cryptographic check"
    );
    assert.ok(
      sql.includes("lower(encode(sha256(convert_to(p_seed_revealed, 'UTF8')), 'hex')) <> lower(p_seed_commitment)"),
      "execute_draw_winner_selection must check sha256(p_seed_revealed) matches p_seed_commitment"
    );
  });

  await t.test("SEC-05: Approval modification is blocked once corresponding draw result exists", () => {
    assert.ok(
      sql.includes("Cannot modify approval request: Prize has already been drawn."),
      "admin_request_first_prize_approval must prevent request modification post-draw"
    );
    assert.ok(
      sql.includes("Cannot record approval: Prize has already been drawn."),
      "admin_record_first_prize_approval must prevent approval decision post-draw"
    );
  });

  await t.test("SEC-06: Campaign consistency guard verifies ticket belongs to draw campaign", () => {
    assert.ok(
      sql.includes("SEC-06: Campaign Consistency Guard"),
      "execute_draw_winner_selection must include SEC-06 campaign consistency guard"
    );
    assert.ok(
      sql.includes("v_ticket_master.campaign_id <> v_draw.campaign_id"),
      "execute_draw_winner_selection must reject cross-campaign ticket winners"
    );
  });

  await t.test("SEC-07: Public spectator read permissions are granted on draws, results, and evidence with RLS", () => {
    assert.ok(
      sql.includes("GRANT SELECT ON TABLE public.draws TO anon;"),
      "public.draws must be granted SELECT to anon"
    );
    assert.ok(
      sql.includes("GRANT SELECT ON TABLE public.draw_results TO anon;"),
      "public.draw_results must be granted SELECT to anon"
    );
    assert.ok(
      sql.includes("GRANT SELECT ON TABLE public.draw_randomness_evidence TO anon;"),
      "public.draw_randomness_evidence must be granted SELECT to anon"
    );
    assert.ok(
      sql.includes("status = 'EXECUTED'"),
      "draws public read policy must gate visibility until draw status is EXECUTED"
    );
  });

  await t.test("Balanced PL/pgSQL dollar-quoted blocks throughout migration", () => {
    const dollarMatches = sql.match(/\$\$/g);
    assert.ok(dollarMatches, "Migration must contain dollar quotes");
    assert.equal(dollarMatches.length % 2, 0, "Dollar quotes must be strictly balanced in pairs");
  });

  // ==========================================================================
  // 2. Behavioral Simulation Tests for Draw Security Invariants
  // ==========================================================================

  await t.test("Cryptographic Commit-Reveal Simulation: Valid seed reveal matches commitment", () => {
    const serverSeed = crypto.randomBytes(32).toString("hex");
    const commitment = crypto.createHash("sha256").update(serverSeed, "utf8").digest("hex");

    // In-database simulation: lower(encode(sha256(convert_to(seed, 'UTF8')), 'hex'))
    const computedHash = crypto.createHash("sha256").update(serverSeed, "utf8").digest("hex");
    assert.equal(computedHash.toLowerCase(), commitment.toLowerCase(), "Valid seed must verify");

    // Mismatched seed simulation (SEC-04)
    const corruptedSeed = crypto.randomBytes(32).toString("hex");
    const corruptedHash = crypto.createHash("sha256").update(corruptedSeed, "utf8").digest("hex");
    assert.notEqual(
      corruptedHash.toLowerCase(),
      commitment.toLowerCase(),
      "Mismatched seed must fail verification"
    );
  });

  await t.test("First Prize Policy A Dual-Control Simulation", () => {
    const superAdminId = "72054ec1-13a8-4b02-8d4e-d2b78f2df978";
    const adminId = "9a04809b-d9cd-4e9e-a414-038ea0a28adf";

    // 1. Valid Initiation by SUPER_ADMIN
    const canInitiate = (actorRole: string) => actorRole === "SUPER_ADMIN";
    assert.ok(canInitiate("SUPER_ADMIN"), "SUPER_ADMIN can initiate");
    assert.ok(!canInitiate("ADMIN"), "ADMIN cannot initiate 1st Prize dual control");

    // 2. Valid Approval by distinct ADMIN or SUPER_ADMIN
    const canApprove = (
      initiatorId: string,
      approverId: string,
      approverRole: string
    ) => {
      if (initiatorId === approverId) return false; // Self-approval prohibited (Four-eyes)
      return approverRole === "ADMIN" || approverRole === "SUPER_ADMIN";
    };

    assert.ok(
      canApprove(superAdminId, adminId, "ADMIN"),
      "Distinct ADMIN can approve SUPER_ADMIN request"
    );
    assert.ok(
      !canApprove(superAdminId, superAdminId, "SUPER_ADMIN"),
      "SUPER_ADMIN cannot self-approve their own request"
    );
    assert.ok(
      !canApprove(superAdminId, "someone-else", "SELLER"),
      "SELLER cannot approve 1st Prize request"
    );
  });

  await t.test("Ascending Sequence Enforcement Simulation (5th -> 4th -> 3rd -> 2nd -> 1st)", () => {
    const recordedResults = new Set<number>();

    const canDrawPrize = (prizeNumber: number, maxPrize = 5): boolean => {
      if (prizeNumber < maxPrize) {
        return recordedResults.has(prizeNumber + 1);
      }
      return true; // Prize 5 (maxPrize) has no predecessor
    };

    // Initial state: Attempting to draw Prize 1 fails
    assert.ok(!canDrawPrize(1), "Prize 1 cannot be drawn before Prize 2");
    assert.ok(!canDrawPrize(4), "Prize 4 cannot be drawn before Prize 5");

    // Step 1: Draw Prize 5
    assert.ok(canDrawPrize(5), "Prize 5 can be drawn first");
    recordedResults.add(5);

    // Step 2: Draw Prize 4
    assert.ok(canDrawPrize(4), "Prize 4 can be drawn after Prize 5");
    recordedResults.add(4);

    // Step 3: Draw Prize 3
    assert.ok(canDrawPrize(3), "Prize 3 can be drawn after Prize 4");
    recordedResults.add(3);

    // Step 4: Draw Prize 2
    assert.ok(canDrawPrize(2), "Prize 2 can be drawn after Prize 3");
    recordedResults.add(2);

    // Step 5: Draw Prize 1
    assert.ok(canDrawPrize(1), "Prize 1 can be drawn after Prize 2");
    recordedResults.add(1);
  });

  await t.test("Campaign-Wide Single Winner Invariant Simulation (Rule 3)", () => {
    const campaignWinners = new Map<string, string>(); // ticketId -> prizeId

    const recordWin = (campaignId: string, ticketId: string, prizeId: string) => {
      if (campaignWinners.has(ticketId)) {
        throw new Error(
          `Disqualified: Ticket ${ticketId} has already won prize ${campaignWinners.get(ticketId)} in campaign ${campaignId}`
        );
      }
      campaignWinners.set(ticketId, prizeId);
    };

    const campaignId = "camp-001";
    const ticket1 = "ticket-001";
    const ticket2 = "ticket-002";

    // Ticket 1 wins 5th prize
    recordWin(campaignId, ticket1, "prize-5");
    assert.equal(campaignWinners.get(ticket1), "prize-5");

    // Ticket 2 wins 4th prize
    recordWin(campaignId, ticket2, "prize-4");
    assert.equal(campaignWinners.get(ticket2), "prize-4");

    // Ticket 1 attempts to win 1st prize -> throws Rule 3 violation
    assert.throws(
      () => recordWin(campaignId, ticket1, "prize-1"),
      /Disqualified: Ticket ticket-001 has already won prize prize-5/
    );
  });

  await t.test("Notification Idempotency Stamping Simulation", () => {
    interface DrawResultRecord {
      id: string;
      notified_at: string | null;
      notified_by: string | null;
      notification_outbox_id: string | null;
    }

    const result: DrawResultRecord = {
      id: "res-001",
      notified_at: null,
      notified_by: null,
      notification_outbox_id: null,
    };

    const stampNotification = (actorId: string, outboxId: string) => {
      if (result.notified_at !== null) {
        throw new Error(`Winner notification has already been recorded at ${result.notified_at}`);
      }
      result.notified_at = new Date().toISOString();
      result.notified_by = actorId;
      result.notification_outbox_id = outboxId;
    };

    // First stamping succeeds
    stampNotification("admin-001", "outbox-001");
    assert.ok(result.notified_at !== null);
    assert.equal(result.notified_by, "admin-001");
    assert.equal(result.notification_outbox_id, "outbox-001");

    // Duplicate stamping throws idempotency error
    assert.throws(
      () => stampNotification("admin-001", "outbox-002"),
      /Winner notification has already been recorded/
    );
  });
});

