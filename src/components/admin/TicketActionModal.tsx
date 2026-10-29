"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Save,
  ShieldAlert,
  Ticket,
  XCircle,
} from "lucide-react";
import {
  adminVoidTicketAction,
  adminReissueTicketAction,
  adminUpdateTicketNotesAction,
} from "@/server/actions/tickets";
import { getTicketVerificationUrl } from "@/lib/ticket/qr";

export type AdminTicketDetail = {
  id: string;
  ticket_number: string;
  status: string;
  issued_at: string;
  voided_at?: string | null;
  void_reason?: string | null;
  admin_notes?: string | null;
  original_ticket_id?: string | null;
  reissued_ticket_id?: string | null;
  orders: {
    id: string;
    order_number: string;
    status: string;
    payments?: Array<{
      id: string;
      status: string;
      utr_reference?: string | null;
    }> | null;
  } | null;
  customers: {
    id: string;
    full_name: string;
    phone: string;
  } | null;
  sellers: {
    id: string;
    display_name: string;
    seller_code: string;
  } | null;
};

type Props = {
  ticket: AdminTicketDetail;
  qrDataUrl?: string;
  onClose: () => void;
};

export function TicketActionModal({ ticket, qrDataUrl, onClose }: Props) {
  const [notes, setNotes] = useState(ticket.admin_notes || "");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [notesSuccess, setNotesSuccess] = useState(false);

  // Void modal state
  const [voidMode, setVoidMode] = useState<"VOID" | "REISSUE" | null>(null);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  const verificationUrl = getTicketVerificationUrl(ticket.ticket_number);

  async function handleSaveNotes() {
    setIsSavingNotes(true);
    setNotesSuccess(false);
    const formData = new FormData();
    formData.set("ticketId", ticket.id);
    formData.set("notes", notes);

    try {
      await adminUpdateTicketNotesAction(formData);
      setNotesSuccess(true);
      setTimeout(() => setNotesSuccess(false), 3000);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to update notes.");
    } finally {
      setIsSavingNotes(false);
    }
  }

  async function handleVoidOrReissue() {
    if (!voidMode) return;
    setIsSubmitting(true);
    setActionError(null);
    setActionSuccess(null);

    const formData = new FormData();
    formData.set("ticketId", ticket.id);
    formData.set("reason", reason);

    try {
      if (voidMode === "VOID") {
        const res = await adminVoidTicketAction(formData);
        setActionSuccess(res.message);
      } else {
        const res = await adminReissueTicketAction(formData);
        setActionSuccess(res.message);
      }
      setVoidMode(null);
      setReason("");
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Operation failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(verificationUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isVoid = ticket.status === "VOID";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-2xs">
      <div className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#f0e7df] pb-4">
          <div className="flex items-center gap-2">
            <Ticket className="text-[#7c1619]" size={22} />
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
                SSFI Ticket Inspection & Management
              </span>
              <h2 className="font-mono text-xl font-bold text-[#7c1619]">{ticket.ticket_number}</h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[#705a54] hover:bg-gray-100 font-bold"
          >
            ✕
          </button>
        </div>

        {actionSuccess && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-xs font-semibold text-green-900">
            <CheckCircle2 size={16} className="text-green-600 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {actionError && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-900">
            <AlertTriangle size={16} className="text-red-600 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        {/* QR Code and Overview */}
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {/* QR Code */}
          <div className="flex flex-col items-center justify-center rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-3 text-center">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt={`QR code for ${ticket.ticket_number}`}
                className="h-28 w-28 rounded-lg border border-[#eadbcf] shadow-2xs"
              />
            ) : (
              <div className="h-28 w-28 flex items-center justify-center bg-gray-100 rounded-lg text-xs text-[#705a54]">
                QR Pending
              </div>
            )}
            <span className="mt-2 text-[10px] font-mono text-[#705a54]">Verification Code</span>
          </div>

          {/* Core Info */}
          <div className="space-y-2 sm:col-span-2 text-xs">
            <div className="rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-3">
              <span className="text-[10px] font-semibold text-[#705a54] uppercase">Status</span>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                    isVoid ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"
                  }`}
                >
                  {ticket.status}
                </span>
                {isVoid && ticket.void_reason && (
                  <span className="text-[11px] text-red-700 italic">
                    Reason: {ticket.void_reason}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-3">
                <span className="text-[10px] font-semibold text-[#705a54] uppercase">Customer</span>
                <p className="mt-0.5 font-bold text-[#35110f]">{ticket.customers?.full_name || "—"}</p>
                <p className="font-mono text-[11px] text-[#705a54]">{ticket.customers?.phone || "—"}</p>
              </div>

              <div className="rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-3">
                <span className="text-[10px] font-semibold text-[#705a54] uppercase">Order</span>
                <p className="mt-0.5 font-mono font-bold text-[#7c1619]">
                  {ticket.orders?.order_number || "—"}
                </p>
                <p className="text-[11px] text-[#705a54]">
                  Attributed: {ticket.sellers ? ticket.sellers.seller_code : "Direct"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Public Verification Link */}
        <div className="mt-4 flex items-center justify-between rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-2.5 text-xs">
          <span className="font-mono text-[11px] text-[#705a54] truncate max-w-[280px]">
            {verificationUrl}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 text-[11px] font-bold text-[#7c1619] hover:underline"
            >
              <Copy size={12} />
              <span>{copied ? "Copied!" : "Copy URL"}</span>
            </button>
            <Link
              href={`/verify/${ticket.ticket_number}`}
              target="_blank"
              className="flex items-center gap-1 text-[11px] font-bold text-[#7c1619] hover:underline"
            >
              <ExternalLink size={12} />
              <span>Verify</span>
            </Link>
          </div>
        </div>

        {/* Administrative Notes */}
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-[#35110f]">Administrative Notes</label>
            {notesSuccess && (
              <span className="text-[11px] font-semibold text-green-700">Saved!</span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Corrected phone number / special delivery note"
              className="w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-2.5 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
            />
            <button
              type="button"
              onClick={handleSaveNotes}
              disabled={isSavingNotes}
              className="flex shrink-0 items-center gap-1 rounded-xl bg-[#7c1619] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#631214] disabled:opacity-50"
            >
              {isSavingNotes ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              <span>Save</span>
            </button>
          </div>
        </div>

        {/* Void / Reissue Actions (Admin and Super Admin only) */}
        {!isVoid && (
          <div className="mt-5 border-t border-[#f0e7df] pt-4">
            <span className="text-xs font-bold text-[#35110f]">Authorized Ticket Mutations</span>
            <p className="text-[11px] text-[#705a54] mt-0.5">
              Soft-deletes this ticket entry from prize draw eligibility. Audit trail recorded.
            </p>

            {voidMode === null ? (
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => setVoidMode("VOID")}
                  className="flex-1 rounded-xl border border-red-200 bg-red-50/70 py-2.5 text-xs font-bold text-red-800 transition hover:bg-red-100"
                >
                  Void Ticket
                </button>
                <button
                  type="button"
                  onClick={() => setVoidMode("REISSUE")}
                  className="flex-1 rounded-xl border border-amber-300 bg-amber-50/70 py-2.5 text-xs font-bold text-amber-900 transition hover:bg-amber-100"
                >
                  Void & Reissue Replacement
                </button>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50/50 p-4 space-y-3">
                <div className="flex items-center gap-2 text-red-900 font-bold text-xs">
                  <ShieldAlert size={16} />
                  <span>
                    {voidMode === "VOID"
                      ? "Confirm Soft-Voiding Ticket"
                      : "Confirm Void & Reissue Replacement"}
                  </span>
                </div>
                <p className="text-xs text-red-800 leading-relaxed">
                  {voidMode === "VOID"
                    ? "This will mark the ticket as VOID. It will be disqualified from winning any prizes. This action is permanently logged."
                    : "This will disqualify this ticket and sequentially generate a new ticket number for the customer, triggering updated delivery."}
                </p>

                <div>
                  <label className="block text-[11px] font-bold text-[#35110f]">
                    Mandatory Reason (min 3 characters):
                  </label>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Customer cancelled order / typo in customer record"
                    className="mt-1 w-full rounded-xl border border-red-300 bg-white p-2.5 text-xs text-[#35110f] focus:outline-hidden"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setVoidMode(null);
                      setReason("");
                    }}
                    className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting || reason.trim().length < 3}
                    onClick={handleVoidOrReissue}
                    className="flex items-center gap-1.5 rounded-xl bg-red-700 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-red-800 disabled:opacity-50"
                  >
                    {isSubmitting && <Loader2 size={12} className="animate-spin" />}
                    <span>{voidMode === "VOID" ? "Confirm Void" : "Confirm Reissue"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {isVoid && (
          <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-700 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-red-800">
              <XCircle size={15} />
              <span>Ticket is Soft-Voided</span>
            </div>
            {ticket.void_reason && <p>Reason: {ticket.void_reason}</p>}
            {ticket.voided_at && (
              <p className="text-[11px] text-gray-500">
                Voided on {new Date(ticket.voided_at).toLocaleString("en-IN")}
              </p>
            )}
            {ticket.reissued_ticket_id && (
              <p className="font-semibold text-emerald-800">
                A replacement ticket was issued.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
