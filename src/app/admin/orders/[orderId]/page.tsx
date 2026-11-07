import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, CheckCircle2, Clock, ExternalLink, Lock, Ticket } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasAnyCurrentUserRole, hasCurrentUserRole } from "@/lib/auth/server";
import { getOrderRecoveryStatus } from "@/server/actions/paymentRecovery";
import {
  getOrderAuditTimeline,
  getOrderCollaborationNotes,
} from "@/server/actions/orderCollaboration";
import { OrderDeliveryCard, DeliveryItem } from "@/components/admin/OrderDeliveryCard";
import { WhatsAppTicketDeliveryButton } from "@/components/delivery/WhatsAppTicketDeliveryButton";
import { AdminPaymentRecoveryCard } from "@/components/admin/AdminPaymentRecoveryCard";
import { AdminPaymentScreenshot } from "@/components/admin/AdminPaymentScreenshot";
import { CustomerContactEditModal } from "@/components/admin/CustomerContactEditModal";
import { OrderCollaborationCard } from "@/components/admin/OrderCollaborationCard";
import { OrderAuditTimelineCard } from "@/components/admin/OrderAuditTimelineCard";

type OrderDetail = {
  id: string;
  order_number: string;
  quantity: number;
  total_amount_paise: number;
  status: string;
  created_at: string;
  customer_id: string;
  snapshot_seller_display_name?: string | null;
  snapshot_seller_code?: string | null;
  customers: {
    id: string;
    full_name: string;
    phone: string;
    whatsapp_number: string | null;
    email: string | null;
  } | null;
  sellers: { display_name: string; seller_code: string } | null;
  payments: {
    id: string;
    status: string;
    utr_reference: string | null;
    payer_name: string | null;
    rejection_reason: string | null;
    submitted_at: string | null;
    verified_at: string | null;
    seller_review_status?: string | null;
    seller_review_note?: string | null;
    payment_screenshots?:
      | { uploaded_at: string; file_size_bytes: number; content_type: string }
      | { uploaded_at: string; file_size_bytes: number; content_type: string }[]
      | null;
  }[];
  tickets: {
    id: string;
    ticket_number: string;
    status: string;
    issued_at: string;
    void_reason?: string | null;
    contact_full_name?: string | null;
    contact_email?: string | null;
    contact_whatsapp?: string | null;
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
      "id, order_number, quantity, total_amount_paise, status, created_at, customer_id, snapshot_seller_display_name, snapshot_seller_code, customers(id, full_name, phone, whatsapp_number, email), sellers!orders_seller_id_fkey(display_name, seller_code), payments(id, status, utr_reference, payer_name, rejection_reason, submitted_at, verified_at, seller_review_status, seller_review_note, payment_screenshots(uploaded_at, file_size_bytes, content_type)), tickets(id, ticket_number, status, issued_at, void_reason, contact_full_name, contact_email, contact_whatsapp)"
    )
    .eq("id", orderId)
    .maybeSingle();

  const { data: rawDeliveries = [] } = await db
    .from("ticket_deliveries")
    .select(
      "id, channel, recipient, status, provider, attempt_count, last_attempt_at, sent_at, error_message, rendered_content, subject, metadata"
    )
    .eq("order_id", orderId);

  const order = data as unknown as OrderDetail | null;
  if (!order) notFound();

  const payment = order.payments[0];
  const rawScreenshot = payment?.payment_screenshots;
  const screenshot = Array.isArray(rawScreenshot) ? rawScreenshot[0] : rawScreenshot;
  const deliveries = rawDeliveries as unknown as DeliveryItem[];

  // RBAC: Check whether user can generate and revoke recovery links & edit customer info
  const [canManageAdmin, isSuperAdmin] = await Promise.all([
    hasAnyCurrentUserRole(["SUPER_ADMIN", "ADMIN"]),
    hasCurrentUserRole("SUPER_ADMIN"),
  ]);
  let initialTokenStatus = { hasToken: false, active: false };
  if (canManageAdmin) {
    try {
      initialTokenStatus = await getOrderRecoveryStatus(order.id);
    } catch (e) {
      console.warn("[Admin Order Details] Failed to fetch recovery token status:", e);
    }
  }

  const [collabRes, auditRes] = await Promise.all([
    getOrderCollaborationNotes(order.id),
    getOrderAuditTimeline(order.id),
  ]);

  const isDetailsComplete = Boolean(
    (screenshot || payment?.utr_reference) &&
      order.customers?.email &&
      (order.customers?.whatsapp_number || order.customers?.phone)
  );

  const sellerLabel = order.sellers
    ? `${order.sellers.display_name} (${order.sellers.seller_code})`
    : order.snapshot_seller_display_name
    ? `${order.snapshot_seller_display_name} (${order.snapshot_seller_code || ""})`
    : "Direct / Organic Sale";

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
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">
                Customer (Master Profile)
              </span>
              {canManageAdmin && order.customers && (
                <CustomerContactEditModal
                  mode="CUSTOMER_PROFILE"
                  customerId={order.customers.id || order.customer_id}
                  orderId={order.id}
                  orderNumber={order.order_number}
                  sellerLabel={sellerLabel}
                  amountLabel={`₹${order.total_amount_paise / 100}`}
                  initialFullName={order.customers.full_name}
                  initialEmail={order.customers.email ?? ""}
                  initialWhatsapp={
                    order.customers.whatsapp_number || order.customers.phone || ""
                  }
                  buttonLabel="Edit Profile"
                />
              )}
            </div>
            <p className="mt-1 text-base font-bold text-[#35110f]">{order.customers?.full_name}</p>
            <p className="mt-1 font-mono text-xs text-[#705a54]">Phone: {order.customers?.phone}</p>
            <p className="font-mono text-xs text-[#705a54]">
              WhatsApp:{" "}
              {order.customers?.whatsapp_number || (
                <span className="font-semibold text-amber-800">Not set</span>
              )}
            </p>
            <p className="text-xs text-[#705a54]">
              Email:{" "}
              {order.customers?.email || (
                <span className="font-semibold text-amber-800">Not set</span>
              )}
            </p>
          </div>

          {/* Seller */}
          <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">
                Original Seller Attribution
              </span>
              <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                <Lock size={10} />
                Locked
              </span>
            </div>
            <p className="mt-1 text-base font-bold text-[#35110f]">
              {order.sellers?.display_name ??
                order.snapshot_seller_display_name ??
                "Direct / Organic Sale"}
            </p>
            {(order.sellers?.seller_code || order.snapshot_seller_code) && (
              <span className="mt-1 inline-block rounded-md bg-[#fceeee] px-2 py-0.5 font-mono text-xs font-bold text-[#a41f23]">
                {order.sellers?.seller_code || order.snapshot_seller_code}
              </span>
            )}
          </div>

          {/* Quantity & Amount */}
          <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">
                Order Size &amp; Amount
              </span>
              <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                <Lock size={10} />
                Locked
              </span>
            </div>
            <p className="mt-1 text-2xl font-bold text-[#7c1619]">
              {order.quantity} {order.quantity === 1 ? "Ticket" : "Tickets"}
            </p>
            <p className="text-xs text-[#705a54]">Total Amount: ₹{order.total_amount_paise / 100}</p>
          </div>

          {/* Payment Status & Submission Info */}
          <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">
                Payment Status
              </span>
              {isDetailsComplete ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  <CheckCircle2 size={11} />
                  <span>Details Complete</span>
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                  Details Incomplete
                </span>
              )}
            </div>
            <p className="mt-1 font-mono text-base font-bold text-[#35110f]">
              {payment?.status ?? "PENDING"}
            </p>

            <div className="mt-2 space-y-1 text-xs text-[#705a54]">
              <p>
                Payer:{" "}
                {payment?.payer_name ? (
                  <b className="text-[#35110f]">{payment.payer_name}</b>
                ) : (
                  <span className="font-semibold text-amber-800">Not provided (optional)</span>
                )}
              </p>
              <p>
                UTR:{" "}
                {payment?.utr_reference ? (
                  <b className="font-mono text-[#7c1619]">{payment.utr_reference}</b>
                ) : (
                  <span className="font-semibold text-[#705a54]">Optional / Not provided</span>
                )}
              </p>
              {payment?.seller_review_status && (
                <p>
                  Seller Advisory:{" "}
                  <b className="font-mono text-[#35110f]">{payment.seller_review_status}</b>
                </p>
              )}
            </div>

            {payment?.submitted_at && (
              <p className="mt-2 flex items-center gap-1 text-[11px] text-[#705a54]">
                <Clock size={11} />
                <span>
                  Submitted:{" "}
                  {new Date(payment.submitted_at).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}
                </span>
              </p>
            )}

            {payment && (
              <div className="mt-3">
                <Link
                  href={`/admin/payments/${payment.id}`}
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#7c1619] underline"
                >
                  <span>
                    {payment.status === "SUBMITTED"
                      ? "Review & Verify Payment"
                      : "View Payment Verification Record"}
                  </span>
                  <ExternalLink size={12} />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Protected Payment Screenshot Preview & Download */}
        {payment && screenshot && (
          <AdminPaymentScreenshot
            paymentId={payment.id}
            uploadedAt={screenshot.uploaded_at}
            sizeBytes={screenshot.file_size_bytes}
            contentType={screenshot.content_type}
            canDownload={isSuperAdmin}
          />
        )}

        {/* Issued Tickets */}
        <div className="mt-8 border-t border-[#f0e7df] pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[#7c1619]">
              <Ticket size={20} />
              <h2 className="text-base font-bold">Assigned Tickets ({order.tickets.length})</h2>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-900">
              <Lock size={11} />
              Ticket Numbers Strictly Immutable
            </span>
          </div>

          {order.tickets.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {order.tickets.map((t) => {
                const isVoid = t.status === "VOID";
                const effectiveName = t.contact_full_name || order.customers?.full_name || "";
                const effectiveEmail = t.contact_email || order.customers?.email || "";
                const effectiveWhatsapp =
                  t.contact_whatsapp ||
                  order.customers?.whatsapp_number ||
                  order.customers?.phone ||
                  "";
                const hasOverride = Boolean(
                  t.contact_full_name || t.contact_email || t.contact_whatsapp
                );

                return (
                  <div
                    key={t.ticket_number}
                    className={`rounded-xl border p-4 transition ${
                      isVoid
                        ? "border-red-200 bg-red-50/60"
                        : "border-green-200 bg-green-50/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={`font-mono text-base font-bold ${
                          isVoid ? "text-red-700 line-through" : "text-[#7c1619]"
                        }`}
                      >
                        {t.ticket_number}
                      </p>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          isVoid
                            ? "bg-red-100 text-red-800"
                            : "bg-green-100 text-green-800"
                        }`}
                      >
                        {isVoid ? "VOIDED" : "ACTIVE"}
                      </span>
                    </div>

                    <div className="mt-2 space-y-0.5 text-[11px] text-[#705a54]">
                      <p className="font-semibold text-[#35110f]">{effectiveName}</p>
                      {effectiveEmail && <p className="truncate">{effectiveEmail}</p>}
                      {effectiveWhatsapp && <p className="font-mono">{effectiveWhatsapp}</p>}
                      {hasOverride && (
                        <span className="mt-1 inline-block rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-indigo-900">
                          Single-Ticket Contact Override
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-2.5">
                      <Link
                        href={`/verify/${t.ticket_number}`}
                        target="_blank"
                        className="text-[11px] font-semibold text-[#705a54] hover:underline"
                      >
                        Public Verify ↗
                      </Link>
                      {canManageAdmin && (
                        <CustomerContactEditModal
                          mode="TICKET_CONTACT"
                          customerId={order.customers?.id || order.customer_id}
                          orderId={order.id}
                          orderNumber={order.order_number}
                          ticketId={t.id}
                          ticketNumber={t.ticket_number}
                          sellerLabel={sellerLabel}
                          amountLabel={`₹${order.total_amount_paise / 100}`}
                          issuedAtLabel={new Date(t.issued_at).toLocaleString("en-IN", {
                            timeZone: "Asia/Kolkata",
                          })}
                          initialFullName={effectiveName}
                          initialEmail={effectiveEmail}
                          initialWhatsapp={effectiveWhatsapp}
                          buttonLabel="Ticket Contact"
                        />
                      )}
                    </div>
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

      {/* Phase 6: Order-Specific Admin–Seller Collaboration */}
      <OrderCollaborationCard
        orderId={order.id}
        paymentId={payment?.id ?? null}
        viewerRole="STAFF"
        initialNotes={collabRes.notes}
      />

      {/* Admin Payment Recovery Card */}
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
        payerName={payment?.payer_name}
        submittedAt={payment?.submitted_at}
        orderStatus={order.status}
        canManageRecovery={canManageAdmin}
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
                Launches official WhatsApp Click-to-Chat pre-filled with verified ticket numbers and
                audit links for {order.customers.phone}.
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

      {/* Phase 5: Centralized Append-Only Audit Timeline */}
      <OrderAuditTimelineCard events={auditRes.events} orderId={order.id} />
    </div>
  );
}
