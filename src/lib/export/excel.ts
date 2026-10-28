import ExcelJS from "exceljs";
import type { ExportDataset } from "./types.ts";
import { sanitizeForSpreadsheet, paiseToRupees, formatDateTime } from "./formatters.ts";

const SSFI_BURGUNDY = "FF7C1619";
const SSFI_ROW_ALT = "FFFFFAF7";
const SSFI_BORDER = "FFE0D3C9";

/**
 * Generates a professionally styled Microsoft Excel (.xlsx) workbook for SSFI Lucky Draw admin reports.
 */
export async function generateExcel<T>(dataset: ExportDataset<T>): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Speed Skating Federation of India (SSFI)";
  workbook.lastModifiedBy = "SSFI Admin System";
  workbook.created = new Date();
  workbook.modified = new Date();

  // Excel sheet name max length is 31 characters
  const safeSheetName = dataset.title.slice(0, 31).replace(/[:\\\/\?\*\[\]]/g, " ");
  const sheet = workbook.addWorksheet(safeSheetName, {
    views: [{ state: "frozen", ySplit: 4 }],
  });

  const numCols = Math.max(dataset.columns.length, 1);

  // 1. Organization Banner (Row 1)
  sheet.mergeCells(1, 1, 1, numCols);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = "SPEED SKATING FEDERATION OF INDIA — LUCKY DRAW 2026";
  titleCell.font = { name: "Arial", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: SSFI_BURGUNDY },
  };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  sheet.getRow(1).height = 28;

  // 2. Report Subtitle & Metadata (Row 2)
  sheet.mergeCells(2, 1, 2, numCols);
  const subtitleCell = sheet.getCell(2, 1);
  const generatedStr = formatDateTime(new Date().toISOString());
  subtitleCell.value = `${dataset.title.toUpperCase()}  |  Total Records: ${dataset.data.length}  |  Generated: ${generatedStr}`;
  subtitleCell.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF555555" } };
  subtitleCell.alignment = { vertical: "middle", horizontal: "center" };
  sheet.getRow(2).height = 18;

  // Row 3 is an empty spacing row
  sheet.getRow(3).height = 8;

  // 3. Table Column Headers (Row 4)
  const headerRow = sheet.getRow(4);
  headerRow.height = 24;

  dataset.columns.forEach((col, idx) => {
    const colNumber = idx + 1;
    const cell = headerRow.getCell(colNumber);
    cell.value = col.header;
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: SSFI_BURGUNDY },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: col.align || (col.format === "currency" || col.format === "number" ? "right" : "left"),
    };
    cell.border = {
      top: { style: "thin", color: { argb: SSFI_BURGUNDY } },
      bottom: { style: "medium", color: { argb: "FF35110F" } },
      left: { style: "thin", color: { argb: "FF9E2A2E" } },
      right: { style: "thin", color: { argb: "FF9E2A2E" } },
    };
  });

  // 4. Data Rows (Rows 5+)
  const colMaxLengths: number[] = dataset.columns.map((col) => col.header.length);

  dataset.data.forEach((row, rowIdx) => {
    const rowNum = 5 + rowIdx;
    const dataRow = sheet.getRow(rowNum);
    dataRow.height = 20;
    const isAlt = rowIdx % 2 === 1;

    dataset.columns.forEach((col, colIdx) => {
      const colNumber = colIdx + 1;
      const cell = dataRow.getCell(colNumber);
      const rawVal = col.getValue(row);

      // Value formatting
      if (col.format === "currency") {
        const numVal = typeof rawVal === "number" ? rawVal : Number(rawVal);
        const rupees = paiseToRupees(numVal);
        cell.value = rupees;
        cell.numFmt = '"₹"#,##0.00';
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else if (col.format === "number") {
        const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
        cell.value = isNaN(num) ? 0 : num;
        cell.numFmt = "#,##0";
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        const sanitized = sanitizeForSpreadsheet(rawVal);
        cell.value = sanitized;
        cell.alignment = {
          horizontal: col.align || (col.format === "status" ? "center" : "left"),
          vertical: "middle",
        };
      }

      cell.font = { name: "Arial", size: 9.5 };

      if (isAlt) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: SSFI_ROW_ALT },
        };
      }

      cell.border = {
        bottom: { style: "thin", color: { argb: SSFI_BORDER } },
        right: { style: "thin", color: { argb: SSFI_BORDER } },
        left: { style: "thin", color: { argb: SSFI_BORDER } },
      };

      // Measure character length for column auto-sizing
      const valStr = cell.value !== null && cell.value !== undefined ? String(cell.value) : "";
      if (valStr.length > colMaxLengths[colIdx]) {
        colMaxLengths[colIdx] = valStr.length;
      }
    });
  });

  // 5. Apply Column Auto-Widths with Padding
  dataset.columns.forEach((col, colIdx) => {
    const colNumber = colIdx + 1;
    const excelCol = sheet.getColumn(colNumber);
    const measuredWidth = Math.max(colMaxLengths[colIdx] + 4, col.width || 12);
    // Cap between 12 and 45 to prevent overly narrow or gigantic columns
    excelCol.width = Math.min(Math.max(measuredWidth, 12), 45);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
