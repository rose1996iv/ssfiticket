import Link from "next/link";
import { requireRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { connection } from "next/server";

export const instant = false;

type OrderSummary = { quantity: number; total_amount_paise: number; status: string };

export default async function SellerPage() {
  await connection();
  const user = await requireRole("SELLER");
  const db = createSupabaseAdminClient();
  const { data: seller } = await db.from("sellers").select("id,display_name,seller_code").eq("profile_id", user.id).single();
  const { data: rawOrders = [] } = seller ? await db.from("orders").select("quantity,total_amount_paise,status").eq("seller_id", seller.id) : { data: [] };
  const orders = rawOrders as OrderSummary[];
  const issued = orders.filter((order) => order.status === "TICKETS_ISSUED");
  const sold = issued.reduce((total, order) => total + order.quantity, 0);
  const collection = issued.reduce((total, order) => total + order.total_amount_paise, 0);
  return <><h1 className="text-3xl font-bold">Seller dashboard</h1><p className="mt-1 text-[#705a54]">{seller?.display_name} · {seller?.seller_code}</p><div className="mt-6 grid gap-4 sm:grid-cols-4">{[["Tickets issued", sold], ["Collection", `₹${collection / 100}`], ["Pending payments", orders.filter((order) => order.status === "PAYMENT_SUBMITTED").length], ["Issued orders", issued.length]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-white p-5 shadow-sm"><p className="text-sm text-[#705a54]">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>)}</div><div className="mt-6 flex gap-3"><Link className="rounded bg-[#7c1619] px-4 py-3 font-bold text-white" href="/seller/orders/new">New sale</Link><Link className="rounded border px-4 py-3" href="/seller/orders">My orders</Link></div></>;
}
