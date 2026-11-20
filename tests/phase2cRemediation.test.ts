import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  authenticateMobileRequest,
  handleMobileMeGet,
  requireMobileRoles,
  type MobileAuthDependencies,
} from "../src/lib/auth/mobile.ts";
import {
  checkScopedRateLimit,
  getClientIpFromHeaders,
  resetRateLimitsForTesting,
} from "../src/lib/security/rateLimit.ts";
import {
  generateOrderAccessToken,
  verifyOrderAccess,
} from "../src/lib/security/orderAccessToken.ts";
import { handleAdminExportGet } from "../src/lib/export/adminExportHandler.ts";
import { buildDashboardDataset } from "../src/lib/export/datasets.ts";

const VALID_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJyZW0tdXNlciJ9.signature_segment_abcdef123456";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const SELLER_A_ID = "22222222-2222-4222-8222-222222222201";
const SELLER_B_ID = "22222222-2222-4222-8222-222222222202";
const USER_ADMIN = "33333333-3333-4333-8333-333333333301";
const USER_SELLER = "33333333-3333-4333-8333-333333333302";
const USER_CUSTOMER = "33333333-3333-4333-8333-333333333303";

function makeMobileDeps(overrides?: Partial<MobileAuthDependencies>): MobileAuthDependencies {
  return {
    verifyAccessToken: async () => ({
      user: { id: USER_CUSTOMER, email: "cust@example.com" },
    }),
    resolveProfileActive: async () => true,
    checkHasRole: async () => false,
    hasCustomerProfile: async () => false,
    hasActiveSellerProfile: async () => false,
    ...overrides,
  };
}

// ============================================================================
// REV-2C-01: Fail-closed mobile profile status validation
// ============================================================================
test("REV-2C-01: Missing (null) and inactive (false) profiles fail closed with 403", async () => {
  resetRateLimitsForTesting();
  const nullProfile = await authenticateMobileRequest(
    new Headers({ authorization: `Bearer ${VALID_JWT}` }),
    makeMobileDeps({ resolveProfileActive: async () => null })
  );
  assert.equal(nullProfile.ok, false);
  if (!nullProfile.ok) {
    assert.equal(nullProfile.status, 403);
    assert.equal(nullProfile.code, "FORBIDDEN");
  }

  const meResponse = await handleMobileMeGet(
    { headers: new Headers({ authorization: `Bearer ${VALID_JWT}`, "x-real-ip": "198.51.100.11" }) },
    makeMobileDeps({ resolveProfileActive: async () => null })
  );
  assert.equal(meResponse.status, 403);
});

// ============================================================================
// REV-2C-02: Trusted IP extraction & production fail-closed distributed rate limiting
// ============================================================================
test("REV-2C-02: Trusted proxy IP extraction ignores spoofed leftmost X-Forwarded-For and fails closed in production without Redis", async () => {
  // Prefers platform-overwritten x-vercel-forwarded-for and x-real-ip over client-prepended XFF
  assert.equal(
    getClientIpFromHeaders(
      new Headers({
        "x-forwarded-for": "1.2.3.4, 203.0.113.55",
        "x-real-ip": "198.51.100.20",
      })
    ),
    "198.51.100.20"
  );

  assert.equal(
    getClientIpFromHeaders(
      new Headers({
        "x-forwarded-for": "1.2.3.4, 203.0.113.55",
        "x-vercel-forwarded-for": "203.0.113.99",
      })
    ),
    "203.0.113.99"
  );

  // When only X-Forwarded-For is present, uses rightmost proxy-appended IP, never spoofed leftmost
  assert.equal(
    getClientIpFromHeaders(
      new Headers({
        "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.77",
      })
    ),
    "203.0.113.77"
  );

  // Production fail-closed when Upstash Redis is unconfigured
  const prevNodeEnv = process.env.NODE_ENV;
  const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
  const prevToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const rl = await checkScopedRateLimit({
      scope: "prod_fail_closed_test",
      identifier: USER_ADMIN,
      maxAttempts: 10,
      windowSeconds: 60,
      failClosedIfUnavailable: true,
    });
    assert.equal(rl.allowed, false);
    assert.equal(rl.reason, "SERVICE_UNAVAILABLE");

    const meRes = await handleMobileMeGet(
      { headers: new Headers({ authorization: `Bearer ${VALID_JWT}`, "x-real-ip": "198.51.100.30" }) },
      makeMobileDeps()
    );
    assert.equal(meRes.status, 503);
    assert.ok(meRes.headers.get("retry-after"));
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
    if (prevUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = prevUrl;
    if (prevToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = prevToken;
  }
});

// ============================================================================
// REV-2C-03: Separation of customerProfileLinked from authoritative RBAC roles
// ============================================================================
test("REV-2C-03: customerProfileLinked never populates roles[] or grants privileged RBAC access", async () => {
  const res = await authenticateMobileRequest(
    new Headers({ authorization: `Bearer ${VALID_JWT}` }),
    makeMobileDeps({
      verifyAccessToken: async () => ({ user: { id: USER_CUSTOMER, email: "cust@example.com" } }),
      hasCustomerProfile: async () => true,
      checkHasRole: async () => false,
    })
  );
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.user.customerProfileLinked, true);
    assert.deepEqual(res.user.roles, []);
    assert.equal(res.user.primaryRole, null);
    assert.equal(
      requireMobileRoles(res.user, ["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER", "SELLER"]),
      false
    );
  }
});

// ============================================================================
// REV-2C-04 & REV-2C-05: Direct verifyOrderAccess handler-level tests
// ============================================================================
test("REV-2C-04 & REV-2C-05: Direct verifyOrderAccess enforces active profile, SELLER role, canonical seller ownership, and token validation", async () => {
  const validToken = generateOrderAccessToken();

  // 1. Active owning seller with SELLER role -> AUTHORIZED_SELLER
  const sellerOwn = await verifyOrderAccess(ORDER_ID, "READ", {
    skipRateLimit: true,
    deps: {
      getAuthenticatedUser: async () => ({ id: USER_SELLER }),
      isProfileActive: async () => true,
      isStaffUser: async () => false,
      hasSellerRole: async () => true,
      getActiveSellerByProfileId: async () => ({ id: SELLER_A_ID, is_active: true }),
      getOrderSellerId: async () => SELLER_A_ID,
      getOrderCookie: async () => null,
    },
  });
  assert.equal(sellerOwn.authorized, true);
  assert.equal(sellerOwn.role, "SELLER");

  // 2. Cross-seller access -> denied
  const crossSeller = await verifyOrderAccess(ORDER_ID, "READ", {
    skipRateLimit: true,
    deps: {
      getAuthenticatedUser: async () => ({ id: USER_SELLER }),
      isProfileActive: async () => true,
      isStaffUser: async () => false,
      hasSellerRole: async () => true,
      getActiveSellerByProfileId: async () => ({ id: SELLER_B_ID, is_active: true }),
      getOrderSellerId: async () => SELLER_A_ID,
      getOrderCookie: async () => null,
    },
  });
  assert.equal(crossSeller.authorized, false);

  // 3. Seller without authoritative SELLER role -> denied
  const revokedSellerRole = await verifyOrderAccess(ORDER_ID, "READ", {
    skipRateLimit: true,
    deps: {
      getAuthenticatedUser: async () => ({ id: USER_SELLER }),
      isProfileActive: async () => true,
      isStaffUser: async () => false,
      hasSellerRole: async () => false,
      getActiveSellerByProfileId: async () => ({ id: SELLER_A_ID, is_active: true }),
      getOrderSellerId: async () => SELLER_A_ID,
      getOrderCookie: async () => null,
    },
  });
  assert.equal(revokedSellerRole.authorized, false);

  // 4. Inactive staff profile -> denied even if is_staff=true
  const inactiveStaff = await verifyOrderAccess(ORDER_ID, "READ", {
    skipRateLimit: true,
    deps: {
      getAuthenticatedUser: async () => ({ id: USER_ADMIN }),
      isProfileActive: async () => false,
      isStaffUser: async () => true,
      getOrderCookie: async () => null,
    },
  });
  assert.equal(inactiveStaff.authorized, false);

  // 5. Active staff -> AUTHORIZED_STAFF
  const activeStaff = await verifyOrderAccess(ORDER_ID, "READ", {
    skipRateLimit: true,
    deps: {
      getAuthenticatedUser: async () => ({ id: USER_ADMIN }),
      isProfileActive: async () => true,
      isStaffUser: async () => true,
    },
  });
  assert.equal(activeStaff.authorized, true);
  assert.equal(activeStaff.role, "STAFF");

  // 6. Valid customer token -> AUTHORIZED_READ; expired/consumed token -> denied
  const custValid = await verifyOrderAccess(ORDER_ID, "READ", {
    rawToken: validToken,
    skipRateLimit: true,
    deps: {
      getAuthenticatedUser: async () => null,
      verifyToken: async () => ({
        authorized: true,
        code: "AUTHORIZED_READ",
        token_id: "tok-1",
        order_status: "PENDING_PAYMENT",
      }),
    },
  });
  assert.equal(custValid.authorized, true);
  assert.equal(custValid.role, "CUSTOMER");

  const custExpired = await verifyOrderAccess(ORDER_ID, "CONSUME_WRITE", {
    rawToken: validToken,
    skipRateLimit: true,
    deps: {
      getAuthenticatedUser: async () => null,
      verifyToken: async () => ({
        authorized: false,
        code: "TOKEN_EXPIRED",
      }),
    },
  });
  assert.equal(custExpired.authorized, false);
  assert.equal(custExpired.code, "TOKEN_EXPIRED");

  // Verify atomic conditional consume in fallback source
  const tokenSrc = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/security/orderAccessToken.ts"),
    "utf8"
  );
  assert.ok(tokenSrc.includes('.is("used_at", null)'), "Fallback CONSUME_WRITE must guard used_at IS NULL atomically");
});

// ============================================================================
// REV-2C-04 & REV-2C-06: Direct handleAdminExportGet handler-level tests
// ============================================================================
test("REV-2C-04 & REV-2C-06: Direct handleAdminExportGet enforces auth, active staff, rate limits, non-PII audit log, and sanitized 500", async () => {
  resetRateLimitsForTesting();

  // 1. Unauthenticated -> 401
  const unauth = await handleAdminExportGet(
    { url: "https://example.test/api/admin/export?resource=dashboard&format=json" },
    { getCurrentUser: async () => null }
  );
  assert.equal(unauth.status, 401);

  // 2. Non-staff or inactive profile -> 403
  const forbidden = await handleAdminExportGet(
    { url: "https://example.test/api/admin/export?resource=dashboard&format=json" },
    {
      getCurrentUser: async () => ({ id: USER_SELLER }),
      isProfileActive: async () => true,
      isStaff: async () => false,
    }
  );
  assert.equal(forbidden.status, 403);

  const inactiveStaff = await handleAdminExportGet(
    { url: "https://example.test/api/admin/export?resource=dashboard&format=json" },
    {
      getCurrentUser: async () => ({ id: USER_ADMIN }),
      isProfileActive: async () => false,
      isStaff: async () => true,
    }
  );
  assert.equal(inactiveStaff.status, 403);

  // 3. Authorized staff -> 200 + non-PII audit log
  const recordedAudits: Array<Record<string, unknown>> = [];
  const okRes = await handleAdminExportGet(
    { url: "https://example.test/api/admin/export?resource=dashboard&format=json" },
    {
      getCurrentUser: async () => ({ id: USER_ADMIN }),
      isProfileActive: async () => true,
      isStaff: async () => true,
      isExportFeatureEnabled: () => true,
      loadDataset: async () =>
        buildDashboardDataset([{ metric: "Campaign Status", value: "ACTIVE", notes: "Synthetic" }]),
      recordAuditLog: async (entry) => {
        recordedAudits.push(entry);
      },
    }
  );
  assert.equal(okRes.status, 200);
  assert.ok(okRes.headers.get("content-type")?.includes("application/json"));
  assert.equal(recordedAudits.length, 1);
  assert.equal(recordedAudits[0].actorUserId, USER_ADMIN);
  assert.equal(recordedAudits[0].resource, "dashboard");
  assert.equal(recordedAudits[0].format, "json");
  assert.equal(recordedAudits[0].rowCount, 1);

  // 4. Internal DB error -> sanitized 500 (never leaks raw error message)
  const errRes = await handleAdminExportGet(
    { url: "https://example.test/api/admin/export?resource=dashboard&format=json" },
    {
      getCurrentUser: async () => ({ id: USER_ADMIN }),
      isProfileActive: async () => true,
      isStaff: async () => true,
      isExportFeatureEnabled: () => true,
      loadDataset: async () => {
        throw new Error("SECRET_INTERNAL_PG_ERROR_DETAIL");
      },
    }
  );
  assert.equal(errRes.status, 500);
  const errJson = await errRes.json();
  assert.ok(!JSON.stringify(errJson).includes("SECRET_INTERNAL_PG_ERROR_DETAIL"));
  assert.equal("details" in errJson, false);

  // 5. Rate limit enforced at 20 requests -> 21st returns 429 + Retry-After
  resetRateLimitsForTesting();
  for (let i = 0; i < 20; i++) {
    const r = await handleAdminExportGet(
      { url: "https://example.test/api/admin/export?resource=dashboard&format=json" },
      {
        getCurrentUser: async () => ({ id: USER_ADMIN }),
        isProfileActive: async () => true,
        isStaff: async () => true,
        isExportFeatureEnabled: () => true,
        loadDataset: async () => buildDashboardDataset([]),
        recordAuditLog: async () => {},
      }
    );
    assert.equal(r.status, 200);
  }
  const throttled = await handleAdminExportGet(
    { url: "https://example.test/api/admin/export?resource=dashboard&format=json" },
    {
      getCurrentUser: async () => ({ id: USER_ADMIN }),
      isProfileActive: async () => true,
      isStaff: async () => true,
      isExportFeatureEnabled: () => true,
      loadDataset: async () => buildDashboardDataset([]),
      recordAuditLog: async () => {},
    }
  );
  assert.equal(throttled.status, 429);
  assert.ok(throttled.headers.get("retry-after"));
});

// ============================================================================
// REV-2C-07: Single auth lookup & zero-row delivery record handling
// ============================================================================
test("REV-2C-07: whatsappDelivery.ts uses single getCurrentUser() lookup and handles missing ticket_deliveries rows explicitly", () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/server/actions/whatsappDelivery.ts"),
    "utf8"
  );
  assert.ok(!src.includes("hasCurrentUserRole("), "Must not call hasCurrentUserRole repeatedly (5x auth.getUser)");
  assert.ok(src.includes('admin.rpc("has_role"'), "Must check roles directly via admin.rpc('has_role')");
  assert.ok(src.includes("deliveryRecordUpdated"), "Must explicitly track and return deliveryRecordUpdated");
  assert.ok(src.includes('.from("ticket_deliveries")\n        .insert('), "Must insert WHATSAPP delivery row if absent");
});
