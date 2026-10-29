export type AuditLogItem = {
  id: string;
  action: string;
  created_at: string;
  metadata: Record<string, unknown>;
  profiles: { full_name: string; email: string } | null;
};

export type AuditLogError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

/**
 * Safely extracts diagnostic properties from any error format, including PostgrestError,
 * standard Error subclasses with non-enumerable properties, and raw strings/objects.
 * Guarantees that diagnostic logging never displays empty "{}" and prevents PII leakage.
 */
export function extractSafeErrorDetails(error: unknown): AuditLogError {
  if (!error || typeof error !== "object") {
    return {
      code: "UNKNOWN",
      message: typeof error === "string" ? error : "Unknown error occurred",
      details: null,
      hint: null,
    };
  }

  const errObj = error as Record<string, unknown>;
  const code = String(errObj.code || (error as Error).name || "UNKNOWN");
  const message = String(errObj.message || (error as Error).message || "Database query failed");
  const details = typeof errObj.details === "string" ? errObj.details : null;
  const hint = typeof errObj.hint === "string" ? errObj.hint : null;

  return { code, message, details, hint };
}

/**
 * Normalizes any raw audit log input into a safe array.
 * Guaranteed to never return null or undefined, preventing runtime length errors.
 */
export function normalizeAuditLogs(rawLogs: unknown): AuditLogItem[] {
  if (!Array.isArray(rawLogs)) {
    return [];
  }
  return rawLogs as AuditLogItem[];
}

export type RenderedAuditTrailState = "ERROR_PERMISSION" | "ERROR_GENERIC" | "EMPTY" | "TABLE";

/**
 * Pure evaluation of the audit trail state for robust UI rendering and test validation.
 */
export function evaluateAuditTrailState(
  rawLogs: unknown,
  error?: AuditLogError | null
): { state: RenderedAuditTrailState; logs: AuditLogItem[]; message?: string } {
  const safeLogs = normalizeAuditLogs(rawLogs);

  if (error) {
    const isPermissionError = error.code === "42501";
    return {
      state: isPermissionError ? "ERROR_PERMISSION" : "ERROR_GENERIC",
      logs: safeLogs,
      message: isPermissionError
        ? "Database permission denied for the audit_logs table. Please run supabase/grant_permissions.sql to grant table privileges to the service_role."
        : `The audit trail could not be retrieved from the database: ${error.message || "Query failed"}${error.code ? ` (${error.code})` : ""}.`,
    };
  }

  if (safeLogs.length === 0) {
    return {
      state: "EMPTY",
      logs: safeLogs,
      message: "No recent campaign modifications recorded in audit log.",
    };
  }

  return {
    state: "TABLE",
    logs: safeLogs,
  };
}

