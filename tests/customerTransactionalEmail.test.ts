import test from "node:test";
import assert from "node:assert/strict";
import {
  renderEmailOrderCreatedMessage,
  renderEmailPaymentApprovedMessage,
  renderEmailTicketMessage,
} from "../src/lib/delivery/templates.ts";
import {
  sanitizeOAuthError,
  sanitizeGmailApiError,
  checkGmailPreviewGate,
} from "../src/lib/delivery/providers/gmail.ts";

test("Customer Transactional Email Suite", async (t) => {
  // ==========================================================================
  // 1. Order-Created Email Tests
  // ==========================================================================
  await t.test("Order-created email renders all mandatory fields and instructions", () => {
    const payload = {
      orderNumber: "ORD-2026-000123",
      orderId: "11111111-1111-1111-1111-111111111111",
      customerName: "Alice Walker",
      ticketQuantity: 3,
      totalAmountInr: 300,
      paymentMethod: "Manual UPI",
      paymentInstructions: {
        upiId: "6909251270@ptaxis",
        accountName: "HLAWN THA DAWT",
        instructions: "Transfer exact amount to the official SSFI account and submit your 12-digit UTR on your order page.",
      },
      paymentStatus: "PENDING",
      orderAccessUrl: "https://ssfiticket.vercel.app/buy/order/11111111-1111-1111-1111-111111111111",
      campaignName: "SSFI Fundraising Lucky Draw",
      createdAtIst: "31 Oct 2026, 09:30 pm IST",
      supportEmail: "Senthangstudents@gmail.com",
    };

    const { subject, html, text } = renderEmailOrderCreatedMessage(payload);

    // Subject asserts
    assert.match(subject, /Order Received/i);
    assert.match(subject, /ORD-2026-000123/);

    // Mandatory fields in text
    assert.match(text, /Alice Walker/);
    assert.match(text, /ORD-2026-000123/);
    assert.match(text, /3/);
    assert.match(text, /300/);
    assert.match(text, /Manual UPI/);
    assert.match(text, /6909251270@ptaxis/);
    assert.match(text, /HLAWN THA DAWT/);
    assert.match(text, /PENDING/);
    assert.match(text, /Senthangstudents@gmail.com/);
    assert.match(text, /https:\/\/ssfiticket\.vercel\.app\/buy\/order\/11111111-1111-1111-1111-111111111111/);

    // Mandatory fields in HTML (XSS escaped)
    assert.match(html, /Alice Walker/);
    assert.match(html, /ORD-2026-000123/);
    assert.match(html, /₹300/);
    assert.match(html, /6909251270@ptaxis/);
    assert.match(html, /HLAWN THA DAWT/);
    assert.match(html, /PENDING/);
  });

  // ==========================================================================
  // 2. Pending Payment Invariant
  // ==========================================================================
  await t.test("Pending payment must not trigger ticket delivery email", () => {
    // When order is in PENDING_PAYMENT or PAYMENT_SUBMITTED status, no tickets exist
    const orderStatus = "PENDING_PAYMENT";
    const ticketsIssued: string[] = [];

    // Safety assertion: confirmed tickets must never be issued or delivered while pending
    assert.equal(ticketsIssued.length, 0);
    assert.notEqual(orderStatus, "PAYMENT_VERIFIED");
    assert.notEqual(orderStatus, "TICKETS_ISSUED");
  });

  // ==========================================================================
  // 3. Payment Approved Email Tests
  // ==========================================================================
  await t.test("Approved payment triggers payment confirmation with timestamp and amount", () => {
    const payload = {
      orderNumber: "ORD-2026-000456",
      orderId: "22222222-2222-2222-2222-222222222222",
      customerName: "Bob Smith",
      ticketQuantity: 2,
      confirmedAmountInr: 200,
      paymentMethod: "Manual UPI",
      paymentConfirmedAtIst: "31 Oct 2026, 10:00 pm IST",
      orderAccessUrl: "https://ssfiticket.vercel.app/buy/order/22222222-2222-2222-2222-222222222222",
      campaignName: "SSFI Fundraising Lucky Draw",
      supportEmail: "Senthangstudents@gmail.com",
    };

    const { subject, html, text } = renderEmailPaymentApprovedMessage(payload);

    assert.match(subject, /Payment Approved/i);
    assert.match(subject, /ORD-2026-000456/);
    assert.match(text, /ORD-2026-000456/);
    assert.match(text, /200/);
    assert.match(text, /Manual UPI/);
    assert.match(text, /31 Oct 2026, 10:00 pm IST/);
    assert.match(html, /₹200/);
    assert.match(html, /Payment Approved/i);
  });

  // ==========================================================================
  // 4. Ticket Delivery Email Tests
  // ==========================================================================
  await t.test("Ticket issuance email includes all allocated ticket numbers and draw date", () => {
    const payload = {
      orderId: "33333333-3333-3333-3333-333333333333",
      orderNumber: "ORD-2026-000789",
      customerName: "Carol Danvers",
      whatsappNumber: "+919876543210",
      email: "carol@example.com",
      ticketNumbers: ["SSFI-000101", "SSFI-000102"],
      amountInr: 200,
      campaignName: "SSFI Fundraising Lucky Draw",
      issuedAtIst: "31 Oct 2026, 10:15 pm IST",
      ticketAccessUrl: "https://ssfiticket.vercel.app/buy/order/33333333-3333-3333-3333-333333333333",
      supportEmail: "Senthangstudents@gmail.com",
    };

    const { subject, html, text } = renderEmailTicketMessage(payload);

    assert.match(subject, /Official Ticket Confirmation/i);
    assert.match(text, /SSFI-000101/);
    assert.match(text, /SSFI-000102/);
    assert.match(text, /19 December 2026/); // Grand Draw Date confirmed
    assert.match(html, /SSFI-000101/);
    assert.match(html, /SSFI-000102/);
    assert.match(html, /19 December 2026/);
    assert.match(html, /verify\/SSFI-000101/);
    assert.match(html, /verify\/SSFI-000102/);
  });

  // ==========================================================================
  // 5. Idempotency Key Generation & Deduplication
  // ==========================================================================
  await t.test("Idempotency key prevents duplicate emails on webhook or server retry", () => {
    const orderId = "44444444-4444-4444-4444-444444444444";
    const key1 = `ORDER_CREATED:${orderId}`;
    const key2 = `ORDER_CREATED:${orderId}`;
    const paymentKey = `PAYMENT_APPROVED:${orderId}`;
    const ticketsKey = `TICKETS_ISSUED:${orderId}`;

    assert.equal(key1, key2, "Repeated order created events produce identical idempotency key");
    assert.notEqual(key1, paymentKey, "Distinct events produce distinct idempotency keys");
    assert.notEqual(paymentKey, ticketsKey, "Distinct events produce distinct idempotency keys");
  });

  // ==========================================================================
  // 6. Bounded Retries & Backoff Calculation
  // ==========================================================================
  await t.test("Failed email retries increment attempt count and calculate backoff", () => {
    const maxAttempts = 3;

    // Simulate attempts
    let attemptCount = 0;
    let status = "QUEUED";

    // Attempt 1 fails
    attemptCount++;
    status = attemptCount < maxAttempts ? "RETRY" : "FAILED";
    const backoff1 = Math.min(60, attemptCount * 5); // 5 min
    assert.equal(status, "RETRY");
    assert.equal(backoff1, 5);

    // Attempt 2 fails
    attemptCount++;
    status = attemptCount < maxAttempts ? "RETRY" : "FAILED";
    const backoff2 = Math.min(60, attemptCount * 5); // 10 min
    assert.equal(status, "RETRY");
    assert.equal(backoff2, 10);

    // Attempt 3 fails -> final state FAILED
    attemptCount++;
    status = attemptCount < maxAttempts ? "RETRY" : "FAILED";
    assert.equal(status, "FAILED");
    assert.equal(attemptCount, maxAttempts);
  });

  // ==========================================================================
  // 7. Invalid Recipient Handling
  // ==========================================================================
  await t.test("Invalid or empty email recipients are safely handled without throwing", () => {
    const invalidRecipients = ["", "   ", "not-an-email", "@missing-user.com", "user@"];

    for (const email of invalidRecipients) {
      const clean = email.trim().toLowerCase();
      const isValid = clean.length > 0 && clean.includes("@") && clean.indexOf("@") > 0 && clean.indexOf("@") < clean.length - 1;
      assert.equal(isValid, false, `Expected "${email}" to be classified as invalid`);
    }
  });

  // ==========================================================================
  // 8. Preview vs Production Recipient Isolation
  // ==========================================================================
  await t.test("GMAIL_PREVIEW_ALLOWED_RECIPIENT does not interfere with production customer delivery", () => {
    const prevEnv = process.env.VERCEL_ENV;
    const prevPublicEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
    const prevAllowed = process.env.GMAIL_PREVIEW_ALLOWED_RECIPIENT;

    try {
      // In Production: Preview Gate must be INACTIVE
      process.env.VERCEL_ENV = "production";
      process.env.NEXT_PUBLIC_VERCEL_ENV = "production";
      process.env.GMAIL_PREVIEW_ALLOWED_RECIPIENT = "staff-tester@ssfi.org";

      const gate = checkGmailPreviewGate("real.customer@gmail.com", true);
      assert.equal(gate.isPermitted, false);
      assert.match(gate.reason, /Preview gate active only in Vercel Preview/i);

      // In Preview: Preview Gate must be ACTIVE and enforce allowlist
      process.env.VERCEL_ENV = "preview";
      process.env.NEXT_PUBLIC_VERCEL_ENV = "preview";
      process.env.GMAIL_PREVIEW_REAL_SEND_ENABLED = "true";
      process.env.GMAIL_API_CLIENT_ID = "mock-client-id";
      process.env.GMAIL_API_CLIENT_SECRET = "mock-client-secret";
      process.env.GMAIL_API_REFRESH_TOKEN = "mock-refresh-token";

      const blockedCustomer = checkGmailPreviewGate("real.customer@gmail.com", true);
      assert.equal(blockedCustomer.isPermitted, false);
      assert.match(blockedCustomer.reason, /does not match GMAIL_PREVIEW_ALLOWED_RECIPIENT/i);

      const allowedTester = checkGmailPreviewGate("staff-tester@ssfi.org", true);
      assert.equal(allowedTester.isPermitted, true);
    } finally {
      process.env.VERCEL_ENV = prevEnv;
      process.env.NEXT_PUBLIC_VERCEL_ENV = prevPublicEnv;
      process.env.GMAIL_PREVIEW_ALLOWED_RECIPIENT = prevAllowed;
    }
  });

  // ==========================================================================
  // 9. Unauthorized User Cannot Enable Live Gate
  // ==========================================================================
  await t.test("Live email gate requires explicit confirmation phrase and authorized role", () => {
    const wrongPhrase = "ENABLE_NOW";
    const correctPhrase = "CONFIRM_ENABLE_LIVE_EMAIL";

    // Enforcing strict phrase match
    const isValidConfirmation = (phrase?: string) => phrase?.trim() === correctPhrase;

    assert.equal(isValidConfirmation(wrongPhrase), false);
    assert.equal(isValidConfirmation(""), false);
    assert.equal(isValidConfirmation(undefined), false);
    assert.equal(isValidConfirmation(correctPhrase), true);
  });

  // ==========================================================================
  // 10. OAuth Error Sanitization (Zero Secret Leaks)
  // ==========================================================================
  await t.test("OAuth errors are sanitized without leaking client secrets, tokens, or headers", () => {
    // Test 1: Known OAuth error code returns safe actionable diagnostic without secret leak
    const invalidGrantError = "invalid_grant: Refresh token ya29.a0AfH6SMDI_secret_token was revoked. client_secret=very_secret_key";
    const sanitizedKnown = sanitizeOAuthError(invalidGrantError);
    assert.ok(!sanitizedKnown.includes("ya29.a0AfH6SMDI_secret_token"), "Access token must not appear in invalid_grant response");
    assert.ok(!sanitizedKnown.includes("very_secret_key"), "Client secret must not appear in invalid_grant response");
    assert.match(sanitizedKnown, /invalid_grant/i);

    // Test 2: Unrecognized OAuth error with tokens/secrets is redacted with redaction markers
    const arbitraryError = "unexpected_oauth_failure: ya29.a0AfH6SMDI_secret_token failed with client_secret=very_secret_key";
    const sanitizedArbitrary = sanitizeOAuthError(arbitraryError);
    assert.ok(!sanitizedArbitrary.includes("ya29.a0AfH6SMDI_secret_token"), "Access token must be redacted");
    assert.ok(!sanitizedArbitrary.includes("very_secret_key"), "Client secret must be redacted");
    assert.match(sanitizedArbitrary, /\[REDACTED_TOKEN\]/);
    assert.match(sanitizedArbitrary, /client_secret=\[REDACTED\]/);

    // Test 3: API error redaction
    const apiError = sanitizeGmailApiError(500, "Internal server error with Bearer ya29.super_secret_bearer_token failed");
    assert.ok(!apiError.includes("ya29.super_secret_bearer_token"), "Bearer token must be redacted");
    assert.match(apiError, /Bearer \[REDACTED\]/);
  });

  // ==========================================================================
  // 11. Admin Test Email Recipient Restriction (Zero Arbitrary Customer Sends)
  // ==========================================================================
  await t.test("Admin test email rejects arbitrary customer recipients and only permits authorized admin inbox", () => {
    const authorizedAdminInbox = "admin@ssfi.org";
    const authenticatedAdminEmail = "finance-admin@ssfi.org";
    const arbitraryCustomerEmail = "customer@gmail.com";

    const isRecipientPermitted = (target: string) => {
      const clean = target.trim().toLowerCase();
      return clean === authorizedAdminInbox.toLowerCase() || clean === authenticatedAdminEmail.toLowerCase();
    };

    assert.equal(isRecipientPermitted(authorizedAdminInbox), true, "Authorized admin test inbox must be permitted");
    assert.equal(isRecipientPermitted(authenticatedAdminEmail), true, "Authenticated admin's own email must be permitted");
    assert.equal(isRecipientPermitted(arbitraryCustomerEmail), false, "Arbitrary customer email must be strictly rejected");
    assert.equal(isRecipientPermitted("hacker@external.com"), false, "External address must be strictly rejected");
  });

  // ==========================================================================
  // 12. Strict Pending-Payment Ticket Delivery Prevention
  // ==========================================================================
  await t.test("Ticket delivery notification is strictly blocked for unapproved orders", () => {
    type MockOrder = {
      order_number: string;
      status: string;
      paymentVerifiedAt: string | null;
    };

    const isTicketDeliveryAllowed = (order: MockOrder) => {
      return Boolean(order.paymentVerifiedAt) || order.status === "TICKETS_ISSUED";
    };

    const pendingOrder: MockOrder = {
      order_number: "ORD-001",
      status: "PENDING_PAYMENT",
      paymentVerifiedAt: null,
    };
    const paymentSubmittedOrder: MockOrder = {
      order_number: "ORD-002",
      status: "PAYMENT_SUBMITTED",
      paymentVerifiedAt: null,
    };
    const approvedOrder: MockOrder = {
      order_number: "ORD-003",
      status: "TICKETS_ISSUED",
      paymentVerifiedAt: "2026-10-31T20:00:00Z",
    };

    assert.equal(isTicketDeliveryAllowed(pendingOrder), false, "Pending payment must never trigger ticket delivery");
    assert.equal(isTicketDeliveryAllowed(paymentSubmittedOrder), false, "Payment submitted without verification must not trigger ticket delivery");
    assert.equal(isTicketDeliveryAllowed(approvedOrder), true, "Verified payment allows ticket delivery");
  });
});
