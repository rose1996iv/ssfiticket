import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { connection } from "next/server";

export const instant = false;

type CustomerRow = { id: string; full_name: string; phone: string; whatsapp_number: string | null; email: string | null; created_at: string };

export default async function AdminCustomersPage() {
  await connection();
  const db = createSupabaseAdminClient();
  const { data = [] } = await db.from("customers").select("id,full_name,phone,whatsapp_number,email,created_at").order("created_at", { ascending: false }).limit(100);
  const customers = data as CustomerRow[];
  return <><h1 className="text-3xl font-bold">Customers</h1><div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-sm"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Name</th><th>Phone</th><th>WhatsApp</th><th>Email</th></tr></thead><tbody>{customers.map((customer) => <tr className="border-t" key={customer.id}><td className="p-3">{customer.full_name}</td><td>{customer.phone}</td><td>{customer.whatsapp_number ?? "—"}</td><td>{customer.email ?? "—"}</td></tr>)}{customers.length === 0 && <tr><td className="p-3" colSpan={4}>No customers yet.</td></tr>}</tbody></table></div></>;
}
