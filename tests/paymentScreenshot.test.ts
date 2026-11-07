import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PAYMENT_SCREENSHOT_BYTES,
  PAYMENT_SCREENSHOT_BUCKET,
  validatePaymentScreenshot,
} from "../src/lib/payment/screenshot.ts";
import {
  buildContentDispositionHeader,
  buildSafeScreenshotDownloadFilename,
  canRoleDownloadPaymentScreenshot,
  canRoleViewAdminPaymentScreenshot,
  executeDownloadPaymentScreenshot,
  PAYMENT_SCREENSHOT_DOWNLOAD_TTL_SECONDS,
  resolveScreenshotExtension,
  sanitizeOrderNumberForFilename,
  type ScreenshotDownloadAuditEntry,
  type ScreenshotDownloadDependencies,
} from "../src/lib/payment/screenshotDownload.ts";

type FileLike = Pick<File, "size" | "type">;

function file(type: string, size: number): File {
  return { type, size } as FileLike as File;
}

const VALID_PAYMENT_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_PAYMENT_ID = "99999999-8888-4777-8666-555555555555";
const VALID_ORDER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const VALID_ORDER_NUMBER = "ORD-2026-748386";
const VALID_CUSTOMER_NAME = "Robinson Joseph";
const VALID_STORAGE_PATH = "f47ac10b-58cc-4372-a567-0e02b2c3d479.png";
const ACTOR_UUID = "77777777-6666-4555-8444-333333333333";

function makeMockDeps(
  overrides: Partial<ScreenshotDownloadDependencies> & {
    roles?: string[];
    auditCollector?: ScreenshotDownloadAuditEntry[];
  } = {}
): {
  deps: ScreenshotDownloadDependencies;
  audits: ScreenshotDownloadAuditEntry[];
} {
  const audits: ScreenshotDownloadAuditEntry[] = overrides.auditCollector ?? [];
  const roles = overrides.roles ?? ["SUPER_ADMIN"];

  const deps: ScreenshotDownloadDependencies = {
    actorUserId:
      overrides.actorUserId !== undefined ? overrides.actorUserId : ACTOR_UUID,
    resolveActorRoles:
      overrides.resolveActorRoles ?? (async () => roles),
    lookupPaymentAndScreenshot:
      overrides.lookupPaymentAndScreenshot ??
      (async (paymentId: string) => ({
        payment: {
          id: paymentId,
          order_id: VALID_ORDER_ID,
          order_number: VALID_ORDER_NUMBER,
          customer_name: VALID_CUSTOMER_NAME,
        },
        screenshot: {
          id: "cccccccc-dddd-4eee-8fff-000000000000",
          payment_id: paymentId,
          storage_path: VALID_STORAGE_PATH,
          content_type: "image/png",
          file_size_bytes: 18432,
          uploaded_at: "2026-11-07T06:00:00.000Z",
        },
        bucketIsPublic: false,
      })),
    verifyAndCreateSignedDownloadUrl:
      overrides.verifyAndCreateSignedDownloadUrl ??
      (async ({ bucket, storagePath, fileName, expiresInSeconds }) => ({
        signedUrl: `https://jiyuiydzsfydjklosvvq.supabase.co/storage/v1/object/sign/${bucket}/${storagePath}?token=short-lived-${expiresInSeconds}&download=${encodeURIComponent(fileName)}`,
        fileExists: true,
      })),
    writeAuditLog:
      overrides.writeAuditLog ??
      (async (entry) => {
        audits.push(entry);
      }),
  };

  return { deps, audits };
}

test("payment screenshot validation accepts JPEG, PNG, and WebP signatures", () => {
  assert.deepEqual(
    validatePaymentScreenshot(
      file("image/jpeg", 3),
      new Uint8Array([0xff, 0xd8, 0xff])
    ),
    { contentType: "image/jpeg", extension: "jpg" }
  );
  assert.deepEqual(
    validatePaymentScreenshot(
      file("image/png", 8),
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    ),
    { contentType: "image/png", extension: "png" }
  );
  assert.deepEqual(
    validatePaymentScreenshot(
      file("image/webp", 12),
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      ])
    ),
    { contentType: "image/webp", extension: "webp" }
  );
});

test("payment screenshot validation rejects unsupported, empty, oversized, and spoofed files", () => {
  assert.throws(
    () =>
      validatePaymentScreenshot(
        file("image/svg+xml", 10),
        new Uint8Array(10)
      ),
    /JPEG, PNG, or WebP/
  );
  assert.throws(
    () => validatePaymentScreenshot(file("image/png", 0), new Uint8Array()),
    /2 MB or smaller/
  );
  assert.throws(
    () =>
      validatePaymentScreenshot(
        file("image/png", MAX_PAYMENT_SCREENSHOT_BYTES + 1),
        new Uint8Array(8)
      ),
    /2 MB or smaller/
  );
  assert.throws(
    () =>
      validatePaymentScreenshot(
        file("image/png", 8),
        new Uint8Array([0xff, 0xd8, 0xff])
      ),
    /does not match/
  );
  assert.throws(
    () =>
      validatePaymentScreenshot(
        file("image/webp", 12),
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x48, 0x54, 0x4d, 0x4c,
        ])
      ),
    /does not match/
  );
});

test("Scenario 1 & 10 & 11: SUPER_ADMIN can download an authorized screenshot with 60s TTL, sanitized meaningful filename, and audit log without PII", async () => {
  let capturedTtl = 0;
  let capturedBucket = "";
  let capturedFileName = "";
  const { deps, audits } = makeMockDeps({
    roles: ["SUPER_ADMIN"],
    verifyAndCreateSignedDownloadUrl: async ({
      bucket,
      storagePath,
      fileName,
      expiresInSeconds,
    }) => {
      capturedTtl = expiresInSeconds;
      capturedBucket = bucket;
      capturedFileName = fileName;
      return {
        signedUrl: `https://jiyuiydzsfydjklosvvq.supabase.co/storage/v1/object/sign/${bucket}/${storagePath}?download=${encodeURIComponent(fileName)}`,
        fileExists: true,
      };
    },
  });

  const res = await executeDownloadPaymentScreenshot(VALID_PAYMENT_ID, deps);

  assert.equal(res.success, true);
  assert.equal(res.expiresInSeconds, 60);
  assert.equal(PAYMENT_SCREENSHOT_DOWNLOAD_TTL_SECONDS, 60);
  assert.equal(capturedTtl, 60);
  assert.equal(capturedBucket, PAYMENT_SCREENSHOT_BUCKET);
  assert.equal(
    res.fileName,
    "ORD-2026-748386.png"
  );
  assert.equal(
    capturedFileName,
    "ORD-2026-748386.png"
  );
  assert.ok(res.url?.includes(VALID_STORAGE_PATH));

  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "PAYMENT_SCREENSHOT_DOWNLOAD_SUCCEEDED");
  assert.equal(audits[0].actor_user_id, ACTOR_UUID);
  assert.equal(audits[0].entity_id, VALID_PAYMENT_ID);
  assert.equal(audits[0].metadata.actor_role, "SUPER_ADMIN");
  assert.equal(audits[0].metadata.order_id, VALID_ORDER_ID);
  assert.equal(audits[0].metadata.signed_url_ttl_seconds, 60);
  assert.equal(
    audits[0].metadata.file_name,
    "ORD-2026-748386.png"
  );

  // Verify filename and audit metadata NEVER leak signed URL, storage_path, Payment-Proof, or customer PII
  const serializedAudit = JSON.stringify(audits[0]);
  assert.equal(serializedAudit.includes(VALID_STORAGE_PATH), false);
  assert.equal(serializedAudit.includes("https://"), false);
  assert.equal(serializedAudit.includes("Robinson-Joseph"), false);
  assert.equal(serializedAudit.includes("Payment-Proof"), false);
  assert.equal(res.fileName.includes("Payment-Proof"), false);
  assert.equal(res.fileName.includes("Robinson"), false);
});

test("Scenario 2: ADMIN cannot download payment screenshots and attempt is logged as DENIED", async () => {
  const { deps, audits } = makeMockDeps({ roles: ["ADMIN"] });
  const res = await executeDownloadPaymentScreenshot(VALID_PAYMENT_ID, deps);

  assert.equal(res.success, false);
  assert.equal(res.code, "FORBIDDEN_ROLE");
  assert.equal(res.url, undefined);
  assert.equal(canRoleDownloadPaymentScreenshot("ADMIN"), false);
  assert.equal(canRoleViewAdminPaymentScreenshot("ADMIN"), true);

  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "PAYMENT_SCREENSHOT_DOWNLOAD_DENIED");
  assert.equal(audits[0].metadata.actor_role, "ADMIN");
  assert.equal(audits[0].metadata.failure_category, "FORBIDDEN_ROLE");
});

test("Scenario 3: FUNDRAISING_MANAGER cannot download payment screenshots and attempt is logged as DENIED", async () => {
  const { deps, audits } = makeMockDeps({ roles: ["FUNDRAISING_MANAGER"] });
  const res = await executeDownloadPaymentScreenshot(VALID_PAYMENT_ID, deps);

  assert.equal(res.success, false);
  assert.equal(res.code, "FORBIDDEN_ROLE");
  assert.equal(res.url, undefined);
  assert.equal(canRoleDownloadPaymentScreenshot("FUNDRAISING_MANAGER"), false);
  assert.equal(canRoleViewAdminPaymentScreenshot("FUNDRAISING_MANAGER"), true);

  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "PAYMENT_SCREENSHOT_DOWNLOAD_DENIED");
  assert.equal(audits[0].metadata.actor_role, "FUNDRAISING_MANAGER");
});

test("Scenario 4: SELLER cannot download payment screenshots and attempt is logged as DENIED", async () => {
  const { deps, audits } = makeMockDeps({ roles: ["SELLER"] });
  const res = await executeDownloadPaymentScreenshot(VALID_PAYMENT_ID, deps);

  assert.equal(res.success, false);
  assert.equal(res.code, "FORBIDDEN_ROLE");
  assert.equal(res.url, undefined);
  assert.equal(canRoleDownloadPaymentScreenshot("SELLER"), false);
  assert.equal(canRoleViewAdminPaymentScreenshot("SELLER"), false);

  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "PAYMENT_SCREENSHOT_DOWNLOAD_DENIED");
  assert.equal(audits[0].metadata.actor_role, "SELLER");
});

test("Scenario 5: CUSTOMER cannot download payment screenshots and attempt is logged as DENIED", async () => {
  const { deps, audits } = makeMockDeps({ roles: ["CUSTOMER"] });
  const res = await executeDownloadPaymentScreenshot(VALID_PAYMENT_ID, deps);

  assert.equal(res.success, false);
  assert.equal(res.code, "FORBIDDEN_ROLE");
  assert.equal(res.url, undefined);
  assert.equal(canRoleDownloadPaymentScreenshot("CUSTOMER"), false);

  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "PAYMENT_SCREENSHOT_DOWNLOAD_DENIED");
  assert.equal(audits[0].metadata.actor_role, "CUSTOMER");
});

test("Scenario 6: Anonymous unauthenticated user cannot download payment screenshots and attempt is logged as DENIED", async () => {
  const { deps, audits } = makeMockDeps({ actorUserId: null });
  const res = await executeDownloadPaymentScreenshot(VALID_PAYMENT_ID, deps);

  assert.equal(res.success, false);
  assert.equal(res.code, "UNAUTHENTICATED");
  assert.equal(res.url, undefined);

  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "PAYMENT_SCREENSHOT_DOWNLOAD_DENIED");
  assert.equal(audits[0].actor_user_id, null);
  assert.equal(audits[0].metadata.actor_role, "ANONYMOUS");
  assert.equal(audits[0].metadata.failure_category, "UNAUTHENTICATED");
});

test("Scenario 7: Manipulated or malformed paymentId cannot bypass authorization or SQL/UUID validation", async () => {
  // Non-SUPER_ADMIN with manipulated paymentId is still blocked at role check
  const { deps: adminDeps, audits: adminAudits } = makeMockDeps({
    roles: ["ADMIN"],
  });
  const deniedRes = await executeDownloadPaymentScreenshot(
    "../../etc/passwd",
    adminDeps
  );
  assert.equal(deniedRes.success, false);
  assert.equal(deniedRes.code, "FORBIDDEN_ROLE");
  assert.equal(adminAudits[0].entity_id, null);

  // SUPER_ADMIN with malformed paymentId fails UUID validation cleanly
  const { deps: superDeps, audits: superAudits } = makeMockDeps({
    roles: ["SUPER_ADMIN"],
  });
  const failedRes = await executeDownloadPaymentScreenshot(
    "not-a-valid-uuid",
    superDeps
  );
  assert.equal(failedRes.success, false);
  assert.equal(failedRes.code, "INVALID_PAYMENT_ID");
  assert.equal(superAudits.length, 1);
  assert.equal(superAudits[0].action, "PAYMENT_SCREENSHOT_DOWNLOAD_FAILED");
  assert.equal(
    superAudits[0].metadata.failure_category,
    "INVALID_PAYMENT_ID"
  );
});

test("Scenario 8: Screenshot belonging to another payment/order cannot be downloaded (ownership mismatch)", async () => {
  const { deps, audits } = makeMockDeps({
    roles: ["SUPER_ADMIN"],
    lookupPaymentAndScreenshot: async (paymentId: string) => ({
      payment: {
        id: paymentId,
        order_id: VALID_ORDER_ID,
      },
      screenshot: {
        id: "cccccccc-dddd-4eee-8fff-000000000000",
        payment_id: OTHER_PAYMENT_ID, // Mismatched payment ownership!
        storage_path: VALID_STORAGE_PATH,
        content_type: "image/png",
        file_size_bytes: 18432,
        uploaded_at: "2026-11-07T06:00:00.000Z",
      },
      bucketIsPublic: false,
    }),
  });

  const res = await executeDownloadPaymentScreenshot(VALID_PAYMENT_ID, deps);
  assert.equal(res.success, false);
  assert.equal(res.code, "OWNERSHIP_MISMATCH");
  assert.equal(res.url, undefined);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "PAYMENT_SCREENSHOT_DOWNLOAD_FAILED");
  assert.equal(audits[0].metadata.failure_category, "OWNERSHIP_MISMATCH");
});

test("Scenario 9: Missing file in private storage bucket returns a safe error and logs FAILED", async () => {
  const { deps, audits } = makeMockDeps({
    roles: ["SUPER_ADMIN"],
    verifyAndCreateSignedDownloadUrl: async () => ({
      signedUrl: null,
      fileExists: false,
      error: "Object not found in payment-screenshots bucket",
    }),
  });

  const res = await executeDownloadPaymentScreenshot(VALID_PAYMENT_ID, deps);
  assert.equal(res.success, false);
  assert.equal(res.code, "STORAGE_OBJECT_MISSING");
  assert.equal(res.url, undefined);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "PAYMENT_SCREENSHOT_DOWNLOAD_FAILED");
  assert.equal(
    audits[0].metadata.failure_category,
    "STORAGE_OBJECT_MISSING"
  );
});

test("Scenario 12: Public bucket configuration is rejected to enforce private storage policy", async () => {
  const { deps, audits } = makeMockDeps({
    roles: ["SUPER_ADMIN"],
    lookupPaymentAndScreenshot: async (paymentId: string) => ({
      payment: {
        id: paymentId,
        order_id: VALID_ORDER_ID,
      },
      screenshot: {
        id: "cccccccc-dddd-4eee-8fff-000000000000",
        payment_id: paymentId,
        storage_path: VALID_STORAGE_PATH,
        content_type: "image/png",
        file_size_bytes: 18432,
        uploaded_at: "2026-11-07T06:00:00.000Z",
      },
      bucketIsPublic: true, // Violation!
    }),
  });

  const res = await executeDownloadPaymentScreenshot(VALID_PAYMENT_ID, deps);
  assert.equal(res.success, false);
  assert.equal(res.code, "PUBLIC_BUCKET_VIOLATION");
  assert.equal(res.url, undefined);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "PAYMENT_SCREENSHOT_DOWNLOAD_FAILED");
  assert.equal(
    audits[0].metadata.failure_category,
    "PUBLIC_BUCKET_VIOLATION"
  );
});

test("Filename builder: generates approved format {ORDER_NUMBER}.{ext} (e.g., ORD-2026-000042.png)", () => {
  const namePng = buildSafeScreenshotDownloadFilename({
    orderNumber: "ORD-2026-000042",
    contentType: "image/png",
    storagePath: "56d2776f-3a6f-49c5-a1ca-ff6468866751.png",
  });
  assert.equal(namePng, "ORD-2026-000042.png");

  const nameJpg = buildSafeScreenshotDownloadFilename({
    orderNumber: "ORD-2026-000043",
    contentType: "image/jpeg",
    storagePath: "56d2776f-3a6f-49c5-a1ca-ff6468866751.jpg",
  });
  assert.equal(nameJpg, "ORD-2026-000043.jpg");

  const nameJpeg = buildSafeScreenshotDownloadFilename({
    orderNumber: "ORD-2026-000044",
    contentType: "image/jpeg",
    storagePath: "56d2776f-3a6f-49c5-a1ca-ff6468866751.jpeg",
  });
  assert.equal(nameJpeg, "ORD-2026-000044.jpeg");

  const nameWebp = buildSafeScreenshotDownloadFilename({
    orderNumber: "ORD-2026-000045",
    contentType: "image/webp",
    storagePath: "56d2776f-3a6f-49c5-a1ca-ff6468866751.webp",
  });
  assert.equal(nameWebp, "ORD-2026-000045.webp");
});

test("Filename builder: customer names and Payment-Proof suffix NEVER appear in the filename", () => {
  const withCustomer = buildSafeScreenshotDownloadFilename({
    orderNumber: "ORD-2026-000042",
    customerName: "Robinson Joseph",
    contentType: "image/png",
  });
  assert.equal(withCustomer, "ORD-2026-000042.png");
  assert.equal(withCustomer.includes("Robinson"), false);
  assert.equal(withCustomer.includes("Joseph"), false);
  assert.equal(withCustomer.includes("Payment-Proof"), false);

  const unicodeCustomer = buildSafeScreenshotDownloadFilename({
    orderNumber: "ORD-2026-000042",
    customerName: "José González",
    contentType: "image/jpeg",
  });
  assert.equal(unicodeCustomer, "ORD-2026-000042.jpg");
  assert.equal(unicodeCustomer.includes("José"), false);
  assert.equal(unicodeCustomer.includes("Payment-Proof"), false);
});

test("Filename builder: path traversal prevention and control character stripping in order number", () => {
  const safeOrder = sanitizeOrderNumberForFilename("../../ORD-2026-000042\u0000\u001f\u007f");
  assert.equal(safeOrder.includes(".."), false);
  assert.equal(safeOrder.includes("/"), false);
  assert.equal(safeOrder.includes("\\"), false);
  assert.equal(safeOrder, "ORD-2026-000042");

  const filename = buildSafeScreenshotDownloadFilename({
    orderNumber: "../../etc/passwd",
    contentType: "image/png",
  });
  assert.equal(filename.includes(".."), false);
  assert.equal(filename.includes("/"), false);
  assert.equal(filename, "etcpasswd.png");
});

test("Filename builder: fallbacks when order number is missing, empty, or invalid", () => {
  // Missing order number -> Screenshot.{ext}
  const noOrderPng = buildSafeScreenshotDownloadFilename({
    orderNumber: null,
    contentType: "image/png",
  });
  assert.equal(noOrderPng, "Screenshot.png");
  assert.equal(noOrderPng.includes("Payment-Proof"), false);

  const emptyOrderJpg = buildSafeScreenshotDownloadFilename({
    orderNumber: "   ",
    contentType: "image/jpeg",
  });
  assert.equal(emptyOrderJpg, "Screenshot.jpg");
  assert.equal(emptyOrderJpg.includes("Payment-Proof"), false);

  const noParams = buildSafeScreenshotDownloadFilename();
  assert.equal(noParams, "Screenshot.jpg");
  assert.equal(noParams.includes("Payment-Proof"), false);
});

test("Filename builder: preserves original extensions and MIME types (JPEG, JPG, PNG, WebP)", () => {
  // From storagePath
  assert.equal(resolveScreenshotExtension("image/jpeg", "uploads/shot.jpg"), "jpg");
  assert.equal(resolveScreenshotExtension("image/jpeg", "uploads/shot.jpeg"), "jpeg");
  assert.equal(resolveScreenshotExtension("image/png", "uploads/shot.png"), "png");
  assert.equal(resolveScreenshotExtension("image/webp", "uploads/shot.webp"), "webp");

  // From contentType MIME fallback
  assert.equal(resolveScreenshotExtension("image/jpeg", null), "jpg");
  assert.equal(resolveScreenshotExtension("image/png", null), "png");
  assert.equal(resolveScreenshotExtension("image/webp", null), "webp");
  assert.equal(resolveScreenshotExtension(null, null), "jpg");
});

test("Filename builder: limits order number length safely", () => {
  const longOrder = "ORD-2026-" + "9".repeat(50);
  const sanitizedOrder = sanitizeOrderNumberForFilename(longOrder);
  assert.equal(sanitizedOrder.length, 30);

  const filename = buildSafeScreenshotDownloadFilename({
    orderNumber: longOrder,
    contentType: "image/png",
  });
  assert.equal(filename.length, 34); // 30 chars + .png
});

test("Content-Disposition header: formats RFC 6266 / RFC 5987 with ASCII fallback and UTF-8 encoding", () => {
  const header = buildContentDispositionHeader("ORD-2026-000042.png");
  assert.equal(
    header,
    'attachment; filename="ORD-2026-000042.png"; filename*=UTF-8\'\'ORD-2026-000042.png'
  );
  assert.equal(header.includes("Payment-Proof"), false);
  assert.equal(header.includes("Robinson"), false);
});
