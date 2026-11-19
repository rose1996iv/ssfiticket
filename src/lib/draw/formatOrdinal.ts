/**
 * Reusable ordinal and prize rank formatting utilities for the SSFI Lucky Draw.
 * Handles English ordinal rules including special teen cases (11th, 12th, 13th)
 * and standard endings (1st, 2nd, 3rd, 4th, 5th, 21st, 22nd, 23rd, ...).
 */

export function formatOrdinal(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  const normalized = Math.trunc(value);
  const abs = Math.abs(normalized);
  const mod100 = abs % 100;

  if (mod100 >= 11 && mod100 <= 13) {
    return `${normalized}th`;
  }

  switch (abs % 10) {
    case 1:
      return `${normalized}st`;
    case 2:
      return `${normalized}nd`;
    case 3:
      return `${normalized}rd`;
    default:
      return `${normalized}th`;
  }
}

export interface FormatPrizeLabelOptions {
  /**
   * Optional Grand Prize qualifier for 1st Prize:
   * - "none" (default): "1st Prize"
   * - "short": "1st Prize (Grand)"
   * - "full": "1st Prize (Grand Prize)"
   */
  grandLabel?: "none" | "short" | "full";
}

export function formatPrizeLabel(
  prizeNumber: number,
  options: FormatPrizeLabelOptions = {}
): string {
  const base = `${formatOrdinal(prizeNumber)} Prize`;
  if (prizeNumber !== 1) {
    return base;
  }

  switch (options.grandLabel) {
    case "short":
      return `${base} (Grand)`;
    case "full":
      return `${base} (Grand Prize)`;
    default:
      return base;
  }
}

export function formatPrizeWinnerLabel(
  prizeNumber: number,
  options: FormatPrizeLabelOptions = {}
): string {
  const base = `${formatOrdinal(prizeNumber)} Prize Winner`;
  if (prizeNumber !== 1) {
    return base;
  }

  switch (options.grandLabel) {
    case "short":
      return `${base} (Grand)`;
    case "full":
      return `${base} (Grand Prize)`;
    default:
      return base;
  }
}
