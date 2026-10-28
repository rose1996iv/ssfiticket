import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { connection } from "next/server";

export const instant = false;

type OrderRow = { id: string; order_number: string; quantity: number; total_amount_paise: number; status: string; customers: { full_name: string } | null; sellers: { display_name: string } | null };

export default async function AdminOrdersPage() {
  await connection();
  const db = createSupabaseAdminClient();
  const { data = [] } = await db.from("orders").select("id,order_number,quantity,total_amount_paise,status,created_at,customers(full_name),sellers(display_name)").order("created_at", { ascending: false }).limit(100);
  const orders = data as unknown as OrderRow[];
  return <><h1 className="text-3xl font-bold">Orders</h1><div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-sm"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Order</th><th>Customer</th><th>Seller</th><th>Quantity</th><th>Amount</th><th>Status</th></tr></thead><tbody>{orders.map((order) => <tr className="border-t" key={order.id}><td className="p-3"><Link className="underline" href={`/admin/orders/${order.id}`}>{order.order_number}</Link></td><td>{order.customers?.full_name}</td><td>{order.sellers?.display_name ?? "—"}</td><td>{order.quantity}</td><td>₹{order.total_amount_paise / 100}</td><td>{order.status}</td></tr>)}{orders.length === 0 && <tr><td className="p-3" colSpan={6}>No orders yet.</td></tr>}</tbody></table></div></>;
}
