import { notFound } from "next/navigation";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { requireRole } from "@/lib/auth/server";
import { manualUpiConfig } from "@/lib/config/payment";
import { buildUpiPaymentUri, generateUpiQrDataUrl } from "@/lib/payment/upi";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SellerUpiPaymentForm } from "@/components/payment/SellerUpiPaymentForm";
import { UpiPaymentBox } from "@/components/payment/UpiPaymentBox";


type PaymentOrder = {
  id: string;
  order_number: string;
  quantity: number;
  total_amount_paise: number;
  snapshot_seller_id: string | null;
  snapshot_seller_code: string | null;
  snapshot_seller_display_name: string | null;
  snapshot_qr_storage_path: string | null;
  snapshot_upi_id: string | null;
  snapshot_account_name: string | null;
  snapshot_payment_instructions: string | null;
  customers: { full_name: string }[];
};

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const user = await requireRole("SELLER");
  const db = createSupabaseAdminClient();

  const { data: seller } = await db
    .from("sellers")
    .select("id, seller_code, display_name, qr_storage_path, upi_id, account_name, payment_instructions, is_qr_active")
    .eq("profile_id", user.id)
    .single();

  const { data } = seller
    ? await db
        .from("orders")
        .select(`
          id,
          order_number,
          quantity,
          total_amount_paise,
          snapshot_seller_id,
          snapshot_seller_code,
          snapshot_seller_display_name,
          snapshot_qr_storage_path,
          snapshot_upi_id,
          snapshot_account_name,
          snapshot_payment_instructions,
          customers(full_name)
        `)
        .eq("id", orderId)
        .eq("seller_id", seller.id)
        .eq("status", "PENDING_PAYMENT")
        .maybeSingle()
    : { data: null };

  const order = data as unknown as PaymentOrder | null;
  if (!order) notFound();

  const totalInr = order.total_amount_paise / 100;

  // Resolve Seller-Owned QR: check order snapshot first, fallback to active seller QR
  const qrStoragePath = order.snapshot_qr_storage_path || (seller?.is_qr_active ? seller?.qr_storage_path : null);
  let sellerQrSignedUrl: string | null = null;
  let hasSellerQr = false;

  if (qrStoragePath) {
    try {
      const { data: signed } = await db.storage
        .from("seller-payment-qrs")
        .createSignedUrl(qrStoragePath, 300);
      if (signed?.signedUrl) {
        sellerQrSignedUrl = signed.signedUrl;
        hasSellerQr = true;
      }
    } catch {
      // Non-fatal: QR unavailable
    }
  }

  const effectiveUpiId = order.snapshot_upi_id || (seller?.is_qr_active ? seller?.upi_id : null);
  const effectivePayeeName =
    order.snapshot_account_name ||
    order.snapshot_seller_display_name ||
    seller?.display_name ||
    "Seller Account";

  const upiIntentUri = effectiveUpiId
    ? buildUpiPaymentUri({
        payeeVpa: effectiveUpiId,
        payeeName: effectivePayeeName,
        amountPaise: order.total_amount_paise,
        orderNumber: order.order_number,
        transactionRef: order.order_number,
        currency: manualUpiConfig.currency,
      })
    : "";

  const dynamicQrDataUrl = upiIntentUri
    ? await generateUpiQrDataUrl(upiIntentUri, { width: 300 })
    : "";

  return (
    <>
      <h1 className="text-3xl font-bold text-[#35110f]">Manual UPI Payment</h1>
      <div className="mt-6 max-w-xl rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-[#f0e7df] pb-3">
          <div>
            <p className="font-mono text-sm font-bold text-[#7c1619]">{order.order_number}</p>
            <p className="text-xs text-[#705a54]">
              {order.customers[0]?.full_name} · {order.quantity} ticket
              {order.quantity > 1 ? "s" : ""}
            </p>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
            Awaiting Payment
          </span>
        </div>

        <p className="mt-4 text-2xl font-bold text-[#7c1619]">
          Amount due: ₹{totalInr.toFixed(2)} {manualUpiConfig.currency}
        </p>

        {/* Seller-Owned UPI Payment Box or Warning */}
        {hasSellerQr && sellerQrSignedUrl && effectiveUpiId ? (
          <div className="my-5">
            <UpiPaymentBox
              orderNumber={order.order_number}
              payeeName={effectivePayeeName}
              upiId={effectiveUpiId || ""}
              amountInr={totalInr}
              upiIntentUri={upiIntentUri}
              dynamicQrDataUrl={dynamicQrDataUrl}
              staticQrImagePath={sellerQrSignedUrl}
              isMock={manualUpiConfig.isMock}
            />
          </div>
        ) : (
          <div className="my-5 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-950 shadow-sm space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 text-red-600 shrink-0" size={24} />
              <div className="space-y-2">
                <h3 className="font-bold text-base text-red-950">Seller Payment QR Unavailable</h3>
                <p className="text-xs text-red-800 leading-relaxed">
                  Your personal payment QR is currently not configured or active. To accept customer payments, please configure and activate your personal payment QR in{" "}
                  <Link href="/seller/payment-settings" className="font-bold underline text-[#7c1619]">
                    Payment Settings
                  </Link>.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Payment Summary */}
        <div className="my-5 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-xs space-y-2">
          <div className="flex justify-between">
            <span className="text-[#705a54]">Payee:</span>
            <b className="text-[#35110f]">{effectivePayeeName}</b>
          </div>
          <div className="flex justify-between border-t border-[#f0e7df] pt-2">
            <span className="text-[#705a54]">UPI ID:</span>
            <span className="font-mono font-bold text-[#7c1619]">{effectiveUpiId || "—"}</span>
          </div>
          <div className="flex justify-between border-t border-[#f0e7df] pt-2">
            <span className="text-[#705a54]">Currency:</span>
            <span className="font-semibold text-[#35110f]">{manualUpiConfig.currency}</span>
          </div>
          <div className="flex justify-between border-t border-[#f0e7df] pt-2">
            <span className="text-[#705a54]">Support:</span>
            <span className="text-[#35110f]">{manualUpiConfig.supportEmail}</span>
          </div>
        </div>

        <SellerUpiPaymentForm orderId={order.id} isMock={manualUpiConfig.isMock} />
      </div>
    </>
  );
}
