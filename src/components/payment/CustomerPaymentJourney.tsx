"use client";

import { useRef, useState } from "react";
import { ArrowDown, CheckCircle2 } from "lucide-react";
import { UpiPaymentBox } from "@/components/payment/UpiPaymentBox";

type Props = {
  orderNumber: string;
  payeeName: string;
  upiId: string;
  amountInr: number;
  upiIntentUri: string;
  dynamicQrDataUrl: string;
  staticQrImagePath?: string;
  isMock?: boolean;
  isReopening?: boolean;
  children: React.ReactNode;
};

export function CustomerPaymentJourney({
  orderNumber,
  payeeName,
  upiId,
  amountInr,
  upiIntentUri,
  dynamicQrDataUrl,
  staticQrImagePath,
  isMock,
  isReopening = false,
  children,
}: Props) {
  // If reopening an already-submitted payment, show the form immediately
  const [showForm, setShowForm] = useState(isReopening);
  const formRef = useRef<HTMLDivElement>(null);

  const handleCompletedPaymentClick = () => {
    setShowForm(true);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  return (
    <div className="space-y-6">
      {/* Step 1: Transfer Payment */}
      <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm space-y-5">
        <div className="border-b border-[#f0e7df] pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">
              1
            </span>
            <h2 className="text-base font-bold text-[#35110f]">Transfer Order Amount via UPI</h2>
          </div>
          <p className="mt-1 text-xs text-[#705a54]">
            Pay exact total <b className="text-[#7c1619]">₹{amountInr.toFixed(2)}</b> using any UPI app or scan the QR code below.
          </p>
        </div>

        {/* UPI Payment Box with QR and Copy actions */}
        <UpiPaymentBox
          orderNumber={orderNumber}
          payeeName={payeeName}
          upiId={upiId}
          amountInr={amountInr}
          upiIntentUri={upiIntentUri}
          dynamicQrDataUrl={dynamicQrDataUrl}
          staticQrImagePath={staticQrImagePath}
          isMock={isMock}
        />

        {/* Dedicated "I HAVE COMPLETED PAYMENT" CTA */}
        <div className="pt-3 border-t border-[#f0e7df]">
          <button
            type="button"
            onClick={handleCompletedPaymentClick}
            className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-emerald-700 p-4 text-base font-bold text-white shadow-md transition hover:bg-emerald-800 active:scale-99"
          >
            <CheckCircle2 size={20} className="shrink-0" />
            <span>I HAVE COMPLETED PAYMENT</span>
            <ArrowDown size={18} className="shrink-0 animate-bounce" />
          </button>
          <p className="mt-1.5 text-center text-[11px] text-[#705a54]">
            Click after completing your transfer in Google Pay, PhonePe, Paytm, BHIM, or any bank app.
          </p>
        </div>
      </div>

      {/* Step 2: Required Details Form */}
      {showForm && (
        <div
          ref={formRef}
          className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm space-y-4 animate-in fade-in slide-in-from-top-4 duration-300"
        >
          <div className="border-b border-[#f0e7df] pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">
                2
              </span>
              <h2 className="text-base font-bold text-[#35110f]">Submit Payment &amp; Contact Details</h2>
            </div>
            <p className="mt-1 text-xs text-[#705a54]">
              Mandatory UTR reference, email, and WhatsApp number are required to verify payment and dispatch tickets.
            </p>
          </div>

          {children}
        </div>
      )}
    </div>
  );
}
