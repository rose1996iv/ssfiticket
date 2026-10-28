import Link from "next/link";
import { ArrowRight, Gift, QrCode, ShieldCheck, Ticket } from "lucide-react";

const prizes = [
  ["1st Prize", "₹10,000 Cash"],
  ["2nd Prize", "₹8,000 Cash"],
  ["3rd Prize", "Electric Induction"],
  ["4th Prize", "Ukulele"],
  ["5th Prize", "Mini Soundbox"],
] as const;

export default function Home() {
  return (
    <main className="min-h-screen bg-[#fffaf7] text-[#35110f]">
      <section className="relative overflow-hidden border-b border-[#e8d6c5] bg-[#7c1619] px-6 py-16 text-white sm:px-10 sm:py-24">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full border-[28px] border-[#d6a23b]/30" />
        <div className="relative mx-auto max-w-5xl">
          <p className="mb-5 text-sm font-bold tracking-[0.24em] text-[#f3ce75]">SSFI</p>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
            Senthang Students Fellowship India
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#f8e9df]">
            Fundraising Ticket System for the SSFI Fundraising Lucky Draw.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              href="/buy"
              className="inline-flex items-center gap-2 rounded-full bg-[#d6a23b] px-6 py-3.5 text-sm font-bold text-[#35110f] shadow-md transition hover:bg-[#c29130]"
            >
              <QrCode size={18} aria-hidden="true" />
              <span>Buy Tickets via Seller Referral</span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-6 px-6 py-12 sm:grid-cols-3 sm:px-10 sm:py-16">
        <article className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm sm:col-span-1">
          <Ticket className="mb-4 text-[#a41f23]" aria-hidden="true" />
          <p className="text-sm font-semibold uppercase tracking-wider text-[#80635b]">Ticket Price</p>
          <p className="mt-2 text-4xl font-bold text-[#7c1619]">₹100</p>
          <p className="mt-3 text-sm leading-6 text-[#705a54]">Ticket purchase will open in a future phase.</p>
        </article>
        <article className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm sm:col-span-2">
          <div className="flex items-center gap-3">
            <Gift className="text-[#a41f23]" aria-hidden="true" />
            <h2 className="text-xl font-bold">Prize summary</h2>
          </div>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2">
            {prizes.map(([place, prize]) => (
              <div key={place} className="flex items-baseline justify-between gap-3 border-b border-[#f0e7df] pb-3 text-sm">
                <dt className="font-semibold text-[#7c1619]">{place}</dt>
                <dd className="text-right text-[#594541]">{prize}</dd>
              </div>
            ))}
          </dl>
        </article>
      </section>

      <section className="mx-auto flex max-w-5xl items-start gap-3 px-6 pb-12 text-sm leading-6 text-[#705a54] sm:px-10 sm:pb-16">
        <ShieldCheck className="mt-0.5 shrink-0 text-[#a41f23]" size={20} aria-hidden="true" />
        <p>This site is currently in its foundation phase. Ticket sales, payment collection, and ticket verification are not yet available.</p>
      </section>
    </main>
  );
}
