import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  RefreshCw,
  Ticket,
  XCircle,
} from "lucide-react";
import { manualUpiConfig } from "@/lib/config/payment";
import { resolveEnvironmentAppUrl } from "@/lib/config/appUrl";
import { generateTicketQrDataUrl } from "@/lib/ticket/qr";
import { buildUpiPaymentUri, generateUpiQrDataUrl } from "@/lib/payment/upi";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { Logo } from "@/components/brand/Logo";
import { CustomerPaymentJourney } from "@/components/payment/CustomerPaymentJourney";
import { PaymentDetailsForm } from "@/components/payment/PaymentDetailsForm";
import { WhatsAppTicketDeliveryButton } from "@/components/delivery/WhatsAppTicketDeliveryButton";

export const instant = false;

type OrderData = {
  id: string;
  order_number: string;
  quantity: number;
  total_amount_paise: number;
  status: string;
  created_at: string;
  customers:
    | { full_name: string; phone?: string; whatsapp_number: string; email?: string | null }[]
    | { full_name: string; phone?: string; whatsapp_number: string; email?: string | null }
    | null;
  sellers: { display_name: string; seller_code: string } | null;
  payments: {
    id: string;
    status: string;
    utr_reference: string | null;
    payer_name?: string | null;
    rejection_reason: string | null;
    submitted_at: string | null;
    verified_at: string | null;
  }[];
  tickets: { ticket_number: string; status: string; issued_at?: string }[];
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
      "id, order_number, quantity, total_amount_paise, status, created_at, customers(full_name, phone, whatsapp_number, email), sellers(display_name, seller_code), payments(id, status, utr_reference, payer_name, rejection_reason, submitted_at, verified_at), tickets(ticket_number, status, issued_at)"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error || !data) {
    notFound();
  }

  const { data: rawDeliveries = [] } = await db
    .from("ticket_deliveries")
    .select("channel, status, sent_at")
    .eq("order_id", orderId);

  const deliveries = rawDeliveries as Array<{ channel: string; status: string; sent_at: string | null }>;

  const order = data as unknown as OrderData;
  const rawPayments = order.payments as unknown;
  const payment = (Array.isArray(rawPayments) ? rawPayments[0] : rawPayments) as
    | OrderData["payments"][number]
    | undefined
    | null;
  const rawCustomer = order.customers as unknown;
  const customer = (Array.isArray(rawCustomer) ? rawCustomer[0] : rawCustomer) as
    | { full_name?: string; phone?: string; whatsapp_number?: string; email?: string | null }
    | undefined
    | null;
  const seller = order.sellers;
  const totalInr = order.total_amount_paise / 100;

  // Environment-aware resolution ensuring verification URLs point to the same database
  const { baseUrl: envBaseUrl } = resolveEnvironmentAppUrl();

  const upiIntentUri = buildUpiPaymentUri({
    payeeVpa: manualUpiConfig.upiId,
    payeeName: manualUpiConfig.displayName,
    amountPaise: order.total_amount_paise,
    orderNumber: order.order_number,
    transactionRef: order.order_number,
    currency: manualUpiConfig.currency,
  });

  const dynamicQrDataUrl = await generateUpiQrDataUrl(upiIntentUri, { width: 320 });

  const isPending = order.status === "PENDING_PAYMENT";
  const isSubmitted =
    order.status === "PAYMENT_SUBMITTED" || (payment && payment.status === "SUBMITTED");
  const isIssued =
    order.status === "TICKETS_ISSUED" || (payment && payment.status === "VERIFIED");
  const isRejected = payment && payment.status === "FAILED";

  // Pre-generate unique verification QR data URLs for issued tickets
  const ticketsWithQr = isIssued
    ? await Promise.all(
        order.tickets.map(async (t) => {
          let qrDataUrl: string | null = null;
          if (t.status === "ISSUED" || t.status === "ACTIVE") {
            try {
              qrDataUrl = await generateTicketQrDataUrl(t.ticket_number, envBaseUrl);
            } catch {
              // Non-fatal QR generation fallback
            }
          }
          return {
            ...t,
            qrDataUrl,
          };
        })
      )
    : [];

  return (
    <main className="min-h-screen bg-[#fffaf7] pb-16 text-[#35110f]">
      {/* Header */}
      <header className="border-b border-[#e8d6c5] bg-[#7c1619] px-4 py-8 text-white sm:px-6">
        <div className="mx-auto max-w-xl text-center">
          <div className="mb-3 flex justify-center">
            <Logo size="md" className="transition-transform hover:scale-105" />
          </div>
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
              <span>Payment Details Received!</span>
            </div>
            <p className="mt-1 text-xs text-green-800 leading-relaxed">
              Your payment reference and contact details have been safely registered and are currently awaiting
              verification by SSFI administrators. Save this page to check your ticket issuance status.
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
                {isIssued && "Tickets Issued & Verified"}
                {isSubmitted && !isIssued && "Payment Submitted — Under Review"}
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
              <dd className="font-mono text-xs">{customer?.whatsapp_number || customer?.phone}</dd>
            </div>
            <div>
              <dt className="text-xs text-[#705a54]">Quantity</dt>
              <dd className="font-semibold">
                {order.quantity} {order.quantity === 1 ? "ticket" : "tickets"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#705a54]">Amount Due</dt>
              <dd className="text-lg font-bold text-[#7c1619]">₹{totalInr} INR</dd>
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

        {/* Issued Tickets Card (when verified) with Unique Per-Ticket QR Codes */}
        {isIssued && ticketsWithQr.length > 0 && (
          <div className="rounded-2xl border border-green-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 font-bold text-green-800">
              <Ticket size={20} />
              <h2 className="text-lg">Your Official Ticket Entries ({ticketsWithQr.length})</h2>
            </div>
            <p className="mt-1 text-xs text-[#705a54] leading-relaxed">
              These tickets are securely registered in the SSFI database and eligible for the lucky draw.
              Each ticket includes a unique cryptographic verification QR code for event-day entry.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {ticketsWithQr.map((t) => {
                const isVoid = t.status === "VOID";
                return (
                  <div
                    key={t.ticket_number}
                    className={`flex flex-col items-center justify-between rounded-2xl border p-4 text-center transition ${
                      isVoid
                        ? "border-red-200 bg-red-50/50"
                        : "border-green-200 bg-green-50/40 shadow-xs"
                    }`}
                  >
                    <div className="w-full">
                      <div className="flex items-center justify-between gap-1 border-b border-[#f0e7df] pb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[#705a54]">
                          Official Ticket
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            isVoid ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"
                          }`}
                        >
                          {isVoid ? "VOIDED / INVALID" : "VALID & ACTIVE"}
                        </span>
                      </div>

                      <p
                        className={`mt-2 font-mono text-xl font-bold tracking-tight ${
                          isVoid ? "text-red-700 line-through" : "text-[#7c1619]"
                        }`}
                      >
                        {t.ticket_number}
                      </p>
                    </div>

                    {/* Unique Ticket Verification QR Code */}
                    {t.qrDataUrl && !isVoid ? (
                      <div className="my-3 flex flex-col items-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={t.qrDataUrl}
                          alt={`Official QR Code for ticket ${t.ticket_number}`}
                          width={130}
                          height={130}
                          className="h-32 w-32 rounded-xl border border-green-200 bg-white p-1.5 shadow-2xs"
                        />
                        <span className="mt-1 text-[10px] text-green-800 font-medium">
                          Scan to verify on event day
                        </span>
                      </div>
                    ) : isVoid ? (
                      <div className="my-4 flex items-center justify-center gap-1 text-xs font-semibold text-red-700">
                        <XCircle size={14} />
                        <span>Entry Withdrawn</span>
                      </div>
                    ) : null}

                    <div className="w-full border-t border-[#f0e7df] pt-2">
                      <Link
                        href={`/verify/${t.ticket_number}`}
                        className="inline-flex items-center gap-1 text-xs font-bold text-[#7c1619] hover:underline"
                      >
                        <span>View Verification Badge</span>
                        <ExternalLink size={12} />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Delivery Confirmation Notice */}
            {deliveries.length > 0 && (
              <div className="mt-5 rounded-xl border border-emerald-100 bg-[#fffaf7] p-3 text-xs text-[#594541]">
                <p className="font-semibold text-[#7c1619]">Official Delivery Status:</p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  {deliveries.map((d) => (
                    <span key={d.channel} className="inline-flex items-center gap-1 text-[11px]">
                      <CheckCircle2 size={12} className="text-emerald-700" />
                      <span>
                        {d.channel === "WHATSAPP" ? "WhatsApp: " : "Email: "}
                        <b className="uppercase">{d.status}</b>
                      </span>
                    </span>
                  ))}
                </div>
                {deliveries.some((d) => d.status === "SIMULATED") && (
                  <p className="mt-1 text-[10px] text-[#705a54] italic">
                    (Notice: Message transmission simulated in preview/development environment)
                  </p>
                )}
              </div>
            )}

            {/* Free WhatsApp Ticket Delivery Option */}
            <div className="mt-5 border-t border-green-200 pt-4">
              <p className="text-xs font-semibold text-[#594541] mb-2">
                Save or Share Tickets via WhatsApp:
              </p>
              <WhatsAppTicketDeliveryButton
                orderId={order.id}
                recipientPhone={customer?.whatsapp_number}
                initialStatus={deliveries.find((d) => d.channel === "WHATSAPP")?.status}
              />
            </div>
          </div>
        )}

        {/* Payment Review in Progress (Submitted & Awaiting Verification) */}
        {isSubmitted && !isIssued && (
          <div className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-blue-900">
              <Clock size={20} className="text-blue-700" />
              <h2 className="text-base font-bold">Payment details received. Awaiting Admin Verification.</h2>
            </div>
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-xs text-blue-950 space-y-2">
              <p className="font-semibold text-blue-900">Submitted Transaction Reference:</p>
              <p className="font-mono text-base font-bold text-[#7c1619]">{payment?.utr_reference}</p>
              {payment?.submitted_at && (
                <p className="text-[11px] text-blue-800">
                  Registered: {new Date(payment.submitted_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                </p>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-blue-900">
                Our organizers will manually inspect bank credit records against your UTR. Once confirmed,
                your lucky draw tickets will appear here and be dispatched to <b>{customer?.whatsapp_number || customer?.phone}</b>.
              </p>
            </div>

            {/* Reopening & Correcting Details while unverified */}
            <div className="pt-2 border-t border-[#f0e7df]">
              <details className="group text-xs">
                <summary className="font-semibold text-[#7c1619] cursor-pointer hover:underline flex items-center gap-1.5 py-1">
                  <RefreshCw size={13} />
                  <span>Need to correct your submitted UTR or contact info? Click here</span>
                </summary>
                <div className="mt-4 pt-3 border-t border-[#f0e7df]">
                  <PaymentDetailsForm
                    orderId={order.id}
                    orderNumber={order.order_number}
                    initialUtr={payment?.utr_reference ?? ""}
                    initialEmail={customer?.email ?? ""}
                    suggestedPhone={customer?.phone ?? customer?.whatsapp_number ?? ""}
                    initialWhatsapp={customer?.whatsapp_number ?? ""}
                    initialPayerName={payment?.payer_name ?? ""}
                    isReopening={true}
                    isMock={manualUpiConfig.isMock}
                  />
                </div>
              </details>
            </div>
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

        {/* Part A: Customer Payment Journey & Part B: Details Form (Pending or Rejected) */}
        {(isPending || isRejected) && (
          <CustomerPaymentJourney
            orderNumber={order.order_number}
            payeeName={manualUpiConfig.displayName}
            upiId={manualUpiConfig.upiId}
            amountInr={totalInr}
            upiIntentUri={upiIntentUri}
            dynamicQrDataUrl={dynamicQrDataUrl}
            staticQrImagePath={manualUpiConfig.qrImagePath || "/upi_qr.jpeg"}
            isMock={manualUpiConfig.isMock}
            isReopening={false}
          >
            <PaymentDetailsForm
              orderId={order.id}
              orderNumber={order.order_number}
              initialUtr={payment?.utr_reference ?? ""}
              initialEmail={customer?.email ?? ""}
              suggestedPhone={customer?.phone ?? customer?.whatsapp_number ?? ""}
              initialWhatsapp={customer?.whatsapp_number ?? ""}
              initialPayerName={payment?.payer_name ?? ""}
              isReopening={false}
              isMock={manualUpiConfig.isMock}
            />
          </CustomerPaymentJourney>
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
