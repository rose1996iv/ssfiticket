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
});
