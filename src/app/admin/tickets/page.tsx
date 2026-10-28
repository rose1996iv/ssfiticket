import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, ExternalLink, RefreshCw, Ticket } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ExportDropdown } from "@/components/admin/ExportDropdown";

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
  const { data, error } = await db
    .from("tickets")
    .select(
      "id, ticket_number, status, issued_at, orders(order_number), customers(full_name, phone), sellers(display_name, seller_code)"
    )
    .order("issued_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[Admin Tickets Query Error]", {
      code: error.code,
      message: error.message,
      hint: error.hint,
    });

    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-950 shadow-xs">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-red-600" size={24} />
            <div className="space-y-3">
              <div>
                <h1 className="text-lg font-bold text-red-950">
                  Unable to Load Issued Tickets
                </h1>
                <p className="mt-1 text-xs leading-relaxed text-red-800">
                  Failed to fetch issued ticket records from the database.
                </p>
              </div>

              <div className="rounded-xl border border-red-200 bg-white/90 p-3.5 font-mono text-xs text-red-900">
                <p><span className="font-bold">Error Code:</span> {error.code || "UNKNOWN"}</p>
                <p><span className="font-bold">Message:</span> {error.message || "Query failed"}</p>
                {error.hint && <p className="mt-1 text-red-700"><span className="font-bold">Hint:</span> {error.hint}</p>}
              </div>

              <div>
                <Link
                  href="/admin/tickets"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-red-800"
                >
                  <RefreshCw size={14} />
                  <span>Retry Tickets Query</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const tickets = (data ?? []) as unknown as TicketRow[];

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
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-semibold text-[#705a54]">
            {tickets.length} tickets listed
          </span>
          <ExportDropdown resource="tickets" resourceName="Tickets" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#eadbcf] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-[#fffaf7] text-xs font-semibold uppercase tracking-wider text-[#705a54]">
              <th className="p-4">Ticket Number</th>
              <th className="p-4">Customer</th>
              <th className="p-4">Order Ref</th>
              <th className="p-4">Seller Attribution</th>
              <th className="p-4">Issued At</th>
              <th className="p-4 text-right">Verification</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0e7df]">
            {tickets.map((ticket) => {
              const issuedDate = new Date(ticket.issued_at).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <tr key={ticket.id} className="transition-colors hover:bg-[#fffaf7]/60">
                  <td className="p-4">
                    <span className="inline-block rounded-lg bg-[#fceeee] px-2.5 py-1 font-mono text-sm font-bold text-[#7c1619]">
                      {ticket.ticket_number}
                    </span>
                  </td>
                  <td className="p-4 font-semibold text-[#35110f]">
                    {ticket.customers?.full_name}
                  </td>
                  <td className="p-4 font-mono text-xs text-[#705a54]">
                    {ticket.orders?.order_number}
                  </td>
                  <td className="p-4 text-xs">
                    <span className="font-medium text-[#35110f]">{ticket.sellers?.display_name ?? "Direct Online"}</span>
                    {ticket.sellers?.seller_code && (
                      <span className="block font-mono text-[10px] text-[#705a54]">
                        {ticket.sellers?.seller_code}
                      </span>
                    )}
                  </td>
                  <td className="p-4 text-xs text-[#705a54]">{issuedDate}</td>
                  <td className="p-4 text-right">
                    <Link
                      href={`/verify/${ticket.ticket_number}`}
                      target="_blank"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#7c1619] hover:underline"
                    >
                      <span>Public Audit</span>
                      <ExternalLink size={12} />
                    </Link>
                  </td>
                </tr>
              );
            })}

            {tickets.length === 0 && (
              <tr>
                <td className="p-12 text-center" colSpan={6}>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fffaf7] text-[#7c1619]">
                    <Ticket size={28} />
                  </div>
                  <h3 className="mt-4 text-base font-bold text-[#35110f]">No Tickets Issued Yet</h3>
                  <p className="mt-1 text-xs text-[#705a54]">
                    Tickets are issued automatically once payments are verified by staff.
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
