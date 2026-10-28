import Link from "next/link";
import { connection } from "next/server";
import { ExternalLink, Ticket } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const instant = false;

type TicketRow = {
  id: string;
  ticket_number: string;
  status: string;
  issued_at: string;
  orders: { order_number: string } | null;
  customers: { full_name: string; phone: string } | null;
  sellers: { display_name: string; seller_code: string } | null;
};

export default async function AdminTicketsPage() {
  await connection();
  const db = createSupabaseAdminClient();
  const { data = [] } = await db
    .from("tickets")
    .select(
      "id, ticket_number, status, issued_at, orders(order_number), customers(full_name, phone), sellers(display_name, seller_code)"
    )
    .order("issued_at", { ascending: false })
    .limit(100);

  const tickets = data as unknown as TicketRow[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#f0e7df] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#35110f] sm:text-3xl">
            Issued Lucky Draw Tickets
          </h1>
          <p className="mt-1 text-xs text-[#705a54]">
            Immutable tickets allocated upon verified manual UPI payment.
          </p>
        </div>
        <span className="font-mono text-xs font-semibold text-[#705a54]">
          {tickets.length} tickets listed
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#eadbcf] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-[#fffaf7] text-xs font-semibold uppercase tracking-wider text-[#705a54]">
              <th className="p-4">Ticket Number</th>
              <th className="p-4">Order Ref</th>
              <th className="p-4">Customer</th>
              <th className="p-4">Attributed Seller</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Verification</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0e7df]">
            {tickets.map((ticket) => (
              <tr key={ticket.id} className="transition-colors hover:bg-[#fffaf7]/60">
                <td className="p-4 font-mono font-bold text-[#7c1619]">
                  {ticket.ticket_number}
                </td>
                <td className="p-4 font-mono text-xs">{ticket.orders?.order_number}</td>
                <td className="p-4">
                  <p className="font-semibold text-[#35110f]">{ticket.customers?.full_name}</p>
                  <p className="font-mono text-xs text-[#705a54]">{ticket.customers?.phone}</p>
                </td>
                <td className="p-4">
                  <p className="font-medium text-[#35110f]">{ticket.sellers?.display_name ?? "Direct"}</p>
                  {ticket.sellers?.seller_code && (
                    <span className="font-mono text-xs text-[#705a54]">
                      {ticket.sellers?.seller_code}
                    </span>
                  )}
                </td>
                <td className="p-4">
                  <span className="inline-block rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-bold text-green-800">
                    {ticket.status}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <Link
                    href={`/verify/${ticket.ticket_number}`}
                    target="_blank"
                    className="inline-flex items-center gap-1 text-xs font-bold text-[#7c1619] hover:underline"
                  >
                    <span>Public Verify</span>
                    <ExternalLink size={12} />
                  </Link>
                </td>
              </tr>
            ))}

            {tickets.length === 0 && (
              <tr>
                <td className="p-12 text-center text-[#705a54]" colSpan={6}>
                  <Ticket size={32} className="mx-auto mb-2 text-gray-300" />
                  <p className="text-base font-bold">No tickets issued yet</p>
                  <p className="text-xs">
                    Tickets are issued sequentially when an administrator confirms a payment.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
