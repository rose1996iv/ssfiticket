"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock,
  FileCheck2,
  Mail,
  QrCode,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Ticket,
  UserCheck,
} from "lucide-react";

type Props = {
  ticketPriceInr?: number;
  payeeName: string;
  upiId: string;
};

const PAYMENT_STEPS = [
  {
    step: 1,
    phase: 1,
    title: "Select Tickets & Create Order",
    desc: "Select your ticket quantity and create your order. The total payable amount is calculated server-side based strictly on the campaign unit price.",
    icon: Ticket,
  },
  {
    step: 2,
    phase: 1,
    title: "Open Order Confirmation Page",
    desc: "Open your order confirmation page showing your unique Order Number (e.g. ORD-2026-XXXXXX) and your assigned seller's payment details.",
    icon: FileCheck2,
  },
  {
    step: 3,
    phase: 2,
    title: "Scan Assigned Seller Payment QR",
    desc: "Pay using the specific Seller QR code or official SSFI UPI details assigned to your order in Google Pay, PhonePe, Paytm, BHIM, or any UPI app.",
    icon: QrCode,
  },
  {
    step: 4,
    phase: 2,
    title: "Verify Payee Details & Return",
    desc: "Verify the seller payee name and amount in your UPI app before completing payment. After transferring money, return to your order page.",
    icon: ArrowRight,
  },
  {
    step: 5,
    phase: 3,
    title: "Upload Mandatory Screenshot",
    desc: "A genuine payment confirmation screenshot is mandatory for all orders. Upload your screenshot directly on your order confirmation page.",
    icon: Camera,
  },
  {
    step: 6,
    phase: 3,
    title: "Submit Reference (UTR) & Details",
    desc: "Enter your contact details and submit. Submitting a UTR does not automatically confirm payment receipt; it submits your transfer for review. UTR and Payer Name are optional helper fields.",
    icon: UserCheck,
  },
  {
    step: 7,
    phase: 4,
    title: "Wait for SSFI Admin Verification",
    desc: "Your seller provides an advisory check, then wait for SSFI Admin Verification. Tickets are issued only after Admin checks actual bank credit.",
    icon: Clock,
  },
  {
    step: 8,
    phase: 4,
    title: "Receive Verified Tickets",
    desc: "Tickets are issued strictly after Administrator final verification. Official verified entry tickets are dispatched directly to your Email with WhatsApp delivery confirmation.",
    icon: ShieldCheck,
  },
];

const PRESENTATION_PHASES = [
  { phase: 1, name: "Order Setup", steps: "Steps 1–2", color: "from-[#7c1619]/10 to-[#d6a23b]/10" },
  { phase: 2, name: "UPI Payment", steps: "Steps 3–4", color: "from-[#d6a23b]/10 to-[#7c1619]/10" },
  { phase: 3, name: "Proof & UTR", steps: "Steps 5–6", color: "from-[#7c1619]/10 to-[#d6a23b]/10" },
  { phase: 4, name: "Verification", steps: "Steps 7–8", color: "from-[#d6a23b]/10 to-[#7c1619]/10" },
];

export function PaymentInstructionsSection({
  ticketPriceInr = 100,
  payeeName = "HLAWN THA DAWT",
  upiId = "6909251270@ptaxis",
}: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState<number | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasEnteredViewport(true);
          observer.disconnect(); // Trigger once only
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="payment-instructions"
      aria-labelledby="payment-instructions-heading"
      className="relative overflow-hidden border-t border-[#eadbcf] bg-gradient-to-b from-white via-[#fffaf7] to-[#fbf5ee] px-6 py-16 sm:px-10 sm:py-24"
    >
      {/* Background Subtle Ambient Glow (Maroon & Warm Gold) */}
      <div
        className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-[#7c1619]/5 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute top-1/3 -right-40 h-96 w-96 rounded-full bg-[#d6a23b]/8 blur-3xl"
        aria-hidden="true"
      />

      <div className="mx-auto max-w-5xl">
        {/* Section Header */}
        <div
          className={`flex flex-col items-center text-center transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none motion-reduce:opacity-100 motion-reduce:translate-y-0 ${
            hasEnteredViewport
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-6"
          }`}
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-[#d6a23b]/30 bg-gradient-to-r from-[#fceeee] via-[#fffdf9] to-[#fceeee] px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-[#7c1619] shadow-xs">
            <Sparkles size={14} className="text-[#d6a23b]" aria-hidden="true" />
            <span>Official Payment Guide</span>
            <span className="h-1 w-1 rounded-full bg-[#7c1619]" />
            <span className="text-[10px] font-semibold text-[#a41f23]">Presentation Walkthrough</span>
          </div>

          <h2
            id="payment-instructions-heading"
            className="glitch-title mt-4 text-3xl font-extrabold tracking-tight text-[#35110f] sm:text-4xl lg:text-[2.65rem] leading-tight"
          >
            How to Complete Your Ticket Payment
          </h2>

          <p className="mt-3.5 max-w-2xl text-sm leading-relaxed text-[#705a54]">
            Please read these guidelines carefully before purchasing your lucky draw tickets.
            Ticket sales commence on <b>1 November 2026</b>, and the official draw ceremony is confirmed for <b>19 December 2026</b>.
            SSFI combines seller-owned QR payment collection with mandatory screenshot verification and administrator oversight for transparent student fundraising.
          </p>

          {/* Interactive Presentation Stepper (Morph-Style Flow Indicator) */}
          <div className="mt-8 flex w-full max-w-3xl flex-wrap items-center justify-center gap-2 rounded-2xl border border-[#eadbcf]/80 bg-white/90 p-2 shadow-xs backdrop-blur-xs">
            {PRESENTATION_PHASES.map((p) => {
              const isSelected = selectedPhase === p.phase;
              return (
                <button
                  key={p.phase}
                  type="button"
                  onClick={() => setSelectedPhase(isSelected ? null : p.phase)}
                  className={`group relative flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all duration-300 ease-out sm:px-4 ${
                    isSelected
                      ? "bg-[#7c1619] text-white shadow-sm ring-2 ring-[#d6a23b]/60 scale-105"
                      : "bg-[#fffaf7] text-[#705a54] hover:bg-[#fceeee]/70 hover:text-[#7c1619]"
                  }`}
                  aria-pressed={isSelected}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold font-mono transition-colors ${
                      isSelected
                        ? "bg-[#d6a23b] text-[#35110f]"
                        : "bg-[#eadbcf] text-[#35110f] group-hover:bg-[#d6a23b]/40"
                    }`}
                  >
                    {p.phase}
                  </span>
                  <span>{p.name}</span>
                  <span className={`text-[10px] opacity-75 font-normal ${isSelected ? "text-amber-200" : "text-[#705a54]"}`}>
                    ({p.steps})
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 8-Step Customer Payment Process */}
        <div className="mt-12">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eadbcf]/80 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-[#d6a23b] animate-pulse" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#a41f23]">
                How to Complete Your Ticket Payment — 8 Simple Steps
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-[#7c1619]/10 px-2.5 py-1 text-xs font-bold text-[#7c1619]">
                ₹{ticketPriceInr} / ticket
              </span>
              {selectedPhase && (
                <button
                  type="button"
                  onClick={() => setSelectedPhase(null)}
                  className="text-[11px] font-semibold text-[#a41f23] underline hover:text-[#7c1619]"
                >
                  Show all 8 steps
                </button>
              )}
            </div>
          </div>

          {/* Cards Grid: 4 Cols Desktop, 2 Cols Tablet, 1 Col Mobile */}
          <div
            className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            role="list"
            aria-label="Payment instruction steps"
          >
            {PAYMENT_STEPS.map((item, index) => {
              const Icon = item.icon;
              const isPhaseHighlighted = selectedPhase === null || selectedPhase === item.phase;
              const delayMs = index * 115;

              return (
                <div
                  key={item.step}
                  role="listitem"
                  style={{
                    transitionDelay: `${delayMs}ms`,
                  }}
                  className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border p-5 shadow-xs transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none motion-reduce:opacity-100 motion-reduce:translate-y-0 motion-reduce:scale-100 ${
                    hasEnteredViewport
                      ? "opacity-100 translate-y-0 scale-100"
                      : "opacity-0 translate-y-8 scale-[0.95]"
                  } ${
                    isPhaseHighlighted
                      ? "border-[#eadbcf] bg-gradient-to-b from-[#fffaf7] to-white hover:-translate-y-1.5 hover:border-[#d6a23b] hover:shadow-lg hover:shadow-[#7c1619]/8"
                      : "border-[#f0e7df] bg-white/60 opacity-40 grayscale-[40%] scale-[0.98]"
                  }`}
                >
                  {/* Subtle Animated Perimeter Light Trail (SVG Rect Stroke) */}
                  <svg
                    className={`pointer-events-none absolute inset-0 h-full w-full rounded-2xl transition-opacity duration-300 ${
                      isPhaseHighlighted ? "opacity-100 group-hover:opacity-100" : "opacity-0"
                    }`}
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient id={`card-trail-gradient-${item.step}`} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#7c1619" stopOpacity="0" />
                        <stop offset="45%" stopColor="#d6a23b" stopOpacity="0.85" />
                        <stop offset="55%" stopColor="#f59e0b" stopOpacity="0.95" />
                        <stop offset="100%" stopColor="#7c1619" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <rect
                      x="1"
                      y="1"
                      rx="15"
                      ry="15"
                      fill="none"
                      stroke={`url(#card-trail-gradient-${item.step})`}
                      strokeWidth="2"
                      pathLength="100"
                      strokeDasharray="22 78"
                      className="card-border-trail"
                      style={{
                        width: "calc(100% - 2px)",
                        height: "calc(100% - 2px)",
                        animationDelay: `${(item.step - 1) * 0.9}s`,
                      }}
                    />
                  </svg>

                  {/* Card Content */}
                  <div className="relative z-10">
                    {/* Header Row: Step Number & Icon */}
                    <div className="flex items-center justify-between">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#7c1619] to-[#591012] font-mono text-xs font-bold text-white shadow-xs ring-2 ring-[#d6a23b]/20 transition-transform duration-300 group-hover:scale-110 group-hover:ring-[#d6a23b]">
                        {item.step}
                      </span>
                      <div className="rounded-xl bg-[#fff2eb] p-2 text-[#a41f23] transition-colors duration-300 group-hover:bg-[#7c1619] group-hover:text-white">
                        <Icon size={18} aria-hidden="true" />
                      </div>
                    </div>

                    {/* Step Title */}
                    <h4 className="mt-3.5 text-sm font-bold text-[#35110f] transition-colors duration-200 group-hover:text-[#7c1619]">
                      Step {item.step}: {item.title}
                    </h4>

                    {/* Step Description */}
                    <p className="mt-2 text-xs leading-relaxed text-[#705a54]">
                      {item.desc}
                    </p>
                  </div>

                  {/* Card Bottom Accent Ribbon */}
                  <div className="relative z-10 mt-4 flex items-center justify-between border-t border-[#f4ebe3] pt-2 text-[10px] font-semibold text-[#80635b]">
                    <span className="uppercase tracking-wider">Phase {item.phase}</span>
                    <span className="inline-flex items-center gap-1 text-[#d6a23b] opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      <span>Ready</span>
                      <CheckCircle2 size={11} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Official Account Details */}
        <div className="mt-10 rounded-2xl border border-[#eadbcf] bg-[#fffaf7] p-6 shadow-xs">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#a41f23]">
                Central Beneficiary &amp; Fallback Details
              </span>
              <h4 className="text-base font-bold text-[#35110f] mt-1">
                SSFI Official Trust Account
              </h4>
              <p className="text-xs text-[#705a54] mt-0.5">
                Each order displays the specific seller&apos;s personal payment QR. If your seller has not configured a QR, the central details below are used.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5 sm:shrink-0">
              <div className="rounded-xl border border-[#eadbcf] bg-white px-4 py-2.5 font-mono text-xs text-[#35110f]">
                <span className="block text-[10px] uppercase font-bold text-[#705a54]">Central Payee</span>
                <span className="font-bold text-[#7c1619]">{payeeName}</span>
              </div>
              <div className="rounded-xl border border-[#eadbcf] bg-white px-4 py-2.5 font-mono text-xs text-[#35110f]">
                <span className="block text-[10px] uppercase font-bold text-[#705a54]">Central UPI ID</span>
                <span className="font-bold text-[#7c1619]">{upiId}</span>
              </div>
              <div className="rounded-xl border border-[#eadbcf] bg-white px-4 py-2.5 font-mono text-xs text-[#35110f]">
                <span className="block text-[10px] uppercase font-bold text-[#705a54]">Currency</span>
                <span className="font-bold text-[#7c1619]">INR</span>
              </div>
            </div>
          </div>
        </div>

        {/* Dedicated Mandatory Payment Details Callout */}
        <div className="mt-8 rounded-2xl border-2 border-[#d6a23b]/50 bg-[#fffdfa] p-6 shadow-xs">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-[#d6a23b]/20 p-2.5 text-[#35110f] shrink-0">
              <FileCheck2 size={24} />
            </div>
            <div className="space-y-3 w-full">
              <div>
                <h4 className="text-base font-bold text-[#35110f]">
                  Submission Requirements — Proof &amp; Contact
                </h4>
                <p className="mt-1 text-xs text-[#705a54] leading-relaxed">
                  After completing your UPI payment, submit your verification proof on your order page:
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-emerald-300 bg-emerald-50/70 p-3.5">
                  <p className="font-mono text-xs font-bold text-emerald-900 flex items-center justify-between">
                    <span>1. Payment Screenshot</span>
                    <span className="text-[10px] uppercase bg-emerald-200 px-1.5 py-0.5 rounded text-emerald-950 font-bold">Mandatory</span>
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-800">
                    Clear image of UPI success receipt showing amount, recipient name, and transaction date.
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-300 bg-emerald-50/70 p-3.5">
                  <p className="font-mono text-xs font-bold text-emerald-900 flex items-center justify-between">
                    <span>2. WhatsApp &amp; Email Contact</span>
                    <span className="text-[10px] uppercase bg-emerald-200 px-1.5 py-0.5 rounded text-emerald-950 font-bold">Mandatory</span>
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-800">
                    Accurate contact details where verified lucky draw tickets are dispatched.
                  </p>
                </div>
                <div className="rounded-xl border border-[#eadbcf] bg-white p-3.5">
                  <p className="font-mono text-xs font-bold text-[#7c1619] flex items-center justify-between">
                    <span>3. UTR / Reference Number</span>
                    <span className="text-[10px] uppercase bg-gray-100 px-1.5 py-0.5 rounded text-gray-700 font-bold">Optional</span>
                  </p>
                  <p className="mt-0.5 text-xs text-[#705a54]">
                    UPI transaction reference from receipt. Optional, but speeds up reconciliation.
                  </p>
                </div>
                <div className="rounded-xl border border-[#eadbcf] bg-white p-3.5">
                  <p className="font-mono text-xs font-bold text-[#7c1619] flex items-center justify-between">
                    <span>4. Payer Account Name</span>
                    <span className="text-[10px] uppercase bg-gray-100 px-1.5 py-0.5 rounded text-gray-700 font-bold">Optional</span>
                  </p>
                  <p className="mt-0.5 text-xs text-[#705a54]">
                    Account holder name matching the bank statement. Optional helper field.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-[#7c1619]/20 bg-[#fceeee]/70 p-3.5 text-xs font-semibold text-[#7c1619]">
                ⚠️ A genuine payment screenshot and valid contact info are mandatory. Submitting fake, altered, or duplicate screenshots will lead to order cancellation.
              </div>
            </div>
          </div>
        </div>

        {/* Prominent Customer Notices */}
        <div className="mt-8 rounded-2xl border border-amber-300 bg-amber-50/90 p-6 text-amber-950 shadow-xs">
          <div className="flex items-start gap-3.5">
            <ShieldAlert className="mt-1 text-amber-700 shrink-0" size={24} aria-hidden="true" />
            <div className="space-y-2.5">
              <h4 className="text-base font-bold text-amber-950">
                Important Payment Notices — Please Read Carefully
              </h4>
              <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-amber-900">
                <li>
                  <b>Pay only to the QR assigned to your order:</b> Each order captures an immutable snapshot of the seller&apos;s payment QR. Always pay to that QR code.
                </li>
                <li>
                  <b>Seller review is advisory:</b> Your seller will review your proof, but final approval and ticket generation are executed exclusively by the SSFI Administrator.
                </li>
                <li>
                  <b>No automatic completion:</b> Opening a UPI app or returning to the page does not mean payment is completed. You must submit your screenshot.
                </li>
                <li>
                  <b>Mandatory genuine screenshot:</b> Keep your original UPI confirmation receipt until your tickets are verified and delivered.
                </li>
                <li>
                  <b>Avoid duplicate payments:</b> Avoid paying twice for the same order unless instructed by SSFI Finance Support.
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Payment Safety Warning — Before You Pay */}
        <div className="mt-8 rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-950 shadow-xs">
          <div className="flex items-start gap-3.5">
            <ShieldAlert className="mt-1 text-amber-700 shrink-0" size={24} aria-hidden="true" />
            <div className="space-y-2">
              <h4 className="text-base font-bold text-amber-950">
                Payment Safety Warning — Before You Pay
              </h4>
              <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-amber-900">
                <li>
                  <b>Verify recipient details:</b> Always verify the recipient name and payable amount in your UPI app before entering your UPI PIN.
                </li>
                <li>
                  <b>Pay only to official details:</b> Only transfer funds to the payment QR shown on your order confirmation page. Never pay to third-party accounts sent via unverified messaging channels.
                </li>
                <li>
                  <b>Protect your credentials:</b> Never share your UPI PIN, OTP, or net banking password with anyone. SSFI coordinators and sellers will NEVER ask you for your UPI PIN.
                </li>
                <li>
                  <b>No automatic confirmation:</b> Submitting details registers your payment for review; lucky draw tickets are issued only after human administrative verification.
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Important Note & Support Information */}
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {/* Important Note: Under Review */}
          <div className="rounded-2xl border border-[#eadbcf] bg-[#fffaf7] p-6 shadow-xs">
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 text-[#a41f23] shrink-0" size={20} aria-hidden="true" />
              <div>
                <h4 className="text-sm font-bold text-[#35110f]">Payment Status &amp; Review Note</h4>
                <p className="mt-2 text-xs leading-5 text-[#705a54]">
                  Your order status will display as <b>Payment Submitted — Under Review</b> while the seller and administrator verify the transaction.
                </p>
                <p className="mt-2 text-xs leading-5 text-[#705a54]">
                  Please <b>avoid paying a second time</b> for the same order unless SSFI support
                  has officially confirmed that another payment is required.
                </p>
              </div>
            </div>
          </div>

          {/* Support Information */}
          <div className="flex flex-col justify-between rounded-2xl border border-[#eadbcf] bg-[#fffaf7] p-6 shadow-xs">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 text-[#7c1619] shrink-0" size={20} aria-hidden="true" />
              <div>
                <h4 className="text-sm font-bold text-[#35110f]">Official Support &amp; Enquiries</h4>
                <p className="mt-2 text-xs leading-5 text-[#705a54]">
                  For questions about payment verification, screenshot submissions, or ticket issuance,
                  contact our finance team:
                </p>
                <div className="mt-3">
                  <a
                    href="mailto:Senthangstudents@gmail.com"
                    className="inline-flex items-center gap-2 rounded-xl bg-[#7c1619] px-4 py-2.5 font-mono text-xs font-bold text-white shadow-xs transition hover:bg-[#601114]"
                  >
                    <Mail size={14} />
                    <span>Senthangstudents@gmail.com</span>
                  </a>
                </div>
              </div>
            </div>
            <p className="mt-4 border-t border-[#f0e7df] pt-3 text-[11px] text-[#80635b]">
              Include your Order Number in your email for prompt assistance.
            </p>
          </div>
        </div>

        {/* Link to Terms & Conditions */}
        <div className="mt-8 flex flex-col items-center justify-between gap-4 rounded-2xl border border-[#eadbcf] bg-[#fefbf9] p-6 text-center sm:flex-row sm:text-left">
          <div>
            <h4 className="text-sm font-bold text-[#35110f]">
              Full Payment Terms &amp; Conditions
            </h4>
            <p className="mt-1 text-xs text-[#705a54]">
              Review the complete rules governing seller-owned QR payments, screenshot proof requirements, review workflows, and ticket issuance.
            </p>
          </div>
          <Link
            href="/terms"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[#7c1619] bg-white px-5 py-2.5 text-xs font-bold text-[#7c1619] shadow-xs transition hover:bg-[#7c1619] hover:text-white"
          >
            <span>Read Terms &amp; Conditions</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}
