/**
 * Standard Indian Standard Time (IST, UTC+05:30) Date & Time Utilities
 * Provides consistent formatting, input conversions, and schedule evaluations.
 */

export const IST_TIMEZONE = "Asia/Kolkata";

/**
 * Formats a Date or ISO timestamp into a clean Indian Standard Time string with AM/PM.
 * Example: "01 Nov 2026, 10:00 AM IST"
 */
export function formatIstDateTime(date: Date | string | null | undefined): string {
  if (!date) return "Not scheduled";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Invalid date";

  return (
    new Intl.DateTimeFormat("en-IN", {
      timeZone: IST_TIMEZONE,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(d) + " IST"
  );
}

/**
 * Formats a Date or ISO timestamp into an IST date string.
 * Example: "01 Nov 2026"
 */
export function formatIstDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Invalid date";

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

/**
 * Formats a Date or ISO timestamp into an IST time string.
 * Example: "10:00 AM IST"
 */
export function formatIstTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Invalid date";

  return (
    new Intl.DateTimeFormat("en-IN", {
      timeZone: IST_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(d) + " IST"
  );
}

/**
 * Converts a UTC Date or ISO string into a "YYYY-MM-DDTHH:mm" format in IST,
 * suitable for native `<input type="datetime-local" />`.
 */
export function toIstDatetimeLocalString(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(d);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  let hour = getPart("hour");
  if (hour === "24") hour = "00";
  const minute = getPart("minute");

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * Parses a "YYYY-MM-DDTHH:mm" datetime-local string (entered as IST) into a standard UTC ISO 8601 string.
 */
export function fromIstDatetimeLocalToIso(val: string | null | undefined): string | null {
  if (!val || !val.trim()) return null;
  const trimmed = val.trim();

  // If already an ISO string with offset or UTC indicator
  if (trimmed.endsWith("Z") || trimmed.includes("+") || (trimmed.lastIndexOf("-") > 10)) {
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Treat input as IST (+05:30)
  const normalized = trimmed.length === 16 ? `${trimmed}:00+05:30` : `${trimmed}+05:30`;
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export type ScheduleStatus =
  | "DRAFT"
  | "UPCOMING"
  | "LIVE"
  | "PAUSED"
  | "EXPIRED"
  | "CLOSED"
  | "CANCELLED";

export type CampaignScheduleAnalysis = {
  isSellingOpen: boolean;
  scheduleStatus: ScheduleStatus;
  badgeLabel: string;
  badgeVariant: "neutral" | "info" | "success" | "warning" | "danger";
  countdownTarget: string | null;
  countdownType: "OPENING" | "CLOSING" | null;
  headline: string;
  description: string;
  startFormatted: string;
  endFormatted: string;
};

/**
 * Pure evaluation of campaign state based on status and schedule timestamps.
 * Single source of truth for UI badges, countdown components, and server validation.
 */
export function evaluateCampaignSchedule(
  status: string,
  startAt: string | null | undefined,
  endAt: string | null | undefined,
  now: Date = new Date()
): CampaignScheduleAnalysis {
  const startFormatted = formatIstDateTime(startAt);
  const endFormatted = formatIstDateTime(endAt);

  const startDate = startAt ? new Date(startAt) : null;
  const endDate = endAt ? new Date(endAt) : null;
  const nowMs = now.getTime();

  // 1. Inactive or special statuses override schedule
  if (status === "PAUSED") {
    return {
      isSellingOpen: false,
      scheduleStatus: "PAUSED",
      badgeLabel: "Sales Paused",
      badgeVariant: "warning",
      countdownTarget: null,
      countdownType: null,
      headline: "Ticket Sales Temporarily Paused",
      description: "Online ticket orders and manual sales are currently paused by SSFI administrators.",
      startFormatted,
      endFormatted,
    };
  }

  if (status === "CLOSED") {
    return {
      isSellingOpen: false,
      scheduleStatus: "CLOSED",
      badgeLabel: "Campaign Closed",
      badgeVariant: "neutral",
      countdownTarget: null,
      countdownType: null,
      headline: "Fundraising Campaign Concluded",
      description: "Ticket sales for this lucky draw have officially closed.",
      startFormatted,
      endFormatted,
    };
  }

  if (status === "CANCELLED") {
    return {
      isSellingOpen: false,
      scheduleStatus: "CANCELLED",
      badgeLabel: "Campaign Cancelled",
      badgeVariant: "danger",
      countdownTarget: null,
      countdownType: null,
      headline: "Fundraising Campaign Cancelled",
      description: "This lucky draw has been cancelled. No further orders are accepted.",
      startFormatted,
      endFormatted,
    };
  }

  if (status === "DRAFT") {
    const hasFutureStart = startDate && startDate.getTime() > nowMs;
    return {
      isSellingOpen: false,
      scheduleStatus: "DRAFT",
      badgeLabel: hasFutureStart ? "Draft (Scheduled)" : "Draft (Preview)",
      badgeVariant: "info",
      countdownTarget: hasFutureStart && startAt ? startAt : null,
      countdownType: hasFutureStart ? "OPENING" : null,
      headline: "Campaign in Draft / Preview",
      description: hasFutureStart
        ? `Sales are scheduled to open on ${startFormatted}. Orders remain locked until official launch.`
        : "The fundraising lucky draw has not officially launched yet. Orders remain locked in draft mode.",
      startFormatted,
      endFormatted,
    };
  }

  // 2. ACTIVE / UPCOMING / LIVE campaign schedule checks
  if (status === "ACTIVE" || status === "UPCOMING" || status === "LIVE") {
    // If start_at is in the future
    if (startDate && startDate.getTime() > nowMs) {
      return {
        isSellingOpen: false,
        scheduleStatus: "UPCOMING",
        badgeLabel: "Opening Soon",
        badgeVariant: "info",
        countdownTarget: startAt ?? null,
        countdownType: "OPENING",
        headline: "Ticket Sales Open Soon",
        description: `Official ticket sales will open on ${startFormatted}.`,
        startFormatted,
        endFormatted,
      };
    }

    // If end_at has passed
    if (endDate && endDate.getTime() <= nowMs) {
      return {
        isSellingOpen: false,
        scheduleStatus: "EXPIRED",
        badgeLabel: "Sales Ended",
        badgeVariant: "neutral",
        countdownTarget: null,
        countdownType: null,
        headline: "Ticket Sales Concluded",
        description: `The scheduled ticket sales window closed on ${endFormatted}.`,
        startFormatted,
        endFormatted,
      };
    }

    // Within active window
    return {
      isSellingOpen: true,
      scheduleStatus: "LIVE",
      badgeLabel: "Live Sales Open",
      badgeVariant: "success",
      countdownTarget: endAt ?? null,
      countdownType: endAt ? "CLOSING" : null,
      headline: "Ticket Sales Live",
      description: endAt
        ? `Ticket bookings are open and will close on ${endFormatted}.`
        : "Ticket bookings are currently open.",
      startFormatted,
      endFormatted,
    };
  }

  // Fallback
  return {
    isSellingOpen: false,
    scheduleStatus: "DRAFT",
    badgeLabel: status,
    badgeVariant: "neutral",
    countdownTarget: null,
    countdownType: null,
    headline: `Campaign Status: ${status}`,
    description: "Ticket sales are currently unavailable.",
    startFormatted,
    endFormatted,
  };
}

