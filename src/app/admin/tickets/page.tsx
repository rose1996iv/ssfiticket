import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { connection } from "next/server";

export const instant = false;

type TicketRow = { id: string; ticket_number: string; status: string; issued_at: string; orders: { order_number: string } | null; customers: { full_name: string } | null; sellers: { display_name: string } | null };

export default async function AdminTicketsPage() {
  await connection();
  const db = createSupabaseAdminClient();
  const { data = [] } = await db.from("tickets").select("id,ticket_number,status,issued_at,orders(order_number),customers(full_name),sellers(display_name)").order("issued_at", { ascending: false }).limit(100);
  const tickets = data as unknown as TicketRow[];
  return <><h1 className="text-3xl font-bold">Issued tickets</h1><div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-sm"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Ticket</th><th>Order</th><th>Customer</th><th>Seller</th><th>Status</th></tr></thead><tbody>{tickets.map((ticket) => <tr className="border-t" key={ticket.id}><td className="p-3 font-mono">{ticket.ticket_number}</td><td>{ticket.orders?.order_number}</td><td>{ticket.customers?.full_name}</td><td>{ticket.sellers?.display_name ?? "—"}</td><td>{ticket.status}</td></tr>)}{tickets.length === 0 && <tr><td className="p-3" colSpan={5}>No tickets have been issued.</td></tr>}</tbody></table></div></>;
}
