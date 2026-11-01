import { notFound } from "next/navigation";
import { connection } from "next/server";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { manualUpiConfig } from "@/lib/config/payment";
import { buildUpiPaymentUri, generateUpiQrDataUrl } from "@/lib/payment/upi";
import { lookupRecoveryTokenDetails } from "@/server/actions/paymentRecovery";
import { Logo } from "@/components/brand/Logo";
import { PaymentDetailsForm } from "@/components/payment/PaymentDetailsForm";
import { CustomerPaymentJourney } from "@/components/payment/CustomerPaymentJourney";

export const instant = false;

type Props = {
  params: Promise<{ token: string }>;
};

export default async function PaymentCompletionPage({ params }: Props) {
  await connection();
  const { token } = await params;

  if (!token) notFound();

  const details = await lookupRecoveryTokenDetails(token);

  if (!details.valid) {
    return (
      <div className="min-h-screen bg-[#fcf9f6] text-[#35110f] py-12 px-4 sm:px-6">
        <div className="mx-auto max-w-lg space-y-6">
          <div className="flex justify-center">
            <Logo size="md" />
          </div>

          <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 sm:p-8 shadow-sm text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-700">
              {details.status === "EXPIRED" ? (
                <Clock size={28} />
              ) : details.status === "ALREADY_ISSUED" ? (
                <CheckCircle2 size={28} className="text-emerald-700" />
              ) : (
                <XCircle size={28} />
              )}
            </div>

            <h1 className="font-mono text-xl font-bold text-[#7c1619]">
              {details.status === "EXPIRED"
                ? "Payment Link Expired"
                : details.status === "REVOKED"
                ? "Payment Link Revoked"
                : details.status === "ALREADY_ISSUED"
                ? "Tickets Already Issued"
                : "Unable to Complete Payment"}
            </h1>

            <p className="text-xs text-[#705a54] leading-relaxed">
              {details.error ?? "This payment details link is not active or has been replaced."}
            </p>

            {details.orderNumber && (
              <div className="inline-block rounded-lg bg-[#fffaf7] border border-[#eadbcf] px-3 py-1 font-mono text-xs font-bold text-[#7c1619]">
                Order: {details.orderNumber}
              </div>
            )}

            <div className="pt-4 border-t border-[#f0e7df] space-y-2 text-xs text-[#705a54]">
              <p>Need assistance with your order or payment?</p>
              <p className="font-semibold text-[#7c1619]">
                Email: {manualUpiConfig.supportEmail}
              </p>
            </div>

            <div className="pt-2">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7c1619] hover:underline"
              >
                <ArrowLeft size={14} />
                <span>Return to SSFI Home</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const amountInr = (details.totalAmountPaise ?? 0) / 100;
  const isReopening = details.status === "SUBMITTED_AWAITING_VERIFICATION";

  const upiIntentUri = buildUpiPaymentUri({
    payeeVpa: manualUpiConfig.upiId,
    payeeName: manualUpiConfig.displayName,
    amountPaise: details.totalAmountPaise ?? 0,
    orderNumber: details.orderNumber ?? "",
    transactionRef: details.orderNumber ?? "",
    currency: manualUpiConfig.currency,
  });

  const dynamicQrDataUrl = await generateUpiQrDataUrl(upiIntentUri, { width: 320 });

  return (
    <div className="min-h-screen bg-[#fcf9f6] text-[#35110f] py-8 px-4 sm:px-6">
      <div className="mx-auto max-w-xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Logo size="sm" />
          <span className="rounded-full bg-[#fceeee] px-3 py-1 font-mono text-xs font-bold text-[#a41f23]">
            {details.orderNumber}
          </span>
        </div>

        {/* Order Summary Header Card */}
        <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0e7df] pb-4">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#705a54]">
                Payment Completion &amp; Recovery
              </span>
              <h1 className="mt-0.5 text-xl font-bold text-[#35110f]">
                {details.customerName ? `Welcome, ${details.customerName}` : "Complete Your Payment"}
              </h1>
            </div>
            <div className="text-right">
              <span className="block font-mono text-2xl font-bold text-[#7c1619]">
                ₹{amountInr.toFixed(2)}
              </span>
              <span className="text-[11px] text-[#705a54]">
                {details.quantity} {details.quantity === 1 ? "Ticket" : "Tickets"}
              </span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3">
              <span className="text-[10px] uppercase font-bold text-[#705a54]">Order Number</span>
              <p className="mt-0.5 font-mono font-bold text-[#7c1619]">{details.orderNumber}</p>
            </div>
            <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3">
              <span className="text-[10px] uppercase font-bold text-[#705a54]">Attribution</span>
              <p className="mt-0.5 font-semibold text-[#35110f]">
                {details.sellerDisplayName || "Direct Sale"}
              </p>
            </div>
          </div>
        </div>

        {/* Customer Payment Journey with UPI details and "I HAVE COMPLETED PAYMENT" CTA */}
        <CustomerPaymentJourney
          orderNumber={details.orderNumber ?? ""}
          payeeName={manualUpiConfig.displayName}
          upiId={manualUpiConfig.upiId}
          amountInr={amountInr}
          upiIntentUri={upiIntentUri}
          dynamicQrDataUrl={dynamicQrDataUrl}
          staticQrImagePath={manualUpiConfig.qrImagePath}
          isMock={manualUpiConfig.isMock}
          isReopening={isReopening}
        >
          <PaymentDetailsForm
            orderId={details.orderId ?? ""}
            orderNumber={details.orderNumber ?? ""}
            token={token}
            initialUtr={details.paymentUtr}
            initialEmail={details.customerEmail}
            suggestedPhone={details.customerPhone}
            initialWhatsapp={details.customerWhatsapp}
            initialPayerName={details.paymentPayerName}
            isReopening={isReopening}
            isMock={manualUpiConfig.isMock}
          />
        </CustomerPaymentJourney>
      </div>
    </div>
  );
}
