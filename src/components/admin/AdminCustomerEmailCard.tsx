"use client";

import { useState, useTransition } from "react";
import {
  Mail,
  Send,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
  RotateCcw,
} from "lucide-react";
import {
  toggleAdminCustomerEmailLiveGate,
  toggleAdminCustomerEmailEvents,
  retryAdminCustomerEmailJob,
  triggerAdminCustomerTestEmail,
  checkAdminGmailOAuthHealthAction,
  type AdminCustomerEmailDashboardData,
} from "@/server/actions/emailSettings";
import type { GmailOAuthHealth } from "@/lib/delivery/providers/gmail";

type Props = {
  initialData?: AdminCustomerEmailDashboardData;
};

export function AdminCustomerEmailCard({ initialData }: Props) {
  const [data, setData] = useState<AdminCustomerEmailDashboardData | undefined>(initialData);
  const [isPending, startTransition] = useTransition();

  // OAuth Health Check State
  const [oauthHealth, setOauthHealth] = useState<GmailOAuthHealth | null>(null);
  const [isCheckingOAuth, setIsCheckingOAuth] = useState(false);

  // Live Gate Modal State
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [gateActionError, setGateActionError] = useState<string | null>(null);

  // Admin Test Email State
  const [testEmailInput, setTestEmailInput] = useState(initialData?.authorizedAdminInbox || "");
  const [testEmailResult, setTestEmailResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [isSendingTest, setIsSendingTest] = useState(false);

  // Job Retry Loading ID
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);

  // Helper to re-fetch dashboard state
  const refreshData = async () => {
    try {
      const { getAdminCustomerEmailDashboardData } = await import(
        "@/server/actions/emailSettings"
      );
      const updated = await getAdminCustomerEmailDashboardData();
      setData(updated);
    } catch (err) {
      console.warn("Failed to refresh dashboard data", err);
    }
  };

  const handleTestOAuth = async () => {
    setIsCheckingOAuth(true);
    try {
      const health = await checkAdminGmailOAuthHealthAction();
      setOauthHealth(health);
    } catch (err: unknown) {
      setOauthHealth({
        isConfigured: false,
        senderAddress: data?.senderAddress || "Senthangstudents@gmail.com",
        status: "ERROR",
        message: err instanceof Error ? err.message : "Health check request failed",
        checkedAtIst: new Date().toLocaleTimeString(),
      });
    } finally {
      setIsCheckingOAuth(false);
    }
  };

  const handleToggleLiveGate = (enable: boolean) => {
    if (enable) {
      setConfirmInput("");
      setGateActionError(null);
      setShowConfirmModal(true);
    } else {
      startTransition(async () => {
        const res = await toggleAdminCustomerEmailLiveGate(false);
        if (res.success) {
          await refreshData();
        } else {
          alert(res.error || "Failed to disable live customer emails.");
        }
      });
    }
  };

  const handleConfirmEnableLiveGate = () => {
    if (confirmInput.trim() !== "CONFIRM_ENABLE_LIVE_EMAIL") {
      setGateActionError("You must type exactly 'CONFIRM_ENABLE_LIVE_EMAIL' to enable.");
      return;
    }

    startTransition(async () => {
      const res = await toggleAdminCustomerEmailLiveGate(true, confirmInput.trim());
      if (res.success) {
        setShowConfirmModal(false);
        setConfirmInput("");
        await refreshData();
      } else {
        setGateActionError(res.error || "Failed to enable live email delivery.");
      }
    });
  };

  const handleToggleEvent = (eventKey: "ORDER_CREATED" | "PAYMENT_APPROVED" | "TICKETS_ISSUED") => {
    if (!data) return;
    const currentVal = data.settings.events[eventKey];
    startTransition(async () => {
      const res = await toggleAdminCustomerEmailEvents({ [eventKey]: !currentVal });
      if (res.success) {
        await refreshData();
      }
    });
  };

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const destination = testEmailInput.trim() || data?.authorizedAdminInbox;
    if (!destination) return;

    setIsSendingTest(true);
    setTestEmailResult(null);

    try {
      const res = await triggerAdminCustomerTestEmail(destination);
      setTestEmailResult({
        success: res.success,
        message: res.message,
      });
      if (res.success) {
        await refreshData();
      }
    } catch (err: unknown) {
      setTestEmailResult({
        success: false,
        message: err instanceof Error ? err.message : "Test email execution failed",
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    setRetryingJobId(jobId);
    try {
      const res = await retryAdminCustomerEmailJob(jobId);
      if (!res.success && res.error) {
        alert(`Retry failed: ${res.error}`);
      }
      await refreshData();
    } finally {
      setRetryingJobId(null);
    }
  };

  const isProduction =
    data?.environment === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "production";

  const isLiveEnabled = Boolean(data?.settings.isLiveEnabled);

  return (
    <section className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xs sm:p-8">
      {/* Section Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Mail className="text-[#7c1619]" size={22} />
            <h2 className="text-xl font-bold tracking-tight text-[#35110f]">
              Production Customer Transactional Email
            </h2>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[#705a54] sm:text-sm">
            Automated customer notification system for Order Creation, Payment Approval, and Ticket Issuance via Google OAuth 2.0 &amp; Gmail API.
          </p>
        </div>

        {/* Environment Badge */}
        <div className="flex items-center gap-2">
          {isProduction ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
              <span className="h-2 w-2 rounded-full bg-emerald-600 animate-pulse" />
              Production Environment
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              Preview / Dev (Simulated)
            </span>
          )}
        </div>
      </div>

      {/* Main Controls Grid */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Card 1: Sender & OAuth Health */}
        <div className="rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#80635b]">
              Sender &amp; OAuth Health
            </span>
            <button
              onClick={handleTestOAuth}
              disabled={isCheckingOAuth}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#e8d6c5] bg-white px-2.5 py-1 text-xs font-semibold text-[#7c1619] shadow-2xs hover:bg-[#fff5ee] disabled:opacity-50"
            >
              <RefreshCw size={12} className={isCheckingOAuth ? "animate-spin" : ""} />
              <span>{isCheckingOAuth ? "Testing..." : "Test OAuth Connection"}</span>
            </button>
          </div>

          <div className="mt-4 space-y-2.5 text-xs text-[#35110f]">
            <div className="flex items-center justify-between border-b border-[#f4ece4] pb-2">
              <span className="text-[#705a54]">Configured Sender:</span>
              <span className="font-mono font-bold text-[#7c1619]">
                {data?.senderAddress || "Senthangstudents@gmail.com"}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-[#f4ece4] pb-2">
              <span className="text-[#705a54]">OAuth Credentials:</span>
              <span
                className={`font-semibold ${
                  data?.isOAuthConfigured ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {data?.isOAuthConfigured ? "Configured (Client ID + Secret + Refresh)" : "Not Configured"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#705a54]">Required Scope:</span>
              <code className="text-2xs text-[#7c1619]">https://www.googleapis.com/auth/gmail.send</code>
            </div>
          </div>

          {/* Health Check Result Banner */}
          {oauthHealth && (
            <div
              className={`mt-4 rounded-lg border p-3 text-xs leading-relaxed ${
                oauthHealth.status === "HEALTHY"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-red-200 bg-red-50 text-red-900"
              }`}
            >
              <div className="flex items-center gap-1.5 font-bold">
                {oauthHealth.status === "HEALTHY" ? (
                  <CheckCircle2 size={15} className="text-emerald-600" />
                ) : (
                  <XCircle size={15} className="text-red-600" />
                )}
                <span>OAuth Status: {oauthHealth.status}</span>
              </div>
              <p className="mt-1">{oauthHealth.message}</p>
              {oauthHealth.authenticatedUser && (
                <p className="mt-1 text-2xs opacity-80">
                  Authenticated Google Account: <strong>{oauthHealth.authenticatedUser}</strong>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Card 2: Master Live Send Gate & Event Switches */}
        <div className="rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-5">
          <span className="text-xs font-bold uppercase tracking-wider text-[#80635b]">
            Master Live Send Gate
          </span>

          <div className="mt-3 flex items-center justify-between rounded-lg border border-[#ebd9c8] bg-white p-3.5 shadow-2xs">
            <div className="flex items-center gap-2.5">
              {isLiveEnabled ? (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <Unlock size={16} />
                </div>
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                  <Lock size={16} />
                </div>
              )}
              <div>
                <p className="text-xs font-bold text-[#35110f]">
                  {isLiveEnabled ? "Live Customer Email Active" : "Live Customer Email Disabled"}
                </p>
                <p className="text-2xs text-[#705a54]">
                  {isLiveEnabled
                    ? "Transactional emails are dispatched directly to customers in production."
                    : "Safe Hold/Simulation mode. No real customer emails are sent."}
                </p>
              </div>
            </div>

            <button
              onClick={() => handleToggleLiveGate(!isLiveEnabled)}
              disabled={isPending}
              className={`rounded-full px-4 py-1.5 text-xs font-bold shadow-2xs transition ${
                isLiveEnabled
                  ? "bg-red-700 text-white hover:bg-red-800"
                  : "bg-emerald-700 text-white hover:bg-emerald-800"
              }`}
            >
              {isLiveEnabled ? "Disable Live Send" : "Enable Live Send"}
            </button>
          </div>

          {/* Event Toggles */}
          <div className="mt-4">
            <span className="text-2xs font-bold uppercase tracking-wider text-[#80635b]">
              Automatic Notification Events:
            </span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(
                [
                  ["ORDER_CREATED", "Order Created"],
                  ["PAYMENT_APPROVED", "Payment Approved"],
                  ["TICKETS_ISSUED", "Tickets Issued"],
                ] as const
              ).map(([key, label]) => {
                const active = data?.settings.events[key] ?? true;
                return (
                  <button
                    key={key}
                    onClick={() => handleToggleEvent(key)}
                    disabled={isPending}
                    className={`flex flex-col items-center justify-center rounded-lg border p-2 text-center text-xs transition ${
                      active
                        ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                        : "border-gray-200 bg-gray-50 text-gray-400"
                    }`}
                  >
                    <span className="text-2xs font-semibold">{label}</span>
                    <span className="mt-1 text-3xs font-bold uppercase">
                      {active ? "Active" : "Disabled"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-center">
          <p className="text-2xs font-bold uppercase tracking-wider text-[#80635b]">Total Sent</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">
            {data?.metrics.totalSent ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-center">
          <p className="text-2xs font-bold uppercase tracking-wider text-[#80635b]">Queued / Retrying</p>
          <p className="mt-1 text-2xl font-bold text-amber-700">
            {(data?.metrics.totalQueued ?? 0) + (data?.metrics.totalRetrying ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-center">
          <p className="text-2xs font-bold uppercase tracking-wider text-[#80635b]">Failed</p>
          <p className="mt-1 text-2xl font-bold text-red-700">
            {data?.metrics.totalFailed ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-center">
          <p className="text-2xs font-bold uppercase tracking-wider text-[#80635b]">Last Sent At (IST)</p>
          <p className="mt-1 text-xs font-semibold text-[#35110f]">
            {data?.metrics.lastSentAtIst || "No live sends yet"}
          </p>
        </div>
      </div>

      {/* Admin Test Email Trigger */}
      <div className="mt-6 rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-5">
        <span className="text-xs font-bold uppercase tracking-wider text-[#80635b]">
          Admin Test Email (Official Service Verification)
        </span>
        <p className="mt-1 text-xs text-[#705a54]">
          Send an official verification email to the authorized administrator inbox to confirm Gmail API OAuth authorization and RFC 2822 formatting.
        </p>

        {data?.authorizedAdminInbox && (
          <p className="mt-2 text-2xs text-[#705a54]">
            Authorized Admin Inbox: <strong className="font-mono text-[#7c1619]">{data.authorizedAdminInbox}</strong>
            <span className="ml-2 font-normal text-gray-500">(Arbitrary customer addresses are strictly blocked)</span>
          </p>
        )}

        <form onSubmit={handleSendTestEmail} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="email"
            value={testEmailInput}
            onChange={(e) => setTestEmailInput(e.target.value)}
            placeholder={data?.authorizedAdminInbox || "admin@ssfi.org"}
            className="flex-1 min-w-[240px] rounded-lg border border-[#e8d6c5] bg-white px-3.5 py-2 text-xs text-[#35110f] placeholder:text-gray-400 focus:border-[#7c1619] focus:outline-hidden"
          />
          <button
            type="submit"
            disabled={isSendingTest || (!testEmailInput.trim() && !data?.authorizedAdminInbox)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#7c1619] px-4 py-2 text-xs font-bold text-white shadow-2xs hover:bg-[#631013] disabled:opacity-50"
          >
            <Send size={13} className={isSendingTest ? "animate-spin" : ""} />
            <span>{isSendingTest ? "Sending Test..." : "Send Verification Email"}</span>
          </button>
        </form>

        {testEmailResult && (
          <div
            className={`mt-3 rounded-lg border p-3 text-xs ${
              testEmailResult.success
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-900"
            }`}
          >
            {testEmailResult.message}
          </div>
        )}
      </div>

      {/* Recent Delivery Outbox Logs Table */}
      <div className="mt-6">
        <div className="flex items-center justify-between pb-3">
          <span className="text-xs font-bold uppercase tracking-wider text-[#80635b]">
            Recent Customer Transactional Email Logs
          </span>
          <button
            onClick={refreshData}
            className="inline-flex items-center gap-1 text-2xs font-semibold text-[#7c1619] hover:underline"
          >
            <RefreshCw size={11} />
            <span>Refresh Table</span>
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[#eadbcf] bg-white">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#eadbcf] bg-[#fffaf7] text-2xs font-bold uppercase text-[#80635b]">
              <tr>
                <th className="px-4 py-2.5">Date (IST)</th>
                <th className="px-4 py-2.5">Event Type</th>
                <th className="px-4 py-2.5">Order</th>
                <th className="px-4 py-2.5">Recipient</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Attempts</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f4ece4] text-[#35110f]">
              {data?.recentLogs && data.recentLogs.length > 0 ? (
                data.recentLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-[#fffcf9]">
                    <td className="px-4 py-2.5 text-2xs text-[#705a54]">{log.createdAtIst}</td>
                    <td className="px-4 py-2.5 font-semibold text-[#7c1619]">{log.eventType}</td>
                    <td className="px-4 py-2.5 font-mono text-2xs">{log.orderNumber || "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-2xs">{log.recipientMasked}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-3xs font-bold uppercase ${
                          log.status === "SENT"
                            ? "bg-emerald-100 text-emerald-800"
                            : log.status === "QUEUED"
                            ? "bg-amber-100 text-amber-800"
                            : log.status === "RETRY"
                            ? "bg-blue-100 text-blue-800"
                            : log.status === "SIMULATED"
                            ? "bg-purple-100 text-purple-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {log.status}
                      </span>
                      {log.errorMessage && (
                        <p className="mt-0.5 max-w-[200px] truncate text-3xs text-red-700" title={log.errorMessage}>
                          {log.errorMessage}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-2xs text-[#705a54]">
                      {log.attemptCount}/{log.maxAttempts}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {(log.status === "FAILED" || log.status === "RETRY") && (
                        <button
                          onClick={() => handleRetryJob(log.id)}
                          disabled={retryingJobId === log.id}
                          className="inline-flex items-center gap-1 rounded-md border border-[#e8d6c5] bg-white px-2 py-0.5 text-3xs font-bold text-[#7c1619] hover:bg-[#fff5ee] disabled:opacity-50"
                        >
                          <RotateCcw size={10} className={retryingJobId === log.id ? "animate-spin" : ""} />
                          <span>Retry</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-xs text-[#705a54]">
                    No customer transactional emails recorded in outbox yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Modal for Enabling Live Customer Email */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-2xs">
          <div className="w-full max-w-md rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xl animate-scale-in">
            <div className="flex items-center gap-2 text-amber-700">
              <AlertTriangle size={24} />
              <h3 className="text-lg font-bold text-[#35110f]">Enable Live Customer Emails?</h3>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[#705a54]">
              Enabling live customer emails will direct the system to immediately transmit official transactional emails to real customers upon Order Creation, Payment Approval, and Ticket Issuance.
            </p>

            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-semibold">Type confirmation phrase:</p>
              <p className="mt-1 font-mono font-bold text-[#7c1619]">CONFIRM_ENABLE_LIVE_EMAIL</p>
            </div>

            <input
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder="CONFIRM_ENABLE_LIVE_EMAIL"
              className="mt-3 w-full rounded-lg border border-[#e8d6c5] px-3 py-2 font-mono text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
            />

            {gateActionError && (
              <p className="mt-2 text-xs font-semibold text-red-600">{gateActionError}</p>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmEnableLiveGate}
                disabled={isPending || confirmInput.trim() !== "CONFIRM_ENABLE_LIVE_EMAIL"}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-800 disabled:opacity-50"
              >
                Confirm &amp; Enable Live Email
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

