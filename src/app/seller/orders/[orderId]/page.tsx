import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Send, Ticket } from "lucide-react";
import { requireRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const instant = false;

type SellerOrder = {
  id: string;
  order_number: string;
  quantity: number;
  total_amount_paise: number;
  status: string;
  customers: { full_name: string }[];
  payments: {
    status: string;
    utr_reference: string | null;
    rejection_reason: string | null;
  }[];
  tickets: { ticket_number: string; status: string }[];
};

export default async function SellerOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ submitted?: string }>;
}) {
  const { orderId } = await params;
  const query = await searchParams;
  const user = await requireRole("SELLER");
  const db = createSupabaseAdminClient();

  // Verify seller identity
  const { data: seller } = await db
    .from("sellers")
    .select("id, display_name, seller_code")
    .eq("profile_id", user.id)
    .single();

  if (!seller) notFound();

  // Strict multi-tenant isolation: order MUST belong to this seller
  const { data } = await db
    .from("orders")
    .select(
      "id, order_number, quantity, total_amount_paise, status, customers(full_name), payments(status, utr_reference, rejection_reason), tickets(ticket_number, status)"
    )
    .eq("id", orderId)
    .eq("seller_id", seller.id)
    .maybeSingle();

  const order = data as unknown as SellerOrder | null;
  if (!order) notFound();

  const payment = order.payments[0];

  // Fetch delivery status for this seller's order
  const { data: rawDeliveries = [] } = await db
    .from("ticket_deliveries")
    .select("channel, status, sent_at")
    .eq("order_id", orderId);

  const deliveries = rawDeliveries as Array<{ channel: string; status: string; sent_at: string | null }>;
  const isIssued = order.status === "TICKETS_ISSUED";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/seller/orders"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7c1619] transition hover:underline"
        >
          <ArrowLeft size={14} />
          <span>Back to my sales directory</span>
        </Link>
      </div>

      {query.submitted && (
        <div className="flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 p-4 text-xs font-semibold text-green-900 shadow-xs">
          <CheckCircle2 size={16} className="text-green-600 shrink-0" />
          <span>Payment reference recorded. It is currently awaiting administrative confirmation.</span>
        </div>
      )}

      {/* Main Order Details Card */}
      <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0e7df] pb-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
              Seller Sale Reference
            </span>
            <h1 className="mt-1 font-mono text-2xl font-bold text-[#7c1619]">{order.order_number}</h1>
          </div>
          <span
            className={`rounded-full px-3 py-1 font-mono text-xs font-bold uppercase ${
              isIssued
                ? "bg-green-100 text-green-800"
                : order.status === "PAYMENT_SUBMITTED"
                ? "bg-blue-100 text-blue-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {order.status}
          </span>
        </div>

        <dl className="mt-6 grid gap-4 rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-5 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-[10px] uppercase font-bold text-[#705a54]">Customer Name</dt>
            <dd className="mt-0.5 text-sm font-bold text-[#35110f]">{order.customers[0]?.full_name}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase font-bold text-[#705a54]">Attributed Seller</dt>
            <dd className="mt-0.5 font-bold text-[#35110f]">{seller.display_name} ({seller.seller_code})</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase font-bold text-[#705a54]">Tickets Requested</dt>
            <dd className="mt-0.5 text-sm font-bold text-[#7c1619]">{order.quantity} Tickets</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase font-bold text-[#705a54]">Total Amount</dt>
            <dd className="mt-0.5 text-sm font-bold text-[#35110f]">₹{order.total_amount_paise / 100}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase font-bold text-[#705a54]">Payment Status</dt>
            <dd className="mt-0.5 font-semibold text-[#35110f]">{payment?.status ?? "PENDING"}</dd>
          </div>
          {payment?.utr_reference && (
            <div>
              <dt className="text-[10px] uppercase font-bold text-[#705a54]">Submitted UTR</dt>
              <dd className="mt-0.5 font-mono font-bold text-[#7c1619]">{payment.utr_reference}</dd>
            </div>
          )}
          {payment?.rejection_reason && (
            <div className="sm:col-span-2 text-red-700">
              <dt className="text-[10px] uppercase font-bold text-red-800">Admin Rejection Note</dt>
              <dd className="mt-0.5">{payment.rejection_reason}</dd>
            </div>
          )}
        </dl>

        {order.status === "PENDING_PAYMENT" && (
          <div className="mt-6 border-t border-[#f0e7df] pt-5">
            <Link
              href={`/seller/orders/${order.id}/payment`}
              className="inline-flex items-center gap-2 rounded-xl bg-[#7c1619] px-6 py-3 text-xs font-bold text-white shadow-xs transition hover:bg-[#631214]"
            >
              <span>Submit Payment Proof for Customer</span>
            </Link>
          </div>
        )}

        {/* Issued Tickets for Seller */}
        {order.tickets.length > 0 && (
          <div className="mt-6 border-t border-[#f0e7df] pt-6">
            <div className="flex items-center gap-2 text-[#7c1619]">
              <Ticket size={18} />
              <h2 className="text-sm font-bold text-[#35110f]">Issued Ticket Numbers ({order.tickets.length})</h2>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {order.tickets.map((t) => (
                <div
                  key={t.ticket_number}
                  className="rounded-xl border border-green-200 bg-green-50/60 p-2.5 text-center font-mono text-xs font-bold text-[#7c1619]"
                >
                  {t.ticket_number}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Delivery State for Seller */}
        {deliveries.length > 0 && (
          <div className="mt-6 border-t border-[#f0e7df] pt-5">
            <div className="flex items-center gap-2 text-[#705a54]">
              <Send size={16} className="text-[#7c1619]" />
              <h3 className="text-xs font-bold text-[#35110f]">Official Ticket Delivery Status</h3>
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              {deliveries.map((d) => (
                <div
                  key={d.channel}
                  className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] px-3.5 py-2 text-xs"
                >
                  <span className="text-[#705a54]">{d.channel}: </span>
                  <span className="font-bold uppercase text-[#7c1619]">{d.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
