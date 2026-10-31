import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Search, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/Logo";

export const metadata = {
  title: "Verify Ticket — SSFI Lucky Draw",
  description: "Official ticket verification portal for Senthang Students Fellowship India fundraising lucky draw.",
};

async function handleVerifySearch(formData: FormData) {
  "use server";
  const rawNumber = formData.get("ticketNumber");
  const ticketNumber = typeof rawNumber === "string" ? rawNumber.trim().toUpperCase() : "";

  if (ticketNumber) {
    redirect(`/verify/${encodeURIComponent(ticketNumber)}`);
  }
}

export default function PublicTicketVerificationIndexPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#fffaf7] px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-[#eadbcf] bg-white p-8 text-center shadow-lg">
        {/* Logo */}
        <div className="mx-auto flex justify-center">
          <Logo size="lg" className="transition-transform hover:scale-105" />
        </div>

        <p className="mt-5 text-xs font-bold tracking-[0.2em] uppercase text-[#a41f23]">
          Official Public Verification Portal
        </p>
        <h1 className="mt-2 text-xl font-bold text-[#35110f]">
          SSFI Lucky Draw Ticket Verification
        </h1>
        <p className="mt-2 text-xs text-[#705a54] leading-relaxed">
          Verify the authenticity, eligibility, and official registration status of any SSFI Lucky Draw ticket.
        </p>

        {/* Verification Search Form */}
        <form action={handleVerifySearch} className="mt-6 space-y-4">
          <div className="text-left">
            <label
              htmlFor="ticketNumber"
              className="block text-xs font-bold uppercase tracking-wider text-[#705a54]"
            >
              Enter Ticket Number
            </label>
            <div className="mt-1.5 relative">
              <input
                id="ticketNumber"
                name="ticketNumber"
                type="text"
                required
                placeholder="e.g. SSFI-000001"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck="false"
                className="w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] px-4 py-3 text-sm font-mono font-bold uppercase text-[#35110f] placeholder:text-[#a89890] placeholder:font-normal focus:border-[#7c1619] focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[#7c1619]/20"
              />
            </div>
          </div>

          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7c1619] px-5 py-3 text-sm font-bold text-white shadow-xs transition hover:bg-[#631214] active:scale-98"
          >
            <Search size={16} />
            <span>Verify Ticket Online</span>
          </button>
        </form>

        <div className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-green-50/80 p-3 text-xs text-green-800 border border-green-200/80">
          <ShieldCheck size={16} className="text-green-700 shrink-0" />
          <span>Real-time verification directly from the SSFI fundraising registry.</span>
        </div>

        <div className="mt-6 border-t border-[#f0e7df] pt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7c1619] transition hover:underline"
          >
            <ArrowLeft size={14} />
            <span>Return to SSFI Homepage</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
