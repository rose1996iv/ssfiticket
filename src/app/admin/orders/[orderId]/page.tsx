import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { connection } from "next/server";

export const instant = false;

type OrderDetail = { order_number: string; quantity: number; total_amount_paise: number; status: string; customers: { full_name: string; phone: string; email: string | null } | null; sellers: { display_name: string; seller_code: string } | null; payments: { status: string; utr_reference: string | null; payer_name: string | null; rejection_reason: string | null }[]; tickets: { ticket_number: string; status: string }[] };

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  await connection();
  const { orderId } = await params;
  const db = createSupabaseAdminClient();
  const { data } = await db.from("orders").select("order_number,quantity,total_amount_paise,status,customers(full_name,phone,email),sellers(display_name,seller_code),payments(status,utr_reference,payer_name,rejection_reason),tickets(ticket_number,status)").eq("id", orderId).maybeSingle();
  const order = data as OrderDetail | null;
  if (!order) notFound();
  const payment = order.payments[0];
  return <><h1 className="text-3xl font-bold">{order.order_number}</h1><dl className="mt-6 grid gap-4 rounded-xl bg-white p-6 shadow-sm sm:grid-cols-2"><div><dt>Customer</dt><dd className="font-semibold">{order.customers?.full_name}</dd><dd>{order.customers?.phone}</dd><dd>{order.customers?.email}</dd></div><div><dt>Seller</dt><dd className="font-semibold">{order.sellers?.display_name ?? "Direct"}</dd><dd>{order.sellers?.seller_code}</dd></div><div><dt>Quantity</dt><dd>{order.quantity}</dd></div><div><dt>Amount</dt><dd>₹{order.total_amount_paise / 100}</dd></div><div><dt>Order status</dt><dd>{order.status}</dd></div><div><dt>Payment</dt><dd>{payment?.status ?? "No payment"}</dd><dd>{payment?.utr_reference}</dd>{payment?.rejection_reason && <dd>Reason: {payment.rejection_reason}</dd>}</div></dl><section className="mt-6"><h2 className="font-bold">Tickets</h2>{order.tickets.length ? <ul className="mt-2 flex flex-wrap gap-2">{order.tickets.map((ticket) => <li className="rounded bg-white px-3 py-2 font-mono shadow-sm" key={ticket.ticket_number}>{ticket.ticket_number}</li>)}</ul> : <p className="mt-2 text-[#705a54]">No tickets issued.</p>}</section></>;
}
