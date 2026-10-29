"use client";

import { useState, useEffect } from "react";
import {
  Mail,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Info,
} from "lucide-react";
import {
  sendAdminGmailPreviewTestAction,
  getGmailPreviewGateStatusAction,
  type AdminGmailPreviewTestResult,
  type GmailPreviewGateStatus,
} from "@/server/actions/adminDeliveryTest";

type Props = {
  initialGateStatus?: GmailPreviewGateStatus;
};

export function AdminGmailPreviewTestCard({ initialGateStatus }: Props) {
  const [gateStatus, setGateStatus] = useState<GmailPreviewGateStatus | null>(
    initialGateStatus || null
  );
  const [isLoadingStatus, setIsLoadingStatus] = useState(!initialGateStatus);
  const [isSending, setIsSending] = useState(false);
  const [testResult, setTestResult] = useState<AdminGmailPreviewTestResult | null>(null);

  async function loadGateStatus() {
    setIsLoadingStatus(true);
    try {
      const status = await getGmailPreviewGateStatusAction();
      setGateStatus(status);
    } catch (err) {
      console.warn("Failed to retrieve Gmail preview gate status:", err);
    } finally {
      setIsLoadingStatus(false);
    }
  }

  useEffect(() => {
    let ignore = false;
    if (!initialGateStatus) {
      getGmailPreviewGateStatusAction()
        .then((status) => {
          if (!ignore) {
            setGateStatus(status);
            setIsLoadingStatus(false);
          }
        })
        .catch((err) => {
          if (!ignore) {
            console.warn("Failed to retrieve Gmail preview gate status:", err);
            setIsLoadingStatus(false);
          }
        });
    }
    return () => {
      ignore = true;
    };
  }, [initialGateStatus]);

  async function handleSendTest() {
    setIsSending(true);
    setTestResult(null);

    try {
      const res = await sendAdminGmailPreviewTestAction();
      setTestResult(res);
    } catch (err: unknown) {
      setTestResult({
        success: false,
        statusLabel: "Failed",
        operationId: `err-${Date.now().toString(36)}`,
        recipient: gateStatus?.allowedRecipientMasked || "Unknown",
        error: err instanceof Error ? err.message : "Diagnostic execution failed.",
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0e7df] pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fdf2f2] text-[#7c1619]">
            <Mail size={18} />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#35110f]">
              Gmail API Preview Diagnostic Dispatch
            </h2>
            <p className="text-xs text-[#705a54]">
              Send an isolated diagnostic verification message to the authorized Preview test inbox.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={isLoadingStatus || isSending}
          onClick={loadGateStatus}
          title="Refresh preview gate status"
          className="flex items-center gap-1.5 rounded-xl border border-[#eadbcf] bg-white px-3 py-1.5 text-xs font-semibold text-[#705a54] hover:bg-[#fffaf7] disabled:opacity-50"
        >
          <RefreshCw size={13} className={isLoadingStatus ? "animate-spin" : ""} />
          <span>Refresh Status</span>
        </button>
      </div>

      {/* Safety Gate Configuration Overview */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-3 text-xs">
          <span className="block font-medium text-[#705a54]">Environment</span>
          <span className="mt-1 flex items-center gap-1.5 font-bold text-[#35110f]">
            {gateStatus?.isVercelPreview ? (
              <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-2xs font-bold text-amber-800 border border-amber-200">
                Vercel Preview
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-2xs font-bold text-zinc-700 border border-zinc-200">
                Non-Preview / Local
              </span>
            )}
          </span>
        </div>

        <div className="rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-3 text-xs">
          <span className="block font-medium text-[#705a54]">Live Send Gate</span>
          <span className="mt-1 flex items-center gap-1.5 font-bold text-[#35110f]">
            {gateStatus?.isRealSendEnabled ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <ShieldCheck size={14} /> Active (Enabled)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-zinc-600">
                <ShieldAlert size={14} /> Inactive (Simulation)
              </span>
            )}
          </span>
        </div>

        <div className="rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-3 text-xs">
          <span className="block font-medium text-[#705a54]">OAuth Credentials</span>
          <span className="mt-1 flex items-center gap-1.5 font-bold text-[#35110f]">
            {gateStatus?.isConfigured ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CheckCircle2 size={14} /> Configured
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-rose-700">
                <AlertCircle size={14} /> Incomplete
              </span>
            )}
          </span>
        </div>

        <div className="rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-3 text-xs">
          <span className="block font-medium text-[#705a54]">Authorized Test Inbox</span>
          <span className="mt-1 block font-mono text-xs font-bold text-[#7c1619] truncate" title={gateStatus?.allowedRecipientMasked}>
            {gateStatus?.allowedRecipientMasked || "Loading..."}
          </span>
        </div>
      </div>

      {/* Safety Notice */}
      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#eadbcf] bg-[#fbf9f7] p-3 text-xs text-[#705a54]">
        <Info size={16} className="mt-0.5 shrink-0 text-[#7c1619]" />
        <div>
          <p className="font-semibold text-[#35110f]">Strict Recipient Isolation Active</p>
          <p className="mt-0.5">
            Diagnostic messages are dispatched exclusively to the verified test inbox configured in <code className="rounded bg-[#f0e7df] px-1 py-0.5 text-2xs text-[#7c1619]">GMAIL_PREVIEW_ALLOWED_RECIPIENT</code>. Real customer emails and financial links are never dispatched from this tool.
          </p>
        </div>
      </div>

      {/* Action Trigger */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#f0e7df] pt-4">
        <div className="text-xs text-[#705a54]">
          Sender Account: <strong className="text-[#35110f] font-mono">{gateStatus?.senderAddress || "Senthangstudents@gmail.com"}</strong>
        </div>

        <button
          type="button"
          disabled={isSending || isLoadingStatus}
          onClick={handleSendTest}
          className="flex items-center gap-2 rounded-xl bg-[#7c1619] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#601013] disabled:opacity-50"
        >
          {isSending ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>Dispatching via Gmail API...</span>
            </>
          ) : (
            <>
              <Send size={14} />
              <span>Send Diagnostic Test Email</span>
            </>
          )}
        </button>
      </div>

      {/* Result Display */}
      {testResult && (
        <div
          className={`mt-4 rounded-xl border p-4 text-xs ${
            testResult.success
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-rose-200 bg-rose-50 text-rose-950"
          }`}
        >
          <div className="flex items-start gap-2.5">
            {testResult.success ? (
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-600" />
            )}
            <div className="flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-sm">
                  {testResult.success ? "Provider / API Accepted" : "Delivery Attempt Failed"}
                </span>
                <span className="font-mono text-2xs opacity-75">
                  Operation ID: {testResult.operationId}
                </span>
              </div>

              {testResult.success ? (
                <>
                  <p className="text-emerald-900">
                    The test email was accepted directly by the official Gmail REST API. A confirmation email has been dispatched from <strong className="font-semibold">{gateStatus?.senderAddress}</strong> to <strong className="font-semibold">{testResult.recipient}</strong>.
                  </p>
                  {testResult.providerMessageId && (
                    <div className="font-mono text-2xs text-emerald-800">
                      Gmail Message ID: <code className="bg-emerald-100/70 px-1 py-0.5 rounded">{testResult.providerMessageId}</code>
                    </div>
                  )}
                  <div className="text-2xs text-emerald-700">
                    Dispatched at: {testResult.timestamp} (IST)
                  </div>
                </>
              ) : (
                <>
                  <p className="font-medium text-rose-900">
                    {testResult.error || "An unexpected error occurred during Gmail API dispatch."}
                  </p>
                  <div className="rounded-lg bg-white/70 p-2.5 text-2xs text-rose-950 border border-rose-200/60 space-y-1">
                    <span className="font-bold block">Troubleshooting Guidance:</span>
                    <ul className="list-disc pl-4 space-y-0.5">
                      <li>Verify <code className="font-mono bg-rose-100 px-1 py-0.2 rounded">GMAIL_PREVIEW_REAL_SEND_ENABLED=true</code> is set in Vercel Preview environment variables.</li>
                      <li>Verify <code className="font-mono bg-rose-100 px-1 py-0.2 rounded">GMAIL_PREVIEW_ALLOWED_RECIPIENT</code> matches the intended test address.</li>
                      <li>If the error mentions <code className="font-mono bg-rose-100 px-1 py-0.2 rounded">unauthorized_client</code>, the refresh token was generated under a different Client ID than configured. Regenerate the refresh token using the exact same Client ID and Secret.</li>
                      <li>Ensure scope <code className="font-mono bg-rose-100 px-1 py-0.2 rounded">https://www.googleapis.com/auth/gmail.send</code> is granted on the Google Cloud OAuth consent screen.</li>
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
