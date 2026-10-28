import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rejectPayment, verifyPayment } from "@/server/actions/operations";

export const instant = false;

type PaymentDetail = {
  id: string;
  status: string;
  amount_paise: number;
  utr_reference: string | null;
  payer_name: string | null;
  submitted_at: string | null;
  rejection_reason: string | null;
  orders: {
    id: string;
    order_number: string;
    quantity: number;
    customers: { full_name: string; phone: string; whatsapp_number: string }[];
    sellers: { display_name: string; seller_code: string }[];
  }[];
};

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  await connection();
  const { paymentId } = await params;
  const db = createSupabaseAdminClient();

  const { data } = await db
    .from("payments")
    .select(
      "id, status, amount_paise, utr_reference, payer_name, submitted_at, rejection_reason, orders(id, order_number, quantity, customers(full_name, phone, whatsapp_number), sellers(display_name, seller_code))"
    )
    .eq("id", paymentId)
    .maybeSingle();

  const payment = data as unknown as PaymentDetail | null;
  if (!payment) notFound();

  const order = payment.orders[0];
  const customer = order?.customers[0];
  const seller = order?.sellers[0];
  const isAwaiting = payment.status === "SUBMITTED";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Back Link */}
      <div>
        <Link
          href="/admin/payments"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7c1619] transition hover:underline"
        >
          <ArrowLeft size={14} />
          <span>Back to pending payments</span>
        </Link>
      </div>

      {/* Main Review Card */}
      <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0e7df] pb-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#705a54]">
              Payment Verification Review
            </p>
            <h1 className="mt-1 font-mono text-2xl font-bold text-[#7c1619]">
              {order?.order_number}
            </h1>
          </div>
          <span
            className={`rounded-full px-3 py-1 font-mono text-xs font-bold ${
              isAwaiting
                ? "bg-amber-100 text-amber-900"
                : payment.status === "VERIFIED"
                ? "bg-green-100 text-green-900"
                : "bg-red-100 text-red-900"
            }`}
          >
            {payment.status}
          </span>
        </div>

        {/* Verification Summary Grid */}
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {/* UTR Reference Highlight */}
          <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-5 sm:col-span-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">
              Bank Transfer Reference (UTR)
            </span>
            <div className="mt-2 flex items-baseline justify-between gap-4">
              <span className="font-mono text-2xl font-bold tracking-tight text-[#35110f]">
                {payment.utr_reference ?? "NO UTR PROVIDED"}
              </span>
              <span className="text-xl font-bold text-[#7c1619]">
                ₹{payment.amount_paise / 100}
              </span>
            </div>
            {payment.payer_name && (
              <p className="mt-1 text-xs text-[#705a54]">
                Payer declared: <b>{payment.payer_name}</b>
              </p>
            )}
          </div>

          {/* Customer Details */}
          <div className="space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">Customer</span>
            <p className="font-bold text-[#35110f]">{customer?.full_name}</p>
            <p className="font-mono text-xs text-[#705a54]">
              {customer?.phone || customer?.whatsapp_number}
            </p>
          </div>

          {/* Order Details */}
          <div className="space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">Tickets</span>
            <p className="font-bold text-[#35110f]">{order?.quantity} tickets</p>
            <p className="text-xs text-[#705a54]">
              Attributed to: {seller ? `${seller.display_name} (${seller.seller_code})` : "Direct sale"}
            </p>
          </div>
        </div>

        {/* Action Controls for SUBMITTED state */}
        {isAwaiting ? (
          <div className="mt-8 border-t border-[#f0e7df] pt-6 space-y-6">
            <div>
              <h2 className="text-sm font-bold text-[#35110f]">Verification Decisions</h2>
              <p className="mt-1 text-xs text-[#705a54]">
                Verify matching bank deposit before issuing tickets. Ticket numbers are sequentially
                and atomically generated upon confirmation.
              </p>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
              {/* Verify Form */}
              <form action={verifyPayment} className="flex-1">
                <input type="hidden" name="paymentId" value={payment.id} />
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-700 py-3.5 px-6 font-bold text-white shadow-sm transition hover:bg-green-800"
                >
                  <CheckCircle2 size={18} />
                  <span>Confirm & Issue Tickets</span>
                </button>
              </form>

              {/* Rejection Form */}
              <form action={rejectPayment} className="flex-1 space-y-2">
                <input type="hidden" name="paymentId" value={payment.id} />
                <div className="flex gap-2">
                  <input
                    name="reason"
                    required
                    placeholder="Reason for rejection (e.g. UTR not found)"
                    className="w-full rounded-xl border border-red-200 bg-red-50/50 p-2.5 text-xs text-red-950 focus:border-red-500 focus:outline-hidden"
                  />
                  <button
                    type="submit"
                    className="shrink-0 rounded-xl bg-red-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-red-800"
                  >
                    Reject
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : (
          <div className="mt-6 border-t border-[#f0e7df] pt-4 text-xs text-[#705a54]">
            This payment is already in state <b>{payment.status}</b>.
            {payment.rejection_reason && (
              <p className="mt-1 text-red-700">Rejection note: {payment.rejection_reason}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
