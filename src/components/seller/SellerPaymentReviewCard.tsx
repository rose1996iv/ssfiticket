"use client";

import { useState, useTransition } from "react";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Flag,
  Loader2,
  ThumbsDown,
  ThumbsUp,
  User,
} from "lucide-react";
import { submitSellerPaymentReview } from "@/server/actions/sellerPaymentReview";
import { createSellerPaymentScreenshotUrl } from "@/server/actions/paymentScreenshot";

type Payment = {
  id: string;
  status: string;
  amount_paise: number;
  utr_reference: string | null;
  payer_name: string | null;
  submitted_at: string | null;
  seller_review_status: string | null;
  seller_reviewed_at: string | null;
  seller_review_note: string | null;
  payment_screenshots:
    | { uploaded_at: string }
    | { uploaded_at: string }[]
    | null;
  orders:
    | {
        id: string;
        order_number: string;
        quantity: number;
        customers:
          | { full_name: string; phone: string; whatsapp_number: string }
          | { full_name: string; phone: string; whatsapp_number: string }[]
          | null;
      }
    | {
        id: string;
        order_number: string;
        quantity: number;
        customers:
          | { full_name: string; phone: string; whatsapp_number: string }
          | { full_name: string; phone: string; whatsapp_number: string }[]
          | null;
      }[]
    | null;
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  RECOMMENDED_APPROVAL: { label: "Recommended Approval", color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  RECOMMENDED_REJECTION: { label: "Recommended Rejection", color: "text-red-700 bg-red-50 border-red-200" },
  FLAGGED_DISCREPANCY: { label: "Flagged Discrepancy", color: "text-amber-700 bg-amber-50 border-amber-200" },
};

export function SellerPaymentReviewCard({
  payment,
  readonly = false,
}: {
  payment: Payment;
  readonly?: boolean;
}) {
  const rawOrder = payment.orders;
  const order = Array.isArray(rawOrder) ? rawOrder[0] : rawOrder;

  const rawCustomer = order?.customers;
  const customer = Array.isArray(rawCustomer) ? rawCustomer[0] : rawCustomer;

  const rawScreenshots = payment.payment_screenshots;
  const screenshot = Array.isArray(rawScreenshots)
    ? rawScreenshots[0]
    : rawScreenshots;
  const hasScreenshot = Boolean(screenshot);
  const amountInr = payment.amount_paise / 100;

  const [expanded, setExpanded] = useState(!readonly);
  const [reviewStatus, setReviewStatus] = useState<string>("");
  const [reviewNote, setReviewNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleLoadScreenshot = async () => {
    setScreenshotLoading(true);
    setScreenshotError(null);
    const result = await createSellerPaymentScreenshotUrl(payment.id);
    if (result.success && result.url) {
      setScreenshotUrl(result.url);
    } else {
      setScreenshotError(result.error ?? "Could not load screenshot.");
    }
    setScreenshotLoading(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!reviewStatus) {
      setError("Please select a review recommendation.");
      return;
    }
    const formData = new FormData();
    formData.set("paymentId", payment.id);
    formData.set("reviewStatus", reviewStatus);
    formData.set("reviewNote", reviewNote);
    startTransition(async () => {
      const result = await submitSellerPaymentReview(formData);
      if (result.success) {
        setSuccess(true);
      } else {
        setError(result.error ?? "Submission failed. Please try again.");
      }
    });
  };

  const reviewStatusMeta = payment.seller_review_status
    ? STATUS_LABELS[payment.seller_review_status]
    : null;

  return (
    <div className="rounded-2xl border border-[#eadbcf] bg-white shadow-sm overflow-hidden">
      {/* Card Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-[#fffaf7] transition"
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-full bg-[#f8e9df] p-2 shrink-0">
            <User size={16} className="text-[#7c1619]" />
          </div>
          <div className="min-w-0">
            <p className="font-mono text-sm font-bold text-[#7c1619] truncate">
              {order?.order_number ?? "—"}
            </p>
            <p className="text-xs text-[#705a54] truncate">
              {customer?.full_name ?? "Unknown customer"} · ₹{amountInr} INR · {order?.quantity} ticket{order?.quantity !== 1 ? "s" : ""}
            </p>
            {payment.submitted_at && (
              <p className="text-[10px] text-[#aaa] mt-0.5">
                Submitted: {new Date(payment.submitted_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasScreenshot ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              <Camera size={10} />
              Screenshot
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              No screenshot
            </span>
          )}
          {reviewStatusMeta && (
            <span className={`hidden sm:inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${reviewStatusMeta.color}`}>
              {reviewStatusMeta.label}
            </span>
          )}
          {expanded ? <ChevronUp size={16} className="text-[#705a54]" /> : <ChevronDown size={16} className="text-[#705a54]" />}
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-[#f0e7df] p-4 space-y-4">
          {/* Payment details */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#705a54]">UTR / Reference</p>
              <p className="font-mono font-bold text-[#7c1619]">{payment.utr_reference ?? <em className="text-[#705a54] not-italic">Not provided</em>}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#705a54]">Payer Name</p>
              <p className="font-semibold text-[#35110f]">{payment.payer_name ?? <em className="text-[#705a54] not-italic">Not provided</em>}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#705a54]">Phone</p>
              <p className="font-mono text-[#35110f]">{customer?.whatsapp_number ?? customer?.phone ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#705a54]">Amount</p>
              <p className="font-bold text-[#7c1619]">₹{amountInr} INR</p>
            </div>
          </div>

          {/* Screenshot viewer */}
          {hasScreenshot && (
            <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3">
              <p className="text-xs font-semibold text-[#705a54] mb-2">Payment Screenshot</p>
              {screenshotUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={screenshotUrl}
                  alt="Payment screenshot"
                  className="max-h-64 rounded-lg border border-[#eadbcf] object-contain w-full bg-white"
                />
              ) : (
                <button
                  type="button"
                  onClick={handleLoadScreenshot}
                  disabled={screenshotLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#eadbcf] bg-white px-3 py-2 text-xs font-semibold text-[#7c1619] hover:bg-[#f8e9df] transition disabled:opacity-60"
                >
                  {screenshotLoading ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
                  {screenshotLoading ? "Loading…" : "View Screenshot"}
                </button>
              )}
              {screenshotError && (
                <p className="mt-1 text-xs text-red-600">{screenshotError}</p>
              )}
            </div>
          )}

          {/* Existing review (readonly mode) */}
          {readonly && reviewStatusMeta && (
            <div className={`rounded-xl border p-3 text-xs ${reviewStatusMeta.color}`}>
              <p className="font-bold">{reviewStatusMeta.label}</p>
              {payment.seller_review_note && (
                <p className="mt-1 text-[11px]">{payment.seller_review_note}</p>
              )}
              {payment.seller_reviewed_at && (
                <p className="mt-1 text-[10px] opacity-70">
                  Reviewed: {new Date(payment.seller_reviewed_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                </p>
              )}
              <p className="mt-2 text-[10px] opacity-70">
                Your advisory review has been recorded. Final approval requires SSFI Admin verification.
              </p>
            </div>
          )}

          {/* Review form (not readonly, not yet submitted) */}
          {!readonly && !success && (
            <form onSubmit={handleSubmit} className="space-y-3">
              {/* Advisory disclaimer */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-[11px] text-amber-900">
                <p className="font-bold flex items-center gap-1">
                  <Clock size={12} />
                  Advisory Review Only
                </p>
                <p className="mt-0.5">
                  Your recommendation helps admins prioritize verification but does not approve payments or issue tickets.
                  Final decision authority rests exclusively with SSFI Administrators.
                </p>
              </div>

              {/* Review status radio buttons */}
              <div>
                <p className="text-xs font-semibold text-[#705a54] mb-2">Your Recommendation</p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 cursor-pointer hover:bg-emerald-50 transition">
                    <input
                      type="radio"
                      name="reviewStatus"
                      value="RECOMMENDED_APPROVAL"
                      checked={reviewStatus === "RECOMMENDED_APPROVAL"}
                      onChange={(e) => setReviewStatus(e.target.value)}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                    <ThumbsUp size={14} className="text-emerald-600 shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-emerald-900">Recommend Approval</p>
                      <p className="text-[10px] text-emerald-700">Payment details appear correct and screenshot matches amount.</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50/60 p-3 cursor-pointer hover:bg-red-50 transition">
                    <input
                      type="radio"
                      name="reviewStatus"
                      value="RECOMMENDED_REJECTION"
                      checked={reviewStatus === "RECOMMENDED_REJECTION"}
                      onChange={(e) => setReviewStatus(e.target.value)}
                      className="text-red-600 focus:ring-red-500"
                    />
                    <ThumbsDown size={14} className="text-red-600 shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-red-900">Recommend Rejection</p>
                      <p className="text-[10px] text-red-700">Screenshot does not match, amount is wrong, or payment appears fake.</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3 cursor-pointer hover:bg-amber-50 transition">
                    <input
                      type="radio"
                      name="reviewStatus"
                      value="FLAGGED_DISCREPANCY"
                      checked={reviewStatus === "FLAGGED_DISCREPANCY"}
                      onChange={(e) => setReviewStatus(e.target.value)}
                      className="text-amber-600 focus:ring-amber-500"
                    />
                    <Flag size={14} className="text-amber-600 shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-amber-900">Flag Discrepancy</p>
                      <p className="text-[10px] text-amber-700">Something seems off — needs closer admin investigation.</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Optional note */}
              <div>
                <label htmlFor={`note-${payment.id}`} className="block text-xs font-semibold text-[#705a54] mb-1">
                  Note for Admin <span className="font-normal">(optional, max 500 chars)</span>
                </label>
                <textarea
                  id={`note-${payment.id}`}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Describe any discrepancy or reason for your recommendation…"
                  className="w-full rounded-xl border border-[#eadbcf] bg-white p-2.5 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden focus:ring-1 focus:ring-[#7c1619]/20 resize-none"
                />
              </div>

              {error && (
                <div className="flex items-center gap-1.5 text-xs text-red-600">
                  <AlertCircle size={13} />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#7c1619] p-3 text-xs font-bold text-white shadow-sm transition hover:bg-[#631214] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isPending ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    Submitting Review…
                  </>
                ) : (
                  "Submit Advisory Review"
                )}
              </button>
            </form>
          )}

          {/* Success state */}
          {success && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900">
              <p className="font-bold flex items-center gap-1.5">
                <CheckCircle2 size={14} />
                Review Submitted
              </p>
              <p className="mt-1 text-[11px] text-emerald-800">
                Your advisory recommendation has been recorded. SSFI Administrators will make the final verification decision.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

