"use client";

import { useSyncExternalStore } from "react";
import {
  Calendar,
  Clock,
  Flame,
  PauseCircle,
  Sparkles,
  XCircle,
} from "lucide-react";
import {
  evaluateCampaignSchedule,
  formatIstDateTime,
} from "@/lib/date/timezone";

function subscribeTime(callback: () => void) {
  const interval = setInterval(callback, 1000);
  return () => clearInterval(interval);
}

function getTimeSnapshot(): number {
  return Date.now();
}

function getServerSnapshot(): number {
  return 0;
}

type Props = {
  status: string;
  startAt: string | null;
  endAt: string | null;
  variant?: "customer" | "seller" | "compact";
  className?: string;
};

export function CampaignCountdown({
  status,
  startAt,
  endAt,
  variant = "customer",
  className = "",
}: Props) {
  const nowMs = useSyncExternalStore(subscribeTime, getTimeSnapshot, getServerSnapshot);
  const isHydrated = nowMs > 0;

  // On server (nowMs === 0), evaluate deterministically with startAt/epoch; on client, use live nowMs
  const referenceTime = isHydrated ? new Date(nowMs) : new Date(startAt || 0);
  const analysis = evaluateCampaignSchedule(status, startAt, endAt, referenceTime);

  // Time remaining calculation
  let days = 0;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  let hasActiveCountdown = false;

  if (isHydrated && analysis.countdownTarget) {
    const targetMs = new Date(analysis.countdownTarget).getTime();
    const diff = Math.max(0, targetMs - nowMs);
    hasActiveCountdown = diff > 0;

    const totalSeconds = Math.floor(diff / 1000);
    days = Math.floor(totalSeconds / 86400);
    hours = Math.floor((totalSeconds % 86400) / 3600);
    minutes = Math.floor((totalSeconds % 3600) / 60);
    seconds = totalSeconds % 60;
  }

  const isSeller = variant === "seller";

  return (
    <div
      className={`rounded-2xl border transition-all ${
        analysis.scheduleStatus === "LIVE"
          ? "border-emerald-300 bg-emerald-50/70 text-emerald-950"
          : analysis.scheduleStatus === "PAUSED"
          ? "border-amber-300 bg-amber-50/70 text-amber-950"
          : analysis.scheduleStatus === "UPCOMING"
          ? "border-blue-300 bg-blue-50/70 text-blue-950"
          : analysis.scheduleStatus === "DRAFT"
          ? "border-amber-200 bg-amber-50/60 text-amber-950"
          : "border-gray-200 bg-gray-50 text-gray-800"
      } p-5 shadow-xs ${className}`}
      aria-live="polite"
    >
      {/* Top Status Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-current/10 pb-3">
        <div className="flex items-center gap-2">
          {analysis.scheduleStatus === "LIVE" ? (
            <Flame className="text-emerald-600 animate-pulse" size={20} />
          ) : analysis.scheduleStatus === "PAUSED" ? (
            <PauseCircle className="text-amber-600" size={20} />
          ) : analysis.scheduleStatus === "UPCOMING" ? (
            <Clock className="text-blue-600" size={20} />
          ) : analysis.scheduleStatus === "CLOSED" || analysis.scheduleStatus === "EXPIRED" ? (
            <XCircle className="text-gray-500" size={20} />
          ) : (
            <Sparkles className="text-amber-700" size={20} />
          )}

          <h2 className="text-sm font-bold tracking-tight">
            {analysis.headline}
          </h2>
        </div>

        <span
          className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider ${
            analysis.scheduleStatus === "LIVE"
              ? "bg-emerald-600 text-white"
              : analysis.scheduleStatus === "PAUSED"
              ? "bg-amber-600 text-white"
              : analysis.scheduleStatus === "UPCOMING"
              ? "bg-blue-600 text-white"
              : analysis.scheduleStatus === "DRAFT"
              ? "bg-amber-700 text-white"
              : "bg-gray-600 text-white"
          }`}
        >
          {analysis.badgeLabel}
        </span>
      </div>

      {/* Description */}
      <p className="mt-2.5 text-xs leading-relaxed opacity-90">
        {analysis.description}
        {isSeller && analysis.scheduleStatus === "DRAFT" && (
          <span className="block mt-1 font-semibold text-amber-900">
            Note for Sellers: You can review your dashboard and prepare referral QR codes, but ticket booking remains locked.
          </span>
        )}
      </p>

      {/* Countdown Clock Display */}
      {hasActiveCountdown && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold">
            <span className="flex items-center gap-1.5 opacity-90">
              <Clock size={14} />
              {analysis.countdownType === "OPENING"
                ? "Opening Countdown (IST)"
                : "Selling Window Closes In"}
            </span>
            <span className="text-[11px] font-medium opacity-75">
              Live IST Timer
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center sm:gap-3">
            {[
              ["Days", days],
              ["Hours", hours],
              ["Minutes", minutes],
              ["Seconds", seconds],
            ].map(([unit, val]) => (
              <div
                key={String(unit)}
                className="rounded-xl border border-current/15 bg-white/95 p-2 sm:p-3 shadow-2xs"
              >
                <span className="block font-mono text-xl sm:text-2xl font-bold tracking-tight text-[#7c1619]">
                  {isHydrated ? String(val).padStart(2, "0") : "--"}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
                  {String(unit)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Schedule Info Metadata Footer */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-current/10 pt-3 text-[11px] opacity-85">
        <div className="flex items-center gap-1.5">
          <Calendar size={13} className="shrink-0" />
          <span>
            <b>Opens:</b> {formatIstDateTime(startAt)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock size={13} className="shrink-0" />
          <span>
            <b>Closes:</b> {formatIstDateTime(endAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
