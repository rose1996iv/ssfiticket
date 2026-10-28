import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const instant = false;

type SellerOrder = { id: string; order_number: string; quantity: number; total_amount_paise: number; status: string; customers: { full_name: string }[]; payments: { status: string; utr_reference: string | null; rejection_reason: string | null }[]; tickets: { ticket_number: string }[] };

export default async function SellerOrderPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ submitted?: string }> }) {
  const { orderId } = await params; const query = await searchParams; const user = await requireRole("SELLER"); const db = createSupabaseAdminClient();
  const { data: seller } = await db.from("sellers").select("id,display_name").eq("profile_id", user.id).single();
  const { data } = seller ? await db.from("orders").select("id,order_number,quantity,total_amount_paise,status,customers(full_name),payments(status,utr_reference,rejection_reason),tickets(ticket_number)").eq("id", orderId).eq("seller_id", seller.id).maybeSingle() : { data: null };
  const order = data as unknown as SellerOrder | null; if (!order) notFound(); const payment = order.payments[0];
  return <><h1 className="text-3xl font-bold">{order.order_number}</h1>{query.submitted && <p className="mt-3 rounded bg-green-50 p-3 text-green-800">Payment submitted. It is awaiting administrator review.</p>}<dl className="mt-6 grid gap-4 rounded-xl bg-white p-6 shadow-sm sm:grid-cols-2"><div><dt>Customer</dt><dd className="font-semibold">{order.customers[0]?.full_name}</dd></div><div><dt>Seller</dt><dd className="font-semibold">{seller?.display_name}</dd></div><div><dt>Quantity</dt><dd>{order.quantity}</dd></div><div><dt>Amount</dt><dd>₹{order.total_amount_paise / 100}</dd></div><div><dt>Order status</dt><dd>{order.status}</dd></div><div><dt>Payment status</dt><dd>{payment?.status ?? "PENDING"}</dd></div>{payment?.utr_reference && <div><dt>UTR</dt><dd>{payment.utr_reference}</dd></div>}{payment?.rejection_reason && <div><dt>Rejection reason</dt><dd>{payment.rejection_reason}</dd></div>}</dl>{order.status === "PENDING_PAYMENT" && <Link href={`/seller/orders/${order.id}/payment`} className="mt-6 inline-block rounded bg-[#7c1619] px-4 py-3 font-bold text-white">Submit payment</Link>}{order.tickets.length > 0 && <section className="mt-6"><h2 className="font-bold">Issued tickets</h2>{order.tickets.map((ticket) => <p key={ticket.ticket_number}>{ticket.ticket_number}</p>)}</section>}</>;
}
