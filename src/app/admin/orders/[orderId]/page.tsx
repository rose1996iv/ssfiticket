import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, Clock, ExternalLink, Ticket } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasAnyCurrentUserRole } from "@/lib/auth/server";
import { getOrderRecoveryStatus } from "@/server/actions/paymentRecovery";
import { OrderDeliveryCard, DeliveryItem } from "@/components/admin/OrderDeliveryCard";
import { WhatsAppTicketDeliveryButton } from "@/components/delivery/WhatsAppTicketDeliveryButton";
import { AdminPaymentRecoveryCard } from "@/components/admin/AdminPaymentRecoveryCard";

export const instant = false;

type OrderDetail = {
  id: string;
  order_number: string;
  quantity: number;
  total_amount_paise: number;
  status: string;
  created_at: string;
  customers: { full_name: string; phone: string; whatsapp_number: string | null; email: string | null } | null;
  sellers: { display_name: string; seller_code: string } | null;
  payments: {
    id: string;
    status: string;
    utr_reference: string | null;
    payer_name: string | null;
    rejection_reason: string | null;
    submitted_at: string | null;
    verified_at: string | null;
  }[];
  tickets: {
    id: string;
    ticket_number: string;
    status: string;
    void_reason?: string | null;
  }[];
};

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await connection();
  const { orderId } = await params;
  const db = createSupabaseAdminClient();

  const { data } = await db
    .from("orders")
    .select(
      "id, order_number, quantity, total_amount_paise, status, created_at, customers(full_name, phone, whatsapp_number, email), sellers(display_name, seller_code), payments(id, status, utr_reference, payer_name, rejection_reason, submitted_at, verified_at), tickets(id, ticket_number, status, void_reason)"
    )
    .eq("id", orderId)
    .maybeSingle();

  const { data: rawDeliveries = [] } = await db
    .from("ticket_deliveries")
    .select("id, channel, recipient, status, provider, attempt_count, last_attempt_at, sent_at, error_message, rendered_content, subject, metadata")
    .eq("order_id", orderId);

  const order = data as unknown as OrderDetail | null;
  if (!order) notFound();

  const payment = order.payments[0];
  const deliveries = rawDeliveries as unknown as DeliveryItem[];

  // RBAC: Check whether user can generate and revoke recovery links
  const canManageRecovery = await hasAnyCurrentUserRole(["SUPER_ADMIN", "ADMIN"]);
  let initialTokenStatus = { hasToken: false, active: false };
  if (canManageRecovery) {
    try {
      initialTokenStatus = await getOrderRecoveryStatus(order.id);
    } catch (e) {
      console.warn("[Admin Order Details] Failed to fetch recovery token status:", e);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/admin/orders"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7c1619] transition hover:underline"
        >
          <ArrowLeft size={14} />
          <span>Back to orders directory</span>
        </Link>
      </div>

      <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0e7df] pb-5">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">
              Order Details
            </span>
            <h1 className="mt-1 font-mono text-2xl font-bold text-[#7c1619]">
              {order.order_number}
            </h1>
          </div>
          <span
            className={`rounded-full px-3 py-1 font-mono text-xs font-bold ${
              order.status === "TICKETS_ISSUED"
                ? "bg-green-100 text-green-800"
                : order.status === "PAYMENT_SUBMITTED"
                ? "bg-blue-100 text-blue-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {order.status}
          </span>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {/* Customer */}
          <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-5">
            <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">Customer</span>
            <p className="mt-1 text-base font-bold text-[#35110f]">{order.customers?.full_name}</p>
            <p className="mt-1 font-mono text-xs text-[#705a54]">Phone: {order.customers?.phone}</p>
            <p className="font-mono text-xs text-[#705a54]">
              WhatsApp: {order.customers?.whatsapp_number || <span className="text-amber-800 font-semibold">Not set</span>}
            </p>
            <p className="text-xs text-[#705a54]">
              Email: {order.customers?.email || <span className="text-amber-800 font-semibold">Not set</span>}
            </p>
          </div>

          {/* Seller */}
          <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-5">
            <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">Attribution</span>
            <p className="mt-1 text-base font-bold text-[#35110f]">
              {order.sellers?.display_name ?? "Direct / Organic Sale"}
            </p>
            {order.sellers?.seller_code && (
              <span className="mt-1 inline-block rounded-md bg-[#fceeee] px-2 py-0.5 font-mono text-xs font-bold text-[#a41f23]">
                {order.sellers.seller_code}
              </span>
            )}
          </div>

          {/* Quantity & Amount */}
          <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-5">
            <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">Order Size</span>
            <p className="mt-1 text-2xl font-bold text-[#7c1619]">
              {order.quantity} {order.quantity === 1 ? "Ticket" : "Tickets"}
            </p>
            <p className="text-xs text-[#705a54]">Total Amount: ₹{order.total_amount_paise / 100}</p>
          </div>

          {/* Payment Status & Submission Info */}
          <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-5">
            <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">Payment Status</span>
            <p className="mt-1 font-mono text-base font-bold text-[#35110f]">
              {payment?.status ?? "PENDING"}
            </p>
            {payment?.utr_reference ? (
              <p className="mt-1 text-xs text-[#705a54]">
                UTR: <b className="font-mono text-[#7c1619]">{payment.utr_reference}</b>
              </p>
            ) : (
              <p className="mt-1 text-xs font-semibold text-amber-800">
                UTR: Not submitted yet
              </p>
            )}
            {payment?.submitted_at && (
              <p className="text-[11px] text-[#705a54] flex items-center gap-1 mt-0.5">
                <Clock size={11} />
                <span>
                  Submitted: {new Date(payment.submitted_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                </span>
              </p>
            )}
            {payment && payment.status === "SUBMITTED" && (
              <div className="mt-3">
                <Link
                  href={`/admin/payments/${payment.id}`}
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#7c1619] underline"
                >
                  <span>Review &amp; Verify Payment</span>
                  <ExternalLink size={12} />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Issued Tickets */}
        <div className="mt-8 border-t border-[#f0e7df] pt-6">
          <div className="flex items-center gap-2 text-[#7c1619]">
            <Ticket size={20} />
            <h2 className="text-base font-bold">Assigned Tickets ({order.tickets.length})</h2>
          </div>

          {order.tickets.length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {order.tickets.map((t) => {
                const isVoid = t.status === "VOID";
                return (
                  <div
                    key={t.ticket_number}
                    className={`rounded-xl border p-3 text-center transition ${
                      isVoid
                        ? "border-red-200 bg-red-50/60"
                        : "border-green-200 bg-green-50/60"
                    }`}
                  >
                    <p className={`font-mono text-sm font-bold ${isVoid ? "text-red-700 line-through" : "text-[#7c1619]"}`}>
                      {t.ticket_number}
                    </p>
                    <div className="mt-1 flex items-center justify-center gap-1 text-[10px]">
                      {isVoid ? (
                        <span className="font-semibold text-red-800">VOIDED</span>
                      ) : (
                        <span className="font-semibold text-green-800">ACTIVE</span>
                      )}
                    </div>
                    <Link
                      href={`/verify/${t.ticket_number}`}
                      target="_blank"
                      className="mt-1 inline-block text-[11px] text-[#705a54] hover:underline"
                    >
                      Audit
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-xs text-[#705a54]">
              No tickets issued yet. Tickets are assigned upon payment verification.
            </p>
          )}
        </div>
      </div>

      {/* Admin Payment Recovery Card (Part C & Part E) */}
      <AdminPaymentRecoveryCard
        orderId={order.id}
        orderNumber={order.order_number}
        quantity={order.quantity}
        totalAmountInr={order.total_amount_paise / 100}
        customerPhone={order.customers?.phone ?? ""}
        customerEmail={order.customers?.email}
        customerWhatsapp={order.customers?.whatsapp_number}
        paymentStatus={payment?.status ?? "PENDING"}
        utrReference={payment?.utr_reference}
        submittedAt={payment?.submitted_at}
        orderStatus={order.status}
        canManageRecovery={canManageRecovery}
        initialTokenStatus={initialTokenStatus}
      />

      {/* Free WhatsApp Ticket Dispatch Card */}
      {order.tickets.length > 0 && order.customers?.phone && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                Direct Dispatch (100% Free WhatsApp)
              </span>
              <h2 className="mt-1 text-base font-bold text-emerald-950">
                Send Tickets via WhatsApp to {order.customers.full_name}
              </h2>
              <p className="mt-0.5 text-xs text-emerald-700">
                Launches official WhatsApp Click-to-Chat pre-filled with verified ticket numbers and audit links for {order.customers.phone}.
              </p>
            </div>
            <WhatsAppTicketDeliveryButton
              orderId={order.id}
              recipientPhone={order.customers.phone}
              initialStatus={deliveries.find((d) => d.channel === "WHATSAPP")?.status}
            />
          </div>
        </div>
      )}

      {/* Automated Ticket Delivery Card */}
      <OrderDeliveryCard
        orderId={order.id}
        orderNumber={order.order_number}
        deliveries={deliveries}
        canManage={true}
      />
    </div>
  );
}
