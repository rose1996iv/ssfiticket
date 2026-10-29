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
} from "lucide-react";

type Props = {
  ticketPriceInr?: number;
};

export function PaymentInstructionsSection({ ticketPriceInr = 100 }: Props) {
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
            Payment Instructions &amp; Important Information
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#705a54]">
            Please read these guidelines carefully before purchasing your lucky draw tickets.
            SSFI uses manual UPI verification with human oversight to ensure transparent, secure student fundraising accounting.
          </p>
        </div>

        {/* Part A: How to Buy Tickets and Pay (Numbered Steps) */}
        <div className="mt-12">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#a41f23]">
            How to Buy Tickets and Pay — 5 Simple Steps
          </h3>

          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {/* Step 1 */}
            <div className="flex flex-col justify-between rounded-2xl border border-[#eadbcf] bg-[#fffaf7] p-6 shadow-xs">
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white shadow-xs">
                    1
                  </span>
                  <Ticket className="text-[#a41f23]" size={22} aria-hidden="true" />
                </div>
                <h4 className="mt-4 text-base font-bold text-[#35110f]">Select Tickets</h4>
                <p className="mt-2 text-xs leading-5 text-[#705a54]">
                  Choose your desired ticket quantity. The total payable amount is calculated
                  server-side based strictly on the campaign unit price (₹{ticketPriceInr} per ticket).
                  Client-supplied prices or discounts are never accepted.
                </p>
              </div>
              <div className="mt-4 border-t border-[#f0e7df] pt-3 text-[11px] font-medium text-[#7c1619]">
                Authoritative server pricing: ₹{ticketPriceInr} / ticket
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex flex-col justify-between rounded-2xl border border-[#eadbcf] bg-[#fffaf7] p-6 shadow-xs">
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white shadow-xs">
                    2
                  </span>
                  <Smartphone className="text-[#a41f23]" size={22} aria-hidden="true" />
                </div>
                <h4 className="mt-4 text-base font-bold text-[#35110f]">Choose Payment Method</h4>
                <p className="mt-2 text-xs leading-5 text-[#705a54]">
                  Pay using any supported UPI mobile application (Google Pay, PhonePe, Paytm, BHIM, Cred)
                  or scan the order-specific dynamic QR code.
                </p>
                <div className="mt-3 rounded-xl border border-[#eadbcf] bg-white p-3 font-mono text-[11px] text-[#35110f] space-y-1">
                  <p><span className="font-semibold text-[#705a54]">Payee:</span> HLAWN THA DAWT</p>
                  <p><span className="font-semibold text-[#705a54]">UPI ID:</span> 6909251270@ptaxis</p>
                  <p><span className="font-semibold text-[#705a54]">Currency:</span> INR (₹)</p>
                </div>
              </div>
              <div className="mt-4 border-t border-[#f0e7df] pt-3 text-[11px] text-[#705a54]">
                App compatibility depends on your device and installed UPI apps.
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex flex-col justify-between rounded-2xl border border-[#eadbcf] bg-[#fffaf7] p-6 shadow-xs">
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white shadow-xs">
                    3
                  </span>
                  <CheckCircle2 className="text-[#a41f23]" size={22} aria-hidden="true" />
                </div>
                <h4 className="mt-4 text-base font-bold text-[#35110f]">Verify Payment Details</h4>
                <p className="mt-2 text-xs leading-5 text-[#705a54]">
                  Before confirming the transfer in your bank or UPI application, verify that the
                  payee name (<b className="text-[#35110f]">HLAWN THA DAWT</b>), UPI ID, and
                  amount match your order summary exactly.
                </p>
              </div>
              <div className="mt-4 border-t border-[#f0e7df] pt-3 text-[11px] text-[#705a54]">
                The dynamic payment QR embeds the exact server-calculated amount.
              </div>
            </div>

            {/* Step 4 */}
            <div className="flex flex-col justify-between rounded-2xl border border-[#eadbcf] bg-[#fffaf7] p-6 shadow-xs">
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white shadow-xs">
                    4
                  </span>
                  <FileCheck2 className="text-[#a41f23]" size={22} aria-hidden="true" />
                </div>
                <h4 className="mt-4 text-base font-bold text-[#35110f]">Submit Reference (UTR)</h4>
                <p className="mt-2 text-xs leading-5 text-[#705a54]">
                  After the transfer succeeds, return to your order confirmation page and enter the
                  12-digit bank reference (UTR).
                </p>
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/80 p-2.5 text-[11px] text-amber-950">
                  <b>Important:</b> Submitting a UTR does not automatically confirm payment receipt.
                  It submits your transfer for review by the finance committee.
                </div>
              </div>
              <div className="mt-4 border-t border-[#f0e7df] pt-3 text-[11px] text-[#705a54]">
                Reference numbers can be found in your UPI app receipt.
              </div>
            </div>

            {/* Step 5 */}
            <div className="flex flex-col justify-between rounded-2xl border border-[#eadbcf] bg-[#fffaf7] p-6 shadow-xs sm:col-span-2 lg:col-span-2">
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white shadow-xs">
                    5
                  </span>
                  <ShieldCheck className="text-[#a41f23]" size={22} aria-hidden="true" />
                </div>
                <h4 className="mt-4 text-base font-bold text-[#35110f]">Payment Review &amp; Ticket Issuance</h4>
                <p className="mt-2 text-xs leading-5 text-[#705a54]">
                  SSFI administration cross-references incoming bank statements with submitted UTRs.
                  Tickets become valid <b>only after successful payment verification</b> and atomic database allocation.
                  Official ticket numbers (SSFI-XXXXXX) with scannable verification QR codes are then unlocked
                  and delivered to your WhatsApp and email.
                </p>
                <p className="mt-2 text-[11px] text-[#80635b]">
                  Tickets are never issued, and scannable verification QR codes are never displayed,
                  for pending, unverified, or rejected payments.
                </p>
              </div>
              <div className="mt-4 border-t border-[#f0e7df] pt-3 text-[11px] font-semibold text-emerald-800">
                ✓ Every verified ticket receives a tamper-proof verification URL at ssfiticket.vercel.app/verify/[ticketNumber]
              </div>
            </div>
          </div>
        </div>

        {/* Part B: Payment Safety Warning */}
        <div className="mt-10 rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-950 shadow-xs">
          <div className="flex items-start gap-3.5">
            <ShieldAlert className="mt-1 text-amber-700 shrink-0" size={24} aria-hidden="true" />
            <div className="space-y-2">
              <h4 className="text-base font-bold text-amber-950">
                Payment Safety Warning — Before You Pay
              </h4>
              <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-amber-900">
                <li>
                  <b>Verify recipient details:</b> Always verify the recipient name (<b>HLAWN THA DAWT</b>),
                  UPI ID (<b>6909251270@ptaxis</b>), and payable amount in your UPI app before entering your UPI PIN.
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

        {/* Part C: Important Note & Part D: Support Information */}
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {/* Important Note */}
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
          <div className="rounded-2xl border border-[#eadbcf] bg-[#fffaf7] p-6 shadow-xs flex flex-col justify-between">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 text-[#7c1619] shrink-0" size={20} aria-hidden="true" />
              <div>
                <h4 className="text-sm font-bold text-[#35110f]">Official Support &amp; Enquiries</h4>
                <p className="mt-2 text-xs leading-5 text-[#705a54]">
                  For questions about payment verification, UTR submissions, or ticket issuance,
                  please contact our designated support channel:
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
              Include your Order Number (e.g. SSFI-ORD-2026-XXXXXX) in your email for prompt assistance.
            </p>
          </div>
        </div>

        {/* Part E: Link to Terms & Conditions */}
        <div className="mt-10 flex flex-col items-center justify-between gap-4 rounded-2xl border border-[#eadbcf] bg-[#fefbf9] p-6 text-center sm:flex-row sm:text-left">
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
