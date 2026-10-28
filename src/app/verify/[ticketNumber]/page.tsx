import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, CheckCircle2, ShieldAlert } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { Logo } from "@/components/brand/Logo";

export const instant = false;

type PageProps = {
  params: Promise<{ ticketNumber: string }>;
};

export default async function PublicTicketVerificationPage({ params }: PageProps) {
  await connection();
  const { ticketNumber } = await params;
  const cleanNumber = decodeURIComponent(ticketNumber).trim().toUpperCase();

  const db = createSupabaseAdminClient();
  const { data: ticket } = await db
    .from("tickets")
    .select("ticket_number, status, issued_at, campaigns(name)")
    .eq("ticket_number", cleanNumber)
    .maybeSingle();

  const isValid = ticket && ticket.status === "ISSUED";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#fffaf7] px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-[#eadbcf] bg-white p-8 text-center shadow-lg">
        {/* Logo */}
        <div className="mx-auto flex justify-center">
          <Logo size="lg" className="transition-transform hover:scale-105" />
        </div>

        <p className="mt-5 text-xs font-bold tracking-[0.2em] uppercase text-[#a41f23]">
          SSFI Lucky Draw Verification
        </p>

        {isValid ? (
          <>
            <div className="mt-4 flex items-center justify-center gap-1.5 text-xs font-bold text-green-700">
              <CheckCircle2 size={16} />
              <span>Official Registered Ticket</span>
            </div>

            <div className="my-6 rounded-2xl border border-green-200 bg-green-50/70 p-6">
              <p className="text-xs uppercase tracking-wider text-green-800">Verified Ticket Number</p>
              <p className="mt-2 font-mono text-3xl font-bold tracking-tight text-[#7c1619]">
                {ticket.ticket_number}
              </p>
              <div className="mt-4 border-t border-green-200/80 pt-3 text-xs text-green-800">
                <p>Status: <b>Valid & Eligible for Draw</b></p>
                {ticket.issued_at && (
                  <p className="mt-1 text-[11px] text-green-700">
                    Issued: {new Date(ticket.issued_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                )}
              </div>
            </div>

            <p className="text-xs text-[#705a54] leading-relaxed">
              This ticket is authentic and officially recorded in the Senthang Students Fellowship India
              fundraising registry.
            </p>
          </>
        ) : (
          <>
            <div className="mt-4 flex items-center justify-center gap-1.5 text-xs font-bold text-amber-700">
              <ShieldAlert size={16} />
              <span>Ticket Record Pending or Not Found</span>
            </div>

            <div className="my-6 rounded-2xl border border-amber-200 bg-amber-50/70 p-6">
              <p className="text-xs uppercase tracking-wider text-amber-900">Queried Ticket Number</p>
              <p className="mt-2 font-mono text-2xl font-bold text-[#35110f]">{cleanNumber}</p>
              <p className="mt-3 text-xs text-amber-800 leading-relaxed">
                We could not locate an active issued ticket matching this reference. If you recently
                submitted a payment, your ticket will appear once an administrator confirms the UTR.
              </p>
            </div>
          </>
        )}

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
