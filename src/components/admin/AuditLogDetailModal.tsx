"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Clock,
  ExternalLink,
  Eye,
  FileCode2,
  ShieldCheck,
  User,
  X,
} from "lucide-react";

export interface AuditLogViewEntry {
  id: string;
  action: string;
  actionLabel: string;
  category: string;
  categoryLabel: string;
  tone: "emerald" | "blue" | "amber" | "rose" | "purple" | "indigo" | "slate";
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  actorName: string;
  actorEmail: string | null;
  actorRole: string;
  reason: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  orderId: string | null;
  orderNumber: string | null;
  paymentId: string | null;
  ticketId: string | null;
  ticketNumber: string | null;
  customerId: string | null;
  sellerId: string | null;
  sellerCode: string | null;
  createdAtIso: string;
  createdAtIst: string;
  sanitizedMetadata: Record<string, unknown>;
}

const TONE_CLASSES: Record<AuditLogViewEntry["tone"], string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  rose: "border-rose-200 bg-rose-50 text-rose-800",
  purple: "border-purple-200 bg-purple-50 text-purple-800",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
};

function formatFieldValue(val: unknown): string {
  if (val === null || val === undefined || val === "") {
    return "—";
  }
  if (typeof val === "boolean") {
    return val ? "true" : "false";
  }
  if (typeof val === "object") {
    return JSON.stringify(val);
  }
  return String(val);
}

export function AuditLogDetailModal({ entry }: { entry: AuditLogViewEntry }) {
  const [open, setOpen] = useState(false);

  const diffKeys = Array.from(
    new Set([
      ...Object.keys(entry.oldValue || {}),
      ...Object.keys(entry.newValue || {}),
    ])
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:border-amber-300 hover:bg-amber-50/60 hover:text-amber-900"
      >
        <Eye className="h-3.5 w-3.5 text-amber-700" />
        Inspect
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`audit-modal-title-${entry.id}`}
        >
          <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50/80 px-6 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${TONE_CLASSES[entry.tone]}`}
                  >
                    {entry.actionLabel}
                  </span>
                  <span className="rounded-md bg-slate-200/80 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                    {entry.action}
                  </span>
                  <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {entry.categoryLabel}
                  </span>
                </div>
                <h3
                  id={`audit-modal-title-${entry.id}`}
                  className="mt-1.5 flex items-center gap-1.5 text-sm font-bold text-slate-900"
                >
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Immutable Audit Record #{entry.id.slice(0, 8)}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 space-y-5 overflow-y-auto p-6 text-left">
              {/* Actor & Timestamp Grid */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                    <User className="h-3.5 w-3.5 text-slate-500" />
                    Actor Attribution
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">
                      {entry.actorName}
                    </span>
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-800 uppercase">
                      {entry.actorRole}
                    </span>
                  </div>
                  {entry.actorEmail && (
                    <p className="mt-0.5 text-xs text-slate-600">
                      {entry.actorEmail}
                    </p>
                  )}
                  <p className="mt-1 font-mono text-[11px] text-slate-400">
                    ID: {entry.actorUserId || "SYSTEM"}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                    <Clock className="h-3.5 w-3.5 text-slate-500" />
                    Timestamp & Target Entity
                  </div>
                  <p className="mt-1.5 text-sm font-bold text-slate-900">
                    {entry.createdAtIst} IST
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-600">
                    Entity: <span className="font-semibold">{entry.entityType}</span>{" "}
                    {entry.entityId ? `(${entry.entityId.slice(0, 12)}…)` : ""}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-slate-400">
                    Audit UUID: {entry.id}
                  </p>
                </div>
              </div>

              {/* Quick Entity Cross-Links */}
              {(entry.orderId ||
                entry.paymentId ||
                entry.ticketNumber ||
                entry.customerId ||
                entry.sellerId) && (
                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <div className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                    Linked Operational Records
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {entry.orderId && (
                      <Link
                        href={`/admin/orders/${entry.orderId}`}
                        onClick={() => setOpen(false)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-100"
                      >
                        Order: {entry.orderNumber || `${entry.orderId.slice(0, 8)}…`}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                    {entry.paymentId && (
                      <Link
                        href={`/admin/payments/${entry.paymentId}`}
                        onClick={() => setOpen(false)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                      >
                        Payment: {entry.paymentId.slice(0, 8)}…
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                    {entry.ticketNumber && (
                      <Link
                        href={`/admin/tickets?q=${encodeURIComponent(
                          entry.ticketNumber.split(" ")[0]
                        )}`}
                        onClick={() => setOpen(false)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-800 hover:bg-purple-100"
                      >
                        Ticket: {entry.ticketNumber}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                    {entry.customerId && (
                      <Link
                        href={`/admin/customers?q=${encodeURIComponent(entry.customerId)}`}
                        onClick={() => setOpen(false)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                      >
                        Customer: {entry.customerId.slice(0, 8)}…
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                    {(entry.sellerCode || entry.sellerId) && (
                      <Link
                        href="/admin/sellers"
                        onClick={() => setOpen(false)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-800 hover:bg-indigo-100"
                      >
                        Seller: {entry.sellerCode || `${entry.sellerId?.slice(0, 8)}…`}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                </div>
              )}

              {/* Reason / Summary Note */}
              {entry.reason && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5">
                  <div className="text-[11px] font-bold tracking-wider text-amber-800 uppercase">
                    Recorded Reason / Operational Note
                  </div>
                  <p className="mt-1 text-sm font-medium text-amber-950">
                    {entry.reason}
                  </p>
                </div>
              )}

              {/* Before / After Comparison Table */}
              {diffKeys.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-700">
                    Before vs. After State Comparison
                  </div>
                  <div className="divide-y divide-slate-100 bg-white">
                    {diffKeys.map((key) => {
                      const beforeStr = formatFieldValue(entry.oldValue?.[key]);
                      const afterStr = formatFieldValue(entry.newValue?.[key]);
                      const changed = beforeStr !== afterStr;
                      return (
                        <div
                          key={key}
                          className={`grid grid-cols-1 gap-2 px-4 py-2.5 text-xs sm:grid-cols-12 sm:items-center ${
                            changed ? "bg-amber-50/30" : ""
                          }`}
                        >
                          <div className="font-mono font-semibold text-slate-700 sm:col-span-4">
                            {key}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 sm:col-span-8">
                            <span className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 font-mono text-[11px] text-rose-800 break-all">
                              {beforeStr}
                            </span>
                            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-900 break-all">
                              {afterStr}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Sanitized Metadata JSON */}
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                    <FileCode2 className="h-3.5 w-3.5 text-slate-500" />
                    Sanitized Audit Metadata (Secrets Redacted)
                  </span>
                  <span className="text-[10px] font-semibold text-emerald-700 uppercase">
                    Append-Only Protected
                  </span>
                </div>
                <pre className="max-h-60 overflow-auto bg-slate-900 p-4 font-mono text-xs text-slate-100">
                  {JSON.stringify(entry.sanitizedMetadata, null, 2)}
                </pre>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3">
              <span className="text-xs text-slate-500">
                Protected by PostgreSQL trigger{" "}
                <code className="font-mono text-[11px] text-slate-700">
                  trg_protect_audit_logs_append_only
                </code>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

