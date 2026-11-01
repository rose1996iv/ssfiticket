import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { z } from "zod";
import {
  generateSecureRecoveryToken,
  hashRecoveryToken,
  isValidTokenFormat,
  buildPaymentRecoveryUrl,
  checkTokenRateLimit,
  buildWhatsAppRecoveryShareUrl,
} from "../src/lib/payment/recoveryToken.ts";
import {
  buildUpiPaymentUri,
  parseUpiPaymentUri,
  generateUpiQrDataUrl,
} from "../src/lib/payment/upi.ts";
import { manualUpiConfig } from "../src/lib/config/payment.ts";
import { whatsappSchema, emailSchema, validateWhatsAppDigits } from "../src/lib/validation/contact.ts";

// ============================================================================
// Schemas and In-Memory Simulation of Database State & RPCs
// ============================================================================

const paymentDetailsSchema = z.object({
  orderId: z.string().uuid("Invalid order ID."),
  token: z.string().trim().optional(),
  utr: z
    .string()
    .trim()
    .min(6, "UTR / Reference must be at least 6 characters.")
    .max(64, "UTR cannot exceed 64 characters.")
    .regex(/^[A-Za-z0-9-]+$/, "UTR must only contain alphanumeric characters or hyphens."),
  email: emailSchema,
  whatsapp: whatsappSchema,
  payerName: z.string().trim().max(120).optional(),
});

type OrderModel = {
  id: string;
  order_number: string;
  quantity: number;
  total_amount_paise: number;
  status: "PENDING_PAYMENT" | "PAYMENT_SUBMITTED" | "PAYMENT_VERIFIED" | "TICKETS_ISSUED" | "CANCELLED" | "REFUNDED";
  customer_id: string;
  seller_id: string | null;
};

type CustomerModel = {
  id: string;
  full_name: string;
  phone: string;
  whatsapp_number: string | null;
  email: string | null;
};

type PaymentModel = {
  id: string;
  order_id: string;
  status: "PENDING" | "SUBMITTED" | "VERIFIED" | "FAILED" | "CANCELLED";
  amount_paise: number;
  utr_reference: string | null;
  payer_name: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  rejection_reason: string | null;
};

type RecoveryTokenModel = {
  id: string;
  order_id: string;
  token_hash: string;
  created_by: string | null;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  used_at: string | null;
  created_at: string;
};

type TicketModel = {
  id: string;
  order_id: string;
  ticket_number: string;
  status: "ISSUED" | "VOID";
};

type AuditLogModel = {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

class SimulatedDb {
  orders: Map<string, OrderModel> = new Map();
  customers: Map<string, CustomerModel> = new Map();
  payments: Map<string, PaymentModel> = new Map();
  tokens: Map<string, RecoveryTokenModel> = new Map();
  tickets: Map<string, TicketModel> = new Map();
  auditLogs: AuditLogModel[] = [];

  createPaymentRecoveryLink(
    orderId: string,
    tokenHash: string,
    actorId: string,
    actorRoles: string[],
    expiresDays = 7
  ) {
    if (!actorRoles.some((r) => r === "SUPER_ADMIN" || r === "ADMIN")) {
      throw new Error("administrator role required to generate recovery link");
    }

    const order = this.orders.get(orderId);
    if (!order) throw new Error("order not found");
    if (order.status === "CANCELLED" || order.status === "REFUNDED") {
      throw new Error("cannot generate recovery link for cancelled or refunded order");
    }

    // Revoke previous active tokens for this order
    const now = new Date();
    for (const token of this.tokens.values()) {
      if (token.order_id === orderId && !token.revoked_at && new Date(token.expires_at) > now) {
        token.revoked_at = now.toISOString();
        token.revoked_by = actorId;
      }
    }

    const expiresAt = new Date(now.getTime() + expiresDays * 86400000).toISOString();
    const tokenId = crypto.randomUUID();
    const tokenRecord: RecoveryTokenModel = {
      id: tokenId,
      order_id: orderId,
      token_hash: tokenHash,
      created_by: actorId,
      expires_at: expiresAt,
      revoked_at: null,
      revoked_by: null,
      used_at: null,
      created_at: now.toISOString(),
    };
    this.tokens.set(tokenId, tokenRecord);

    this.auditLogs.push({
      id: crypto.randomUUID(),
      actor_user_id: actorId,
      action: "PAYMENT_RECOVERY_LINK_GENERATED",
      entity_type: "order",
      entity_id: orderId,
      metadata: { token_id: tokenId, expires_at: expiresAt, order_number: order.order_number },
      created_at: now.toISOString(),
    });

    return {
      token_id: tokenId,
      order_id: orderId,
      order_number: order.order_number,
      expires_at: expiresAt,
    };
  }

  revokePaymentRecoveryLink(orderId: string, actorId: string, actorRoles: string[]) {
    if (!actorRoles.some((r) => r === "SUPER_ADMIN" || r === "ADMIN")) {
      throw new Error("administrator role required to revoke recovery link");
    }

    const order = this.orders.get(orderId);
    if (!order) throw new Error("order not found");

    const now = new Date();
    let revokedCount = 0;
    for (const token of this.tokens.values()) {
      if (token.order_id === orderId && !token.revoked_at) {
        token.revoked_at = now.toISOString();
        token.revoked_by = actorId;
        revokedCount++;
      }
    }

    this.auditLogs.push({
      id: crypto.randomUUID(),
      actor_user_id: actorId,
      action: "PAYMENT_RECOVERY_LINK_REVOKED",
      entity_type: "order",
      entity_id: orderId,
      metadata: { order_number: order.order_number, revoked_count: revokedCount },
      created_at: now.toISOString(),
    });

    return { order_id: orderId, order_number: order.order_number, revoked_count: revokedCount };
  }

  lookupPaymentRecoveryToken(tokenHash: string) {
    let matchedToken: RecoveryTokenModel | null = null;
    for (const t of this.tokens.values()) {
      if (t.token_hash === tokenHash) {
        matchedToken = t;
        break;
      }
    }

    if (!matchedToken) {
      return { valid: false, status: "NOT_FOUND", error: "The payment details link was not found or has been replaced." };
    }

    if (matchedToken.revoked_at) {
      return { valid: false, status: "REVOKED", error: "This payment completion link has been revoked by an administrator." };
    }

    const now = new Date();
    if (new Date(matchedToken.expires_at) <= now) {
      return { valid: false, status: "EXPIRED", error: "This payment completion link has expired. Please contact support or request a new link." };
    }

    const order = this.orders.get(matchedToken.order_id);
    if (!order) return { valid: false, status: "ORDER_NOT_FOUND", error: "Associated order not found." };

    if (order.status === "CANCELLED" || order.status === "REFUNDED") {
      return { valid: false, status: "ORDER_CANCELLED", error: "This order has been cancelled or refunded." };
    }

    const customer = this.customers.get(order.customer_id);
    const payment = Array.from(this.payments.values()).find((p) => p.order_id === order.id);

    if (order.status === "TICKETS_ISSUED" || payment?.status === "VERIFIED") {
      return { valid: false, status: "ALREADY_ISSUED", error: "Tickets have already been issued for this order." };
    }

    const status = payment?.status === "SUBMITTED" ? "SUBMITTED_AWAITING_VERIFICATION" : "PENDING_PAYMENT";

    return {
      valid: true,
      status,
      order_id: order.id,
      order_number: order.order_number,
      quantity: order.quantity,
      total_amount_paise: order.total_amount_paise,
      customer_id: customer?.id,
      customer_name: customer?.full_name,
      customer_phone: customer?.phone,
      customer_whatsapp: customer?.whatsapp_number || customer?.phone,
      customer_email: customer?.email || "",
      payment_id: payment?.id,
      payment_status: payment?.status || "PENDING",
      payment_utr: payment?.utr_reference || "",
      token_expires_at: matchedToken.expires_at,
    };
  }

  submitPaymentDetailsCompletion(params: {
    orderId: string;
    utr: string;
    email: string;
    whatsapp: string;
    payerName?: string;
    tokenHash?: string;
  }) {
    const trimmedUtr = params.utr.trim();
    const trimmedEmail = params.email.trim().toLowerCase();
    const trimmedWhatsapp = params.whatsapp.trim();

    if (trimmedUtr.length < 6) {
      throw new Error("UTR / Reference must be at least 6 characters.");
    }

    const order = this.orders.get(params.orderId);
    if (!order) throw new Error("Order not found.");
    if (order.status === "CANCELLED" || order.status === "REFUNDED") {
      throw new Error("Order is cancelled or refunded.");
    }
    if (order.status === "TICKETS_ISSUED") {
      throw new Error("Tickets have already been issued for this order.");
    }

    let payment = Array.from(this.payments.values()).find((p) => p.order_id === params.orderId);
    if (!payment) {
      const pid = crypto.randomUUID();
      payment = {
        id: pid,
        order_id: order.id,
        status: "PENDING",
        amount_paise: order.total_amount_paise,
        utr_reference: null,
        payer_name: null,
        submitted_at: null,
        verified_at: null,
        verified_by: null,
        rejection_reason: null,
      };
      this.payments.set(pid, payment);
    }

    if (payment.status === "VERIFIED") {
      throw new Error("Payment has already been verified and tickets issued.");
    }

    const wasSubmitted = payment.status === "SUBMITTED";

    // Duplicate UTR check across different payments
    for (const p of this.payments.values()) {
      if (p.id !== payment.id && p.utr_reference === trimmedUtr) {
        throw new Error("This Transaction ID / UTR has already been submitted for another order.");
      }
    }

    // Update customer email & whatsapp
    const customer = this.customers.get(order.customer_id);
    if (customer) {
      customer.email = trimmedEmail;
      customer.whatsapp_number = trimmedWhatsapp;
    }

    // Update payment
    const now = new Date();
    payment.status = "SUBMITTED";
    payment.utr_reference = trimmedUtr;
    payment.payer_name = params.payerName?.trim() || null;
    payment.submitted_at = now.toISOString();
    payment.rejection_reason = null;

    // Update order
    order.status = "PAYMENT_SUBMITTED";

    // Mark token used if provided
    if (params.tokenHash) {
      for (const t of this.tokens.values()) {
        if (t.token_hash === params.tokenHash) {
          t.used_at = now.toISOString();
        }
      }
    }

    // Audit log
    this.auditLogs.push({
      id: crypto.randomUUID(),
      actor_user_id: null,
      action: "PAYMENT_DETAILS_SUBMITTED",
      entity_type: "order",
      entity_id: order.id,
      metadata: {
        order_number: order.order_number,
        utr: trimmedUtr,
        email: trimmedEmail,
        whatsapp: trimmedWhatsapp,
        reopened: wasSubmitted,
        is_recovery: Boolean(params.tokenHash),
      },
      created_at: now.toISOString(),
    });

    return {
      success: true,
      order_id: order.id,
      order_number: order.order_number,
      status: "PAYMENT_SUBMITTED",
      reopened: wasSubmitted,
    };
  }

  verifyPaymentAndIssue(paymentId: string, actorId: string, actorRoles: string[]) {
    if (!actorRoles.some((r) => r === "SUPER_ADMIN" || r === "ADMIN" || r === "FUNDRAISING_MANAGER")) {
      throw new Error("administrator role required");
    }

    const payment = this.payments.get(paymentId);
    if (!payment || payment.status !== "SUBMITTED") {
      throw new Error("payment is not awaiting verification");
    }

    const order = this.orders.get(payment.order_id);
    if (!order || order.status !== "PAYMENT_SUBMITTED") {
      throw new Error("payment and order do not match");
    }

    const now = new Date();
    payment.status = "VERIFIED";
    payment.verified_at = now.toISOString();
    payment.verified_by = actorId;

    order.status = "TICKETS_ISSUED";

    // Issue tickets exactly once
    const issuedTickets: TicketModel[] = [];
    for (let i = 0; i < order.quantity; i++) {
      const ticketId = crypto.randomUUID();
      const ticketNumber = `SSFI-${String(this.tickets.size + 1).padStart(6, "0")}`;
      const ticket: TicketModel = {
        id: ticketId,
        order_id: order.id,
        ticket_number: ticketNumber,
        status: "ISSUED",
      };
      this.tickets.set(ticketId, ticket);
      issuedTickets.push(ticket);
    }

    this.auditLogs.push({
      id: crypto.randomUUID(),
      actor_user_id: actorId,
      action: "PAYMENT_VERIFIED",
      entity_type: "payment",
      entity_id: paymentId,
      metadata: { order_id: order.id, tickets_issued: issuedTickets.length },
      created_at: now.toISOString(),
    });

    return issuedTickets;
  }
}

// ============================================================================
// Test Suites
// ============================================================================

test("Suite 1: Cryptographic Token Security & Hashing Integrity", async (t) => {
  await t.test("generates 64-char hexadecimal token with high entropy", () => {
    const token = generateSecureRecoveryToken();
    assert.equal(token.length, 64);
    assert.match(token, /^[0-9a-f]{64}$/);

    const anotherToken = generateSecureRecoveryToken();
    assert.notEqual(token, anotherToken, "Tokens must be statistically unique");
  });

  await t.test("hashRecoveryToken produces deterministic SHA-256 hash", () => {
    const token = "a".repeat(64);
    const hash1 = hashRecoveryToken(token);
    const hash2 = hashRecoveryToken(token);
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);

    const expectedHash = crypto.createHash("sha256").update(token).digest("hex");
    assert.equal(hash1, expectedHash);
  });

  await t.test("isValidTokenFormat validates format and rejects malformed strings", () => {
    assert.equal(isValidTokenFormat(generateSecureRecoveryToken()), true);
    assert.equal(isValidTokenFormat("abc"), false);
    assert.equal(isValidTokenFormat(""), false);
    assert.equal(isValidTokenFormat("x".repeat(64)), false); // non-hex
    assert.equal(isValidTokenFormat(generateSecureRecoveryToken() + "0"), false); // 65 chars
  });

  await t.test("buildPaymentRecoveryUrl constructs URL without exposing order UUID, phone, or email", () => {
    const rawToken = generateSecureRecoveryToken();
    const url = buildPaymentRecoveryUrl("https://ssfiticket.vercel.app", rawToken);

    assert.equal(url, `https://ssfiticket.vercel.app/payment/complete/${rawToken}`);
    assert.doesNotMatch(url, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, "Must not contain UUID");
    assert.doesNotMatch(url, /@/, "Must not contain email");
    assert.doesNotMatch(url, /\+91/, "Must not contain phone");
  });

  await t.test("rate limiter blocks brute-force enumeration after excessive attempts", () => {
    const testIp = "test-token-identifier-" + Date.now();
    for (let i = 0; i < 20; i++) {
      const check = checkTokenRateLimit(testIp);
      assert.equal(check.allowed, true);
    }
    const blockedCheck = checkTokenRateLimit(testIp);
    assert.equal(blockedCheck.allowed, false);
    assert.ok((blockedCheck.retryAfterSeconds ?? 0) > 0);
  });
});

test("Suite 2: Customer Input Validation (UTR, Email, WhatsApp)", async (t) => {
  const validPayload = {
    orderId: "e24c02b9-d48c-4fc1-bd58-f02878bdfdcf",
    utr: "428172918291",
    email: "customer@example.com",
    whatsapp: "+918810366357",
  };

  await t.test("valid payload parses cleanly", () => {
    const res = paymentDetailsSchema.safeParse(validPayload);
    assert.equal(res.success, true);
  });

  await t.test("missing or short UTR is rejected", () => {
    const noUtr = paymentDetailsSchema.safeParse({ ...validPayload, utr: "" });
    assert.equal(noUtr.success, false);

    const shortUtr = paymentDetailsSchema.safeParse({ ...validPayload, utr: "12345" });
    assert.equal(shortUtr.success, false);
  });

  await t.test("UTR with invalid characters is rejected", () => {
    const invalidChars = paymentDetailsSchema.safeParse({ ...validPayload, utr: "UTR#1234@56" });
    assert.equal(invalidChars.success, false);
  });

  await t.test("missing or invalid email format is rejected", () => {
    const noEmail = paymentDetailsSchema.safeParse({ ...validPayload, email: "" });
    assert.equal(noEmail.success, false);

    const badEmail = paymentDetailsSchema.safeParse({ ...validPayload, email: "invalid-email" });
    assert.equal(badEmail.success, false);
  });

  await t.test("missing or invalid WhatsApp number is rejected", () => {
    const noWa = paymentDetailsSchema.safeParse({ ...validPayload, whatsapp: "" });
    assert.equal(noWa.success, false);

    const punctuationWa = paymentDetailsSchema.safeParse({ ...validPayload, whatsapp: "+-- -- --" });
    assert.equal(punctuationWa.success, false);

    const tooFewDigits = paymentDetailsSchema.safeParse({ ...validPayload, whatsapp: "+91 123" });
    assert.equal(tooFewDigits.success, false);
  });

  await t.test("valid international phone format is accepted and normalized", () => {
    const intlNumbers = ["+918810366357", "+91 98765 43210", "+1 (555) 234-5678", "9876543210"];
    for (const num of intlNumbers) {
      assert.equal(validateWhatsAppDigits(num), true);
      const res = paymentDetailsSchema.safeParse({ ...validPayload, whatsapp: num });
      assert.equal(res.success, true, `Expected ${num} to be accepted`);
    }
  });
});

test("Suite 3: UPI Payment Instructions & QR Presentation (Part A)", async (t) => {
  await t.test("builds official UPI intent URI with correct payee, amount and order reference", () => {
    const uri = buildUpiPaymentUri({
      payeeVpa: manualUpiConfig.upiId,
      payeeName: manualUpiConfig.displayName,
      amountPaise: 10000,
      orderNumber: "ORD-2026-000003",
    });

    assert.ok(uri.startsWith("upi://pay?"));
    const parsed = parseUpiPaymentUri(uri);
    assert.equal(parsed.payeeVpa, "6909251270@ptaxis");
    assert.equal(parsed.payeeName, "HLAWN THA DAWT");
    assert.equal(parsed.amount, "100.00");
    assert.equal(parsed.amountPaise, 10000);
    assert.equal(parsed.currency, "INR");
    assert.equal(parsed.transactionNote, "ORD-2026-000003");
  });

  await t.test("generates high-contrast QR data URL for mobile camera scanning", async () => {
    const uri = buildUpiPaymentUri({
      payeeVpa: manualUpiConfig.upiId,
      payeeName: manualUpiConfig.displayName,
      amountPaise: 10000,
      orderNumber: "ORD-2026-000003",
    });

    const qrDataUrl = await generateUpiQrDataUrl(uri, { width: 320 });
    assert.ok(qrDataUrl.startsWith("data:image/png;base64,"));
  });
});

test("Suite 4: Customer Details Submission & Verification State (Part B & D)", async (t) => {
  const db = new SimulatedDb();

  const customerId = crypto.randomUUID();
  db.customers.set(customerId, {
    id: customerId,
    full_name: "Test Buyer",
    phone: "+918810366357",
    whatsapp_number: null,
    email: null,
  });

  const orderId = crypto.randomUUID();
  db.orders.set(orderId, {
    id: orderId,
    order_number: "ORD-2026-100001",
    quantity: 2,
    total_amount_paise: 20000,
    status: "PENDING_PAYMENT",
    customer_id: customerId,
    seller_id: null,
  });

  const paymentId = crypto.randomUUID();
  db.payments.set(paymentId, {
    id: paymentId,
    order_id: orderId,
    status: "PENDING",
    amount_paise: 20000,
    utr_reference: null,
    payer_name: null,
    submitted_at: null,
    verified_at: null,
    verified_by: null,
    rejection_reason: null,
  });

  await t.test("UTR submission transitions payment to SUBMITTED and order to PAYMENT_SUBMITTED", () => {
    const res = db.submitPaymentDetailsCompletion({
      orderId,
      utr: "428172918291",
      email: "buyer@example.com",
      whatsapp: "+918810366357",
      payerName: "Test Buyer",
    });

    assert.equal(res.success, true);
    assert.equal(res.status, "PAYMENT_SUBMITTED");

    const order = db.orders.get(orderId);
    assert.equal(order?.status, "PAYMENT_SUBMITTED");

    const payment = db.payments.get(paymentId);
    assert.equal(payment?.status, "SUBMITTED");
    assert.equal(payment?.utr_reference, "428172918291");
    assert.ok(payment?.submitted_at !== null);

    const customer = db.customers.get(customerId);
    assert.equal(customer?.email, "buyer@example.com");
    assert.equal(customer?.whatsapp_number, "+918810366357");
  });

  await t.test("CRITICAL: UTR submission does NOT mark payment as VERIFIED or issue tickets", () => {
    const payment = db.payments.get(paymentId);
    assert.notEqual(payment?.status, "VERIFIED");
    assert.equal(payment?.verified_at, null);

    const tickets = Array.from(db.tickets.values()).filter((t) => t.order_id === orderId);
    assert.equal(tickets.length, 0, "No tickets should be issued before Admin verification");
  });

  await t.test("reopening unverified order allows customer to update details without creating duplicate payments", () => {
    const initialPaymentCount = db.payments.size;

    const res = db.submitPaymentDetailsCompletion({
      orderId,
      utr: "428172918999", // corrected UTR
      email: "corrected-buyer@example.com",
      whatsapp: "+919876543210",
      payerName: "Updated Name",
    });

    assert.equal(res.success, true);
    assert.equal(res.reopened, true);
    assert.equal(db.payments.size, initialPaymentCount, "Duplicate payment records must not be created");

    const payment = db.payments.get(paymentId);
    assert.equal(payment?.utr_reference, "428172918999");

    const customer = db.customers.get(customerId);
    assert.equal(customer?.email, "corrected-buyer@example.com");
    assert.equal(customer?.whatsapp_number, "+919876543210");
  });

  await t.test("duplicate UTR on a different order is strictly rejected", () => {
    const otherOrderId = crypto.randomUUID();
    const otherCustomerId = crypto.randomUUID();
    db.customers.set(otherCustomerId, {
      id: otherCustomerId,
      full_name: "Second Buyer",
      phone: "+919999999999",
      whatsapp_number: null,
      email: null,
    });
    db.orders.set(otherOrderId, {
      id: otherOrderId,
      order_number: "ORD-2026-100002",
      quantity: 1,
      total_amount_paise: 10000,
      status: "PENDING_PAYMENT",
      customer_id: otherCustomerId,
      seller_id: null,
    });

    assert.throws(
      () => {
        db.submitPaymentDetailsCompletion({
          orderId: otherOrderId,
          utr: "428172918999", // already used above
          email: "second@example.com",
          whatsapp: "+919999999999",
        });
      },
      /already been submitted for another order/,
      "Duplicate UTR across different orders must be blocked"
    );
  });
});

test("Suite 5: Admin Recovery Link Generation & RBAC Security (Part C & E)", async (t) => {
  const db = new SimulatedDb();

  const customerId = crypto.randomUUID();
  db.customers.set(customerId, {
    id: customerId,
    full_name: "Incomplete Buyer",
    phone: "+918810366357",
    whatsapp_number: null,
    email: null,
  });

  const orderId = crypto.randomUUID();
  db.orders.set(orderId, {
    id: orderId,
    order_number: "ORD-2026-000003",
    quantity: 1,
    total_amount_paise: 10000,
    status: "PENDING_PAYMENT",
    customer_id: customerId,
    seller_id: null,
  });

  const adminId = crypto.randomUUID();
  const sellerId = crypto.randomUUID();

  await t.test("unauthorized roles (SELLER, CUSTOMER) cannot generate recovery links", () => {
    const token = generateSecureRecoveryToken();
    const tokenHash = hashRecoveryToken(token);

    assert.throws(
      () => {
        db.createPaymentRecoveryLink(orderId, tokenHash, sellerId, ["SELLER"]);
      },
      /administrator role required/
    );
  });

  let activeRawToken = "";
  let activeTokenHash = "";

  await t.test("authorized SUPER_ADMIN can generate recovery link", () => {
    activeRawToken = generateSecureRecoveryToken();
    activeTokenHash = hashRecoveryToken(activeRawToken);

    const res = db.createPaymentRecoveryLink(orderId, activeTokenHash, adminId, ["SUPER_ADMIN"], 7);
    assert.equal(res.order_id, orderId);
    assert.ok(res.expires_at);

    // Verify lookup succeeds
    const lookup = db.lookupPaymentRecoveryToken(activeTokenHash);
    assert.equal(lookup.valid, true);
    assert.equal(lookup.order_number, "ORD-2026-000003");
    assert.equal(lookup.customer_phone, "+918810366357");
    assert.equal(lookup.customer_whatsapp, "+918810366357"); // prefilled suggested phone
  });

  await t.test("generating a new link revokes the older link for that order", () => {
    const newRawToken = generateSecureRecoveryToken();
    const newTokenHash = hashRecoveryToken(newRawToken);

    db.createPaymentRecoveryLink(orderId, newTokenHash, adminId, ["ADMIN"], 7);

    // Old token should now be rejected as REVOKED
    const oldLookup = db.lookupPaymentRecoveryToken(activeTokenHash);
    assert.equal(oldLookup.valid, false);
    assert.equal(oldLookup.status, "REVOKED");

    // New token is active
    const newLookup = db.lookupPaymentRecoveryToken(newTokenHash);
    assert.equal(newLookup.valid, true);

    activeRawToken = newRawToken;
    activeTokenHash = newTokenHash;
  });

  await t.test("revoking link by admin blocks customer access", () => {
    db.revokePaymentRecoveryLink(orderId, adminId, ["ADMIN"]);
    const lookup = db.lookupPaymentRecoveryToken(activeTokenHash);
    assert.equal(lookup.valid, false);
    assert.equal(lookup.status, "REVOKED");
  });

  await t.test("expired link is rejected", () => {
    const expToken = generateSecureRecoveryToken();
    const expHash = hashRecoveryToken(expToken);

    // Generate link with negative expiry to simulate expiration
    const res = db.createPaymentRecoveryLink(orderId, expHash, adminId, ["ADMIN"], -1);
    const lookup = db.lookupPaymentRecoveryToken(expHash);
    assert.equal(lookup.valid, false);
    assert.equal(lookup.status, "EXPIRED");
  });

  await t.test("cancelled order cannot generate or use recovery links", () => {
    const cancelOrderId = crypto.randomUUID();
    db.orders.set(cancelOrderId, {
      id: cancelOrderId,
      order_number: "ORD-2026-999999",
      quantity: 1,
      total_amount_paise: 10000,
      status: "CANCELLED",
      customer_id: customerId,
      seller_id: null,
    });

    assert.throws(
      () => {
        db.createPaymentRecoveryLink(cancelOrderId, hashRecoveryToken(generateSecureRecoveryToken()), adminId, ["ADMIN"]);
      },
      /cannot generate recovery link for cancelled or refunded order/
    );
  });
});

test("Suite 6: Admin Payment Verification & Transactional Ticket Issuance Flow", async (t) => {
  const db = new SimulatedDb();
  const customerId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const adminId = crypto.randomUUID();

  db.customers.set(customerId, {
    id: customerId,
    full_name: "Final Buyer",
    phone: "+918810366357",
    whatsapp_number: "+918810366357",
    email: "final@example.com",
  });

  db.orders.set(orderId, {
    id: orderId,
    order_number: "ORD-2026-200001",
    quantity: 3,
    total_amount_paise: 30000,
    status: "PENDING_PAYMENT",
    customer_id: customerId,
    seller_id: null,
  });

  // Step 1: Customer submits payment details
  db.submitPaymentDetailsCompletion({
    orderId,
    utr: "987654321012",
    email: "final@example.com",
    whatsapp: "+918810366357",
  });

  const payment = Array.from(db.payments.values()).find((p) => p.order_id === orderId)!;
  assert.equal(payment.status, "SUBMITTED");

  // Step 2: Admin verifies payment
  const issuedTickets = db.verifyPaymentAndIssue(payment.id, adminId, ["SUPER_ADMIN"]);

  assert.equal(issuedTickets.length, 3, "Must issue exactly 3 tickets");
  assert.equal(payment.status, "VERIFIED");
  assert.equal(db.orders.get(orderId)?.status, "TICKETS_ISSUED");

  // Step 3: Second verification attempt is idempotent or rejected
  assert.throws(
    () => {
      db.verifyPaymentAndIssue(payment.id, adminId, ["ADMIN"]);
    },
    /payment is not awaiting verification/,
    "Duplicate verification must be blocked"
  );
  assert.equal(db.tickets.size, 3, "No duplicate tickets must be issued");
});

test("Suite 7: Free WhatsApp Share Link & Audit Trail Integrity (Part F & G)", async (t) => {
  await t.test("buildWhatsAppRecoveryShareUrl formats complete click-to-chat link without paid API", () => {
    const rawToken = generateSecureRecoveryToken();
    const recoveryUrl = buildPaymentRecoveryUrl("https://ssfiticket.vercel.app", rawToken);

    const shareUrl = buildWhatsAppRecoveryShareUrl({
      phone: "+91 8810366357",
      orderNumber: "ORD-2026-000003",
      quantity: 1,
      totalAmountInr: 100,
      recoveryUrl,
      expiresAtIso: "2026-11-08T12:00:00.000Z",
    });

    assert.ok(shareUrl.startsWith("https://wa.me/918810366357?text="));
    const decoded = decodeURIComponent(shareUrl);
    assert.ok(decoded.includes("ORD-2026-000003"));
    assert.ok(decoded.includes("1 ticket"));
    assert.ok(decoded.includes("₹100"));
    assert.ok(decoded.includes(recoveryUrl));
    assert.ok(decoded.includes("Important: This link will expire"));
  });

  await t.test("audit logs record actions and timestamps without storing raw tokens", () => {
    const db = new SimulatedDb();
    const orderId = crypto.randomUUID();
    const adminId = crypto.randomUUID();

    db.orders.set(orderId, {
      id: orderId,
      order_number: "ORD-2026-000003",
      quantity: 1,
      total_amount_paise: 10000,
      status: "PENDING_PAYMENT",
      customer_id: crypto.randomUUID(),
      seller_id: null,
    });

    const rawToken = generateSecureRecoveryToken();
    const tokenHash = hashRecoveryToken(rawToken);

    db.createPaymentRecoveryLink(orderId, tokenHash, adminId, ["SUPER_ADMIN"]);

    // Verify audit log
    const log = db.auditLogs.find((l) => l.action === "PAYMENT_RECOVERY_LINK_GENERATED");
    assert.ok(log);
    assert.equal(log.actor_user_id, adminId);
    assert.equal(log.entity_id, orderId);

    // Verify raw token is NOT in metadata
    const metadataStr = JSON.stringify(log.metadata);
    assert.ok(!metadataStr.includes(rawToken), "Raw token must NEVER appear in audit log metadata");
  });
});

test("Suite 8: Final Requirement — Target Order ORD-2026-000003 Recovery Compatibility", async (t) => {
  const db = new SimulatedDb();

  // Recreate ORD-2026-000003 matching production state
  const customerId = crypto.randomUUID();
  db.customers.set(customerId, {
    id: customerId,
    full_name: "Van Chum Ceu",
    phone: "+918798409921",
    whatsapp_number: "+918798409921",
    email: "vanchumceu7@gmail.com",
  });

  const orderId = crypto.randomUUID();
  db.orders.set(orderId, {
    id: orderId,
    order_number: "ORD-2026-000003",
    quantity: 1,
    total_amount_paise: 10000,
    status: "PENDING_PAYMENT",
    customer_id: customerId,
    seller_id: null,
  });

  const paymentId = crypto.randomUUID();
  db.payments.set(paymentId, {
    id: paymentId,
    order_id: orderId,
    status: "PENDING",
    amount_paise: 10000,
    utr_reference: null,
    payer_name: null,
    submitted_at: null,
    verified_at: null,
    verified_by: null,
    rejection_reason: null,
  });

  const adminId = crypto.randomUUID();

  // Admin generates link for ORD-2026-000003
  const rawToken = generateSecureRecoveryToken();
  const tokenHash = hashRecoveryToken(rawToken);

  const linkRes = db.createPaymentRecoveryLink(orderId, tokenHash, adminId, ["SUPER_ADMIN"], 7);
  assert.equal(linkRes.order_number, "ORD-2026-000003");

  // Customer accesses link
  const lookup = db.lookupPaymentRecoveryToken(tokenHash);
  assert.equal(lookup.valid, true);
  assert.equal(lookup.order_number, "ORD-2026-000003");
  assert.equal(lookup.customer_name, "Van Chum Ceu");
  assert.equal(lookup.customer_phone, "+918798409921");
  assert.equal(lookup.customer_whatsapp, "+918798409921");

  // Customer completes details
  const submitRes = db.submitPaymentDetailsCompletion({
    orderId,
    utr: "428198765432",
    email: "vanchumceu7@gmail.com",
    whatsapp: "+918798409921",
    payerName: "Van Chum Ceu",
    tokenHash,
  });

  assert.equal(submitRes.success, true);
  assert.equal(submitRes.status, "PAYMENT_SUBMITTED");

  // Admin verifies payment and issues ticket
  const tickets = db.verifyPaymentAndIssue(paymentId, adminId, ["ADMIN"]);
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0]?.status, "ISSUED");
  assert.equal(db.orders.get(orderId)?.status, "TICKETS_ISSUED");
});
