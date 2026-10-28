"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAnyRole, requireAuth, requireRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const saleSchema = z.object({ name: z.string().trim().min(2).max(120), whatsapp: z.string().trim().regex(/^[0-9+ -]{7,20}$/), email: z.string().trim().email().optional().or(z.literal("")), quantity: z.coerce.number().int().min(1).max(1000) });
const utrSchema = z.object({ orderId: z.string().uuid(), utr: z.string().trim().min(6).max(64).regex(/^[A-Za-z0-9-]+$/), payerName: z.string().trim().max(120).optional() });

async function currentSellerId() {
  const user = await requireRole("SELLER");
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("sellers").select("id").eq("profile_id", user.id).eq("is_active", true).maybeSingle();
  if (!data) throw new Error("Your seller account is unavailable.");
  return data.id as string;
}

export async function createSale(formData: FormData) {
  const parsed = saleSchema.safeParse({ name: formData.get("name"), whatsapp: formData.get("whatsapp"), email: formData.get("email"), quantity: formData.get("quantity") });
  if (!parsed.success) throw new Error("Please enter valid customer information and quantity.");
  const sellerId = await currentSellerId();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("create_seller_order", { p_seller_id: sellerId, p_name: parsed.data.name, p_whatsapp: parsed.data.whatsapp, p_email: parsed.data.email || "", p_quantity: parsed.data.quantity });
  if (error || !data) throw new Error("Unable to create this sale. Please try again.");
  redirect(`/seller/orders/${data}/payment`);
}

export async function submitManualUpi(formData: FormData) {
  const parsed = utrSchema.safeParse({ orderId: formData.get("orderId"), utr: formData.get("utr"), payerName: formData.get("payerName") });
  if (!parsed.success) throw new Error("Enter a valid UTR/reference.");
  const sellerId = await currentSellerId();
  const admin = createSupabaseAdminClient();
  const { data: order } = await admin.from("orders").select("id").eq("id", parsed.data.orderId).eq("seller_id", sellerId).maybeSingle();
  if (!order) throw new Error("This order does not belong to your seller account.");
  const { error } = await admin.rpc("submit_manual_upi", { p_order_id: parsed.data.orderId, p_utr: parsed.data.utr, p_payer_name: parsed.data.payerName || "" });
  if (error) throw new Error("This payment cannot be submitted in its current state.");
  revalidatePath(`/seller/orders/${parsed.data.orderId}`); redirect(`/seller/orders/${parsed.data.orderId}?submitted=1`);
}

export async function verifyPayment(formData: FormData) {
  await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);
  const paymentId = z.string().uuid().safeParse(formData.get("paymentId")); if (!paymentId.success) throw new Error("Invalid payment.");
  const user = await requireAuth(); const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("verify_payment_and_issue", { p_payment_id: paymentId.data, p_actor: user.id });
  if (error) throw new Error("Payment verification failed. It may already have been processed.");
  revalidatePath("/admin/payments"); revalidatePath("/admin"); redirect("/admin/payments?verified=1");
}

export async function rejectPayment(formData: FormData) {
  await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);
  const parsed = z.object({ paymentId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).safeParse({ paymentId: formData.get("paymentId"), reason: formData.get("reason") });
  if (!parsed.success) throw new Error("A rejection reason is required.");
  const user = await requireAuth(); const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("reject_payment", { p_payment_id: parsed.data.paymentId, p_actor: user.id, p_reason: parsed.data.reason });
  if (error) throw new Error("Payment rejection failed. It may already have been processed.");
  revalidatePath("/admin/payments"); revalidatePath("/admin"); redirect("/admin/payments?rejected=1");
}
