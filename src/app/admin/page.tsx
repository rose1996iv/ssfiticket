import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { connection } from "next/server";

export const instant = false;

type PaymentSummary = { status: string; amount_paise: number };

export default async function AdminPage() {
  await connection();
  const db = createSupabaseAdminClient();
  const { data: campaign } = await db.from("campaigns").select("total_ticket_limit,sold_ticket_count").eq("public_id", "ssfi-fundraising-lucky-draw").maybeSingle();
  const { data: rawPayments = [] } = await db.from("payments").select("status,amount_paise");
  const payments = rawPayments as PaymentSummary[];
  const { count: orders = 0 } = await db.from("orders").select("id", { count: "exact", head: true });
  const { count: sellers = 0 } = await db.from("sellers").select("id", { count: "exact", head: true }).eq("is_active", true);
  const verified = payments.filter((payment) => payment.status === "VERIFIED").reduce((total, payment) => total + payment.amount_paise, 0);
  const cards = [["Total tickets", campaign?.total_ticket_limit ?? 0], ["Issued", campaign?.sold_ticket_count ?? 0], ["Remaining", (campaign?.total_ticket_limit ?? 0) - (campaign?.sold_ticket_count ?? 0)], ["Verified collection", `₹${verified / 100}`], ["Pending payments", payments.filter((payment) => payment.status === "SUBMITTED").length], ["Orders", orders], ["Active sellers", sellers]];
  return <><h1 className="text-3xl font-bold">Operations dashboard</h1><p className="mt-1 text-sm text-[#705a54]">Operational totals are based on verified payments and issued tickets.</p><div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value]) => <div key={String(label)} className="rounded-xl bg-white p-5 shadow-sm"><p className="text-sm text-[#705a54]">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>)}</div></>;
}
