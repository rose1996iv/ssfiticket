import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { formatWhatsAppPhoneNumber, buildWhatsAppClickToChatUrl } from "../src/lib/delivery/whatsappUrl.ts";
import { formatDeliveryStatusLabel } from "../src/lib/delivery/types.ts";
import { checkGmailPreviewGate, sanitizeOAuthError, sanitizeGmailApiError } from "../src/lib/delivery/providers/gmail.ts";
import { whatsappSchema, emailSchema, validateWhatsAppDigits } from "../src/lib/validation/contact.ts";
import type { DeliveryPayload } from "../src/lib/delivery/types.ts";

/**
 * Authoritative server-side Public and Seller order contact schema
 */
const contactSchema = z.object({
  name: z.string().trim().min(2, "Full name must be at least 2 characters.").max(120),
  whatsapp: whatsappSchema,
  email: emailSchema,
  quantity: z.coerce.number().int().min(1).max(100),
});

test("Phase 1: Mandatory Contact Validation — WhatsApp validation", async (t) => {
  await t.test("Missing WhatsApp number is rejected", () => {
    const res = contactSchema.safeParse({
      name: "John Doe",
      email: "john@example.com",
      quantity: 1,
    });
    assert.equal(res.success, false);
    assert.equal(res.error?.issues[0]?.path[0], "whatsapp");
  });

  await t.test("Blank or whitespace WhatsApp number is rejected", () => {
    const res = contactSchema.safeParse({
      name: "John Doe",
      whatsapp: "   ",
      email: "john@example.com",
      quantity: 1,
    });
    assert.equal(res.success, false);
    assert.equal(res.error?.issues[0]?.path[0], "whatsapp");
  });

  await t.test("Punctuation-only WhatsApp strings are strictly rejected", () => {
    const punctuationOnly = [
      "+-- -- --",
      "+ - - - - - -",
      "(---) --- ----",
      "+++++++",
      "+ - - () -",
      "---",
    ];
    for (const val of punctuationOnly) {
      const res = contactSchema.safeParse({
        name: "John Doe",
        whatsapp: val,
        email: "john@example.com",
        quantity: 1,
      });
      assert.equal(res.success, false, `Expected punctuation-only '${val}' to be rejected`);
      assert.equal(validateWhatsAppDigits(val), false);
    }
  });

  await t.test("WhatsApp numbers with fewer than 7 digits or more than 15 digits are rejected", () => {
    const invalidDigitCounts = [
      "+12345", // 5 digits
      "123456", // 6 digits
      "+91 123", // 5 digits
      "+1234567890123456", // 16 digits
      "+91 9123456789012345", // 18 digits
    ];
    for (const val of invalidDigitCounts) {
      const res = contactSchema.safeParse({
        name: "John Doe",
        whatsapp: val,
        email: "john@example.com",
        quantity: 1,
      });
      assert.equal(res.success, false, `Expected '${val}' to be rejected due to digit count constraint`);
      assert.equal(validateWhatsAppDigits(val), false);
    }
  });

  await t.test("Invalid characters in phone numbers are rejected", () => {
    const invalidChars = ["abc1234567", "+1234#5678", "phone-number", "918810366357@"];
    for (const num of invalidChars) {
      const res = contactSchema.safeParse({
        name: "John Doe",
        whatsapp: num,
        email: "john@example.com",
        quantity: 1,
      });
      assert.equal(res.success, false, `Expected ${num} to be rejected for invalid characters`);
    }
  });

  await t.test("Valid international WhatsApp numbers with calling codes and formatting are accepted", () => {
    const validNumbers = [
      "+91 88103 66357",
      "+918810366357",
      "+91-88103-66357",
      "+1 415 555 2671",
      "+1 (415) 555-2671",
      "+44 20 7946 0991",
      "+95 9 123 456 789",
      "918810366357",
      "08810366357",
      "8810366357",
      "+65 9123 4567",
    ];
    for (const num of validNumbers) {
      const res = contactSchema.safeParse({
        name: "John Doe",
        whatsapp: num,
        email: "john@example.com",
        quantity: 1,
      });
      assert.equal(res.success, true, `Expected ${num} to be accepted, error: ${res.error?.message}`);
      assert.equal(validateWhatsAppDigits(num), true);
    }
  });

  await t.test("WhatsApp phone normalization formats international and domestic numbers", () => {
    // 10-digit Indian
    assert.equal(formatWhatsAppPhoneNumber("8810366357"), "918810366357");
    // 11-digit leading zero Indian
    assert.equal(formatWhatsAppPhoneNumber("08810366357"), "918810366357");
    // Already prefixed with 91
    assert.equal(formatWhatsAppPhoneNumber("+91 88103 66357"), "918810366357");
    // US international (+1)
    assert.equal(formatWhatsAppPhoneNumber("+1 415 555 2671"), "14155552671");
    // UK international (+44)
    assert.equal(formatWhatsAppPhoneNumber("+44 20 7946 0991"), "442079460991");
  });
});

test("Phase 1: Mandatory Contact Validation — Email validation", async (t) => {
  await t.test("Missing Email is rejected", () => {
    const res = contactSchema.safeParse({
      name: "John Doe",
      whatsapp: "+91 88103 66357",
      quantity: 1,
    });
    assert.equal(res.success, false);
    assert.equal(res.error?.issues[0]?.path[0], "email");
  });

  await t.test("Blank or whitespace-only Email is rejected", () => {
    const res = contactSchema.safeParse({
      name: "John Doe",
      whatsapp: "+91 88103 66357",
      email: "    ",
      quantity: 1,
    });
    assert.equal(res.success, false);
    assert.match(res.error?.issues[0]?.message || "", /Email/i);
  });

  await t.test("Malformed Email syntax is rejected", () => {
    const invalidEmails = ["notanemail", "user@", "@domain.com", "user@domain", "user@.com"];
    for (const email of invalidEmails) {
      const res = contactSchema.safeParse({
        name: "John Doe",
        whatsapp: "+91 88103 66357",
        email,
        quantity: 1,
      });
      assert.equal(res.success, false, `Expected ${email} to be rejected`);
    }
  });

  await t.test("Valid Email is normalized to lowercase and trimmed", () => {
    const res = contactSchema.safeParse({
      name: "John Doe",
      whatsapp: "+91 88103 66357",
      email: "  John.Doe@EXAMPLE.COM  ",
      quantity: 1,
    });
    assert.equal(res.success, true);
    assert.equal(res.data?.email, "john.doe@example.com");
  });
});

test("Phase 2: Delivery & Gmail API Verification", async (t) => {
  await t.test("Preview Gate blocks non-allowlisted customer emails fail-closed", () => {
    // Simulate Preview environment with an authorized test recipient
    const prevVercelEnv = process.env.VERCEL_ENV;
    const prevRealSend = process.env.GMAIL_PREVIEW_REAL_SEND_ENABLED;
    const prevAllowed = process.env.GMAIL_PREVIEW_ALLOWED_RECIPIENT;
    const prevClientId = process.env.GMAIL_API_CLIENT_ID;
    const prevClientSecret = process.env.GMAIL_API_CLIENT_SECRET;
    const prevRefreshToken = process.env.GMAIL_API_REFRESH_TOKEN;

    try {
      process.env.VERCEL_ENV = "preview";
      process.env.GMAIL_PREVIEW_REAL_SEND_ENABLED = "true";
      process.env.GMAIL_PREVIEW_ALLOWED_RECIPIENT = "authorized-tester@example.com";
      process.env.GMAIL_API_CLIENT_ID = "mock-preview-client-id";
      process.env.GMAIL_API_CLIENT_SECRET = "mock-preview-client-secret";
      process.env.GMAIL_API_REFRESH_TOKEN = "mock-preview-refresh-token";

      // Non-matching customer email
      const gate = checkGmailPreviewGate("random.customer@gmail.com", true);
      assert.equal(gate.isPermitted, false);
      assert.match(gate.reason, /does not match GMAIL_PREVIEW_ALLOWED_RECIPIENT/i);

      // Unauthorized caller (not staff)
      const unauthGate = checkGmailPreviewGate("authorized-tester@example.com", false);
      assert.equal(unauthGate.isPermitted, false);
      assert.match(unauthGate.reason, /requires verified ADMIN or SUPER_ADMIN/i);

      // Authorized staff + matching recipient
      const authGate = checkGmailPreviewGate("authorized-tester@example.com", true);
      assert.equal(authGate.isPermitted, true);
    } finally {
      process.env.VERCEL_ENV = prevVercelEnv;
      process.env.GMAIL_PREVIEW_REAL_SEND_ENABLED = prevRealSend;
      process.env.GMAIL_PREVIEW_ALLOWED_RECIPIENT = prevAllowed;
      process.env.GMAIL_API_CLIENT_ID = prevClientId;
      process.env.GMAIL_API_CLIENT_SECRET = prevClientSecret;
      process.env.GMAIL_API_REFRESH_TOKEN = prevRefreshToken;
    }
  });

  await t.test("Delivery status labels accurately reflect semantics without false claims", () => {
    assert.equal(formatDeliveryStatusLabel("PENDING", "EMAIL"), "Email Queued");
    assert.equal(formatDeliveryStatusLabel("PENDING", "WHATSAPP"), "Click-to-Chat Prepared");
    assert.equal(formatDeliveryStatusLabel("WHATSAPP_LINK_OPENED"), "WhatsApp Link Opened");
    assert.equal(formatDeliveryStatusLabel("MANUALLY_SENT"), "Manually Confirmed Sent");
    assert.equal(formatDeliveryStatusLabel("SENT"), "API Accepted");
    assert.equal(formatDeliveryStatusLabel("DELIVERED"), "Delivery Confirmed");
    assert.equal(formatDeliveryStatusLabel("SIMULATED"), "Simulated (Preview Test)");
    assert.equal(formatDeliveryStatusLabel("FAILED"), "Failed");
  });

  await t.test("Sanitizes OAuth and API errors without leaking tokens or client secrets", () => {
    const errorWithSecret = "Error at https://oauth2.googleapis.com?client_secret=supersecrettoken123&code=401";
    const sanitized = sanitizeOAuthError(errorWithSecret);
    assert.ok(!sanitized.includes("supersecrettoken123"));
    assert.ok(sanitized.includes("[REDACTED]"));

    const apiError = "Bearer ya29.a0AfH6SMDI5039284239840239 expired";
    const sanitizedApi = sanitizeGmailApiError(401, apiError);
    assert.ok(!sanitizedApi.includes("ya29.a0AfH6SMDI5039284239840239"));
  });
});

test("Phase 3: WhatsApp Click-to-Chat Free Integration", async (t) => {
  await t.test("buildWhatsAppClickToChatUrl constructs accurate free wa.me URL without exposing UTR", () => {
    const payload: DeliveryPayload = {
      orderId: "order-12345",
      orderNumber: "ORD-2026-000001",
      customerName: "Alice Smith",
      whatsappNumber: "+91 88103 66357",
      email: "alice@example.com",
      ticketNumbers: ["SSFI-000001", "SSFI-000002"],
      amountInr: 200,
      campaignName: "SSFI Lucky Draw",
      issuedAtIst: "30 Oct 2026, 06:30 PM IST",
      ticketAccessUrl: "https://ssfiticket.vercel.app/buy/order/order-12345",
      sellerAttribution: "Seller Alpha (SELLER-001)",
      supportEmail: "Senthangstudents@gmail.com",
    };

    const { url, recipientPhone, messageText } = buildWhatsAppClickToChatUrl(payload);

    assert.equal(recipientPhone, "918810366357");
    assert.ok(url.startsWith("https://wa.me/918810366357?text="));
    assert.ok(messageText.includes("Alice Smith"));
    assert.ok(messageText.includes("ORD-2026-000001"));
    assert.ok(messageText.includes("SSFI-000001"));
    assert.ok(messageText.includes("SSFI-000002"));
    assert.ok(messageText.includes("https://ssfiticket.vercel.app/buy/order/order-12345"));
    assert.ok(!messageText.includes("utr_reference"));
    assert.ok(!messageText.includes("payment_id"));
  });
});

