import crypto from "node:crypto";

/**
 * Generates a 32-byte cryptographically secure random server seed
 * and its public SHA-256 commitment hash.
 */
export function generateServerSeed(): { serverSeed: string; seedCommitment: string } {
  const serverSeed = crypto.randomBytes(32).toString("hex");
  const seedCommitment = crypto
    .createHash("sha256")
    .update(serverSeed, "utf8")
    .digest("hex")
    .toLowerCase();

  return { serverSeed, seedCommitment };
}

/**
 * Computes the combined entropy seed utilizing HMAC-SHA256.
 * Binds the pre-committed server seed to operator client entropy,
 * the immutable candidate snapshot hash, and the target prize ID.
 */
export function computeCombinedSeed(
  serverSeed: string,
  clientEntropy: string,
  snapshotHash: string,
  prizeId: string
): string {
  const message = `${clientEntropy.trim()}:${snapshotHash.trim().toLowerCase()}:${prizeId.trim().toLowerCase()}`;
  return crypto
    .createHmac("sha256", serverSeed.trim())
    .update(message, "utf8")
    .digest("hex")
    .toLowerCase();
}

/**
 * Derives a deterministic winning index in the range [0, totalCandidates)
 * from the combined seed.
 *
 * Implements rejection sampling across 32-bit unsigned integer chunks
 * of SHA-256 derivations to mathematically eliminate modulo bias.
 */
export function deriveWinningIndex(combinedSeed: string, totalCandidates: number): number {
  if (totalCandidates <= 0) {
    throw new Error("Total candidates must be greater than zero.");
  }
  if (totalCandidates === 1) {
    return 0;
  }

  // 2^32 = 4294967296
  const MAX_UINT32 = 0x100000000;
  const limit = MAX_UINT32 - (MAX_UINT32 % totalCandidates);

  let counter = 0;
  while (true) {
    const hash = crypto
      .createHash("sha256")
      .update(`${combinedSeed}:index:${counter}`, "utf8")
      .digest();

    const val = hash.readUInt32BE(0);
    if (val < limit) {
      return val % totalCandidates;
    }
    counter++;
  }
}

/**
 * Validates whether a revealed seed matches the expected commitment.
 */
export function verifySeedCommitment(serverSeed: string, commitment: string): boolean {
  const hash = crypto
    .createHash("sha256")
    .update(serverSeed.trim(), "utf8")
    .digest("hex")
    .toLowerCase();

  return hash === commitment.trim().toLowerCase();
}

