import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const instant = false;

export default async function TermsAndConditionsPage() {
  const db = createSupabaseAdminClient();
  const { data: campaign } = await db
    .from("campaigns")
    .select("name, ticket_price_paise, total_ticket_limit, start_at, end_at, status")
    .eq("public_id", "ssfi-fundraising-lucky-draw")
    .maybeSingle();

  const ticketPriceInr = campaign?.ticket_price_paise ? campaign.ticket_price_paise / 100 : 100;
  const campaignName = campaign?.name || "SSFI Fundraising Lucky Draw";

  return (
    <main className="min-h-screen bg-[#fffaf7] text-[#35110f]">
      {/* Top Navbar */}
      <nav className="border-b border-[#e8d6c5] bg-[#7c1619] px-6 py-4 text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Link href="/" className="group flex items-center gap-3">
            <Logo size="sm" className="transition-transform group-hover:scale-105" />
            <div className="flex flex-col">
              <span className="text-base font-bold tracking-tight text-white leading-tight">SSFI Lucky Draw</span>
              <span className="text-[11px] text-[#f8e9df] leading-tight">Senthang Students Fellowship India</span>
            </div>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            <ArrowLeft size={14} />
            <span>Return to Homepage</span>
          </Link>
        </div>
      </nav>

      {/* Main Container */}
      <div className="mx-auto max-w-4xl px-6 py-12 sm:px-10 sm:py-16">
        {/* Header */}
        <div className="border-b border-[#eadbcf] pb-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#fceeee] px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-[#7c1619]">
            <FileText size={14} aria-hidden="true" />
            <span>Official Policy &amp; Terms</span>
          </div>
          <h1 className="glitch-title mt-3 text-3xl font-bold tracking-tight sm:text-4xl text-[#35110f]">
            Payment Instructions &amp; Terms &amp; Conditions
          </h1>
          <p className="mt-2 text-xs text-[#705a54]">
            Effective Campaign: <b>{campaignName}</b> · Governing Currency: <b>INR (₹)</b>
          </p>
          <p className="mt-3 text-sm leading-6 text-[#705a54]">
            These Terms &amp; Conditions govern the purchase, payment verification, and issuance of lucky draw tickets
            for the Senthang Students Fellowship India (SSFI) fundraising campaign. Please read these terms carefully before
            placing an order.
          </p>
        </div>

        {/* Content Sections */}
        <div className="mt-10 space-y-10 text-sm leading-relaxed text-[#594541]">
          {/* Section 1 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">1</span>
              <span>Ticket Selection and Order Amount</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                1.1. <b>Authoritative Pricing:</b> Lucky Draw ticket orders are priced strictly according to the active
                campaign configuration stored in the SSFI database. The authoritative price is currently <b>₹{ticketPriceInr} INR</b> per ticket.
              </p>
              <p>
                1.2. <b>Order Total Calculation:</b> The payable total is determined by multiplying the validated ticket quantity
                by the authoritative unit price (<code>Total = Quantity × Unit Price</code>). The calculation is executed exclusively
                on the server engine at the moment the order is created.
              </p>
              <p>
                1.3. <b>Zero Client Trust:</b> Client-supplied totals, browser parameter modifications, or unauthorized discounts
                are strictly rejected by the server validation layer.
              </p>
            </div>
          </section>

          {/* Section 2 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">2</span>
              <span>Payment and Transaction Reference</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                2.1. <b>Official Payment Destination:</b> All payments must be transferred directly to the verified SSFI organizer payment details:
              </p>
              <div className="my-2 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 font-mono text-xs text-[#35110f] space-y-1">
                <p><b>Payee Name:</b> HLAWN THA DAWT</p>
                <p><b>UPI ID:</b> 6909251270@ptaxis</p>
                <p><b>Currency:</b> INR (Indian Rupee)</p>
                <p><b>Official Support Email:</b> Senthangstudents@gmail.com</p>
              </div>
              <p>
                2.2. <b>Payment Submission (UTR):</b> After completing the transfer in any UPI application, the customer must return to
                the order confirmation page and submit the valid 12-digit Unique Transaction Reference (UTR / UPI Ref No.).
              </p>
              <p>
                2.3. <b>Submission Notice:</b> Submitting a UTR reference does <b>not</b> constitute proof that funds have been received.
                It initiates a verification request for SSFI finance staff review.
              </p>
            </div>
          </section>

          {/* Section 3 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">3</span>
              <span>Payment Verification</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                3.1. <b>Manual Verification:</b> To prevent fraud, double-spending, and spoofed receipts, all incoming payments
                are manually reviewed and reconciled by authorized SSFI staff against official bank credit records.
              </p>
              <p>
                3.2. <b>Under Review State:</b> Upon UTR submission, the payment moves into <code>SUBMITTED</code> (Under Review) status.
                Verification typically takes place during daily administrative hours.
              </p>
              <p>
                3.3. <b>Rejection of Invalid References:</b> References that do not match credit amounts, represent uncredited transfers,
                or fail reconciliation will be marked <code>REJECTED</code>.
              </p>
            </div>
          </section>

          {/* Section 4 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">4</span>
              <span>Ticket Issuance and Validity</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                4.1. <b>Atomic Issuance:</b> Official ticket numbers are generated via sequential database sequence only after
                the payment is explicitly approved by authorized SSFI staff (status: <code>TICKETS_ISSUED</code>).
              </p>
              <p>
                4.2. <b>Valid Ticket Format:</b> Authentic tickets follow the official numbering sequence (e.g. <code>SSFI-000001</code>).
                Only tickets recorded with status <code>ISSUED</code> in the SSFI registry are valid and eligible for the lucky draw.
              </p>
              <p>
                4.3. <b>Unverified Status:</b> Orders in <code>PENDING_PAYMENT</code> or <code>PAYMENT_SUBMITTED</code> do not hold valid tickets
                and are not eligible for any draw prize.
              </p>
            </div>
          </section>

          {/* Section 5 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">5</span>
              <span>Ticket QR Code and Verification</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                5.1. <b>Official Verification Portal:</b> Every issued ticket contains a scannable QR code resolving to the public
                verification portal at <code>https://ssfiticket.vercel.app/verify/[ticketNumber]</code>.
              </p>
              <p>
                5.2. <b>QR Display Gate:</b> Scannable ticket verification QR codes are displayed <b>only</b> after payment approval.
                No QR code is rendered for pending or rejected orders.
              </p>
              <p>
                5.3. <b>Voided Tickets:</b> In the event a ticket is voided or cancelled by administration, the verification page will
                clearly display the ticket as <code>VOID</code> and ineligible for the draw.
              </p>
            </div>
          </section>

          {/* Section 6 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">6</span>
              <span>Duplicate or Unsuccessful Payments</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                6.1. <b>Avoid Double Payment:</b> Customers must avoid transferring a second time for the same order while the status is
                Under Review. If you suspect an issue with your transfer, contact SSFI support before initiating another transaction.
              </p>
              <p>
                6.2. <b>Duplicate UTR Rejection:</b> The system rejects duplicate UTR submissions to prevent accidental or fraudulent double entry.
              </p>
              <p>
                6.3. <b>Payment Reconciliation Support:</b> In case of a bank deduction without order credit, contact{" "}
                <a href="mailto:Senthangstudents@gmail.com" className="text-[#7c1619] underline font-semibold">
                  Senthangstudents@gmail.com
                </a>{" "}
                with your banking receipt and order number.
              </p>
            </div>
          </section>

          {/* Section 7 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">7</span>
              <span>Draw Information and Prize Conditions</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                7.1. <b>Announced Prizes:</b> The campaign features five guaranteed celebration prizes:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>1st Prize: ₹10,000 Cash Giveaway</li>
                <li>2nd Prize: ₹8,000 Cash Celebration</li>
                <li>3rd Prize: Induction Cooker Giveaway</li>
                <li>4th Prize: Ukulele Celebration</li>
                <li>5th Prize: Mini Soundbox Celebration</li>
              </ul>
              <div className="space-y-2">
                <p>
                  7.2. <b>Confirmed Draw Date &amp; Methodology:</b> The official lucky draw ceremony is confirmed to take place on{" "}
                  <b className="text-[#7c1619]">19 December 2026</b>. Winning tickets will be selected through a fair, transparent,
                  and public drawing supervised by the SSFI Executive Committee.
                </p>
                <p>
                  7.3. <b>Ceremony Schedule, Venue &amp; Live Stream:</b> While the draw date of 19 December 2026 is confirmed, the specific ceremony time,
                  physical venue, and live broadcast schedule will be formally announced exclusively via our official communication channels:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-xs">
                  <li>
                    <b>Official Facebook:</b>{" "}
                    <a
                      href="https://www.facebook.com/senthangstudents"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#7c1619] underline font-semibold"
                    >
                      facebook.com/senthangstudents
                    </a>
                  </li>
                  <li>
                    <b>Official YouTube:</b>{" "}
                    <a
                      href="https://www.youtube.com/@SenthangStudentsSSFI"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#7c1619] underline font-semibold"
                    >
                      youtube.com/@SenthangStudentsSSFI
                    </a>
                  </li>
                  <li>
                    <b>Official Email:</b>{" "}
                    <a
                      href="mailto:Senthangstudents@gmail.com"
                      className="text-[#7c1619] underline font-semibold"
                    >
                      Senthangstudents@gmail.com
                    </a>
                  </li>
                </ul>
                <div className="my-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
                  <b>Organizer Approval Required:</b> Any modification to the confirmed draw date (19 December 2026), unannounced ceremony time,
                  venue details, or ticket eligibility guidelines must be officially approved and promulgated by the SSFI Executive Committee
                  through these official channels before taking effect.
                </div>
              </div>
            </div>
          </section>

          {/* Section 8 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">8</span>
              <span>Customer Responsibilities</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                8.1. <b>Accurate Contact Information:</b> Customers must provide an active, reachable WhatsApp phone number
                and legal name to ensure proper delivery of ticket numbers.
              </p>
              <p>
                8.2. <b>Security of Credentials:</b> Customers must never share their UPI PIN, OTP, banking password, or card details.
                SSFI staff will never request these sensitive credentials.
              </p>
              <p>
                8.3. <b>Authentic References:</b> Submitting falsified, reused, or fraudulent transaction references is strictly prohibited
                and will result in order cancellation and permanent disqualification from the campaign.
              </p>
            </div>
          </section>

          {/* Section 9 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">9</span>
              <span>Support and Enquiries</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                9.1. <b>Official Communications:</b> For support, transaction inquiries, or ticket confirmation assistance, contact:
              </p>
              <p className="font-semibold text-[#7c1619]">
                Email: <a href="mailto:Senthangstudents@gmail.com" className="underline">Senthangstudents@gmail.com</a>
              </p>
              <p>
                9.2. Always provide your Order Number (e.g. <code>SSFI-ORD-2026-XXXXXX</code>) and customer name when contacting support.
              </p>
            </div>
          </section>

          {/* Section 10 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">10</span>
              <span>Changes to Campaign Information</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                10.1. <b>Updates and Amendments:</b> SSFI reserves the right to amend campaign operational details or scheduling
                as required by student fellowship governance. All amendments are published on the official website and social media.
              </p>
              <p>
                10.2. <b>Verified Channels:</b> Updates are released strictly through <code>ssfiticket.vercel.app</code> and
                our official Instagram channel (<code>@ssfi_official</code>).
              </p>
            </div>
          </section>
        </div>

        {/* Back Link */}
        <div className="mt-14 border-t border-[#eadbcf] pt-8 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-bold text-[#7c1619] hover:underline"
          >
            <ArrowLeft size={14} />
            <span>Return to SSFI Homepage</span>
          </Link>
          <Link
            href="/buy"
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#7c1619] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#601114]"
          >
            <span>Proceed to Buy Tickets</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
