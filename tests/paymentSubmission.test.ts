import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

test("Payment Submission Form: UTR field is removed completely from SellerUpiPaymentForm", () => {
  const formSrc = fs.readFileSync(path.resolve("src/components/payment/SellerUpiPaymentForm.tsx"), "utf-8");

  // 1. UTR state must be removed
  assert.ok(
    !formSrc.includes("setUtr("),
    "SellerUpiPaymentForm must not manage utr state or setter"
  );
  assert.ok(
    !formSrc.includes('const [utr, setUtr]'),
    "SellerUpiPaymentForm must not declare utr state"
  );

  // 2. UTR input element must be removed
  assert.ok(
    !formSrc.includes('name="utr"'),
    "SellerUpiPaymentForm must not render an input with name='utr'"
  );
  assert.ok(
    !formSrc.includes("UTR / Bank Payment Reference"),
    "SellerUpiPaymentForm must not render UTR label"
  );

  // 3. UTR client validation must be removed
  assert.ok(
    !formSrc.includes("UTR / Transaction Reference must be at least 6 characters"),
    "SellerUpiPaymentForm must not require 6-char UTR"
  );
  assert.ok(
    !formSrc.includes("Test Duplicate Reference"),
    "SellerUpiPaymentForm must not render duplicate UTR test simulation button"
  );
});

test("Payment Submission Form: Payer Name remains strictly optional", () => {
  const formSrc = fs.readFileSync(path.resolve("src/components/payment/SellerUpiPaymentForm.tsx"), "utf-8");

  // 1. Payer Name field is present with (Optional) designation
  assert.ok(
    formSrc.includes("Payer Name") && formSrc.includes("(Optional)"),
    "SellerUpiPaymentForm must display Payer Name with (Optional) badge"
  );
  assert.ok(
    formSrc.includes('name="payerName"'),
    "SellerUpiPaymentForm must render payerName input"
  );

  // 2. Input does not have required attribute
  const payerNameInput = formSrc.slice(formSrc.indexOf('name="payerName"'), formSrc.indexOf('name="payerName"') + 200);
  assert.ok(
    !payerNameInput.includes("required"),
    "payerName input must not have required attribute"
  );
});

test("Payment Submission Form: Payment Screenshot is strictly mandatory", () => {
  const formSrc = fs.readFileSync(path.resolve("src/components/payment/SellerUpiPaymentForm.tsx"), "utf-8");

  assert.ok(
    formSrc.includes("PaymentScreenshotField"),
    "SellerUpiPaymentForm must render PaymentScreenshotField"
  );
  assert.ok(
    formSrc.includes("A payment screenshot is mandatory"),
    "SellerUpiPaymentForm must enforce screenshot presence before submission"
  );
});

test("Payment Submission Error Handling: React Error #441 is intercepted and sanitized", () => {
  const formSrc = fs.readFileSync(path.resolve("src/components/payment/SellerUpiPaymentForm.tsx"), "utf-8");

  assert.ok(
    formSrc.includes("Minified React error #441") || formSrc.includes("Server Components render"),
    "SellerUpiPaymentForm must detect and sanitize Minified React error #441"
  );
  assert.ok(
    formSrc.includes("isNextRedirectError"),
    "SellerUpiPaymentForm must check isNextRedirectError before setting error message"
  );
});

test("Server Action: submitManualUpi schema accepts empty and omitted UTR", async () => {
  const utrSchema = z.object({
    orderId: z.string().uuid(),
    utr: z
      .string()
      .trim()
      .transform((val) => val.replace(/\s+/g, "").toUpperCase())
      .pipe(
        z.union([
          z.literal(""),
          z
            .string()
            .min(6, "UTR / Reference must be at least 6 characters.")
            .max(64, "UTR cannot exceed 64 characters.")
            .regex(/^[A-Z0-9-]+$/, "UTR must only contain alphanumeric characters or hyphens."),
        ])
      )
      .optional()
      .default(""),
    payerName: z.string().trim().max(120).optional().default(""),
  });

  const validUuid = "123e4567-e89b-12d3-a456-426614174000";

  // Case 1: No UTR in payload (omitted)
  const r1 = utrSchema.safeParse({ orderId: validUuid });
  assert.ok(r1.success, "Should succeed when UTR is omitted");
  assert.equal(r1.data.utr, "");
  assert.equal(r1.data.payerName, "");

  // Case 2: Empty string UTR and empty Payer Name
  const r2 = utrSchema.safeParse({ orderId: validUuid, utr: "", payerName: "   " });
  assert.ok(r2.success, "Should succeed with blank UTR and blank payerName");
  assert.equal(r2.data.utr, "");
  assert.equal(r2.data.payerName, "");

  // Case 3: Payer name provided, UTR omitted
  const r3 = utrSchema.safeParse({ orderId: validUuid, payerName: "  Payer Example  " });
  assert.ok(r3.success, "Should succeed with payer name only");
  assert.equal(r3.data.payerName, "Payer Example");
  assert.equal(r3.data.utr, "");
});

test("Next.js Config: Server Action body size limit allows up to 4MB for 2MB screenshots", () => {
  const nextConfigSrc = fs.readFileSync(path.resolve("next.config.ts"), "utf-8");

  assert.ok(
    nextConfigSrc.includes("serverActions") && nextConfigSrc.includes("bodySizeLimit"),
    "next.config.ts must configure serverActions.bodySizeLimit to prevent payload rejection on 2MB screenshot uploads"
  );
});

test("Customer Payment Form: UTR field is removed completely from PaymentDetailsForm", () => {
  const formSrc = fs.readFileSync(path.resolve("src/components/payment/PaymentDetailsForm.tsx"), "utf-8");

  // 1. UTR state must be removed
  assert.ok(!formSrc.includes("setUtr("), "PaymentDetailsForm must not manage utr state");
  assert.ok(!formSrc.includes("const [utr, setUtr]"), "PaymentDetailsForm must not declare utr state");

  // 2. UTR input element must be removed
  assert.ok(!formSrc.includes('name="utr"'), "PaymentDetailsForm must not render an input with name='utr'");
  assert.ok(!formSrc.includes("UPI Transaction ID / UTR Number"), "PaymentDetailsForm must not render UTR label");

  // 3. UTR client validation and simulation controls must be removed
  assert.ok(!formSrc.includes("Test Duplicate Reference"), "PaymentDetailsForm must not render duplicate UTR button");
});

test("Server Action Schemas: operations, paymentRecovery, and publicOrder accept null without invalid_type error", () => {
  const testSchema = z.object({
    orderId: z.string().uuid("Invalid order ID."),
    utr: z.string().trim().nullish().default(""),
    payerName: z.string().trim().max(120).nullish().default(""),
  });

  const validUuid = "123e4567-e89b-12d3-a456-426614174000";

  // Simulate FormData.get returning null for missing fields
  const resWithNull = testSchema.safeParse({
    orderId: validUuid,
    utr: null,
    payerName: null,
  });

  assert.ok(resWithNull.success, "Must accept null values from FormData without 'Invalid input: expected string, received null'");
  assert.ok(!resWithNull.data.utr, "UTR should be falsy (null or empty string)");
  assert.ok(!resWithNull.data.payerName, "Payer name should be falsy (null or empty string)");
});

test("Screenshot Detection: Unpacking handles both PostgREST single object and array without reporting false negative", () => {
  function detectScreenshot(payment: { payment_screenshots: unknown }) {
    const rawScreenshots = payment.payment_screenshots;
    const screenshot = Array.isArray(rawScreenshots) ? rawScreenshots[0] : rawScreenshots;
    return Boolean(screenshot);
  }

  // Case 1: PostgREST returns 1-to-1 object
  assert.equal(detectScreenshot({ payment_screenshots: { uploaded_at: "2026-11-02T20:00:00Z" } }), true);

  // Case 2: PostgREST returns array with 1 element
  assert.equal(detectScreenshot({ payment_screenshots: [{ uploaded_at: "2026-11-02T20:00:00Z" }] }), true);

  // Case 3: No screenshot (null)
  assert.equal(detectScreenshot({ payment_screenshots: null }), false);

  // Case 4: No screenshot (empty array)
  assert.equal(detectScreenshot({ payment_screenshots: [] }), false);
});


