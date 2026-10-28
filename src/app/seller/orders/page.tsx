import Link from "next/link";
import { requireRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { connection } from "next/server";

export const instant = false;

type OrderRow = { id: string; order_number: string; quantity: number; total_amount_paise: number; status: string; customers: { full_name: string } | null };

export default async function OrdersPage() {
  await connection();
  const user = await requireRole("SELLER");
  const db = createSupabaseAdminClient();
  const { data: seller } = await db.from("sellers").select("id").eq("profile_id", user.id).single();
  const { data = [] } = seller ? await db.from("orders").select("id,order_number,quantity,total_amount_paise,status,created_at,customers(full_name)").eq("seller_id", seller.id).order("created_at", { ascending: false }).limit(30) : { data: [] };
  const orders = data as unknown as OrderRow[];
  return <><h1 className="text-3xl font-bold">My orders</h1><div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-sm"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Order</th><th>Customer</th><th>Quantity</th><th>Amount</th><th>Status</th></tr></thead><tbody>{orders.map((order) => <tr className="border-t" key={order.id}><td className="p-3"><Link className="underline" href={`/seller/orders/${order.id}`}>{order.order_number}</Link></td><td>{order.customers?.full_name}</td><td>{order.quantity}</td><td>₹{order.total_amount_paise / 100}</td><td>{order.status}</td></tr>)}{orders.length === 0 && <tr><td className="p-3" colSpan={5}>No orders yet.</td></tr>}</tbody></table></div></>;
}
