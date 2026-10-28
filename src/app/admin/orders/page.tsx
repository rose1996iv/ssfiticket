import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, ArrowRight, RefreshCw, ShoppingBag } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ExportDropdown } from "@/components/admin/ExportDropdown";

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
  const { data, error } = await db
    .from("orders")
    .select(
      "id, order_number, quantity, total_amount_paise, status, created_at, customers(full_name, whatsapp_number), sellers(display_name, seller_code)"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[Admin Orders Query Error]", {
      code: error.code,
      message: error.message,
      hint: error.hint,
    });

    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-950 shadow-xs">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-red-600" size={24} />
            <div className="space-y-3">
              <div>
                <h1 className="text-lg font-bold text-red-950">
                  Unable to Load Orders
                </h1>
                <p className="mt-1 text-xs leading-relaxed text-red-800">
                  Failed to fetch customer purchase orders from the database.
                </p>
              </div>

              <div className="rounded-xl border border-red-200 bg-white/90 p-3.5 font-mono text-xs text-red-900">
                <p><span className="font-bold">Error Code:</span> {error.code || "UNKNOWN"}</p>
                <p><span className="font-bold">Message:</span> {error.message || "Query failed"}</p>
                {error.hint && <p className="mt-1 text-red-700"><span className="font-bold">Hint:</span> {error.hint}</p>}
              </div>

              <div>
                <Link
                  href="/admin/orders"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-red-800"
                >
                  <RefreshCw size={14} />
                  <span>Retry Orders Query</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const orders = (data ?? []) as unknown as OrderRow[];

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
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-semibold text-[#705a54]">
            {orders.length} total orders
          </span>
          <ExportDropdown resource="orders" resourceName="Orders" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#eadbcf] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-[#fffaf7] text-xs font-semibold uppercase tracking-wider text-[#705a54]">
              <th className="p-4">Order Ref</th>
              <th className="p-4">Date</th>
              <th className="p-4">Customer</th>
              <th className="p-4">Seller Attribution</th>
              <th className="p-4">Quantity</th>
              <th className="p-4">Total</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0e7df]">
            {orders.map((order) => {
              const date = new Date(order.created_at).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
              });

              return (
                <tr key={order.id} className="transition-colors hover:bg-[#fffaf7]/60">
                  <td className="p-4 font-mono font-semibold text-[#7c1619]">
                    {order.order_number}
                  </td>
                  <td className="p-4 text-xs text-[#705a54]">{date}</td>
                  <td className="p-4">
                    <p className="font-semibold text-[#35110f]">{order.customers?.full_name}</p>
                    <p className="font-mono text-xs text-[#705a54]">{order.customers?.whatsapp_number}</p>
                  </td>
                  <td className="p-4">
                    <p className="font-medium text-xs">{order.sellers?.display_name ?? "Direct Online"}</p>
                    {order.sellers?.seller_code && (
                      <span className="font-mono text-[11px] text-[#705a54]">
                        {order.sellers?.seller_code}
                      </span>
                    )}
                  </td>
                  <td className="p-4 font-semibold">{order.quantity}</td>
                  <td className="p-4 font-bold text-[#7c1619]">
                    ₹{order.total_amount_paise / 100}
                  </td>
                  <td className="p-4">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        order.status === "TICKETS_ISSUED"
                          ? "bg-green-100 text-green-800"
                          : order.status === "PAYMENT_VERIFIED"
                          ? "bg-blue-100 text-blue-800"
                          : order.status === "PAYMENT_SUBMITTED"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {order.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="inline-flex items-center gap-1 rounded-xl border border-[#eadbcf] px-3 py-1.5 text-xs font-semibold text-[#7c1619] transition hover:bg-[#fffaf7]"
                    >
                      <span>View</span>
                      <ArrowRight size={12} />
                    </Link>
                  </td>
                </tr>
              );
            })}

            {orders.length === 0 && (
              <tr>
                <td className="p-12 text-center" colSpan={8}>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fffaf7] text-[#7c1619]">
                    <ShoppingBag size={28} />
                  </div>
                  <h3 className="mt-4 text-base font-bold text-[#35110f]">No Orders Found</h3>
                  <p className="mt-1 text-xs text-[#705a54]">
                    Orders will appear here as customers buy tickets via sellers.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
