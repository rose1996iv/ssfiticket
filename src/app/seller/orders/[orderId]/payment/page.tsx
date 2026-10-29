import { notFound } from "next/navigation";
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
          Amount due: ₹{order.total_amount_paise / 100}
        </p>

        <div className="my-5 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-xs space-y-1.5">
          <p className="text-[#705a54]">
            Payee: <b className="text-[#35110f]">{manualUpiConfig.displayName}</b>
          </p>
          <p className="text-[#705a54]">
            UPI ID: <span className="font-mono font-bold text-[#7c1619]">{manualUpiConfig.upiId}</span>
          </p>
          <p className="text-[11px] text-[#705a54] pt-1">{manualUpiConfig.instructions}</p>
        </div>

        <SellerUpiPaymentForm orderId={order.id} isMock={manualUpiConfig.isMock} />
      </div>
    </>
  );
}
