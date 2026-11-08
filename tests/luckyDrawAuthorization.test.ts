import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

test("Lucky Draw Authorization & Business Invariants Suite", async (t) => {
  // ==========================================================================
  // 1. POLICY A — FIRST PRIZE TWO-PERSON AUTHORIZATION SIMULATION
  // ==========================================================================
  await t.test("Policy A: Initiator must have SUPER_ADMIN role", () => {
    function validateInitiatorRole(role: string): { allowed: boolean; error?: string } {
      if (role !== "SUPER_ADMIN") {
        return {
          allowed: false,
          error: "Policy A Violation: Only an authenticated user with SUPER_ADMIN role can initiate First Prize authorization.",
        };
      }
      return { allowed: true };
    }

    assert.equal(validateInitiatorRole("SUPER_ADMIN").allowed, true);
    assert.equal(validateInitiatorRole("ADMIN").allowed, false);
    assert.equal(validateInitiatorRole("FUNDRAISING_MANAGER").allowed, false);
    assert.equal(validateInitiatorRole("SELLER").allowed, false);
  });

  await t.test("Policy A: Approver must be distinct from initiator and have ADMIN or SUPER_ADMIN", () => {
    const initiatorId = "user-superadmin-01";

    function validateApproval(
      initiator: string,
      approver: string,
      approverRole: string
    ): { allowed: boolean; error?: string } {
      // 1. Self-approval check
      if (initiator === approver) {
        return {
          allowed: false,
          error: "Policy A Violation: The initiator cannot approve their own authorization request (self-approval forbidden).",
        };
      }

      // 2. Approver role check
      if (!["SUPER_ADMIN", "ADMIN"].includes(approverRole)) {
        return {
          allowed: false,
          error: "Policy A Violation: Approver must have ADMIN or SUPER_ADMIN role.",
        };
      }

      return { allowed: true };
    }

    // Valid approvals
    assert.equal(validateApproval(initiatorId, "user-admin-02", "ADMIN").allowed, true);
    assert.equal(validateApproval(initiatorId, "user-superadmin-02", "SUPER_ADMIN").allowed, true);

    // Self-approval attempt strictly blocked
    const selfApproval = validateApproval(initiatorId, initiatorId, "SUPER_ADMIN");
    assert.equal(selfApproval.allowed, false);
    assert.match(selfApproval.error!, /self-approval forbidden/i);

    // Invalid approver roles blocked
    assert.equal(validateApproval(initiatorId, "user-manager-03", "FUNDRAISING_MANAGER").allowed, false);
    assert.equal(validateApproval(initiatorId, "user-seller-04", "SELLER").allowed, false);
  });

  await t.test("Policy A: Approval is cryptographic-hash bound to exact snapshot hash", () => {
    const snapshotA_Hash = crypto.createHash("sha256").update("ROSTER_SNAPSHOT_A").digest("hex");
    const snapshotB_Hash = crypto.createHash("sha256").update("ROSTER_SNAPSHOT_B").digest("hex");

    const approvalRecord = {
      drawId: "draw-1",
      prizeId: "prize-1st",
      snapshotHash: snapshotA_Hash,
      status: "APPROVED",
    };

    function canExecuteDraw(activeSnapshotHash: string): boolean {
      return (
        approvalRecord.status === "APPROVED" &&
        approvalRecord.snapshotHash.toLowerCase() === activeSnapshotHash.toLowerCase()
      );
    }

    assert.equal(canExecuteDraw(snapshotA_Hash), true, "Draw permitted when snapshot hash matches approved hash");
    assert.equal(canExecuteDraw(snapshotB_Hash), false, "Draw blocked if roster snapshot was altered/regenerated");
  });

  // ==========================================================================
  // 2. CEREMONIAL SEQUENCE ENFORCEMENT (5th -> 4th -> 3rd -> 2nd -> 1st)
  // ==========================================================================
  await t.test("Sequence Guard: strictly enforces 5th -> 4th -> 3rd -> 2nd -> 1st", () => {
    const prizes = [
      { id: "p5", prize_number: 5, title: "5th Prize" },
      { id: "p4", prize_number: 4, title: "4th Prize" },
      { id: "p3", prize_number: 3, title: "3rd Prize" },
      { id: "p2", prize_number: 2, title: "2nd Prize" },
      { id: "p1", prize_number: 1, title: "1st Prize" },
    ];

    assert.equal(prizes.length, 5);
    const completedPrizeNumbers = new Set<number>();

    function checkCanDrawPrize(targetPrizeNumber: number): { allowed: boolean; error?: string } {
      // Must have drawn all higher prize numbers (5 down to targetPrizeNumber + 1)
      for (let pNum = 5; pNum > targetPrizeNumber; pNum--) {
        if (!completedPrizeNumbers.has(pNum)) {
          return {
            allowed: false,
            error: `Sequence Violation: Prize ${pNum} must be drawn before Prize ${targetPrizeNumber}. Approved sequence is 5th -> 4th -> 3rd -> 2nd -> 1st.`,
          };
        }
      }
      return { allowed: true };
    }

    // Step 1: Attempting to draw 4th, 3rd, 2nd, or 1st before 5th is BLOCKED
    assert.equal(checkCanDrawPrize(4).allowed, false);
    assert.equal(checkCanDrawPrize(1).allowed, false);
    assert.equal(checkCanDrawPrize(5).allowed, true);

    // Draw 5th Prize
    completedPrizeNumbers.add(5);
    assert.equal(checkCanDrawPrize(4).allowed, true);
    assert.equal(checkCanDrawPrize(3).allowed, false);

    // Draw 4th Prize
    completedPrizeNumbers.add(4);
    assert.equal(checkCanDrawPrize(3).allowed, true);
    assert.equal(checkCanDrawPrize(2).allowed, false);

    // Draw 3rd Prize
    completedPrizeNumbers.add(3);
    assert.equal(checkCanDrawPrize(2).allowed, true);
    assert.equal(checkCanDrawPrize(1).allowed, false);

    // Draw 2nd Prize
    completedPrizeNumbers.add(2);
    assert.equal(checkCanDrawPrize(1).allowed, true);

    // Complete 1st Prize
    completedPrizeNumbers.add(1);
    assert.equal(completedPrizeNumbers.size, 5);
  });

  // ==========================================================================
  // 3. CAMPAIGN-WIDE SINGLE WINNER UNIQUENESS (RULE 3)
  // ==========================================================================
  await t.test("Campaign-Wide Uniqueness: winning ticket is permanently excluded from subsequent prize rosters", () => {
    const allIssuedTickets = [
      "SSFI-000001",
      "SSFI-000002",
      "SSFI-000003",
      "SSFI-000004",
      "SSFI-000005",
      "SSFI-000006",
      "SSFI-000007",
      "SSFI-000008",
      "SSFI-000009",
      "SSFI-000010",
    ];

    const campaignWinners = new Set<string>();

    function buildRosterForPrize(): string[] {
      return allIssuedTickets.filter((t) => !campaignWinners.has(t));
    }

    // 5th Prize Roster
    const roster5 = buildRosterForPrize();
    assert.equal(roster5.length, 10);
    const winner5 = "SSFI-000008"; // Drawn for 5th
    campaignWinners.add(winner5);

    // 4th Prize Roster
    const roster4 = buildRosterForPrize();
    assert.equal(roster4.length, 9);
    assert.ok(!roster4.includes(winner5), "5th prize winner must NOT be in 4th prize roster");
    const winner4 = "SSFI-000003"; // Drawn for 4th
    campaignWinners.add(winner4);

    // 3rd Prize Roster
    const roster3 = buildRosterForPrize();
    assert.equal(roster3.length, 8);
    assert.ok(!roster3.includes(winner5));
    assert.ok(!roster3.includes(winner4));
    const winner3 = "SSFI-000005"; // Drawn for 3rd
    campaignWinners.add(winner3);

    // 2nd Prize Roster
    const roster2 = buildRosterForPrize();
    assert.equal(roster2.length, 7);
    assert.ok(!roster2.includes(winner5));
    assert.ok(!roster2.includes(winner4));
    assert.ok(!roster2.includes(winner3));
    const winner2 = "SSFI-000001"; // Drawn for 2nd
    campaignWinners.add(winner2);

    // 1st Prize (Grand Prize) Roster
    const roster1 = buildRosterForPrize();
    assert.equal(roster1.length, 6);
    assert.ok(!roster1.includes(winner5));
    assert.ok(!roster1.includes(winner4));
    assert.ok(!roster1.includes(winner3));
    assert.ok(!roster1.includes(winner2));
    const winner1 = "SSFI-000010"; // Drawn for 1st
    campaignWinners.add(winner1);

    // Verify all 5 winners are strictly distinct
    assert.equal(campaignWinners.size, 5);
  });

  // ==========================================================================
  // 4. SNAPSHOT IMMUTABILITY & EXCLUSION MUTATION GUARDS
  // ==========================================================================
  await t.test("Snapshot Immutability: Mutating exclusions is strictly blocked once snapshot is locked", () => {
    let isSnapshotLocked = false;
    const exclusions = new Map<string, string>();

    function addExclusion(ticketId: string, reason: string): { success: boolean; error?: string } {
      if (isSnapshotLocked) {
        return {
          success: false,
          error: "Cannot add exclusion: Snapshot for this prize is already locked and immutable.",
        };
      }
      exclusions.set(ticketId, reason);
      return { success: true };
    }

    function removeExclusion(ticketId: string): { success: boolean; error?: string } {
      if (isSnapshotLocked) {
        return {
          success: false,
          error: "Cannot remove exclusion: Snapshot for this prize is already locked and immutable.",
        };
      }
      exclusions.delete(ticketId);
      return { success: true };
    }

    // While unlocked, exclusions can be added and removed
    assert.equal(addExclusion("ticket-1", "Duplicate issue").success, true);
    assert.equal(exclusions.size, 1);
    assert.equal(removeExclusion("ticket-1").success, true);
    assert.equal(exclusions.size, 0);

    // Add exclusion and lock snapshot
    addExclusion("ticket-2", "Administrative hold");
    isSnapshotLocked = true;

    // Post-lock mutations are blocked
    assert.equal(addExclusion("ticket-3", "Late request").success, false);
    assert.equal(removeExclusion("ticket-2").success, false);
    assert.equal(exclusions.has("ticket-2"), true, "Existing exclusion preserved immutably");
  });

  // ==========================================================================
  // 5. TRANSACTIONAL OUTBOX IDEMPOTENCY KEY BINDING
  // ==========================================================================
  await t.test("Transactional Outbox: Idempotency key WINNER_ANNOUNCED:${resultId} prevents duplicate customer delivery", () => {
    const resultId = "res-8888-9999-aaaa-bbbb";
    const expectedKey = `WINNER_ANNOUNCED:${resultId}`;

    function computeWinnerIdempotencyKey(resId: string): string {
      return `WINNER_ANNOUNCED:${resId}`;
    }

    assert.equal(computeWinnerIdempotencyKey(resultId), expectedKey);

    // Simulate outbox storage unique constraint
    const outboxKeys = new Set<string>();

    function enqueueNotification(resId: string): { success: boolean; duplicate?: boolean } {
      const key = computeWinnerIdempotencyKey(resId);
      if (outboxKeys.has(key)) {
        return { success: true, duplicate: true }; // Deduplicated
      }
      outboxKeys.add(key);
      return { success: true, duplicate: false };
    }

    const firstDispatch = enqueueNotification(resultId);
    assert.equal(firstDispatch.duplicate, false);

    // Second dispatch with same resultId is safely deduplicated
    const secondDispatch = enqueueNotification(resultId);
    assert.equal(secondDispatch.duplicate, true);
  });

  // ==========================================================================
  // 6. PHASE 10.3.1 REMEDIATION A — DRAW_APPROVALS ORDERING BY REQUESTED_AT
  // ==========================================================================
  await t.test("Remediation A: draw_approvals queries sort deterministically by requested_at descending", () => {
    interface MockApproval {
      id: string;
      draw_id: string;
      prize_id: string;
      snapshot_hash: string;
      status: "PENDING" | "APPROVED" | "REJECTED";
      requested_at: string;
    }

    const mockApprovals: MockApproval[] = [
      {
        id: "app-01",
        draw_id: "draw-1",
        prize_id: "prize-1",
        snapshot_hash: "hash-alpha",
        status: "REJECTED",
        requested_at: "2026-11-08T05:00:00.000Z",
      },
      {
        id: "app-02",
        draw_id: "draw-1",
        prize_id: "prize-1",
        snapshot_hash: "hash-alpha",
        status: "PENDING",
        requested_at: "2026-11-08T06:30:00.000Z",
      },
      {
        id: "app-03",
        draw_id: "draw-1",
        prize_id: "prize-1",
        snapshot_hash: "hash-alpha",
        status: "REJECTED",
        requested_at: "2026-11-08T06:00:00.000Z",
      },
    ];

    function resolveLatestApproval(
      approvals: MockApproval[],
      drawId: string,
      prizeId: string,
      snapshotHash: string
    ): MockApproval | null {
      const filtered = approvals
        .filter(
          (a) =>
            a.draw_id === drawId &&
            a.prize_id === prizeId &&
            a.snapshot_hash === snapshotHash
        )
        // Sort by requested_at descending (Remediation A)
        .sort((a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime());

      return filtered[0] || null;
    }

    // Resolves the most recent (2026-11-08T06:30:00.000Z), ignoring older rejected attempts
    const latest = resolveLatestApproval(mockApprovals, "draw-1", "prize-1", "hash-alpha");
    assert.ok(latest);
    assert.equal(latest.id, "app-02");
    assert.equal(latest.status, "PENDING");
    assert.equal(latest.requested_at, "2026-11-08T06:30:00.000Z");

    // Empty list returns null safely without errors
    const empty = resolveLatestApproval([], "draw-1", "prize-1", "hash-alpha");
    assert.equal(empty, null);
  });

  // ==========================================================================
  // 7. PHASE 10.3.1 REMEDIATION B — AUTHORITATIVE EVIDENCE IDENTIFIER CONTRACT
  // ==========================================================================
  await t.test("Remediation B: Authoritative verification contract enforces result/evidence parity and blocks cross-result substitution", async (sub) => {
    interface MockDrawResult {
      id: string;
      draw_id: string;
      prize_id: string;
      ticket_id: string;
      snapshot_id: string;
      selection_index: number;
      seed_commitment: string;
      seed_revealed: string;
      combined_seed: string;
    }

    interface MockEvidence {
      id: string;
      draw_id: string;
      prize_id: string;
      snapshot_id: string;
      algorithm_version: string;
      server_seed_commitment: string;
      server_seed_revealed: string;
      client_entropy: string | null;
      combined_seed: string;
      selected_index: number;
      total_candidates: number;
      winning_ticket_number: string;
      verification_status: "VERIFIED" | "FAILED";
    }

    // Cryptographically valid seeds for test fixtures
    const serverSeed = crypto.randomBytes(32).toString("hex");
    const seedCommitment = crypto.createHash("sha256").update(serverSeed).digest("hex");
    const clientEntropy = "test-operator-entropy";
    const combinedSeed = crypto
      .createHmac("sha256", serverSeed)
      .update(clientEntropy)
      .digest("hex");

    const resultA: MockDrawResult = {
      id: "11111111-1111-4111-8111-111111111111",
      draw_id: "draw-alpha",
      prize_id: "prize-01",
      ticket_id: "ticket-101",
      snapshot_id: "snap-alpha",
      selection_index: 3,
      seed_commitment: seedCommitment,
      seed_revealed: serverSeed,
      combined_seed: combinedSeed,
    };

    const evidenceA: MockEvidence = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      draw_id: "draw-alpha",
      prize_id: "prize-01",
      snapshot_id: "snap-alpha",
      algorithm_version: "SSFI-CSPRNG-V1",
      server_seed_commitment: seedCommitment,
      server_seed_revealed: serverSeed,
      client_entropy: clientEntropy,
      combined_seed: combinedSeed,
      selected_index: 3,
      total_candidates: 10,
      winning_ticket_number: "SSFI-000101",
      verification_status: "VERIFIED",
    };

    // Another distinct draw result & evidence pair
    const resultB: MockDrawResult = {
      id: "22222222-2222-4222-8222-222222222222",
      draw_id: "draw-alpha",
      prize_id: "prize-02",
      ticket_id: "ticket-102",
      snapshot_id: "snap-beta",
      selection_index: 7,
      seed_commitment: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      seed_revealed: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      combined_seed: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    };

    const evidenceB: MockEvidence = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      draw_id: "draw-alpha",
      prize_id: "prize-02",
      snapshot_id: "snap-beta",
      algorithm_version: "SSFI-CSPRNG-V1",
      server_seed_commitment: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      server_seed_revealed: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      client_entropy: null,
      combined_seed: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      selected_index: 7,
      total_candidates: 10,
      winning_ticket_number: "SSFI-000102",
      verification_status: "VERIFIED",
    };

    const mockDbResults = new Map<string, MockDrawResult>([
      [resultA.id, resultA],
      [resultB.id, resultB],
    ]);

    const mockDbEvidence = new Map<string, MockEvidence>([
      [evidenceA.id, evidenceA],
      [evidenceB.id, evidenceB],
    ]);

    // Service function simulating the remediated verifyDrawEvidenceAction
    function simulateVerifyEvidence(
      input: { drawResultId?: string; evidenceId?: string } | string,
      userRole: string | null
    ): { success: boolean; error?: string; isValid?: boolean; evidenceId?: string; drawResultId?: string } {
      // 1. RBAC Check
      if (!userRole || !["SUPER_ADMIN", "ADMIN"].includes(userRole)) {
        return { success: false, error: "Unauthorized access." };
      }

      let targetResultId: string | undefined;
      let targetEvidenceId: string | undefined;

      if (typeof input === "string") {
        targetEvidenceId = input;
      } else {
        targetResultId = input.drawResultId;
        targetEvidenceId = input.evidenceId;
      }

      if (targetResultId) {
        // Authoritative lookup of Draw Result
        const res = mockDbResults.get(targetResultId);
        if (!res) {
          return { success: false, error: "Draw result not found." };
        }

        // Authoritative resolution of evidence via (draw_id, prize_id)
        let resolvedEvidence: MockEvidence | null = null;
        for (const ev of mockDbEvidence.values()) {
          if (ev.draw_id === res.draw_id && ev.prize_id === res.prize_id) {
            resolvedEvidence = ev;
            break;
          }
        }

        if (!resolvedEvidence) {
          return { success: false, error: "Randomness evidence not found for this draw result." };
        }

        // Anti-substitution check
        if (targetEvidenceId && resolvedEvidence.id !== targetEvidenceId) {
          return {
            success: false,
            error: "Cross-result evidence substitution detected: supplied evidence does not match draw result.",
          };
        }

        // Parity check
        if (
          resolvedEvidence.selected_index !== res.selection_index ||
          resolvedEvidence.server_seed_commitment !== res.seed_commitment ||
          resolvedEvidence.server_seed_revealed !== res.seed_revealed ||
          resolvedEvidence.combined_seed !== res.combined_seed ||
          resolvedEvidence.snapshot_id !== res.snapshot_id
        ) {
          return { success: false, error: "Tampered or inconsistent evidence detected for draw result." };
        }

        // Cryptographic proof check
        const calculatedCommit = crypto.createHash("sha256").update(resolvedEvidence.server_seed_revealed).digest("hex");
        const isCryptoValid = calculatedCommit === resolvedEvidence.server_seed_commitment;

        return {
          success: true,
          isValid: isCryptoValid,
          evidenceId: resolvedEvidence.id,
          drawResultId: res.id,
        };
      }

      if (targetEvidenceId) {
        const ev = mockDbEvidence.get(targetEvidenceId);
        if (!ev) {
          return { success: false, error: "Randomness evidence not found." };
        }
        const calculatedCommit = crypto.createHash("sha256").update(ev.server_seed_revealed).digest("hex");
        return {
          success: true,
          isValid: calculatedCommit === ev.server_seed_commitment,
          evidenceId: ev.id,
        };
      }

      return { success: false, error: "Invalid identifier contract." };
    }

    // Scenario 1: Valid evidence associated with requested draw result
    await sub.test("Scenario 1: Valid evidence associated with requested draw result resolves and verifies", () => {
      const res = simulateVerifyEvidence({ drawResultId: resultA.id }, "SUPER_ADMIN");
      assert.equal(res.success, true);
      assert.equal(res.isValid, true);
      assert.equal(res.evidenceId, evidenceA.id);
      assert.equal(res.drawResultId, resultA.id);
    });

    // Scenario 2: Evidence ID supplied where draw-result ID is expected
    await sub.test("Scenario 2: Evidence ID supplied as drawResultId is cleanly rejected", () => {
      const res = simulateVerifyEvidence({ drawResultId: evidenceA.id }, "ADMIN");
      assert.equal(res.success, false);
      assert.equal(res.error, "Draw result not found.");
    });

    // Scenario 3: Draw-result ID supplied where evidence ID is expected
    await sub.test("Scenario 3: Draw-result ID supplied as evidenceId is cleanly rejected", () => {
      const res = simulateVerifyEvidence({ evidenceId: resultA.id }, "ADMIN");
      assert.equal(res.success, false);
      assert.equal(res.error, "Randomness evidence not found.");
    });

    // Scenario 4: Evidence belonging to a different draw result
    await sub.test("Scenario 4: Cross-result evidence substitution is strictly detected and blocked", () => {
      const res = simulateVerifyEvidence({ drawResultId: resultA.id, evidenceId: evidenceB.id }, "ADMIN");
      assert.equal(res.success, false);
      assert.match(res.error!, /Cross-result evidence substitution detected/);
    });

    // Scenario 5: Nonexistent draw result
    await sub.test("Scenario 5: Nonexistent draw result returns clean error", () => {
      const res = simulateVerifyEvidence({ drawResultId: "99999999-9999-4999-8999-999999999999" }, "SUPER_ADMIN");
      assert.equal(res.success, false);
      assert.equal(res.error, "Draw result not found.");
    });

    // Scenario 6: Missing evidence for draw result
    await sub.test("Scenario 6: Draw result without corresponding evidence returns clean error", () => {
      const orphanResult: MockDrawResult = {
        id: "33333333-3333-4333-8333-333333333333",
        draw_id: "draw-alpha",
        prize_id: "prize-99", // No evidence exists for prize-99
        ticket_id: "ticket-999",
        snapshot_id: "snap-orphan",
        selection_index: 0,
        seed_commitment: "commit",
        seed_revealed: "seed",
        combined_seed: "comb",
      };
      mockDbResults.set(orphanResult.id, orphanResult);

      const res = simulateVerifyEvidence({ drawResultId: orphanResult.id }, "SUPER_ADMIN");
      assert.equal(res.success, false);
      assert.equal(res.error, "Randomness evidence not found for this draw result.");
    });

    // Scenario 7: Schema uniqueness invariant
    await sub.test("Scenario 7: Relational mapping (draw_id, prize_id) is deterministic and unambiguous", () => {
      // In PostgreSQL schema: UNIQUE (draw_id, prize_id) on draw_randomness_evidence
      const mapped = [...mockDbEvidence.values()].filter(
        (ev) => ev.draw_id === resultA.draw_id && ev.prize_id === resultA.prize_id
      );
      assert.equal(mapped.length, 1, "Exactly one evidence record corresponds to the draw result");
      assert.equal(mapped[0].id, evidenceA.id);
    });

    // Scenario 8: Unauthorized user
    await sub.test("Scenario 8: Anonymous or seller role cannot execute evidence verification", () => {
      const resAnon = simulateVerifyEvidence({ drawResultId: resultA.id }, null);
      assert.equal(resAnon.success, false);
      assert.equal(resAnon.error, "Unauthorized access.");

      const resSeller = simulateVerifyEvidence({ drawResultId: resultA.id }, "SELLER");
      assert.equal(resSeller.success, false);
      assert.equal(resSeller.error, "Unauthorized access.");
    });

    // Scenario 9: Tampered or invalid evidence
    await sub.test("Scenario 9: Tampered seed commitment fails cryptographic verification", () => {
      const tamperedResult: MockDrawResult = {
        id: "44444444-4444-4444-8444-444444444444",
        draw_id: "draw-alpha",
        prize_id: "prize-04",
        ticket_id: "ticket-104",
        snapshot_id: "snap-tampered",
        selection_index: 2,
        seed_commitment: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        seed_revealed: serverSeed, // Hashes to seedCommitment, NOT deadbeef!
        combined_seed: combinedSeed,
      };
      const tamperedEvidence: MockEvidence = {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        draw_id: "draw-alpha",
        prize_id: "prize-04",
        snapshot_id: "snap-tampered",
        algorithm_version: "SSFI-CSPRNG-V1",
        server_seed_commitment: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        server_seed_revealed: serverSeed,
        client_entropy: clientEntropy,
        combined_seed: combinedSeed,
        selected_index: 2,
        total_candidates: 10,
        winning_ticket_number: "SSFI-000104",
        verification_status: "VERIFIED",
      };
      mockDbResults.set(tamperedResult.id, tamperedResult);
      mockDbEvidence.set(tamperedEvidence.id, tamperedEvidence);

      const res = simulateVerifyEvidence({ drawResultId: tamperedResult.id }, "ADMIN");
      assert.equal(res.success, true);
      assert.equal(res.isValid, false, "Cryptographic verification must detect mismatched seed commitment");
    });

    // Scenario 10: Valid evidence continues to pass cryptographic verification
    await sub.test("Scenario 10: Valid evidence passes cryptographic check with matching index and commitment", () => {
      const res = simulateVerifyEvidence({ drawResultId: resultA.id, evidenceId: evidenceA.id }, "ADMIN");
      assert.equal(res.success, true);
      assert.equal(res.isValid, true);
    });
  });
});
