"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const VALID_REVIEW_STATUSES = [
  "RECOMMENDED_APPROVAL",
  "RECOMMENDED_REJECTION",
  "FLAGGED_DISCREPANCY",
] as const;

const reviewSchema = z.object({
  paymentId: z.string().uuid("Invalid payment ID."),
  reviewStatus: z.enum(VALID_REVIEW_STATUSES, {
    message: "Invalid review status.",
  }),
  reviewNote: z
    .string()
    .trim()
    .max(500, "Review note cannot exceed 500 characters.")
    .optional()
    .default(""),
});

export type SellerPaymentReviewResult = {
  success: boolean;
  error?: string;
};

/**
 * Submits an advisory seller review for a payment.
 *
 * IMPORTANT: This is ADVISORY ONLY. It does NOT issue tickets, verify payment,
 * or override Admin decision-making authority. The Admin's `verify_payment_and_issue`
 * RPC remains the sole authoritative path for payment approval and ticket issuance.
 *
 * Security:
 * - Requires SELLER role.
 * - Verifies the payment's order is attributed to the calling seller.
 * - Uses admin client internally; seller identity is validated server-side.
 */
export async function submitSellerPaymentReview(
  formData: FormData
): Promise<SellerPaymentReviewResult> {
  // Dynamically import requireRole to avoid circular deps
  const { requireRole } = await import("@/lib/auth/server");
  const user = await requireRole("SELLER");

  const parsed = reviewSchema.safeParse({
    paymentId: formData.get("paymentId"),
    reviewStatus: formData.get("reviewStatus"),
    reviewNote: formData.get("reviewNote") ?? "",
  });

  if (!parsed.success) {
    const firstError = parsed.error.issues?.[0]?.message ?? "Invalid review submission.";
    return { success: false, error: firstError };
  }

  const { paymentId, reviewStatus, reviewNote } = parsed.data;
  const admin = createSupabaseAdminClient();

  // 1. Resolve the seller record for this user
  const { data: sellerData, error: sellerErr } = await admin
    .from("sellers")
    .select("id")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (sellerErr || !sellerData) {
    return { success: false, error: "Seller record not found. Please contact support." };
  }

  // 2. Fetch payment + associated order to verify seller ownership
  const { data: paymentRow, error: paymentErr } = await admin
    .from("payments")
    .select(
      "id, status, order_id, seller_review_status, seller_review_note, orders(id, order_number, seller_id)"
    )
    .eq("id", paymentId)
    .maybeSingle();

  if (paymentErr || !paymentRow) {
    return { success: false, error: "Payment not found." };
  }

  const orderData = paymentRow.orders as unknown as {
    id: string;
    order_number?: string | null;
    seller_id: string;
  } | null;
  const orderSellerId = orderData?.seller_id;

  if (!orderSellerId || orderSellerId !== sellerData.id) {
    return {
      success: false,
      error: "Access denied: this payment does not belong to your orders.",
    };
  }

  // 3. Only allow review on SUBMITTED payments (not already verified/rejected)
  if (paymentRow.status !== "SUBMITTED") {
    return {
      success: false,
      error: `This payment cannot be reviewed in its current status (${paymentRow.status}).`,
    };
  }

  // 4. Record the seller's advisory review
  const { error: updateErr } = await admin
    .from("payments")
    .update({
      seller_reviewed_at: new Date().toISOString(),
      seller_reviewed_by: user.id,
      seller_review_status: reviewStatus,
      seller_review_note: reviewNote || null,
    })
    .eq("id", paymentId);

  if (updateErr) {
    console.error("[Seller Payment Review] Update failed:", {
      paymentId,
      error: updateErr.message,
    });
    return { success: false, error: "Failed to record review. Please try again." };
  }

  // 5. Record append-only audit log for Seller Payment Review
  await admin.from("audit_logs").insert({
    actor_user_id: user.id,
    action: "SELLER_PAYMENT_REVIEWED",
    entity_type: "payment",
    entity_id: paymentId,
    metadata: {
      actor_role: "SELLER",
      seller_id: sellerData.id,
      order_id: orderData?.id || paymentRow.order_id || null,
      order_number: orderData?.order_number || null,
      payment_id: paymentId,
      review_status: reviewStatus,
      review_note: reviewNote || null,
      reason: reviewNote || `Seller submitted advisory review: ${reviewStatus}`,
      old_value: {
        seller_review_status: paymentRow.seller_review_status ?? null,
        seller_review_note: paymentRow.seller_review_note ?? null,
      },
      new_value: {
        seller_review_status: reviewStatus,
        seller_review_note: reviewNote || null,
      },
    },
  });

  revalidatePath("/seller/payments");
  revalidatePath(`/admin/payments/${paymentId}`);
  if (orderData?.id) {
    revalidatePath(`/admin/orders/${orderData.id}`);
  }
  revalidatePath("/admin/audit-logs");
  return { success: true };
}

