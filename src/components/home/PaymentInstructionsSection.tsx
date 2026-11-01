import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FileCheck2,
  Mail,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
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
    title: "Select Tickets & Create Order",
    desc: "Select your ticket quantity and create your order. The total payable amount is calculated server-side based strictly on the campaign unit price.",
    icon: Ticket,
  },
  {
    step: 2,
    title: "Open Order Confirmation Page",
    desc: "Open your order confirmation page showing your unique Order Number (e.g. ORD-2026-XXXXXX) and payment status.",
    icon: FileCheck2,
  },
  {
    step: 3,
    title: "Choose Payment Method & Pay",
    desc: "Pay using the official SSFI UPI ID or QR code displayed by the system in Google Pay, PhonePe, Paytm, BHIM, or any UPI app.",
    icon: Smartphone,
  },
  {
    step: 4,
    title: "Verify Payment Details & Return",
    desc: "Verify Payment Details in your app before confirming. After transferring money, return to your order page.",
    icon: ArrowRight,
  },
  {
    step: 5,
    title: 'Tap "I Have Completed Payment"',
    desc: "Tap the green \"I Have Completed Payment\" button to open the mandatory details submission form.",
    icon: CheckCircle2,
  },
  {
    step: 6,
    title: "Submit Reference (UTR) & Details",
    desc: "Enter your payment details and submit. Submitting a UTR does not automatically confirm payment receipt; it submits your transfer for review.",
    icon: UserCheck,
  },
  {
    step: 7,
    title: "Wait for SSFI Admin Verification",
    desc: "Wait for the SSFI Admin to verify the payment. Payment Review &amp; Ticket Issuance requires cross-referencing incoming bank credits.",
    icon: Clock,
  },
  {
    step: 8,
    title: "Receive Verified Tickets",
    desc: "Receive your ticket after successful verification. Tickets are valid only after successful payment verification and are delivered to WhatsApp & Email.",
    icon: ShieldCheck,
  },
];

export function PaymentInstructionsSection({
  ticketPriceInr = 100,
  payeeName,
  upiId,
}: Props) {
  return (
    <section
      id="payment-instructions"
      aria-labelledby="payment-instructions-heading"
      className="border-t border-[#eadbcf] bg-white px-6 py-16 sm:px-10 sm:py-20"
    >
      <div className="mx-auto max-w-5xl">
        {/* Section Header */}
        <div className="flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#fceeee] px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-[#7c1619]">
            <ShieldCheck size={14} aria-hidden="true" />
            <span>Official Payment Guide</span>
          </div>
          <h2
            id="payment-instructions-heading"
            className="glitch-title mt-3 text-3xl font-bold tracking-tight text-[#35110f] sm:text-4xl"
          >
            How to Complete Your Ticket Payment
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#705a54]">
            Please read these guidelines carefully before purchasing your lucky draw tickets.
            Ticket sales commence on <b>1 November 2026</b>, and the official draw ceremony is confirmed for <b>19 December 2026</b>.
            SSFI uses manual UPI verification with human oversight to ensure transparent, secure student fundraising accounting.
          </p>
        </div>

        {/* 8-Step Customer Payment Process */}
        <div className="mt-12">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#a41f23]">
              How to Complete Your Ticket Payment — 8 Simple Steps
            </h3>
            <span className="text-xs font-semibold text-[#7c1619]">
              ₹{ticketPriceInr} / ticket
            </span>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PAYMENT_STEPS.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.step}
                  className="flex flex-col justify-between rounded-2xl border border-[#eadbcf] bg-[#fffaf7] p-5 shadow-xs transition hover:border-[#d6a23b]"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#7c1619] font-mono text-xs font-bold text-white shadow-xs">
                        {item.step}
                      </span>
                      <Icon className="text-[#a41f23]" size={20} aria-hidden="true" />
                    </div>
                    <h4 className="mt-3 text-sm font-bold text-[#35110f]">
                      Step {item.step}: {item.title}
                    </h4>
                    <p className="mt-1.5 text-xs leading-5 text-[#705a54]">
                      {item.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Official Account Details */}
        <div className="mt-8 rounded-2xl border border-[#eadbcf] bg-[#fffaf7] p-6 shadow-xs">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#a41f23]">
                Official Beneficiary Details
              </span>
              <h4 className="text-base font-bold text-[#35110f] mt-1">
                Authorized SSFI Bank &amp; UPI Account
              </h4>
              <p className="text-xs text-[#705a54] mt-0.5">
                Always verify the payee name (<b className="text-[#35110f]">{payeeName}</b>) and UPI ID before paying.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5 sm:shrink-0">
              <div className="rounded-xl border border-[#eadbcf] bg-white px-4 py-2.5 font-mono text-xs text-[#35110f]">
                <span className="block text-[10px] uppercase font-bold text-[#705a54]">Payee Name</span>
                <span className="font-bold text-[#7c1619]">{payeeName}</span>
              </div>
              <div className="rounded-xl border border-[#eadbcf] bg-white px-4 py-2.5 font-mono text-xs text-[#35110f]">
                <span className="block text-[10px] uppercase font-bold text-[#705a54]">UPI ID</span>
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
                  Mandatory Payment Details Required
                </h4>
                <p className="mt-1 text-xs text-[#705a54] leading-relaxed">
                  After completing your UPI transfer, you must submit all four required details on your order page:
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[#eadbcf] bg-white p-3.5">
                  <p className="font-mono text-xs font-bold text-[#7c1619]">
                    1. Payer Name
                  </p>
                  <p className="mt-0.5 text-xs text-[#705a54]">
                    Name on bank or UPI account (helps administrators reconcile incoming credit quickly).
                  </p>
                </div>
                <div className="rounded-xl border border-[#eadbcf] bg-white p-3.5">
                  <p className="font-mono text-xs font-bold text-[#7c1619]">
                    2. UTR / Transaction Reference
                  </p>
                  <p className="mt-0.5 text-xs text-[#705a54]">
                    12-digit UPI reference number from your Google Pay, PhonePe, Paytm, or bank receipt.
                  </p>
                </div>
                <div className="rounded-xl border border-[#eadbcf] bg-white p-3.5">
                  <p className="font-mono text-xs font-bold text-[#7c1619]">
                    3. Customer Email Address
                  </p>
                  <p className="mt-0.5 text-xs text-[#705a54]">
                    Where tickets and payment receipts are sent upon verification.
                  </p>
                </div>
                <div className="rounded-xl border border-[#eadbcf] bg-white p-3.5">
                  <p className="font-mono text-xs font-bold text-[#7c1619]">
                    4. WhatsApp Contact Number
                  </p>
                  <p className="mt-0.5 text-xs text-[#705a54]">
                    For direct ticket delivery and verification contact.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-[#7c1619]/20 bg-[#fceeee]/70 p-3.5 text-xs font-semibold text-[#7c1619]">
                ⚠️ All four fields are strictly mandatory. Orders without complete payment details cannot enter Admin Verification.
              </div>
            </div>
          </div>
        </div>

        {/* Prominent Customer Notices (7 Points) */}
        <div className="mt-8 rounded-2xl border border-amber-300 bg-amber-50/90 p-6 text-amber-950 shadow-xs">
          <div className="flex items-start gap-3.5">
            <ShieldAlert className="mt-1 text-amber-700 shrink-0" size={24} aria-hidden="true" />
            <div className="space-y-2.5">
              <h4 className="text-base font-bold text-amber-950">
                Important Customer Notices — Please Read Carefully
              </h4>
              <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-amber-900">
                <li>
                  <b>Pay only to official SSFI details:</b> Pay only to the official SSFI UPI ID shown on the website (<b>{upiId}</b>, Payee: <b>{payeeName}</b>).
                </li>
                <li>
                  <b>No automatic completion:</b> Opening a UPI app or returning from UPI does not mean payment is completed.
                </li>
                <li>
                  <b>No immediate issuance:</b> Submitting details does not issue tickets immediately.
                </li>
                <li>
                  <b>Bank credit verification:</b> Tickets are issued only after Admin checks actual bank credit.
                </li>
                <li>
                  <b>Avoid delays:</b> Incomplete details delay ticket issuance.
                </li>
                <li>
                  <b>Keep proof of payment:</b> Keep your bank SMS or UPI transaction screenshot until tickets are issued.
                </li>
                <li>
                  <b>Avoid duplicate payments:</b> Avoid duplicate payments for the same order.
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
                  <b>Verify recipient details:</b> Always verify the recipient name (<b>{payeeName}</b>),
                  UPI ID (<b>{upiId}</b>), and payable amount in your UPI app before entering your UPI PIN.
                </li>
                <li>
                  <b>Pay only to official details:</b> Only transfer funds to the verified SSFI payment details
                  shown on this official website. If any detail differs, do not transfer funds and contact SSFI support immediately.
                </li>
                <li>
                  <b>Protect your credentials:</b> Never share your UPI PIN, OTP, net banking password, or personal
                  security questions with anyone. SSFI coordinators and staff will never ask you for your UPI PIN or banking credentials.
                </li>
                <li>
                  <b>No automatic confirmation:</b> Opening a UPI app, scanning a QR code, or submitting a UTR does
                  not automatically confirm your payment or issue a valid ticket.
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
                  Your order status will display as <b>Under Review</b> while the organizer verifies
                  the bank transaction against bank credit records.
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
                  For questions about payment verification, UTR submissions, or ticket issuance,
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
              Review the complete rules governing ticket allocation, UTR verification, draw conditions, and customer responsibilities.
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
