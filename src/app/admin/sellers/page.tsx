import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { connection } from "next/server";

export const instant = false;

type SellerRow = { id: string; seller_code: string; display_name: string; is_active: boolean; created_at: string };

export default async function AdminSellersPage() {
  await connection();
  const db = createSupabaseAdminClient();
  const { data = [] } = await db.from("sellers").select("id,seller_code,display_name,is_active,created_at").order("created_at", { ascending: false }).limit(100);
  const sellers = data as SellerRow[];
  return <><h1 className="text-3xl font-bold">Sellers</h1><div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-sm"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Code</th><th>Name</th><th>Status</th></tr></thead><tbody>{sellers.map((seller) => <tr className="border-t" key={seller.id}><td className="p-3 font-mono">{seller.seller_code}</td><td>{seller.display_name}</td><td>{seller.is_active ? "Active" : "Inactive"}</td></tr>)}{sellers.length === 0 && <tr><td className="p-3" colSpan={3}>No sellers yet.</td></tr>}</tbody></table></div></>;
}
