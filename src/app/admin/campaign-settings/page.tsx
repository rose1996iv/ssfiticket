import { connection } from "next/server";
import { notFound } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { requireAnyRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CampaignControlForm } from "@/components/admin/CampaignControlForm";
import { AdminGmailPreviewTestCard } from "@/components/admin/AdminGmailPreviewTestCard";
import {
  CampaignAuditTrail,
  normalizeAuditLogs,
} from "@/components/admin/CampaignAuditTrail";
import { extractSafeErrorDetails, type AuditLogError } from "@/lib/audit/logs";

export const instant = false;

export default async function CampaignSettingsPage() {
  await connection();
  // Strict authorization: Only SUPER_ADMIN and ADMIN can access campaign control
  await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const db = createSupabaseAdminClient();

  const { data: campaign, error: campaignErr } = await db
    .from("campaigns")
    .select(
      "id, public_id, name, description, status, start_at, end_at, ticket_price_paise, total_ticket_limit, sold_ticket_count, updated_at"
    )
    .eq("public_id", "ssfi-fundraising-lucky-draw")
    .maybeSingle();

  if (campaignErr || !campaign) {
    console.error("[Campaign Settings] Campaign lookup error:", campaignErr);
    notFound();
  }

  // Fetch recent campaign configuration audit logs safely
  let rawLogs: unknown = null;
  let auditLogsError: AuditLogError | null = null;

  try {
    const res = await db
      .from("audit_logs")
      .select("id, action, metadata, created_at, profiles(full_name, email)")
      .eq("entity_type", "campaign")
      .order("created_at", { ascending: false })
      .limit(10);

    rawLogs = res.data;
    if (res.error) {
      auditLogsError = extractSafeErrorDetails(res.error);
    }
  } catch (err: unknown) {
    auditLogsError = extractSafeErrorDetails(err);
  }

  // Sanitized diagnostic logging for server-side troubleshooting
  if (auditLogsError) {
    console.error(
      `[Campaign Settings] Audit logs query error [code: ${auditLogsError.code}]: ${auditLogsError.message}${
        auditLogsError.hint ? ` (Hint: ${auditLogsError.hint})` : ""
      }`
    );
  }

  const auditLogs = normalizeAuditLogs(rawLogs);

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-2">
          <CalendarClock className="text-[#7c1619]" size={28} />
          <h1 className="text-2xl font-bold tracking-tight text-[#35110f] sm:text-3xl">
            Campaign Settings & Schedule
          </h1>
        </div>
        <p className="mt-1 text-sm text-[#705a54]">
          Configure the official ticket selling window (IST), manage lifecycle transitions, and monitor administrative audit logs.
        </p>
      </div>

      {/* Main Campaign Control Form */}
      <CampaignControlForm campaign={campaign} />

      {/* Gmail API Preview Diagnostic Dispatch */}
      <AdminGmailPreviewTestCard />

      {/* Administrative Audit Log History Card */}
      <CampaignAuditTrail
        auditLogs={auditLogs}
        error={
          auditLogsError
            ? { code: auditLogsError.code, message: auditLogsError.message }
            : null
        }
      />
    </div>
  );
}
