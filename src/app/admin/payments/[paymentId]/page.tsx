import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, CheckCircle2, Clock, Flag, ThumbsDown, ThumbsUp } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rejectPayment, verifyPayment } from "@/server/actions/operations";
import {
  getOrderAuditTimeline,
  getOrderCollaborationNotes,
} from "@/server/actions/orderCollaboration";
import { AdminPaymentScreenshot } from "@/components/admin/AdminPaymentScreenshot";
import { OrderCollaborationCard } from "@/components/admin/OrderCollaborationCard";
import { OrderAuditTimelineCard } from "@/components/admin/OrderAuditTimelineCard";


type PaymentDetail = {
  id: string;
  status: string;
  amount_paise: number;
  utr_reference: string | null;
  payer_name: string | null;
  submitted_at: string | null;
  rejection_reason: string | null;
  seller_review_status: string | null;
  seller_reviewed_at: string | null;
  seller_review_note: string | null;
  payment_screenshots:
    | { uploaded_at: string; file_size_bytes: number; content_type?: string }
    | { uploaded_at: string; file_size_bytes: number; content_type?: string }[]
    | null;
  orders:
    | {
        id: string;
        order_number: string;
        quantity: number;
        payment_destination_type?: string | null;
        payment_destination_upi_id?: string | null;
        payment_destination_account_name?: string | null;
        snapshot_seller_display_name?: string | null;
        snapshot_seller_code?: string | null;
        customers:
          | { full_name: string; phone: string; whatsapp_number: string }
          | { full_name: string; phone: string; whatsapp_number: string }[]
          | null;
        sellers:
          | { display_name: string; seller_code: string }
          | { display_name: string; seller_code: string }[]
          | null;
        operational_seller?:
          | { display_name: string; seller_code: string }
          | { display_name: string; seller_code: string }[]
          | null;
      }
    | {
        id: string;
        order_number: string;
        quantity: number;
        payment_destination_type?: string | null;
        payment_destination_upi_id?: string | null;
        payment_destination_account_name?: string | null;
        snapshot_seller_display_name?: string | null;
        snapshot_seller_code?: string | null;
        customers:
          | { full_name: string; phone: string; whatsapp_number: string }
          | { full_name: string; phone: string; whatsapp_number: string }[]
          | null;
        sellers:
          | { display_name: string; seller_code: string }
          | { display_name: string; seller_code: string }[]
          | null;
        operational_seller?:
          | { display_name: string; seller_code: string }
          | { display_name: string; seller_code: string }[]
          | null;
      }[]
    | null;
};

const SELLER_REVIEW_LABELS: Record<string, { label: string; color: string; icon: typeof ThumbsUp }> = {
  RECOMMENDED_APPROVAL: { label: "Seller Recommends Approval", color: "text-emerald-800 bg-emerald-50 border-emerald-200", icon: ThumbsUp },
  RECOMMENDED_REJECTION: { label: "Seller Recommends Rejection", color: "text-red-800 bg-red-50 border-red-200", icon: ThumbsDown },
  FLAGGED_DISCREPANCY: { label: "Seller Flagged Discrepancy", color: "text-amber-800 bg-amber-50 border-amber-200", icon: Flag },
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
      "id, status, amount_paise, utr_reference, payer_name, submitted_at, rejection_reason, seller_review_status, seller_reviewed_at, seller_review_note, payment_screenshots(uploaded_at, file_size_bytes, content_type), orders(id, order_number, quantity, payment_destination_type, payment_destination_upi_id, payment_destination_account_name, snapshot_seller_display_name, snapshot_seller_code, customers(full_name, phone, whatsapp_number), sellers:sellers!orders_snapshot_seller_id_fkey(display_name, seller_code), operational_seller:sellers!orders_seller_id_fkey(display_name, seller_code))"
    )
    .eq("id", paymentId)
    .maybeSingle();

  const payment = data as unknown as PaymentDetail | null;
  if (!payment) notFound();

  const rawOrder = payment.orders;
  const order = Array.isArray(rawOrder) ? rawOrder[0] : rawOrder;

  const [collabRes, auditRes] = order?.id
    ? await Promise.all([
        getOrderCollaborationNotes(order.id),
        getOrderAuditTimeline(order.id),
      ])
    : [{ notes: [] }, { events: [] }];

  const rawCustomer = order?.customers;
  const customer = Array.isArray(rawCustomer) ? rawCustomer[0] : rawCustomer;

  const rawSeller = order?.sellers;
  const seller = Array.isArray(rawSeller) ? rawSeller[0] : rawSeller;

  const rawOpSeller = order?.operational_seller;
  const operationalSeller = Array.isArray(rawOpSeller) ? rawOpSeller[0] : rawOpSeller;

  const effectiveSeller =
    seller ||
    (order?.snapshot_seller_display_name
      ? {
          display_name: order.snapshot_seller_display_name,
          seller_code: order.snapshot_seller_code ?? "",
        }
      : operationalSeller);

  const isAwaiting = payment.status === "SUBMITTED";

  const rawScreenshots = payment.payment_screenshots;
  const screenshot = Array.isArray(rawScreenshots)
    ? rawScreenshots[0]
    : rawScreenshots;

  const reviewMeta = payment.seller_review_status
    ? SELLER_REVIEW_LABELS[payment.seller_review_status]
    : null;

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

        {screenshot && (
          <AdminPaymentScreenshot
            paymentId={payment.id}
            uploadedAt={screenshot.uploaded_at}
            sizeBytes={screenshot.file_size_bytes}
            contentType={screenshot.content_type}
          />
        )}

        {/* Verification Summary Grid */}
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {/* UTR Reference Highlight */}
          <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-5 sm:col-span-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">
              Bank Transfer Reference (UTR)
            </span>
            <div className="mt-2 flex items-baseline justify-between gap-4">
              <span className="font-mono text-2xl font-bold tracking-tight text-[#35110f]">
                {payment.utr_reference ?? "NO UTR PROVIDED (OPTIONAL)"}
              </span>
              <span className="text-xl font-bold text-[#7c1619]">
                ₹{payment.amount_paise / 100}
              </span>
            </div>
            {payment.payer_name ? (
              <p className="mt-1 text-xs text-[#705a54]">
                Payer declared: <b>{payment.payer_name}</b>
              </p>
            ) : (
              <p className="mt-1 text-xs text-[#705a54] italic">
                Payer name not declared (optional)
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
              Payment recipient: {effectiveSeller ? `${effectiveSeller.display_name} (${effectiveSeller.seller_code})` : "Direct sale"}
            </p>
            {order?.payment_destination_upi_id && (
              <p className="font-mono text-[11px] text-[#705a54]">
                UPI: {order.payment_destination_upi_id} {order.payment_destination_account_name ? `(${order.payment_destination_account_name})` : ""}
              </p>
            )}
            {operationalSeller && seller && operationalSeller.seller_code !== seller.seller_code && (
              <p className="text-[10px] text-[#705a54] italic">
                Operational seller: {operationalSeller.display_name} ({operationalSeller.seller_code})
              </p>
            )}
          </div>
        </div>

        {/* Seller Advisory Review Section */}
        <div className="mt-6 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-5">
          <div className="flex items-center justify-between gap-2 border-b border-[#f0e7df] pb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">
              Seller Intermediate Review (Advisory)
            </span>
            {reviewMeta ? (
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold ${reviewMeta.color}`}>
                <reviewMeta.icon size={13} />
                <span>{reviewMeta.label}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 border border-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                <Clock size={12} />
                <span>Pending Seller Review</span>
              </span>
            )}
          </div>

          {payment.seller_review_status ? (
            <div className="mt-3 space-y-2 text-xs">
              {payment.seller_review_note && (
                <div className="rounded-lg bg-white p-3 border border-[#eadbcf] text-[#35110f]">
                  <span className="font-semibold text-[#705a54] text-[11px] block mb-1">Seller Note:</span>
                  <p className="italic">{payment.seller_review_note}</p>
                </div>
              )}
              {payment.seller_reviewed_at && (
                <p className="text-[11px] text-[#705a54]">
                  Reviewed on: {new Date(payment.seller_reviewed_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                </p>
              )}
              <p className="text-[10px] text-[#705a54]">
                Note: Seller recommendation is advisory. Final ticket issuance authority rests with the Administrator.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-[#705a54] italic">
              The assigned seller has not yet submitted an advisory recommendation for this payment. You may proceed with independent verification.
            </p>
          )}
        </div>

        {/* Action Controls for SUBMITTED state */}
        {isAwaiting ? (
          <div className="mt-8 border-t border-[#f0e7df] pt-6 space-y-6">
            <div>
              <h2 className="text-sm font-bold text-[#35110f]">Verification Decisions</h2>
              <p className="mt-1 text-xs text-[#705a54]">
                Verify matching bank deposit or screenshot before issuing tickets. Ticket numbers are sequentially
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
                    placeholder="Reason for rejection (e.g. UTR / payment not found)"
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

      {order?.id && (
        <>
          <OrderCollaborationCard
            orderId={order.id}
            paymentId={payment.id}
            viewerRole="STAFF"
            initialNotes={collabRes.notes}
          />
          <OrderAuditTimelineCard events={auditRes.events} />
        </>
      )}
    </div>
  );
}
