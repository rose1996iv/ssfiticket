# SSFI Fundraising Ticket System — Production Release Checklist

**Document Version:** 1.2.0  
**Audit Phase:** Final Preview QA, Visual Regression Audit & Permanent Workflow Validation  
**Evaluation Date:** 2026-10-31  
**Target Launch Window:** Ticket Sales Start November 1, 2026 | Draw Ceremony December 19, 2026  
**Status Legend:**
- `[ DONE ]` — Fully verified with objective command output, screenshot inspection, or code evidence.
- `[ PENDING ]` — Awaiting execution in designated release step.
- `[ BLOCKED ]` — Dependency prevents progression.
- `[ MANUAL ]` — Requires human operator action in external dashboard (Supabase/Vercel).

---

## 1. Visual Regression Audit & Screenshot Evidence (Task 1)

Captured using headless Google Chrome (`120+`) across 3 viewports:
- **Desktop:** `1440 x 900`
- **Tablet:** `768 x 1024`
- **Mobile:** `390 x 844`

| Page Inspected | Desktop (`1440x900`) | Tablet (`768x1024`) | Mobile (`390x844`) | Visual Regression Verdict |
| :--- | :---: | :---: | :---: | :--- |
| **Homepage (`/`)** | `[ DONE ]` | `[ DONE ]` | `[ DONE ]` | Clean hero, brand logo, video backdrop, prizes grid, zero layout shifts |
| **Purchase Referral (`/buy?ref=SELLER-002`)** | `[ DONE ]` | `[ DONE ]` | `[ DONE ]` | Displays resolved seller, schedule countdown, compulsory contact fields |
| **Authentication (`/login`)** | `[ DONE ]` | `[ DONE ]` | `[ DONE ]` | Official crest, credentials form, password toggle, setup guide accordion |
| **Terms & Conditions (`/terms`)** | `[ DONE ]` | `[ DONE ]` | `[ DONE ]` | Sections 1–7 verified (dates: 1 Nov 2026 / 19 Dec 2026, payee: HLAWN THA DAWT) |
| **Ticket Verification (`/verify/SSFI-000001`)** | `[ DONE ]` | `[ DONE ]` | `[ DONE ]` | High-contrast QR code (`#7c1619`), verified badge, timestamp |
| **Seller Directory (`/#sellers`)** | `[ DONE ]` | `[ DONE ]` | `[ DONE ]` | Verified active sellers (`SELLER-002`, `SELLER-003`, `SELLER-007`) rendered |

*Screenshot Storage Directory:* `C:\Users\Joseph\.gemini\antigravity\brain\f1fe0dbc-6633-4b76-b6b7-fdb3af5bbb02\screenshots\`

---

## 2. Campaign Status Inconsistency Investigation & Resolution (Task 2)

| Issue Observed | Root Cause Analysis | Code Remedy | Status |
| :--- | :--- | :--- | :---: |
| **Homepage Contradiction** ("Ticket Booking Status: ACTIVE" vs "Sales Closed or in preparation") | `src/app/(public)/page.tsx` bypassed `evaluateCampaignSchedule` and passed raw `campaign.status` (`ACTIVE`) even when `now < start_at`. | Updated `page.tsx` to use authoritative `evaluateCampaignSchedule` and pass `schedule.scheduleStatus` (`UPCOMING`). | `[ DONE ]` |
| **Purchase Page Contradiction** ("Ticket Sales Live" vs "Ticket Orders Currently Inactive") | `CampaignCountdown.tsx` line 48 artificially evaluated `referenceTime = new Date(startAt)` during SSR (`nowMs === 0`), causing SSR to evaluate as `LIVE` while `PublicOrderForm` evaluated as `UPCOMING`. | Updated `CampaignCountdown.tsx` line 49 to evaluate `referenceTime = isHydrated ? new Date(nowMs) : new Date();`. SSR and client now agree on `UPCOMING`. | `[ DONE ]` |

---

## 3. Buyer Contact Enforcement (Task 3)

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

## 4. Complete Preview Functional Verification (Task 4)

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

## 5. Permanent Vercel Release Workflow (Task 5)

### Environment Mapping & Branch Strategy

| Layer | Git Branch | Supabase Target | Environment Variables Scope |
| :--- | :--- | :--- | :--- |
| **Local Dev** | `deploy/ssfi-homepage-preview` | `ssfiticketdev` (`jiyuiydzsfydjklosvvq`) | `.env.local` |
| **Vercel Preview** | `deploy/ssfi-homepage-preview` | `ssfiticketdev` (`jiyuiydzsfydjklosvvq`) | Vercel Preview Settings (`GMAIL_PREVIEW_ALLOWED_RECIPIENT` active) |
| **Vercel Production** | `main` | `ssfiticket` (`fohpqheglxhfdecadhzw`) | Vercel Production Settings (`GMAIL_PREVIEW_ALLOWED_RECIPIENT` removed) |

### Permanent Development & Deployment Lifecycle
```
[Local / Branch Edit] ──> [Push to deploy/ssfi-homepage-preview]
                                       │
                                       ▼
                       [Vercel Automatic Preview Build]
                       (Points to ssfiticketdev Supabase)
                                       │
                                       ▼
                             [Preview QA & Approval]
                                       │
                                       ▼
                       [Manual Fast-Forward Merge to main]
                                       │
                                       ▼
                      [Vercel Automatic Production Build]
                       (Points to ssfiticket Supabase)
                                       │
                                       ▼
                          [Live Smoke Test on ssfiticket.vercel.app]
```

### Production Rollback Procedure
If an issue occurs post-release in Production:
1. **Instant Vercel Rollback:** In Vercel Project Dashboard $\rightarrow$ **Deployments**, locate the last known healthy deployment (e.g., commit `3f33f50`) and click **Instant Rollback**. Traffic is reverted in < 5 seconds.
2. **Git Rollback:** Revert `main` to the previous commit:
   ```bash
   git checkout main
   git revert HEAD -m 1 --no-edit
   git push origin main
   ```
3. **Database Rollback:** If a rollback of database DDL is ever required, execute the documented reverse statements in `PRODUCTION_MIGRATION_PREFLIGHT.md`.

---

## 6. Release Gate Readiness Summary

| Gate | Description | Status |
| :--- | :--- | :---: |
| **Visual QA** | 18 full-page screenshots across 3 viewports verified | `[ DONE ]` |
| **Status Consistency** | Single authoritative calculation (`evaluateCampaignSchedule`) applied to all views | `[ DONE ]` |
| **Buyer Contacts** | Compulsory Full Name, WhatsApp, and Email verified across UI, Zod, and DB | `[ DONE ]` |
| **Functional Suite** | 203 / 203 automated tests passing, TypeScript clean, ESLint clean, Next.js build clean | `[ DONE ]` |
| **Permanent Workflow** | Strict branch separation and environment isolation documented | `[ DONE ]` |
| **Production Migration Plan** | 9 SQL scripts ordered and preflighted in `PRODUCTION_MIGRATION_PREFLIGHT.md` | `[ DONE ]` |
| **Production Execution** | User manual snapshot backup & SQL execution in `fohpqheglxhfdecadhzw` | `[ MANUAL ]` |
