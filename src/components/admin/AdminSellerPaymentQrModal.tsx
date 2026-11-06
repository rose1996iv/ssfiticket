"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Power,
  PowerOff,
  QrCode,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  adminActivateSellerPaymentQr,
  adminDeactivateSellerPaymentQr,
  getAdminSellerQrSignedUrl,
} from "@/server/actions/seller";

type Props = {
  sellerId: string;
  sellerCode: string;
  displayName: string;
  isActive: boolean;
  isQrActive: boolean;
  hasQrImage: boolean;
  upiId?: string | null;
  accountName?: string | null;
};

export function AdminSellerPaymentQrModal({
  sellerId,
  sellerCode,
  displayName,
  isActive,
  isQrActive,
  hasQrImage,
  upiId,
  accountName,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleOpen = async () => {
    setIsOpen(true);
    setFeedback(null);
    if (hasQrImage && !previewUrl) {
      setIsLoadingPreview(true);
      const res = await getAdminSellerQrSignedUrl(sellerId);
      setIsLoadingPreview(false);
      if (res.success && res.url) {
        setPreviewUrl(res.url);
      }
    }
  };

  const handleActivate = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await adminActivateSellerPaymentQr(sellerId);
      if (res.success) {
        setFeedback({ type: "success", text: res.message || "Payment QR activated." });
      } else {
        setFeedback({ type: "error", text: res.error || "Failed to activate QR." });
      }
    });
  };

  const handleDeactivate = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await adminDeactivateSellerPaymentQr(sellerId);
      if (res.success) {
        setFeedback({ type: "success", text: res.message || "Payment QR deactivated." });
      } else {
        setFeedback({ type: "error", text: res.error || "Failed to deactivate QR." });
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold shadow-2xs transition ${
          isQrActive
            ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
            : hasQrImage
            ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
            : "border-[#eadbcf] bg-white text-[#705a54] hover:bg-[#fffaf7]"
        }`}
        title="Inspect and Manage Personal Payment QR"
      >
        <QrCode size={13} />
        <span>Payment QR</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-2xl">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-[#f0e7df] pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-[#35110f]">
                    Seller Payment QR Review
                  </h2>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      isQrActive
                        ? "bg-emerald-100 text-emerald-800"
                        : hasQrImage
                        ? "bg-amber-100 text-amber-800"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {isQrActive ? "Active" : hasQrImage ? "Pending Approval" : "Not Configured"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#705a54]">
                  {displayName} · <span className="font-mono font-bold text-[#7c1619]">{sellerCode}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1 text-[#705a54] transition hover:bg-[#fffaf7] hover:text-[#35110f]"
              >
                <X size={18} />
              </button>
            </div>

            {/* Feedback alert */}
            {feedback && (
              <div
                className={`mt-4 flex items-start gap-2.5 rounded-xl border p-3 text-xs ${
                  feedback.type === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-red-200 bg-red-50 text-red-900"
                }`}
              >
                {feedback.type === "success" ? (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
                )}
                <span>{feedback.text}</span>
              </div>
            )}

            {/* Content Body */}
            <div className="mt-5 space-y-4 text-xs">
              {/* Payment Details Card */}
              <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-[#705a54]">Payee Account Name:</span>
                  <b className="text-[#35110f]">{accountName || "—"}</b>
                </div>
                <div className="flex justify-between border-t border-[#f0e7df] pt-2">
                  <span className="text-[#705a54]">Seller UPI ID:</span>
                  <span className="font-mono font-bold text-[#7c1619]">{upiId || "Not Configured"}</span>
                </div>
                <div className="flex justify-between border-t border-[#f0e7df] pt-2">
                  <span className="text-[#705a54]">Seller Account Status:</span>
                  <span className={`font-semibold ${isActive ? "text-emerald-700" : "text-red-700"}`}>
                    {isActive ? "Active Account" : "Deactivated Account"}
                  </span>
                </div>
              </div>

              {/* QR Preview Section */}
              <div className="flex flex-col items-center justify-center rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-5">
                <span className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[#705a54]">
                  Personal Payment QR Image
                </span>
                {isLoadingPreview ? (
                  <div className="flex h-48 w-48 items-center justify-center">
                    <Loader2 size={24} className="animate-spin text-[#7c1619]" />
                  </div>
                ) : previewUrl ? (
                  <div className="relative h-56 w-56 overflow-hidden rounded-xl border border-white bg-white p-2 shadow-xs">
                    <Image
                      src={previewUrl}
                      alt={`Payment QR for ${sellerCode}`}
                      fill
                      className="object-contain"
                      unoptimized
                    />
                  </div>
                ) : hasQrImage ? (
                  <div className="flex h-48 w-48 flex-col items-center justify-center text-center">
                    <ShieldCheck size={32} className="text-emerald-600 mb-2" />
                    <span className="text-xs text-[#705a54]">QR code image on file</span>
                  </div>
                ) : (
                  <div className="flex h-48 w-48 flex-col items-center justify-center text-center">
                    <QrCode size={32} className="text-[#cbb5a7] mb-2" />
                    <span className="text-xs text-[#9c847e]">No QR image uploaded by seller</span>
                  </div>
                )}
              </div>

              {/* Strict Policy Notice */}
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900 leading-relaxed">
                <b>Strict Seller QR Policy:</b> Customers checking out via referral code{" "}
                <b className="font-mono">{sellerCode}</b> can only pay if this personal QR is approved and active.
                SSFI central QR fallback is strictly prohibited.
              </div>

              {/* Administrator Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#f0e7df]">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-xl border border-[#eadbcf] px-4 py-2 font-semibold text-[#705a54] hover:bg-[#fffaf7]"
                >
                  Close
                </button>

                {isQrActive ? (
                  <button
                    type="button"
                    onClick={handleDeactivate}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-4 py-2 font-bold text-white shadow-xs transition hover:bg-red-800 disabled:opacity-50"
                  >
                    {isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <PowerOff size={14} />
                    )}
                    <span>Deactivate Payment QR</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleActivate}
                    disabled={isPending || !hasQrImage || !upiId || !isActive}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white shadow-xs transition hover:bg-emerald-800 disabled:opacity-50"
                  >
                    {isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Power size={14} />
                    )}
                    <span>Approve &amp; Activate QR</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
