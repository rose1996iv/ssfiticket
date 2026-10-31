import Link from "next/link";
import { requireRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { connection } from "next/server";
import { SellerReferralCard } from "@/components/seller/SellerReferralCard";
import { CampaignCountdown } from "@/components/campaign/CampaignCountdown";
import { evaluateCampaignSchedule } from "@/lib/date/timezone";

export const instant = false;

type OrderSummary = { quantity: number; total_amount_paise: number; status: string };

export default async function SellerPage() {
  await connection();
  const user = await requireRole("SELLER");
  const db = createSupabaseAdminClient();
  const { data: seller } = await db
    .from("sellers")
    .select("id,display_name,seller_code")
    .eq("profile_id", user.id)
    .single();

  const { data: campaign } = await db
    .from("campaigns")
    .select("status, start_at, end_at")
    .eq("public_id", "ssfi-fundraising-lucky-draw")
    .maybeSingle();

  const schedule = evaluateCampaignSchedule(
    campaign?.status ?? "DRAFT",
    campaign?.start_at,
    campaign?.end_at
  );

  const { count: unreadMessagesCount = 0 } = seller
    ? await db
        .from("seller_messages")
        .select("id", { count: "exact", head: true })
        .eq("recipient_seller_id", seller.id)
        .neq("sender_role", "SELLER")
        .is("read_at", null)
        .is("archived_at", null)
    : { count: 0 };

  const { data: rawOrders = [] } = seller
    ? await db
        .from("orders")
        .select("quantity,total_amount_paise,status")
        .eq("seller_id", seller.id)
    : { data: [] };

  const orders = rawOrders as OrderSummary[];
  const issued = orders.filter((order) => order.status === "TICKETS_ISSUED");
  const sold = issued.reduce((total, order) => total + order.quantity, 0);
  const collection = issued.reduce((total, order) => total + order.total_amount_paise, 0);

  return (
    <>
      <h1 className="text-3xl font-bold">Seller dashboard</h1>
      <p className="mt-1 text-[#705a54]">
        {seller?.display_name} · <span className="font-mono font-semibold">{seller?.seller_code}</span>
      </p>

      {/* Campaign Schedule & Countdown */}
      <div className="mt-6">
        <CampaignCountdown
          status={schedule.scheduleStatus}
          startAt={campaign?.start_at ?? null}
          endAt={campaign?.end_at ?? null}
          variant="seller"
        />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-5">
        {[
          ["Tickets issued", sold],
          ["Collection", `₹${collection / 100}`],
          ["Pending payments", orders.filter((order) => order.status === "PAYMENT_SUBMITTED").length],
          ["Issued orders", issued.length],
          ["Unread notices", unreadMessagesCount ?? 0],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-[#705a54]">{label}</p>
            <p className="mt-2 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      {seller && (
        <div className="mt-6">
          <SellerReferralCard sellerCode={seller.seller_code} sellerName={seller.display_name} />
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link className="rounded bg-[#7c1619] px-4 py-3 font-bold text-white transition hover:bg-[#631214]" href="/seller/orders/new">
          New manual sale
        </Link>
        <Link className="rounded border border-[#eadbcf] bg-white px-4 py-3 font-semibold text-[#35110f] transition hover:bg-[#fffaf7]" href="/seller/orders">
          My orders
        </Link>
        <Link className="rounded border border-[#eadbcf] bg-white px-4 py-3 font-semibold text-[#35110f] transition hover:bg-[#fffaf7] flex items-center gap-2" href="/seller/messages">
          <span>Seller Inbox</span>
          {(unreadMessagesCount ?? 0) > 0 && (
            <span className="rounded-full bg-[#7c1619] text-white px-2 py-0.5 text-xs font-bold font-mono">
              {unreadMessagesCount}
            </span>
          )}
        </Link>
      </div>
    </>
  );
}
