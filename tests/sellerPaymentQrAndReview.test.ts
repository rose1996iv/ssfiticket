import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  MAX_SELLER_PAYMENT_QR_BYTES,
  validateSellerPaymentQr,
} from "../src/lib/payment/sellerQr.ts";

type FileLike = Pick<File, "size" | "type">;

function mockFile(type: string, size: number): File {
  return { type, size } as FileLike as File;
}

test("Seller Payment QR validation accepts JPEG, PNG, and WebP signatures", () => {
  // JPEG magic bytes: FF D8 FF
  assert.deepEqual(
    validateSellerPaymentQr(mockFile("image/jpeg", 3), new Uint8Array([0xff, 0xd8, 0xff])),
    { contentType: "image/jpeg", extension: "jpg" }
  );

  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  assert.deepEqual(
    validateSellerPaymentQr(
      mockFile("image/png", 8),
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    ),
    { contentType: "image/png", extension: "png" }
  );

  // WebP magic bytes: RIFF....WEBP
  assert.deepEqual(
    validateSellerPaymentQr(
      mockFile("image/webp", 12),
      new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    ),
    { contentType: "image/webp", extension: "webp" }
  );
});

test("Seller Payment QR validation rejects unsupported, empty, oversized, and spoofed files", () => {
  // Unsupported MIME type
  assert.throws(
    () => validateSellerPaymentQr(mockFile("image/svg+xml", 10), new Uint8Array(10)),
    /JPEG, PNG, or WebP/
  );

  // Empty file (0 bytes)
  assert.throws(
    () => validateSellerPaymentQr(mockFile("image/png", 0), new Uint8Array()),
    /2 MB or smaller/
  );

  // Oversized file (> 2MB)
  assert.throws(
    () =>
      validateSellerPaymentQr(
        mockFile("image/png", MAX_SELLER_PAYMENT_QR_BYTES + 1),
        new Uint8Array(8)
      ),
    /2 MB or smaller/
  );

  // Spoofed file (MIME says PNG, signature is JPEG)
  assert.throws(
    () =>
      validateSellerPaymentQr(
        mockFile("image/png", 8),
        new Uint8Array([0xff, 0xd8, 0xff])
      ),
    /does not match/
  );

  // Spoofed file (MIME says WebP, signature is HTML)
  assert.throws(
    () =>
      validateSellerPaymentQr(
        mockFile("image/webp", 12),
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x48, 0x54, 0x4d, 0x4c])
      ),
    /does not match/
  );
});

test("Payment Completion Schema: accepts empty/omitted UTR and Payer Name", async () => {
  const { z } = await import("zod");
  const { emailSchema, whatsappSchema } = await import("../src/lib/validation/contact.ts");

  // Re-create the completion schema matching paymentRecovery.ts
  const schema = z.object({
    orderId: z.string().uuid(),
    token: z.string().trim().optional(),
    utr: z
      .string()
      .trim()
      .transform((val) => val.replace(/\s+/g, "").toUpperCase())
      .pipe(
        z.union([
          z.literal(""),
          z
            .string()
            .min(6, "UTR / Transaction Reference must be at least 6 characters.")
            .max(32, "UTR cannot exceed 32 characters.")
            .regex(/^[A-Z0-9-]+$/, "UTR must only contain alphanumeric characters or hyphens."),
        ])
      )
      .optional()
      .default(""),
    email: emailSchema,
    whatsapp: whatsappSchema,
    payerName: z
      .string()
      .trim()
      .max(120, "Payer name cannot exceed 120 characters.")
      .optional()
      .default(""),
  });

  const validUuid = "123e4567-e89b-12d3-a456-426614174000";

  // Case 1: No UTR and no Payer Name provided -> should succeed
  const result1 = schema.safeParse({
    orderId: validUuid,
    email: "customer@example.com",
    whatsapp: "+919876543210",
  });
  assert.ok(result1.success, "Should succeed with omitted UTR and Payer Name");
  assert.equal(result1.data.utr, "");
  assert.equal(result1.data.payerName, "");

  // Case 2: Empty string UTR and Payer Name -> should succeed
  const result2 = schema.safeParse({
    orderId: validUuid,
    utr: "   ",
    payerName: "   ",
    email: "customer@example.com",
    whatsapp: "+919876543210",
  });
  assert.ok(result2.success, "Should succeed with blank UTR and Payer Name");
  assert.equal(result2.data.utr, "");
  assert.equal(result2.data.payerName, "");

  // Case 3: Valid UTR and Payer Name provided -> should succeed and normalize
  const result3 = schema.safeParse({
    orderId: validUuid,
    utr: "upi12345678",
    payerName: "John Doe",
    email: "customer@example.com",
    whatsapp: "+919876543210",
  });
  assert.ok(result3.success, "Should succeed with valid UTR");
  assert.equal(result3.data.utr, "UPI12345678");
  assert.equal(result3.data.payerName, "John Doe");

  // Case 4: Invalid short UTR provided -> should fail
  const result4 = schema.safeParse({
    orderId: validUuid,
    utr: "12345", // too short
    email: "customer@example.com",
    whatsapp: "+919876543210",
  });
  assert.equal(result4.success, false, "Should reject short UTR if provided");

  // Case 5: Invalid special chars in UTR -> should fail
  const result5 = schema.safeParse({
    orderId: validUuid,
    utr: "UTR#$*&!12345",
    email: "customer@example.com",
    whatsapp: "+919876543210",
  });
  assert.equal(result5.success, false, "Should reject special characters in UTR");

  // Case 6: Missing mandatory email -> should fail
  const result6 = schema.safeParse({
    orderId: validUuid,
    whatsapp: "+919876543210",
  });
  assert.equal(result6.success, false, "Should require mandatory email");

  // Case 7: Missing mandatory WhatsApp -> should fail
  const result7 = schema.safeParse({
    orderId: validUuid,
    email: "customer@example.com",
  });
  assert.equal(result7.success, false, "Should require mandatory WhatsApp");
});

test("Seller Payment Review validation schema rules", async () => {
  const { z } = await import("zod");

  const VALID_REVIEW_STATUSES = [
    "RECOMMENDED_APPROVAL",
    "RECOMMENDED_REJECTION",
    "FLAGGED_DISCREPANCY",
  ] as const;

  const reviewSchema = z.object({
    paymentId: z.string().uuid("Invalid payment ID."),
    reviewStatus: z.enum(VALID_REVIEW_STATUSES),
    reviewNote: z
      .string()
      .trim()
      .max(500, "Review note cannot exceed 500 characters.")
      .optional()
      .default(""),
  });

  const validUuid = "123e4567-e89b-12d3-a456-426614174000";

  // Valid statuses
  assert.ok(
    reviewSchema.safeParse({
      paymentId: validUuid,
      reviewStatus: "RECOMMENDED_APPROVAL",
    }).success
  );
  assert.ok(
    reviewSchema.safeParse({
      paymentId: validUuid,
      reviewStatus: "RECOMMENDED_REJECTION",
      reviewNote: "Screenshot shows wrong recipient",
    }).success
  );
  assert.ok(
    reviewSchema.safeParse({
      paymentId: validUuid,
      reviewStatus: "FLAGGED_DISCREPANCY",
      reviewNote: "Amount transferred is ₹50 instead of ₹100",
    }).success
  );

  // Invalid status
  assert.equal(
    reviewSchema.safeParse({
      paymentId: validUuid,
      reviewStatus: "APPROVED", // only RECOMMENDED_* allowed for sellers
    }).success,
    false
  );

  // Note exceeds 500 chars
  assert.equal(
    reviewSchema.safeParse({
      paymentId: validUuid,
      reviewStatus: "RECOMMENDED_APPROVAL",
      reviewNote: "a".repeat(501),
    }).success,
    false
  );
});

test("Terms and Conditions: includes seller-owned QR, mandatory screenshot, and advisory review clauses", () => {
  const termsPath = path.resolve("src/app/(public)/terms/page.tsx");
  const code = fs.readFileSync(termsPath, "utf-8");

  // Seller-owned QR system
  assert.ok(
    code.includes("Seller-Owned Payment QR") || code.includes("Seller-Owned Payment Accounts"),
    "Terms must document Seller-Owned QR system"
  );
  assert.ok(
    code.includes("Immutable Order Payment Snapshot"),
    "Terms must document immutable payment snapshot"
  );

  // Mandatory screenshot
  assert.ok(
    code.includes("Mandatory Payment Screenshot Proof") || code.includes("Mandatory Payment Screenshot Verification"),
    "Terms must document mandatory payment screenshot"
  );

  // Optional UTR & Payer Name
  assert.ok(
    code.includes("Optional UTR") || code.includes("optional helper fields"),
    "Terms must document optional UTR reference"
  );

  // Two-tier review workflow
  assert.ok(
    code.includes("Two-Tier Review System") || code.includes("Two-Tier Payment Review Workflow"),
    "Terms must document two-tier review workflow"
  );
  assert.ok(
    code.includes("Intermediate Seller Review (Advisory)"),
    "Terms must specify seller review is advisory"
  );
  assert.ok(
    code.includes("SSFI Administrator Final Verification (Authoritative)"),
    "Terms must specify Admin verification is authoritative"
  );

  // Privacy & security
  assert.ok(
    code.includes("Privacy, Screenshot Storage & Data Security") || code.includes("Privacy, Screenshot Storage &amp; Data Security"),
    "Terms must document storage privacy and security"
  );
});


test("Fix 1 and Fix 3: Seller QR Enforcement in Order Creation Actions", () => {
  const publicOrderSrc = fs.readFileSync(path.resolve("src/server/actions/publicOrder.ts"), "utf-8");
  const operationsSrc = fs.readFileSync(path.resolve("src/server/actions/operations.ts"), "utf-8");

  // In publicOrder.ts
  assert.ok(
    publicOrderSrc.includes("!seller.is_qr_active || !seller.qr_storage_path"),
    "publicOrder.ts must reject order creation if seller QR is inactive or missing"
  );
  assert.ok(
    publicOrderSrc.includes("snapshot_qr_storage_path: seller.qr_storage_path"),
    "publicOrder.ts must capture snapshot_qr_storage_path on orders"
  );

  // In operations.ts
  assert.ok(
    operationsSrc.includes("!seller.is_qr_active || !seller.qr_storage_path"),
    "operations.ts must reject createSale if seller QR is inactive or missing"
  );
  assert.ok(
    operationsSrc.includes("snapshot_qr_storage_path: seller.qr_storage_path"),
    "operations.ts must capture snapshot_qr_storage_path on orders"
  );
});

test("Fix 2 and Fix 3: Mandatory Screenshot Server-Side Enforcement", () => {
  const paymentRecoverySrc = fs.readFileSync(path.resolve("src/server/actions/paymentRecovery.ts"), "utf-8");
  const publicOrderSrc = fs.readFileSync(path.resolve("src/server/actions/publicOrder.ts"), "utf-8");
  const operationsSrc = fs.readFileSync(path.resolve("src/server/actions/operations.ts"), "utf-8");
  const migrationSrc = fs.readFileSync(path.resolve("supabase/migrations/202611020001_seller_qr_and_mandatory_screenshots.sql"), "utf-8");

  // Verify server actions enforce screenshot check in payment_screenshots table
  assert.ok(
    paymentRecoverySrc.includes("payment_screenshots") && paymentRecoverySrc.includes("A payment screenshot is mandatory"),
    "paymentRecovery.ts must verify screenshot before calling completion RPC"
  );
  assert.ok(
    publicOrderSrc.includes("payment_screenshots") && publicOrderSrc.includes("A payment screenshot is mandatory"),
    "publicOrder.ts must verify screenshot before calling submit_manual_upi RPC"
  );
  assert.ok(
    operationsSrc.includes("payment_screenshots") && operationsSrc.includes("A payment screenshot is mandatory"),
    "operations.ts must verify screenshot before calling submit_manual_upi RPC"
  );

  // Verify database RPCs enforce screenshot check in SQL
  assert.ok(
    migrationSrc.includes("SELECT 1 FROM public.payment_screenshots WHERE payment_id = v_payment.id"),
    "Migration must enforce mandatory screenshot check inside submit_payment_details_completion"
  );
  assert.ok(
    migrationSrc.includes("CREATE OR REPLACE FUNCTION public.submit_manual_upi"),
    "Migration must update submit_manual_upi RPC with screenshot check"
  );
  assert.ok(
    migrationSrc.includes("public.submit_manual_upi") &&
    migrationSrc.includes("LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS"),
    "Migration must harden submit_manual_upi to SET search_path = ''"
  );
});

test("Fix 4: Payment Destination Snapshot Immutability Trigger in SQL", () => {
  const migration1Src = fs.readFileSync(path.resolve("supabase/migrations/202611020001_seller_qr_and_mandatory_screenshots.sql"), "utf-8");
  const migration2Src = fs.readFileSync(path.resolve("supabase/migrations/202611020002_protect_all_order_snapshot_fields.sql"), "utf-8");

  for (const [name, migrationSrc] of [["202611020001", migration1Src], ["202611020002", migration2Src]]) {
    assert.ok(
      migrationSrc.includes("protect_order_payment_snapshot"),
      `${name} must define protect_order_payment_snapshot trigger function`
    );
    assert.ok(
      migrationSrc.includes("BEFORE UPDATE ON public.orders"),
      `${name} must attach BEFORE UPDATE trigger to orders table`
    );
    assert.ok(
      migrationSrc.includes("OLD.snapshot_captured_at IS NOT NULL"),
      `${name} must permit initial capture and lock subsequent updates`
    );
    assert.ok(
      migrationSrc.includes("Order payment destination snapshot is immutable and cannot be modified"),
      `${name} must throw error upon attempted tampering`
    );

    // Verify all 8 payment destination snapshot fields are explicitly protected
    const requiredFields = [
      "snapshot_seller_id",
      "snapshot_seller_code",
      "snapshot_seller_display_name",
      "snapshot_qr_storage_path",
      "snapshot_upi_id",
      "snapshot_account_name",
      "snapshot_payment_instructions",
      "snapshot_captured_at",
    ];

    for (const field of requiredFields) {
      assert.ok(
        migrationSrc.includes(`NEW.${field} IS DISTINCT FROM OLD.${field}`),
        `${name} must protect ${field} against mutation`
      );
    }
  }
});

test("Fix 4 Behavioral Logic: protect_order_payment_snapshot trigger simulation", () => {
  type OrderRow = {
    id: string;
    status: string;
    snapshot_seller_id: string | null;
    snapshot_seller_code: string | null;
    snapshot_seller_display_name: string | null;
    snapshot_qr_storage_path: string | null;
    snapshot_upi_id: string | null;
    snapshot_account_name: string | null;
    snapshot_payment_instructions: string | null;
    snapshot_captured_at: string | null;
  };

  function simulateTrigger(oldRow: OrderRow, newRow: OrderRow): OrderRow {
    if (oldRow.snapshot_captured_at !== null) {
      if (
        newRow.snapshot_seller_id !== oldRow.snapshot_seller_id ||
        newRow.snapshot_seller_code !== oldRow.snapshot_seller_code ||
        newRow.snapshot_seller_display_name !== oldRow.snapshot_seller_display_name ||
        newRow.snapshot_qr_storage_path !== oldRow.snapshot_qr_storage_path ||
        newRow.snapshot_upi_id !== oldRow.snapshot_upi_id ||
        newRow.snapshot_account_name !== oldRow.snapshot_account_name ||
        newRow.snapshot_payment_instructions !== oldRow.snapshot_payment_instructions ||
        newRow.snapshot_captured_at !== oldRow.snapshot_captured_at
      ) {
        throw new Error("Order payment destination snapshot is immutable and cannot be modified.");
      }
    }
    return newRow;
  }

  const baseCapturedOrder: OrderRow = {
    id: "ord-1",
    status: "PENDING_PAYMENT",
    snapshot_seller_id: "seller-uuid-1",
    snapshot_seller_code: "SELLER-001",
    snapshot_seller_display_name: "John Seller",
    snapshot_qr_storage_path: "seller-uuid-1/qr.png",
    snapshot_upi_id: "seller@upi",
    snapshot_account_name: "John Seller UPI",
    snapshot_payment_instructions: "Please pay to John",
    snapshot_captured_at: "2026-11-02T12:00:00Z",
  };

  // 1. Initial snapshot capture is permitted (when OLD.snapshot_captured_at IS NULL)
  const initialNullOrder: OrderRow = {
    id: "ord-new",
    status: "PENDING_PAYMENT",
    snapshot_seller_id: null,
    snapshot_seller_code: null,
    snapshot_seller_display_name: null,
    snapshot_qr_storage_path: null,
    snapshot_upi_id: null,
    snapshot_account_name: null,
    snapshot_payment_instructions: null,
    snapshot_captured_at: null,
  };
  assert.doesNotThrow(() => {
    simulateTrigger(initialNullOrder, baseCapturedOrder);
  });

  // 2. Historical order with NULL snapshot can receive status updates without error
  assert.doesNotThrow(() => {
    simulateTrigger(initialNullOrder, { ...initialNullOrder, status: "PAYMENT_SUBMITTED" });
  });

  // 3. Unrelated order update on captured order is permitted
  assert.doesNotThrow(() => {
    const updated = simulateTrigger(baseCapturedOrder, { ...baseCapturedOrder, status: "PAYMENT_SUBMITTED" });
    assert.equal(updated.status, "PAYMENT_SUBMITTED");
  });

  // 4. Modifying snapshot_seller_code is strictly blocked
  assert.throws(
    () => simulateTrigger(baseCapturedOrder, { ...baseCapturedOrder, snapshot_seller_code: "SELLER-TAMPERED" }),
    /immutable and cannot be modified/
  );

  // 5. Modifying snapshot_seller_display_name is strictly blocked
  assert.throws(
    () => simulateTrigger(baseCapturedOrder, { ...baseCapturedOrder, snapshot_seller_display_name: "Fake Name" }),
    /immutable and cannot be modified/
  );

  // 6. Modifying snapshot_seller_id is strictly blocked
  assert.throws(
    () => simulateTrigger(baseCapturedOrder, { ...baseCapturedOrder, snapshot_seller_id: "other-seller-uuid" }),
    /immutable and cannot be modified/
  );

  // 7. Modifying snapshot_qr_storage_path is strictly blocked
  assert.throws(
    () => simulateTrigger(baseCapturedOrder, { ...baseCapturedOrder, snapshot_qr_storage_path: "hacked/qr.png" }),
    /immutable and cannot be modified/
  );

  // 8. Modifying snapshot_upi_id is strictly blocked
  assert.throws(
    () => simulateTrigger(baseCapturedOrder, { ...baseCapturedOrder, snapshot_upi_id: "attacker@upi" }),
    /immutable and cannot be modified/
  );

  // 9. Modifying snapshot_captured_at is strictly blocked
  assert.throws(
    () => simulateTrigger(baseCapturedOrder, { ...baseCapturedOrder, snapshot_captured_at: "2026-11-03T00:00:00Z" }),
    /immutable and cannot be modified/
  );
});

test("Fix 1 and Fix 3: Customer and Seller Order Pages Display Seller QR and Never Central Fallback", () => {
  const buyOrderPageSrc = fs.readFileSync(path.resolve("src/app/buy/order/[orderId]/page.tsx"), "utf-8");
  const sellerOrderPaymentSrc = fs.readFileSync(path.resolve("src/app/seller/orders/[orderId]/payment/page.tsx"), "utf-8");

  // Buy order page
  assert.ok(
    buyOrderPageSrc.includes("Seller Payment QR Unavailable"),
    "buy/order/[orderId] must render Seller Payment QR Unavailable warning when seller QR is missing"
  );
  assert.ok(
    !buyOrderPageSrc.includes("manualUpiConfig.qrImagePath"),
    "buy/order/[orderId] must NOT fall back to central SSFI qrImagePath"
  );

  // Seller direct payment page
  assert.ok(
    sellerOrderPaymentSrc.includes("Seller Payment QR Unavailable"),
    "seller/orders/[orderId]/payment must render warning when seller QR is missing"
  );
  assert.ok(
    !sellerOrderPaymentSrc.includes("manualUpiConfig.qrImagePath"),
    "seller/orders/[orderId]/payment must NOT fall back to central SSFI qrImagePath"
  );
});

test("PostgREST Ambiguity Disambiguation: All orders <-> sellers embeds use explicit foreign key hints", () => {
  const adminSellersSrc = fs.readFileSync(path.resolve("src/app/admin/sellers/page.tsx"), "utf-8");
  const adminCustomersSrc = fs.readFileSync(path.resolve("src/app/admin/customers/page.tsx"), "utf-8");
  const adminOrdersSrc = fs.readFileSync(path.resolve("src/app/admin/orders/page.tsx"), "utf-8");
  const adminPaymentsSrc = fs.readFileSync(path.resolve("src/app/admin/payments/page.tsx"), "utf-8");
  const adminOrderDetailSrc = fs.readFileSync(path.resolve("src/app/admin/orders/[orderId]/page.tsx"), "utf-8");
  const adminPaymentDetailSrc = fs.readFileSync(path.resolve("src/app/admin/payments/[paymentId]/page.tsx"), "utf-8");
  const adminExportSrc = fs.readFileSync(path.resolve("src/app/api/admin/export/route.ts"), "utf-8");
  const buyOrderSrc = fs.readFileSync(path.resolve("src/app/buy/order/[orderId]/page.tsx"), "utf-8");

  // Admin Sellers must disambiguate orders join
  assert.ok(
    adminSellersSrc.includes("orders!orders_seller_id_fkey"),
    "Admin Sellers page must explicitly hint orders!orders_seller_id_fkey"
  );
  assert.ok(
    !adminSellersSrc.includes("orders (") && !adminSellersSrc.includes("orders("),
    "Admin Sellers page must not contain un-hinted orders embed"
  );

  // Admin Customers must disambiguate sellers join inside orders
  assert.ok(
    adminCustomersSrc.includes("sellers!orders_seller_id_fkey"),
    "Admin Customers page must explicitly hint sellers!orders_seller_id_fkey"
  );

  // Admin Orders Directory must disambiguate sellers join
  assert.ok(
    adminOrdersSrc.includes("sellers!orders_seller_id_fkey"),
    "Admin Orders page must explicitly hint sellers!orders_seller_id_fkey"
  );

  // Admin Pending Payments must disambiguate sellers join inside orders
  assert.ok(
    adminPaymentsSrc.includes("sellers!orders_seller_id_fkey"),
    "Admin Payments page must explicitly hint sellers!orders_seller_id_fkey"
  );

  // Admin Order Detail
  assert.ok(
    adminOrderDetailSrc.includes("sellers!orders_seller_id_fkey"),
    "Admin Order Detail page must explicitly hint sellers!orders_seller_id_fkey"
  );

  // Admin Payment Detail
  assert.ok(
    adminPaymentDetailSrc.includes("sellers!orders_seller_id_fkey"),
    "Admin Payment Detail page must explicitly hint sellers!orders_seller_id_fkey"
  );

  // Admin Export
  assert.ok(
    adminExportSrc.includes("sellers!orders_seller_id_fkey"),
    "Admin Export route must explicitly hint sellers!orders_seller_id_fkey"
  );

  // Buy Order page
  assert.ok(
    buyOrderSrc.includes("sellers!orders_seller_id_fkey"),
    "Buy Order page must explicitly hint sellers!orders_seller_id_fkey"
  );
});

test("Strict Seller QR Policy: Admin QR Activation, Self-Approval Prevention, and UPI ID Enforcement", () => {
  const sellerSrc = fs.readFileSync(path.resolve("src/server/actions/seller.ts"), "utf-8");
  const sellerSettingsSrc = fs.readFileSync(path.resolve("src/server/actions/sellerPaymentSettings.ts"), "utf-8");
  const referralSrc = fs.readFileSync(path.resolve("src/lib/validation/referral.ts"), "utf-8");
  const publicOrderSrc = fs.readFileSync(path.resolve("src/server/actions/publicOrder.ts"), "utf-8");
  const operationsSrc = fs.readFileSync(path.resolve("src/server/actions/operations.ts"), "utf-8");
  const paymentScreenshotSrc = fs.readFileSync(path.resolve("src/server/actions/paymentScreenshot.ts"), "utf-8");

  // 1. Admin actions for QR activation exist and enforce SUPER_ADMIN or ADMIN role
  assert.ok(
    sellerSrc.includes("export async function adminActivateSellerPaymentQr"),
    "seller.ts must export adminActivateSellerPaymentQr"
  );
  assert.ok(
    sellerSrc.includes("export async function adminDeactivateSellerPaymentQr"),
    "seller.ts must export adminDeactivateSellerPaymentQr"
  );
  assert.ok(
    sellerSrc.includes("getAdminSellerQrSignedUrl"),
    "seller.ts must export getAdminSellerQrSignedUrl"
  );

  // 2. Sellers cannot self-approve QR upon upload or update
  assert.ok(
    sellerSettingsSrc.includes("is_qr_active: false"),
    "sellerPaymentSettings.ts must set is_qr_active: false on new upload awaiting admin approval"
  );
  assert.ok(
    sellerSettingsSrc.includes("Seller QR activation requires Administrator verification"),
    "sellerPaymentSettings.ts must block seller self-activation"
  );

  // 3. Strict UPI ID check: referral, publicOrder, operations require upi_id alongside active QR
  assert.ok(
    referralSrc.includes("!data.is_qr_active || !data.qr_storage_path || !data.upi_id"),
    "referral.ts must require upi_id alongside qr_storage_path"
  );
  assert.ok(
    publicOrderSrc.includes("!seller.is_qr_active || !seller.qr_storage_path || !seller.upi_id"),
    "publicOrder.ts must require upi_id alongside qr_storage_path"
  );
  assert.ok(
    operationsSrc.includes("!seller.is_qr_active || !seller.qr_storage_path || !seller.upi_id"),
    "operations.ts must require upi_id alongside qr_storage_path"
  );

  // 4. Screenshot replacement flow in paymentScreenshot.ts
  assert.ok(
    paymentScreenshotSrc.includes("SCREENSHOT_REPLACED"),
    "paymentScreenshot.ts must log SCREENSHOT_REPLACED event upon replacement"
  );
  assert.ok(
    paymentScreenshotSrc.includes("existing.storage_path"),
    "paymentScreenshot.ts must clean up old storage_path on replacement"
  );
});

