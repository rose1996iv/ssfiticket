"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, FlaskConical, Loader2, User } from "lucide-react";
import { submitPublicUpiPayment } from "@/server/actions/publicOrder";
import { PaymentScreenshotField } from "@/components/payment/PaymentScreenshotField";
import { uploadPaymentScreenshot } from "@/server/actions/paymentScreenshot";

type Props = {
  orderId: string;
  isMock?: boolean;
};

export function PublicUpiPaymentForm({ orderId, isMock }: Props) {
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
      // 1. Upload screenshot first
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

      const res = await submitPublicUpiPayment(formData);
      if (!res.success) {
        setErrorMessage(res.error || "Payment submission failed. Please try again.");
        setLoading(false);
        return;
      }

      // Success: navigate to order confirmation with submitted query param
      if (res.redirectUrl) {
        router.push(res.redirectUrl);
        router.refresh();
      } else {
        router.push(`/buy/order/${orderId}?submitted=1`);
        router.refresh();
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("An unexpected network error occurred. Please retry.");
      }
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 border-t border-[#f0e7df] pt-5">
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
                setPayerName("Simulated Buyer");
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
              Clear
            </button>
          </div>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900 shadow-2xs"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 text-red-600 shrink-0" size={18} />
            <div className="text-xs leading-relaxed">
              <p className="font-bold text-red-950">Submission could not be completed</p>
              <p className="mt-0.5 font-medium">{errorMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* Payer Name (Optional) */}
      <div>
        <label htmlFor="payerName" className="block text-xs font-semibold uppercase tracking-wider text-[#705a54]">
          Payer Name / Bank Account Holder Name{" "}
          <span className="font-normal text-[#705a54] normal-case tracking-normal">(Optional)</span>
        </label>
        <div className="relative mt-1.5">
          <input
            id="payerName"
            name="payerName"
            type="text"
            maxLength={120}
            value={payerName}
            onChange={(e) => {
              setPayerName(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            placeholder="Name on bank or UPI account (optional)"
            className="w-full rounded-xl border border-[#eadbcf] bg-white p-3 pr-10 text-sm text-[#35110f] transition focus:border-[#7c1619] focus:outline-hidden"
          />
          <User size={16} className="absolute right-3.5 top-3.5 text-[#705a54]/60 pointer-events-none" />
        </div>
        <p className="mt-1 text-[11px] text-[#705a54]">
          Providing the name on your bank or UPI account helps us verify your payment faster.
        </p>
      </div>

      {/* Payment Screenshot — MANDATORY */}
      <PaymentScreenshotField onChange={setScreenshot} />

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7c1619] py-3.5 px-6 font-bold text-white shadow-sm transition hover:bg-[#631214] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" size={18} />
            <span>Submitting Payment Proof...</span>
          </>
        ) : (
          <>
            <span>Submit Payment Screenshot</span>
            <ArrowRight size={18} />
          </>
        )}
      </button>

      <p className="text-center text-[11px] text-[#705a54]">
        Submitting your screenshot sends it to SSFI organizers for manual verification. Tickets are issued atomically once confirmed.
      </p>
    </form>
  );
}
