"use client";

import { useState } from "react";
import {
  Calendar,
  ExternalLink,
  Eye,
  Mail,
  Phone,
  X,
} from "lucide-react";
import Link from "next/link";

export type SellerDetailData = {
  id: string;
  seller_code: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  profiles: {
    id: string;
    email: string | null;
    phone: string | null;
  } | null;
  orders: {
    id: string;
    order_number: string;
    quantity: number;
    total_amount_paise: number;
    status: string;
    created_at: string;
    payments?: {
      id: string;
      status: string;
      amount_paise: number;
    }[];
  }[];
  tickets: {
    id: string;
    status: string;
  }[];
};

interface SellerDetailModalProps {
  seller: SellerDetailData;
}

export function SellerDetailModal({ seller }: SellerDetailModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  const issuedTickets = seller.tickets.filter((t) => t.status === "ISSUED").length;
  const verifiedCollectionPaise = seller.orders
    .flatMap((o) => o.payments || [])
    .filter((p) => p.status === "VERIFIED")
    .reduce((sum, p) => sum + p.amount_paise, 0);

  const pendingPaymentsCount = seller.orders
    .flatMap((o) => o.payments || [])
    .filter((p) => p.status === "SUBMITTED").length;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-[#eadbcf] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#35110f] shadow-2xs transition hover:border-[#7c1619] hover:bg-[#fffaf7] hover:text-[#7c1619]"
        title="View Seller Relational Details"
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
                <div className="flex items-center gap-2">
                  <span className="font-mono text-base font-bold text-[#7c1619]">
                    {seller.seller_code}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      seller.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {seller.is_active ? "Active Seller" : "Inactive"}
                  </span>
                </div>
                <h2 className="mt-1 text-xl font-bold text-[#35110f]">{seller.display_name}</h2>
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

            {/* Profile Contact Details */}
            <div className="mt-5 grid grid-cols-1 gap-3 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-xs sm:grid-cols-2">
              <div className="flex items-center gap-2 text-[#705a54]">
                <Mail size={14} className="text-[#7c1619]" />
                <span>
                  <strong className="text-[#35110f]">Email:</strong>{" "}
                  {seller.profiles?.email || "Not specified"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[#705a54]">
                <Phone size={14} className="text-[#7c1619]" />
                <span>
                  <strong className="text-[#35110f]">Phone:</strong>{" "}
                  {seller.profiles?.phone || "Not specified"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[#705a54]">
                <Calendar size={14} className="text-[#7c1619]" />
                <span>
                  <strong className="text-[#35110f]">Created:</strong>{" "}
                  {new Date(seller.created_at).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[#705a54] font-mono text-[11px]">
                <strong className="text-[#35110f]">ID:</strong> {seller.id.slice(0, 18)}...
              </div>
            </div>

            {/* Summary Metrics */}
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-[#eadbcf] bg-white p-3.5 shadow-2xs">
                <span className="text-[11px] font-semibold text-[#705a54]">Total Orders</span>
                <p className="mt-1 font-mono text-xl font-bold text-[#35110f]">
                  {seller.orders.length}
                </p>
              </div>
              <div className="rounded-xl border border-[#eadbcf] bg-white p-3.5 shadow-2xs">
                <span className="text-[11px] font-semibold text-[#705a54]">Issued Tickets</span>
                <p className="mt-1 font-mono text-xl font-bold text-[#7c1619]">{issuedTickets}</p>
              </div>
              <div className="rounded-xl border border-[#eadbcf] bg-white p-3.5 shadow-2xs">
                <span className="text-[11px] font-semibold text-[#705a54]">Verified Total</span>
                <p className="mt-1 font-mono text-xl font-bold text-emerald-700">
                  ₹{verifiedCollectionPaise / 100}
                </p>
              </div>
              <div className="rounded-xl border border-[#eadbcf] bg-white p-3.5 shadow-2xs">
                <span className="text-[11px] font-semibold text-[#705a54]">Pending Verification</span>
                <p className="mt-1 font-mono text-xl font-bold text-amber-600">
                  {pendingPaymentsCount}
                </p>
              </div>
            </div>

            {/* Recent Attributed Orders */}
            <div className="mt-6">
              <div className="flex items-center justify-between border-b border-[#f0e7df] pb-2">
                <h3 className="text-sm font-bold text-[#35110f]">
                  Attributed Orders ({seller.orders.length})
                </h3>
                <span className="text-xs text-[#705a54]">Most recent activity</span>
              </div>

              {seller.orders.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#eadbcf] p-6 text-center text-xs text-[#705a54]">
                  No orders attributed to this seller code yet.
                </div>
              ) : (
                <div className="mt-3 max-h-56 overflow-y-auto divide-y divide-[#f0e7df] rounded-xl border border-[#eadbcf]">
                  {seller.orders.map((o) => (
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
                          title="Open Order Details"
                        >
                          <ExternalLink size={13} />
                        </Link>
                      </div>
                    </div>
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
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
