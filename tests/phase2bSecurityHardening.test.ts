import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateWhatsAppDeliveryAuthorization,
  type WhatsAppAuthContext,
  type WhatsAppOrderTarget,
} from "../src/lib/delivery/whatsappAuth.ts";
import {
  generateOrderAccessToken,
  hashOrderAccessToken,
  isValidAccessTokenFormat,
  safeCompareHexDigests,
} from "../src/lib/security/orderAccessToken.ts";
import {
  checkScopedRateLimit,
  resetRateLimitsForTesting,
} from "../src/lib/security/rateLimit.ts";
import {
  authenticateMobileRequest,
  extractBearerToken,
  handleMobileMeGet,
  requireMobileRoles,
  type MobileAuthDependencies,
} from "../src/lib/auth/mobile.ts";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORDER_ID = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_CAMPAIGN_ID = "44444444-4444-4444-8444-444444444444";
const SELLER_A_ID = "55555555-5555-4555-8555-555555555551";
const SELLER_B_ID = "55555555-5555-4555-8555-555555555552";
const USER_SUPER = "66666666-6666-4666-8666-666666666601";
const USER_ADMIN = "66666666-6666-4666-8666-666666666602";
const USER_SELLER_A = "66666666-6666-4666-8666-666666666603";
const USER_SELLER_B = "66666666-6666-4666-8666-666666666604";
const USER_CUSTOMER = "66666666-6666-4666-8666-666666666605";
const USER_NOROLE = "66666666-6666-4666-8666-666666666606";

const VALID_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJyb2xlIjoiU1VQRVJfQURNSU4ifQ.signature_segment_1234567890";

function makeOrder(overrides?: Partial<WhatsAppOrderTarget>): WhatsAppOrderTarget {
  return {
    id: ORDER_ID,
    campaign_id: CAMPAIGN_ID,
    seller_id: SELLER_A_ID,
    status: "TICKETS_ISSUED",
    tickets: [
      {
        id: "77777777-7777-4777-8777-777777777701",
        order_id: ORDER_ID,
        campaign_id: CAMPAIGN_ID,
        ticket_number: "SSFI-000101",
        status: "ISSUED",
      },
    ],
    ...overrides,
  };
}

function makeMobileDeps(overrides?: Partial<MobileAuthDependencies>): MobileAuthDependencies {
  return {
    verifyAccessToken: async () => ({
      user: { id: USER_ADMIN, email: "admin-test@example.com" },
    }),
    resolveProfileActive: async () => true,
    checkHasRole: async () => false,
    hasCustomerProfile: async () => false,
    hasActiveSellerProfile: async () => false,
    ...overrides,
  };
}

// ============================================================================
// Phase 2B.1 — WhatsApp Delivery Authorization (CRITICAL)
// ============================================================================
test("Phase 2B.1: WhatsApp Delivery Authorization", async (t) => {
  await t.test("Denies unauthenticated user", () => {
    const res = evaluateWhatsAppDeliveryAuthorization(ORDER_ID, null, makeOrder());
    assert.equal(res.authorized, false);
    assert.equal(res.code, "UNAUTHENTICATED");
  });

  await t.test("Denies unauthorized CUSTOMER and no-role user", () => {
    const custAuth: WhatsAppAuthContext = {
      userId: USER_CUSTOMER,
      userEmail: "customer@example.com",
      profileActive: true,
      roles: ["CUSTOMER"],
      sellerRecord: null,
    };
    const res = evaluateWhatsAppDeliveryAuthorization(ORDER_ID, custAuth, makeOrder());
    assert.equal(res.authorized, false);
    assert.equal(res.code, "FORBIDDEN");

    const noRoleAuth: WhatsAppAuthContext = { ...custAuth, roles: [] };
    const res2 = evaluateWhatsAppDeliveryAuthorization(ORDER_ID, noRoleAuth, makeOrder());
    assert.equal(res2.authorized, false);
    assert.equal(res2.code, "FORBIDDEN");
  });

  await t.test("Denies inactive account even with ADMIN role", () => {
    const inactiveAdmin: WhatsAppAuthContext = {
      userId: USER_ADMIN,
      userEmail: "admin@example.com",
      profileActive: false,
      roles: ["ADMIN"],
      sellerRecord: null,
    };
    const res = evaluateWhatsAppDeliveryAuthorization(ORDER_ID, inactiveAdmin, makeOrder());
    assert.equal(res.authorized, false);
    assert.equal(res.code, "INACTIVE_ACCOUNT");
  });

  await t.test("Permits authorized ADMIN and SUPER_ADMIN", () => {
    const adminAuth: WhatsAppAuthContext = {
      userId: USER_ADMIN,
      userEmail: "admin@example.com",
      profileActive: true,
      roles: ["ADMIN"],
      sellerRecord: null,
    };
    const resAdmin = evaluateWhatsAppDeliveryAuthorization(ORDER_ID, adminAuth, makeOrder());
    assert.equal(resAdmin.authorized, true);
    if (resAdmin.authorized) {
      assert.equal(resAdmin.actorRole, "ADMIN");
      assert.equal(resAdmin.actorUserId, USER_ADMIN);
    }

    const superAuth: WhatsAppAuthContext = {
      userId: USER_SUPER,
      userEmail: "super@example.com",
      profileActive: true,
      roles: ["SUPER_ADMIN"],
      sellerRecord: null,
    };
    const resSuper = evaluateWhatsAppDeliveryAuthorization(ORDER_ID, superAuth, makeOrder());
    assert.equal(resSuper.authorized, true);
    if (resSuper.authorized) {
      assert.equal(resSuper.actorRole, "SUPER_ADMIN");
    }
  });

  await t.test("Permits active SELLER for own order and denies cross-seller IDOR", () => {
    const sellerA: WhatsAppAuthContext = {
      userId: USER_SELLER_A,
      userEmail: "seller-a@example.com",
      profileActive: true,
      roles: ["SELLER"],
      sellerRecord: { id: SELLER_A_ID, is_active: true },
    };
    const resOwn = evaluateWhatsAppDeliveryAuthorization(ORDER_ID, sellerA, makeOrder());
    assert.equal(resOwn.authorized, true);
    if (resOwn.authorized) {
      assert.equal(resOwn.actorRole, "SELLER");
    }

    const sellerB: WhatsAppAuthContext = {
      userId: USER_SELLER_B,
      userEmail: "seller-b@example.com",
      profileActive: true,
      roles: ["SELLER"],
      sellerRecord: { id: SELLER_B_ID, is_active: true },
    };
    const resOther = evaluateWhatsAppDeliveryAuthorization(ORDER_ID, sellerB, makeOrder());
    assert.equal(resOther.authorized, false);
    assert.equal(resOther.code, "FORBIDDEN");

    const inactiveSellerA: WhatsAppAuthContext = {
      ...sellerA,
      sellerRecord: { id: SELLER_A_ID, is_active: false },
    };
    const resInactive = evaluateWhatsAppDeliveryAuthorization(ORDER_ID, inactiveSellerA, makeOrder());
    assert.equal(resInactive.authorized, false);
    assert.equal(resInactive.code, "FORBIDDEN");
  });

  await t.test("Rejects invalid orderId, missing order, and ticket/order/campaign mismatches", () => {
    const adminAuth: WhatsAppAuthContext = {
      userId: USER_ADMIN,
      userEmail: "admin@example.com",
      profileActive: true,
      roles: ["ADMIN"],
      sellerRecord: null,
    };

    const badUuid = evaluateWhatsAppDeliveryAuthorization("not-a-uuid", adminAuth, makeOrder());
    assert.equal(badUuid.authorized, false);
    assert.equal(badUuid.code, "INVALID_ORDER_ID");

    const missingOrder = evaluateWhatsAppDeliveryAuthorization(ORDER_ID, adminAuth, null);
    assert.equal(missingOrder.authorized, false);
    assert.equal(missingOrder.code, "ORDER_NOT_FOUND");

    const mismatchedTicketOrder = evaluateWhatsAppDeliveryAuthorization(
      ORDER_ID,
      adminAuth,
      makeOrder({
        tickets: [
          {
            id: "77777777-7777-4777-8777-777777777702",
            order_id: OTHER_ORDER_ID,
            campaign_id: CAMPAIGN_ID,
            ticket_number: "SSFI-000102",
            status: "ISSUED",
          },
        ],
      })
    );
    assert.equal(mismatchedTicketOrder.authorized, false);
    assert.equal(mismatchedTicketOrder.code, "TICKET_RELATIONSHIP_MISMATCH");

    const mismatchedCampaign = evaluateWhatsAppDeliveryAuthorization(
      ORDER_ID,
      adminAuth,
      makeOrder({
        tickets: [
          {
            id: "77777777-7777-4777-8777-777777777703",
            order_id: ORDER_ID,
            campaign_id: OTHER_CAMPAIGN_ID,
            ticket_number: "SSFI-000103",
            status: "ISSUED",
          },
        ],
      })
    );
    assert.equal(mismatchedCampaign.authorized, false);
    assert.equal(mismatchedCampaign.code, "TICKET_RELATIONSHIP_MISMATCH");
  });

  await t.test("Source invariants: whatsappDelivery.ts enforces server auth, ownership, idempotency, and zero phone PII in audit logs", () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/server/actions/whatsappDelivery.ts"),
      "utf8"
    );
    assert.ok(src.includes("resolveTrustedWhatsAppAuthContext"));
    assert.ok(src.includes("evaluateWhatsAppDeliveryAuthorization"));
    assert.ok(src.includes('.eq("profile_id", user.id)'));
    assert.ok(!src.includes("recipient_phone: recipientPhone"), "Audit log must not store raw customer phone PII");
    assert.ok(src.includes("alreadyConfirmed: true"), "Idempotency check for manual confirmation must be preserved");
  });
});

// ============================================================================
// Phase 2B.3 — Seller Ownership Authorization Fix & Order Token Security
// ============================================================================
test("Phase 2B.3: Seller Ownership & Order Access Token Hardening", async (t) => {
  await t.test("orderAccessToken.ts uses canonical sellers.profile_id and active check (never sellers.user_id)", () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/security/orderAccessToken.ts"),
      "utf8"
    );
    assert.ok(!src.includes('.eq("user_id", user.id)'), "Broken sellers.user_id lookup must be removed");
    assert.ok(src.includes('.eq("profile_id", user.id)'), "Canonical sellers.profile_id lookup must be used");
    assert.ok(src.includes("sellerRow.is_active === true"), "Inactive sellers must be denied");
  });

  await t.test("Order access token cryptographic generation, format validation, and constant-time comparison remain intact", () => {
    const token = generateOrderAccessToken();
    assert.equal(isValidAccessTokenFormat(token), true);
    assert.equal(isValidAccessTokenFormat("short-invalid"), false);
    assert.equal(isValidAccessTokenFormat("z".repeat(64)), false);

    const hashA = hashOrderAccessToken(token);
    const hashB = hashOrderAccessToken(token.toUpperCase());
    const tamperedHash = hashOrderAccessToken(token.slice(0, 63) + (token.endsWith("0") ? "1" : "0"));

    assert.equal(safeCompareHexDigests(hashA, hashB), true);
    assert.equal(safeCompareHexDigests(hashA, tamperedHash), false);
  });
});

// ============================================================================
// Phase 2B.4 — Admin Export API Hardening (Rate Limit & Error Sanitization)
// ============================================================================
test("Phase 2B.4: Admin Export API Hardening", async (t) => {
  await t.test("Scoped rate limiter enforces threshold and blocks excess requests", async () => {
    resetRateLimitsForTesting();
    for (let i = 1; i <= 3; i++) {
      const r = await checkScopedRateLimit({
        scope: "admin_export_test",
        identifier: USER_ADMIN,
        maxAttempts: 3,
        windowSeconds: 900,
      });
      assert.equal(r.allowed, true);
      assert.equal(r.attempts, i);
    }
    const blocked = await checkScopedRateLimit({
      scope: "admin_export_test",
      identifier: USER_ADMIN,
      maxAttempts: 3,
      windowSeconds: 900,
    });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.reason, "RATE_LIMIT_EXCEEDED");
    assert.equal(blocked.retryAfterSeconds, 900);
  });

  await t.test("export/route.ts and adminExportHandler.ts enforce user.id-keyed rate limit and never leak raw database error details", () => {
    const routeSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/api/admin/export/route.ts"),
      "utf8"
    );
    const handlerSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/export/adminExportHandler.ts"),
      "utf8"
    );
    assert.ok(routeSrc.includes("handleAdminExportGet"), "Export route must delegate to handleAdminExportGet");
    assert.ok(handlerSrc.includes("checkScopedRateLimit"), "Export handler must invoke checkScopedRateLimit");
    assert.ok(handlerSrc.includes("identifier: user.id"), "Rate limit must be keyed on trusted server-side user.id");
    assert.ok(handlerSrc.includes("status: 429"), "Export handler must return HTTP 429 when rate limited");
    assert.ok(!handlerSrc.includes("details: errorObj?.message"), "Export handler must NOT return raw DB error details");
  });
});

// ============================================================================
// Phase 2B.6 — Mobile API Authentication Foundation (/api/mobile/v1/me)
// ============================================================================
test("Phase 2B.6: Mobile API Bearer JWT Authentication & Role Resolution", async (t) => {
  await t.test("Rejects missing, malformed, non-Bearer, invalid, and expired tokens with 401", async () => {
    assert.equal(extractBearerToken(new Headers()), null);
    assert.equal(extractBearerToken(new Headers({ authorization: "Basic dXNlcjpwYXNz" })), null);
    assert.equal(extractBearerToken(new Headers({ authorization: "Bearer not-a-jwt" })), null);
    assert.equal(extractBearerToken(new Headers({ authorization: "Bearer a.b" })), null);

    const missingRes = await authenticateMobileRequest(new Headers(), makeMobileDeps());
    assert.equal(missingRes.ok, false);
    if (!missingRes.ok) assert.equal(missingRes.status, 401);

    const invalidRes = await authenticateMobileRequest(
      new Headers({ authorization: `Bearer ${VALID_JWT}` }),
      makeMobileDeps({
        verifyAccessToken: async () => ({ user: null, error: "JWT expired" }),
      })
    );
    assert.equal(invalidRes.ok, false);
    if (!invalidRes.ok) {
      assert.equal(invalidRes.status, 401);
      assert.equal(invalidRes.code, "UNAUTHORIZED");
    }
  });

  await t.test("Resolves SUPER_ADMIN, ADMIN, active SELLER, CUSTOMER, and no-role users strictly from authoritative DB", async () => {
    // SUPER_ADMIN
    const superRes = await authenticateMobileRequest(
      new Headers({ authorization: `Bearer ${VALID_JWT}` }),
      makeMobileDeps({
        verifyAccessToken: async () => ({ user: { id: USER_SUPER, email: "super@ssfi.org" } }),
        checkHasRole: async (_uid, role) => role === "SUPER_ADMIN",
      })
    );
    assert.equal(superRes.ok, true);
    if (superRes.ok) {
      assert.deepEqual(superRes.user.roles, ["SUPER_ADMIN"]);
      assert.equal(superRes.user.primaryRole, "SUPER_ADMIN");
      assert.equal(requireMobileRoles(superRes.user, ["SUPER_ADMIN"]), true);
    }

    // ADMIN
    const adminRes = await authenticateMobileRequest(
      new Headers({ authorization: `Bearer ${VALID_JWT}` }),
      makeMobileDeps({
        verifyAccessToken: async () => ({ user: { id: USER_ADMIN, email: "admin@ssfi.org" } }),
        checkHasRole: async (_uid, role) => role === "ADMIN",
      })
    );
    assert.equal(adminRes.ok, true);
    if (adminRes.ok) {
      assert.deepEqual(adminRes.user.roles, ["ADMIN"]);
      assert.equal(adminRes.user.primaryRole, "ADMIN");
      assert.equal(requireMobileRoles(adminRes.user, ["SUPER_ADMIN"]), false);
    }

    // Active SELLER
    const sellerRes = await authenticateMobileRequest(
      new Headers({ authorization: `Bearer ${VALID_JWT}` }),
      makeMobileDeps({
        verifyAccessToken: async () => ({ user: { id: USER_SELLER_A, email: "seller@ssfi.org" } }),
        checkHasRole: async (_uid, role) => role === "SELLER",
        hasActiveSellerProfile: async () => true,
      })
    );
    assert.equal(sellerRes.ok, true);
    if (sellerRes.ok) {
      assert.deepEqual(sellerRes.user.roles, ["SELLER"]);
      assert.equal(sellerRes.user.primaryRole, "SELLER");
    }

    // Deactivated SELLER -> 403
    const deactivatedSeller = await authenticateMobileRequest(
      new Headers({ authorization: `Bearer ${VALID_JWT}` }),
      makeMobileDeps({
        verifyAccessToken: async () => ({ user: { id: USER_SELLER_B, email: "seller-off@ssfi.org" } }),
        checkHasRole: async (_uid, role) => role === "SELLER",
        hasActiveSellerProfile: async () => false,
      })
    );
    assert.equal(deactivatedSeller.ok, false);
    if (!deactivatedSeller.ok) assert.equal(deactivatedSeller.status, 403);

    // Linked customer account (REV-2C-03: tracked separately from authoritative RBAC roles)
    const custRes = await authenticateMobileRequest(
      new Headers({ authorization: `Bearer ${VALID_JWT}` }),
      makeMobileDeps({
        verifyAccessToken: async () => ({ user: { id: USER_CUSTOMER, email: "cust@example.com" } }),
        hasCustomerProfile: async () => true,
      })
    );
    assert.equal(custRes.ok, true);
    if (custRes.ok) {
      assert.deepEqual(custRes.user.roles, []);
      assert.equal(custRes.user.primaryRole, null);
      assert.equal(custRes.user.customerProfileLinked, true);
      assert.equal(requireMobileRoles(custRes.user, ["ADMIN", "SUPER_ADMIN", "SELLER"]), false);
    }

    // User without any role -> no privilege escalation or fallback
    const noRoleRes = await authenticateMobileRequest(
      new Headers({ authorization: `Bearer ${VALID_JWT}` }),
      makeMobileDeps({
        verifyAccessToken: async () => ({ user: { id: USER_NOROLE, email: "norole@example.com" } }),
      })
    );
    assert.equal(noRoleRes.ok, true);
    if (noRoleRes.ok) {
      assert.deepEqual(noRoleRes.user.roles, []);
      assert.equal(noRoleRes.user.primaryRole, null);
      assert.equal(noRoleRes.user.customerProfileLinked, false);
    }
  });

  await t.test("Ignores client-supplied role/user spoofing headers and returns safe /api/mobile/v1/me response", async () => {
    resetRateLimitsForTesting();
    const spoofedHeaders = new Headers({
      authorization: `Bearer ${VALID_JWT}`,
      "x-user-role": "SUPER_ADMIN",
      "x-user-id": USER_SUPER,
      "x-forwarded-for": "203.0.113.10",
    });

    const response = await handleMobileMeGet(
      { headers: spoofedHeaders },
      makeMobileDeps({
        verifyAccessToken: async () => ({ user: { id: USER_CUSTOMER, email: "cust@example.com" } }),
        hasCustomerProfile: async () => true,
      })
    );

    assert.equal(response.status, 200);
    assert.ok(response.headers.get("cache-control")?.includes("no-store"));
    const body = await response.json();
    assert.equal(body.apiVersion, "v1");
    assert.equal(body.data.user.id, USER_CUSTOMER);
    assert.deepEqual(body.data.roles, []);
    assert.equal(body.data.primaryRole, null);
    assert.equal(body.data.customerProfileLinked, true);
    assert.equal(body.data.user.accountStatus, "ACTIVE");

    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes("SUPER_ADMIN"), "Client-supplied role spoof must never appear");
    assert.ok(!serialized.includes(USER_SUPER), "Client-supplied user ID spoof must never appear");
    assert.ok(!serialized.includes("service_role"), "No service_role credentials may ever appear");
    assert.ok(!serialized.includes(VALID_JWT), "Bearer token must never be echoed back");
  });

  await t.test("Rejects inactive profile with 403 and enforces rate limiting (429)", async () => {
    resetRateLimitsForTesting();
    const inactiveRes = await handleMobileMeGet(
      { headers: new Headers({ authorization: `Bearer ${VALID_JWT}`, "x-forwarded-for": "198.51.100.1" }) },
      makeMobileDeps({ resolveProfileActive: async () => false })
    );
    assert.equal(inactiveRes.status, 403);
    const inactiveBody = await inactiveRes.json();
    assert.equal(inactiveBody.error.code, "FORBIDDEN");

    // Exhaust IP rate limit (60 requests)
    resetRateLimitsForTesting();
    const headers = new Headers({ "x-forwarded-for": "198.51.100.99" });
    for (let i = 0; i < 60; i++) {
      const r = await handleMobileMeGet({ headers }, makeMobileDeps());
      assert.equal(r.status, 401);
    }
    const rateLimited = await handleMobileMeGet({ headers }, makeMobileDeps());
    assert.equal(rateLimited.status, 429);
    assert.ok(rateLimited.headers.get("retry-after"));
  });
});
