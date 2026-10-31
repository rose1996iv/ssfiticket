import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomersDataset,
  buildSellersDataset,
  type CustomerExportRow,
  type SellerExportRow,
} from "../src/lib/export/datasets.ts";
import { generateCsv } from "../src/lib/export/csv.ts";
import { generateJson } from "../src/lib/export/json.ts";
import { generateExcel } from "../src/lib/export/excel.ts";
import { generatePdf } from "../src/lib/export/pdf.ts";

/**
 * Pure simulation of client-side error classification in ExportDropdown.tsx
 */
function classifyExportError(error: unknown, status?: number, statusText?: string): {
  category: "NETWORK" | "TIMEOUT" | "AUTH" | "FORBIDDEN" | "SERVER" | "UNKNOWN";
  userMessage: string;
} {
  if (error instanceof Error && error.name === "AbortError") {
    return {
      category: "TIMEOUT",
      userMessage: "Export request timed out after 45 seconds. The dataset may be too large.",
    };
  }

  if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
    return {
      category: "NETWORK",
      userMessage: "Network connection failed. Unable to reach the server. Please check your connection and retry.",
    };
  }

  if (status === 401) {
    return {
      category: "AUTH",
      userMessage: "Session expired. Please sign in again to export administrative data.",
    };
  }

  if (status === 403) {
    return {
      category: "FORBIDDEN",
      userMessage: "Access denied. Only authorized administrative staff can export records.",
    };
  }

  if (status && status >= 500) {
    return {
      category: "SERVER",
      userMessage: `Server error (${status}): ${statusText || "Unable to generate export file"}`,
    };
  }

  return {
    category: "UNKNOWN",
    userMessage: error instanceof Error ? error.message : "An unexpected export error occurred.",
  };
}

test("Export error classification distinguishes network disconnection from server errors", () => {
  const networkError = new TypeError("Failed to fetch");
  const classified = classifyExportError(networkError);

  assert.equal(classified.category, "NETWORK");
  assert.match(classified.userMessage, /Network connection failed/);
  assert.match(classified.userMessage, /retry/i);
});

test("Export error classification identifies 45-second AbortController timeouts", () => {
  const timeoutError = new Error("The operation was aborted.");
  timeoutError.name = "AbortError";
  const classified = classifyExportError(timeoutError);

  assert.equal(classified.category, "TIMEOUT");
  assert.match(classified.userMessage, /timed out after 45 seconds/);
});

test("Export error classification distinguishes 401 Unauthorized and 403 Forbidden", () => {
  const authClassified = classifyExportError(null, 401, "Unauthorized");
  assert.equal(authClassified.category, "AUTH");
  assert.match(authClassified.userMessage, /Session expired/);

  const forbiddenClassified = classifyExportError(null, 403, "Forbidden");
  assert.equal(forbiddenClassified.category, "FORBIDDEN");
  assert.match(forbiddenClassified.userMessage, /Access denied/);
});

test("Export error classification surfaces 500 server errors cleanly", () => {
  const serverClassified = classifyExportError(null, 500, "Internal Server Error");
  assert.equal(serverClassified.category, "SERVER");
  assert.match(serverClassified.userMessage, /Server error \(500\)/);
});

test("buildCustomersDataset handles null and empty contact fields safely", () => {
  const rawCustomers: CustomerExportRow[] = [
    {
      id: "cust-1",
      full_name: "Rahul Verma",
      phone: "+919876543210",
      whatsapp_number: null,
      email: null,
      created_at: "2026-10-29T10:00:00Z",
    },
    {
      id: "cust-2",
      full_name: "=HYPERLINK('http://malicious.com','Click Me')",
      phone: "+919876543211",
      whatsapp_number: "+919876543211",
      email: "rahul@ssfi.org",
      created_at: "2026-10-29T11:00:00Z",
    },
  ];

  const dataset = buildCustomersDataset(rawCustomers);
  assert.equal(dataset.data.length, 2);
  assert.equal(dataset.columns.length >= 5, true);

  // Generate CSV and verify formula escaping
  const csvBuffer = generateCsv(dataset);
  const csvString = new TextDecoder().decode(csvBuffer);
  assert.match(csvString, /Rahul Verma/);
  assert.match(csvString, /'=HYPERLINK/); // Formula injection sanitized
});

test("buildSellersDataset handles active and inactive sellers with aggregations", () => {
  const rawSellers: SellerExportRow[] = [
    {
      id: "sel-1",
      seller_code: "SELLER-001",
      display_name: "Coach Rajesh",
      is_active: true,
      created_at: "2026-10-28T10:00:00Z",
    },
    {
      id: "sel-2",
      seller_code: "SELLER-002",
      display_name: "Deactivated Seller",
      is_active: false,
      created_at: "2026-10-28T11:00:00Z",
    },
  ];

  const dataset = buildSellersDataset(rawSellers);
  assert.equal(dataset.data.length, 2);
  assert.equal(dataset.summary?.totalSellers, 2);
  assert.equal(dataset.summary?.activeSellers, 1);
  assert.equal(dataset.summary?.inactiveSellers, 1);

  // Verify JSON output
  const jsonBuffer = generateJson(dataset);
  const parsed = JSON.parse(new TextDecoder().decode(jsonBuffer));
  assert.equal(parsed.metadata.summary.totalSellers, 2);
  assert.equal(parsed.records[0].seller_code, "SELLER-001");
  assert.equal(parsed.records[1].status, "INACTIVE");
});

test("generateExcel produces valid workbook binary for relational datasets", async () => {
  const dataset = buildCustomersDataset([
    {
      id: "cust-test",
      full_name: "Test Customer",
      phone: "+919999999999",
      whatsapp_number: "+919999999999",
      email: "test@ssfi.org",
      created_at: "2026-10-29T12:00:00Z",
    },
  ]);

  const excelBuffer = await generateExcel(dataset);
  assert.equal(excelBuffer instanceof Uint8Array, true);
  assert.equal(excelBuffer.byteLength > 500, true);
  // Zip magic header PK (0x50, 0x4B)
  assert.equal(excelBuffer[0], 0x50);
  assert.equal(excelBuffer[1], 0x4b);
});

test("generatePdf produces valid PDF binary for relational datasets", () => {
  const dataset = buildCustomersDataset([
    {
      id: "cust-pdf",
      full_name: "PDF Customer",
      phone: "+919876543210",
      whatsapp_number: null,
      email: "pdf@ssfi.org",
      created_at: "2026-10-29T12:00:00Z",
    },
  ]);

  const pdfBuffer = generatePdf(dataset);
  assert.equal(pdfBuffer instanceof Uint8Array, true);
  assert.equal(pdfBuffer.byteLength > 500, true);
  // PDF header %PDF-
  const header = new TextDecoder().decode(pdfBuffer.slice(0, 5));
  assert.equal(header, "%PDF-");
});
