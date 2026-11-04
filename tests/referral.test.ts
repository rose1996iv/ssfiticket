import test from "node:test";
import assert from "node:assert/strict";
import {
  SELLER_CODE_REGEX,
  validateReferralCodeSyntax,
} from "../src/lib/validation/referral.ts";
import { getSellerReferralUrl, generateQrDataUrl, generateQrSvg } from "../src/lib/qr/qr.ts";

test("SELLER_CODE_REGEX correctly validates expected seller codes", () => {
  assert.equal(SELLER_CODE_REGEX.test("SELLER-001"), true);
  assert.equal(SELLER_CODE_REGEX.test("SELLER-100"), true);
  assert.equal(SELLER_CODE_REGEX.test("SELLER-99999"), true);
  assert.equal(SELLER_CODE_REGEX.test("seller-001"), true); // case-insensitive regex flag

  // Invalid formats
  assert.equal(SELLER_CODE_REGEX.test(""), false);
  assert.equal(SELLER_CODE_REGEX.test("SELLER"), false);
  assert.equal(SELLER_CODE_REGEX.test("SELLER-"), false);
  assert.equal(SELLER_CODE_REGEX.test("SELLER-1"), false); // must have at least 3 digits
  assert.equal(SELLER_CODE_REGEX.test("SELLER-12"), false);
  assert.equal(SELLER_CODE_REGEX.test("SELLER-ABC"), false);
  assert.equal(SELLER_CODE_REGEX.test("ADMIN-001"), false);
  assert.equal(SELLER_CODE_REGEX.test("SELLER-001-EXTRA"), false);
});

test("validateReferralCodeSyntax validates and normalizes valid codes", () => {
  const result1 = validateReferralCodeSyntax("SELLER-001");
  assert.equal(result1.valid, true);
  assert.equal(result1.normalized, "SELLER-001");

  const result2 = validateReferralCodeSyntax("  seller-042  ");
  assert.equal(result2.valid, true);
  assert.equal(result2.normalized, "SELLER-042");
});

test("validateReferralCodeSyntax rejects invalid and malformed inputs", () => {
  assert.equal(validateReferralCodeSyntax("").valid, false);
  assert.equal(validateReferralCodeSyntax(null).valid, false);
  assert.equal(validateReferralCodeSyntax(undefined).valid, false);
  assert.equal(validateReferralCodeSyntax(12345).valid, false);
  assert.equal(validateReferralCodeSyntax("INVALID_CODE").valid, false);
  assert.equal(validateReferralCodeSyntax("SELLER-01").valid, false);
});

test("getSellerReferralUrl generates canonical /buy?ref= URL", () => {
  const url1 = getSellerReferralUrl("SELLER-001", "https://example.com");
  assert.equal(url1, "https://example.com/buy?ref=SELLER-001");

  const url2 = getSellerReferralUrl("seller-042", "https://example.com/");
  assert.equal(url2, "https://example.com/buy?ref=SELLER-042");
});

test("generateQrDataUrl returns a valid base64 PNG data URL", async () => {
  const dataUrl = await generateQrDataUrl("https://example.com/buy?ref=SELLER-001");
  assert.ok(dataUrl.startsWith("data:image/png;base64,"));
  assert.ok(dataUrl.length > 100);
});

test("generateQrSvg returns valid SVG markup", async () => {
  const svg = await generateQrSvg("https://example.com/buy?ref=SELLER-001");
  assert.ok(svg.includes("<svg"));
  assert.ok(svg.includes("</svg>"));
});

test("Order attribution logic: inactive seller rejection simulation", () => {
  type MockSeller = { id: string; seller_code: string; display_name: string; is_active: boolean };
  const mockSellers: MockSeller[] = [
    { id: "uuid-1", seller_code: "SELLER-001", display_name: "Active Seller", is_active: true },
    { id: "uuid-2", seller_code: "SELLER-002", display_name: "Inactive Seller", is_active: false },
  ];

  function simulateReferralLookup(code: string) {
    const syntax = validateReferralCodeSyntax(code);
    if (!syntax.valid || !syntax.normalized) {
      return { success: false, reason: "INVALID_FORMAT" };
    }
    const match = mockSellers.find((s) => s.seller_code === syntax.normalized);
    if (!match) {
      return { success: false, reason: "NOT_FOUND" };
    }
    if (!match.is_active) {
      return { success: false, reason: "INACTIVE" };
    }
    return { success: true, sellerId: match.id, sellerCode: match.seller_code };
  }

  // 1. Valid active seller
  const res1 = simulateReferralLookup("SELLER-001");
  assert.equal(res1.success, true);
  if (res1.success) {
    assert.equal(res1.sellerId, "uuid-1");
  }

  // 2. Inactive seller
  const res2 = simulateReferralLookup("SELLER-002");
  assert.equal(res2.success, false);
  assert.equal(res2.reason, "INACTIVE");

  // 3. Non-existent seller
  const res3 = simulateReferralLookup("SELLER-999");
  assert.equal(res3.success, false);
  assert.equal(res3.reason, "NOT_FOUND");

  // 4. Malformed seller code
  const res4 = simulateReferralLookup("BAD_CODE");
  assert.equal(res4.success, false);
  assert.equal(res4.reason, "INVALID_FORMAT");
});

test("Referral validation: QR inactive and missing QR checks", () => {
  type MockSellerWithQr = {
    id: string;
    seller_code: string;
    display_name: string;
    is_active: boolean;
    is_qr_active: boolean;
    qr_storage_path: string | null;
  };

  const mockSellers: MockSellerWithQr[] = [
    {
      id: "uuid-active-qr",
      seller_code: "SELLER-001",
      display_name: "Active Seller With QR",
      is_active: true,
      is_qr_active: true,
      qr_storage_path: "sellers/qr-001.png",
    },
    {
      id: "uuid-inactive-qr",
      seller_code: "SELLER-003",
      display_name: "Graphic Era",
      is_active: true,
      is_qr_active: false,
      qr_storage_path: null,
    },
    {
      id: "uuid-missing-qr-path",
      seller_code: "SELLER-004",
      display_name: "Seller Missing Path",
      is_active: true,
      is_qr_active: true,
      qr_storage_path: null,
    },
  ];

  function evaluateSellerReferral(seller: MockSellerWithQr) {
    if (!seller.is_active) {
      return { valid: false, code: "INACTIVE" };
    }
    if (!seller.is_qr_active || !seller.qr_storage_path) {
      return { valid: false, code: "QR_INACTIVE" };
    }
    return { valid: true, code: "VALID" };
  }

  // Active seller with QR
  assert.deepEqual(evaluateSellerReferral(mockSellers[0]), { valid: true, code: "VALID" });

  // SELLER-003: Active but QR inactive & null path
  assert.deepEqual(evaluateSellerReferral(mockSellers[1]), { valid: false, code: "QR_INACTIVE" });

  // Missing storage path
  assert.deepEqual(evaluateSellerReferral(mockSellers[2]), { valid: false, code: "QR_INACTIVE" });
});

test("WhatsApp phone input pattern validity across RegExp engines and mobile formats", () => {
  const patternSource = "[0-9+\\s\\(\\)\\-]{7,25}";
  // Verify standard RegExp compilation
  const standardRegex = new RegExp(`^(?:${patternSource})$`);
  // Verify UnicodeSets (v flag) compilation supported in modern mobile browsers
  const vRegex = new RegExp(`^(?:${patternSource})$`, "v");

  const validNumbers = [
    "+91 91234 56789",
    "+919876543210",
    "+1 (555) 123-4567",
    "+44 20 7946 0958",
    "9876543210",
    "+91-98765-43210",
  ];

  for (const num of validNumbers) {
    assert.equal(standardRegex.test(num), true, `Standard regex must accept ${num}`);
    assert.equal(vRegex.test(num), true, `v-flag regex must accept ${num}`);
  }

  const invalidNumbers = [
    "123", // too short (<7)
    "abc-def-ghij", // alphabetic characters
    "+91 98765 43210 ext 123", // invalid words
  ];

  for (const num of invalidNumbers) {
    assert.equal(standardRegex.test(num), false, `Standard regex must reject ${num}`);
    assert.equal(vRegex.test(num), false, `v-flag regex must reject ${num}`);
  }
});
