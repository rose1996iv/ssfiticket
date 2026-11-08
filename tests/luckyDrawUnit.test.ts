import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  sortTicketsCanonically,
  computeCanonicalSnapshotHash,
  verifyDrawEvidence,
} from "../src/lib/draw/canonical.ts";
import {
  generateServerSeed,
  verifySeedCommitment,
  computeCombinedSeed,
  deriveWinningIndex,
} from "../src/lib/draw/randomness.ts";

test("Lucky Draw Unit Test Suite — Cryptography & Canonical Determinism", async (t) => {
  // ==========================================================================
  // 1. CANONICAL TICKET SORTING
  // ==========================================================================
  await t.test("sortTicketsCanonically sorts ticket numbers in strict natural ascending order", () => {
    const unsorted = [
      { id: "uuid-10", ticket_number: "SSFI-000010" },
      { id: "uuid-02", ticket_number: "SSFI-000002" },
      { id: "uuid-01", ticket_number: "SSFI-000001" },
      { id: "uuid-99", ticket_number: "SSFI-000099" },
      { id: "uuid-20", ticket_number: "SSFI-000020" },
    ];

    const sorted = sortTicketsCanonically(unsorted);

    assert.equal(sorted[0].ticket_number, "SSFI-000001");
    assert.equal(sorted[0].display_index, 0);
    assert.equal(sorted[1].ticket_number, "SSFI-000002");
    assert.equal(sorted[1].display_index, 1);
    assert.equal(sorted[2].ticket_number, "SSFI-000010");
    assert.equal(sorted[2].display_index, 2);
    assert.equal(sorted[3].ticket_number, "SSFI-000020");
    assert.equal(sorted[3].display_index, 3);
    assert.equal(sorted[4].ticket_number, "SSFI-000099");
    assert.equal(sorted[4].display_index, 4);
  });

  await t.test("sortTicketsCanonically handles alphanumeric variations and whitespace deterministically", () => {
    const tickets = [
      { id: "1", ticket_number: " SSFI-000005 " },
      { id: "2", ticket_number: "SSFI-000001" },
      { id: "3", ticket_number: "SSFI-000003" },
    ];

    const sorted = sortTicketsCanonically(tickets);
    assert.equal(sorted[0].ticket_number, "SSFI-000001");
    assert.equal(sorted[1].ticket_number, "SSFI-000003");
    assert.equal(sorted[2].ticket_number, "SSFI-000005");
  });

  // ==========================================================================
  // 2. CANONICAL SNAPSHOT HASHING
  // ==========================================================================
  await t.test("computeCanonicalSnapshotHash produces identical SHA-256 for identical ticket roster", () => {
    const rosterA = ["SSFI-000001", "SSFI-000002", "SSFI-000003"];
    const rosterB = ["SSFI-000001", "SSFI-000002", "SSFI-000003"];

    const hashA = computeCanonicalSnapshotHash(rosterA);
    const hashB = computeCanonicalSnapshotHash(rosterB);

    assert.equal(hashA, hashB);
    assert.equal(hashA.length, 64, "SHA-256 hex must be 64 characters");

    // Independent verification
    const expected = crypto.createHash("sha256").update("SSFI-000001\nSSFI-000002\nSSFI-000003").digest("hex");
    assert.equal(hashA, expected);
  });

  await t.test("computeCanonicalSnapshotHash is canonical: order-independent but roster-sensitive", () => {
    const roster1 = ["SSFI-000001", "SSFI-000002"];
    const roster2 = ["SSFI-000002", "SSFI-000001"]; // Permuted order of same tickets
    const roster3 = ["SSFI-000001", "SSFI-000003"]; // Different ticket

    const hash1 = computeCanonicalSnapshotHash(roster1);
    const hash2 = computeCanonicalSnapshotHash(roster2);
    const hash3 = computeCanonicalSnapshotHash(roster3);

    assert.equal(hash1, hash2, "Canonical sorting ensures permuted rosters have identical snapshot hash");
    assert.notEqual(hash1, hash3, "Ticket substitution must alter snapshot hash");
  });

  // ==========================================================================
  // 3. SEED COMMITMENT GENERATION & REVEAL
  // ==========================================================================
  await t.test("generateServerSeed returns 32-byte hex entropy and matching SHA-256 commitment", () => {
    const { serverSeed, seedCommitment } = generateServerSeed();

    assert.equal(serverSeed.length, 64, "32 bytes in hex must be 64 chars");
    assert.equal(seedCommitment.length, 64, "SHA-256 hex must be 64 chars");

    // Verify commit-reveal property
    const manualCommit = crypto.createHash("sha256").update(Buffer.from(serverSeed, "utf8")).digest("hex");
    assert.equal(seedCommitment.toLowerCase(), manualCommit.toLowerCase());

    const isMatch = verifySeedCommitment(serverSeed, seedCommitment);
    assert.ok(isMatch, "verifySeedCommitment must return true for valid pair");
  });

  await t.test("verifySeedCommitment rejects invalid or mismatched seed/commitment pairs", () => {
    const pairA = generateServerSeed();
    const pairB = generateServerSeed();

    assert.ok(!verifySeedCommitment(pairA.serverSeed, pairB.seedCommitment));
    assert.ok(!verifySeedCommitment("corrupted_seed", pairA.seedCommitment));
    assert.ok(!verifySeedCommitment(pairA.serverSeed, "invalid_hash"));
  });

  // ==========================================================================
  // 4. COMBINED SEED DERIVATION (HMAC-SHA256)
  // ==========================================================================
  await t.test("computeCombinedSeed binds server seed, client entropy, snapshot hash, and prize ID", () => {
    const serverSeed = "1111111111111111111111111111111111111111111111111111111111111111";
    const clientEntropy = "client_entropy_abc123";
    const snapshotHash = "2222222222222222222222222222222222222222222222222222222222222222";
    const prizeId = "33333333-3333-3333-3333-333333333333";

    const combinedA = computeCombinedSeed(serverSeed, clientEntropy, snapshotHash, prizeId);
    const combinedB = computeCombinedSeed(serverSeed, clientEntropy, snapshotHash, prizeId);

    assert.equal(combinedA, combinedB, "Combined seed must be strictly deterministic");

    // Any parameter mutation changes the combined seed completely
    const alteredClient = computeCombinedSeed(serverSeed, "altered_entropy", snapshotHash, prizeId);
    assert.notEqual(combinedA, alteredClient);

    const alteredPrize = computeCombinedSeed(serverSeed, clientEntropy, snapshotHash, "44444444-4444-4444-4444-444444444444");
    assert.notEqual(combinedA, alteredPrize);
  });

  // ==========================================================================
  // 5. REJECTION SAMPLING UNIFORMITY & ZERO MODULO BIAS
  // ==========================================================================
  await t.test("deriveWinningIndex derives winning index within valid [0, totalCandidates - 1] range", () => {
    const combinedSeed = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    const indexSmall = deriveWinningIndex(combinedSeed, 10);
    assert.ok(indexSmall >= 0 && indexSmall < 10, "Index must be in [0, 9]");

    const indexMedium = deriveWinningIndex(combinedSeed, 500);
    assert.ok(indexMedium >= 0 && indexMedium < 500, "Index must be in [0, 499]");

    const indexLarge = deriveWinningIndex(combinedSeed, 10000);
    assert.ok(indexLarge >= 0 && indexLarge < 10000, "Index must be in [0, 9999]");
  });

  await t.test("deriveWinningIndex is strictly deterministic for identical inputs", () => {
    const seed = crypto.randomBytes(32).toString("hex");
    const idx1 = deriveWinningIndex(seed, 250);
    const idx2 = deriveWinningIndex(seed, 250);
    assert.equal(idx1, idx2);
  });

  await t.test("deriveWinningIndex rejects non-positive candidate counts", () => {
    const seed = crypto.randomBytes(32).toString("hex");
    assert.throws(() => deriveWinningIndex(seed, 0), /greater than zero/i);
    assert.throws(() => deriveWinningIndex(seed, -5), /greater than zero/i);
  });

  await t.test("Statistical uniformity test across 1,000 synthetic draws exhibits no severe bias", () => {
    const candidateCount = 5;
    const bins = new Array(candidateCount).fill(0);
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      const seed = crypto.randomBytes(32).toString("hex");
      const idx = deriveWinningIndex(seed, candidateCount);
      bins[idx]++;
    }

    // Expected value per bin is 200 (1000 / 5)
    // In a uniform distribution, each bin should be roughly within [130, 270]
    for (let b = 0; b < candidateCount; b++) {
      assert.ok(
        bins[b] >= 130 && bins[b] <= 270,
        `Bin ${b} count ${bins[b]} deviated significantly from expected ~200`
      );
    }
  });

  // ==========================================================================
  // 6. CRYPTOGRAPHIC EVIDENCE VERIFIER
  // ==========================================================================
  await t.test("verifyDrawEvidence validates valid evidence and rejects tampered seeds or indices", () => {
    const { serverSeed, seedCommitment } = generateServerSeed();
    const clientEntropy = "random_client_entropy_xyz";
    const snapshotHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const prizeId = "55555555-5555-5555-5555-555555555555";
    const totalCandidates = 100;

    const combinedSeed = computeCombinedSeed(serverSeed, clientEntropy, snapshotHash, prizeId);
    const winningIndex = deriveWinningIndex(combinedSeed, totalCandidates);

    // Valid check
    const validResult = verifyDrawEvidence({
      serverSeedRevealed: serverSeed,
      serverSeedCommitment: seedCommitment,
      clientEntropy,
      combinedSeed,
      snapshotHash,
      prizeId,
      totalCandidates,
      selectedIndex: winningIndex,
      winningTicketNumber: "SSFI-000042",
    });

    assert.equal(validResult.isValid, true);
    assert.equal(validResult.commitmentMatches, true);
    assert.equal(validResult.combinedSeedMatches, true);
    assert.equal(validResult.indexMatches, true);

    // Tampered server seed
    const tamperedSeedResult = verifyDrawEvidence({
      serverSeedRevealed: "tampered_seed_1234567890",
      serverSeedCommitment: seedCommitment,
      clientEntropy,
      combinedSeed,
      snapshotHash,
      prizeId,
      totalCandidates,
      selectedIndex: winningIndex,
      winningTicketNumber: "SSFI-000042",
    });
    assert.equal(tamperedSeedResult.isValid, false);
    assert.equal(tamperedSeedResult.commitmentMatches, false);

    // Tampered winning index
    const tamperedIndexResult = verifyDrawEvidence({
      serverSeedRevealed: serverSeed,
      serverSeedCommitment: seedCommitment,
      clientEntropy,
      combinedSeed,
      snapshotHash,
      prizeId,
      totalCandidates,
      selectedIndex: (winningIndex + 1) % totalCandidates,
      winningTicketNumber: "SSFI-000042",
    });
    assert.equal(tamperedIndexResult.isValid, false);
    assert.equal(tamperedIndexResult.indexMatches, false);
  });
});
