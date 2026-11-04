import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PAYMENT_SCREENSHOT_BYTES,
  validatePaymentScreenshot,
} from "../src/lib/payment/screenshot.ts";

type FileLike = Pick<File, "size" | "type">;

function file(type: string, size: number): File {
  return { type, size } as FileLike as File;
}

test("payment screenshot validation accepts JPEG, PNG, and WebP signatures", () => {
  assert.deepEqual(
    validatePaymentScreenshot(file("image/jpeg", 3), new Uint8Array([0xff, 0xd8, 0xff])),
    { contentType: "image/jpeg", extension: "jpg" }
  );
  assert.deepEqual(
    validatePaymentScreenshot(file("image/png", 8), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    { contentType: "image/png", extension: "png" }
  );
  assert.deepEqual(
    validatePaymentScreenshot(file("image/webp", 12), new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    { contentType: "image/webp", extension: "webp" }
  );
});

test("payment screenshot validation rejects unsupported, empty, oversized, and spoofed files", () => {
  assert.throws(() => validatePaymentScreenshot(file("image/svg+xml", 10), new Uint8Array(10)), /JPEG, PNG, or WebP/);
  assert.throws(() => validatePaymentScreenshot(file("image/png", 0), new Uint8Array()), /2 MB or smaller/);
  assert.throws(() => validatePaymentScreenshot(file("image/png", MAX_PAYMENT_SCREENSHOT_BYTES + 1), new Uint8Array(8)), /2 MB or smaller/);
  assert.throws(() => validatePaymentScreenshot(file("image/png", 8), new Uint8Array([0xff, 0xd8, 0xff])), /does not match/);
  assert.throws(() => validatePaymentScreenshot(file("image/webp", 12), new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x48, 0x54, 0x4d, 0x4c])), /does not match/);
});
