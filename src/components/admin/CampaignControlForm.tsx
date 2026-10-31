"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Flame,
  Info,
  Loader2,
  Lock,
  PauseCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  StopCircle,
  Zap,
} from "lucide-react";
import {
  updateCampaignSchedule,
  updateCampaignStatus,
  syncCampaignSchedule,
} from "@/server/actions/campaign";
import {
  toIstDatetimeLocalString,
  formatIstDateTime,
  evaluateCampaignSchedule,
} from "@/lib/date/timezone";

type Props = {
  campaign: {
    id: string;
    public_id: string;
    name: string;
    description: string | null;
    status: string;
    start_at: string | null;
    end_at: string | null;
    ticket_price_paise: number;
    total_ticket_limit: number;
    sold_ticket_count: number;
    updated_at: string;
  };
};

export function CampaignControlForm({ campaign }: Props) {
  const [startInput, setStartInput] = useState(toIstDatetimeLocalString(campaign.start_at));
  const [endInput, setEndInput] = useState(toIstDatetimeLocalString(campaign.end_at));

  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [scheduleSuccess, setScheduleSuccess] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusSuccess, setStatusSuccess] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [isSyncingSchedule, setIsSyncingSchedule] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Confirmation modal states
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    targetStatus: "ACTIVE" | "PAUSED" | "CLOSED" | "DRAFT" | null;
    requireInputText?: string;
  }>({ isOpen: false, targetStatus: null });

  const [confirmInput, setConfirmInput] = useState("");

  const scheduleAnalysis = evaluateCampaignSchedule(
    campaign.status,
    campaign.start_at,
    campaign.end_at
  );

  async function handleManualSync() {
    setIsSyncingSchedule(true);
    setSyncMessage(null);
    try {
      const res = await syncCampaignSchedule();
      if (!res.success) {
        setSyncMessage(res.error || "Schedule synchronization failed.");
      } else if (res.transitionCount > 0) {
        setSyncMessage(`Scheduler successfully executed ${res.transitionCount} transition(s).`);
      } else {
        setSyncMessage("Schedule is up to date. No pending transitions were due.");
      }
    } catch (err: unknown) {
      setSyncMessage(err instanceof Error ? err.message : "Schedule synchronization failed.");
    } finally {
      setIsSyncingSchedule(false);
    }
  }

  async function handleScheduleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSavingSchedule(true);
    setScheduleSuccess(null);
    setScheduleError(null);

    const formData = new FormData(e.currentTarget);
    formData.set("campaignId", campaign.id);
    formData.set("publicId", campaign.public_id);
    formData.set("startAt", startInput);
    formData.set("endAt", endInput);

    try {
      const res = await updateCampaignSchedule(formData);
      if (!res.success) {
        setScheduleError(res.error || "Failed to update campaign schedule.");
      } else {
        setScheduleSuccess(res.message || "Campaign schedule updated successfully.");
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setScheduleError(err.message);
      } else {
        setScheduleError("Failed to update campaign schedule.");
      }
    } finally {
      setIsSavingSchedule(false);
    }
  }

  async function triggerStatusChange(targetStatus: "ACTIVE" | "PAUSED" | "CLOSED" | "DRAFT") {
    setIsUpdatingStatus(true);
    setStatusSuccess(null);
    setStatusError(null);

    const formData = new FormData();
    formData.set("campaignId", campaign.id);
    formData.set("publicId", campaign.public_id);
    formData.set("status", targetStatus);
    formData.set("confirmCode", confirmInput.trim());

    try {
      const res = await updateCampaignStatus(formData);
      if (!res.success) {
        setStatusError(res.error || "Failed to change campaign status.");
      } else {
        setStatusSuccess(res.message || `Campaign status successfully changed to ${targetStatus}.`);
        setConfirmModal({ isOpen: false, targetStatus: null });
        setConfirmInput("");
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setStatusError(err.message);
      } else {
        setStatusError("Failed to change campaign status.");
      }
    } finally {
      setIsUpdatingStatus(false);
    }
  }

  function openConfirm(targetStatus: "ACTIVE" | "PAUSED" | "CLOSED" | "DRAFT", requireText?: string) {
    setStatusError(null);
    setStatusSuccess(null);
    setConfirmInput("");
    setConfirmModal({
      isOpen: true,
      targetStatus,
      requireInputText: requireText,
    });
  }

  return (
    <div className="space-y-8">
      {/* Live Schedule State Card */}
      <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#f0e7df] pb-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-[#705a54]">
              Public Campaign Identifier
            </span>
            <p className="font-mono text-sm font-bold text-[#7c1619]">{campaign.public_id}</p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#705a54]">Current Status:</span>
            <span
              className={`rounded-full px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider ${
                campaign.status === "ACTIVE"
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                  : campaign.status === "PAUSED"
                  ? "bg-amber-100 text-amber-900 border border-amber-300"
                  : campaign.status === "CLOSED"
                  ? "bg-gray-100 text-gray-800 border border-gray-300"
                  : "bg-blue-100 text-blue-900 border border-blue-300"
              }`}
            >
              {campaign.status}
            </span>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                scheduleAnalysis.isSellingOpen
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-800"
              }`}
            >
              {scheduleAnalysis.badgeLabel}
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 text-xs">
          <div className="rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-3.5">
            <p className="font-semibold text-[#705a54] flex items-center gap-1.5">
              <Calendar size={13} className="text-[#7c1619]" />
              Opening Time (IST)
            </p>
            <p className="mt-1 font-mono text-sm font-bold text-[#35110f]">
              {formatIstDateTime(campaign.start_at)}
            </p>
          </div>

          <div className="rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-3.5">
            <p className="font-semibold text-[#705a54] flex items-center gap-1.5">
              <Clock size={13} className="text-[#7c1619]" />
              Closing Time (IST)
            </p>
            <p className="mt-1 font-mono text-sm font-bold text-[#35110f]">
              {formatIstDateTime(campaign.end_at)}
            </p>
          </div>
        </div>
      </div>

      {/* Schedule Configuration Form */}
      <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xs sm:p-8">
        <div className="mb-6 flex items-center gap-2">
          <Clock className="text-[#7c1619]" size={20} />
          <div>
            <h2 className="text-lg font-bold text-[#35110f]">Selling Window Schedule</h2>
            <p className="text-xs text-[#705a54]">
              Set the official opening and closing timestamps in Indian Standard Time (IST).
            </p>
          </div>
        </div>

        {scheduleSuccess && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-xs font-semibold text-emerald-900">
            <CheckCircle2 size={16} className="text-emerald-700 shrink-0" />
            <span>{scheduleSuccess}</span>
          </div>
        )}

        {scheduleError && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 p-4 text-xs font-semibold text-red-900">
            <AlertTriangle size={16} className="text-red-700 shrink-0" />
            <span>{scheduleError}</span>
          </div>
        )}

        <form onSubmit={handleScheduleSubmit} className="space-y-6">
          <input type="hidden" name="campaignId" value={campaign.id} />
          <input type="hidden" name="publicId" value={campaign.public_id} />
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label htmlFor="start-at-input" className="block text-xs font-bold uppercase tracking-wider text-[#705a54]">
                Opening Date & Time (IST)
              </label>
              <input
                id="start-at-input"
                type="datetime-local"
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3 font-mono text-sm text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
              />
              <p className="mt-1 text-[11px] text-[#705a54]">
                Ticket orders are strictly blocked prior to this time.
              </p>
            </div>

            <div>
              <label htmlFor="end-at-input" className="block text-xs font-bold uppercase tracking-wider text-[#705a54]">
                Closing Date & Time (IST)
              </label>
              <input
                id="end-at-input"
                type="datetime-local"
                value={endInput}
                onChange={(e) => setEndInput(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3 font-mono text-sm text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
              />
              <p className="mt-1 text-[11px] text-[#705a54]">
                Ticket booking automatically concludes at this moment.
              </p>
            </div>
          </div>

          {/* Automation Information Banner */}
          <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-xs text-blue-950">
            <div className="flex items-start gap-2.5">
              <Zap size={16} className="text-blue-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-blue-900">
                  Background Automation (pg_cron &amp; Atomic DB Scheduler)
                </p>
                <p className="text-blue-800 leading-relaxed">
                  {campaign.status === "DRAFT" && campaign.start_at ? (
                    <span>
                      When the clock reaches <b>{formatIstDateTime(campaign.start_at)}</b>, this campaign will <b>automatically transition from DRAFT to ACTIVE</b>. No manual login or button click is required. Orders remain blocked until that moment.
                    </span>
                  ) : campaign.status === "ACTIVE" && campaign.end_at ? (
                    <span>
                      When the clock reaches <b>{formatIstDateTime(campaign.end_at)}</b>, this campaign will <b>automatically transition to CLOSED</b>, and all subsequent orders will be rejected immediately.
                    </span>
                  ) : campaign.status === "PAUSED" ? (
                    <span className="text-amber-900 font-medium">
                      Campaign is manually paused. Automated scheduled activation is suspended while in PAUSED status.
                    </span>
                  ) : campaign.status === "CANCELLED" ? (
                    <span className="text-red-900 font-medium">
                      Campaign is cancelled. Automated scheduling is permanently disabled.
                    </span>
                  ) : (
                    <span>
                      Set opening and closing times above to enable automated activation and closing.
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {syncMessage && (
            <div className="flex items-center gap-2 rounded-xl border border-blue-300 bg-blue-50 p-3.5 text-xs font-semibold text-blue-900">
              <Info size={15} className="text-blue-700 shrink-0" />
              <span>{syncMessage}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#f0e7df] pt-5">
            <div className="flex items-center gap-2 text-xs text-[#705a54]">
              <Info size={14} className="text-[#7c1619]" />
              <span>Timestamps are automatically converted to UTC on the server without drift.</span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleManualSync}
                disabled={isSyncingSchedule}
                className="flex items-center gap-2 rounded-xl border border-[#eadbcf] bg-white px-4 py-2.5 text-xs font-bold text-[#705a54] shadow-xs transition hover:bg-[#fffaf7] disabled:opacity-50"
              >
                <RefreshCw size={13} className={isSyncingSchedule ? "animate-spin text-[#7c1619]" : ""} />
                <span>{isSyncingSchedule ? "Checking..." : "Sync Schedule Now"}</span>
              </button>

              <button
                type="submit"
                disabled={isSavingSchedule}
                className="flex items-center gap-2 rounded-xl bg-[#7c1619] px-6 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#631214] disabled:opacity-50"
              >
                {isSavingSchedule ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                <span>Save Schedule</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Lifecycle Status Transitions */}
      <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xs sm:p-8">
        <div className="mb-6 flex items-center gap-2">
          <Flame className="text-[#7c1619]" size={20} />
          <div>
            <h2 className="text-lg font-bold text-[#35110f]">Campaign Lifecycle Control</h2>
            <p className="text-xs text-[#705a54]">
              Control whether public orders and seller manual entries are active, paused, or concluded.
            </p>
          </div>
        </div>

        {statusSuccess && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-xs font-semibold text-emerald-900">
            <CheckCircle2 size={16} className="text-emerald-700 shrink-0" />
            <span>{statusSuccess}</span>
          </div>
        )}

        {statusError && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 p-4 text-xs font-semibold text-red-900">
            <AlertTriangle size={16} className="text-red-700 shrink-0" />
            <span>{statusError}</span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Activate / Open Sales */}
          <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-[#7c1619] font-bold text-xs uppercase">
                <Play size={14} />
                <span>Open Sales (ACTIVE)</span>
              </div>
              <p className="mt-2 text-xs text-[#705a54] leading-relaxed">
                Officially activates sales. Customer online orders and seller entries will be accepted within schedule.
              </p>
            </div>
            <button
              type="button"
              disabled={campaign.status === "ACTIVE" || isUpdatingStatus}
              onClick={() => openConfirm("ACTIVE")}
              className="mt-4 w-full rounded-lg bg-emerald-700 py-2 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {campaign.status === "ACTIVE" ? "Currently Active" : "Open Sales"}
            </button>
          </div>

          {/* Pause Sales */}
          <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-amber-700 font-bold text-xs uppercase">
                <PauseCircle size={14} />
                <span>Pause Sales (PAUSED)</span>
              </div>
              <p className="mt-2 text-xs text-[#705a54] leading-relaxed">
                Temporarily locks new ticket orders. Existing orders and payment verifications remain accessible.
              </p>
            </div>
            <button
              type="button"
              disabled={campaign.status === "PAUSED" || isUpdatingStatus}
              onClick={() => triggerStatusChange("PAUSED")}
              className="mt-4 w-full rounded-lg bg-amber-600 py-2 text-xs font-bold text-white transition hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {campaign.status === "PAUSED" ? "Currently Paused" : "Pause Sales"}
            </button>
          </div>

          {/* Close Campaign */}
          <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-red-700 font-bold text-xs uppercase">
                <StopCircle size={14} />
                <span>Close Campaign (CLOSED)</span>
              </div>
              <p className="mt-2 text-xs text-[#705a54] leading-relaxed">
                Permanently concludes ticket sales. Requires typing &quot;CLOSE&quot; to prevent accidental execution.
              </p>
            </div>
            <button
              type="button"
              disabled={campaign.status === "CLOSED" || isUpdatingStatus}
              onClick={() => openConfirm("CLOSED", "CLOSE")}
              className="mt-4 w-full rounded-lg bg-red-700 py-2 text-xs font-bold text-white transition hover:bg-red-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {campaign.status === "CLOSED" ? "Currently Closed" : "Close Campaign"}
            </button>
          </div>

          {/* Reset to Draft */}
          <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-blue-700 font-bold text-xs uppercase">
                <RotateCcw size={14} />
                <span>Draft Setup (DRAFT)</span>
              </div>
              <p className="mt-2 text-xs text-[#705a54] leading-relaxed">
                Keeps the campaign in preview mode. Allows setting up prizes and testing before official launch.
              </p>
            </div>
            <button
              type="button"
              disabled={campaign.status === "DRAFT" || isUpdatingStatus}
              onClick={() => triggerStatusChange("DRAFT")}
              className="mt-4 w-full rounded-lg border border-[#eadbcf] bg-white py-2 text-xs font-bold text-[#35110f] transition hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {campaign.status === "DRAFT" ? "Currently Draft" : "Revert to Draft"}
            </button>
          </div>
        </div>
      </div>

      {/* Protected Financial Parameters */}
      <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xs sm:p-8">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="text-[#7c1619]" size={18} />
            <h2 className="text-base font-bold text-[#35110f]">Protected Campaign Invariants</h2>
          </div>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[10px] font-bold uppercase text-[#705a54]">
            Immutable Mid-Campaign
          </span>
        </div>

        <p className="text-xs text-[#705a54] mb-4">
          To maintain accounting atomicity and prevent customer disputes, ticket price and total inventory limit are strictly locked once the campaign is created.
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-4">
            <span className="text-xs font-semibold text-[#705a54]">Unit Ticket Price</span>
            <p className="mt-1 text-2xl font-bold text-[#7c1619]">
              ₹{campaign.ticket_price_paise / 100}
            </p>
            <span className="text-[11px] text-[#705a54]">Fixed across public & seller orders</span>
          </div>

          <div className="rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-4">
            <span className="text-xs font-semibold text-[#705a54]">Total Ticket Limit</span>
            <p className="mt-1 text-2xl font-bold text-[#35110f]">
              {campaign.total_ticket_limit.toLocaleString()}
            </p>
            <span className="text-[11px] text-[#705a54]">Maximum tickets available in pool</span>
          </div>

          <div className="rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-4">
            <span className="text-xs font-semibold text-[#705a54]">Tickets Sold & Issued</span>
            <p className="mt-1 text-2xl font-bold text-emerald-700">
              {campaign.sold_ticket_count.toLocaleString()}
            </p>
            <span className="text-[11px] text-[#705a54]">
              {campaign.total_ticket_limit - campaign.sold_ticket_count} remaining capacity
            </span>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-2xs">
          <div className="w-full max-w-md rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xl">
            <div className="flex items-center gap-2 text-[#7c1619]">
              <ShieldAlert size={22} />
              <h3 className="font-bold text-base text-[#35110f]">
                Confirm Status Transition: {confirmModal.targetStatus}
              </h3>
            </div>

            <p className="mt-3 text-xs text-[#705a54] leading-relaxed">
              {confirmModal.targetStatus === "ACTIVE"
                ? "You are about to activate the fundraising campaign. If the scheduled opening time is reached, public ticket orders and seller sales will immediately become active."
                : confirmModal.targetStatus === "CLOSED"
                ? "Closing the campaign will permanently end ticket sales. Buyers will no longer be able to submit orders."
                : `Are you sure you want to transition the campaign to ${confirmModal.targetStatus}?`}
            </p>

            {confirmModal.requireInputText && (
              <div className="mt-4">
                <label className="block text-xs font-bold text-[#35110f]">
                  Type &quot;{confirmModal.requireInputText}&quot; to confirm:
                </label>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder={confirmModal.requireInputText}
                  className="mt-1.5 w-full rounded-xl border border-[#eadbcf] p-2.5 font-mono text-sm uppercase text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
                />
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmModal({ isOpen: false, targetStatus: null })}
                className="rounded-xl border border-[#eadbcf] bg-white px-4 py-2 text-xs font-bold text-[#705a54] hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  isUpdatingStatus ||
                  Boolean(
                    confirmModal.requireInputText &&
                      confirmInput.trim().toUpperCase() !== confirmModal.requireInputText
                  )
                }
                onClick={() => confirmModal.targetStatus && triggerStatusChange(confirmModal.targetStatus)}
                className="flex items-center gap-1.5 rounded-xl bg-[#7c1619] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#631214] disabled:opacity-40"
              >
                {isUpdatingStatus && <Loader2 size={14} className="animate-spin" />}
                <span>Confirm Transition</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
