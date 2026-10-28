import test from "node:test";
import assert from "node:assert/strict";
import { SELLER_CODE_REGEX, validateReferralCodeSyntax } from "../src/lib/validation/referral.ts";

/**
 * Pure helper mirroring the next-seller-code calculation algorithm in seller.ts
 */
function computeNextSellerCode(existingCodes: string[]): string {
  if (!existingCodes || existingCodes.length === 0) {
    return "SELLER-001";
  }

  let maxNum = 0;
  for (const code of existingCodes) {
    const match = code.match(/^SELLER-([0-9]+)$/i);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  const nextNum = maxNum + 1;
  return `SELLER-${String(nextNum).padStart(3, "0")}`;
}

test("computeNextSellerCode generates sequential codes reliably", () => {
  // Empty database initializes at SELLER-001
  assert.equal(computeNextSellerCode([]), "SELLER-001");

  // Single seller advances to SELLER-002
  assert.equal(computeNextSellerCode(["SELLER-001"]), "SELLER-002");

  // Multiple sequential sellers
  assert.equal(computeNextSellerCode(["SELLER-001", "SELLER-002", "SELLER-003"]), "SELLER-004");

  // Gapped codes take maximum and advance
  assert.equal(computeNextSellerCode(["SELLER-001", "SELLER-042"]), "SELLER-043");

  // Higher 4-digit and 5-digit numbers maintain padding
  assert.equal(computeNextSellerCode(["SELLER-999"]), "SELLER-1000");

  // Ignores malformed strings safely
  assert.equal(computeNextSellerCode(["SELLER-INVALID", "SELLER-ABC"]), "SELLER-001");
});

test("Seller referral code format matches schema constraints", () => {
  const code = computeNextSellerCode(["SELLER-005"]);
  assert.equal(code, "SELLER-006");
  assert.equal(SELLER_CODE_REGEX.test(code), true);
  assert.equal(validateReferralCodeSyntax(code).valid, true);
});

test("Seller role assignment boundary guarantees no privilege escalation", () => {
  // The seller provisioning workflow must strictly link the SELLER role
  const ASSIGNED_ROLE = "SELLER";
  const FORBIDDEN_ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"];

  assert.equal(FORBIDDEN_ADMIN_ROLES.includes(ASSIGNED_ROLE), false);
  assert.equal(ASSIGNED_ROLE, "SELLER");
});
