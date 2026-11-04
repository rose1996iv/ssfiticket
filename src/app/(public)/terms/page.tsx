import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";


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
            These Terms &amp; Conditions govern ticket ordering, seller-owned QR payment workflows, mandatory payment screenshot verification,
            two-tier review procedures, ticket issuance, and draw participation for the Senthang Students Fellowship India (SSFI) fundraising campaign.
            Please review these terms carefully before placing an order.
          </p>
        </div>

        {/* Content Sections */}
        <div className="mt-10 space-y-10 text-sm leading-relaxed text-[#594541]">
          {/* Section 1 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">1</span>
              <span>1. Ticket Selection and Order Amount</span>
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
              <p>
                1.4. <b>Official Campaign Window:</b> Ticket sales officially open on <b>1 November 2026</b> and close on <b>19 December 2026</b> prior to the grand lucky draw ceremony.
              </p>
            </div>
          </section>

          {/* Section 2 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">2</span>
              <span>2. Payment and Transaction Reference</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                2.1. <b>Seller-Owned Payment QR Architecture:</b> Each seller manages their personal payment QR code, UPI ID, and payment instructions. Customers scanning a seller&apos;s referral link pay directly to that seller&apos;s account.
              </p>
              <p>
                2.2. <b>Immutable Order Payment Snapshot:</b> At the moment an order is created, the system captures an immutable snapshot of the seller&apos;s payment QR code and UPI details. Subsequent modifications by the seller to their payment settings do not affect existing orders.
              </p>
              <p>
                2.3. <b>Official Central Fallback Details:</b> If an assigned seller has not uploaded an active payment QR, the official central SSFI payment details are presented:
              </p>
              <div className="my-2 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 font-mono text-xs text-[#35110f] space-y-1">
                <p><b>Payee Name:</b> HLAWN THA DAWT</p>
                <p><b>UPI ID:</b> 6909251270@ptaxis</p>
                <p><b>Currency:</b> INR (Indian Rupee)</p>
                <p><b>Official Support Email:</b> Senthangstudents@gmail.com</p>
              </div>
              <p>
                2.4. <b>Mandatory Payment Screenshot Proof:</b> A genuine payment confirmation screenshot is <b>strictly mandatory</b> for all submissions. Orders cannot enter review without an uploaded screenshot.
              </p>
              <p>
                2.5. <b>Optional UTR &amp; Payer Name:</b> The 12-digit UPI Transaction Reference (UTR / UPI Ref No.) and Payer Account Name are optional helper fields. While submitting a valid UTR speeds up reconciliation, the screenshot is the primary proof of payment.
              </p>
              <p>
                2.6. <b>Submission Notice:</b> Submitting a payment screenshot and reference does <b>not</b> constitute proof of receipt or automatic ticket issuance; it registers your transfer for human verification.
              </p>
            </div>
          </section>

          {/* Section 3 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">3</span>
              <span>3. Payment Verification</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                3.1. <b>Two-Tier Review System:</b> To ensure complete accuracy and prevent fraud, SSFI utilizes a two-tier review procedure:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li><b>Tier 1 — Intermediate Seller Review (Advisory):</b> The seller reviews the customer&apos;s uploaded screenshot and provides an advisory recommendation (Recommend Approval, Recommend Rejection, or Flag Discrepancy). The seller cannot issue tickets.</li>
                <li><b>Tier 2 — SSFI Administrator Final Verification (Authoritative):</b> Authorized SSFI administrators conduct final human verification against bank credit records and approve or reject the payment.</li>
              </ul>
              <p>
                3.2. <b>Under Review State:</b> Upon screenshot submission, the order enters <code>PAYMENT_SUBMITTED</code> status.
              </p>
              <p>
                3.3. <b>Rejection of Invalid Proof:</b> Transferred amounts that do not match the order total, altered screenshots, uncredited transfers, or fake references are marked <code>FAILED</code>.
              </p>
            </div>
          </section>

          {/* Section 4 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">4</span>
              <span>4. Ticket Issuance and Validity</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                4.1. <b>Atomic Issuance by Admin Only:</b> Official ticket numbers are generated via sequential database sequence only after the payment is approved by an authorized SSFI Administrator (status: <code>TICKETS_ISSUED</code>).
              </p>
              <p>
                4.2. <b>Valid Ticket Format:</b> Authentic tickets follow the official numbering sequence (e.g. <code>SSFI-000001</code>). Only tickets recorded with status <code>ISSUED</code> in the SSFI registry are valid and eligible for the lucky draw.
              </p>
              <p>
                4.3. <b>Unverified Status:</b> Orders in <code>PENDING_PAYMENT</code> or <code>PAYMENT_SUBMITTED</code> do not hold valid tickets and are not eligible for any draw prize.
              </p>
            </div>
          </section>

          {/* Section 5 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">5</span>
              <span>5. Ticket QR Code and Verification</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                5.1. <b>Official Verification Portal:</b> Every issued ticket contains a scannable QR code resolving to the public verification portal at <code>https://ssfiticket.vercel.app/verify/[ticketNumber]</code>.
              </p>
              <p>
                5.2. <b>QR Display Gate:</b> Scannable ticket verification QR codes are displayed <b>only</b> after payment approval. No QR code is rendered for pending or rejected orders.
              </p>
              <p>
                5.3. <b>Voided Tickets:</b> In the event a ticket is voided or cancelled by administration, the verification page will clearly display the ticket as <code>VOID</code> and ineligible for the draw.
              </p>
            </div>
          </section>

          {/* Section 6 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">6</span>
              <span>6. Duplicate or Unsuccessful Payments</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                6.1. <b>Avoid Double Payment:</b> Customers must avoid transferring a second time for the same order while the status is Under Review. If you suspect an issue with your transfer, contact SSFI support before initiating another transaction.
              </p>
              <p>
                6.2. <b>Duplicate Reference Rejection:</b> The system rejects duplicate transaction references to prevent accidental or fraudulent double entry.
              </p>
              <p>
                6.3. <b>Wrong-Seller Transfers:</b> Transferring funds to a seller other than the one assigned to your order snapshot carries risks of delayed verification or non-recovery. Such issues require manual investigation.
              </p>
              <p>
                6.4. <b>Payment Reconciliation Support:</b> In case of a bank deduction without order credit, contact{" "}
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
              <span>7. Draw Information and Prize Conditions</span>
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
                  7.2. <b>Confirmed Draw Date &amp; Methodology:</b> The official lucky draw ceremony has a <b className="text-[#7c1619]">Confirmed Draw Date</b> on{" "}
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
              <span>8. Customer Responsibilities</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                8.1. <b>Mandatory Contact Information:</b> Customers must provide both an active, reachable WhatsApp phone number
                (including country calling code) and a valid Email address alongside their legal full name. Official digital ticket
                confirmations and scannable verification URLs are dispatched to the submitted email upon payment approval, and referenced
                via WhatsApp Click-to-Chat.
              </p>
              <p>
                8.2. <b>Security of Credentials:</b> Customers must never share their UPI PIN, OTP, banking password, or card details.
                SSFI staff and sellers will never request these sensitive credentials.
              </p>
              <p>
                8.3. <b>Authentic References &amp; Screenshots:</b> Submitting falsified, reused, or fraudulent transaction screenshots or references is strictly prohibited
                and will result in order cancellation and permanent disqualification from the campaign.
              </p>
              <p>
                8.4. <b>Verification of Payee Details:</b> Customers are responsible for verifying the seller payee name rendered on their order confirmation page prior to confirming transfers in UPI apps.
              </p>
            </div>
          </section>

          {/* Section 9 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">9</span>
              <span>9. Support and Enquiries</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                9.1. <b>Official Communications:</b> For support, transaction inquiries, or ticket confirmation assistance, contact:
              </p>
              <p className="font-semibold text-[#7c1619]">
                Email: <a href="mailto:Senthangstudents@gmail.com" className="underline">Senthangstudents@gmail.com</a>
              </p>
              <p>
                9.2. Always provide your Order Number (e.g. <code>ORD-2026-XXXXXX</code>) and customer name when contacting support.
              </p>
            </div>
          </section>

          {/* Section 10 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">10</span>
              <span>10. Changes to Campaign Information</span>
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

          {/* Section 11 - Privacy & Storage Security */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#35110f] flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7c1619] text-xs font-bold text-white">11</span>
              <span>Privacy, Screenshot Storage &amp; Data Security</span>
            </h2>
            <div className="pl-8 space-y-2 text-xs sm:text-sm">
              <p>
                11.1. <b>Protected Storage:</b> All uploaded payment screenshots and seller QR images are stored in secure, private cloud storage buckets with Row Level Security (RLS) enforcement.
              </p>
              <p>
                11.2. <b>Ephemeral Access:</b> Previews for sellers and administrators are rendered via short-lived cryptographic signed URLs (valid for 5 minutes maximum) and are never exposed publicly.
              </p>
              <p>
                11.3. <b>Data Minimization:</b> Customer contact details and payment metadata are retained solely for the purpose of verifying transactions, issuing tickets, and facilitating event-day entry.
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
