"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { submitManualUpi } from "@/server/actions/operations";

type Props = {
  orderId: string;
  isMock?: boolean;
};

export function SellerUpiPaymentForm({ orderId, isMock }: Props) {
  const router = useRouter();
  const [utr, setUtr] = useState("");
  const [payerName, setPayerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage(null);

    const trimmedUtr = utr.trim();

    if (!trimmedUtr) {
      setErrorMessage("Please enter the payment reference / UTR.");
      setLoading(false);
      return;
    }

    if (trimmedUtr.length < 6) {
      setErrorMessage("UTR / Transaction Reference must be at least 6 characters.");
      setLoading(false);
      return;
    }

    if (isMock) {
      const isTest = /^(TEST|MOCK)[A-Za-z0-9-]*$/i.test(trimmedUtr);
      if (!isTest) {
        setErrorMessage(
          "Preview mock payment mode is active. Please enter a recognized test reference starting with TEST or MOCK (e.g. TEST12345678)."
        );
        setLoading(false);
        return;
      }
    }

    const formData = new FormData();
    formData.set("orderId", orderId);
    formData.set("utr", trimmedUtr);
    if (payerName.trim()) {
      formData.set("payerName", payerName.trim());
    }

    try {
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
      if (err instanceof Error) {
        if (
          err.message.includes("already been submitted") ||
          err.message.includes("already attached")
        ) {
          setErrorMessage(
            "This Transaction ID / UTR has already been submitted. Please check your payment receipt and enter a different valid reference."
          );
        } else {
          setErrorMessage(err.message);
        }
      } else {
        setErrorMessage("An unexpected network error occurred. Please retry.");
      }
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <input type="hidden" name="orderId" value={orderId} />

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
                Correct the reference below and submit again.
              </p>
            </div>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-[#705a54]">
          UTR / Bank Payment Reference <span className="text-red-500">*</span>
        </label>
        <input
          name="utr"
          required
          minLength={6}
          maxLength={64}
          value={utr}
          onChange={(e) => {
            setUtr(e.target.value);
            if (errorMessage) setErrorMessage(null);
          }}
          placeholder={isMock ? "e.g. TEST12345678" : "e.g. 428172918291"}
          className={`mt-1 w-full rounded-xl border bg-white p-3 font-mono text-sm text-[#35110f] transition focus:outline-hidden ${
            errorMessage
              ? "border-red-400 ring-2 ring-red-200 focus:border-red-500"
              : "border-[#eadbcf] focus:border-[#7c1619]"
          }`}
        />
      </div>

      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-[#705a54]">
          Payer Name <span className="text-xs font-normal text-[#705a54]">(Optional)</span>
        </label>
        <input
          name="payerName"
          maxLength={120}
          value={payerName}
          onChange={(e) => setPayerName(e.target.value)}
          placeholder="Name on customer's UPI/bank account"
          className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-white p-3 text-sm text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
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
            <span>Submit Payment Reference</span>
            <ArrowRight size={16} />
          </>
        )}
      </button>
    </form>
  );
}
