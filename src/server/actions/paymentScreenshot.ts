"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, requireAnyRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PAYMENT_SCREENSHOT_BUCKET, validatePaymentScreenshot } from "@/lib/payment/screenshot";
import {
  executeDownloadPaymentScreenshot,
  PAYMENT_SCREENSHOT_VIEW_TTL_SECONDS,
  resolvePrimaryScreenshotRole,
  type ScreenshotDownloadResult,
} from "@/lib/payment/screenshotDownload";
import { verifyOrderAccess } from "@/lib/security/orderAccessToken";


/**
 * Uploads a payment screenshot.
 * When `token` is provided: validates via recovery token (recovery flow).
 * When `token` is absent: validates via orderId directly (public order page flow).
 */
export async function uploadPaymentScreenshot(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const rawOrderId = formData.get("orderId");
  const rawToken = formData.get("token");
  const file = formData.get("screenshot");

  if (!rawOrderId || typeof rawOrderId !== "string" || !(file instanceof File)) {
    return { success: false, error: "A valid order and screenshot are required." };
  }

  const orderIdParsed = z.string().uuid().safeParse(rawOrderId);
  if (!orderIdParsed.success) return { success: false, error: "Invalid order ID." };
  const orderId = orderIdParsed.data;

  // Enforce access verification in WRITE mode (staff, owning seller, or customer token/cookie)
  const callerToken = typeof rawToken === "string" && rawToken.trim() ? rawToken.trim() : null;
  const access = await verifyOrderAccess(orderId, "WRITE", { rawToken: callerToken });
  if (!access.authorized) {
    return {
      success: false,
      error:
        access.code === "TOKEN_WRITE_ALREADY_CONSUMED"
          ? "Payment has already been finalized and proof cannot be modified."
          : access.code === "ORDER_NOT_EDITABLE"
          ? "This order is not eligible for screenshot upload."
          : "You are not authorized to upload proof for this order or the payment session has expired.",
    };
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { contentType, extension } = validatePaymentScreenshot(file, bytes);
    const admin = createSupabaseAdminClient();

    const { data: payment } = await admin
      .from("payments")
      .select("id, status")
      .eq("order_id", orderId)
      .maybeSingle();

    if (!payment || !["PENDING", "SUBMITTED", "FAILED"].includes(payment.status)) {
      return { success: false, error: "This payment is not eligible for screenshot submission." };
    }
    const paymentId = payment.id as string;

    const { data: existing } = await admin
      .from("payment_screenshots")
      .select("id, storage_path")
      .eq("payment_id", paymentId)
      .maybeSingle();

    if (existing) {
      // Legitimate screenshot replacement: only permit if payment is not yet verified or refunded
      const { data: paymentStatusRow } = await admin
        .from("payments")
        .select("status")
        .eq("id", paymentId)
        .maybeSingle();

      if (!paymentStatusRow || !["PENDING", "SUBMITTED", "FAILED"].includes(paymentStatusRow.status)) {
        return { success: false, error: "This payment has already been verified and its proof cannot be replaced." };
      }

      const newPath = `${crypto.randomUUID()}.${extension}`;
      const { error: storageError } = await admin.storage
        .from(PAYMENT_SCREENSHOT_BUCKET)
        .upload(newPath, bytes, { contentType, upsert: false });

      if (storageError) throw new Error("The replacement screenshot could not be stored. Please retry.");

      const { error: updateError } = await admin
        .from("payment_screenshots")
        .update({
          storage_path: newPath,
          content_type: contentType,
          file_size_bytes: file.size,
          uploaded_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateError) {
        await admin.storage.from(PAYMENT_SCREENSHOT_BUCKET).remove([newPath]);
        throw new Error("The replacement screenshot could not be recorded. Please retry.");
      }

      // Safely remove the old superseded screenshot from storage to prevent orphaned files
      if (existing.storage_path) {
        await admin.storage.from(PAYMENT_SCREENSHOT_BUCKET).remove([existing.storage_path]);
      }

      await admin.from("payment_events").insert({
        payment_id: paymentId,
        event_type: "SCREENSHOT_REPLACED",
        metadata: { content_type: contentType, file_size_bytes: file.size },
      });

      await admin.from("audit_logs").insert({
        actor_user_id: null,
        action: "PAYMENT_SCREENSHOT_REPLACED",
        entity_type: "payment",
        entity_id: paymentId,
        metadata: {
          actor_role: "SYSTEM",
          order_id: orderId,
          payment_id: paymentId,
          reason: "Customer or seller replaced payment screenshot proof",
          old_value: {
            storage_key: existing.storage_path || null,
          },
          new_value: {
            storage_key: newPath,
            content_type: contentType,
            file_size_bytes: file.size,
          },
        },
      });

      revalidatePath(`/admin/payments`);
      revalidatePath(`/admin/payments/${paymentId}`);
      revalidatePath(`/admin/orders/${orderId}`);
      revalidatePath(`/admin/audit-logs`);
      return { success: true };
    }

    const path = `${crypto.randomUUID()}.${extension}`;
    const { error: storageError } = await admin.storage.from(PAYMENT_SCREENSHOT_BUCKET).upload(path, bytes, { contentType, upsert: false });
    if (storageError) throw new Error("The screenshot could not be stored. Please retry.");

    const { error: metadataError } = await admin.from("payment_screenshots").insert({ payment_id: paymentId, storage_path: path, content_type: contentType, file_size_bytes: file.size });
    if (metadataError) {
      await admin.storage.from(PAYMENT_SCREENSHOT_BUCKET).remove([path]);
      throw new Error("The screenshot could not be recorded. Please retry.");
    }
    await admin.from("payment_events").insert({ payment_id: paymentId, event_type: "SCREENSHOT_SUBMITTED", metadata: { content_type: contentType, file_size_bytes: file.size } });
    await admin.from("audit_logs").insert({
      actor_user_id: null,
      action: "PAYMENT_SCREENSHOT_UPLOADED",
      entity_type: "payment",
      entity_id: paymentId,
      metadata: {
        actor_role: "SYSTEM",
        order_id: orderId,
        payment_id: paymentId,
        reason: "Customer or seller uploaded payment screenshot proof",
        new_value: {
          storage_key: path,
          content_type: contentType,
          file_size_bytes: file.size,
        },
      },
    });
    revalidatePath(`/admin/payments`);
    revalidatePath(`/admin/payments/${paymentId}`);
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath(`/admin/audit-logs`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Screenshot upload failed. Please retry." };
  }
}

/**
 * Dedicated SUPER_ADMIN-only server action to download a payment screenshot.
 * Independently verifies the authenticated user's actual SUPER_ADMIN role on the server,
 * verifies payment/screenshot ownership and private bucket integrity, verifies the object
 * exists in storage, generates a 60-second signed download URL with a safe PII-free
 * filename (SSFI-Payment-{paymentId}-Screenshot.{ext}), and logs every succeeded,
 * denied, or failed attempt in public.audit_logs.
 */
export async function downloadPaymentScreenshot(
  paymentId: string
): Promise<ScreenshotDownloadResult> {
  const admin = createSupabaseAdminClient();
  const user = await getCurrentUser();

  return executeDownloadPaymentScreenshot(paymentId, {
    actorUserId: user?.id ?? null,
    resolveActorRoles: async (userId: string) => {
      const { data, error } = await admin
        .from("profile_roles")
        .select("roles(name)")
        .eq("profile_id", userId);
      if (error || !data) return [];
      return data
        .map((row: unknown) => {
          const r = row as { roles?: { name?: string } | { name?: string }[] };
          if (Array.isArray(r.roles)) return r.roles[0]?.name ?? "";
          return r.roles?.name ?? "";
        })
        .filter(Boolean);
    },
    lookupPaymentAndScreenshot: async (targetPaymentId: string) => {
      const [{ data: payment }, { data: screenshot }, { data: bucketInfo }] =
        await Promise.all([
          admin
            .from("payments")
            .select("id, order_id")
            .eq("id", targetPaymentId)
            .maybeSingle(),
          admin
            .from("payment_screenshots")
            .select(
              "id, payment_id, storage_path, content_type, file_size_bytes, uploaded_at"
            )
            .eq("payment_id", targetPaymentId)
            .maybeSingle(),
          admin.storage.getBucket(PAYMENT_SCREENSHOT_BUCKET),
        ]);

      return {
        payment: payment
          ? { id: payment.id as string, order_id: payment.order_id as string }
          : null,
        screenshot: screenshot
          ? {
              id: screenshot.id as string | undefined,
              payment_id: screenshot.payment_id as string,
              storage_path: screenshot.storage_path as string,
              content_type: screenshot.content_type as string,
              file_size_bytes: Number(screenshot.file_size_bytes ?? 0),
              uploaded_at: screenshot.uploaded_at as string,
            }
          : null,
        bucketIsPublic: bucketInfo?.public ?? false,
      };
    },
    verifyAndCreateSignedDownloadUrl: async ({
      bucket,
      storagePath,
      fileName,
      expiresInSeconds,
    }) => {
      const { data: blob, error: downloadCheckError } = await admin.storage
        .from(bucket)
        .download(storagePath);

      if (downloadCheckError || !blob || blob.size === 0) {
        return {
          signedUrl: null,
          fileExists: false,
          error:
            downloadCheckError?.message ||
            "Screenshot file does not exist in private storage bucket",
        };
      }

      const { data: signed, error: signedError } = await admin.storage
        .from(bucket)
        .createSignedUrl(storagePath, expiresInSeconds, {
          download: fileName,
        });

      if (signedError || !signed?.signedUrl) {
        return {
          signedUrl: null,
          fileExists: true,
          error:
            signedError?.message ||
            "Failed to generate short-lived signed download URL",
        };
      }

      return {
        signedUrl: signed.signedUrl,
        fileExists: true,
      };
    },
    writeAuditLog: async (entry) => {
      await admin.from("audit_logs").insert({
        actor_user_id: entry.actor_user_id,
        action: entry.action,
        entity_type: entry.entity_type,
        entity_id: entry.entity_id,
        metadata: entry.metadata,
      });
      revalidatePath("/admin/audit-logs");
    },
  });
}

/**
 * Generates a 5-minute signed URL for authorized Admin Portal staff (SUPER_ADMIN, ADMIN,
 * FUNDRAISING_MANAGER) strictly for VIEWING the payment screenshot inline.
 * Any DOWNLOAD intent is delegated to downloadPaymentScreenshot(paymentId), which enforces
 * SUPER_ADMIN-only authorization and audit logging.
 */
export async function createAdminPaymentScreenshotUrl(
  paymentId: string,
  intent: "VIEW" | "DOWNLOAD" = "VIEW"
): Promise<{
  success: boolean;
  url?: string;
  fileName?: string;
  contentType?: string;
  fileSizeBytes?: number;
  uploadedAt?: string;
  error?: string;
}> {
  if (intent === "DOWNLOAD") {
    return downloadPaymentScreenshot(paymentId);
  }

  const user = await requireAnyRole([
    "SUPER_ADMIN",
    "ADMIN",
    "FUNDRAISING_MANAGER",
  ]);
  if (!z.string().uuid().safeParse(paymentId).success) {
    return { success: false, error: "Invalid payment." };
  }
  const admin = createSupabaseAdminClient();
  const [{ data }, { data: paymentRow }, { data: roleRows }] =
    await Promise.all([
      admin
        .from("payment_screenshots")
        .select("storage_path, content_type, file_size_bytes, uploaded_at")
        .eq("payment_id", paymentId)
        .maybeSingle(),
      admin
        .from("payments")
        .select("order_id")
        .eq("id", paymentId)
        .maybeSingle(),
      admin
        .from("profile_roles")
        .select("roles(name)")
        .eq("profile_id", user.id),
    ]);

  if (!data) {
    return { success: false, error: "No screenshot has been submitted." };
  }

  const assignedRoles = (roleRows ?? [])
    .map((row: unknown) => {
      const r = row as { roles?: { name?: string } | { name?: string }[] };
      if (Array.isArray(r.roles)) return r.roles[0]?.name ?? "";
      return r.roles?.name ?? "";
    })
    .filter(Boolean);
  const actualRole = resolvePrimaryScreenshotRole(assignedRoles);

  const { data: signed, error } = await admin.storage
    .from(PAYMENT_SCREENSHOT_BUCKET)
    .createSignedUrl(data.storage_path, PAYMENT_SCREENSHOT_VIEW_TTL_SECONDS);

  if (error || !signed) {
    return { success: false, error: "Unable to prepare the private preview." };
  }

  await admin.from("audit_logs").insert({
    actor_user_id: user.id,
    action: "PAYMENT_SCREENSHOT_VIEWED",
    entity_type: "payment",
    entity_id: paymentId,
    metadata: {
      order_id: paymentRow?.order_id ?? null,
      payment_id: paymentId,
      actor_role: actualRole,
      intent: "VIEW",
      content_type: data.content_type,
      file_size_bytes: data.file_size_bytes,
    },
  });

  return {
    success: true,
    url: signed.signedUrl,
    contentType: data.content_type,
    fileSizeBytes: data.file_size_bytes,
    uploadedAt: data.uploaded_at,
  };
}

/**
 * Generates a 5-minute signed URL for a seller strictly to VIEW the screenshot for one of their orders.
 * Sellers are never permitted to download payment screenshots; any DOWNLOAD intent is delegated to
 * downloadPaymentScreenshot(paymentId), which denies and audits the attempt.
 */
export async function createSellerPaymentScreenshotUrl(
  paymentId: string,
  intent: "VIEW" | "DOWNLOAD" = "VIEW"
): Promise<{ success: boolean; url?: string; fileName?: string; error?: string }> {
  if (intent === "DOWNLOAD") {
    return downloadPaymentScreenshot(paymentId);
  }

  if (!z.string().uuid().safeParse(paymentId).success) {
    return { success: false, error: "Invalid payment ID." };
  }

  // Require seller role
  const { requireRole } = await import("@/lib/auth/server");
  const user = await requireRole("SELLER");

  const admin = createSupabaseAdminClient();

  // Resolve seller id for this user
  const { data: sellerData } = await admin
    .from("sellers")
    .select("id")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!sellerData) return { success: false, error: "Seller record not found." };

  // Verify this payment belongs to an order attributed to this seller
  const { data: paymentRow } = await admin
    .from("payments")
    .select("id, order_id, orders(seller_id, snapshot_seller_id)")
    .eq("id", paymentId)
    .maybeSingle();

  const orderRel = paymentRow?.orders as unknown as {
    seller_id: string | null;
    snapshot_seller_id?: string | null;
  } | null;

  const isAuthorizedSeller =
    Boolean(orderRel) &&
    (orderRel?.seller_id === sellerData.id || orderRel?.snapshot_seller_id === sellerData.id);

  if (!paymentRow || !isAuthorizedSeller) {
    return { success: false, error: "Access denied: this payment does not belong to your orders." };
  }

  const { data: screenshot } = await admin
    .from("payment_screenshots")
    .select("storage_path, content_type, file_size_bytes")
    .eq("payment_id", paymentId)
    .maybeSingle();
  if (!screenshot) {
    return { success: false, error: "No screenshot has been submitted for this payment." };
  }

  const { data: signed, error } = await admin.storage
    .from(PAYMENT_SCREENSHOT_BUCKET)
    .createSignedUrl(screenshot.storage_path, PAYMENT_SCREENSHOT_VIEW_TTL_SECONDS);

  if (error || !signed) {
    return { success: false, error: "Unable to prepare the private preview." };
  }

  await admin.from("audit_logs").insert({
    actor_user_id: user.id,
    action: "PAYMENT_SCREENSHOT_VIEWED",
    entity_type: "payment",
    entity_id: paymentId,
    metadata: {
      order_id: paymentRow.order_id,
      payment_id: paymentId,
      actor_role: "SELLER",
      seller_id: sellerData.id,
      intent: "VIEW",
      content_type: screenshot.content_type,
      file_size_bytes: screenshot.file_size_bytes,
    },
  });

  return { success: true, url: signed.signedUrl };
}
