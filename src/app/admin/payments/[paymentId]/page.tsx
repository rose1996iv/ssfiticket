import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rejectPayment, verifyPayment } from "@/server/actions/operations";
import { connection } from "next/server";

export const instant = false;

type PaymentDetail = { id: string; status: string; amount_paise: number; utr_reference: string | null; payer_name: string | null; orders: { order_number: string; customers: { full_name: string }[]; sellers: { display_name: string }[] }[] };

export default async function PaymentDetailPage({ params }: { params: Promise<{ paymentId: string }> }) {
  await connection();
  const { paymentId } = await params; const db = createSupabaseAdminClient(); const { data } = await db.from("payments").select("id,status,amount_paise,utr_reference,payer_name,submitted_at,rejection_reason,orders(order_number,customers(full_name),sellers(display_name))").eq("id", paymentId).maybeSingle(); const payment = data as unknown as PaymentDetail | null; if (!payment) notFound(); const order = payment.orders[0];
  return <><h1 className="text-3xl font-bold">Payment review</h1><div className="mt-6 rounded-xl bg-white p-6 shadow-sm"><p>{order?.order_number} · {order?.customers[0]?.full_name}</p><p className="mt-2">Seller: {order?.sellers[0]?.display_name}</p><p>Amount: ₹{payment.amount_paise / 100}</p><p>UTR: {payment.utr_reference}</p><p>Status: {payment.status}</p>{payment.status === "SUBMITTED" && <div className="mt-6 flex gap-4"><form action={verifyPayment}><input type="hidden" name="paymentId" value={payment.id}/><button className="rounded bg-green-700 px-4 py-3 font-bold text-white">Verify & issue tickets</button></form><form action={rejectPayment} className="flex gap-2"><input type="hidden" name="paymentId" value={payment.id}/><input required name="reason" placeholder="Rejection reason" className="rounded border p-2"/><button className="rounded bg-[#7c1619] px-4 py-3 font-bold text-white">Reject</button></form></div>}</div></>;
}
