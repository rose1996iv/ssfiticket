"use client";

import { useState } from "react";
import { Download, Eye, Image as ImageIcon, Loader2, ShieldCheck } from "lucide-react";
import { createAdminPaymentScreenshotUrl } from "@/server/actions/paymentScreenshot";

export function AdminPaymentScreenshot({
  paymentId,
  uploadedAt,
  sizeBytes,
  contentType = "image/jpeg",
}: {
  paymentId: string;
  uploadedAt: string;
  sizeBytes: number;
  contentType?: string;
}) {
  const [url, setUrl] = useState<string>();
  const [resolvedContentType, setResolvedContentType] = useState<string>(contentType);
  const [loadingView, setLoadingView] = useState(false);
  const [loadingDownload, setLoadingDownload] = useState(false);
  const [error, setError] = useState<string>();

  const handlePreview = async () => {
    setLoadingView(true);
    setError(undefined);
    const result = await createAdminPaymentScreenshotUrl(paymentId, "VIEW");
    setLoadingView(false);
    if (result.success && result.url) {
      setUrl(result.url);
      if (result.contentType) setResolvedContentType(result.contentType);
    } else {
      setError(result.error || "Unable to load screenshot.");
    }
  };

  const handleDownload = async () => {
    setLoadingDownload(true);
    setError(undefined);
    const result = await createAdminPaymentScreenshotUrl(paymentId, "DOWNLOAD");
    setLoadingDownload(false);
    if (result.success && result.url) {
      const a = document.createElement("a");
      a.href = result.url;
      a.download = result.fileName || `payment-proof-${paymentId.slice(0, 8)}.jpg`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      setError(result.error || "Unable to prepare secure download.");
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-bold text-[#35110f]">
          <ImageIcon size={17} className="text-[#7c1619]" />
          <span>Payment Screenshot Evidence</span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
          <ShieldCheck size={12} />
          Private Signed Access (5m TTL)
        </span>
      </div>

      {/* Attachment Metadata */}
      <div className="mt-2.5 grid grid-cols-1 gap-2 rounded-lg border border-[#eadbcf]/70 bg-white/80 p-2.5 text-xs text-[#705a54] sm:grid-cols-3">
        <div>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-[#705a54]/80">
            Uploaded (IST)
          </span>
          <span className="font-medium text-[#35110f]">
            {new Date(uploadedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
          </span>
        </div>
        <div>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-[#705a54]/80">
            File Size
          </span>
          <span className="font-mono font-semibold text-[#35110f]">
            {(sizeBytes / 1024).toFixed(1)} KB ({sizeBytes.toLocaleString()} bytes)
          </span>
        </div>
        <div>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-[#705a54]/80">
            MIME Format
          </span>
          <span className="font-mono font-semibold text-[#35110f]">{resolvedContentType}</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={handlePreview}
          disabled={loadingView}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#7c1619] px-3.5 py-2 text-xs font-bold text-white shadow-2xs transition hover:bg-[#631214] disabled:opacity-50"
        >
          {loadingView ? <Loader2 className="animate-spin" size={14} /> : <Eye size={14} />}
          <span>{url ? "Refresh Private Preview" : "Open Private Preview"}</span>
        </button>

        <button
          type="button"
          onClick={handleDownload}
          disabled={loadingDownload}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#eadbcf] bg-white px-3.5 py-2 text-xs font-bold text-[#35110f] shadow-2xs transition hover:bg-[#faf3ee] disabled:opacity-50"
        >
          {loadingDownload ? (
            <Loader2 className="animate-spin" size={14} />
          ) : (
            <Download size={14} />
          )}
          <span>Secure Download</span>
        </button>
      </div>

      {url && (
        <div className="mt-4 space-y-2">
          {/* Signed remote URLs are intentionally not passed through an optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Private payment screenshot"
            className="max-h-96 rounded-lg border border-[#eadbcf] bg-white shadow-xs"
          />
          <p className="text-[11px] text-[#705a54]">
            Viewing and downloading payment screenshots are logged in the append-only audit timeline.
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-xs font-semibold text-red-700">{error}</p>}
    </div>
  );
}
