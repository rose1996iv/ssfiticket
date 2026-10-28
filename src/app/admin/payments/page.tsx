import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { connection } from "next/server";

export const instant = false;

type PaymentRow = { id: string; amount_paise: number; utr_reference: string | null; orders: { order_number: string; customers: { full_name: string } | null; sellers: { display_name: string } | null } | null };

export default async function PaymentsPage() {
  await connection();
  const db = createSupabaseAdminClient();
  const { data = [] } = await db.from("payments").select("id,status,amount_paise,utr_reference,submitted_at,orders(order_number,customers(full_name),sellers(display_name))").eq("status", "SUBMITTED").order("submitted_at", { ascending: true }).limit(50);
  const payments = data as unknown as PaymentRow[];
  return <><h1 className="text-3xl font-bold">Pending payments</h1><div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-sm"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Order</th><th>Customer</th><th>Seller</th><th>Amount</th><th>UTR</th><th>Action</th></tr></thead><tbody>{payments.map((payment) => <tr className="border-t" key={payment.id}><td className="p-3">{payment.orders?.order_number}</td><td>{payment.orders?.customers?.full_name}</td><td>{payment.orders?.sellers?.display_name}</td><td>₹{payment.amount_paise / 100}</td><td>{payment.utr_reference}</td><td><Link className="underline" href={`/admin/payments/${payment.id}`}>Review</Link></td></tr>)}{payments.length === 0 && <tr><td className="p-3" colSpan={6}>No payments are awaiting review.</td></tr>}</tbody></table></div></>;
}
