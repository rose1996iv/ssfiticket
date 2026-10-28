import Link from "next/link";
import { connection } from "next/server";
import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  Clock,
  QrCode,
  ShoppingBag,
  Sparkles,
  Ticket,
  Users,
} from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const instant = false;

type PaymentSummary = { status: string; amount_paise: number };

export default async function AdminPage() {
  await connection();
  const db = createSupabaseAdminClient();

  const { data: campaign } = await db
    .from("campaigns")
    .select("total_ticket_limit, sold_ticket_count, ticket_price_paise, status, name")
    .eq("public_id", "ssfi-fundraising-lucky-draw")
    .maybeSingle();

  const { data: rawPayments = [] } = await db
    .from("payments")
    .select("status, amount_paise");
  const payments = rawPayments as PaymentSummary[];

  const { count: ordersCount = 0 } = await db
    .from("orders")
    .select("id", { count: "exact", head: true });

  const { count: sellersCount = 0 } = await db
    .from("sellers")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  const verifiedPayments = payments.filter((p) => p.status === "VERIFIED");
  const verifiedCollectionPaise = verifiedPayments.reduce((acc, p) => acc + p.amount_paise, 0);
  const verifiedCollectionInr = verifiedCollectionPaise / 100;

  const pendingPaymentsCount = payments.filter((p) => p.status === "SUBMITTED").length;
  const totalLimit = campaign?.total_ticket_limit ?? 1000;
  const soldCount = campaign?.sold_ticket_count ?? 0;
  const remainingCount = Math.max(0, totalLimit - soldCount);
  const percentageSold = Math.min(100, Math.round((soldCount / totalLimit) * 100));

  return (
    <div className="space-y-8">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#f0e7df] pb-6">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fceeee] px-3 py-1 text-xs font-bold text-[#a41f23]">
            <Sparkles size={14} />
            <span>Fundraising Operations</span>
          </span>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-[#35110f] sm:text-3xl">
            Operations Dashboard
          </h1>
          <p className="mt-1 text-xs text-[#705a54]">
            Real-time financial reconciliation and ticket distribution for SSFI Lucky Draw.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
              campaign?.status === "ACTIVE"
                ? "bg-green-100 text-green-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            Campaign: {campaign?.status ?? "DRAFT"}
          </span>
        </div>
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Metric 1: Verified Collection */}
        <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold tracking-wider uppercase text-[#705a54]">
              Verified Collection
            </span>
            <div className="rounded-xl bg-green-50 p-2 text-green-700">
              <Banknote size={20} />
            </div>
          </div>
          <p className="mt-3 text-3xl font-bold text-[#7c1619]">₹{verifiedCollectionInr}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-green-700">
            <CheckCircle2 size={13} />
            <span>{verifiedPayments.length} verified transactions</span>
          </p>
        </div>

        {/* Metric 2: Tickets Issued */}
        <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold tracking-wider uppercase text-[#705a54]">
              Tickets Issued
            </span>
            <div className="rounded-xl bg-[#fffaf7] p-2 text-[#7c1619]">
              <Ticket size={20} />
            </div>
          </div>
          <p className="mt-3 text-3xl font-bold text-[#35110f]">
            {soldCount}{" "}
            <span className="text-sm font-normal text-[#705a54]">/ {totalLimit}</span>
          </p>
          <div className="mt-2.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#f0e7df]">
              <div
                className="h-full bg-[#7c1619] transition-all"
                style={{ width: `${percentageSold}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-[#705a54]">{remainingCount} tickets remaining</p>
          </div>
        </div>

        {/* Metric 3: Pending Payments Review */}
        <Link
          href="/admin/payments"
          className="group rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm transition hover:border-[#7c1619] hover:shadow-md"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold tracking-wider uppercase text-[#705a54]">
              Pending Review
            </span>
            <div className="rounded-xl bg-amber-50 p-2 text-amber-700 group-hover:bg-[#7c1619] group-hover:text-white transition">
              <Clock size={20} />
            </div>
          </div>
          <p className="mt-3 text-3xl font-bold text-[#35110f]">{pendingPaymentsCount}</p>
          <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-[#7c1619] group-hover:underline">
            <span>Review payment UTRs</span>
            <ArrowRight size={13} />
          </p>
        </Link>

        {/* Metric 4: Operational Network */}
        <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold tracking-wider uppercase text-[#705a54]">
              Sales Network
            </span>
            <div className="rounded-xl bg-[#fffaf7] p-2 text-[#7c1619]">
              <Users size={20} />
            </div>
          </div>
          <p className="mt-3 text-3xl font-bold text-[#35110f]">{sellersCount}</p>
          <p className="mt-1 text-xs text-[#705a54]">{ordersCount} total orders registered</p>
        </div>
      </div>

      {/* Quick Action Navigation Grid */}
      <div>
        <h2 className="text-lg font-bold text-[#35110f]">Administrative Shortcuts</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/admin/payments"
            className="flex items-center gap-3.5 rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs transition hover:bg-[#fffaf7] hover:border-[#7c1619]"
          >
            <div className="rounded-xl bg-[#fceeee] p-3 text-[#7c1619]">
              <Banknote size={22} />
            </div>
            <div>
              <p className="font-bold text-sm text-[#35110f]">Verify Payments</p>
              <p className="text-xs text-[#705a54]">Match UTR & issue tickets</p>
            </div>
          </Link>

          <Link
            href="/admin/sellers"
            className="flex items-center gap-3.5 rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs transition hover:bg-[#fffaf7] hover:border-[#7c1619]"
          >
            <div className="rounded-xl bg-[#fceeee] p-3 text-[#7c1619]">
              <QrCode size={22} />
            </div>
            <div>
              <p className="font-bold text-sm text-[#35110f]">Sellers & QR Codes</p>
              <p className="text-xs text-[#705a54]">View & download QR standees</p>
            </div>
          </Link>

          <Link
            href="/admin/orders"
            className="flex items-center gap-3.5 rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs transition hover:bg-[#fffaf7] hover:border-[#7c1619]"
          >
            <div className="rounded-xl bg-[#fceeee] p-3 text-[#7c1619]">
              <ShoppingBag size={22} />
            </div>
            <div>
              <p className="font-bold text-sm text-[#35110f]">Orders Directory</p>
              <p className="text-xs text-[#705a54]">Audit all customer sales</p>
            </div>
          </Link>

          <Link
            href="/admin/tickets"
            className="flex items-center gap-3.5 rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs transition hover:bg-[#fffaf7] hover:border-[#7c1619]"
          >
            <div className="rounded-xl bg-[#fceeee] p-3 text-[#7c1619]">
              <Ticket size={22} />
            </div>
            <div>
              <p className="font-bold text-sm text-[#35110f]">Issued Tickets</p>
              <p className="text-xs text-[#705a54]">Assigned SSFI ticket numbers</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
