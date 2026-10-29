"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  QrCode,
  Ticket,
  XCircle,
} from "lucide-react";
import { TicketActionModal, AdminTicketDetail } from "./TicketActionModal";
import { generateTicketQrDataUrl } from "@/lib/ticket/qr";

type Props = {
  tickets: AdminTicketDetail[];
};

export function AdminTicketsTable({ tickets }: Props) {
  const [selectedTicket, setSelectedTicket] = useState<AdminTicketDetail | null>(null);
  const [qrMap, setQrMap] = useState<Record<string, string>>({});

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

  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-[#eadbcf] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-[#fffaf7] text-xs font-semibold uppercase tracking-wider text-[#705a54]">
              <th className="p-4">Ticket Number</th>
              <th className="p-4">Status</th>
              <th className="p-4">Customer</th>
              <th className="p-4">Order Ref</th>
              <th className="p-4">Seller Attribution</th>
              <th className="p-4">Issued At</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0e7df]">
            {tickets.map((ticket) => {
              const issuedDate = new Date(ticket.issued_at).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });

              const isVoid = ticket.status === "VOID";

              return (
                <tr key={ticket.id} className="transition-colors hover:bg-[#fffaf7]/60">
                  {/* Ticket Number */}
                  <td className="p-4">
                    <button
                      type="button"
                      onClick={() => openManageModal(ticket)}
                      className="group inline-flex items-center gap-1.5 rounded-lg bg-[#fceeee] px-2.5 py-1 font-mono text-sm font-bold text-[#7c1619] shadow-2xs hover:bg-[#f8dede]"
                    >
                      <span>{ticket.ticket_number}</span>
                      <QrCode size={13} className="text-[#a41f23] group-hover:scale-110 transition-transform" />
                    </button>
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
                  </td>

                  {/* Customer */}
                  <td className="p-4">
                    <p className="font-semibold text-[#35110f]">{ticket.customers?.full_name ?? "Unknown"}</p>
                    <p className="font-mono text-xs text-[#705a54]">{ticket.customers?.phone ?? "—"}</p>
                  </td>

                  {/* Order Ref */}
                  <td className="p-4">
                    {ticket.orders ? (
                      <Link
                        href={`/admin/orders/${ticket.orders.id}`}
                        className="font-mono text-xs font-semibold text-[#7c1619] hover:underline"
                      >
                        {ticket.orders.order_number}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs text-[#705a54]">—</span>
                    )}
                  </td>

                  {/* Seller Attribution */}
                  <td className="p-4 text-xs">
                    {ticket.sellers ? (
                      <div>
                        <span className="font-medium text-[#35110f]">{ticket.sellers.display_name}</span>
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

            {tickets.length === 0 && (
              <tr>
                <td className="p-12 text-center" colSpan={7}>
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
