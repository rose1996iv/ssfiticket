import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const instant = false;

type OrderRow = {
  id: string;
  order_number: string;
  quantity: number;
  total_amount_paise: number;
  status: string;
  created_at: string;
  customers: { full_name: string; whatsapp_number: string } | null;
  sellers: { display_name: string; seller_code: string } | null;
};

export default async function AdminOrdersPage() {
  await connection();
  const db = createSupabaseAdminClient();
  const { data = [] } = await db
    .from("orders")
    .select(
      "id, order_number, quantity, total_amount_paise, status, created_at, customers(full_name, whatsapp_number), sellers(display_name, seller_code)"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const orders = data as unknown as OrderRow[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#f0e7df] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#35110f] sm:text-3xl">
            Orders Directory
          </h1>
          <p className="mt-1 text-xs text-[#705a54]">
            Comprehensive listing of ticket purchase orders across all registered sellers.
          </p>
        </div>
        <span className="font-mono text-xs font-semibold text-[#705a54]">
          {orders.length} total orders
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#eadbcf] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-[#fffaf7] text-xs font-semibold uppercase tracking-wider text-[#705a54]">
              <th className="p-4">Order Number</th>
              <th className="p-4">Customer</th>
              <th className="p-4">Attributed Seller</th>
              <th className="p-4">Tickets</th>
              <th className="p-4">Total</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0e7df]">
            {orders.map((order) => (
              <tr key={order.id} className="transition-colors hover:bg-[#fffaf7]/60">
                <td className="p-4 font-mono font-bold text-[#7c1619]">
                  {order.order_number}
                </td>
                <td className="p-4">
                  <p className="font-semibold text-[#35110f]">{order.customers?.full_name}</p>
                  <p className="font-mono text-xs text-[#705a54]">{order.customers?.whatsapp_number}</p>
                </td>
                <td className="p-4">
                  <p className="font-medium text-[#35110f]">{order.sellers?.display_name ?? "Direct"}</p>
                  {order.sellers?.seller_code && (
                    <span className="font-mono text-xs text-[#705a54]">{order.sellers?.seller_code}</span>
                  )}
                </td>
                <td className="p-4 font-semibold text-[#35110f]">{order.quantity}</td>
                <td className="p-4 font-bold text-[#7c1619]">₹{order.total_amount_paise / 100}</td>
                <td className="p-4">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      order.status === "TICKETS_ISSUED"
                        ? "bg-green-100 text-green-800"
                        : order.status === "PAYMENT_SUBMITTED"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {order.status}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <Link
                    href={`/admin/orders/${order.id}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#eadbcf] bg-[#fffaf7] px-3 py-1.5 text-xs font-semibold text-[#7c1619] transition hover:bg-[#f8e9df]"
                  >
                    <span>View</span>
                    <ArrowRight size={12} />
                  </Link>
                </td>
              </tr>
            ))}

            {orders.length === 0 && (
              <tr>
                <td className="p-12 text-center text-[#705a54]" colSpan={7}>
                  <ShoppingBag size={32} className="mx-auto mb-2 text-gray-300" />
                  <p className="text-base font-bold">No orders found</p>
                  <p className="text-xs">Customer orders will appear here once placed via QR code.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
