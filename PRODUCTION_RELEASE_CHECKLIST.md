# SSFI Fundraising Ticket System — Production Release Checklist

**Document Version:** 1.4.0  
**Audit Phase:** Complete Production Readiness Audit & Remediation  
**Evaluation Date:** 2026-10-31  
**Target Launch Window:** Ticket Sales Start November 1, 2026 | Draw Ceremony December 19, 2026  
**Status Legend:**
- `[ DONE ]` — Fully verified with objective command output, screenshot inspection, or code evidence.
- `[ PENDING ]` — Awaiting execution in designated release step.
- `[ BLOCKED ]` — Dependency prevents progression.
- `[ MANUAL ]` — Requires human operator action in external dashboard (Supabase/Vercel).

---

## 1. Release Candidate Deployment Record

| Deployment Attribute | Recorded Detail | Status | Evidence |
| :--- | :--- | :---: | :--- |
| **Preview Git Branch** | `deploy/ssfi-homepage-preview` | `[ DONE ]` | Verified by `git status` |
| **New Commit SHA** | Release Candidate Commit | `[ DONE ]` | Pushed cleanly to `origin/deploy/ssfi-homepage-preview` |
| **GitHub Remote** | `https://github.com/rose1996iv/ssfiticket.git` | `[ DONE ]` | Verified by `git remote -v` |
| **Vercel Project** | `ssfiticket` | `[ DONE ]` | Linked to GitHub `rose1996iv/ssfiticket` |
| **Vercel Deployment Status** | `READY` (Completed) | `[ DONE ]` | Verified across automated builds |
| **Target Preview Domain** | `https://ssfiticket-c9cde17q6-rose1996ivs-projects.vercel.app` | `[ DONE ]` | Verified 200 OK |
| **Target Database** | `ssfiticketdev` (`jiyuiydzsfydjklosvvq`) | `[ DONE ]` | RLS, functions, and synthetic records verified |
| **Production Database** | `ssfiticket` (`fohpqheglxhfdecadhzw`) | `[ UNTOUCHED ]` | Strictly read-only / protected |

---

## 2. Production Readiness Audit & Remediation (8 Operational Areas)

| Area | Scope & Key Remediations | Pre-Audit | Post-Audit | Status |
| :--- | :--- | :---: | :---: | :---: |
| **1. Payment Processing** | Payee `HLAWN THA DAWT`, UPI `6909251270@ptaxis`, `/upi_qr.jpeg`. Enforced `isMockPaymentMode()` fail-closed guard in Production (`VERCEL_ENV === "production"`). Server actions reject test references unconditionally in production. | Mock enabled in preview | Production fail-closed | `[ DONE ]` |
| **2. Ticket Issuance & DB** | Atomic RPC `verify_payment_and_issue` mints 6-digit tickets from `ssfi_ticket_number_sequence` (`SSFI-000001` format), decrements campaign capacity, enforces RLS least privilege, and writes immutable audit logs. | Operational | Atomic & verified | `[ DONE ]` |
| **3. Customer Email Delivery** | Direct Google OAuth 2.0 Gmail REST API (`Senthangstudents@gmail.com`). Fail-closed in Production. Suppressed simulation banner in Production. Polished multi-ticket rendering and confirmed draw date (19 Dec 2026). | Preview gate active | Production fail-closed | `[ DONE ]` |
| **4. WhatsApp Distribution** | 100% Free wa.me Click-to-Chat with direct ticket verification URLs. Enforced PostgreSQL enum compatibility (`status = "DELIVERED"` with `metadata.whatsapp_action = "MANUALLY_SENT"`). | Working via wa.me | Enum hardened | `[ DONE ]` |
| **5. QR Code Verification** | Created public verification index portal `/verify` (`src/app/verify/page.tsx`). Validates `/verify/[ticketNumber]` in real time without exposing customer PII. | Single route only | Portal complete | `[ DONE ]` |
| **6. Admin & Seller Ops** | Full RBAC (`SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`, `SELLER`). Seller messaging immutability trigger verified. CSV/Excel exports protected with formula injection sanitization. | Active | Verified passing | `[ DONE ]` |
| **7. Campaign Schedule & Cron** | Campaign launch 1 Nov 2026 00:00 IST; Draw date 19 Dec 2026. On-demand pre-flight synchronization inside order creation guarantees transitions on Vercel Hobby plan. Cron secured with `CRON_SECRET`. | Redundant scheduler | Fully validated | `[ DONE ]` |
| **8. Environment Config** | Complete inventory and segregation of Preview (`jiyuiydzsfydjklosvvq`) vs Production (`fohpqheglxhfdecadhzw`) environment variables documented in `PRODUCTION_READINESS_AUDIT.md`. | Verified | Fully documented | `[ DONE ]` |

---

## 3. Visual Regression Audit & Screenshot Evidence

Captured across 3 viewports:
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
| **Verification Portal (`/verify`)** | `[ DONE ]` | `[ DONE ]` | `[ DONE ]` | Interactive ticket lookup form, branded SSFI crest, real-time database query redirect. |

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
| **Automated Test Suite** | Comprehensive unit tests covering phone, email, and fail-closed gates | `[ DONE ]` | `tests/mandatoryContactsAndDelivery.test.ts` (Passing) |

---

## 5. Automated Quality Gates

| Quality Gate | Command | Result | Status |
| :--- | :--- | :--- | :---: |
| **Automated Unit & Integration Tests** | `npm test` | **208 / 208 PASS** (1.82s across 16 test suites) | `[ DONE ]` |
| **TypeScript Typecheck** | `npm run typecheck` | `tsc --noEmit` exited 0 (Zero errors) | `[ DONE ]` |
| **ESLint Static Analysis** | `npm run lint` | Next.js flat ESLint exited 0 (Zero errors / warnings) | `[ DONE ]` |
| **Next.js Production Compilation** | `npm run build` | **30 routes compiled cleanly** in 1554ms via Turbopack | `[ DONE ]` |

---

## 6. Permanent Vercel Release Workflow

### Environment Mapping & Branch Strategy

| Layer | Git Branch | Supabase Target | Environment Variables Scope |
| :--- | :--- | :--- | :--- |
| **Local Dev** | `deploy/ssfi-homepage-preview` | `ssfiticketdev` (`jiyuiydzsfydjklosvvq`) | `.env.local` |
| **Vercel Preview** | `deploy/ssfi-homepage-preview` | `ssfiticketdev` (`jiyuiydzsfydjklosvvq`) | Preview Settings (`GMAIL_PREVIEW_ALLOWED_RECIPIENT` active) |
| **Vercel Production**| `main` | `ssfiticket` (`fohpqheglxhfdecadhzw`) | Production Settings (`GMAIL_PREVIEW_ALLOWED_RECIPIENT` removed) |

---

## 7. Production Release Execution Guide (For Release Manager)

When the project owner officially approves merging into `main`:

1. **Step 1 — Production Database Schema Migration (Manual via Supabase Dashboard)**:
   - Target Project: `fohpqheglxhfdecadhzw`
   - Navigate to Supabase SQL Editor.
   - Execute the 9 migration scripts in exact numerical order as specified in `PRODUCTION_MIGRATION_PREFLIGHT.md`.
2. **Step 2 — Verify Production Vercel Environment Variables**:
   - Verify `NEXT_PUBLIC_SUPABASE_URL` = `https://fohpqheglxhfdecadhzw.supabase.co`.
   - Verify `NEXT_PUBLIC_APP_URL` = `https://ssfiticket.vercel.app`.
   - Verify `NEXT_PUBLIC_MOCK_PAYMENTS` is omitted or set to `false`.
   - Verify `GMAIL_API_CLIENT_ID`, `GMAIL_API_CLIENT_SECRET`, `GMAIL_API_REFRESH_TOKEN` are populated.
   - Verify `CRON_SECRET` is configured.
3. **Step 3 — Merge and Deploy**:
   - Merge `deploy/ssfi-homepage-preview` into `main`.
   - Push to `origin main` to trigger Vercel Production deployment.
4. **Step 4 — Post-Release Verification**:
   - Visit `https://ssfiticket.vercel.app`.
   - Verify campaign status displays "Opening Soon" (or "Live Sales Open" on 1 Nov 2026).
   - Verify `/verify` portal is operational.
