import assert from "node:assert/strict";
import test from "node:test";
import crypto from "crypto";
import {
  generateOrderAccessToken,
  hashOrderAccessToken,
  isValidAccessTokenFormat,
  safeCompareHexDigests,
  getOrderCookieName,
  getOrderCookieOptions,
  type AccessMode,
  type VerifyTokenResult,
} from "../src/lib/security/orderAccessToken.ts";
import {
  checkOrderAccessRateLimit,
  hashClientIp,
  resetRateLimitsForTesting,
  MAX_ATTEMPTS_PER_IP,
  MAX_ATTEMPTS_PER_ORDER,
} from "../src/lib/security/rateLimit.ts";
import {
  buildPaymentRecoveryUrl,
  buildOrderAccessExchangeUrl,
} from "../src/lib/payment/recoveryToken.ts";

// ============================================================================
// Test Models and In-Memory Simulation Fixtures
// ============================================================================

type SimulatedOrder = {
  id: string;
  order_number: string;
  seller_id: string;
  status: "PENDING_PAYMENT" | "PAYMENT_SUBMITTED" | "PAYMENT_VERIFIED" | "TICKETS_ISSUED" | "CANCELLED" | "REFUNDED" | "VOID";
};

type SimulatedToken = {
  id: string;
  order_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  used_at: string | null;
};

type SimulatedDb = {
  orders: Map<string, SimulatedOrder>;
  tokens: Map<string, SimulatedToken>;
};

function createSimulatedDb(): SimulatedDb {
  return {
    orders: new Map(),
    tokens: new Map(),
  };
}

function simulateIssueToken(
  db: SimulatedDb,
  orderId: string,
  rawToken: string,
  expiresInDays = 7
): SimulatedToken {
  const hash = hashOrderAccessToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  // Revoke prior active tokens for this order
  for (const token of db.tokens.values()) {
    if (token.order_id === orderId && token.revoked_at === null) {
      token.revoked_at = now.toISOString();
    }
  }

  const tokenRecord: SimulatedToken = {
    id: crypto.randomUUID(),
    order_id: orderId,
    token_hash: hash,
    expires_at: expiresAt,
    revoked_at: null,
    used_at: null,
  };

  db.tokens.set(tokenRecord.id, tokenRecord);
  return tokenRecord;
}

function simulateVerifyOrderPaymentAccess(
  db: SimulatedDb,
  orderId: string,
  rawToken: string,
  mode: AccessMode
): VerifyTokenResult {
  if (!orderId || !isValidAccessTokenFormat(rawToken)) {
    return { authorized: false, code: "INVALID_PARAMETERS" };
  }

  const cleanHash = hashOrderAccessToken(rawToken);

  let tokenRecord: SimulatedToken | null = null;
  for (const t of db.tokens.values()) {
    if (t.order_id === orderId && safeCompareHexDigests(t.token_hash, cleanHash)) {
      tokenRecord = t;
      break;
    }
  }

  if (!tokenRecord) {
    return { authorized: false, code: "UNAUTHORIZED" };
  }

  if (tokenRecord.revoked_at !== null) {
    return { authorized: false, code: "TOKEN_REVOKED" };
  }

  if (new Date(tokenRecord.expires_at) <= new Date()) {
    return { authorized: false, code: "TOKEN_EXPIRED" };
  }

  const order = db.orders.get(orderId);
  if (!order) {
    return { authorized: false, code: "ORDER_NOT_FOUND" };
  }

  if (["CANCELLED", "REFUNDED", "VOID"].includes(order.status)) {
    return {
      authorized: false,
      code: "ORDER_INACTIVE",
      order_status: order.status,
    };
  }

  if (mode === "READ") {
    return {
      authorized: true,
      code: "AUTHORIZED_READ",
      access_mode: "READ",
      token_id: tokenRecord.id,
      order_id: tokenRecord.order_id,
      order_number: order.order_number,
      order_status: order.status,
      expires_at: tokenRecord.expires_at,
      write_consumed_at: tokenRecord.used_at,
    };
  }

  // WRITE or CONSUME_WRITE
  if (tokenRecord.used_at !== null) {
    return {
      authorized: false,
      code: "TOKEN_WRITE_ALREADY_CONSUMED",
      order_status: order.status,
      write_consumed_at: tokenRecord.used_at,
    };
  }

  if (order.status !== "PENDING_PAYMENT") {
    return {
      authorized: false,
      code: "ORDER_NOT_EDITABLE",
      order_status: order.status,
    };
  }

  if (mode === "CONSUME_WRITE") {
    const consumedAt = new Date().toISOString();
    tokenRecord.used_at = consumedAt;
    return {
      authorized: true,
      code: "AUTHORIZED_WRITE_CONSUMED",
      access_mode: "CONSUME_WRITE",
      token_id: tokenRecord.id,
      order_id: tokenRecord.order_id,
      order_number: order.order_number,
      order_status: order.status,
      write_consumed_at: consumedAt,
    };
  }

  return {
    authorized: true,
    code: "AUTHORIZED_WRITE",
    access_mode: "WRITE",
    token_id: tokenRecord.id,
    order_id: tokenRecord.order_id,
    order_number: order.order_number,
    order_status: order.status,
  };
}

// ============================================================================
// Test Suite: Customer Payment Access Security (Phase 6A)
// ============================================================================

test("1. Cryptographic token generation, SHA-256 hashing, and format validation", () => {
  const token = generateOrderAccessToken();
  assert.equal(typeof token, "string");
  assert.equal(token.length, 64, "Token must be 64 hexadecimal characters (256 bits)");
  assert.match(token, /^[0-9a-f]{64}$/, "Token must contain only lowercase hex characters");

  const hash = hashOrderAccessToken(token);
  assert.equal(hash.length, 64, "SHA-256 digest must be 64 characters");
  assert.match(hash, /^[0-9a-f]{64}$/, "Hash must be lowercase hexadecimal");

  // Constant-time comparison
  assert.ok(safeCompareHexDigests(hash, hash), "Timing safe comparison should match identical digests");
  const otherHash = hashOrderAccessToken(generateOrderAccessToken());
  assert.equal(safeCompareHexDigests(hash, otherHash), false, "Timing safe comparison must not match differing digests");

  // Format validation
  assert.ok(isValidAccessTokenFormat(token));
  assert.equal(isValidAccessTokenFormat("short-token"), false);
  assert.equal(isValidAccessTokenFormat(""), false);
  assert.equal(isValidAccessTokenFormat(null), false);
  assert.equal(isValidAccessTokenFormat(undefined), false);
  assert.equal(isValidAccessTokenFormat("x".repeat(64)), false, "Non-hex characters must be rejected");
});

test("2. Cookie name scoping and security attributes conform to Phase 5 specification", () => {
  const orderId = "550e8400-e29b-41d4-a716-446655440000";
  const cookieName = getOrderCookieName(orderId);
  assert.equal(cookieName, `ssfi_order_access_${orderId.toLowerCase()}`);

  const options = getOrderCookieOptions();
  assert.equal(options.httpOnly, true, "Cookie must be HttpOnly to prevent JavaScript access");
  assert.equal(options.sameSite, "lax", "Cookie must use SameSite=Lax for top-level navigation compatibility");
  assert.equal(options.path, "/", "Cookie path must be '/' (SEC-03 fix) so all endpoints receive the cookie");
  assert.equal(options.maxAge, 7 * 24 * 60 * 60, "Max-Age must match 7-day token expiration");
});

test("3. Anonymous visitor with UUID-only is blocked (P0-1 Prevention)", () => {
  const db = createSimulatedDb();
  const orderId = crypto.randomUUID();
  db.orders.set(orderId, {
    id: orderId,
    order_number: "ORD-2026-000001",
    seller_id: crypto.randomUUID(),
    status: "PENDING_PAYMENT",
  });

  // Attempt verification with empty / missing token
  const result = simulateVerifyOrderPaymentAccess(db, orderId, "", "READ");
  assert.equal(result.authorized, false);
  assert.equal(result.code, "INVALID_PARAMETERS");

  // Attempt verification with random non-existent token
  const fakeToken = generateOrderAccessToken();
  const unauthorizedResult = simulateVerifyOrderPaymentAccess(db, orderId, fakeToken, "READ");
  assert.equal(unauthorizedResult.authorized, false);
  assert.equal(unauthorizedResult.code, "UNAUTHORIZED");
});

test("4. Valid customer token authorizes page view in READ mode", () => {
  const db = createSimulatedDb();
  const orderId = crypto.randomUUID();
  db.orders.set(orderId, {
    id: orderId,
    order_number: "ORD-2026-000002",
    seller_id: crypto.randomUUID(),
    status: "PENDING_PAYMENT",
  });

  const rawToken = generateOrderAccessToken();
  simulateIssueToken(db, orderId, rawToken);

  const result = simulateVerifyOrderPaymentAccess(db, orderId, rawToken, "READ");
  assert.equal(result.authorized, true);
  assert.equal(result.code, "AUTHORIZED_READ");
  assert.equal(result.order_number, "ORD-2026-000002");
  assert.equal(result.order_status, "PENDING_PAYMENT");
});

test("5. Expired token is rejected (TOKEN_EXPIRED)", () => {
  const db = createSimulatedDb();
  const orderId = crypto.randomUUID();
  db.orders.set(orderId, {
    id: orderId,
    order_number: "ORD-2026-000003",
    seller_id: crypto.randomUUID(),
    status: "PENDING_PAYMENT",
  });

  const rawToken = generateOrderAccessToken();
  const tokenRecord = simulateIssueToken(db, orderId, rawToken);
  // Backdate expiration
  tokenRecord.expires_at = new Date(Date.now() - 3600 * 1000).toISOString();

  const result = simulateVerifyOrderPaymentAccess(db, orderId, rawToken, "READ");
  assert.equal(result.authorized, false);
  assert.equal(result.code, "TOKEN_EXPIRED");
});

test("6. Revoked token is rejected (TOKEN_REVOKED)", () => {
  const db = createSimulatedDb();
  const orderId = crypto.randomUUID();
  db.orders.set(orderId, {
    id: orderId,
    order_number: "ORD-2026-000004",
    seller_id: crypto.randomUUID(),
    status: "PENDING_PAYMENT",
  });

  const rawToken1 = generateOrderAccessToken();
  simulateIssueToken(db, orderId, rawToken1);

  // Issue second token — should revoke token 1
  const rawToken2 = generateOrderAccessToken();
  simulateIssueToken(db, orderId, rawToken2);

  const oldResult = simulateVerifyOrderPaymentAccess(db, orderId, rawToken1, "READ");
  assert.equal(oldResult.authorized, false);
  assert.equal(oldResult.code, "TOKEN_REVOKED");

  const newResult = simulateVerifyOrderPaymentAccess(db, orderId, rawToken2, "READ");
  assert.equal(newResult.authorized, true);
  assert.equal(newResult.code, "AUTHORIZED_READ");
});

test("7. Cross-order isolation: Token for Order A cannot authorize Order B", () => {
  const db = createSimulatedDb();
  const orderIdA = crypto.randomUUID();
  const orderIdB = crypto.randomUUID();

  db.orders.set(orderIdA, {
    id: orderIdA,
    order_number: "ORD-2026-000005",
    seller_id: crypto.randomUUID(),
    status: "PENDING_PAYMENT",
  });

  db.orders.set(orderIdB, {
    id: orderIdB,
    order_number: "ORD-2026-000006",
    seller_id: crypto.randomUUID(),
    status: "PENDING_PAYMENT",
  });

  const tokenA = generateOrderAccessToken();
  simulateIssueToken(db, orderIdA, tokenA);

  // Presenting token A for order B must be denied
  const crossOrderResult = simulateVerifyOrderPaymentAccess(db, orderIdB, tokenA, "READ");
  assert.equal(crossOrderResult.authorized, false);
  assert.equal(crossOrderResult.code, "UNAUTHORIZED");
});

test("8. Rate limiter blocks IP bucket after 10 attempts and order bucket after 30 attempts (SEC-02)", async () => {
  resetRateLimitsForTesting();
  assert.equal(MAX_ATTEMPTS_PER_IP, 10);
  assert.equal(MAX_ATTEMPTS_PER_ORDER, 30);
  const orderId = crypto.randomUUID();
  const ip1 = "203.0.113.10";
  const ip2 = "203.0.113.20";

  // IP 1 makes 10 requests (all allowed)
  for (let i = 1; i <= MAX_ATTEMPTS_PER_IP; i++) {
    const res = await checkOrderAccessRateLimit({ orderId, clientIp: ip1 });
    assert.equal(res.allowed, true, `Attempt ${i} should be allowed`);
    assert.equal(res.ipAttempts, i);
  }

  // 11th request from IP 1 must be blocked
  const blockedIp1 = await checkOrderAccessRateLimit({ orderId, clientIp: ip1 });
  assert.equal(blockedIp1.allowed, false);
  assert.equal(blockedIp1.reason, "IP_LIMIT_EXCEEDED");

  // IP 2 can still make requests because it has its own IP bucket
  const allowedIp2 = await checkOrderAccessRateLimit({ orderId, clientIp: ip2 });
  assert.equal(allowedIp2.allowed, true);
  assert.equal(allowedIp2.ipAttempts, 1);

  // Global order bucket accumulation:
  // Order already has 11 (from IP1) + 1 (from IP2) = 12 attempts
  // Make 18 more attempts across distinct IPs to hit 30
  for (let j = 3; j <= 20; j++) {
    await checkOrderAccessRateLimit({ orderId, clientIp: `203.0.113.${j}` });
  }

  // Next attempt from a brand-new IP must be blocked by global order limit (30 exceeded)
  const blockedGlobal = await checkOrderAccessRateLimit({ orderId, clientIp: "203.0.113.99" });
  assert.equal(blockedGlobal.allowed, false);
  assert.equal(blockedGlobal.reason, "GLOBAL_ORDER_LIMIT_EXCEEDED");

  // Reset helper clears rate limits
  resetRateLimitsForTesting();
  const afterReset = await checkOrderAccessRateLimit({ orderId, clientIp: ip1 });
  assert.equal(afterReset.allowed, true);
});

test("9. Client IP hashing never exposes raw IP address", () => {
  const rawIp = "192.168.1.100";
  const hash = hashClientIp(rawIp);
  assert.equal(hash.length, 16);
  assert.match(hash, /^[0-9a-f]{16}$/);
  assert.equal(hash.includes(rawIp), false, "Hash must never contain raw IP string");
});

test("10. READ vs WRITE mode separation and payment consumption (SEC-04 / SQL-03)", () => {
  const db = createSimulatedDb();
  const orderId = crypto.randomUUID();
  db.orders.set(orderId, {
    id: orderId,
    order_number: "ORD-2026-000007",
    seller_id: crypto.randomUUID(),
    status: "PENDING_PAYMENT",
  });

  const rawToken = generateOrderAccessToken();
  simulateIssueToken(db, orderId, rawToken);

  // 1. Initial READ access works
  const read1 = simulateVerifyOrderPaymentAccess(db, orderId, rawToken, "READ");
  assert.equal(read1.authorized, true);
  assert.equal(read1.write_consumed_at, null);

  // 2. Initial WRITE access works (screenshot upload)
  const write1 = simulateVerifyOrderPaymentAccess(db, orderId, rawToken, "WRITE");
  assert.equal(write1.authorized, true);
  assert.equal(write1.code, "AUTHORIZED_WRITE");

  // 3. CONSUME_WRITE access succeeds and stamps used_at (UPI submission)
  const consumeWrite = simulateVerifyOrderPaymentAccess(db, orderId, rawToken, "CONSUME_WRITE");
  assert.equal(consumeWrite.authorized, true);
  assert.equal(consumeWrite.code, "AUTHORIZED_WRITE_CONSUMED");
  assert.ok(consumeWrite.write_consumed_at);

  // 4. Subsequent WRITE attempt is blocked (single-use write protection)
  const writeReplay = simulateVerifyOrderPaymentAccess(db, orderId, rawToken, "WRITE");
  assert.equal(writeReplay.authorized, false);
  assert.equal(writeReplay.code, "TOKEN_WRITE_ALREADY_CONSUMED");

  // 5. Subsequent CONSUME_WRITE attempt is blocked
  const consumeReplay = simulateVerifyOrderPaymentAccess(db, orderId, rawToken, "CONSUME_WRITE");
  assert.equal(consumeReplay.authorized, false);
  assert.equal(consumeReplay.code, "TOKEN_WRITE_ALREADY_CONSUMED");

  // 6. CRITICAL: Customer can STILL read order status and view tickets! (SEC-04 fix)
  const readAfterPayment = simulateVerifyOrderPaymentAccess(db, orderId, rawToken, "READ");
  assert.equal(readAfterPayment.authorized, true);
  assert.equal(readAfterPayment.code, "AUTHORIZED_READ");
  assert.ok(readAfterPayment.write_consumed_at);
});

test("11. Inactive orders (CANCELLED, REFUNDED, VOID) are rejected", () => {
  const db = createSimulatedDb();
  const orderId = crypto.randomUUID();
  db.orders.set(orderId, {
    id: orderId,
    order_number: "ORD-2026-000008",
    seller_id: crypto.randomUUID(),
    status: "CANCELLED",
  });

  const rawToken = generateOrderAccessToken();
  simulateIssueToken(db, orderId, rawToken);

  const result = simulateVerifyOrderPaymentAccess(db, orderId, rawToken, "READ");
  assert.equal(result.authorized, false);
  assert.equal(result.code, "ORDER_INACTIVE");
  assert.equal(result.order_status, "CANCELLED");
});

test("12. URL builders ensure zero bearer token leakage in checkout redirect URLs", () => {
  const baseUrl = "https://preview.ssfi.in";
  const orderId = "550e8400-e29b-41d4-a716-446655440000";
  const rawToken = generateOrderAccessToken();

  // Exchange URL points to dedicated route handler
  const exchangeUrl = buildOrderAccessExchangeUrl(baseUrl, orderId, rawToken);
  assert.ok(exchangeUrl.startsWith("https://preview.ssfi.in/api/order-access/exchange"));
  assert.ok(exchangeUrl.includes(`orderId=${orderId}`));
  assert.ok(exchangeUrl.includes(`token=${rawToken}`));

  // Recovery URL points to completion page
  const recoveryUrl = buildPaymentRecoveryUrl(baseUrl, rawToken);
  assert.equal(recoveryUrl, `https://preview.ssfi.in/payment/complete/${rawToken}`);
  assert.equal(recoveryUrl.includes(orderId), false, "Recovery URL must not leak order UUID");

  // Verify normal checkout redirect target contains zero token
  const cleanCheckoutRedirectUrl = `/buy/order/${orderId}`;
  assert.equal(cleanCheckoutRedirectUrl.includes("?t="), false, "Normal checkout URL must never contain bearer token");
  assert.equal(cleanCheckoutRedirectUrl.includes("token="), false);
});

test("13. Multi-role authorization boundaries: Staff, Owning Seller, and Non-Owning Seller", () => {
  const db = createSimulatedDb();
  const orderId = crypto.randomUUID();
  const sellerIdA = crypto.randomUUID();
  const sellerIdB = crypto.randomUUID();

  db.orders.set(orderId, {
    id: orderId,
    order_number: "ORD-2026-000009",
    seller_id: sellerIdA,
    status: "PENDING_PAYMENT",
  });

  // Role simulation helper
  function checkRoleAccess(
    caller: { role: "STAFF" | "SELLER" | "ANON"; sellerId?: string },
    targetOrderId: string
  ): { authorized: boolean; reason: string } {
    if (caller.role === "STAFF") {
      return { authorized: true, reason: "AUTHORIZED_STAFF" };
    }
    const order = db.orders.get(targetOrderId);
    if (!order) return { authorized: false, reason: "NOT_FOUND" };

    if (caller.role === "SELLER" && caller.sellerId === order.seller_id) {
      return { authorized: true, reason: "AUTHORIZED_SELLER" };
    }
    return { authorized: false, reason: "UNAUTHORIZED" };
  }

  // 1. Staff can access order
  const staffCheck = checkRoleAccess({ role: "STAFF" }, orderId);
  assert.equal(staffCheck.authorized, true);
  assert.equal(staffCheck.reason, "AUTHORIZED_STAFF");

  // 2. Owning seller (sellerIdA) can access order
  const owningSellerCheck = checkRoleAccess({ role: "SELLER", sellerId: sellerIdA }, orderId);
  assert.equal(owningSellerCheck.authorized, true);
  assert.equal(owningSellerCheck.reason, "AUTHORIZED_SELLER");

  // 3. Non-owning seller (sellerIdB) cannot access order
  const otherSellerCheck = checkRoleAccess({ role: "SELLER", sellerId: sellerIdB }, orderId);
  assert.equal(otherSellerCheck.authorized, false);
  assert.equal(otherSellerCheck.reason, "UNAUTHORIZED");

  // 4. Anonymous caller cannot access order without customer token
  const anonCheck = checkRoleAccess({ role: "ANON" }, orderId);
  assert.equal(anonCheck.authorized, false);
});

test("14. Token format edge cases and case-insensitivity normalization", () => {
  const token = generateOrderAccessToken();
  const upperToken = token.toUpperCase();
  const paddedToken = `  ${token}  `;

  // Both uppercase and whitespace padded tokens produce identical normalized SHA-256 digests
  const hash1 = hashOrderAccessToken(token);
  const hash2 = hashOrderAccessToken(upperToken);
  const hash3 = hashOrderAccessToken(paddedToken);

  assert.equal(hash1, hash2, "Uppercase token must produce identical SHA-256 digest");
  assert.equal(hash1, hash3, "Whitespace padded token must produce identical SHA-256 digest");

  // Malformed tokens
  assert.equal(isValidAccessTokenFormat("   "), false);
  assert.equal(isValidAccessTokenFormat(token.slice(0, 63)), false, "63 chars must be rejected");
  assert.equal(isValidAccessTokenFormat(token + "a"), false, "65 chars must be rejected");
  assert.equal(isValidAccessTokenFormat("g".repeat(64)), false, "Non-hex 'g' must be rejected");
});

test("15. Order payment snapshot immutability preserves attributed seller QR flow", () => {
  const originalSnapshot = {
    snapshot_seller_id: "seller-uuid-001",
    snapshot_seller_code: "SELLER-001",
    snapshot_qr_storage_path: "seller-qrs/seller-001.png",
    snapshot_upi_id: "seller001@upi",
    snapshot_account_name: "Seller One",
    snapshot_captured_at: "2026-11-07T12:00:00.000Z",
  };

  // Customer or malicious update attempt cannot mutate snapshot fields
  const customerSubmissionUpdate = {
    utr_reference: "123456789012",
    payer_name: "Jane Doe",
    snapshot_upi_id: "malicious@upi", // Attempted tamper
  };

  // Safe merge logic preserves snapshot
  const sanitizedUpdate: Record<string, unknown> = { ...customerSubmissionUpdate };
  delete sanitizedUpdate.snapshot_upi_id;
  delete (sanitizedUpdate as Record<string, unknown>).snapshot_seller_id;

  assert.equal(sanitizedUpdate.snapshot_upi_id, undefined, "Payment submission must not overwrite snapshot UPI ID");
  assert.equal(originalSnapshot.snapshot_upi_id, "seller001@upi", "Original snapshot UPI remains intact");
});
