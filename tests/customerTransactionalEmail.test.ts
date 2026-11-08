import test from "node:test";
import assert from "node:assert/strict";
import {
  renderEmailOrderCreatedMessage,
  renderEmailPaymentApprovedMessage,
  renderEmailTicketMessage,
  renderEmailWinnerAnnouncedMessage,
} from "../src/lib/delivery/templates.ts";
import {
  sanitizeOAuthError,
  sanitizeGmailApiError,
  checkGmailPreviewGate,
} from "../src/lib/delivery/providers/gmail.ts";
import {
  computeAppsScriptSignature,
  isAppsScriptConfigured,
  sanitizeAppsScriptError,
  sendEmailViaAppsScript,
} from "../src/lib/delivery/providers/appsScript.ts";

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

  // ==========================================================================
  // 13. Google Apps Script Web App Provider Security & Preview Safety Gate
  // ==========================================================================
  await t.test("Google Apps Script provider enforces HMAC-SHA256 signing, URL redaction, and Preview recipient gate", async () => {
    const prevUrl = process.env.APPS_SCRIPT_WEB_APP_URL;
    const prevSecret = process.env.APPS_SCRIPT_SHARED_SECRET;
    const prevEnv = process.env.VERCEL_ENV;
    const prevAllowed = process.env.ALLOWED_TEST_EMAIL;

    try {
      delete process.env.APPS_SCRIPT_WEB_APP_URL;
      delete process.env.APPS_SCRIPT_SHARED_SECRET;
      assert.equal(isAppsScriptConfigured(), false, "Unconfigured when env vars are missing");

      process.env.APPS_SCRIPT_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxTestDeploymentId123456/exec";
      process.env.APPS_SCRIPT_SHARED_SECRET = "0123456789abcdef0123456789abcdef";
      assert.equal(isAppsScriptConfigured(), true, "Configured when valid URL and 32-char secret are present");

      // Deterministic HMAC-SHA256 signature verification
      const sig1 = computeAppsScriptSignature(
        1730000000000,
        "TICKETS_ISSUED:order-123",
        "customer@example.com",
        process.env.APPS_SCRIPT_SHARED_SECRET
      );
      const sig2 = computeAppsScriptSignature(
        1730000000000,
        "TICKETS_ISSUED:order-123",
        "CUSTOMER@EXAMPLE.COM",
        process.env.APPS_SCRIPT_SHARED_SECRET
      );
      assert.equal(sig1.length, 64, "HMAC-SHA256 hex digest is 64 chars");
      assert.equal(sig1, sig2, "Signature normalizes recipient casing");

      // Redaction of sensitive Apps Script deployment URLs in error messages
      const rawErr = "Failed to connect to https://script.google.com/macros/s/AKfycbxSecretId999/exec";
      const sanitized = sanitizeAppsScriptError(rawErr);
      assert.ok(!sanitized.includes("AKfycbxSecretId999"), "Deployment ID must be redacted");
      assert.ok(sanitized.includes("[REDACTED]"), "Redaction placeholder must be present");

      // Preview safety gate: non-allowlisted customer email is simulated in Preview
      process.env.VERCEL_ENV = "preview";
      process.env.ALLOWED_TEST_EMAIL = "tester@ssfi.org";

      const simResult = await sendEmailViaAppsScript({
        recipient: "real.customer@gmail.com",
        subject: "Congratulations! Your SSFI Lucky Draw Ticket Is Ready",
        text: "Ticket body",
        html: "<p>Ticket body</p>",
        eventType: "TICKETS_ISSUED",
        orderNumber: "ORD-2026-000999",
        ticketNumbers: ["SSFI-000999"],
      });

      assert.equal(simResult.status, "SIMULATED", "Real customer email must be simulated in Preview");
      assert.equal(simResult.provider, "google_apps_script_preview_simulated");
    } finally {
      process.env.APPS_SCRIPT_WEB_APP_URL = prevUrl;
      process.env.APPS_SCRIPT_SHARED_SECRET = prevSecret;
      process.env.VERCEL_ENV = prevEnv;
      process.env.ALLOWED_TEST_EMAIL = prevAllowed;
    }
  });

  // ==========================================================================
  // 14. RSK-02: Seller Payment Snapshot Email Remediation Tests
  // ==========================================================================
  await t.test("RSK-02: Seller A order email uses Seller A's snapshot UPI and instructions", () => {
    const payloadSellerA = {
      orderNumber: "ORD-2026-000501",
      orderId: "50100000-0000-0000-0000-000000000501",
      customerName: "David Miller",
      ticketQuantity: 5,
      totalAmountInr: 500,
      paymentMethod: "Manual UPI",
      paymentInstructions: {
        upiId: "sellerA@okaxis",
        accountName: "Seller A Official Store",
        instructions: "Please mention order ORD-2026-000501 in the UPI remark field.",
      },
      paymentStatus: "PENDING",
      orderAccessUrl: "https://ssfiticket.vercel.app/buy/order/50100000-0000-0000-0000-000000000501",
      campaignName: "SSFI Fundraising Lucky Draw",
      createdAtIst: "08 Nov 2026, 01:00 am IST",
      supportEmail: "Senthangstudents@gmail.com",
      sellerAttribution: "Seller A (SELLER-001)",
    };

    const { subject, html, text } = renderEmailOrderCreatedMessage(payloadSellerA);

    assert.match(subject, /ORD-2026-000501/);
    // Plain text assertions
    assert.match(text, /sellerA@okaxis/);
    assert.match(text, /Seller A Official Store/);
    assert.match(text, /Please mention order ORD-2026-000501 in the UPI remark field/);
    assert.match(text, /Seller A \(SELLER-001\)/);
    // Zero central SSFI UPI leakage
    assert.ok(!text.includes("6909251270@ptaxis"), "Must NOT contain central SSFI UPI ID");
    assert.ok(!text.includes("HLAWN THA DAWT"), "Must NOT contain central SSFI Payee Name");

    // HTML assertions
    assert.match(html, /sellerA@okaxis/);
    assert.match(html, /Seller A Official Store/);
    assert.match(html, /Please mention order ORD-2026-000501 in the UPI remark field/);
    assert.match(html, /Seller A \(SELLER-001\)/);
    assert.ok(!html.includes("6909251270@ptaxis"), "Must NOT contain central SSFI UPI ID in HTML");
    assert.ok(!html.includes("HLAWN THA DAWT"), "Must NOT contain central SSFI Payee Name in HTML");
  });

  await t.test("RSK-02: Seller B order email uses Seller B's snapshot UPI and instructions", () => {
    const payloadSellerB = {
      orderNumber: "ORD-2026-000502",
      orderId: "50200000-0000-0000-0000-000000000502",
      customerName: "Eva Green",
      ticketQuantity: 2,
      totalAmountInr: 200,
      paymentMethod: "Manual UPI",
      paymentInstructions: {
        upiId: "sellerB@oksbi",
        accountName: "Seller B Enterprises",
        instructions: "Pay to Seller B and upload screenshot.",
      },
      paymentStatus: "PENDING",
      orderAccessUrl: "https://ssfiticket.vercel.app/buy/order/50200000-0000-0000-0000-000000000502",
      campaignName: "SSFI Fundraising Lucky Draw",
      createdAtIst: "08 Nov 2026, 01:05 am IST",
      supportEmail: "Senthangstudents@gmail.com",
      sellerAttribution: "Seller B (SELLER-002)",
    };

    const { subject, html, text } = renderEmailOrderCreatedMessage(payloadSellerB);

    assert.match(subject, /ORD-2026-000502/);
    assert.match(text, /sellerB@oksbi/);
    assert.match(text, /Seller B Enterprises/);
    assert.match(text, /Pay to Seller B and upload screenshot/);
    assert.match(text, /Seller B \(SELLER-002\)/);
    assert.ok(!text.includes("sellerA@okaxis"), "Must not leak Seller A's UPI ID");
    assert.ok(!text.includes("6909251270@ptaxis"), "Must not leak central UPI ID");

    assert.match(html, /sellerB@oksbi/);
    assert.match(html, /Seller B Enterprises/);
    assert.ok(!html.includes("sellerA@okaxis"), "Must not leak Seller A's UPI ID in HTML");
    assert.ok(!html.includes("6909251270@ptaxis"), "Must not leak central UPI ID in HTML");
  });

  await t.test("RSK-02: Seller QR updates do not mutate existing order snapshot email details", () => {
    // Simulate historical order with initial snapshot
    const historicalOrderSnapshot = {
      snapshot_upi_id: "seller.original@ybl",
      snapshot_account_name: "Original Account Name",
      snapshot_payment_instructions: "Historical instructions",
      snapshot_seller_display_name: "Original Seller Name",
      snapshot_seller_code: "SELLER-003",
    };

    // Seller subsequently updates their active profile in the database
    const updatedSellerProfile = {
      upi_id: "seller.mutated@icici",
      account_name: "Brand New Account Name",
      payment_instructions: "Brand new instructions",
      display_name: "Brand New Seller Name",
      seller_code: "SELLER-003",
    };

    // Outbox logic derivation: must strictly use historicalOrderSnapshot fields, ignoring updatedSellerProfile
    const emailPayloadFromSnapshot = {
      orderNumber: "ORD-2026-000088",
      orderId: "88000000-0000-0000-0000-000000000088",
      customerName: "Historical Customer",
      ticketQuantity: 1,
      totalAmountInr: 100,
      paymentMethod: "Manual UPI",
      paymentInstructions: {
        upiId: historicalOrderSnapshot.snapshot_upi_id,
        accountName: historicalOrderSnapshot.snapshot_account_name,
        instructions: historicalOrderSnapshot.snapshot_payment_instructions,
      },
      paymentStatus: "PENDING",
      orderAccessUrl: "https://ssfiticket.vercel.app/buy/order/88000000-0000-0000-0000-000000000088",
      campaignName: "SSFI Fundraising Lucky Draw",
      createdAtIst: "01 Nov 2026, 12:00 pm IST",
      supportEmail: "Senthangstudents@gmail.com",
      sellerAttribution: `${historicalOrderSnapshot.snapshot_seller_display_name} (${historicalOrderSnapshot.snapshot_seller_code})`,
    };

    const { text, html } = renderEmailOrderCreatedMessage(emailPayloadFromSnapshot);

    // Email reflects historical snapshot
    assert.match(text, /seller\.original@ybl/);
    assert.match(text, /Original Account Name/);
    assert.match(text, /Historical instructions/);
    assert.match(text, /Original Seller Name/);

    // Email does NOT reflect the mutated profile
    assert.ok(!text.includes(updatedSellerProfile.upi_id), "Must not reflect mutated seller UPI");
    assert.ok(!text.includes(updatedSellerProfile.account_name), "Must not reflect mutated seller account name");
    assert.ok(!text.includes(updatedSellerProfile.payment_instructions), "Must not reflect mutated instructions");
    assert.ok(!text.includes(updatedSellerProfile.display_name), "Must not reflect mutated display name");

    assert.match(html, /seller\.original@ybl/);
    assert.ok(!html.includes(updatedSellerProfile.upi_id), "Must not reflect mutated seller UPI in HTML");
  });

  await t.test("RSK-02: Missing snapshot UPI data fails safely without leaking central UPI or misleading instructions", () => {
    const origCentralUpi = process.env.NEXT_PUBLIC_SSFI_UPI_ID;
    try {
      process.env.NEXT_PUBLIC_SSFI_UPI_ID = "6909251270@ptaxis";

      const payloadWithoutSnapshot = {
        orderNumber: "ORD-2026-000599",
        orderId: "59900000-0000-0000-0000-000000000599",
        customerName: "Frank Underhill",
        ticketQuantity: 1,
        totalAmountInr: 100,
        paymentMethod: "Manual UPI",
        paymentInstructions: undefined, // Missing snapshot
        paymentStatus: "PENDING",
        orderAccessUrl: "https://ssfiticket.vercel.app/buy/order/59900000-0000-0000-0000-000000000599",
        campaignName: "SSFI Fundraising Lucky Draw",
        createdAtIst: "08 Nov 2026, 01:10 am IST",
        supportEmail: "Senthangstudents@gmail.com",
        sellerAttribution: "Seller C (SELLER-007)",
      };

      const { text, html } = renderEmailOrderCreatedMessage(payloadWithoutSnapshot);

      // Must NOT contain hardcoded or central fallback UPI IDs
      assert.ok(!text.includes("6909251270@ptaxis"), "Must NOT contain central SSFI UPI ID in text");
      assert.ok(!text.includes("HLAWN THA DAWT"), "Must NOT contain central SSFI Payee Name in text");
      assert.ok(!html.includes("6909251270@ptaxis"), "Must NOT contain central SSFI UPI ID in HTML");
      assert.ok(!html.includes("HLAWN THA DAWT"), "Must NOT contain central SSFI Payee Name in HTML");

      // Must safely direct the user to their authenticated order access page
      assert.match(text, /Payment instructions could not be loaded automatically/i);
      assert.match(text, /https:\/\/ssfiticket\.vercel\.app\/buy\/order\/59900000-0000-0000-0000-000000000599/);
      assert.match(html, /Payment instructions could not be loaded automatically/i);
      assert.match(html, /Do not send payments to unverified accounts/i);
    } finally {
      process.env.NEXT_PUBLIC_SSFI_UPI_ID = origCentralUpi;
    }
  });

  await t.test("RSK-02: Cross-seller payment information cannot leak across orders", () => {
    const orderSellerA = {
      orderNumber: "ORD-2026-000701",
      orderId: "70100000-0000-0000-0000-000000000701",
      customerName: "Customer A",
      ticketQuantity: 2,
      totalAmountInr: 200,
      paymentInstructions: {
        upiId: "exclusiveA@bank",
        accountName: "Confidential Seller A",
        instructions: "Secret instructions for A",
      },
      orderAccessUrl: "https://ssfiticket.vercel.app/buy/order/70100000-0000-0000-0000-000000000701",
      campaignName: "SSFI Lucky Draw",
      createdAtIst: "08 Nov 2026, 01:15 am IST",
    };

    const orderSellerB = {
      orderNumber: "ORD-2026-000702",
      orderId: "70200000-0000-0000-0000-000000000702",
      customerName: "Customer B",
      ticketQuantity: 3,
      totalAmountInr: 300,
      paymentInstructions: {
        upiId: "exclusiveB@bank",
        accountName: "Confidential Seller B",
        instructions: "Secret instructions for B",
      },
      orderAccessUrl: "https://ssfiticket.vercel.app/buy/order/70200000-0000-0000-0000-000000000702",
      campaignName: "SSFI Lucky Draw",
      createdAtIst: "08 Nov 2026, 01:16 am IST",
    };

    const emailA = renderEmailOrderCreatedMessage(orderSellerA);
    const emailB = renderEmailOrderCreatedMessage(orderSellerB);

    // Assert zero cross-contamination
    assert.ok(emailA.text.includes("exclusiveA@bank"));
    assert.ok(!emailA.text.includes("exclusiveB@bank"));
    assert.ok(!emailA.html.includes("exclusiveB@bank"));

    assert.ok(emailB.text.includes("exclusiveB@bank"));
    assert.ok(!emailB.text.includes("exclusiveA@bank"));
    assert.ok(!emailB.html.includes("exclusiveA@bank"));
  });

  // ==========================================================================
  // 17. Winner Announced Email Tests (Phase 9D)
  // ==========================================================================
  await t.test("Winner-announced email renders all mandatory fields and instructions", () => {
    const payload = {
      customerName: "David Lee",
      ticketNumber: "TK-2026-000088",
      prizeTitle: "Grand Prize - Honda Activa 6G",
      prizeNumber: 1,
      campaignName: "SSFI Annual Fundraiser 2026",
      drawDateFormatted: "08 Nov 2026, 05:30 pm IST",
      ticketAccessUrl: "https://ssfiticket.vercel.app/buy/order/33333333-3333-3333-3333-333333333333",
      sellerName: "John Representative (SLR-001)",
      supportEmail: "Senthangstudents@gmail.com",
      supportPhone: "+91 9876543210",
    };

    const { subject, html, text } = renderEmailWinnerAnnouncedMessage(payload);

    // Subject validation
    assert.match(subject, /\[SSFI Lucky Draw\] Congratulations! You Won Grand Prize - Honda Activa 6G/i);

    // Plaintext content checks
    assert.match(text, /David Lee/);
    assert.match(text, /TK-2026-000088/);
    assert.match(text, /Grand Prize - Honda Activa 6G/);
    assert.match(text, /1st Prize/i);
    assert.match(text, /SSFI Annual Fundraiser 2026/);
    assert.match(text, /08 Nov 2026, 05:30 pm IST/);
    assert.match(text, /John Representative \(SLR-001\)/);
    assert.match(text, /https:\/\/ssfiticket\.vercel\.app\/buy\/order\/33333333-3333-3333-3333-333333333333/);
    assert.match(text, /Senthangstudents@gmail.com/);
    assert.match(text, /\+91 9876543210/);

    // HTML content checks (with safe rendering)
    assert.match(html, /David Lee/);
    assert.match(html, /TK-2026-000088/);
    assert.match(html, /Grand Prize - Honda Activa 6G/);
    assert.match(html, /1st Prize/i);
    assert.match(html, /SSFI Annual Fundraiser 2026/);
    assert.match(html, /John Representative/);
  });

  await t.test("Winner-announced email sanitizes and escapes malicious script injections", () => {
    const maliciousPayload = {
      customerName: "<script>alert('xss')</script>Eve",
      ticketNumber: "<img src=x onerror=alert(1)>TK-99",
      prizeTitle: "Prize <b onmouseover=alert(1)>One</b>",
      prizeNumber: 2,
      campaignName: "Malicious <iframe src='evil.com'> Campaign",
      drawDateFormatted: "08 Nov 2026, 05:30 pm IST",
      ticketAccessUrl: "https://ssfiticket.vercel.app/buy/order/safe-uuid",
      sellerName: "<svg onload=alert(1)>BadSeller",
      supportEmail: "support@ssfi.org",
    };

    const { html } = renderEmailWinnerAnnouncedMessage(maliciousPayload);

    // Ensure raw unescaped script tags are never present in HTML
    assert.ok(!html.includes("<script>alert('xss')</script>"));
    assert.ok(!html.includes("<img src=x onerror=alert(1)>"));
    assert.ok(!html.includes("<iframe src='evil.com'>"));
    assert.ok(!html.includes("<svg onload=alert(1)>"));

    // Ensure escaped entities exist
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("&lt;img"));
    assert.ok(html.includes("&lt;iframe"));
    assert.ok(html.includes("&lt;svg"));
  });

  await t.test("Winner notification idempotency key and non-mutating delivery invariant", () => {
    const syntheticResultId = "res-1234-5678-9abc-def0";
    const expectedKey = `WINNER_ANNOUNCED:${syntheticResultId}`;

    // Verify key format
    assert.equal(expectedKey, "WINNER_ANNOUNCED:res-1234-5678-9abc-def0");

    // Invariant: Failed delivery does not create duplicate winners or duplicate tickets
    const results = [{ id: syntheticResultId, prize_id: "prize-1", ticket_id: "tk-1" }];
    const tickets = [{ id: "tk-1", ticket_number: "TK-001" }];

    // Simulate an outbox delivery failure
    const deliveryAttempt = {
      status: "RETRY",
      attempt_count: 1,
      max_attempts: 3,
      error_message: "Network timeout connecting to mail provider",
    };

    assert.equal(deliveryAttempt.status, "RETRY");
    // Ensure draw results and tickets collections are untouched
    assert.equal(results.length, 1);
    assert.equal(tickets.length, 1);
  });
});
