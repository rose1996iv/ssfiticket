"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAnyRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashRecoveryToken, isValidTokenFormat } from "@/lib/payment/recoveryToken";
import { PAYMENT_SCREENSHOT_BUCKET, validatePaymentScreenshot } from "@/lib/payment/screenshot";

async function authorizedPayment(orderId: string, token: string) {
  const admin = createSupabaseAdminClient();
  const tokenHash = hashRecoveryToken(token);
  const { data: recovery } = await admin
    .from("payment_recovery_tokens")
    .select("order_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!recovery || recovery.order_id !== orderId || recovery.revoked_at || new Date(recovery.expires_at) <= new Date()) {
    throw new Error("This payment link is no longer authorized.");
  }
  const { data: payment } = await admin.from("payments").select("id, status").eq("order_id", orderId).maybeSingle();
  if (!payment || !["PENDING", "SUBMITTED", "FAILED"].includes(payment.status)) throw new Error("This payment is not eligible for screenshot submission.");
  return { admin, paymentId: payment.id as string };
}

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

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { contentType, extension } = validatePaymentScreenshot(file, bytes);
    const admin = createSupabaseAdminClient();
    let paymentId: string;

    if (rawToken && typeof rawToken === "string" && isValidTokenFormat(rawToken)) {
      // Recovery-token-gated path
      const authorized = await authorizedPayment(orderId, rawToken);
      paymentId = authorized.paymentId;
    } else {
      // Direct public order page path — verify order exists and payment is eligible
      const { data: payment } = await admin.from("payments").select("id, status").eq("order_id", orderId).maybeSingle();
      if (!payment || !["PENDING", "SUBMITTED", "FAILED"].includes(payment.status)) {
        return { success: false, error: "This payment is not eligible for screenshot submission." };
      }
      paymentId = payment.id as string;
    }

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

      revalidatePath(`/admin/payments`);
      revalidatePath(`/admin/payments/${paymentId}`);
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
    revalidatePath(`/admin/payments`);
    revalidatePath(`/admin/payments/${paymentId}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Screenshot upload failed. Please retry." };
  }
}

export async function createAdminPaymentScreenshotUrl(paymentId: string): Promise<{ success: boolean; url?: string; error?: string }> {
  await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);
  if (!z.string().uuid().safeParse(paymentId).success) return { success: false, error: "Invalid payment." };
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("payment_screenshots").select("storage_path").eq("payment_id", paymentId).maybeSingle();
  if (!data) return { success: false, error: "No screenshot has been submitted." };
  const { data: signed, error } = await admin.storage.from(PAYMENT_SCREENSHOT_BUCKET).createSignedUrl(data.storage_path, 300);
  return error || !signed ? { success: false, error: "Unable to prepare the private preview." } : { success: true, url: signed.signedUrl };
}

/**
 * Generates a 5-minute signed URL for a seller to view the screenshot for one of their orders.
 * Strictly verifies the payment belongs to an order attributed to the calling seller.
 */
export async function createSellerPaymentScreenshotUrl(paymentId: string): Promise<{ success: boolean; url?: string; error?: string }> {
  if (!z.string().uuid().safeParse(paymentId).success) return { success: false, error: "Invalid payment ID." };

  // Require seller role
  const { requireRole } = await import("@/lib/auth/server");
  const user = await requireRole("SELLER");

  const admin = createSupabaseAdminClient();

  // Resolve seller id for this user
  const { data: sellerData } = await admin.from("sellers").select("id").eq("profile_id", user.id).maybeSingle();
  if (!sellerData) return { success: false, error: "Seller record not found." };

  // Verify this payment belongs to an order attributed to this seller
  const { data: paymentRow } = await admin
    .from("payments")
    .select("id, orders(seller_id)")
    .eq("id", paymentId)
    .maybeSingle();

  const orderSellerId = (paymentRow?.orders as unknown as { seller_id: string } | null)?.seller_id;
  if (!paymentRow || orderSellerId !== sellerData.id) {
    return { success: false, error: "Access denied: this payment does not belong to your orders." };
  }

  const { data: screenshot } = await admin.from("payment_screenshots").select("storage_path").eq("payment_id", paymentId).maybeSingle();
  if (!screenshot) return { success: false, error: "No screenshot has been submitted for this payment." };

  const { data: signed, error } = await admin.storage.from(PAYMENT_SCREENSHOT_BUCKET).createSignedUrl(screenshot.storage_path, 300);
  return error || !signed ? { success: false, error: "Unable to prepare the private preview." } : { success: true, url: signed.signedUrl };
}
