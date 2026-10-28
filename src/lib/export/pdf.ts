import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ExportDataset } from "./types.ts";
import { formatDateTime, formatInr, sanitizeForSpreadsheet } from "./formatters.ts";

/**
 * Generates an executive-ready SSFI PDF report using jsPDF and jspdf-autotable.
 */
export function generatePdf<T>(dataset: ExportDataset<T>): Uint8Array {
  // Use landscape if dataset has more than 5 columns for optimal readability
  const isLandscape = dataset.columns.length > 5;
  const doc = new jsPDF({
    orientation: isLandscape ? "landscape" : "portrait",
    unit: "pt",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 30;

  // 1. Top Decorative Brand Banner (Burgundy #7C1619)
  doc.setFillColor(124, 22, 25);
  doc.rect(0, 0, pageWidth, 6, "F");

  // Gold accent line right below it (#D4A017)
  doc.setFillColor(212, 160, 23);
  doc.rect(0, 6, pageWidth, 2, "F");

  // 2. Organization Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(124, 22, 25);
  doc.text("SPEED SKATING FEDERATION OF INDIA", margin, 26);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(112, 90, 84);
  doc.text("SSFI Lucky Draw 2026 • Official Administrative System Report", margin, 38);

  // 3. Report Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(53, 17, 15);
  doc.text(dataset.title, margin, 56);

  // 4. Report Metadata
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(112, 90, 84);
  const timestampStr = formatDateTime(new Date().toISOString());
  doc.text(
    `Generated: ${timestampStr}    |    Total Records: ${dataset.data.length}    |    System: SSFI Admin Portal`,
    margin,
    69
  );

  // Thin separator under metadata
  doc.setDrawColor(234, 219, 207);
  doc.setLineWidth(0.75);
  doc.line(margin, 75, pageWidth - margin, 75);

  // 5. Prepare Table Content
  const head = [dataset.columns.map((c) => c.header)];
  const body = dataset.data.map((row) =>
    dataset.columns.map((col) => {
      const rawVal = col.getValue(row);
      if (rawVal === null || rawVal === undefined) return "—";

      if (col.format === "currency") {
        return formatInr(typeof rawVal === "number" ? rawVal : Number(rawVal));
      }
      if (col.format === "number") {
        const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
        return isNaN(num) ? "0" : num.toLocaleString("en-IN");
      }
      return sanitizeForSpreadsheet(rawVal);
    })
  );

  // Build column styles for alignment
  const columnStyles: Record<number, { halign: "left" | "center" | "right" }> = {};
  dataset.columns.forEach((col, idx) => {
    let halign: "left" | "center" | "right" = col.align || "left";
    if (!col.align) {
      if (col.format === "currency" || col.format === "number") {
        halign = "right";
      } else if (col.format === "status" || col.format === "date") {
        halign = "center";
      }
    }
    columnStyles[idx] = { halign };
  });

  // 6. Draw Table with AutoTable
  autoTable(doc, {
    startY: 83,
    head,
    body,
    theme: "striped",
    margin: { top: 35, right: margin, bottom: 40, left: margin },
    showHead: "everyPage",
    styles: {
      overflow: "linebreak",
      cellWidth: "auto",
      fontSize: 7.5,
      textColor: [53, 17, 15],
      cellPadding: 3.5,
      lineColor: [240, 231, 223],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [124, 22, 25],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8,
      cellPadding: 4,
    },
    alternateRowStyles: {
      fillColor: [253, 248, 246],
    },
    columnStyles,
  });

  // 7. Footer on Every Page
  const totalPages = doc.getNumberOfPages();
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    doc.setPage(pageNum);

    // Footer divider line
    doc.setDrawColor(234, 219, 207);
    doc.setLineWidth(0.5);
    doc.line(margin, pageHeight - 24, pageWidth - margin, pageHeight - 24);

    // Left footer notice
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(140, 120, 115);
    doc.text(
      "CONFIDENTIAL — Speed Skating Federation of India (SSFI) Administrative Report",
      margin,
      pageHeight - 14
    );

    // Right footer pagination
    const pageText = `Page ${pageNum} of ${totalPages}`;
    doc.text(pageText, pageWidth - margin, pageHeight - 14, { align: "right" });
  }

  const arrayBuffer = doc.output("arraybuffer");
  return new Uint8Array(arrayBuffer);
}
