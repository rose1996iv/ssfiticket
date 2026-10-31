"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  QrCode,
  Search,
  Ticket,
  XCircle,
} from "lucide-react";
import { TicketActionModal, AdminTicketDetail } from "./TicketActionModal";
import { generateTicketQrDataUrl } from "@/lib/ticket/qr";

type Props = {
  tickets: AdminTicketDetail[];
};

type FilterTab = "ALL" | "ACTIVE" | "VOID" | "TEST";

function isTestTicket(ticket: AdminTicketDetail): boolean {
  const utr = ticket.orders?.payments?.[0]?.utr_reference ?? "";
  const orderNum = ticket.orders?.order_number ?? "";
  const name = ticket.customers?.full_name?.toLowerCase() ?? "";
  return (
    /^(TEST|MOCK)/i.test(utr) ||
    /TEST/i.test(orderNum) ||
    name.includes("test") ||
    name.includes("simulated")
  );
}

export function AdminTicketsTable({ tickets }: Props) {
  const [selectedTicket, setSelectedTicket] = useState<AdminTicketDetail | null>(null);
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("ALL");

  async function openManageModal(ticket: AdminTicketDetail) {
    setSelectedTicket(ticket);
    if (!qrMap[ticket.ticket_number]) {
      try {
        const qr = await generateTicketQrDataUrl(ticket.ticket_number);
        setQrMap((prev) => ({ ...prev, [ticket.ticket_number]: qr }));
      } catch (err) {
        console.error("QR generation failed", err);
      }
    }
  }

  // Filtered tickets
  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      // 1. Status / tab filter
      const isVoid = ticket.status === "VOID";
      const isActive = ticket.status === "ISSUED" || ticket.status === "ACTIVE";
      const isTest = isTestTicket(ticket);

      if (activeTab === "ACTIVE" && !isActive) return false;
      if (activeTab === "VOID" && !isVoid) return false;
      if (activeTab === "TEST" && !isTest) return false;

      // 2. Search query filter
      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase().trim();
      const numMatch = ticket.ticket_number.toLowerCase().includes(q);
      const orderMatch = ticket.orders?.order_number.toLowerCase().includes(q) ?? false;
      const customerMatch =
        (ticket.customers?.full_name.toLowerCase().includes(q) ?? false) ||
        (ticket.customers?.phone.toLowerCase().includes(q) ?? false);
      const utrMatch =
        ticket.orders?.payments?.[0]?.utr_reference?.toLowerCase().includes(q) ?? false;
      const sellerMatch =
        (ticket.sellers?.display_name.toLowerCase().includes(q) ?? false) ||
        (ticket.sellers?.seller_code.toLowerCase().includes(q) ?? false);

      return numMatch || orderMatch || customerMatch || utrMatch || sellerMatch;
    });
  }, [tickets, activeTab, searchQuery]);

  const testCount = useMemo(() => tickets.filter(isTestTicket).length, [tickets]);
  const activeCount = useMemo(
    () => tickets.filter((t) => t.status === "ISSUED" || t.status === "ACTIVE").length,
    [tickets]
  );
  const voidCount = useMemo(() => tickets.filter((t) => t.status === "VOID").length, [tickets]);

  return (
    <>
      {/* Search and Filter Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Search Bar */}
        <div className="relative flex-1 max-w-md">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#705a54]"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search ticket #, order #, customer, UTR..."
            className="w-full rounded-xl border border-[#eadbcf] bg-white pl-10 pr-4 py-2 text-xs text-[#35110f] placeholder:text-[#a08a82] shadow-2xs focus:border-[#7c1619] focus:outline-hidden"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#705a54] hover:text-[#35110f]"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[#eadbcf] bg-white p-1 text-xs shadow-2xs">
          <button
            type="button"
            onClick={() => setActiveTab("ALL")}
            className={`rounded-lg px-3 py-1 font-semibold transition ${
              activeTab === "ALL"
                ? "bg-[#7c1619] text-white shadow-2xs"
                : "text-[#705a54] hover:text-[#7c1619]"
            }`}
          >
            All ({tickets.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("ACTIVE")}
            className={`rounded-lg px-3 py-1 font-semibold transition ${
              activeTab === "ACTIVE"
                ? "bg-green-700 text-white shadow-2xs"
                : "text-green-800 hover:text-green-950"
            }`}
          >
            Active ({activeCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("VOID")}
            className={`rounded-lg px-3 py-1 font-semibold transition ${
              activeTab === "VOID"
                ? "bg-red-700 text-white shadow-2xs"
                : "text-red-800 hover:text-red-950"
            }`}
          >
            Voided ({voidCount})
          </button>
          {testCount > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab("TEST")}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-1 font-semibold transition ${
                activeTab === "TEST"
                  ? "bg-amber-600 text-white shadow-2xs"
                  : "text-amber-800 hover:text-amber-950"
              }`}
            >
              <FlaskConical size={12} />
              <span>Test Data ({testCount})</span>
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-[#eadbcf] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-[#fffaf7] text-xs font-semibold uppercase tracking-wider text-[#705a54]">
              <th className="p-4">Ticket Number</th>
              <th className="p-4">Status</th>
              <th className="p-4">Customer</th>
              <th className="p-4">Order &amp; Payment</th>
              <th className="p-4">Seller Attribution</th>
              <th className="p-4">Issued At</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0e7df]">
            {filteredTickets.map((ticket) => {
              const issuedDate = new Date(ticket.issued_at).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });

              const isVoid = ticket.status === "VOID";
              const isTest = isTestTicket(ticket);
              const payment = ticket.orders?.payments?.[0];

              return (
                <tr key={ticket.id} className="transition-colors hover:bg-[#fffaf7]/60">
                  {/* Ticket Number */}
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openManageModal(ticket)}
                        className="group inline-flex items-center gap-1.5 rounded-lg bg-[#fceeee] px-2.5 py-1 font-mono text-sm font-bold text-[#7c1619] shadow-2xs hover:bg-[#f8dede]"
                      >
                        <span>{ticket.ticket_number}</span>
                        <QrCode
                          size={13}
                          className="text-[#a41f23] group-hover:scale-110 transition-transform"
                        />
                      </button>

                      {isTest && (
                        <span className="inline-flex items-center gap-0.5 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                          <FlaskConical size={10} />
                          <span>TEST</span>
                        </span>
                      )}
                    </div>

                    {ticket.original_ticket_id && (
                      <span className="block mt-0.5 text-[10px] font-mono text-amber-800">
                        (Reissue Replacement)
                      </span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        isVoid
                          ? "bg-red-100 text-red-800"
                          : ticket.status === "ISSUED" || ticket.status === "ACTIVE"
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {isVoid ? (
                        <XCircle size={12} className="text-red-600" />
                      ) : (
                        <CheckCircle2 size={12} className="text-green-600" />
                      )}
                      <span>{ticket.status}</span>
                    </span>

                    {ticket.void_reason && (
                      <span className="block mt-1 text-[11px] text-red-700 italic max-w-xs truncate">
                        {ticket.void_reason}
                      </span>
                    )}
                  </td>

                  {/* Customer */}
                  <td className="p-4">
                    <p className="font-semibold text-[#35110f]">
                      {ticket.customers?.full_name ?? "Unknown"}
                    </p>
                    <p className="font-mono text-xs text-[#705a54]">
                      {ticket.customers?.phone ?? "—"}
                    </p>
                  </td>

                  {/* Order & Payment */}
                  <td className="p-4">
                    {ticket.orders ? (
                      <div className="space-y-0.5">
                        <Link
                          href={`/admin/orders/${ticket.orders.id}`}
                          className="font-mono text-xs font-semibold text-[#7c1619] hover:underline"
                        >
                          {ticket.orders.order_number}
                        </Link>
                        {payment && (
                          <div className="text-[11px] text-[#705a54]">
                            <span
                              className={`rounded px-1.5 py-0.2 font-semibold ${
                                payment.status === "VERIFIED"
                                  ? "bg-green-50 text-green-700 border border-green-200"
                                  : "bg-blue-50 text-blue-700 border border-blue-200"
                              }`}
                            >
                              {payment.status}
                            </span>
                            {payment.utr_reference && (
                              <span className="block font-mono text-[10px] text-[#80635b] mt-0.5">
                                UTR: {payment.utr_reference}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="font-mono text-xs text-[#705a54]">—</span>
                    )}
                  </td>

                  {/* Seller Attribution */}
                  <td className="p-4 text-xs">
                    {ticket.sellers ? (
                      <div>
                        <span className="font-medium text-[#35110f]">
                          {ticket.sellers.display_name}
                        </span>
                        <span className="block font-mono text-[10px] text-[#705a54]">
                          {ticket.sellers.seller_code}
                        </span>
                      </div>
                    ) : (
                      <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                        Direct Online
                      </span>
                    )}
                  </td>

                  {/* Issued At */}
                  <td className="p-4 text-xs text-[#705a54] whitespace-nowrap">{issuedDate}</td>

                  {/* Actions */}
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openManageModal(ticket)}
                        className="rounded-lg border border-[#eadbcf] bg-white px-2.5 py-1 text-xs font-bold text-[#7c1619] transition hover:bg-[#fffaf7]"
                      >
                        Manage
                      </button>
                      <Link
                        href={`/verify/${ticket.ticket_number}`}
                        target="_blank"
                        className="inline-flex items-center gap-1 rounded-lg border border-[#eadbcf] px-2 py-1 text-xs text-[#705a54] transition hover:bg-[#fffaf7]"
                      >
                        <ExternalLink size={12} />
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}

            {filteredTickets.length === 0 && (
              <tr>
                <td className="p-12 text-center" colSpan={7}>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fffaf7] text-[#7c1619]">
                    <Ticket size={28} />
                  </div>
                  <h3 className="mt-4 text-base font-bold text-[#35110f]">
                    {searchQuery ? "No Matching Tickets Found" : "No Tickets in Selected Tab"}
                  </h3>
                  <p className="mt-1 text-xs text-[#705a54]">
                    {searchQuery
                      ? `No issued tickets matched the query "${searchQuery}".`
                      : "No records found under this filter tab."}
                  </p>
                  {(searchQuery || activeTab !== "ALL") && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery("");
                        setActiveTab("ALL");
                      }}
                      className="mt-3 inline-flex items-center gap-1 rounded-xl bg-[#7c1619] px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-[#601114]"
                    >
                      Clear Filters
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedTicket && (
        <TicketActionModal
          ticket={selectedTicket}
          qrDataUrl={qrMap[selectedTicket.ticket_number]}
          onClose={() => setSelectedTicket(null)}
        />
      )}
    </>
  );
}
