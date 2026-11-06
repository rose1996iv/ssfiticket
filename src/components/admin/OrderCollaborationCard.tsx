"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FileText,
  Loader2,
  Lock,
  MessageSquarePlus,
  Send,
  Users,
} from "lucide-react";
import {
  type CollabNoteType,
  type CollabVisibility,
  type OrderCollaborationNoteItem,
  createOrderCollaborationNote,
  resolveOrderCollaborationNote,
} from "@/server/actions/orderCollaboration";

type Props = {
  orderId: string;
  paymentId?: string | null;
  viewerRole: "STAFF" | "SELLER";
  initialNotes: OrderCollaborationNoteItem[];
};

const NOTE_TYPE_LABELS: Record<CollabNoteType, string> = {
  SELLER_REVIEW_NOTE: "Seller Review Note",
  SELLER_RECOMMENDATION: "Seller Recommendation",
  ADMIN_INSTRUCTION: "Admin Instruction",
  CLARIFICATION_REQUEST: "Clarification Request",
  SELLER_RESPONSE: "Seller Response",
  SUPPORTING_EVIDENCE: "Supporting Evidence",
  ISSUE_RESOLVED: "Resolved Review Issue",
  CUSTOMER_NOTICE: "Customer-Visible Notice",
};

const VISIBILITY_BADGES: Record<
  CollabVisibility,
  { label: string; className: string }
> = {
  ADMIN_ONLY: {
    label: "Admin-Only (Private)",
    className: "border-purple-200 bg-purple-100 text-purple-900",
  },
  SELLER_AND_ADMIN: {
    label: "Seller & Admin",
    className: "border-blue-200 bg-blue-100 text-blue-900",
  },
  CUSTOMER_VISIBLE: {
    label: "Customer-Visible",
    className: "border-emerald-200 bg-emerald-100 text-emerald-900",
  },
};

export function OrderCollaborationCard({
  orderId,
  paymentId,
  viewerRole,
  initialNotes,
}: Props) {
  const router = useRouter();
  const [noteType, setNoteType] = useState<CollabNoteType>(
    viewerRole === "STAFF" ? "ADMIN_INSTRUCTION" : "SELLER_RESPONSE"
  );
  const [visibility, setVisibility] = useState<CollabVisibility>(
    viewerRole === "STAFF" ? "SELLER_AND_ADMIN" : "SELLER_AND_ADMIN"
  );
  const [body, setBody] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const staffNoteTypes: CollabNoteType[] = [
    "ADMIN_INSTRUCTION",
    "CLARIFICATION_REQUEST",
    "SUPPORTING_EVIDENCE",
    "ISSUE_RESOLVED",
    "CUSTOMER_NOTICE",
  ];

  const sellerNoteTypes: CollabNoteType[] = [
    "SELLER_RESPONSE",
    "SELLER_REVIEW_NOTE",
    "SELLER_RECOMMENDATION",
    "SUPPORTING_EVIDENCE",
  ];

  const availableTypes = viewerRole === "STAFF" ? staffNoteTypes : sellerNoteTypes;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    const res = await createOrderCollaborationNote({
      orderId,
      paymentId: paymentId ?? null,
      noteType,
      visibility: viewerRole === "SELLER" ? "SELLER_AND_ADMIN" : visibility,
      body,
      evidenceReference: evidenceReference.trim() || null,
    });

    setLoading(false);

    if (!res.success) {
      setError(res.error || "Failed to post collaboration note.");
      return;
    }

    setBody("");
    setEvidenceReference("");
    setSuccessMsg("Collaboration note recorded and logged in the append-only audit trail.");
    router.refresh();
  };

  const handleResolve = async (noteId: string) => {
    setResolvingId(noteId);
    setError(null);
    const res = await resolveOrderCollaborationNote(noteId);
    setResolvingId(null);
    if (!res.success) {
      setError(res.error || "Failed to resolve issue.");
      return;
    }
    router.refresh();
  };

  return (
    <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f0e7df] pb-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#7c1619]">
            Order Review &amp; Collaboration
          </span>
          <h2 className="mt-0.5 font-serif text-lg font-bold text-[#35110f]">
            Admin–Seller Communication &amp; Action Thread
          </h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#eadbcf] bg-[#fffaf7] px-3 py-1 text-[11px] font-bold text-[#705a54]">
          <MessageSquarePlus size={13} className="text-[#7c1619]" />
          <span>{initialNotes.length} Thread Entries</span>
        </span>
      </div>

      {/* Existing Notes List */}
      {initialNotes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#eadbcf] bg-[#fffaf7] p-4 text-center text-xs text-[#705a54]">
          No order-specific review notes or clarification requests have been recorded yet.
        </div>
      ) : (
        <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
          {initialNotes.map((note) => {
            const visBadge = VISIBILITY_BADGES[note.visibility] ?? VISIBILITY_BADGES.SELLER_AND_ADMIN;
            return (
              <div
                key={note.id}
                className={`rounded-xl border p-3.5 text-xs ${
                  note.visibility === "ADMIN_ONLY"
                    ? "border-purple-200 bg-purple-50/40"
                    : note.is_resolved
                    ? "border-emerald-200 bg-emerald-50/30"
                    : "border-[#eadbcf] bg-[#fffaf7]"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-[#35110f] px-2 py-0.5 text-[10px] font-bold text-white">
                      {NOTE_TYPE_LABELS[note.note_type] || note.note_type}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${visBadge.className}`}
                    >
                      {note.visibility === "ADMIN_ONLY" ? (
                        <Lock size={10} />
                      ) : note.visibility === "CUSTOMER_VISIBLE" ? (
                        <Eye size={10} />
                      ) : (
                        <Users size={10} />
                      )}
                      {visBadge.label}
                    </span>
                    {note.is_resolved && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                        <CheckCircle2 size={11} />
                        Resolved
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[10px] text-[#705a54]">
                    {new Date(note.created_at).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}
                  </span>
                </div>

                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-[#35110f]">
                  {note.body}
                </p>

                {note.evidence_reference && (
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[#eadbcf] bg-white px-2.5 py-1 text-[11px] text-[#705a54]">
                    <FileText size={12} className="text-[#7c1619]" />
                    <span className="font-semibold text-[#35110f]">Supporting Evidence:</span>
                    <span className="font-mono">{note.evidence_reference}</span>
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#eadbcf]/60 pt-2 text-[10px] text-[#705a54]">
                  <span>
                    Posted by <strong className="text-[#35110f]">{note.author_name}</strong> (
                    {note.author_role})
                  </span>
                  {viewerRole === "STAFF" &&
                    !note.is_resolved &&
                    (note.note_type === "CLARIFICATION_REQUEST" ||
                      note.note_type === "SELLER_REVIEW_NOTE" ||
                      note.note_type === "SELLER_RESPONSE") && (
                      <button
                        type="button"
                        disabled={resolvingId === note.id}
                        onClick={() => handleResolve(note.id)}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 text-[10px] font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50"
                      >
                        {resolvingId === note.id ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={11} />
                        )}
                        <span>Mark Issue Resolved</span>
                      </button>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-700" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* New Note Form */}
      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4"
      >
        <p className="text-xs font-bold text-[#35110f]">
          {viewerRole === "STAFF"
            ? "Post Admin Instruction, Clarification Request, or Internal Note"
            : "Post Seller Review Note, Clarification Response, or Supporting Evidence"}
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
              Action / Note Type
            </label>
            <select
              value={noteType}
              onChange={(e) => {
                const nextType = e.target.value as CollabNoteType;
                setNoteType(nextType);
                if (nextType === "CUSTOMER_NOTICE") {
                  setVisibility("CUSTOMER_VISIBLE");
                }
              }}
              className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-white px-3 py-2 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
            >
              {availableTypes.map((t) => (
                <option key={t} value={t}>
                  {NOTE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
              Visibility Scope
            </label>
            {viewerRole === "STAFF" ? (
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as CollabVisibility)}
                className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-white px-3 py-2 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
              >
                <option value="SELLER_AND_ADMIN">Seller &amp; Admin (Shared Collaboration)</option>
                <option value="ADMIN_ONLY">Admin-Only (Hidden from Seller &amp; Customer)</option>
                <option value="CUSTOMER_VISIBLE">Customer-Visible (Shown on Order Page)</option>
              </select>
            ) : (
              <div className="mt-1 rounded-xl border border-[#eadbcf] bg-white px-3 py-2 text-xs font-semibold text-[#35110f]">
                Seller &amp; Admin (Internal Review Thread)
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
            Message / Review Details *
          </label>
          <textarea
            required
            minLength={2}
            maxLength={2000}
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              viewerRole === "STAFF"
                ? "Enter instruction, clarification request for seller, or internal verification note..."
                : "Enter your response, payment verification note, or explanation for Admin..."
            }
            className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-white p-2.5 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
          />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
              Supporting Evidence Reference (Optional)
            </label>
            <input
              type="text"
              maxLength={500}
              value={evidenceReference}
              onChange={(e) => setEvidenceReference(e.target.value)}
              placeholder="e.g., Bank statement ref, UPI timestamp, or screenshot note"
              className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-white px-3 py-2 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#7c1619] px-4 py-2.5 text-xs font-bold text-white shadow-2xs transition hover:bg-[#631214] disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            <span>Post to Order Thread</span>
          </button>
        </div>
      </form>
    </div>
  );
}

