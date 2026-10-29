import Link from "next/link";
import { ArrowRight, Gift, LogIn, QrCode, ShieldCheck, Sparkles, Ticket } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { HeroBackgroundVideo } from "@/components/home/HeroBackgroundVideo";
import { PurchaseGuideline } from "@/components/home/PurchaseGuideline";
import { OfficialSellerDirectory } from "@/components/home/OfficialSellerDirectory";
import { OfficialContactsSection } from "@/components/home/OfficialContactsSection";
import { OfficialFooter } from "@/components/home/OfficialFooter";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getPublicSellerDirectory } from "@/server/actions/sellerDirectory";

const prizes = [
  ["1st Prize", "₹10,000 Cash Giveaway"],
  ["2nd Prize", "₹8,000 Cash Celebration"],
  ["3rd Prize", "Induction Cooker Giveaway"],
  ["4th Prize", "Ukulele Celebration"],
  ["5th Prize", "Mini Soundbox Celebration"],
] as const;

export default async function Home() {
  const db = createSupabaseAdminClient();

  const { data: campaign } = await db
    .from("campaigns")
    .select("id, name, status, start_at, end_at, ticket_price_paise, total_ticket_limit, sold_ticket_count")
    .eq("public_id", "ssfi-fundraising-lucky-draw")
    .maybeSingle();

  const now = new Date();
  const isWithinSchedule =
    (!campaign?.start_at || now >= new Date(campaign.start_at)) &&
    (!campaign?.end_at || now < new Date(campaign.end_at));

  const isCampaignActive = campaign?.status === "ACTIVE" && isWithinSchedule;
  const publicSellers = await getPublicSellerDirectory();

  return (
    <main className="min-h-screen bg-[#fffaf7] text-[#35110f]">
      {/* Top Navbar */}
      <nav className="border-b border-[#e8d6c5] bg-[#7c1619] px-6 py-4 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/" className="group flex items-center gap-3">
            <Logo size="sm" className="transition-transform group-hover:scale-105" />
            <div className="flex flex-col">
              <span className="text-base font-bold tracking-tight text-white leading-tight">SSFI Lucky Draw</span>
              <span className="text-[11px] text-[#f8e9df] leading-tight">Senthang Students Fellowship India</span>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
            >
              <LogIn size={14} />
              <span>Staff / Seller Sign in</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-[#e8d6c5] px-6 py-16 text-white sm:px-10 sm:py-24">
        {/* YouTube Background Video & Static Fallback Gradient */}
        <HeroBackgroundVideo />

        {/* Decorative Gold Accent Ring */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full border-[32px] border-[#d6a23b]/20 z-1" />

        <div className="relative z-10 mx-auto max-w-5xl animate-subtle-fade">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1 text-xs font-bold tracking-widest uppercase text-[#f3ce75] backdrop-blur-xs">
            <Sparkles size={14} />
            <span>Official Fundraising Campaign</span>
          </div>

          <h1 className="glitch-title max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl drop-shadow-sm">
            Senthang Students Fellowship India
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#f8e9df] drop-shadow-xs">
            Support student fellowship and education initiatives by participating in the official
            SSFI Fundraising Lucky Draw.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              href="/buy"
              className="inline-flex items-center gap-2 rounded-full bg-[#d6a23b] px-7 py-4 text-sm font-bold text-[#35110f] shadow-lg transition hover:bg-[#c29130] hover:scale-105"
            >
              <QrCode size={18} aria-hidden="true" />
              <span>Buy Tickets via Seller Referral</span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* Information Cards */}
      <section className="mx-auto grid max-w-5xl gap-6 px-6 py-12 sm:grid-cols-3 sm:px-10 sm:py-16">
        <article className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm sm:col-span-1">
          <Ticket className="mb-4 text-[#a41f23]" size={24} aria-hidden="true" />
          <p className="text-xs font-bold uppercase tracking-wider text-[#80635b]">Ticket Price</p>
          <p className="mt-2 text-4xl font-bold text-[#7c1619]">₹100</p>
          <p className="mt-3 text-xs leading-5 text-[#705a54]">
            Scan any active seller’s QR code to purchase your tickets securely online via manual UPI.
          </p>
        </article>

        <article className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm sm:col-span-2">
          <div className="flex items-center gap-3">
            <Gift className="text-[#a41f23]" size={24} aria-hidden="true" />
            <h2 className="text-xl font-bold">Guaranteed Celebration Prizes</h2>
          </div>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2">
            {prizes.map(([place, prize]) => (
              <div
                key={place}
                className="flex items-baseline justify-between gap-3 border-b border-[#f0e7df] pb-3 text-sm"
              >
                <dt className="font-semibold text-[#7c1619]">{place}</dt>
                <dd className="text-right text-[#594541] font-medium">{prize}</dd>
              </div>
            ))}
          </dl>
        </article>
      </section>

      {/* Step-by-Step Ticket Purchase Guideline */}
      <PurchaseGuideline
        isCampaignActive={isCampaignActive}
        campaignStatusText={campaign?.status || "DRAFT"}
      />

      {/* Official Seller Directory */}
      <OfficialSellerDirectory sellers={publicSellers} />

      {/* Official Contacts & WhatsApp Support */}
      <OfficialContactsSection />

      {/* Security & Verification Notice */}
      <section className="mx-auto flex max-w-5xl items-start gap-3 px-6 py-12 text-xs leading-6 text-[#705a54] sm:px-10">
        <ShieldCheck className="mt-0.5 shrink-0 text-[#a41f23]" size={20} aria-hidden="true" />
        <p>
          All ticket numbers are securely generated by database sequence upon manual staff
          verification of incoming payments. No automated lottery algorithms or live gateway
          transactions are used without human oversight.
        </p>
      </section>

      {/* Official Footer with Instagram QR */}
      <OfficialFooter />
    </main>
  );
}
