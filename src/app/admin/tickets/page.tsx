import Link from "next/link";
import { connection } from "next/server";
import {
  AlertTriangle,
  Award,
  Globe,
  RefreshCw,
  Ticket,
  Users,
} from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ExportDropdown } from "@/components/admin/ExportDropdown";
import { AdminTicketsTable } from "@/components/admin/AdminTicketsTable";
import { AdminTicketDetail } from "@/components/admin/TicketActionModal";

export const instant = false;

type TicketRow = AdminTicketDetail;

export default async function AdminTicketsPage() {
  await connection();
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("tickets")
    .select(
      "id, ticket_number, status, issued_at, voided_at, void_reason, admin_notes, original_ticket_id, reissued_ticket_id, orders(id, order_number, status, payments(id, status, utr_reference)), customers(id, full_name, phone), sellers(id, display_name, seller_code)"
    )
    .order("issued_at", { ascending: false })
    .limit(200);

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

  // Metric computations
  const totalTickets = tickets.length;
  const sellerAttributed = tickets.filter((t) => t.sellers !== null).length;
  const directOnline = totalTickets - sellerAttributed;
  const activeTickets = tickets.filter((t) => t.status === "ISSUED" || t.status === "ACTIVE").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#f0e7df] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#35110f] sm:text-3xl">
            Issued Lucky Draw Tickets
          </h1>
          <p className="mt-1 text-xs text-[#705a54]">
            Immutable, cryptographically verifiable ticket entries allocated upon verified payment.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-semibold text-[#705a54]">
            {totalTickets} tickets listed
          </span>
          <ExportDropdown resource="tickets" resourceName="Tickets" />
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#705a54]">Total Tickets</span>
            <div className="rounded-lg bg-[#fffaf7] p-2 text-[#7c1619]">
              <Ticket size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#7c1619]">{totalTickets}</p>
          <span className="text-[11px] text-[#705a54]">Allocated numbers</span>
        </div>

        <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#705a54]">Seller Attributed</span>
            <div className="rounded-lg bg-[#fffaf7] p-2 text-[#7c1619]">
              <Users size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#35110f]">{sellerAttributed}</p>
          <span className="text-[11px] text-[#705a54]">Via seller referrals</span>
        </div>

        <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#705a54]">Direct Online</span>
            <div className="rounded-lg bg-blue-50 p-2 text-blue-700">
              <Globe size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-blue-800">{directOnline}</p>
          <span className="text-[11px] text-blue-700 font-medium">Direct public orders</span>
        </div>

        <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#705a54]">Active In Draw</span>
            <div className="rounded-lg bg-green-50 p-2 text-green-700">
              <Award size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-green-800">{activeTickets}</p>
          <span className="text-[11px] text-green-700 font-medium">Eligible for prize draw</span>
        </div>
      </div>

      {/* Tickets Table with QR & Mutation Actions */}
      <AdminTicketsTable tickets={tickets as unknown as AdminTicketDetail[]} />
    </div>
  );
}
