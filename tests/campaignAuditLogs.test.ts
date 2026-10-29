import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAuditLogs,
  evaluateAuditTrailState,
  extractSafeErrorDetails,
  type AuditLogItem,
} from "../src/lib/audit/logs.ts";
import { formatIstDateTime } from "../src/lib/date/timezone.ts";

test("Audit Log Normalization: Handles null safely without throwing TypeError", () => {
  // Case 1: Null data (e.g. from failed Supabase query with error code 42501)
  const result = normalizeAuditLogs(null);
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 0);

  // Verifies that calling .length or .map on the normalized result never throws
  assert.doesNotThrow(() => {
    const len = result.length;
    assert.equal(len, 0);
    const mapped = result.map((item) => item.id);
    assert.equal(mapped.length, 0);
  });
});

test("Audit Log Normalization: Handles undefined, numbers, objects, and non-arrays safely", () => {
  assert.deepEqual(normalizeAuditLogs(undefined), []);
  assert.deepEqual(normalizeAuditLogs(123), []);
  assert.deepEqual(normalizeAuditLogs("not an array"), []);
  assert.deepEqual(normalizeAuditLogs({ error: "permission denied" }), []);
  assert.deepEqual(normalizeAuditLogs(false), []);
});

test("Audit Log Normalization: Preserves empty array", () => {
  const empty: AuditLogItem[] = [];
  const result = normalizeAuditLogs(empty);
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 0);
});

test("Audit Log Normalization: Preserves populated array of audit items with full properties", () => {
  const sampleLogs: AuditLogItem[] = [
    {
      id: "log-1",
      action: "CAMPAIGN_STATUS_UPDATED",
      created_at: "2026-10-29T04:00:00.000Z",
      metadata: { old_status: "DRAFT", new_status: "ACTIVE" },
      profiles: { full_name: "Admin User", email: "admin@ssfi.org.in" },
    },
    {
      id: "log-2",
      action: "CAMPAIGN_AUTO_ACTIVATED",
      created_at: "2026-10-29T04:30:00.000Z",
      metadata: { start_at: "2026-10-29T04:30:00.000Z" },
      profiles: null,
    },
  ];

  const result = normalizeAuditLogs(sampleLogs);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "log-1");
  assert.equal(result[0].action, "CAMPAIGN_STATUS_UPDATED");
  assert.equal(result[1].action, "CAMPAIGN_AUTO_ACTIVATED");
  assert.equal(result[1].profiles, null);
});

test("Audit Log Renderer Simulation: Simulates UI states and error classifications", () => {
  // State 1: Failed query with code 42501 (Permission Denied) and rawLogs = null
  const permDenied = evaluateAuditTrailState(null, { code: "42501", message: "permission denied for table audit_logs" });
  assert.equal(permDenied.state, "ERROR_PERMISSION");
  assert.equal(permDenied.logs.length, 0);
  assert.ok(permDenied.message?.includes("grant_permissions.sql"));

  // State 2: Generic database error with rawLogs = null
  const genericError = evaluateAuditTrailState(null, { code: "57P01", message: "terminating connection" });
  assert.equal(genericError.state, "ERROR_GENERIC");
  assert.equal(genericError.logs.length, 0);
  assert.ok(genericError.message?.includes("57P01"));

  // State 3: Successful query with empty audit logs (0 records)
  const emptySuccess = evaluateAuditTrailState([], null);
  assert.equal(emptySuccess.state, "EMPTY");
  assert.equal(emptySuccess.logs.length, 0);
  assert.ok(emptySuccess.message?.includes("No recent campaign modifications"));

  // State 4: Successful query with records
  const populated = evaluateAuditTrailState([
    {
      id: "log-10",
      action: "CAMPAIGN_SCHEDULE_UPDATED",
      created_at: "2026-10-29T03:00:00.000Z",
      metadata: { start_ist_formatted: "01/11/2026, 10:00 AM IST" },
      profiles: { full_name: "Super Admin", email: "super@ssfi.org.in" },
    },
  ], null);
  assert.equal(populated.state, "TABLE");
  assert.equal(populated.logs.length, 1);
});

test("Audit Log IST Formatting: Formats timestamps correctly for audit trail display", () => {
  const utcDate = "2026-11-01T04:30:00.000Z";
  const istFormatted = formatIstDateTime(utcDate);
  // 04:30 UTC is 10:00 AM IST (+5:30)
  assert.ok(istFormatted.includes("10:00") || istFormatted.includes("10:0"));
  assert.ok(istFormatted.includes("IST") || istFormatted.includes("Nov") || istFormatted.includes("11"));
});

test("Error Details Extraction: Prevents empty '{}' logging across all error formats", () => {
  // Case 1: PostgrestError format from Supabase (permission denied 42501)
  const postgrestErr = {
    code: "42501",
    message: "permission denied for table audit_logs",
    details: null,
    hint: "Grant the required privileges to the current role with: GRANT SELECT ON public.audit_logs TO service_role;",
  };
  const extractedPg = extractSafeErrorDetails(postgrestErr);
  assert.equal(extractedPg.code, "42501");
  assert.equal(extractedPg.message, "permission denied for table audit_logs");
  assert.equal(extractedPg.hint, "Grant the required privileges to the current role with: GRANT SELECT ON public.audit_logs TO service_role;");

  // Case 2: Standard JavaScript Error (non-enumerable message/stack)
  // In JS, { ...new Error("Network failed") } produces empty {}
  // extractSafeErrorDetails MUST extract the message and name!
  const jsErr = new Error("Network connection dropped");
  const extractedJs = extractSafeErrorDetails(jsErr);
  assert.equal(extractedJs.code, "Error");
  assert.equal(extractedJs.message, "Network connection dropped");

  // Case 3: Error object with missing code and non-enumerable properties
  const customErr = Object.create(Error.prototype);
  Object.defineProperty(customErr, "message", { value: "Socket timeout", enumerable: false });
  const extractedCustom = extractSafeErrorDetails(customErr);
  assert.equal(extractedCustom.message, "Socket timeout");

  // Case 4: Raw string error
  const stringErr = extractSafeErrorDetails("Database unreachable");
  assert.equal(stringErr.code, "UNKNOWN");
  assert.equal(stringErr.message, "Database unreachable");

  // Case 5: Null / undefined / empty object
  assert.equal(extractSafeErrorDetails(null).code, "UNKNOWN");
  assert.equal(extractSafeErrorDetails(undefined).message, "Unknown error occurred");
  assert.equal(extractSafeErrorDetails({}).code, "UNKNOWN");
  assert.equal(extractSafeErrorDetails({}).message, "Database query failed");
});

test("Campaign Settings Page Query Lifecycle: Safe async resolution and rejection handling", async () => {
  // Simulates the exact query block inside CampaignSettingsPage:
  async function simulatePageDataFetch(mockQuery: () => Promise<{ data: unknown; error: unknown }>) {
    let rawLogs: unknown = null;
    let auditLogsError = null;

    try {
      const res = await mockQuery();
      rawLogs = res.data;
      if (res.error) {
        auditLogsError = extractSafeErrorDetails(res.error);
      }
    } catch (err: unknown) {
      auditLogsError = extractSafeErrorDetails(err);
    }

    const auditLogs = normalizeAuditLogs(rawLogs);
    const viewState = evaluateAuditTrailState(auditLogs, auditLogsError);

    return { auditLogs, auditLogsError, viewState };
  }

  // 1. Supabase permission denied (42501) with null data
  const result1 = await simulatePageDataFetch(async () => ({
    data: null,
    error: { code: "42501", message: "permission denied for table audit_logs" },
  }));
  assert.equal(result1.auditLogs.length, 0);
  assert.equal(result1.viewState.state, "ERROR_PERMISSION");
  assert.ok(result1.viewState.message?.includes("grant_permissions.sql"));

  // 2. Unexpected Promise Rejection (e.g. fetch timeout)
  const result2 = await simulatePageDataFetch(async () => {
    throw new Error("ETIMEDOUT: Connection refused");
  });
  assert.equal(result2.auditLogs.length, 0);
  assert.equal(result2.viewState.state, "ERROR_GENERIC");
  assert.ok(result2.viewState.message?.includes("ETIMEDOUT"));

  // 3. Successful query with 0 records
  const result3 = await simulatePageDataFetch(async () => ({
    data: [],
    error: null,
  }));
  assert.equal(result3.auditLogs.length, 0);
  assert.equal(result3.auditLogsError, null);
  assert.equal(result3.viewState.state, "EMPTY");

  // 4. Successful query with records
  const result4 = await simulatePageDataFetch(async () => ({
    data: [
      {
        id: "log-1",
        action: "CAMPAIGN_AUTO_ACTIVATED",
        created_at: "2026-10-29T04:30:00.000Z",
        metadata: {},
        profiles: null,
      },
    ],
    error: null,
  }));
  assert.equal(result4.auditLogs.length, 1);
  assert.equal(result4.auditLogsError, null);
  assert.equal(result4.viewState.state, "TABLE");
});

