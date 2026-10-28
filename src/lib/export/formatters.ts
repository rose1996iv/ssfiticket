/**
 * Formula injection protection & formatting utilities for SSFI Lucky Draw exports.
 */

const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Sanitizes a cell value to prevent CSV / Spreadsheet formula injection.
 * Any string value beginning with =, +, -, @, \t, or \r is prefixed with a single quote.
 */
export function sanitizeForSpreadsheet(val: unknown): string {
  if (val === null || val === undefined) {
    return "";
  }

  const str = String(val);
  if (str.length === 0) {
    return "";
  }

  // If already escaped with leading single quote, do not double-escape
  if (str.startsWith("'")) {
    return str;
  }

  // Check if first character is a dangerous trigger
  const firstChar = str.charAt(0);
  if (FORMULA_TRIGGERS.includes(firstChar)) {
    return `'${str}`;
  }

  return str;
}

/**
 * Formats a paise amount into Indian Rupees display string (e.g. ₹500.00).
 */
export function formatInr(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || isNaN(paise)) {
    return "₹0.00";
  }
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Converts a paise amount into numeric Rupees (e.g. 50000 paise -> 500.00).
 */
export function paiseToRupees(paise: number | null | undefined): number {
  if (paise === null || paise === undefined || isNaN(paise)) {
    return 0;
  }
  return Number((paise / 100).toFixed(2));
}

/**
 * Formats an ISO date string into a readable date string (DD MMM YYYY).
 */
export function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return String(isoString);
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    }).format(d);
  } catch {
    return String(isoString);
  }
}

/**
 * Formats an ISO date string into a readable date & time string (DD MMM YYYY, HH:mm IST).
 */
export function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return String(isoString);
    const datePart = new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    }).format(d);
    const timePart = new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    }).format(d);
    return `${datePart}, ${timePart} IST`;
  } catch {
    return String(isoString);
  }
}

/**
 * Formats a Date object into YYYY-MM-DD-HHmm for consistent timestamped filenames.
 */
export function getTimestampSuffix(d = new Date()): string {
  // Using Asia/Kolkata timezone offset (+05:30)
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const istOffset = 5.5 * 60 * 60000;
  const ist = new Date(utc + istOffset);

  const yyyy = ist.getFullYear();
  const mm = String(ist.getMonth() + 1).padStart(2, "0");
  const dd = String(ist.getDate()).padStart(2, "0");
  const hh = String(ist.getHours()).padStart(2, "0");
  const min = String(ist.getMinutes()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}-${hh}${min}`;
}

/**
 * Generates official SSFI export filenames (e.g. ssfi-payments-2026-10-29-0025.xlsx).
 */
export function generateExportFilename(resource: string, ext: string, d = new Date()): string {
  const cleanExt = ext.replace(/^\./, "");
  return `ssfi-${resource}-${getTimestampSuffix(d)}.${cleanExt}`;
}
