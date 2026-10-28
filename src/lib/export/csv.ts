import type { ExportDataset } from "./types.ts";
import { sanitizeForSpreadsheet, formatInr } from "./formatters.ts";

/**
 * Encodes a CSV field in compliance with RFC 4180 and formula injection protection.
 */
function escapeCsvCell(value: unknown, format?: string): string {
  if (value === null || value === undefined) {
    return "";
  }

  let formatted = value;
  if (format === "currency" && typeof value === "number") {
    // Format currency for CSV as human-readable INR
    formatted = formatInr(value);
  }

  // Apply formula injection protection
  const sanitized = sanitizeForSpreadsheet(formatted);

  // Check if quoting is needed (comma, quotes, newline, or carriage return)
  if (
    sanitized.includes(",") ||
    sanitized.includes('"') ||
    sanitized.includes("\n") ||
    sanitized.includes("\r")
  ) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }

  return sanitized;
}

/**
 * Generates an RFC 4180 compliant CSV buffer with a UTF-8 BOM (\uFEFF)
 * ensuring full compatibility with Microsoft Excel and international UTF-8 characters.
 */
export function generateCsv<T>(dataset: ExportDataset<T>): Uint8Array {
  const lines: string[] = [];

  // Header row
  const headerRow = dataset.columns
    .map((col) => escapeCsvCell(col.header))
    .join(",");
  lines.push(headerRow);

  // Data rows
  for (const row of dataset.data) {
    const rowCells = dataset.columns.map((col) => {
      const rawVal = col.getValue(row);
      return escapeCsvCell(rawVal, col.format);
    });
    lines.push(rowCells.join(","));
  }

  const csvText = "\uFEFF" + lines.join("\r\n");
  return new TextEncoder().encode(csvText);
}
