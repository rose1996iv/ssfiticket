import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PAYMENT_SCREENSHOT_BYTES,
  PAYMENT_SCREENSHOT_BUCKET,
  validatePaymentScreenshot,
} from "../src/lib/payment/screenshot.ts";
import {
  buildSafeScreenshotDownloadFilename,
  canRoleDownloadPaymentScreenshot,
  canRoleViewAdminPaymentScreenshot,
  executeDownloadPaymentScreenshot,
  PAYMENT_SCREENSHOT_DOWNLOAD_TTL_SECONDS,
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

test("Scenario 1 & 10 & 11: SUPER_ADMIN can download an authorized screenshot with 60s TTL, PII-free filename, and audit log", async () => {
  let capturedTtl = 0;
  let capturedBucket = "";
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
      return {
        signedUrl: `https://jiyuiydzsfydjklosvvq.supabase.co/storage/v1/object/sign/${bucket}/${storagePath}?download=${fileName}`,
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
    `SSFI-Payment-${VALID_PAYMENT_ID}-Screenshot.png`
  );
  assert.ok(res.url?.includes(VALID_STORAGE_PATH));

  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "PAYMENT_SCREENSHOT_DOWNLOAD_SUCCEEDED");
  assert.equal(audits[0].actor_user_id, ACTOR_UUID);
  assert.equal(audits[0].entity_id, VALID_PAYMENT_ID);
  assert.equal(audits[0].metadata.actor_role, "SUPER_ADMIN");
  assert.equal(audits[0].metadata.order_id, VALID_ORDER_ID);
  assert.equal(audits[0].metadata.signed_url_ttl_seconds, 60);

  // Verify audit metadata NEVER leaks signed URL, storage_path, or customer PII
  const serializedAudit = JSON.stringify(audits[0]);
  assert.equal(serializedAudit.includes(VALID_STORAGE_PATH), false);
  assert.equal(serializedAudit.includes("https://"), false);
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

test("Filename builder never includes customer PII or UTR and follows SSFI-Payment-{paymentId}-Screenshot.{ext}", () => {
  const jpgName = buildSafeScreenshotDownloadFilename(
    VALID_PAYMENT_ID,
    "image/jpeg"
  );
  const pngName = buildSafeScreenshotDownloadFilename(
    VALID_PAYMENT_ID,
    "image/png"
  );
  const webpName = buildSafeScreenshotDownloadFilename(
    VALID_PAYMENT_ID,
    "image/webp"
  );

  assert.equal(jpgName, `SSFI-Payment-${VALID_PAYMENT_ID}-Screenshot.jpg`);
  assert.equal(pngName, `SSFI-Payment-${VALID_PAYMENT_ID}-Screenshot.png`);
  assert.equal(webpName, `SSFI-Payment-${VALID_PAYMENT_ID}-Screenshot.webp`);
});
