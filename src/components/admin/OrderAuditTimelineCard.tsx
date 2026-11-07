"use client";

import Link from "next/link";
import { ExternalLink, History, Lock, ShieldCheck, UserCheck } from "lucide-react";
import type { AuditTimelineEvent } from "@/server/actions/orderCollaboration";
import { sanitizeAuditMetadata } from "@/lib/audit/center";

type Props = {
  events: AuditTimelineEvent[];
  orderId?: string;
};

const ACTION_BADGE_MAP: Record<string, { label: string; className: string }> = {
  ORDER_CREATED: {
    label: "Order Created",
    className: "border-slate-200 bg-slate-100 text-slate-900",
  },
  PAYMENT_SUBMITTED: {
    label: "Payment Submitted",
    className: "border-blue-200 bg-blue-100 text-blue-900",
  },
  PAYMENT_DETAILS_SUBMITTED: {
    label: "Payment Details & Screenshot Submitted",
    className: "border-blue-200 bg-blue-100 text-blue-900",
  },
  SELLER_PAYMENT_REVIEWED: {
    label: "Seller Advisory Recommendation",
    className: "border-amber-200 bg-amber-100 text-amber-900",
  },
  PAYMENT_VERIFIED: {
    label: "Admin Payment Verified",
    className: "border-emerald-200 bg-emerald-100 text-emerald-900",
  },
  PAYMENT_REJECTED: {
    label: "Admin Payment Rejected",
    className: "border-red-200 bg-red-100 text-red-900",
  },
  TICKET_ISSUED: {
    label: "Tickets Issued Atomically",
    className: "border-emerald-300 bg-emerald-100 text-emerald-950",
  },
  CUSTOMER_PROFILE_UPDATED: {
    label: "Master Customer Profile Updated",
    className: "border-purple-200 bg-purple-100 text-purple-900",
  },
  TICKET_CONTACT_UPDATED: {
    label: "Single Ticket Contact Updated",
    className: "border-indigo-200 bg-indigo-100 text-indigo-900",
  },
  PAYMENT_SCREENSHOT_VIEWED: {
    label: "Payment Screenshot Viewed",
    className: "border-[#eadbcf] bg-[#fffaf7] text-[#35110f]",
  },
  PAYMENT_SCREENSHOT_DOWNLOADED: {
    label: "Payment Screenshot Downloaded",
    className: "border-[#eadbcf] bg-[#fffaf7] text-[#35110f]",
  },
  ORDER_COLLABORATION_NOTE_ADDED: {
    label: "Collaboration Note Added",
    className: "border-blue-200 bg-blue-50 text-blue-900",
  },
  ORDER_REVIEW_ISSUE_RESOLVED: {
    label: "Review Issue Resolved",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
  },
  CUSTOMER_EMAIL_QUEUED: {
    label: "Ticket Confirmation Email Queued",
    className: "border-sky-200 bg-sky-50 text-sky-900",
  },
  CUSTOMER_EMAIL_SENT: {
    label: "Ticket Confirmation Email Dispatched",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
  },
};

export function OrderAuditTimelineCard({ events, orderId }: Props) {
  return (
    <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f0e7df] pb-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#7c1619]">
            Centralized Append-Only Audit Trail
          </span>
          <h2 className="mt-0.5 font-serif text-lg font-bold text-[#35110f]">
            Immutable Order, Payment &amp; Contact Audit Timeline
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={
              orderId
                ? `/admin/audit-logs?order=${encodeURIComponent(orderId)}`
                : "/admin/audit-logs"
            }
            className="inline-flex items-center gap-1 rounded-full border border-[#eadbcf] bg-[#fffaf7] px-2.5 py-0.5 text-[10px] font-bold text-[#7c1619] transition hover:bg-[#f6ece3]"
          >
            Open Audit Center
            <ExternalLink size={10} />
          </Link>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-900">
            <Lock size={11} />
            Append-Only Enforced ({events.length})
          </span>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#eadbcf] bg-[#fffaf7] p-4 text-center text-xs text-[#705a54]">
          No audit timeline entries recorded yet.
        </div>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {events.map((evt) => {
            const badge = ACTION_BADGE_MAP[evt.action] ?? {
              label: evt.action.replace(/_/g, " "),
              className: "border-[#eadbcf] bg-[#fffaf7] text-[#35110f]",
            };

            const reason =
              typeof evt.metadata.reason === "string"
                ? evt.metadata.reason
                : typeof evt.metadata.note === "string"
                ? evt.metadata.note
                : null;

            const oldVal =
              evt.metadata.old_value && typeof evt.metadata.old_value === "object"
                ? sanitizeAuditMetadata(evt.metadata.old_value)
                : null;
            const newVal =
              evt.metadata.new_value && typeof evt.metadata.new_value === "object"
                ? sanitizeAuditMetadata(evt.metadata.new_value)
                : null;

            return (
              <div
                key={evt.id}
                className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3.5 text-xs space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${badge.className}`}
                    >
                      <History size={11} />
                      {badge.label}
                    </span>
                    <span className="rounded-md bg-white px-2 py-0.5 font-mono text-[10px] text-[#705a54] border border-[#eadbcf]">
                      {evt.entity_type}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-[#705a54]">
                    {new Date(evt.created_at).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#705a54]">
                  <span className="inline-flex items-center gap-1">
                    <UserCheck size={12} className="text-[#7c1619]" />
                    <span>Actor:</span>
                    <strong className="text-[#35110f]">{evt.actor_label}</strong>
                  </span>
                  {typeof evt.metadata.actor_role === "string" && (
                    <span className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#35110f] border border-[#eadbcf]">
                      <ShieldCheck size={10} className="text-emerald-700" />
                      {evt.metadata.actor_role}
                    </span>
                  )}
                  {typeof evt.metadata.review_status === "string" && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-900">
                      {evt.metadata.review_status}
                    </span>
                  )}
                </div>

                {reason && (
                  <div className="rounded-lg border border-[#eadbcf] bg-white p-2.5 text-[11px] text-[#35110f]">
                    <span className="font-bold text-[#7c1619]">Reason / Note: </span>
                    <span>{reason}</span>
                  </div>
                )}

                {oldVal && newVal && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-[11px]">
                    <div className="rounded-lg border border-red-200/70 bg-red-50/40 p-2">
                      <span className="block text-[9px] font-bold uppercase text-red-800">
                        Previous Value (Before)
                      </span>
                      <pre className="mt-1 overflow-x-auto font-mono text-[10px] text-[#35110f]">
                        {JSON.stringify(oldVal, null, 2)}
                      </pre>
                    </div>
                    <div className="rounded-lg border border-emerald-200/70 bg-emerald-50/40 p-2">
                      <span className="block text-[9px] font-bold uppercase text-emerald-800">
                        Updated Value (After)
                      </span>
                      <pre className="mt-1 overflow-x-auto font-mono text-[10px] text-[#35110f]">
                        {JSON.stringify(newVal, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

