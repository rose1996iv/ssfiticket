import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/server";
import { manualUpiConfig } from "@/lib/config/payment";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { submitManualUpi } from "@/server/actions/operations";

export const instant = false;

type PaymentOrder = { id: string; order_number: string; quantity: number; total_amount_paise: number; customers: { full_name: string }[] };

export default async function PaymentPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params; const user = await requireRole("SELLER"); const db = createSupabaseAdminClient(); const { data: seller } = await db.from("sellers").select("id").eq("profile_id", user.id).single();
  const { data } = seller ? await db.from("orders").select("id,order_number,quantity,total_amount_paise,customers(full_name)").eq("id", orderId).eq("seller_id", seller.id).eq("status", "PENDING_PAYMENT").maybeSingle() : { data: null };
  const order = data as unknown as PaymentOrder | null; if (!order) notFound();
  return <><h1 className="text-3xl font-bold">Manual UPI payment</h1><div className="mt-6 max-w-xl rounded-xl bg-white p-6 shadow-sm"><p className="font-bold">{order.order_number}</p><p>{order.customers[0]?.full_name} · {order.quantity} tickets</p><p className="mt-3 text-2xl font-bold">Amount due: ₹{order.total_amount_paise / 100}</p><hr className="my-5"/><p>Pay to <b>{manualUpiConfig.displayName}</b></p><p className="font-mono">{manualUpiConfig.upiId}</p><p className="mt-2 text-sm text-[#705a54]">{manualUpiConfig.instructions}</p><form action={submitManualUpi} className="mt-6 space-y-3"><input type="hidden" name="orderId" value={order.id}/><label className="block">UTR / payment reference<input name="utr" required className="mt-1 w-full rounded border p-2"/></label><label className="block">Payer name (optional)<input name="payerName" className="mt-1 w-full rounded border p-2"/></label><button className="rounded bg-[#7c1619] px-4 py-3 font-bold text-white">Submit payment</button></form></div></>;
}
