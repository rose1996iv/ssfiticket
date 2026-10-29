import { History, AlertTriangle } from "lucide-react";
import { formatIstDateTime } from "@/lib/date/timezone";
import {
  AuditLogItem,
  AuditLogError,
  normalizeAuditLogs,
  evaluateAuditTrailState,
} from "@/lib/audit/logs";

export type { AuditLogItem, AuditLogError };
export { normalizeAuditLogs };

export type CampaignAuditTrailProps = {
  auditLogs?: AuditLogItem[] | null;
  error?: AuditLogError | null;
};

export function CampaignAuditTrail({ auditLogs, error }: CampaignAuditTrailProps) {
  const { state, logs: safeLogs, message } = evaluateAuditTrailState(auditLogs, error);

  return (
    <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xs sm:p-8">
      <div className="mb-4 flex items-center justify-between border-b border-[#f0e7df] pb-4">
        <div className="flex items-center gap-2">
          <History className="text-[#7c1619]" size={18} />
          <h2 className="text-base font-bold text-[#35110f]">Administrative Audit Trail</h2>
        </div>
        <span className="text-xs text-[#705a54]">Recent Campaign Modifications</span>
      </div>

      {state === "ERROR_PERMISSION" || state === "ERROR_GENERIC" ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900" role="alert">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle size={16} className="text-amber-700 shrink-0" />
            <span>Unable to load administrative audit logs</span>
          </div>
          <p className="mt-1 text-amber-800">{message}</p>
          <p className="mt-1 text-xs text-amber-700 font-medium">Campaign scheduling and controls remain fully operational.</p>
        </div>
      ) : state === "EMPTY" ? (
        <p className="py-6 text-center text-xs text-[#705a54]">
          {message}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#f0e7df] text-[#705a54]">
                <th className="pb-2 font-semibold">Timestamp (IST)</th>
                <th className="pb-2 font-semibold">Action</th>
                <th className="pb-2 font-semibold">Administrator</th>
                <th className="pb-2 font-semibold">Changes &amp; Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0e7df]">
              {safeLogs.map((log) => (
                <tr key={log.id} className="hover:bg-[#fffaf7]">
                  <td className="py-3 font-mono text-[#705a54]">
                    {formatIstDateTime(log.created_at)}
                  </td>
                  <td className="py-3">
                    <span className="rounded-md bg-[#fceeee] px-2 py-0.5 font-mono text-[11px] font-bold text-[#a41f23]">
                      {log.action}
                    </span>
                  </td>
                  <td className="py-3 font-medium text-[#35110f]">
                    {log.action.startsWith("CAMPAIGN_AUTO_")
                      ? "Automated Scheduler (pg_cron)"
                      : log.profiles?.full_name || log.profiles?.email || "System Administrator"}
                  </td>
                  <td className="py-3 font-mono text-[11px] text-[#594541]">
                    {log.action === "CAMPAIGN_AUTO_ACTIVATED" ? (
                      <span className="font-semibold text-emerald-800">
                        Automatically activated at scheduled opening time (
                        {log.metadata?.start_at ? formatIstDateTime(String(log.metadata.start_at)) : "Scheduled window"}
                        )
                      </span>
                    ) : log.action === "CAMPAIGN_AUTO_CLOSED" ? (
                      <span className="font-semibold text-gray-700">
                        Automatically closed at scheduled closing time (
                        {log.metadata?.end_at ? formatIstDateTime(String(log.metadata.end_at)) : "Scheduled window"}
                        )
                      </span>
                    ) : log.action === "CAMPAIGN_STATUS_UPDATED" ? (
                      <span>
                        Status changed from <b>{String(log.metadata?.old_status)}</b> to{" "}
                        <b>{String(log.metadata?.new_status)}</b>
                      </span>
                    ) : log.action === "CAMPAIGN_SCHEDULE_UPDATED" ? (
                      <span>
                        Schedule updated:{" "}
                        {log.metadata?.start_ist_formatted
                          ? `Opens: ${String(log.metadata.start_ist_formatted)} | `
                          : ""}
                        {log.metadata?.end_ist_formatted
                          ? `Closes: ${String(log.metadata.end_ist_formatted)}`
                          : ""}
                      </span>
                    ) : (
                      JSON.stringify(log.metadata ?? {})
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
