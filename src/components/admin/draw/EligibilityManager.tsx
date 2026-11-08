"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Lock,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  UserX,
  FileCheck,
  RefreshCw,
  Hash,
  Copy,
  Check,
} from "lucide-react";
import {
  getEligibleTickets,
  createManualExclusion,
  removeManualExclusion,
  lockEligibilitySnapshot,
} from "@/server/actions/luckyDraw";
import type {
  PrizeItem,
  EligibleTicketRosterItem,
  EligibilitySnapshot,
} from "@/lib/draw/types";

type Props = {
  campaignId: string;
  activePrize: PrizeItem | null;
  drawId: string;
  activeSnapshot: EligibilitySnapshot | null;
  onSnapshotLocked: () => void;
};

export function EligibilityManager({
  campaignId,
  activePrize,
  drawId,
  activeSnapshot,
  onSnapshotLocked,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [tickets, setTickets] = useState<EligibleTicketRosterItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [eligibleCount, setEligibleCount] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "ELIGIBLE_ONLY" | "EXCLUDED_ONLY" | "WON_ONLY">("ALL");
  const [page, setPage] = useState(1);
  const [copiedHash, setCopiedHash] = useState(false);

  // Modal states
  const [excludeTicket, setExcludeTicket] = useState<EligibleTicketRosterItem | null>(null);
  const [exclusionReason, setExclusionReason] = useState("");
  const [isLockConfirmOpen, setIsLockConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const isLocked = !!activeSnapshot?.is_locked;

  const loadTickets = useCallback(async () => {
    if (!campaignId || !activePrize) return;
    setLoading(true);
    setActionError(null);
    try {
      const res = await getEligibleTickets(campaignId, activePrize.id, {
        page,
        limit: 25,
        search,
        filter,
      });

      if (res.success && res.data) {
        setTickets(res.data.tickets);
        setTotalCount(res.data.totalCount);
        setEligibleCount(res.data.eligibleCount);
      } else {
        setActionError(res.error || "Failed to load ticket roster.");
      }
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [campaignId, activePrize, page, search, filter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTickets();
  }, [loadTickets]);

  const handleCreateExclusion = async () => {
    if (!excludeTicket || !activePrize) return;
    if (exclusionReason.trim().length < 5) {
      setActionError("Exclusion reason must be at least 5 characters.");
      return;
    }

    setActionLoading(true);
    setActionError(null);
    try {
      const res = await createManualExclusion({
        drawId,
        prizeId: activePrize.id,
        ticketId: excludeTicket.id,
        reason: exclusionReason.trim(),
      });

      if (res.success) {
        setExcludeTicket(null);
        setExclusionReason("");
        loadTickets();
      } else {
        setActionError(res.error || "Failed to exclude ticket.");
      }
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveExclusion = async (exclusionId: string) => {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await removeManualExclusion(exclusionId);
      if (res.success) {
        loadTickets();
      } else {
        setActionError(res.error || "Failed to remove exclusion.");
      }
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleLockSnapshot = async () => {
    if (!activePrize) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await lockEligibilitySnapshot({
        drawId,
        prizeId: activePrize.id,
      });

      if (res.success) {
        setIsLockConfirmOpen(false);
        onSnapshotLocked();
      } else {
        setActionError(res.error || "Failed to lock eligibility snapshot.");
      }
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCopyHash = () => {
    if (!activeSnapshot?.snapshot_hash) return;
    navigator.clipboard.writeText(activeSnapshot.snapshot_hash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  if (!activePrize) {
    return (
      <div className="rounded-2xl border border-[#eadbcf] bg-white p-8 text-center text-[#705a54]">
        All scheduled prizes for this campaign have been successfully drawn.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-4 rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[#fef2f2] px-3 py-1 text-xs font-bold text-[#7c1619] border border-[#fecaca]">
              Target: {activePrize.prize_number === 1 ? "1st Prize (Grand Prize)" : `${activePrize.prize_number}th Prize`}
            </span>
            <span className="text-xs font-semibold text-[#705a54]">
              {activePrize.title}
            </span>
          </div>
          <h2 className="mt-2 text-xl font-bold text-[#2d1810]">
            Eligibility Roster & Snapshot Center
          </h2>
          <p className="text-xs text-[#705a54]">
            Review candidates, record administrative exclusions, and commit an immutable snapshot.
          </p>
        </div>

        {/* Lock / Snapshot Status */}
        <div className="flex items-center gap-3">
          {isLocked ? (
            <div className="flex flex-col items-end">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3.5 py-1.5 text-xs font-bold text-emerald-800 border border-emerald-300">
                <Lock size={14} />
                Snapshot Locked & Immutable
              </span>
              <span className="mt-1 text-[11px] text-[#705a54]">
                {new Date(activeSnapshot.locked_at).toLocaleString("en-IN")}
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsLockConfirmOpen(true)}
              disabled={eligibleCount === 0 || actionLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-[#7c1619] px-5 py-2.5 text-xs font-semibold text-white shadow hover:bg-[#681215] transition-colors disabled:opacity-50"
            >
              <FileCheck size={16} />
              Lock Eligibility Snapshot ({eligibleCount})
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="rounded-xl bg-red-50 p-4 border border-red-200 text-red-800 text-xs flex items-start gap-2">
          <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Snapshot Hash Banner (if locked) */}
      {isLocked && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Hash size={16} className="text-emerald-700" />
              <span className="font-semibold text-emerald-900">Canonical Roster Digest (SHA-256):</span>
              <span className="font-mono text-[11px] font-bold text-[#2d1810] bg-white px-2.5 py-1 rounded border border-emerald-200">
                {activeSnapshot.snapshot_hash}
              </span>
            </div>
            <button
              type="button"
              onClick={handleCopyHash}
              className="text-xs font-semibold text-[#7c1619] hover:underline flex items-center gap-1"
            >
              {copiedHash ? <Check size={14} /> : <Copy size={14} />}
              {copiedHash ? "Copied" : "Copy Hash"}
            </button>
          </div>
          <div className="mt-2 text-[11px] text-emerald-800">
            Algorithm: <code>{activeSnapshot.algorithm_version}</code> &bull; Verified Candidates:{" "}
            <strong>{activeSnapshot.total_eligible_count}</strong> &bull; Disqualified Previous Winners:{" "}
            <strong>{activeSnapshot.previous_winner_count}</strong> &bull; Manual Exclusions:{" "}
            <strong>{activeSnapshot.manual_exclusion_count}</strong>
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-[#eadbcf] bg-white p-4 shadow-2xl sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#705a54]" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search ticket number (e.g. SSFI-000042)..."
            className="w-full rounded-xl border border-[#eadbcf] pl-9 pr-3 py-2 text-xs text-[#2d1810] focus:border-[#7c1619] focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter size={14} className="text-[#705a54]" />
          <select
            value={filter}
            onChange={(e) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              setFilter(e.target.value as any);
              setPage(1);
            }}
            className="rounded-xl border border-[#eadbcf] bg-white px-3 py-2 text-xs font-medium text-[#2d1810] focus:border-[#7c1619] focus:outline-none"
          >
            <option value="ALL">All Issued Tickets</option>
            <option value="ELIGIBLE_ONLY">Eligible Only ({eligibleCount})</option>
            <option value="EXCLUDED_ONLY">Manually Excluded</option>
            <option value="WON_ONLY">Previous Winners</option>
          </select>

          <button
            type="button"
            onClick={loadTickets}
            className="rounded-xl border border-[#eadbcf] p-2 text-[#705a54] hover:text-[#7c1619] hover:bg-[#fffaf7]"
            title="Refresh Roster"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Roster Table */}
      <div className="overflow-hidden rounded-2xl border border-[#eadbcf] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#2d1810]">
            <thead className="border-b border-[#eadbcf] bg-[#fffaf7] text-[11px] font-bold uppercase tracking-wider text-[#705a54]">
              <tr>
                <th className="py-3 px-4">Ticket Number</th>
                <th className="py-3 px-4">Supporter / Customer</th>
                <th className="py-3 px-4">Attributed Seller</th>
                <th className="py-3 px-4">Eligibility Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0e7df]">
              {tickets.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#705a54]">
                    {loading ? "Loading candidate tickets..." : "No tickets matching your filter."}
                  </td>
                </tr>
              ) : (
                tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-[#fffaf7]/60 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-[#7c1619]">
                      {t.ticket_number}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[#2d1810]">{t.customer_name}</div>
                      <div className="text-[11px] text-[#705a54]">{t.customer_phone || "No phone"}</div>
                    </td>
                    <td className="py-3 px-4">
                      {t.seller_name ? (
                        <div>
                          <span className="font-medium text-[#2d1810]">{t.seller_name}</span>{" "}
                          <span className="text-[11px] text-[#705a54]">({t.seller_code})</span>
                        </div>
                      ) : (
                        <span className="text-[#705a54] italic">Direct / Committee</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {t.is_eligible && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                          <CheckCircle2 size={12} />
                          Eligible
                        </span>
                      )}
                      {t.is_previous_winner && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-0.5 text-[11px] font-semibold text-purple-800">
                          Won Prize #{t.previous_prize_number}
                        </span>
                      )}
                      {t.is_excluded && (
                        <div className="inline-flex flex-col">
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-semibold text-red-800">
                            <XCircle size={12} />
                            Excluded
                          </span>
                          <span className="text-[10px] text-red-600 mt-0.5 max-w-xs truncate" title={t.exclusion_reason}>
                            {t.exclusion_reason}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {!isLocked && (
                        <>
                          {t.is_eligible && (
                            <button
                              type="button"
                              onClick={() => setExcludeTicket(t)}
                              className="rounded-lg border border-red-200 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50"
                            >
                              Exclude
                            </button>
                          )}
                          {t.is_excluded && t.exclusion_id && (
                            <button
                              type="button"
                              onClick={() => handleRemoveExclusion(t.exclusion_id!)}
                              disabled={actionLoading}
                              className="rounded-lg border border-[#eadbcf] px-2.5 py-1 text-[11px] font-semibold text-[#594541] hover:bg-[#fffaf7]"
                            >
                              Re-include
                            </button>
                          )}
                        </>
                      )}
                      {isLocked && <span className="text-[11px] text-[#705a54] italic">Locked</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalCount > 25 && (
          <div className="flex items-center justify-between border-t border-[#eadbcf] px-4 py-3 bg-[#fffaf7]">
            <span className="text-xs text-[#705a54]">
              Showing {tickets.length} of {totalCount} records
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-[#eadbcf] bg-white px-3 py-1 text-xs font-semibold text-[#594541] disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={tickets.length < 25 || page * 25 >= totalCount}
                className="rounded-lg border border-[#eadbcf] bg-white px-3 py-1 text-xs font-semibold text-[#594541] disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Manual Exclusion Modal */}
      {excludeTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-[#eadbcf]">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-red-700">
                <UserX size={20} />
              </div>
              <div>
                <h3 className="font-bold text-base text-[#2d1810]">Exclude Ticket from Draw</h3>
                <p className="text-xs text-[#705a54]">Ticket: {excludeTicket.ticket_number}</p>
              </div>
            </div>

            <p className="text-xs text-[#594541] mb-3">
              Please enter an explicit administrative justification for disqualifying ticket{" "}
              <strong>{excludeTicket.ticket_number}</strong> (Purchased by {excludeTicket.customer_name}). This reason
              will be permanently recorded in the immutable audit log.
            </p>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-[#594541] mb-1">
                Mandatory Exclusion Reason:
              </label>
              <textarea
                value={exclusionReason}
                onChange={(e) => setExclusionReason(e.target.value)}
                placeholder="e.g., Requested refund, duplicate order issue, administrative hold"
                rows={3}
                className="w-full rounded-xl border border-[#eadbcf] p-2.5 text-xs text-[#2d1810] focus:border-[#7c1619] focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setExcludeTicket(null);
                  setExclusionReason("");
                }}
                className="rounded-xl border border-[#eadbcf] px-4 py-2 text-xs font-semibold text-[#594541] hover:bg-[#fffaf7]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateExclusion}
                disabled={actionLoading || exclusionReason.trim().length < 5}
                className="rounded-xl bg-red-700 px-5 py-2 text-xs font-semibold text-white shadow hover:bg-red-800 disabled:opacity-50"
              >
                {actionLoading ? "Excluding..." : "Confirm Disqualification"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lock Snapshot Confirmation Modal */}
      {isLockConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-[#eadbcf]">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
                <Lock size={20} />
              </div>
              <div>
                <h3 className="font-bold text-base text-[#2d1810]">Lock Eligibility Snapshot</h3>
                <p className="text-xs text-[#705a54]">{activePrize.title}</p>
              </div>
            </div>

            <div className="rounded-xl bg-[#fffaf7] p-4 border border-[#eadbcf] text-xs space-y-2 mb-4">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-[#705a54]">Total Eligible Tickets:</span>
                <span className="font-bold text-[#7c1619] text-sm">{eligibleCount} Tickets</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-[#705a54]">Prize Tier:</span>
                <span className="font-bold text-[#2d1810]">Prize #{activePrize.prize_number}</span>
              </div>
            </div>

            <div className="rounded-xl bg-amber-50 p-3 border border-amber-200 text-amber-900 text-xs flex items-start gap-2 mb-6">
              <AlertTriangle size={18} className="text-amber-700 shrink-0 mt-0.5" />
              <span>
                <strong>Warning — Permanent Immutability:</strong> Locking this snapshot will generate a canonical SHA-256 hash across all eligible tickets in natural ascending order. Once locked, no tickets may be added, removed, or re-included for this prize draw.
              </span>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsLockConfirmOpen(false)}
                className="rounded-xl border border-[#eadbcf] px-4 py-2 text-xs font-semibold text-[#594541] hover:bg-[#fffaf7]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLockSnapshot}
                disabled={actionLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-[#7c1619] px-5 py-2.5 text-xs font-semibold text-white shadow hover:bg-[#681215] disabled:opacity-50"
              >
                <Lock size={14} />
                {actionLoading ? "Locking..." : "Confirm & Lock Snapshot"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

