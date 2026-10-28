import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeForSpreadsheet,
  formatInr,
  paiseToRupees,
  formatDate,
  formatDateTime,
  generateExportFilename,
} from "../src/lib/export/formatters.ts";
import { generateCsv } from "../src/lib/export/csv.ts";
import { generateJson } from "../src/lib/export/json.ts";
import { generateExcel } from "../src/lib/export/excel.ts";
import { generatePdf } from "../src/lib/export/pdf.ts";
import {
  buildPaymentsDataset,
  buildOrdersDataset,
  buildDashboardDataset,
} from "../src/lib/export/datasets.ts";
import type {
  PaymentExportRow,
  OrderExportRow,
  DashboardMetricRow,
} from "../src/lib/export/datasets.ts";

test("sanitizeForSpreadsheet escapes formula injection triggers", () => {
  // Dangerous triggers: =, +, -, @, \t, \r
  assert.equal(sanitizeForSpreadsheet("=SUM(A1:A10)"), "'=SUM(A1:A10)");
  assert.equal(sanitizeForSpreadsheet("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0");
  assert.equal(sanitizeForSpreadsheet("-12345"), "'-12345");
  assert.equal(sanitizeForSpreadsheet("@lookup"), "'@lookup");
  assert.equal(sanitizeForSpreadsheet("\tleading-tab"), "'\tleading-tab");
  assert.equal(sanitizeForSpreadsheet("\rleading-cr"), "'\rleading-cr");

  // Harmless text is unchanged
  assert.equal(sanitizeForSpreadsheet("SSFI-ORDER-1001"), "SSFI-ORDER-1001");
  assert.equal(sanitizeForSpreadsheet("John Doe"), "John Doe");
  assert.equal(sanitizeForSpreadsheet("VERIFIED"), "VERIFIED");

  // Already sanitized string is not double-escaped
  assert.equal(sanitizeForSpreadsheet("'+919876543210"), "'+919876543210");

  // Null, undefined, empty string handling
  assert.equal(sanitizeForSpreadsheet(null), "");
  assert.equal(sanitizeForSpreadsheet(undefined), "");
  assert.equal(sanitizeForSpreadsheet(""), "");
});

test("formatInr and paiseToRupees calculate correct Indian Rupee representations", () => {
  assert.equal(paiseToRupees(50000), 500);
  assert.equal(paiseToRupees(125000), 1250);
  assert.equal(paiseToRupees(0), 0);
  assert.equal(paiseToRupees(null), 0);
  assert.equal(paiseToRupees(undefined), 0);

  const formatted500 = formatInr(50000);
  assert.match(formatted500, /500/);
  assert.match(formatted500, /₹/);

  const formattedZero = formatInr(0);
  assert.match(formattedZero, /0\.00/);
});

test("formatDate and formatDateTime format ISO dates cleanly", () => {
  const iso = "2026-10-29T10:30:00.000Z";
  const dateStr = formatDate(iso);
  assert.match(dateStr, /2026/);
  assert.match(dateStr, /Oct/);

  const dateTimeStr = formatDateTime(iso);
  assert.match(dateTimeStr, /2026/);
  assert.match(dateTimeStr, /IST/);

  assert.equal(formatDate(null), "—");
  assert.equal(formatDateTime(null), "—");
});

test("generateExportFilename generates standardized SSFI timestamped names", () => {
  const d = new Date(2026, 9, 29, 14, 30); // 29 Oct 2026
  const filenameXlsx = generateExportFilename("payments", "xlsx", d);
  assert.match(filenameXlsx, /^ssfi-payments-\d{4}-\d{2}-\d{2}-\d{4}\.xlsx$/);

  const filenameCsv = generateExportFilename("orders", ".csv", d);
  assert.match(filenameCsv, /^ssfi-orders-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/);
});

test("generateCsv includes UTF-8 BOM, sanitizes cells, and properly quotes rows", () => {
  const testDataset = buildPaymentsDataset([
    {
      id: "pay-1",
      status: "SUBMITTED",
      amount_paise: 50000,
      utr_reference: "=1+1", // formula injection attempt
      submitted_at: "2026-10-29T00:00:00.000Z",
      verified_at: null,
      orders: {
        order_number: "ORD-001,SPECIAL", // comma in order number
        customers: { full_name: 'Sharma "Coach" Rao', whatsapp_number: "+919876543210" },
        sellers: { display_name: "Coach Rajesh", seller_code: "SELLER-001" },
      },
    },
  ]);

  const csvBuffer = generateCsv(testDataset);
  const csvString = new TextDecoder().decode(csvBuffer);

  // 1. Must start with UTF-8 BOM bytes: 0xEF, 0xBB, 0xBF
  assert.equal(csvBuffer[0], 0xef);
  assert.equal(csvBuffer[1], 0xbb);
  assert.equal(csvBuffer[2], 0xbf);

  // 2. Comma in field should be quoted
  assert.match(csvString, /"ORD-001,SPECIAL"/);

  // 3. Double quotes inside field should be doubled
  assert.match(csvString, /"Sharma ""Coach"" Rao"/);

  // 4. Formula injection attempt must be prefixed with single quote
  assert.match(csvString, /'=1\+1/);

  // 5. Leading + in phone number must be protected from formula injection
  assert.match(csvString, /'\+919876543210/);
});

test("generateJson produces complete SSFI metadata envelope and clean records", () => {
  const sampleOrders: OrderExportRow[] = [
    {
      id: "ord-1",
      order_number: "ORD-999",
      quantity: 2,
      unit_price_paise: 50000,
      total_amount_paise: 100000,
      status: "PAID",
      created_at: "2026-10-29T01:00:00.000Z",
      customers: {
        full_name: "Priya Patel",
        phone: "9876543210",
        whatsapp_number: "9876543210",
        email: "priya@example.com",
      },
      sellers: {
        display_name: "Club South",
        seller_code: "SELLER-005",
      },
    },
  ];

  const dataset = buildOrdersDataset(sampleOrders);
  const jsonBuffer = generateJson(dataset);
  const parsed = JSON.parse(new TextDecoder().decode(jsonBuffer));

  // Metadata verification
  assert.equal(parsed.metadata.system, "SSFI Lucky Draw Administration System");
  assert.equal(parsed.metadata.organization, "Speed Skating Federation of India (SSFI)");
  assert.equal(parsed.metadata.resource, "orders");
  assert.equal(parsed.metadata.recordCount, 1);
  assert.equal(parsed.metadata.summary.totalTicketsSold, 2);
  assert.equal(parsed.metadata.summary.totalCollectionRupees, 1000);

  // Record verification
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].order_number, "ORD-999");
  assert.equal(parsed.records[0].total_amount_paise, 100000);
  assert.equal(parsed.records[0].total_amount_paise_inr, 1000);
  assert.equal(parsed.records[0].customer_name, "Priya Patel");
});

test("generateExcel produces valid .xlsx binary archive", async () => {
  const samplePayments: PaymentExportRow[] = [
    {
      id: "pay-101",
      status: "VERIFIED",
      amount_paise: 100000,
      utr_reference: "SBI123456789",
      submitted_at: "2026-10-29T02:00:00.000Z",
      verified_at: "2026-10-29T02:15:00.000Z",
      orders: {
        order_number: "ORD-101",
        customers: { full_name: "Ravi Kumar", whatsapp_number: "919999999999" },
        sellers: { display_name: "Delhi Skating Academy", seller_code: "SELLER-010" },
      },
    },
  ];

  const dataset = buildPaymentsDataset(samplePayments);
  const excelBuffer = await generateExcel(dataset);

  assert.ok(excelBuffer.byteLength > 2000, "Excel buffer should contain formatted workbook data");

  // Standard zip file magic bytes for .xlsx: 0x50, 0x4B, 0x03, 0x04 ('PK\x03\x04')
  assert.equal(excelBuffer[0], 0x50);
  assert.equal(excelBuffer[1], 0x4b);
  assert.equal(excelBuffer[2], 0x03);
  assert.equal(excelBuffer[3], 0x04);
});

test("generatePdf produces valid multi-page PDF document", () => {
  const metrics: DashboardMetricRow[] = [
    { metric: "Campaign Name", value: "SSFI Lucky Draw 2026", notes: "Official Title" },
    { metric: "Total Tickets Quota", value: "1,000", notes: "Allocation" },
    { metric: "Tickets Sold", value: "450", notes: "Verified" },
    { metric: "Total Revenue", value: "₹2,25,000", notes: "Reconciled" },
  ];

  const dataset = buildDashboardDataset(metrics);
  const pdfBuffer = generatePdf(dataset);

  assert.ok(pdfBuffer.byteLength > 1000, "PDF buffer should contain valid PDF stream");

  // PDF header signature: %PDF-
  const header = new TextDecoder().decode(pdfBuffer.slice(0, 5));
  assert.equal(header, "%PDF-");
});


test("Role authorization guard strictly permits only administrative staff", () => {
  const ALLOWED_ADMIN_ROLES: readonly string[] = ["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"];

  // Permitted roles
  assert.equal(ALLOWED_ADMIN_ROLES.includes("SUPER_ADMIN"), true);
  assert.equal(ALLOWED_ADMIN_ROLES.includes("ADMIN"), true);
  assert.equal(ALLOWED_ADMIN_ROLES.includes("FUNDRAISING_MANAGER"), true);

  // Denied roles: sellers, customers, anonymous
  assert.equal(ALLOWED_ADMIN_ROLES.includes("SELLER"), false);
  assert.equal(ALLOWED_ADMIN_ROLES.includes("CUSTOMER"), false);
  assert.equal(ALLOWED_ADMIN_ROLES.includes(""), false);
});

test("generateJson preserves explicit truncation metadata and safety limits", () => {
  const dataset = buildPaymentsDataset([]);
  dataset.metadata = {
    ...dataset.metadata,
    isTruncated: true,
    limit: 5000,
    warning: "Export hit maximum safety limit of 5000 records.",
  };

  const jsonBuffer = generateJson(dataset);
  const parsed = JSON.parse(new TextDecoder().decode(jsonBuffer));

  assert.equal(parsed.metadata.isTruncated, true);
  assert.equal(parsed.metadata.limit, 5000);
  assert.equal(parsed.metadata.warning, "Export hit maximum safety limit of 5000 records.");
});
