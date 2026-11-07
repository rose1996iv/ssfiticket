import { z } from "zod";
import { PAYMENT_SCREENSHOT_BUCKET } from "./screenshot.ts";

export const PAYMENT_SCREENSHOT_DOWNLOAD_TTL_SECONDS = 60;
export const PAYMENT_SCREENSHOT_VIEW_TTL_SECONDS = 300;

const UUID_SCHEMA = z.string().uuid();
const SAFE_STORAGE_PATH_REGEX = /^[0-9a-f-]{36}\.(jpg|png|webp)$/i;

export type ScreenshotRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "FUNDRAISING_MANAGER"
  | "SELLER"
  | "CUSTOMER"
  | "ANONYMOUS";

export type DownloadAuditAction =
  | "PAYMENT_SCREENSHOT_DOWNLOAD_SUCCEEDED"
  | "PAYMENT_SCREENSHOT_DOWNLOAD_DENIED"
  | "PAYMENT_SCREENSHOT_DOWNLOAD_FAILED";

export type DownloadFailureCategory =
  | "UNAUTHENTICATED"
  | "FORBIDDEN_ROLE"
  | "INVALID_PAYMENT_ID"
  | "PAYMENT_NOT_FOUND"
  | "SCREENSHOT_NOT_FOUND"
  | "OWNERSHIP_MISMATCH"
  | "INVALID_STORAGE_PATH"
  | "PUBLIC_BUCKET_VIOLATION"
  | "STORAGE_OBJECT_MISSING";

export interface ScreenshotDownloadResult {
  success: boolean;
  url?: string;
  fileName?: string;
  expiresInSeconds?: number;
  error?: string;
  code?: DownloadFailureCategory;
}

export interface PaymentAndScreenshotLookup {
  payment: {
    id: string;
    order_id: string;
  } | null;
  screenshot: {
    id?: string;
    payment_id: string;
    storage_path: string;
    content_type: string;
    file_size_bytes: number;
    uploaded_at: string;
  } | null;
  bucketIsPublic?: boolean;
}

export interface ScreenshotDownloadAuditEntry {
  actor_user_id: string | null;
  action: DownloadAuditAction;
  entity_type: "payment";
  entity_id: string | null;
  metadata: {
    actor_role: ScreenshotRole;
    payment_id: string | null;
    order_id: string | null;
    result: "SUCCEEDED" | "DENIED" | "FAILED";
    failure_category?: DownloadFailureCategory;
    signed_url_ttl_seconds?: number;
    file_name?: string;
    content_type?: string;
    file_size_bytes?: number;
    timestamp_iso: string;
    reason: string;
  };
}

export interface ScreenshotDownloadDependencies {
  actorUserId: string | null;
  resolveActorRoles: (userId: string) => Promise<string[]>;
  lookupPaymentAndScreenshot: (
    paymentId: string
  ) => Promise<PaymentAndScreenshotLookup>;
  verifyAndCreateSignedDownloadUrl: (params: {
    bucket: string;
    storagePath: string;
    fileName: string;
    expiresInSeconds: number;
  }) => Promise<{ signedUrl: string | null; fileExists: boolean; error?: string }>;
  writeAuditLog: (entry: ScreenshotDownloadAuditEntry) => Promise<void>;
}

/**
 * Policy matrix check: ONLY SUPER_ADMIN may download payment screenshots.
 */
export function canRoleDownloadPaymentScreenshot(
  role: string | null | undefined
): boolean {
  return (role || "").trim().toUpperCase() === "SUPER_ADMIN";
}

/**
 * Policy matrix check: SUPER_ADMIN, ADMIN, and FUNDRAISING_MANAGER may view screenshots in Admin Portal.
 */
export function canRoleViewAdminPaymentScreenshot(
  role: string | null | undefined
): boolean {
  const upper = (role || "").trim().toUpperCase();
  return (
    upper === "SUPER_ADMIN" ||
    upper === "ADMIN" ||
    upper === "FUNDRAISING_MANAGER"
  );
}

/**
 * Resolves the highest-precedence role from a user's assigned roles list.
 */
export function resolvePrimaryScreenshotRole(roles: readonly string[]): ScreenshotRole {
  const normalized = new Set(roles.map((r) => r.trim().toUpperCase()));
  if (normalized.has("SUPER_ADMIN")) return "SUPER_ADMIN";
  if (normalized.has("ADMIN")) return "ADMIN";
  if (normalized.has("FUNDRAISING_MANAGER")) return "FUNDRAISING_MANAGER";
  if (normalized.has("SELLER")) return "SELLER";
  return "CUSTOMER";
}

/**
 * Builds a deterministic, PII-free filename for downloaded payment screenshots:
 * SSFI-Payment-{paymentId}-Screenshot.{extension}
 */
export function buildSafeScreenshotDownloadFilename(
  paymentId: string,
  contentType?: string | null,
  storagePath?: string | null
): string {
  const cleanId = UUID_SCHEMA.safeParse(paymentId).success
    ? paymentId.toLowerCase()
    : "unknown";

  let ext = "jpg";
  const mime = (contentType || "").toLowerCase().trim();
  if (mime === "image/png") {
    ext = "png";
  } else if (mime === "image/webp") {
    ext = "webp";
  } else if (mime === "image/jpeg") {
    ext = "jpg";
  } else if (storagePath) {
    const pathExt = storagePath.split(".").pop()?.toLowerCase();
    if (pathExt === "png" || pathExt === "webp" || pathExt === "jpg") {
      ext = pathExt;
    }
  }

  return `SSFI-Payment-${cleanId}-Screenshot.${ext}`;
}

/**
 * Executes the server-side SUPER_ADMIN-only payment screenshot download workflow
 * with comprehensive audit logging for succeeded, denied, and failed attempts.
 */
export async function executeDownloadPaymentScreenshot(
  paymentId: string,
  deps: ScreenshotDownloadDependencies
): Promise<ScreenshotDownloadResult> {
  const nowIso = new Date().toISOString();
  const isValidPaymentId = UUID_SCHEMA.safeParse(paymentId).success;
  const safeEntityId = isValidPaymentId ? paymentId : null;

  // 1. Verify authenticated session
  if (!deps.actorUserId) {
    await deps.writeAuditLog({
      actor_user_id: null,
      action: "PAYMENT_SCREENSHOT_DOWNLOAD_DENIED",
      entity_type: "payment",
      entity_id: safeEntityId,
      metadata: {
        actor_role: "ANONYMOUS",
        payment_id: safeEntityId,
        order_id: null,
        result: "DENIED",
        failure_category: "UNAUTHENTICATED",
        timestamp_iso: nowIso,
        reason: "Unauthenticated user attempted to download payment screenshot",
      },
    });
    return {
      success: false,
      error: "Authentication required. Only SUPER_ADMIN users may download payment screenshots.",
      code: "UNAUTHENTICATED",
    };
  }

  // 2. Independently verify actual server-side role (must be SUPER_ADMIN)
  const assignedRoles = await deps.resolveActorRoles(deps.actorUserId);
  const actualRole = resolvePrimaryScreenshotRole(assignedRoles);

  if (!canRoleDownloadPaymentScreenshot(actualRole)) {
    let relatedOrderId: string | null = null;
    if (isValidPaymentId) {
      try {
        const lookup = await deps.lookupPaymentAndScreenshot(paymentId);
        relatedOrderId = lookup.payment?.order_id ?? null;
      } catch {
        relatedOrderId = null;
      }
    }

    await deps.writeAuditLog({
      actor_user_id: deps.actorUserId,
      action: "PAYMENT_SCREENSHOT_DOWNLOAD_DENIED",
      entity_type: "payment",
      entity_id: safeEntityId,
      metadata: {
        actor_role: actualRole,
        payment_id: safeEntityId,
        order_id: relatedOrderId,
        result: "DENIED",
        failure_category: "FORBIDDEN_ROLE",
        timestamp_iso: nowIso,
        reason: `Download denied for role ${actualRole}; SUPER_ADMIN role is strictly required`,
      },
    });

    return {
      success: false,
      error: "Forbidden: Only SUPER_ADMIN users are authorized to download payment screenshots.",
      code: "FORBIDDEN_ROLE",
    };
  }

  // 3. Validate paymentId UUID format
  if (!isValidPaymentId) {
    await deps.writeAuditLog({
      actor_user_id: deps.actorUserId,
      action: "PAYMENT_SCREENSHOT_DOWNLOAD_FAILED",
      entity_type: "payment",
      entity_id: null,
      metadata: {
        actor_role: "SUPER_ADMIN",
        payment_id: null,
        order_id: null,
        result: "FAILED",
        failure_category: "INVALID_PAYMENT_ID",
        timestamp_iso: nowIso,
        reason: "Invalid payment ID format supplied to screenshot download",
      },
    });
    return {
      success: false,
      error: "Invalid payment ID.",
      code: "INVALID_PAYMENT_ID",
    };
  }

  // 4. Retrieve payment and screenshot records & verify ownership
  const { payment, screenshot, bucketIsPublic } =
    await deps.lookupPaymentAndScreenshot(paymentId);

  if (!payment || payment.id !== paymentId) {
    await deps.writeAuditLog({
      actor_user_id: deps.actorUserId,
      action: "PAYMENT_SCREENSHOT_DOWNLOAD_FAILED",
      entity_type: "payment",
      entity_id: paymentId,
      metadata: {
        actor_role: "SUPER_ADMIN",
        payment_id: paymentId,
        order_id: null,
        result: "FAILED",
        failure_category: "PAYMENT_NOT_FOUND",
        timestamp_iso: nowIso,
        reason: "Target payment record does not exist",
      },
    });
    return {
      success: false,
      error: "Payment record not found.",
      code: "PAYMENT_NOT_FOUND",
    };
  }

  if (!screenshot) {
    await deps.writeAuditLog({
      actor_user_id: deps.actorUserId,
      action: "PAYMENT_SCREENSHOT_DOWNLOAD_FAILED",
      entity_type: "payment",
      entity_id: paymentId,
      metadata: {
        actor_role: "SUPER_ADMIN",
        payment_id: paymentId,
        order_id: payment.order_id,
        result: "FAILED",
        failure_category: "SCREENSHOT_NOT_FOUND",
        timestamp_iso: nowIso,
        reason: "No payment screenshot has been submitted for this payment",
      },
    });
    return {
      success: false,
      error: "No screenshot has been submitted for this payment.",
      code: "SCREENSHOT_NOT_FOUND",
    };
  }

  if (screenshot.payment_id !== payment.id) {
    await deps.writeAuditLog({
      actor_user_id: deps.actorUserId,
      action: "PAYMENT_SCREENSHOT_DOWNLOAD_FAILED",
      entity_type: "payment",
      entity_id: paymentId,
      metadata: {
        actor_role: "SUPER_ADMIN",
        payment_id: paymentId,
        order_id: payment.order_id,
        result: "FAILED",
        failure_category: "OWNERSHIP_MISMATCH",
        timestamp_iso: nowIso,
        reason: "Screenshot payment_id did not match requested payment ID",
      },
    });
    return {
      success: false,
      error: "Screenshot ownership verification failed.",
      code: "OWNERSHIP_MISMATCH",
    };
  }

  // 5. Verify bucket privacy and storage path integrity
  if (bucketIsPublic === true) {
    await deps.writeAuditLog({
      actor_user_id: deps.actorUserId,
      action: "PAYMENT_SCREENSHOT_DOWNLOAD_FAILED",
      entity_type: "payment",
      entity_id: paymentId,
      metadata: {
        actor_role: "SUPER_ADMIN",
        payment_id: paymentId,
        order_id: payment.order_id,
        result: "FAILED",
        failure_category: "PUBLIC_BUCKET_VIOLATION",
        timestamp_iso: nowIso,
        reason: "Security violation: payment-screenshots bucket must remain private",
      },
    });
    return {
      success: false,
      error: "Storage security policy check failed.",
      code: "PUBLIC_BUCKET_VIOLATION",
    };
  }

  if (!SAFE_STORAGE_PATH_REGEX.test(screenshot.storage_path)) {
    await deps.writeAuditLog({
      actor_user_id: deps.actorUserId,
      action: "PAYMENT_SCREENSHOT_DOWNLOAD_FAILED",
      entity_type: "payment",
      entity_id: paymentId,
      metadata: {
        actor_role: "SUPER_ADMIN",
        payment_id: paymentId,
        order_id: payment.order_id,
        result: "FAILED",
        failure_category: "INVALID_STORAGE_PATH",
        timestamp_iso: nowIso,
        reason: "Screenshot storage path failed format validation",
      },
    });
    return {
      success: false,
      error: "Invalid screenshot storage reference.",
      code: "INVALID_STORAGE_PATH",
    };
  }

  // 6. Verify file exists in private bucket and generate 60-second signed download URL
  const safeFileName = buildSafeScreenshotDownloadFilename(
    payment.id,
    screenshot.content_type,
    screenshot.storage_path
  );

  const storageResult = await deps.verifyAndCreateSignedDownloadUrl({
    bucket: PAYMENT_SCREENSHOT_BUCKET,
    storagePath: screenshot.storage_path,
    fileName: safeFileName,
    expiresInSeconds: PAYMENT_SCREENSHOT_DOWNLOAD_TTL_SECONDS,
  });

  if (!storageResult.fileExists || !storageResult.signedUrl) {
    await deps.writeAuditLog({
      actor_user_id: deps.actorUserId,
      action: "PAYMENT_SCREENSHOT_DOWNLOAD_FAILED",
      entity_type: "payment",
      entity_id: paymentId,
      metadata: {
        actor_role: "SUPER_ADMIN",
        payment_id: paymentId,
        order_id: payment.order_id,
        result: "FAILED",
        failure_category: "STORAGE_OBJECT_MISSING",
        timestamp_iso: nowIso,
        reason:
          storageResult.error ||
          "Screenshot file object was not found in private storage bucket",
      },
    });
    return {
      success: false,
      error: "The screenshot file could not be retrieved from private storage.",
      code: "STORAGE_OBJECT_MISSING",
    };
  }

  // 7. Record append-only audit log (without storage_path, signedUrl, tokens, or PII)
  await deps.writeAuditLog({
    actor_user_id: deps.actorUserId,
    action: "PAYMENT_SCREENSHOT_DOWNLOAD_SUCCEEDED",
    entity_type: "payment",
    entity_id: payment.id,
    metadata: {
      actor_role: "SUPER_ADMIN",
      payment_id: payment.id,
      order_id: payment.order_id,
      result: "SUCCEEDED",
      signed_url_ttl_seconds: PAYMENT_SCREENSHOT_DOWNLOAD_TTL_SECONDS,
      file_name: safeFileName,
      content_type: screenshot.content_type,
      file_size_bytes: screenshot.file_size_bytes,
      timestamp_iso: nowIso,
      reason: "SUPER_ADMIN downloaded payment screenshot evidence",
    },
  });

  return {
    success: true,
    url: storageResult.signedUrl,
    fileName: safeFileName,
    expiresInSeconds: PAYMENT_SCREENSHOT_DOWNLOAD_TTL_SECONDS,
  };
}

