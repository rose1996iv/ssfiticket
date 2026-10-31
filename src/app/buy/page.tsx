import Link from "next/link";
import { connection } from "next/server";
import { Gift, ShieldAlert, Sparkles, Ticket } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getActiveSellerByReferralCode } from "@/lib/validation/referral";
import { PublicOrderForm } from "@/components/buy/PublicOrderForm";
import { CampaignCountdown } from "@/components/campaign/CampaignCountdown";
import { evaluateCampaignSchedule } from "@/lib/date/timezone";
import { isFeatureEnabled } from "@/lib/config/featureFlags";

export const instant = false;

const prizes = [
  ["1st Prize", "₹10,000 Cash"],
  ["2nd Prize", "₹8,000 Cash"],
  ["3rd Prize", "Electric Induction"],
  ["4th Prize", "Ukulele"],
  ["5th Prize", "Mini Soundbox"],
] as const;

type PageProps = {
  searchParams: Promise<{ ref?: string }>;
};

export default async function PublicBuyPage({ searchParams }: PageProps) {
  await connection();

  if (isFeatureEnabled("ENABLE_MAINTENANCE_MODE")) {
    return (
      <main className="min-h-screen bg-[#fffaf7] px-4 py-12 text-[#35110f] sm:px-6 sm:py-16">
        <div className="mx-auto max-w-lg rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-[#7c1619]">SSFI Fundraising</p>
              <p className="text-[11px] text-[#705a54]">Lucky Draw Portal</p>
            </div>
          </div>
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <h2 className="text-base font-semibold">Scheduled Maintenance</h2>
            <p className="mt-1 text-sm leading-6">
              Online ticket orders are temporarily paused for scheduled maintenance. Please check back shortly.
            </p>
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <Link
              href="/"
              className="inline-flex justify-center rounded-lg bg-[#7c1619] px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-[#601114]"
            >
              Return to Homepage
            </Link>
            <Link
              href="/terms"
              className="inline-flex justify-center rounded-lg border border-[#eadbcf] px-4 py-2.5 text-sm font-semibold text-[#705a54] hover:bg-[#fbf7f4]"
            >
              View Lucky Draw Terms
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const query = await searchParams;
  const rawRef = query.ref;

  // Case 1: No referral code provided in query string
  if (!rawRef || rawRef.trim() === "") {
    return (
      <main className="min-h-screen bg-[#fffaf7] px-4 py-12 text-[#35110f] sm:px-6 sm:py-16">
        <div className="mx-auto max-w-lg rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-[#7c1619]">SSFI Fundraising</p>
              <p className="text-[11px] text-[#705a54]">Lucky Draw Portal</p>
            </div>
          </div>

          <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            Seller Referral Required
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#705a54]">
            To buy a Lucky Draw ticket, you need to use an active seller’s referral link or scan
            their personal QR code.
          </p>

          <form action="/buy" method="GET" className="mt-6 space-y-4">
            <div>
              <label htmlFor="ref-input" className="block text-xs font-semibold uppercase tracking-wider text-[#705a54]">
                Enter Seller Code
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="ref-input"
                  name="ref"
                  required
                  placeholder="e.g. SELLER-001"
                  className="w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3 text-sm font-mono uppercase text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
                />
                <button
                  type="submit"
                  className="rounded-xl bg-[#7c1619] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#631214]"
                >
                  Continue
                </button>
              </div>
            </div>
          </form>

          <div className="mt-8 border-t border-[#f0e7df] pt-6 text-center text-xs text-[#705a54]">
            Are you an SSFI seller?{" "}
            <Link href="/login" className="font-semibold text-[#7c1619] underline">
              Log in to your dashboard
            </Link>{" "}
            to download your QR code.
          </div>
        </div>
      </main>
    );
  }

  // Case 2: Validate the referral code
  const validation = await getActiveSellerByReferralCode(rawRef);

  if (!validation.valid) {
    return (
      <main className="min-h-screen bg-[#fffaf7] px-4 py-12 text-[#35110f] sm:px-6 sm:py-16">
        <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-center gap-2 text-red-700">
            <ShieldAlert size={24} />
            <span className="text-xs font-bold tracking-widest uppercase">Referral Error</span>
          </div>

          <h1 className="mt-4 text-2xl font-bold tracking-tight text-red-900">
            {validation.code === "INACTIVE" ? "Seller Account Inactive" : "Invalid Referral Code"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#705a54]">{validation.error}</p>

          <div className="mt-6 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-xs text-[#705a54]">
            <p className="font-semibold text-[#35110f]">What you can do:</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>Verify that the referral URL was copied completely.</li>
              <li>Ask your SSFI seller to provide their updated QR code.</li>
              <li>Or try entering a different seller code below.</li>
            </ul>
          </div>

          <form action="/buy" method="GET" className="mt-6 flex gap-2">
            <input
              name="ref"
              required
              placeholder="e.g. SELLER-001"
              className="w-full rounded-xl border border-[#eadbcf] p-3 text-sm font-mono uppercase text-[#35110f]"
            />
            <button
              type="submit"
              className="rounded-xl bg-[#7c1619] px-4 py-3 text-sm font-bold text-white hover:bg-[#631214]"
            >
              Verify
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link href="/" className="text-xs text-[#7c1619] underline">
              Return to SSFI Homepage
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // Case 3: Valid active seller — check campaign status & schedule
  const seller = validation.seller;
  const db = createSupabaseAdminClient();
  const { data: campaign } = await db
    .from("campaigns")
    .select("id, name, ticket_price_paise, total_ticket_limit, sold_ticket_count, status, start_at, end_at")
    .eq("public_id", "ssfi-fundraising-lucky-draw")
    .maybeSingle();

  const schedule = evaluateCampaignSchedule(
    campaign?.status ?? "DRAFT",
    campaign?.start_at,
    campaign?.end_at
  );
  const isSellingOpen = schedule.isSellingOpen;
  const remainingTickets = campaign
    ? Math.max(0, campaign.total_ticket_limit - campaign.sold_ticket_count)
    : 1000;
  const ticketPricePaise = campaign?.ticket_price_paise ?? 10000; // default ₹100

  return (
    <main className="min-h-screen bg-[#fffaf7] pb-16 text-[#35110f]">
      {/* Top Banner */}
      <header className="border-b border-[#e8d6c5] bg-[#7c1619] px-4 py-8 text-white sm:px-6">
        <div className="mx-auto max-w-xl text-center">
          <div className="mb-3 flex justify-center">
            <Logo size="md" className="transition-transform hover:scale-105" />
          </div>
          <p className="text-xs font-bold tracking-[0.2em] text-[#f3ce75]">SSFI FUNDRAISING</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Lucky Draw Ticket Order</h1>
          <p className="mt-2 text-xs text-[#f8e9df]">
            Support Senthang Students Fellowship India by participating in the lucky draw!
          </p>
        </div>
      </header>

      <div className="mx-auto mt-6 max-w-xl px-4 sm:px-0">
        {/* Live Campaign Schedule & Countdown Card */}
        <div className="mb-6">
          <CampaignCountdown
            status={schedule.scheduleStatus}
            startAt={campaign?.start_at ?? null}
            endAt={campaign?.end_at ?? null}
            variant="customer"
          />
        </div>

        {/* Prizes Summary Card */}
        <section className="mb-6 rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center gap-2 font-bold text-[#7c1619]">
            <Gift size={18} />
            <h2 className="text-sm uppercase tracking-wider">Exciting Prizes</h2>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {prizes.map(([place, prize]) => (
              <div key={place} className="rounded-lg border border-[#f0e7df] bg-[#fffaf7] p-2">
                <span className="font-semibold text-[#7c1619]">{place}</span>
                <p className="mt-0.5 text-[#594541]">{prize}</p>
              </div>
            ))}
            <div className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-[#d6a23b] bg-[#fffaf7] p-2 text-[#7c1619]">
              <Sparkles size={14} className="text-[#d6a23b]" />
              <span className="font-semibold">₹{ticketPricePaise / 100} / Ticket</span>
            </div>
          </div>
        </section>

        {/* Order Form Card */}
        <section className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6 flex items-center justify-between border-b border-[#f0e7df] pb-4">
            <div>
              <h2 className="text-xl font-bold">Order Details</h2>
              <p className="text-xs text-[#705a54]">Fill in your information to reserve tickets</p>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-[#fceeee] px-3 py-1 text-xs font-bold text-[#a41f23]">
              <Ticket size={14} />
              <span>₹{ticketPricePaise / 100}</span>
            </div>
          </div>

          <PublicOrderForm
            sellerCode={seller.seller_code}
            sellerName={seller.display_name}
            unitPricePaise={ticketPricePaise}
            remainingCapacity={remainingTickets}
            isCampaignActive={isSellingOpen}
            campaignStatus={schedule.scheduleStatus}
            scheduleReason={schedule.description}
          />
        </section>
      </div>
    </main>
  );
}
