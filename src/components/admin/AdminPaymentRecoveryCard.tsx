"use client";

import { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Link as LinkIcon,
  Loader2,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { generateOrderRecoveryLink, revokeOrderRecoveryLink } from "@/server/actions/paymentRecovery";
import { buildWhatsAppRecoveryShareUrl } from "@/lib/payment/recoveryToken";

type InitialTokenStatus = {
  hasToken: boolean;
  active: boolean;
  isRevoked?: boolean;
  isExpired?: boolean;
  isUsed?: boolean;
  expiresAt?: string;
  createdAt?: string;
};

type Props = {
  orderId: string;
  orderNumber: string;
  quantity: number;
  totalAmountInr: number;
  customerPhone?: string;
  customerEmail?: string | null;
  customerWhatsapp?: string | null;
  paymentStatus?: string;
  utrReference?: string | null;
  submittedAt?: string | null;
  orderStatus: string;
  canManageRecovery: boolean;
  initialTokenStatus?: InitialTokenStatus;
};

export function AdminPaymentRecoveryCard({
  orderId,
  orderNumber,
  quantity,
  totalAmountInr,
  customerPhone = "",
  customerEmail = null,
  customerWhatsapp = null,
  paymentStatus = "PENDING",
  utrReference = null,
  submittedAt = null,
  orderStatus,
  canManageRecovery,
  initialTokenStatus = { hasToken: false, active: false },
}: Props) {
  const [tokenStatus, setTokenStatus] = useState<InitialTokenStatus>(initialTokenStatus);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(initialTokenStatus.expiresAt || null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isIssued = orderStatus === "TICKETS_ISSUED" || paymentStatus === "VERIFIED";
  const isCancelled = orderStatus === "CANCELLED" || orderStatus === "REFUNDED";

  const missingUtr = !utrReference || !utrReference.trim();
  const missingEmail = !customerEmail || !customerEmail.trim();
  const missingWhatsapp = !customerWhatsapp || !customerWhatsapp.trim();
  const hasMissingDetails = missingUtr || missingEmail || missingWhatsapp;

  const handleGenerateLink = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await generateOrderRecoveryLink(orderId, 7);
      if (!res.success || !res.recoveryUrl) {
        setErrorMessage(res.error || "Failed to generate payment recovery link.");
      } else {
        setGeneratedUrl(res.recoveryUrl);
        setExpiresAt(res.expiresAt || null);
        setTokenStatus({
          hasToken: true,
          active: true,
          isRevoked: false,
          isExpired: false,
          expiresAt: res.expiresAt,
          createdAt: res.expiresAt ? new Date(new Date(res.expiresAt).getTime() - 7 * 86400000).toISOString() : undefined,
        });
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Error generating link.");
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeLink = async () => {
    if (!confirm("Are you sure you want to revoke this recovery link? The customer will no longer be able to use it.")) {
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await revokeOrderRecoveryLink(orderId);
      if (!res.success) {
        setErrorMessage(res.error || "Failed to revoke recovery link.");
      } else {
        setGeneratedUrl(null);
        setTokenStatus((prev) => ({
          ...prev,
          active: false,
          isRevoked: true,
        }));
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Error revoking link.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement("input");
      input.value = generatedUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const whatsAppShareUrl =
    generatedUrl && customerPhone && expiresAt
      ? buildWhatsAppRecoveryShareUrl({
          phone: customerPhone,
          orderNumber,
          quantity,
          totalAmountInr,
          recoveryUrl: generatedUrl,
          expiresAtIso: expiresAt,
        })
      : null;

  return (
    <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0e7df] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <LinkIcon size={18} className="text-[#7c1619]" />
            <h2 className="text-base font-bold text-[#35110f]">Payment Details Completion &amp; Recovery</h2>
          </div>
          <p className="mt-0.5 text-xs text-[#705a54]">
            Generate and manage secure 7-day payment completion links for customers with missing payment or contact details.
          </p>
        </div>

        {/* Data Integrity Status Badge */}
        {hasMissingDetails ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
            <AlertTriangle size={13} />
            <span>Missing Customer Details</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900">
            <CheckCircle2 size={13} />
            <span>All Details Submitted</span>
          </span>
        )}
      </div>

      {/* Details Status Breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className={`rounded-xl border p-3 ${missingUtr ? "border-amber-200 bg-amber-50/60" : "border-[#eadbcf] bg-[#fffaf7]"}`}>
          <span className="text-[10px] uppercase font-bold text-[#705a54]">UTR Reference</span>
          <p className={`mt-0.5 font-mono font-bold ${missingUtr ? "text-amber-800" : "text-[#7c1619]"}`}>
            {utrReference || "MISSING / NOT SUBMITTED"}
          </p>
          {submittedAt && (
            <p className="mt-1 text-[10px] text-[#705a54]">
              Submitted: {new Date(submittedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}
            </p>
          )}
        </div>

        <div className={`rounded-xl border p-3 ${missingEmail ? "border-amber-200 bg-amber-50/60" : "border-[#eadbcf] bg-[#fffaf7]"}`}>
          <span className="text-[10px] uppercase font-bold text-[#705a54]">Email Contact</span>
          <p className={`mt-0.5 font-medium truncate ${missingEmail ? "text-amber-800 font-bold" : "text-[#35110f]"}`}>
            {customerEmail || "MISSING / NOT SUBMITTED"}
          </p>
        </div>

        <div className={`rounded-xl border p-3 ${missingWhatsapp ? "border-amber-200 bg-amber-50/60" : "border-[#eadbcf] bg-[#fffaf7]"}`}>
          <span className="text-[10px] uppercase font-bold text-[#705a54]">WhatsApp Contact</span>
          <p className={`mt-0.5 font-mono font-medium ${missingWhatsapp ? "text-amber-800 font-bold" : "text-[#35110f]"}`}>
            {customerWhatsapp || "MISSING / NOT SUBMITTED"}
          </p>
        </div>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-900">
          <p className="font-bold flex items-center gap-1.5">
            <AlertCircle size={14} className="text-red-700" />
            <span>Error</span>
          </p>
          <p className="mt-0.5">{errorMessage}</p>
        </div>
      )}

      {/* Controls Container */}
      {isIssued ? (
        <div className="rounded-xl border border-green-200 bg-green-50/50 p-4 text-xs text-green-900">
          <p className="font-semibold flex items-center gap-1.5">
            <ShieldCheck size={16} className="text-green-700" />
            <span>Order verified and tickets issued</span>
          </p>
          <p className="mt-1 text-green-800">
            This order has already been verified and finalized. Recovery links cannot be generated for completed orders.
          </p>
        </div>
      ) : isCancelled ? (
        <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 text-xs text-red-900">
          <p className="font-semibold">Order is cancelled or refunded</p>
          <p className="mt-1 text-red-800">Recovery links cannot be generated for cancelled orders.</p>
        </div>
      ) : !canManageRecovery ? (
        <p className="text-xs text-[#705a54] italic">
          Administrator privileges (SUPER_ADMIN or ADMIN) required to generate or revoke recovery links.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Active Generated Link Display */}
          {generatedUrl ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-xs text-emerald-950 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold flex items-center gap-1.5 text-emerald-900">
                  <CheckCircle2 size={15} />
                  <span>Secure Recovery Link Generated</span>
                </span>
                {expiresAt && (
                  <span className="text-[11px] font-mono text-emerald-800">
                    Expires: {new Date(expiresAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}
                  </span>
                )}
              </div>

              {/* URL Box */}
              <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-white p-2">
                <input
                  type="text"
                  readOnly
                  value={generatedUrl}
                  className="w-full font-mono text-xs text-[#35110f] bg-transparent focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 rounded-md bg-[#7c1619] px-2.5 py-1 text-xs font-bold text-white hover:bg-[#631214] shrink-0"
                >
                  {copied ? (
                    <>
                      <Check size={12} />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {/* Action Buttons: WhatsApp Share & Revoke */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {whatsAppShareUrl && (
                  <a
                    href={whatsAppShareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-emerald-800"
                  >
                    <MessageCircle size={14} />
                    <span>Share via WhatsApp</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleRevokeLink}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                >
                  <Trash2 size={13} />
                  <span>Revoke Link</span>
                </button>
                <button
                  type="button"
                  onClick={handleGenerateLink}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#eadbcf] bg-white px-3 py-1.5 text-xs font-semibold text-[#35110f] hover:bg-[#fffaf7]"
                >
                  <RefreshCw size={13} />
                  <span>Generate New Link</span>
                </button>
              </div>
            </div>
          ) : tokenStatus.active ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-xs text-blue-950 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold flex items-center gap-1.5 text-blue-900">
                  <Clock size={15} />
                  <span>Active Recovery Link Exists in Database</span>
                </span>
                {tokenStatus.expiresAt && (
                  <span className="text-[11px] font-mono text-blue-800">
                    Expires: {new Date(tokenStatus.expiresAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-blue-800">
                A valid token hash is stored. To share the link with the customer now, click &quot;Generate New Link&quot;
                below to create a fresh secure URL.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleGenerateLink}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#7c1619] px-3.5 py-2 text-xs font-bold text-white shadow-2xs hover:bg-[#631214] disabled:opacity-70"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  <span>Generate New Link</span>
                </button>
                <button
                  type="button"
                  onClick={handleRevokeLink}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                >
                  <Trash2 size={14} />
                  <span>Revoke Link</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleGenerateLink}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl bg-[#7c1619] px-4 py-2.5 text-xs font-bold text-white shadow-2xs transition hover:bg-[#631214] active:scale-98 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Generating Secure Link...</span>
                  </>
                ) : (
                  <>
                    <LinkIcon size={14} />
                    <span>Generate Payment Details Link</span>
                  </>
                )}
              </button>
              {tokenStatus.isRevoked && (
                <span className="text-xs text-red-700 font-semibold">Previous link was revoked</span>
              )}
              {tokenStatus.isExpired && (
                <span className="text-xs text-amber-700 font-semibold">Previous link expired</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
