"use client";
import { useState } from "react";
import { Image as ImageIcon, Loader2 } from "lucide-react";
import { createAdminPaymentScreenshotUrl } from "@/server/actions/paymentScreenshot";
export function AdminPaymentScreenshot({ paymentId, uploadedAt, sizeBytes }: { paymentId: string; uploadedAt: string; sizeBytes: number }) {
  const [url, setUrl] = useState<string>(); const [loading, setLoading] = useState(false); const [error, setError] = useState<string>();
  const preview = async () => { setLoading(true); const result = await createAdminPaymentScreenshotUrl(paymentId); setLoading(false); if (result.success) setUrl(result.url); else setError(result.error); };
  return <div className="mt-6 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4"><div className="flex items-center gap-2 font-bold text-[#35110f]"><ImageIcon size={17} /> Payment screenshot submitted</div><p className="mt-1 text-xs text-[#705a54]">{new Date(uploadedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {(sizeBytes / 1024).toFixed(0)} KB</p>{url ? <>
    {/* Signed remote URLs are intentionally not passed through an optimizer. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={url} alt="Private payment screenshot" className="mt-3 max-h-96 rounded-lg border" />
  </> : <button type="button" onClick={preview} disabled={loading} className="mt-3 rounded-lg bg-[#7c1619] px-3 py-2 text-xs font-bold text-white">{loading ? <Loader2 className="animate-spin" size={14} /> : "Open private preview"}</button>}{error && <p className="mt-2 text-xs text-red-700">{error}</p>}</div>;
}
