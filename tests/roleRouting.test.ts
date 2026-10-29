import test from "node:test";
import assert from "node:assert/strict";

type AppRole = "SUPER_ADMIN" | "ADMIN" | "FUNDRAISING_MANAGER" | "SELLER";

/**
 * Pure simulation of login routing decision logic in src/server/actions/auth.ts
 */
function determineLoginRedirect(
  roles: readonly AppRole[],
  isSellerActive: boolean = true
): { destination?: string; error?: string } {
  const isSuperAdmin = roles.includes("SUPER_ADMIN");
  const isAdmin = roles.includes("ADMIN");
  const isManager = roles.includes("FUNDRAISING_MANAGER");

  // Staff priority: redirect to /admin
  if (isSuperAdmin || isAdmin || isManager) {
    return { destination: "/admin" };
  }

  // Seller workspace routing
  if (roles.includes("SELLER")) {
    if (!isSellerActive) {
      return {
        error: "Your seller account has been deactivated. Please contact an SSFI administrator.",
      };
    }
    return { destination: "/seller" };
  }

  // No active SSFI role assigned
  return { destination: "/unauthorized" };
}

/**
 * Pure simulation of Admin route guard in src/app/admin/layout.tsx
 */
function evaluateAdminAccess(userRoles: readonly AppRole[]): {
  allowed: boolean;
  redirectUrl?: string;
} {
  const isStaff =
    userRoles.includes("SUPER_ADMIN") ||
    userRoles.includes("ADMIN") ||
    userRoles.includes("FUNDRAISING_MANAGER");

  if (isStaff) {
    return { allowed: true };
  }

  // If a seller attempts to access admin, provide contextual admin_only reason
  if (userRoles.includes("SELLER")) {
    return { allowed: false, redirectUrl: "/unauthorized?reason=admin_only" };
  }

  // Unassigned user
  return { allowed: false, redirectUrl: "/unauthorized" };
}

/**
 * Pure simulation of Seller route guard in src/app/seller/layout.tsx
 */
function evaluateSellerAccess(
  userRoles: readonly AppRole[],
  isSellerActive: boolean = true
): {
  allowed: boolean;
  redirectUrl?: string;
} {
  const isSeller = userRoles.includes("SELLER");

  if (isSeller) {
    if (!isSellerActive) {
      return { allowed: false, redirectUrl: "/unauthorized?reason=seller_inactive" };
    }
    return { allowed: true };
  }

  // If staff attempts to access seller workspace, provide contextual seller_only reason
  const isStaff =
    userRoles.includes("SUPER_ADMIN") ||
    userRoles.includes("ADMIN") ||
    userRoles.includes("FUNDRAISING_MANAGER");

  if (isStaff) {
    return { allowed: false, redirectUrl: "/unauthorized?reason=seller_only" };
  }

  // Unassigned user
  return { allowed: false, redirectUrl: "/unauthorized" };
}

/**
 * Pure simulation of query error handling in src/lib/auth/server.ts
 */
async function simulateRoleQuery(
  rpcMock: () => Promise<{ data: boolean | null; error: { code?: string; message: string } | null }>
): Promise<boolean> {
  const { data, error } = await rpcMock();
  if (error) {
    throw new Error(`Database query error while verifying role: ${error.message}`);
  }
  return data === true;
}

test("Login routing directs staff roles (SUPER_ADMIN, ADMIN, FUNDRAISING_MANAGER) to /admin", () => {
  assert.deepEqual(determineLoginRedirect(["SUPER_ADMIN"]), { destination: "/admin" });
  assert.deepEqual(determineLoginRedirect(["ADMIN"]), { destination: "/admin" });
  assert.deepEqual(determineLoginRedirect(["FUNDRAISING_MANAGER"]), { destination: "/admin" });
});

test("Login routing directs active sellers to /seller and blocks inactive sellers", () => {
  // Active seller reaches /seller
  assert.deepEqual(determineLoginRedirect(["SELLER"], true), { destination: "/seller" });

  // Inactive seller receives error message and signin rejection
  const inactiveResult = determineLoginRedirect(["SELLER"], false);
  assert.equal(inactiveResult.destination, undefined);
  assert.match(inactiveResult.error!, /deactivated/);
});

test("Login routing prioritizes staff dashboard if user has multiple roles", () => {
  const multiRole = determineLoginRedirect(["ADMIN", "SELLER"], true);
  assert.deepEqual(multiRole, { destination: "/admin" });
});

test("Login routing sends users without roles to /unauthorized", () => {
  assert.deepEqual(determineLoginRedirect([]), { destination: "/unauthorized" });
});

test("Opposite-role access denial: Seller attempting to access /admin is denied with admin_only reason", () => {
  const result = evaluateAdminAccess(["SELLER"]);
  assert.equal(result.allowed, false);
  assert.equal(result.redirectUrl, "/unauthorized?reason=admin_only");
});

test("Opposite-role access denial: Admin attempting to access /seller is denied with seller_only reason", () => {
  const superAdminAccess = evaluateSellerAccess(["SUPER_ADMIN"]);
  assert.equal(superAdminAccess.allowed, false);
  assert.equal(superAdminAccess.redirectUrl, "/unauthorized?reason=seller_only");

  const adminAccess = evaluateSellerAccess(["ADMIN"]);
  assert.equal(adminAccess.allowed, false);
  assert.equal(adminAccess.redirectUrl, "/unauthorized?reason=seller_only");

  const managerAccess = evaluateSellerAccess(["FUNDRAISING_MANAGER"]);
  assert.equal(managerAccess.allowed, false);
  assert.equal(managerAccess.redirectUrl, "/unauthorized?reason=seller_only");
});

test("Seller workspace guard blocks inactive sellers with seller_inactive reason", () => {
  const result = evaluateSellerAccess(["SELLER"], false);
  assert.equal(result.allowed, false);
  assert.equal(result.redirectUrl, "/unauthorized?reason=seller_inactive");
});

test("Missing role access denial: Unassigned users receive standard /unauthorized without reasons", () => {
  assert.deepEqual(evaluateAdminAccess([]), { allowed: false, redirectUrl: "/unauthorized" });
  assert.deepEqual(evaluateSellerAccess([]), { allowed: false, redirectUrl: "/unauthorized" });
});

test("Database query error is never silently treated as no-role-assigned (false)", async () => {
  // Successful query returns true
  const successTrue = await simulateRoleQuery(async () => ({ data: true, error: null }));
  assert.equal(successTrue, true);

  // Legitimate false returns false
  const successFalse = await simulateRoleQuery(async () => ({ data: false, error: null }));
  assert.equal(successFalse, false);

  // Database failure throws instead of silently returning false
  await assert.rejects(
    async () => {
      await simulateRoleQuery(async () => ({
        data: null,
        error: { code: "PGRST000", message: "Connection timeout to PostgreSQL" },
      }));
    },
    /Database query error while verifying role: Connection timeout/
  );
});

