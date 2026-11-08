"use client";

import { useState } from "react";
import { ShieldAlert, ShieldCheck, UserCheck, AlertOctagon, CheckCircle2, XCircle } from "lucide-react";
import { requestFirstPrizeApproval, recordFirstPrizeApproval } from "@/server/actions/luckyDraw";
import type { DrawApproval, EligibilitySnapshot } from "@/lib/draw/types";

type Props = {
  drawId: string;
  prizeId: string;
  snapshot: EligibilitySnapshot;
  approval: DrawApproval | null;
  currentUser: {
    userId: string;
    email: string;
    isSuperAdmin: boolean;
    isAdmin: boolean;
  };
  onUpdated: () => void;
};

export function FirstPrizeApprovalCard({
  drawId,
  prizeId,
  snapshot,
  approval,
  currentUser,
  onUpdated,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isInitiator = approval?.initiator_id === currentUser.userId;
  const canInitiate = currentUser.isSuperAdmin && !approval;
  const canReview = (currentUser.isAdmin || currentUser.isSuperAdmin) && approval?.status === "PENDING" && !isInitiator;

  const handleInitiate = async () => {
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await requestFirstPrizeApproval({
        drawId,
        prizeId,
        snapshotId: snapshot.id,
      });

      if (res.success) {
        setSuccessMsg("1st Prize dual-authorization request successfully initiated.");
        onUpdated();
      } else {
        setError(res.error || "Failed to initiate dual authorization.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecision = async (decision: "APPROVED" | "REJECTED") => {
    if (!approval) return;
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await recordFirstPrizeApproval({
        approvalId: approval.id,
        decision,
        notes,
      });

      if (res.success) {
        setSuccessMsg(`1st Prize draw authorization ${decision.toLowerCase()} successfully.`);
        onUpdated();
      } else {
        setError(res.error || `Failed to record ${decision.toLowerCase()} decision.`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-red-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-[#f0e7df] pb-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-[#7c1619] border border-red-300">
            <ShieldAlert size={22} />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#2d1810]">
              First Prize Dual-Authorization Protocol (Policy A)
            </h3>
            <p className="text-xs text-[#705a54]">
              Two-person integrity control required prior to executing the 1st Prize Grand Draw
            </p>
          </div>
        </div>

        {approval && (
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
              approval.status === "APPROVED"
                ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                : approval.status === "REJECTED"
                ? "bg-red-100 text-red-800 border border-red-300"
                : "bg-amber-100 text-amber-800 border border-amber-300"
            }`}
          >
            {approval.status === "APPROVED" && <CheckCircle2 size={14} />}
            {approval.status === "REJECTED" && <XCircle size={14} />}
            {approval.status === "PENDING" && <UserCheck size={14} />}
            {approval.status}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 p-3.5 border border-red-200 text-red-800 text-xs flex items-start gap-2">
          <AlertOctagon size={16} className="text-red-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="mb-4 rounded-xl bg-emerald-50 p-3.5 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2">
          <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Snapshot Binding Details */}
      <div className="mb-4 rounded-xl bg-[#fffaf7] p-4 border border-[#eadbcf] text-xs space-y-2">
        <div className="flex justify-between items-center">
          <span className="font-semibold text-[#705a54]">Bound Snapshot Hash:</span>
          <span className="font-mono text-[11px] font-bold text-[#7c1619] bg-white px-2 py-0.5 rounded border border-[#e8d6c5]">
            {snapshot.snapshot_hash.slice(0, 16)}...{snapshot.snapshot_hash.slice(-16)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="font-semibold text-[#705a54]">Eligible Candidate Count:</span>
          <span className="font-bold text-[#2d1810]">{snapshot.total_eligible_count} Tickets</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="font-semibold text-[#705a54]">Snapshot Locked At:</span>
          <span className="text-[#594541]">{new Date(snapshot.locked_at).toLocaleString("en-IN")}</span>
        </div>
      </div>

      {/* STATE 1: NOT YET INITIATED */}
      {!approval && (
        <div className="rounded-xl border border-dashed border-red-300 bg-red-50/50 p-4 text-center">
          <p className="text-xs text-[#594541] mb-3">
            The eligibility snapshot for the 1st Prize is locked. A user with the{" "}
            <strong>SUPER_ADMIN</strong> role must initiate the authorization request.
          </p>
          {canInitiate ? (
            <button
              type="button"
              onClick={handleInitiate}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-[#7c1619] px-5 py-2.5 text-xs font-semibold text-white shadow hover:bg-[#681215] disabled:opacity-50"
            >
              <ShieldCheck size={16} />
              {submitting ? "Initiating Request..." : "Initiate 1st Prize Approval (SUPER_ADMIN)"}
            </button>
          ) : (
            <div className="text-xs font-semibold text-red-700">
              Only an authenticated SUPER_ADMIN can initiate 1st Prize approval. You are currently logged in as{" "}
              {currentUser.email}.
            </div>
          )}
        </div>
      )}

      {/* STATE 2: PENDING APPROVAL */}
      {approval && approval.status === "PENDING" && (
        <div className="space-y-4">
          <div className="rounded-xl bg-amber-50 p-4 border border-amber-200 text-xs">
            <div className="font-bold text-amber-900 mb-1 flex items-center gap-2">
              <UserCheck size={16} className="text-amber-700" />
              Pending Independent Review & Sign-Off
            </div>
            <p className="text-amber-800 mb-2">
              Initiated by: <strong>{approval.initiator_email || "SUPER_ADMIN"}</strong> at{" "}
              {new Date(approval.requested_at).toLocaleString("en-IN")}
            </p>

            {isInitiator && (
              <div className="mt-2 rounded-lg bg-red-100 p-2.5 text-red-900 font-semibold border border-red-200">
                Policy A Enforcement: You initiated this request ({currentUser.email}). Self-approval is strictly prohibited by database constraints. A distinct administrator or super administrator must review and sign off.
              </div>
            )}
          </div>

          {canReview && (
            <div className="rounded-xl border border-[#eadbcf] p-4 bg-white space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#594541] mb-1">
                  Reviewer Notes / Sign-Off Comments (Optional):
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Enter audit review notes (e.g. Verified candidate roster and physical drum setup)"
                  rows={2}
                  className="w-full rounded-lg border border-[#eadbcf] p-2.5 text-xs text-[#2d1810] focus:border-[#7c1619] focus:outline-none"
                />
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => handleDecision("REJECTED")}
                  disabled={submitting}
                  className="rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  {submitting ? "Processing..." : "Reject 1st Prize Draw"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDecision("APPROVED")}
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2 text-xs font-semibold text-white shadow hover:bg-emerald-800 disabled:opacity-50"
                >
                  <CheckCircle2 size={16} />
                  {submitting ? "Processing..." : "Approve 1st Prize Draw"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STATE 3: DECISION RECORDED */}
      {approval && approval.status !== "PENDING" && (
        <div className="rounded-xl bg-[#fffaf7] p-4 border border-[#eadbcf] text-xs space-y-2">
          <div className="flex justify-between items-center border-b border-[#f0e7df] pb-2">
            <span className="font-semibold text-[#705a54]">Initiated By:</span>
            <span className="font-bold text-[#2d1810]">{approval.initiator_email || approval.initiator_id}</span>
          </div>
          <div className="flex justify-between items-center border-b border-[#f0e7df] pb-2">
            <span className="font-semibold text-[#705a54]">Reviewed By:</span>
            <span className="font-bold text-[#2d1810]">{approval.approver_email || approval.approver_id}</span>
          </div>
          <div className="flex justify-between items-center border-b border-[#f0e7df] pb-2">
            <span className="font-semibold text-[#705a54]">Reviewed At:</span>
            <span className="text-[#594541]">{approval.reviewed_at ? new Date(approval.reviewed_at).toLocaleString("en-IN") : "N/A"}</span>
          </div>
          {approval.review_notes && (
            <div>
              <span className="font-semibold text-[#705a54] block mb-0.5">Audit Notes:</span>
              <p className="text-[#594541] italic bg-white p-2 rounded border border-[#f0e7df]">{approval.review_notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

