"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Calendar,
  ExternalLink,
  Eye,
  Mail,
  Phone,
  Ticket,
  X,
  MessageSquare,
} from "lucide-react";

export type CustomerDetailData = {
  id: string;
  full_name: string;
  phone: string;
  whatsapp_number: string | null;
  email: string | null;
  created_at: string;
  orders: {
    id: string;
    order_number: string;
    quantity: number;
    total_amount_paise: number;
    status: string;
    created_at: string;
    sellers?: {
      display_name: string;
      seller_code: string;
    } | null;
    payments?: {
      id: string;
      status: string;
      amount_paise: number;
      utr_reference: string | null;
    }[];
  }[];
  tickets: {
    id: string;
    ticket_number: string;
    status: string;
  }[];
};

interface CustomerDetailModalProps {
  customer: CustomerDetailData;
}

export function CustomerDetailModal({ customer }: CustomerDetailModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  const issuedTickets = customer.tickets.filter((t) => t.status === "ISSUED");
  const verifiedPaidPaise = customer.orders
    .flatMap((o) => o.payments || [])
    .filter((p) => p.status === "VERIFIED")
    .reduce((sum, p) => sum + p.amount_paise, 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-[#eadbcf] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#35110f] shadow-2xs transition hover:border-[#7c1619] hover:bg-[#fffaf7] hover:text-[#7c1619]"
        title="View Customer Relational Details"
      >
        <Eye size={13} />
        <span>Details</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-2xl">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-[#f0e7df] pb-4">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">
                  Customer Profile
                </span>
                <h2 className="mt-1 text-xl font-bold text-[#35110f]">{customer.full_name}</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            {/* Contact Details */}
            <div className="mt-5 grid grid-cols-1 gap-3 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-xs sm:grid-cols-2">
              <div className="flex items-center gap-2 text-[#705a54]">
                <Phone size={14} className="text-[#7c1619]" />
                <span>
                  <strong className="text-[#35110f]">Phone:</strong> {customer.phone}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[#705a54]">
                <MessageSquare size={14} className="text-emerald-600" />
                <span>
                  <strong className="text-[#35110f]">WhatsApp:</strong>{" "}
                  {customer.whatsapp_number || customer.phone}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[#705a54]">
                <Mail size={14} className="text-[#7c1619]" />
                <span>
                  <strong className="text-[#35110f]">Email:</strong>{" "}
                  {customer.email || "Not specified"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[#705a54]">
                <Calendar size={14} className="text-[#7c1619]" />
                <span>
                  <strong className="text-[#35110f]">Joined:</strong>{" "}
                  {new Date(customer.created_at).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>

            {/* Metrics */}
            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-[#eadbcf] bg-white p-3.5 shadow-2xs">
                <span className="text-[11px] font-semibold text-[#705a54]">Total Orders</span>
                <p className="mt-1 font-mono text-xl font-bold text-[#35110f]">
                  {customer.orders.length}
                </p>
              </div>
              <div className="rounded-xl border border-[#eadbcf] bg-white p-3.5 shadow-2xs">
                <span className="text-[11px] font-semibold text-[#705a54]">Issued Tickets</span>
                <p className="mt-1 font-mono text-xl font-bold text-[#7c1619]">
                  {issuedTickets.length}
                </p>
              </div>
              <div className="rounded-xl border border-[#eadbcf] bg-white p-3.5 shadow-2xs">
                <span className="text-[11px] font-semibold text-[#705a54]">Verified Payments</span>
                <p className="mt-1 font-mono text-xl font-bold text-emerald-700">
                  ₹{verifiedPaidPaise / 100}
                </p>
              </div>
            </div>

            {/* Customer Orders */}
            <div className="mt-6">
              <h3 className="border-b border-[#f0e7df] pb-2 text-sm font-bold text-[#35110f]">
                Purchase Orders ({customer.orders.length})
              </h3>

              {customer.orders.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-[#eadbcf] p-6 text-center text-xs text-[#705a54]">
                  No orders found for this customer.
                </div>
              ) : (
                <div className="mt-3 max-h-48 overflow-y-auto divide-y divide-[#f0e7df] rounded-xl border border-[#eadbcf]">
                  {customer.orders.map((o) => (
                    <div
                      key={o.id}
                      className="flex items-center justify-between p-3 text-xs hover:bg-[#fffaf7]"
                    >
                      <div>
                        <Link
                          href={`/admin/orders/${o.id}`}
                          className="font-mono font-bold text-[#7c1619] hover:underline"
                        >
                          {o.order_number}
                        </Link>
                        <p className="text-[11px] text-[#705a54]">
                          {o.quantity} {o.quantity === 1 ? "ticket" : "tickets"} · ₹
                          {o.total_amount_paise / 100}
                          {o.sellers && (
                            <span> · Ref: {o.sellers.seller_code}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            o.status === "TICKETS_ISSUED"
                              ? "bg-green-100 text-green-800"
                              : o.status === "PAYMENT_SUBMITTED"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {o.status}
                        </span>
                        <Link
                          href={`/admin/orders/${o.id}`}
                          className="text-[#7c1619] hover:text-[#631214]"
                          title="Open Order"
                        >
                          <ExternalLink size={13} />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Issued Tickets */}
            <div className="mt-5">
              <h3 className="border-b border-[#f0e7df] pb-2 text-sm font-bold text-[#35110f]">
                Allocated Tickets ({customer.tickets.length})
              </h3>
              {customer.tickets.length === 0 ? (
                <p className="mt-2 text-xs text-[#705a54]">No tickets allocated yet.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {customer.tickets.map((t) => (
                    <Link
                      key={t.id}
                      href={`/verify/${t.ticket_number}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-green-200 bg-green-50 px-2.5 py-1 font-mono text-xs font-bold text-green-900 transition hover:bg-green-100"
                    >
                      <Ticket size={12} className="text-green-700" />
                      <span>{t.ticket_number}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="mt-6 flex justify-end border-t border-[#f0e7df] pt-4">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-xl bg-[#7c1619] px-4 py-2 text-xs font-bold text-white shadow-2xs transition hover:bg-[#631214]"
              >
                Close Profile
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
