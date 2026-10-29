import Link from "next/link";
import {
  ShoppingCart,
  UserCheck,
  FileCheck2,
  CreditCard,
  ShieldCheck,
  Ticket,
  ArrowRight,
  AlertCircle,
} from "lucide-react";

type Props = {
  isCampaignActive: boolean;
  campaignStatusText?: string;
};

const STEPS = [
  {
    step: 1,
    title: "Choose Your Tickets",
    icon: ShoppingCart,
    description:
      "Select your desired number of tickets (₹100 per ticket) up to the remaining campaign capacity of 1,000 tickets.",
  },
  {
    step: 2,
    title: "Enter Your Details",
    icon: UserCheck,
    description:
      "Provide your Full Name, WhatsApp number for ticket delivery, and optional email address for order notifications.",
  },
  {
    step: 3,
    title: "Submit Your Order",
    icon: FileCheck2,
    description:
      "Submit the form to generate your official Order Number (e.g. ORD-2026-XXXXXX) and view the verified UPI payment instructions.",
  },
  {
    step: 4,
    title: "Complete Payment & Submit UTR",
    icon: CreditCard,
    description:
      "Transfer the exact amount using any UPI app and submit your 12-digit bank UTR reference for accounting verification.",
  },
  {
    step: 5,
    title: "Wait for Admin Verification",
    icon: ShieldCheck,
    description:
      "SSFI finance staff cross-reference your UTR reference against bank statements before tickets are authorized for issuance.",
  },
  {
    step: 6,
    title: "Receive Your Tickets",
    icon: Ticket,
    description:
      "Once approved, sequential ticket numbers (SSFI-XXXXXX) with official QR codes are delivered to your WhatsApp and Email (marked SIMULATED in development).",
  },
];

export function PurchaseGuideline({ isCampaignActive, campaignStatusText }: Props) {
  return (
    <section className="border-t border-[#eadbcf] bg-white px-6 py-16 sm:px-10 sm:py-20">
      <div className="mx-auto max-w-5xl">
        {/* Section Header: Centered Vertical Stack */}
        <div className="flex flex-col items-center text-center">
          <h2 className="glitch-title text-3xl font-bold tracking-tight text-[#35110f] sm:text-4xl">
            How to Purchase Your Tickets
          </h2>
          <span className="mt-2 text-xs font-bold uppercase tracking-widest text-[#a41f23]">
            Step-by-Step Instructions
          </span>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#705a54]">
            Follow this simple 6-step process to secure your lucky draw tickets and support the Senthang
            Students Fellowship India.
          </p>
        </div>

        {/* Campaign Inactive Notice if not active */}
        {!isCampaignActive && (
          <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 sm:text-sm">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle size={18} className="shrink-0 text-amber-700" />
              <span>Ticket Booking Status: {campaignStatusText || "DRAFT"}</span>
            </div>
            <p className="mt-1 text-amber-800">
              Online ticket sales are currently closed or in preparation. You can browse the verified seller
              directory below to connect with local representatives ahead of official opening.
            </p>
          </div>
        )}

        {/* 6-Step Grid */}
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.step}
                className="group relative flex flex-col justify-between rounded-2xl border border-[#eadbcf] bg-[#fffaf7] p-6 shadow-xs transition hover:border-[#d6a23b] hover:shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white shadow-xs">
                      {item.step}
                    </span>
                    <Icon className="text-[#a41f23] transition-transform group-hover:scale-110" size={22} />
                  </div>
                  <h3 className="mt-4 text-base font-bold text-[#35110f]">{item.title}</h3>
                  <p className="mt-2 text-xs leading-5 text-[#705a54]">{item.description}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Action Button */}
        <div className="mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/buy"
            className={`inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-bold shadow-md transition ${
              isCampaignActive
                ? "bg-[#7c1619] text-white hover:bg-[#601114] hover:scale-105"
                : "bg-gray-200 text-gray-500 hover:bg-gray-300"
            }`}
          >
            <span>{isCampaignActive ? "Book Tickets Online" : "View Order Booking Page"}</span>
            <ArrowRight size={16} />
          </Link>
          <span className="text-xs text-[#80635b]">
            Manual UPI verification ensures 100% human-verified accounting.
          </span>
        </div>
      </div>
    </section>
  );
}

