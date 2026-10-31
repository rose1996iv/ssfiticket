import test from "node:test";
import assert from "node:assert/strict";

/**
 * Pure simulation of seller deactivation rules and state transitions
 */
type SellerState = {
  id: string;
  seller_code: string;
  is_active: boolean;
  profile_active: boolean;
  auth_banned: boolean;
  order_count: number;
  ticket_count: number;
  roles: string[];
};

function deactivateSeller(
  seller: SellerState,
  executorRole: string
): { success: boolean; error?: string; seller?: SellerState } {
  const ALLOWED_STAFF_ROLES = ["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"];
  if (!ALLOWED_STAFF_ROLES.includes(executorRole)) {
    return { success: false, error: "Unauthorized: Staff permission required" };
  }

  if (!seller.is_active) {
    return { success: false, error: "Seller is already deactivated" };
  }

  return {
    success: true,
    seller: {
      ...seller,
      is_active: false,
      profile_active: false,
      auth_banned: true,
    },
  };
}

function reactivateSeller(
  seller: SellerState,
  executorRole: string
): { success: boolean; error?: string; seller?: SellerState } {
  const ALLOWED_STAFF_ROLES = ["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"];
  if (!ALLOWED_STAFF_ROLES.includes(executorRole)) {
    return { success: false, error: "Unauthorized: Staff permission required" };
  }

  if (seller.is_active) {
    return { success: false, error: "Seller is already active" };
  }

  return {
    success: true,
    seller: {
      ...seller,
      is_active: true,
      profile_active: true,
      auth_banned: false,
    },
  };
}

function deleteSeller(
  seller: SellerState,
  executorRole: string,
  confirmationCode: string
): { success: boolean; error?: string; deleted?: boolean } {
  // Only SUPER_ADMIN is allowed to permanently delete
  if (executorRole !== "SUPER_ADMIN") {
    return { success: false, error: "Only Super Administrators can permanently delete sellers." };
  }

  // Exact confirmation code required
  if (confirmationCode.trim().toUpperCase() !== seller.seller_code.toUpperCase()) {
    return {
      success: false,
      error: `Confirmation code mismatch. Please type exactly ${seller.seller_code} to confirm deletion.`,
    };
  }

  // Relational safety check: block if business records exist
  if (seller.order_count > 0 || seller.ticket_count > 0) {
    return {
      success: false,
      error: `Cannot delete seller: This seller is permanently linked to ${seller.order_count} order(s) and ${seller.ticket_count} ticket(s). Deactivate the account instead to maintain financial integrity.`,
    };
  }

  return {
    success: true,
    deleted: true,
  };
}

function checkSellerAccess(seller: SellerState): { allowed: boolean; redirectUrl?: string } {
  if (!seller.is_active) {
    return { allowed: false, redirectUrl: "/unauthorized?reason=seller_inactive" };
  }
  return { allowed: true };
}

function resolveSellerReferral(
  seller: SellerState | null
): { valid: boolean; error?: string } {
  if (!seller) {
    return { valid: false, error: "Seller referral code not found" };
  }
  if (!seller.is_active) {
    return {
      valid: false,
      error: "This seller's referral link is currently inactive. Ticket orders cannot be attributed to an inactive seller.",
    };
  }
  return { valid: true };
}

test("Seller deactivation successfully updates seller, profile, and auth ban status", () => {
  const seller: SellerState = {
    id: "seller-1",
    seller_code: "SELLER-001",
    is_active: true,
    profile_active: true,
    auth_banned: false,
    order_count: 5,
    ticket_count: 10,
    roles: ["SELLER"],
  };

  const result = deactivateSeller(seller, "ADMIN");
  assert.equal(result.success, true);
  assert.equal(result.seller?.is_active, false);
  assert.equal(result.seller?.profile_active, false);
  assert.equal(result.seller?.auth_banned, true);

  // Subsequent deactivation attempt fails gracefully
  const secondAttempt = deactivateSeller(result.seller!, "ADMIN");
  assert.equal(secondAttempt.success, false);
  assert.equal(secondAttempt.error, "Seller is already deactivated");
});

test("Seller deactivation is guarded against non-staff roles", () => {
  const seller: SellerState = {
    id: "seller-2",
    seller_code: "SELLER-002",
    is_active: true,
    profile_active: true,
    auth_banned: false,
    order_count: 0,
    ticket_count: 0,
    roles: ["SELLER"],
  };

  const nonStaffResult = deactivateSeller(seller, "SELLER");
  assert.equal(nonStaffResult.success, false);
  assert.match(nonStaffResult.error!, /Unauthorized/);
});

test("Seller reactivation restores seller, profile, and unbans auth account", () => {
  const deactivatedSeller: SellerState = {
    id: "seller-3",
    seller_code: "SELLER-003",
    is_active: false,
    profile_active: false,
    auth_banned: true,
    order_count: 1,
    ticket_count: 2,
    roles: ["SELLER"],
  };

  const result = reactivateSeller(deactivatedSeller, "FUNDRAISING_MANAGER");
  assert.equal(result.success, true);
  assert.equal(result.seller?.is_active, true);
  assert.equal(result.seller?.profile_active, true);
  assert.equal(result.seller?.auth_banned, false);
});

test("Inactive seller is strictly blocked from seller workspace routes", () => {
  const activeSeller: SellerState = {
    id: "seller-4",
    seller_code: "SELLER-004",
    is_active: true,
    profile_active: true,
    auth_banned: false,
    order_count: 0,
    ticket_count: 0,
    roles: ["SELLER"],
  };

  const inactiveSeller: SellerState = {
    ...activeSeller,
    is_active: false,
  };

  assert.deepEqual(checkSellerAccess(activeSeller), { allowed: true });
  assert.deepEqual(checkSellerAccess(inactiveSeller), {
    allowed: false,
    redirectUrl: "/unauthorized?reason=seller_inactive",
  });
});

test("Public order flow rejects inactive seller referrals", () => {
  const inactiveSeller: SellerState = {
    id: "seller-5",
    seller_code: "SELLER-005",
    is_active: false,
    profile_active: false,
    auth_banned: true,
    order_count: 0,
    ticket_count: 0,
    roles: ["SELLER"],
  };

  const referralCheck = resolveSellerReferral(inactiveSeller);
  assert.equal(referralCheck.valid, false);
  assert.match(referralCheck.error!, /inactive/);

  const nonExistentCheck = resolveSellerReferral(null);
  assert.equal(nonExistentCheck.valid, false);
  assert.match(nonExistentCheck.error!, /not found/);
});

test("Permanent deletion is strictly blocked when seller has orders or tickets", () => {
  const sellerWithOrders: SellerState = {
    id: "seller-6",
    seller_code: "SELLER-006",
    is_active: false,
    profile_active: false,
    auth_banned: true,
    order_count: 3,
    ticket_count: 6,
    roles: ["SELLER"],
  };

  // Attempt delete as SUPER_ADMIN with correct code
  const result = deleteSeller(sellerWithOrders, "SUPER_ADMIN", "SELLER-006");
  assert.equal(result.success, false);
  assert.match(result.error!, /Cannot delete seller/);
  assert.match(result.error!, /financial integrity/);
});

test("Permanent deletion requires SUPER_ADMIN role and exact confirmation code", () => {
  const emptySeller: SellerState = {
    id: "seller-7",
    seller_code: "SELLER-007",
    is_active: false,
    profile_active: false,
    auth_banned: true,
    order_count: 0,
    ticket_count: 0,
    roles: ["SELLER"],
  };

  // Non-super-admin is rejected
  const nonSuperAdminResult = deleteSeller(emptySeller, "ADMIN", "SELLER-007");
  assert.equal(nonSuperAdminResult.success, false);
  assert.match(nonSuperAdminResult.error!, /Only Super Administrators/);

  // Mismatched confirmation code is rejected
  const codeMismatchResult = deleteSeller(emptySeller, "SUPER_ADMIN", "WRONG-CODE");
  assert.equal(codeMismatchResult.success, false);
  assert.match(codeMismatchResult.error!, /Confirmation code mismatch/);

  // Valid SUPER_ADMIN with exact code succeeds on zero-activity seller
  const successResult = deleteSeller(emptySeller, "SUPER_ADMIN", "SELLER-007");
  assert.equal(successResult.success, true);
  assert.equal(successResult.deleted, true);
});

