"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  SELLER_PAYMENT_QR_BUCKET,
  validateSellerPaymentQr,
} from "@/lib/payment/sellerQr";

const sellerPaymentDetailsSchema = z.object({
  upiId: z
    .string()
    .trim()
    .min(3, "UPI ID must be at least 3 characters.")
    .max(80, "UPI ID cannot exceed 80 characters.")
    .regex(/^[\w.-]+@[\w.-]+$/, "Enter a valid UPI ID format (e.g. name@bank).")
    .optional()
    .or(z.literal("")),
  accountName: z
    .string()
    .trim()
    .max(120, "Account holder name cannot exceed 120 characters.")
    .optional()
    .or(z.literal("")),
  paymentInstructions: z
    .string()
    .trim()
    .max(500, "Payment instructions cannot exceed 500 characters.")
    .optional()
    .or(z.literal("")),
  isQrActive: z.boolean().default(false),
});

async function getAuthenticatedSeller() {
  const user = await requireRole("SELLER");
  const admin = createSupabaseAdminClient();
  const { data: seller, error } = await admin
    .from("sellers")
    .select("id, profile_id, display_name, seller_code, is_active, qr_storage_path, qr_content_type, upi_id, account_name, payment_instructions, is_qr_active")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (error || !seller) {
    throw new Error("Unable to identify seller profile.");
  }

  if (!seller.is_active) {
    throw new Error("Your seller account is currently deactivated.");
  }

  return { admin, seller, user };
}

/**
 * Uploads or replaces the seller's payment QR code.
 */
export async function uploadSellerPaymentQr(
  formData: FormData
): Promise<{ success: boolean; error?: string; storagePath?: string }> {
  try {
    const { admin, seller } = await getAuthenticatedSeller();
    const file = formData.get("qrFile");

    if (!(file instanceof File)) {
      return { success: false, error: "Please choose a QR image file to upload." };
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { contentType, extension } = validateSellerPaymentQr(file, bytes);

    const oldPath = seller.qr_storage_path;
    const newPath = `seller-${seller.id}/${crypto.randomUUID()}.${extension}`;

    // Upload to private seller-payment-qrs bucket
    const { error: uploadError } = await admin.storage
      .from(SELLER_PAYMENT_QR_BUCKET)
      .upload(newPath, bytes, { contentType, upsert: true });

    if (uploadError) {
      throw new Error("Unable to store QR image. Please try again.");
    }

    // Update seller record — new or replacement QR requires Administrator activation
    const { error: dbError } = await admin
      .from("sellers")
      .update({
        qr_storage_path: newPath,
        qr_content_type: contentType,
        qr_updated_at: new Date().toISOString(),
        is_qr_active: false, // Uploaded/replaced QR requires Admin activation before accepting orders
      })
      .eq("id", seller.id);

    if (dbError) {
      // Cleanup uploaded file on DB update failure
      await admin.storage.from(SELLER_PAYMENT_QR_BUCKET).remove([newPath]);
      throw new Error("Unable to save QR details to your profile.");
    }

    // Remove old QR image if replacing
    if (oldPath && oldPath !== newPath) {
      await admin.storage.from(SELLER_PAYMENT_QR_BUCKET).remove([oldPath]);
    }

    revalidatePath("/seller/payment-settings");
    revalidatePath("/seller");

    return { success: true, storagePath: newPath };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "QR upload failed. Please try again.",
    };
  }
}

/**
 * Updates text-based payment details and activation toggle.
 */
export async function updateSellerPaymentDetails(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  try {
    const { admin, seller } = await getAuthenticatedSeller();

    const parsed = sellerPaymentDetailsSchema.safeParse({
      upiId: formData.get("upiId") || "",
      accountName: formData.get("accountName") || "",
      paymentInstructions: formData.get("paymentInstructions") || "",
      isQrActive: formData.get("isQrActive") === "true" || formData.get("isQrActive") === "on",
    });

    if (!parsed.success) {
      const msg = parsed.error.issues?.[0]?.message ?? "Invalid payment details.";
      return { success: false, error: msg };
    }

    // Sellers can voluntarily pause/deactivate their QR, but activating/approving a QR requires Administrator verification.
    let targetIsQrActive = seller.is_qr_active;
    if (parsed.data.isQrActive === false) {
      targetIsQrActive = false;
    } else if (parsed.data.isQrActive === true && !seller.is_qr_active) {
      return {
        success: false,
        error: "Seller QR activation requires Administrator verification. Please upload your QR and UPI details; an SSFI Administrator will activate your account.",
      };
    }

    const { error } = await admin
      .from("sellers")
      .update({
        upi_id: parsed.data.upiId || null,
        account_name: parsed.data.accountName || null,
        payment_instructions: parsed.data.paymentInstructions || null,
        is_qr_active: targetIsQrActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", seller.id);

    if (error) {
      throw new Error("Failed to update payment settings.");
    }

    revalidatePath("/seller/payment-settings");
    revalidatePath("/seller");

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update payment settings.",
    };
  }
}

/**
 * Creates a short-lived (5-minute) signed URL for the authenticated seller to preview their own QR code.
 */
export async function createSellerOwnQrSignedUrl(): Promise<{
  success: boolean;
  url?: string;
  error?: string;
}> {
  try {
    const { admin, seller } = await getAuthenticatedSeller();
    if (!seller.qr_storage_path) {
      return { success: false, error: "No QR code has been uploaded yet." };
    }

    const { data, error } = await admin.storage
      .from(SELLER_PAYMENT_QR_BUCKET)
      .createSignedUrl(seller.qr_storage_path, 300);

    if (error || !data?.signedUrl) {
      return { success: false, error: "Unable to prepare QR preview." };
    }

    return { success: true, url: data.signedUrl };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to generate preview URL.",
    };
  }
}
