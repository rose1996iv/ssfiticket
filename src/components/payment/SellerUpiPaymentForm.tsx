"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, FlaskConical, Loader2 } from "lucide-react";
import { submitManualUpi } from "@/server/actions/operations";
import { PaymentScreenshotField } from "@/components/payment/PaymentScreenshotField";
import { uploadPaymentScreenshot } from "@/server/actions/paymentScreenshot";
import { isNextRedirectError } from "@/lib/navigation/redirect";

type Props = {
  orderId: string;
  isMock?: boolean;
};

export function SellerUpiPaymentForm({ orderId, isMock }: Props) {
  const router = useRouter();
  const [payerName, setPayerName] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage(null);

    const trimmedPayerName = payerName.trim();

    if (!screenshot) {
      setErrorMessage("A payment screenshot is mandatory. Please upload your payment confirmation screenshot before submitting.");
      setLoading(false);
      return;
    }

    try {
      // 1. Upload mandatory screenshot first
      const screenshotData = new FormData();
      screenshotData.set("orderId", orderId);
      screenshotData.set("screenshot", screenshot);

      const uploadRes = await uploadPaymentScreenshot(screenshotData);
      if (!uploadRes.success) {
        setErrorMessage(uploadRes.error || "Screenshot upload failed. Please try again.");
        setLoading(false);
        return;
      }

      // 2. Submit payment reference
      const formData = new FormData();
      formData.set("orderId", orderId);
      formData.set("payerName", trimmedPayerName || "");

      const res = await submitManualUpi(formData);
      if (!res.success) {
        setErrorMessage(res.error || "Payment submission failed. Please try again.");
        setLoading(false);
        return;
      }

      if (res.redirectUrl) {
        router.push(res.redirectUrl);
        router.refresh();
      } else {
        router.push(`/seller/orders/${orderId}?submitted=1`);
        router.refresh();
      }
    } catch (err: unknown) {
      if (isNextRedirectError(err)) {
        throw err;
      }
      setLoading(false);
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("already been submitted") || msg.includes("already attached")) {
        setErrorMessage(
          "Payment has already been submitted for this order and is currently under review."
        );
      } else if (msg.includes("Minified React error #441") || msg.includes("Server Components render")) {
        setErrorMessage(
          "The server could not complete payment submission. Please verify your screenshot (under 2 MB) and seller access, then try again."
        );
      } else {
        setErrorMessage(msg || "An unexpected network error occurred. Please retry.");
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <input type="hidden" name="orderId" value={orderId} />

      {/* Simulated Payment Test Controls (Dev / Preview) */}
      {isMock && (
        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/80 p-3.5 text-xs text-amber-950">
          <p className="flex items-center gap-1.5 font-bold text-amber-900">
            <FlaskConical size={14} />
            <span>Test Payment Simulation (Preview Environment — Test Data Only)</span>
          </p>
          <p className="mt-1 text-[11px] leading-normal text-amber-800">
            Use this control to test the application workflow:
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setPayerName("Simulated Customer");
                if (errorMessage) setErrorMessage(null);
              }}
              className="rounded-lg bg-amber-200/90 px-2.5 py-1.5 text-[11px] font-semibold text-amber-950 transition hover:bg-amber-300 active:scale-98"
            >
              ✓ Fill Simulated Payer Name
            </button>
            <button
              type="button"
              onClick={() => {
                setPayerName("");
                if (errorMessage) setErrorMessage(null);
              }}
              className="rounded-lg bg-amber-200/90 px-2.5 py-1.5 text-[11px] font-semibold text-amber-950 transition hover:bg-amber-300 active:scale-98"
            >
              ✓ Clear Payer Name (Screenshot Only)
            </button>
          </div>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900 shadow-2xs animate-in fade-in duration-200"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 text-red-600 shrink-0" size={18} />
            <div className="text-xs leading-relaxed">
              <p className="font-bold text-red-950">Payment Reference Notice</p>
              <p className="mt-0.5 font-medium">{errorMessage}</p>
              <p className="mt-1 text-[11px] text-red-700">
                Correct the information below and submit again.
              </p>
            </div>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-[#705a54]">
          Payer Name <span className="text-xs font-normal text-[#705a54]">(Optional)</span>
        </label>
        <input
          name="payerName"
          maxLength={120}
          value={payerName}
          onChange={(e) => {
            setPayerName(e.target.value);
            if (errorMessage) setErrorMessage(null);
          }}
          placeholder="Name on customer's UPI/bank account (optional)"
          className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-white p-3 text-sm text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
        />
        <p className="mt-1 text-[11px] text-[#705a54]">
          Account holder name is optional. Empty or omitted value is accepted.
        </p>
      </div>

      {/* Mandatory Payment Screenshot Field */}
      <div>
        <PaymentScreenshotField
          onChange={(file) => {
            setScreenshot(file);
            if (errorMessage) setErrorMessage(null);
          }}
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#7c1619] px-4 py-3.5 text-sm font-bold text-white shadow-xs transition hover:bg-[#631214] active:scale-99 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" size={16} />
            <span>Submitting Payment...</span>
          </>
        ) : (
          <>
            <span>Submit Payment &amp; Screenshot</span>
            <ArrowRight size={16} />
          </>
        )}
      </button>
    </form>
  );
}
