import Image from "next/image";
import { notFound } from "next/navigation";
import { ExternalLink, FlaskConical } from "lucide-react";
import { requireRole } from "@/lib/auth/server";
import { manualUpiConfig } from "@/lib/config/payment";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SellerUpiPaymentForm } from "@/components/payment/SellerUpiPaymentForm";

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
          Amount due: ₹{order.total_amount_paise / 100} {manualUpiConfig.currency}
        </p>

        {manualUpiConfig.isMock ? (
          <div className="my-5 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/80 p-4 text-center">
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-800">
              <FlaskConical size={18} />
            </div>
            <h3 className="mt-2 text-xs font-bold text-amber-950">
              Seller Preview Mock Mode Active
            </h3>
            <p className="mt-1 text-[11px] text-amber-800 leading-normal max-w-sm mx-auto">
              Live QR code is disabled in preview mode. Use the simulated test controls below to test payment reference submission.
            </p>
          </div>
        ) : (
          <div className="my-5 flex flex-col items-center justify-center rounded-2xl border border-[#eadbcf] bg-[#fffaf7] p-5 shadow-xs">
            <div className="text-center mb-3">
              <span className="inline-block rounded-full bg-[#7c1619]/10 px-3 py-1 text-[11px] font-bold text-[#7c1619]">
                Official SSFI UPI QR Code
              </span>
              <p className="mt-1 text-xs text-[#705a54]">
                Scan using Google Pay, PhonePe, Paytm, BHIM or any UPI App
              </p>
            </div>

            <div className="relative overflow-hidden rounded-xl border border-[#eadbcf] bg-white p-2 shadow-sm">
              <Image
                src={manualUpiConfig.qrImagePath || "/upi_qr.jpeg"}
                alt={`Official SSFI UPI QR Code - Payee: ${manualUpiConfig.displayName}`}
                width={320}
                height={520}
                className="mx-auto h-auto max-w-[240px] sm:max-w-[280px] rounded-lg object-contain shadow-xs"
                priority
                unoptimized
              />
            </div>

            <div className="mt-3 flex items-center gap-3">
              <a
                href={manualUpiConfig.qrImagePath || "/upi_qr.jpeg"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#7c1619] hover:underline"
              >
                <span>Open Full QR Image</span>
                <ExternalLink size={12} />
              </a>
              <span className="text-[#eadbcf]">·</span>
              <a
                href={manualUpiConfig.qrImagePath || "/upi_qr.jpeg"}
                download="SSFI_UPI_QR.jpeg"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#705a54] hover:underline"
              >
                <span>Download QR</span>
              </a>
            </div>
          </div>
        )}

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
          <p className="text-[11px] text-[#705a54] pt-2 border-t border-[#f0e7df]">{manualUpiConfig.instructions}</p>
        </div>

        <SellerUpiPaymentForm orderId={order.id} isMock={manualUpiConfig.isMock} />
      </div>
    </>
  );
}
