import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  ShieldCheck,
  Ticket,
} from "lucide-react";
import { manualUpiConfig } from "@/lib/config/payment";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { submitPublicUpiPayment } from "@/server/actions/publicOrder";

export const instant = false;

type OrderData = {
  id: string;
  order_number: string;
  quantity: number;
  total_amount_paise: number;
  status: string;
  created_at: string;
  customers: { full_name: string; whatsapp_number: string }[];
  sellers: { display_name: string; seller_code: string } | null;
  payments: {
    id: string;
    status: string;
    utr_reference: string | null;
    rejection_reason: string | null;
    submitted_at: string | null;
    verified_at: string | null;
  }[];
  tickets: { ticket_number: string }[];
};

type PageProps = {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ submitted?: string }>;
};

export default async function PublicOrderDetailPage({ params, searchParams }: PageProps) {
  await connection();
  const { orderId } = await params;
  const query = await searchParams;

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("orders")
    .select(
      "id, order_number, quantity, total_amount_paise, status, created_at, customers(full_name, whatsapp_number), sellers(display_name, seller_code), payments(id, status, utr_reference, rejection_reason, submitted_at, verified_at), tickets(ticket_number)"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error || !data) {
    notFound();
  }

  const order = data as unknown as OrderData;
  const payment = order.payments[0];
  const customer = order.customers[0];
  const seller = order.sellers;
  const totalInr = order.total_amount_paise / 100;

  const upiIntentUri = `upi://pay?pa=${encodeURIComponent(
    manualUpiConfig.upiId
  )}&pn=${encodeURIComponent(
    manualUpiConfig.displayName
  )}&am=${totalInr}&cu=INR&tn=${encodeURIComponent(order.order_number)}`;

  const isPending = order.status === "PENDING_PAYMENT";
  const isSubmitted =
    order.status === "PAYMENT_SUBMITTED" || (payment && payment.status === "SUBMITTED");
  const isIssued =
    order.status === "TICKETS_ISSUED" || (payment && payment.status === "VERIFIED");
  const isRejected = payment && payment.status === "FAILED";

  return (
    <main className="min-h-screen bg-[#fffaf7] pb-16 text-[#35110f]">
      {/* Header */}
      <header className="border-b border-[#e8d6c5] bg-[#7c1619] px-4 py-8 text-white sm:px-6">
        <div className="mx-auto max-w-xl text-center">
          <p className="text-xs font-bold tracking-[0.2em] text-[#f3ce75]">SSFI LUCKY DRAW</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Order Confirmation</h1>
          <p className="mt-1 font-mono text-xs text-[#f8e9df]">{order.order_number}</p>
        </div>
      </header>

      <div className="mx-auto mt-6 max-w-xl space-y-6 px-4 sm:px-0">
        {/* Just Submitted Notification */}
        {query.submitted && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-green-900 shadow-xs">
            <div className="flex items-center gap-2 font-bold">
              <CheckCircle2 size={18} className="text-green-600" />
              <span>Payment Reference Submitted!</span>
            </div>
            <p className="mt-1 text-xs text-green-800 leading-relaxed">
              Your payment reference has been recorded and is currently awaiting manual review by
              SSFI staff. Save this page URL to check your ticket issuance status.
            </p>
          </div>
        )}

        {/* Status Card */}
        <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f0e7df] pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#705a54]">
                Order Status
              </p>
              <h2 className="text-lg font-bold">
                {isIssued && "Tickets Issued"}
                {isSubmitted && !isIssued && "Awaiting Admin Review"}
                {isPending && !isRejected && "Awaiting Payment"}
                {isRejected && "Payment Reference Rejected"}
              </h2>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                isIssued
                  ? "bg-green-100 text-green-800"
                  : isSubmitted
                  ? "bg-blue-100 text-blue-800"
                  : isRejected
                  ? "bg-red-100 text-red-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {order.status}
            </span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-[#705a54]">Customer</dt>
              <dd className="font-semibold">{customer?.full_name}</dd>
            </div>
            <div>
              <dt className="text-xs text-[#705a54]">Phone / WhatsApp</dt>
              <dd className="font-mono text-xs">{customer?.whatsapp_number}</dd>
            </div>
            <div>
              <dt className="text-xs text-[#705a54]">Quantity</dt>
              <dd className="font-semibold">
                {order.quantity} {order.quantity === 1 ? "ticket" : "tickets"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#705a54]">Amount Due</dt>
              <dd className="text-lg font-bold text-[#7c1619]">₹{totalInr}</dd>
            </div>
            {seller && (
              <div className="col-span-2 border-t border-[#f0e7df] pt-3">
                <dt className="text-xs text-[#705a54]">Attributed Seller</dt>
                <dd className="font-medium text-[#7c1619]">
                  {seller.display_name} <span className="font-mono text-xs">({seller.seller_code})</span>
                </dd>
              </div>
            )}
          </dl>
        </div>

        {/* Issued Tickets Card (when verified) */}
        {isIssued && order.tickets.length > 0 && (
          <div className="rounded-2xl border border-green-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 font-bold text-green-800">
              <Ticket size={20} />
              <h2 className="text-lg">Your Official Ticket Numbers</h2>
            </div>
            <p className="mt-1 text-xs text-[#705a54]">
              These tickets are securely registered under your name and eligible for the SSFI Lucky Draw.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {order.tickets.map((t) => (
                <div
                  key={t.ticket_number}
                  className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50/60 p-3"
                >
                  <span className="font-mono text-base font-bold text-[#7c1619]">
                    {t.ticket_number}
                  </span>
                  <Link
                    href={`/verify/${t.ticket_number}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#7c1619] hover:underline"
                  >
                    <span>Verify</span>
                    <ExternalLink size={12} />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Payment Review in Progress */}
        {isSubmitted && !isIssued && (
          <div className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 text-blue-800">
              <Clock size={20} />
              <h2 className="text-base font-bold">Verification In Progress</h2>
            </div>
            <p className="mt-2 text-xs text-[#705a54] leading-relaxed">
              We received your submitted transaction reference:
            </p>
            <p className="mt-1 font-mono text-sm font-bold text-[#35110f]">
              {payment?.utr_reference}
            </p>
            <p className="mt-3 text-xs text-[#705a54] leading-relaxed">
              Our fundraising administrators verify incoming bank transfers against the bank statement.
              Once confirmed, your tickets will automatically appear on this page.
            </p>
          </div>
        )}

        {/* Payment Rejection Warning */}
        {isRejected && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900 shadow-xs">
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle size={18} className="text-red-600" />
              <span>Reference Not Verified</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-red-800">
              Reason: <b>{payment.rejection_reason || "Could not match bank transfer."}</b>
            </p>
            <p className="mt-1 text-xs text-red-700">
              Please double-check your bank receipt and submit the corrected UTR below.
            </p>
          </div>
        )}

        {/* Payment Instructions & UTR Submission Form (Pending or Rejected) */}
        {(isPending || isRejected) && (
          <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 font-bold text-[#7c1619]">
              <ShieldCheck size={20} />
              <h2 className="text-lg">Payment Instructions</h2>
            </div>
            <p className="mt-1 text-xs text-[#705a54]">
              Pay via any UPI application (Google Pay, PhonePe, Paytm, BHIM, or Mobile Banking).
            </p>

            <div className="my-5 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#705a54]">Payee Name</span>
                <span className="font-bold text-[#35110f]">{manualUpiConfig.displayName}</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-[#f0e7df] pt-2">
                <span className="text-xs text-[#705a54]">UPI ID</span>
                <span className="font-mono font-bold text-[#7c1619]">{manualUpiConfig.upiId}</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-[#f0e7df] pt-2">
                <span className="text-xs text-[#705a54]">Amount Due</span>
                <span className="text-base font-bold text-[#7c1619]">₹{totalInr}</span>
              </div>
            </div>

            {/* UPI Deep Link Button */}
            <div className="mb-6">
              <a
                href={upiIntentUri}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#d6a23b] p-3 text-sm font-bold text-[#35110f] shadow-xs transition hover:bg-[#c29130]"
              >
                <span>Pay ₹{totalInr} via UPI App</span>
                <ArrowRight size={16} />
              </a>
              <p className="mt-1 text-center text-[11px] text-[#705a54]">
                Works on mobile devices with UPI apps installed
              </p>
            </div>

            {/* UTR Form */}
            <form action={submitPublicUpiPayment} className="space-y-4 border-t border-[#f0e7df] pt-5">
              <input type="hidden" name="orderId" value={order.id} />

              <div>
                <label htmlFor="utr-input" className="block text-xs font-semibold uppercase tracking-wider text-[#705a54]">
                  UPI Reference / UTR Number <span className="text-red-500">*</span>
                </label>
                <input
                  id="utr-input"
                  name="utr"
                  required
                  minLength={6}
                  maxLength={64}
                  pattern="[A-Za-z0-9-]+"
                  placeholder="e.g. 428172918291"
                  className="mt-1.5 w-full rounded-xl border border-[#eadbcf] bg-white p-3 font-mono text-sm text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
                />
                <p className="mt-1 text-[11px] text-[#705a54]">
                  Found in your UPI app receipt under &quot;UTR&quot;, &quot;UPI Ref No.&quot;, or &quot;Google Transaction ID&quot;.
                </p>
              </div>

              <div>
                <label htmlFor="payer-name-input" className="block text-xs font-semibold uppercase tracking-wider text-[#705a54]">
                  Payer Name / Bank Account Name <span className="text-xs font-normal text-[#705a54]">(Optional)</span>
                </label>
                <input
                  id="payer-name-input"
                  name="payerName"
                  maxLength={120}
                  placeholder="Name as it appears in your bank"
                  className="mt-1.5 w-full rounded-xl border border-[#eadbcf] bg-white p-3 text-sm text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-[#7c1619] p-3.5 text-sm font-bold text-white shadow-xs transition hover:bg-[#631214]"
              >
                Submit Payment Reference
              </button>
            </form>
          </div>
        )}

        {/* Back Link */}
        <div className="text-center pt-2">
          <Link href="/" className="text-xs text-[#7c1619] underline">
            Return to SSFI Homepage
          </Link>
        </div>
      </div>
    </main>
  );
}
