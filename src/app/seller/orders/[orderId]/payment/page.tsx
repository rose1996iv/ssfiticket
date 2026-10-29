import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/server";
import { manualUpiConfig } from "@/lib/config/payment";
import { buildUpiPaymentUri, generateUpiQrDataUrl } from "@/lib/payment/upi";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SellerUpiPaymentForm } from "@/components/payment/SellerUpiPaymentForm";
import { UpiPaymentBox } from "@/components/payment/UpiPaymentBox";

export const instant = false;

type PaymentOrder = {
  id: string;
  order_number: string;
  quantity: number;
  total_amount_paise: number;
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
    .select("id")
    .eq("profile_id", user.id)
    .single();

  const { data } = seller
    ? await db
        .from("orders")
        .select("id,order_number,quantity,total_amount_paise,customers(full_name)")
        .eq("id", orderId)
        .eq("seller_id", seller.id)
        .eq("status", "PENDING_PAYMENT")
        .maybeSingle()
    : { data: null };

  const order = data as unknown as PaymentOrder | null;
  if (!order) notFound();

  const totalInr = order.total_amount_paise / 100;

  const upiIntentUri = buildUpiPaymentUri({
    payeeVpa: manualUpiConfig.upiId,
    payeeName: manualUpiConfig.displayName,
    amountPaise: order.total_amount_paise,
    orderNumber: order.order_number,
    transactionRef: order.order_number,
    currency: manualUpiConfig.currency,
  });

  const dynamicQrDataUrl = await generateUpiQrDataUrl(upiIntentUri, { width: 300 });

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

        {/* Dynamic & Static UPI Payment Options Box */}
        <div className="my-5">
          <UpiPaymentBox
            orderNumber={order.order_number}
            payeeName={manualUpiConfig.displayName}
            upiId={manualUpiConfig.upiId}
            amountInr={totalInr}
            upiIntentUri={upiIntentUri}
            dynamicQrDataUrl={dynamicQrDataUrl}
            staticQrImagePath={manualUpiConfig.qrImagePath || "/upi_qr.jpeg"}
            isMock={manualUpiConfig.isMock}
          />
        </div>

        {/* Payment Summary */}
        <div className="my-5 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-xs space-y-2">
          <div className="flex justify-between">
            <span className="text-[#705a54]">Payee:</span>
            <b className="text-[#35110f]">{manualUpiConfig.displayName}</b>
          </div>
          <div className="flex justify-between border-t border-[#f0e7df] pt-2">
            <span className="text-[#705a54]">UPI ID:</span>
            <span className="font-mono font-bold text-[#7c1619]">{manualUpiConfig.upiId}</span>
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
