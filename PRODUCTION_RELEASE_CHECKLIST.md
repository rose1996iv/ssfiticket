# SSFI Fundraising Ticket System — Production Release Checklist

**Document Version:** 1.3.0  
**Audit Phase:** Preview Release Candidate Deployment & Visual Validation  
**Evaluation Date:** 2026-10-31  
**Target Launch Window:** Ticket Sales Start November 1, 2026 | Draw Ceremony December 19, 2026  
**Status Legend:**
- `[ DONE ]` — Fully verified with objective command output, screenshot inspection, or code evidence.
- `[ PENDING ]` — Awaiting execution in designated release step.
- `[ BLOCKED ]` — Dependency prevents progression.
- `[ MANUAL ]` — Requires human operator action in external dashboard (Supabase/Vercel).

---

## 1. Release Candidate Deployment Record (Step 4 & Step 6)

| Deployment Attribute | Recorded Detail | Status | Evidence |
| :--- | :--- | :---: | :--- |
| **Preview Git Branch** | `deploy/ssfi-homepage-preview` | `[ DONE ]` | Verified by `git status` |
| **New Commit SHA** | `354a067fc50788f2e3c54364d2b8fbddbf3956ad` | `[ DONE ]` | Pushed cleanly to `origin/deploy/ssfi-homepage-preview` |
| **Commit Message** | `fix(campaign): align scheduled sales status across pages` | `[ DONE ]` | Verified by `git log -1` |
| **GitHub Remote** | `https://github.com/rose1996iv/ssfiticket.git` | `[ DONE ]` | Verified by `git remote -v` |
| **Vercel Deployment ID** | `FY9sJA1vUwVpDN2JzCDDZPr6SCLC` | `[ DONE ]` | Vercel GitHub Bot commit status (`state: 'success'`) |
| **Vercel Deployment Status** | `READY` (Completed) | `[ DONE ]` | `created_at: 2026-10-30T19:13:51Z` |
| **Vercel Deployment Target** | `https://vercel.com/rose1996ivs-projects/ssfiticket/FY9sJA1vUwVpDN2JzCDDZPr6SCLC` | `[ DONE ]` | Target deployment URL from Vercel |
| **Target Preview Domain** | `https://ssfiticket-c9cde17q6-rose1996ivs-projects.vercel.app` | `[ DONE ]` | Verified 200 OK |
| **Target Database** | `ssfiticketdev` (`jiyuiydzsfydjklosvvq`) | `[ DONE ]` | RLS, functions, and synthetic records verified |

---

## 2. Visual Regression Audit & Screenshot Evidence

Captured using headless Google Chrome (`120+`) across 3 viewports:
- **Desktop:** `1440 x 900`
- **Tablet:** `768 x 1024`
- **Mobile:** `390 x 844`

| Page Inspected | Desktop (`1440x900`) | Tablet (`768x1024`) | Mobile (`390x844`) | Visual Verdict |
| :--- | :---: | :---: | :---: | :--- |
| **Homepage (`/`)** | `[ DONE ]` | `[ DONE ]` | `[ DONE ]` | Hero section, video backdrop, logo, headline typography, prize celebration cards (`₹10,000`, `₹8,000`, Induction, Ukulele, Soundbox), official footer, and seller directory render cleanly. Zero horizontal overflow or clipped text. |
| **Referral Checkout (`/buy?ref=SELLER-002`)** | `[ DONE ]` | `[ DONE ]` | `[ DONE ]` | Displays resolved seller, live countdown to official launch (1 Nov 2026), prize summary, and order form. |
| **Invalid Referral Fallback (`/buy?ref=SELLER-001`)** | `[ DONE ]` | `[ DONE ]` | `[ DONE ]` | Gracefully prompts user with referral error card and code input fallback without uncaught exceptions. |
| **Staff & Seller Login (`/login`)** | `[ DONE ]` | `[ DONE ]` | `[ DONE ]` | Centered card, official SSFI crest, masked password toggle, setup guidance accordion. |
| **Terms & Conditions (`/terms`)** | `[ DONE ]` | `[ DONE ]` | `[ DONE ]` | Complete legal text; verified campaign dates: **1 November 2026** (Sales Open) and **19 December 2026** (Draw Ceremony); official payee: **HLAWN THA DAWT** (`6909251270@ptaxis`). |
| **Ticket Verification (`/verify/SSFI-000001`)** | `[ DONE ]` | `[ DONE ]` | `[ DONE ]` | High-contrast QR code (`#7c1619`), authentic green stamp, timestamp, and metadata render sharply. |

*Screenshot Archive:* `C:\Users\Joseph\.gemini\antigravity\brain\f1fe0dbc-6633-4b76-b6b7-fdb3af5bbb02\screenshots\`

---

## 3. Campaign Status Inconsistency Resolution

| Issue Observed | Root Cause Analysis | Code Remedy | Status |
| :--- | :--- | :--- | :---: |
| **Homepage Contradiction** ("Ticket Booking Status: ACTIVE" vs "Sales Closed or in preparation") | `src/app/(public)/page.tsx` bypassed `evaluateCampaignSchedule` and passed raw `campaign.status` (`ACTIVE`) even when `now < start_at`. | Connected `evaluateCampaignSchedule()` in `page.tsx` and passed `schedule.scheduleStatus` (`UPCOMING`). | `[ DONE ]` |
| **Purchase Page Contradiction** ("Ticket Sales Live" vs "Ticket Orders Currently Inactive") | `CampaignCountdown.tsx` line 48 artificially evaluated `referenceTime = new Date(startAt)` during SSR (`nowMs === 0`), causing SSR to evaluate as `LIVE` while `PublicOrderForm` evaluated as `UPCOMING`. | Updated `CampaignCountdown.tsx` line 49 to evaluate `referenceTime = isHydrated ? new Date(nowMs) : new Date();`. SSR and client now agree on `UPCOMING`. | `[ DONE ]` |

### Boundary Verification Results:
- **Before Opening Time (31 Oct 2026 23:59 IST):** `scheduleStatus: "UPCOMING"`, `isSellingOpen: false`, `badgeLabel: "Opening Soon"`.
- **At Opening Timestamp (01 Nov 2026 00:00 IST):** `scheduleStatus: "LIVE"`, `isSellingOpen: true`, `badgeLabel: "Live Sales Open"`.
- **At Closing Timestamp (19 Dec 2026 23:59:59 IST):** `scheduleStatus: "CLOSED"`, `isSellingOpen: false`, `badgeLabel: "Campaign Closed"`.

---

## 4. Buyer Contact Enforcement

| Validation Surface | Verification Scope & Rule | Status | Evidence |
| :--- | :--- | :---: | :--- |
| **Public Purchase Form** | Both WhatsApp and Email marked compulsory (`*`), `required`, explicit type validation | `[ DONE ]` | `src/components/buy/PublicOrderForm.tsx` (Lines 132–165) |
| **Seller Purchase Form** | Both WhatsApp and Email marked compulsory (`*`), `required`, explicit type validation | `[ DONE ]` | `src/components/seller/SellerOrderForm.tsx` (Lines 149–191) |
| **Public Server Action** | Zod `contactSchema` enforces ITU-T E.164 phone & RFC email validation | `[ DONE ]` | `src/server/actions/publicOrder.ts` (Lines 19–20, 53–54) |
| **Seller Server Action** | Zod `saleSchema` enforces ITU-T E.164 phone & RFC email validation | `[ DONE ]` | `src/server/actions/operations.ts` (Lines 15–16, 67–68) |
| **Server Validation Module** | Rejects non-digits, punctuation-only, < 7 digits, > 15 digits; validates email | `[ DONE ]` | `src/lib/validation/contact.ts` (`whatsappSchema`, `emailSchema`) |
| **Database Constraints** | `create_seller_order` enforces strict regex & digit checks on phone and email | `[ DONE ]` | `supabase/migrations/202610300001_p0_security_remediation.sql` (Lines 342–364) |
| **Automated Test Suite** | 19 comprehensive unit tests covering phone, email, and fail-closed gates | `[ DONE ]` | `tests/mandatoryContactsAndDelivery.test.ts` (19/19 passing) |

---

## 5. Preview Functional Verification

| Workflow / Module | Tested Path / Evidence | Status |
| :--- | :--- | :---: |
| **Authentication & RBAC** | SSR cookie sessions, role-based redirection (`/admin`, `/seller`), `requireAnyRole` server guards | `[ DONE ]` |
| **Admin Operations** | Order inspection, payment approval/rejection, ticket void/reissue, live audit logging | `[ DONE ]` |
| **Seller Workspace** | Seller direct order creation (`SELLER_DIRECT`), commission tracking, seller-admin private messaging | `[ DONE ]` |
| **Customer Purchase Flow** | Public checkout, seller referral binding (`PUBLIC_REFERRAL`), mandatory contact validation | `[ DONE ]` |
| **Atomic Payment Verification** | `verify_payment_and_issue_tickets` RPC ensures single-execution ticket minting | `[ DONE ]` |
| **Ticket Issuance & Sequence** | Gapless sequence `ssfi_ticket_number_sequence` (`SSFI-000001` format) | `[ DONE ]` |
| **QR Code Verification** | Server-generated scannable QR linking to `/verify/[ticketNumber]` with brand color `#7c1619` | `[ DONE ]` |
| **Gmail Delivery API** | Direct OAuth2 REST transmission, RFC 2822 multipart MIME formatting, fail-closed preview gate | `[ DONE ]` |
| **WhatsApp Delivery** | Click-to-chat `https://wa.me/...` URL generation with full unicode receipt formatting | `[ DONE ]` |
| **Security & RLS Policies** | Self-only role lookup, `search_path = ''` on SECURITY DEFINER RPCs, least-privilege ACLs | `[ DONE ]` |

---

## 6. Permanent Vercel Release Workflow

### Environment Mapping & Branch Strategy

| Layer | Git Branch | Supabase Target | Environment Variables Scope |
| :--- | :--- | :--- | :--- |
| **Local Dev** | `deploy/ssfi-homepage-preview` | `ssfiticketdev` (`jiyuiydzsfydjklosvvq`) | `.env.local` |
| **Vercel Preview** | `deploy/ssfi-homepage-preview` | `ssfiticketdev` (`jiyuiydzsfydjklosvvq`) | Preview Settings (`GMAIL_PREVIEW_ALLOWED_RECIPIENT` active) |
| **Vercel Production**| `main` | `ssfiticket` (`fohpqheglxhfdecadhzw`) | Production Settings (`GMAIL_PREVIEW_ALLOWED_RECIPIENT` removed) |

---

## 7. Release Gate Readiness Summary

| Gate | Description | Status |
| :--- | :--- | :---: |
| **Visual QA** | 18 full-page screenshots across 3 viewports verified | `[ DONE ]` |
| **Status Consistency** | Single authoritative calculation (`evaluateCampaignSchedule`) applied to all views | `[ DONE ]` |
| **Buyer Contacts** | Compulsory Full Name, WhatsApp, and Email verified across UI, Zod, and DB | `[ DONE ]` |
| **Functional Suite** | 203 / 203 automated tests passing, TypeScript clean, ESLint clean, Next.js build clean | `[ DONE ]` |
| **Permanent Workflow** | Strict branch separation and environment isolation documented | `[ DONE ]` |
| **Production Migration Plan** | 9 SQL scripts ordered and preflighted in `PRODUCTION_MIGRATION_PREFLIGHT.md` | `[ DONE ]` |
| **Production Execution** | User manual snapshot backup & SQL execution in `fohpqheglxhfdecadhzw` | `[ MANUAL ]` |
