import crypto from "node:crypto";
import { computeCombinedSeed, deriveWinningIndex } from "./randomness.ts";

export interface CanonicalTicketInput {
  id: string;
  ticket_number: string;
}

export interface CanonicalTicketOutput extends CanonicalTicketInput {
  display_index: number;
}

/**
 * Canonically sorts ticket items by natural lexicographical ascending ticket_number.
 * Assigns contiguous 0-based display_index (0 .. N-1).
 */
export function sortTicketsCanonically(tickets: CanonicalTicketInput[]): CanonicalTicketOutput[] {
  const sorted = [...tickets].sort((a, b) => {
    const numA = a.ticket_number.trim();
    const numB = b.ticket_number.trim();
    return numA.localeCompare(numB, "en", { numeric: true, sensitivity: "base" });
  });

  return sorted.map((ticket, index) => ({
    id: ticket.id,
    ticket_number: ticket.ticket_number.trim(),
    display_index: index,
  }));
}

/**
 * Computes the canonical SHA-256 hash of a candidate roster.
 * Standard formula: SHA-256 of trimmed ticket_numbers joined by newline "\n".
 * Returns a 64-character lowercase hex digest.
 */
export function computeCanonicalSnapshotHash(ticketNumbers: string[]): string {
  if (!ticketNumbers || ticketNumbers.length === 0) {
    throw new Error("Cannot compute snapshot hash for empty roster.");
  }

  const sortedNumbers = [...ticketNumbers]
    .map((num) => num.trim())
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));

  const payload = sortedNumbers.join("\n");
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex").toLowerCase();
}

export interface VerificationInput {
  serverSeedCommitment: string;
  serverSeedRevealed: string;
  clientEntropy: string | null;
  combinedSeed: string;
  snapshotHash: string;
  prizeId: string;
  totalCandidates: number;
  selectedIndex: number;
  winningTicketNumber: string;
  rosterTicketNumbers?: string[];
}

export interface VerificationResult {
  isValid: boolean;
  commitmentMatches: boolean;
  combinedSeedMatches: boolean;
  indexMatches: boolean;
  rosterHashMatches: boolean;
  computedCommitment: string;
  computedCombinedSeed: string;
  computedIndex: number;
  computedRosterHash?: string;
  details: string[];
}

/**
 * Independent deterministic verifier that recomputes every stage of the
 * lucky draw cryptographic evidence:
 * 1. SHA-256(serverSeedRevealed) == serverSeedCommitment
 * 2. HMAC-SHA256(serverSeedRevealed, clientEntropy:snapshotHash:prizeId) == combinedSeed
 * 3. deriveWinningIndex(combinedSeed, totalCandidates) == selectedIndex
 * 4. (Optional) computeCanonicalSnapshotHash(roster) == snapshotHash
 */
export function verifyDrawEvidence(input: VerificationInput): VerificationResult {
  const details: string[] = [];

  // 1. Verify Commitment: SHA-256(revealed_seed)
  const computedCommitment = crypto
    .createHash("sha256")
    .update(input.serverSeedRevealed, "utf8")
    .digest("hex")
    .toLowerCase();

  const commitmentMatches =
    computedCommitment === input.serverSeedCommitment.toLowerCase();

  if (commitmentMatches) {
    details.push("PASS: Revealed server seed matches pre-committed hash.");
  } else {
    details.push(
      `FAIL: Revealed server seed hash (${computedCommitment}) does not match commitment (${input.serverSeedCommitment}).`
    );
  }

  // 2. Verify Combined Seed
  const computedCombinedSeed = computeCombinedSeed(
    input.serverSeedRevealed,
    input.clientEntropy || "",
    input.snapshotHash,
    input.prizeId
  );

  const combinedSeedMatches =
    computedCombinedSeed === input.combinedSeed.toLowerCase();

  if (combinedSeedMatches) {
    details.push("PASS: Combined entropy HMAC matches recorded evidence.");
  } else {
    details.push(
      `FAIL: Computed combined seed (${computedCombinedSeed}) does not match evidence (${input.combinedSeed}).`
    );
  }

  // 3. Verify Selection Index
  const computedIndex = deriveWinningIndex(
    input.combinedSeed,
    input.totalCandidates
  );

  const indexMatches = computedIndex === input.selectedIndex;

  if (indexMatches) {
    details.push(
      `PASS: Deterministic derivation reproduced selected index ${computedIndex}.`
    );
  } else {
    details.push(
      `FAIL: Derived index (${computedIndex}) does not match recorded index (${input.selectedIndex}).`
    );
  }

  // 4. (Optional) Verify Roster Hash
  let rosterHashMatches = true;
  let computedRosterHash: string | undefined;

  if (input.rosterTicketNumbers && input.rosterTicketNumbers.length > 0) {
    computedRosterHash = computeCanonicalSnapshotHash(input.rosterTicketNumbers);
    rosterHashMatches =
      computedRosterHash === input.snapshotHash.toLowerCase();

    if (rosterHashMatches) {
      details.push("PASS: Candidate roster reproduces exact snapshot hash.");
    } else {
      details.push(
        `FAIL: Computed roster hash (${computedRosterHash}) does not match snapshot hash (${input.snapshotHash}).`
      );
    }
  }

  const isValid =
    commitmentMatches && combinedSeedMatches && indexMatches && rosterHashMatches;

  return {
    isValid,
    commitmentMatches,
    combinedSeedMatches,
    indexMatches,
    rosterHashMatches,
    computedCommitment,
    computedCombinedSeed,
    computedIndex,
    computedRosterHash,
    details,
  };
}

