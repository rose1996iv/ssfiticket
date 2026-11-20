# SSFI Lucky Draw — Phase 1: Email Automation Implementation Report

**Date:** 2026-11-20  
**Repository:** `F:\PROJECT\Lucky Draw`  
**Branch:** `preview/production-mirror` (base HEAD `58c3c0154f892a48acf736629bf659579806fbcf`, local uncommitted changes only)  
**Target Environment:** Preview ONLY — Supabase Project `jiyuiydzsfydjklosvvq`  
**Approved Test Recipient:** `robinsonjoseph.va@gmail.com`  
**Verdict:** **`CONDITIONAL PASS`**

> **Why `CONDITIONAL PASS` (and not unconditional `PASS`)?**  
> All code fixes, unit tests (`433 / 433`), TypeScript checks (`0` errors), HMAC authentication checks, Preview allowlist guards, duplicate-prevention checks (`23505`), retry state transitions (`QUEUED → RETRY → SENT`), verification URL reachability (`HTTP 200`), local QR PNG generation, and live Preview email dispatch to `robinsonjoseph.va@gmail.com` **PASSED**.  
> However, per the Phase 1 safety boundary ("No Git commit/push or Vercel deployment without separate authorization"), the new public QR image endpoint (`src/app/api/tickets/[ticketNumber]/qr/route.ts`) has **not yet been deployed to Vercel Preview**. Consequently, the `<img src="https://ssfiticket-git-preview-production-mirror-.../api/tickets/SSFI-000063/qr">` image embedded in the delivered test email will return `404` in Gmail Inbox until this route is deployed to Preview and visually confirmed in `robinsonjoseph.va@gmail.com`'s inbox.

---

## 1. Step 1 — Quick Audit Summary

Audited existing components without rewriting working infrastructure:

| Component | File(s) Inspected | Audit Result |
|---|---|---|
| **Email Outbox & Queue** | `src/lib/delivery/outbox.ts` | Working DB-backed outbox (`customer_email_outbox`) with `idempotency_key` unique constraint, exponential backoff retries, and delivery status tracking. Found two race/safety gaps: (1) concurrent `SENDING` in-flight jobs and `23505` unique-constraint insert races were not handled gracefully in `enqueueCustomerEmail` / `processEmailJob`; (2) `options?.forceLive` could bypass the Preview/Dev recipient allowlist guard. |
| **Google Apps Script Provider** | `src/lib/delivery/providers/appsScript.ts` | Working HMAC-SHA256 signed webhook client with `HEALTHY` health check (`remainingDailyQuota: 100` at 2026-11-20 22:02 IST) and Preview allowlist simulation for non-tester addresses. |
| **Ticket Issuance Trigger** | `src/lib/delivery/outbox.ts`, `src/server/actions/operations.ts`, `src/server/actions/tickets.ts` | Verified safe: `enqueueTicketsIssuedNotification` requires payment approval (`verified_at` or `status === "TICKETS_ISSUED"`) AND at least one active `ISSUED`/`ACTIVE` ticket, and is invoked only after ticket issuance completes. |
| **Email Templates** | `src/lib/delivery/templates.ts` | Verified ticket number and `/verify/<ticketNumber>` link were present, but **QR code was missing** from `renderEmailTicketMessage`. Gmail strips `data:image/png;base64,...` inline images, requiring a public HTTPS PNG QR endpoint. |
| **Verification Page & URL Config** | `src/lib/config/appUrl.ts`, `src/app/verify/[ticketNumber]/page.tsx` | Verified `getTicketVerificationUrl` resolves cleanly against the Preview base URL and `/verify/SSFI-000063` returns `HTTP 200` on Preview. |
| **Preview Configuration** | `.env.local`, Vercel Preview env list (`npx vercel env ls preview`) | Required non-secret configuration and Apps Script provider environment keys confirmed present (no secret values inspected or logged). |

---

## 2. Step 2 — Implemented Fixes (4 Files)

Only verified gaps required for reliable Preview email delivery were fixed:

1. **`src/app/api/tickets/[ticketNumber]/qr/route.ts`** *(New)*
   - Public, PII-free `GET` endpoint returning a PNG QR code (`Content-Type: image/png`, `Cache-Control: public, max-age=86400, immutable`, `X-Content-Type-Options: nosniff`).
   - Strictly validates `ticketNumber` against `/^[A-Z0-9-]{4,32}$/`.
   - Encodes `getTicketVerificationUrl(cleanNumber, baseUrl)` via `QRCode.toBuffer` so Gmail reliably renders the QR code over HTTPS without inline `data:` URIs.

2. **`src/lib/delivery/templates.ts`** *(Modified)*
   - Updated `renderEmailTicketMessage` to embed `<img src="${baseUrl}/api/tickets/${encodedNum}/qr" alt="Verification QR Code for ..." width="140" height="140" ... />` inside each ticket card alongside the ticket number and clickable `/verify/${encodedNum}` verification URL.

3. **`src/lib/delivery/outbox.ts`** *(Modified)*
   - `enqueueCustomerEmail`: Skips re-enqueueing when an existing job is actively `SENDING`, and handles concurrent PostgreSQL `23505` unique `idempotency_key` insert races by fetching and returning the existing job.
   - `processEmailJob`: Skips jobs already in `SENDING` status to prevent concurrent double-sends, and removed the `!options?.forceLive` bypass on the Preview/Dev allowlist check (`if (!isApprovedTester)`) so manual retries can never dispatch live emails to non-approved recipients in Preview.

4. **`tests/customerTransactionalEmail.test.ts`** *(Modified)*
   - Added Section 10 unit tests covering HTTPS QR image URL + verification URL rendering in `renderEmailTicketMessage`, absence of `data:image/png;base64`, and outbox `SENDING` / `23505` / Preview allowlist + QR route invariants.

---

## 3. Step 3 & Step 4 — Verification Evidence

### 3.1 Automated Build & Test Checks
- `npm run typecheck`: **PASS** (`0` TypeScript errors)
- `npm test`: **PASS** (`433 / 433` tests passed, `0` failures)

### 3.2 Live Preview End-to-End Email Verification (`jiyuiydzsfydjklosvvq`)
Executed against Preview Supabase (`jiyuiydzsfydjklosvvq`) using synthetic Preview ticket/order data and sending **only** to `robinsonjoseph.va@gmail.com`:

| Check | Result | Evidence |
|---|---|---|
| **Apps Script Health Check** | **PASS** | `HEALTHY`, `remainingDailyQuota: 100` (2026-11-20 22:02 IST) |
| **HMAC Authentication** | **PASS** | Deterministic 64-char SHA-256 HMAC verified; payload tampering detected; live Apps Script rejected invalid secret/signature with `ok: false`, `status: "UNAUTHORIZED"` |
| **Preview Allowlist Guard** | **PASS** | Non-allowlisted address (`real-customer-blocked@example.com`) returned `status: "SIMULATED"` (`provider: "google_apps_script_preview_simulated"`), zero live email sent |
| **Verification URL** | **PASS** | `https://ssfiticket-git-preview-production-mirror-rose1996ivs-projects.vercel.app/verify/SSFI-000063` returned **HTTP `200`** and rendered `SSFI-000063` |
| **QR PNG Generation** | **PASS** | Valid PNG header (`0x89 0x50 0x4E 0x47`, `2579` bytes) encoding exact Preview verification URL |
| **Duplicate Prevention** | **PASS** | Duplicate `idempotency_key` insert blocked at database layer with PostgreSQL error code **`23505`** |
| **Retry State Transition** | **PASS** | Verified safe transition `QUEUED → RETRY (attempt 1) → SENT (attempt 2)` |
| **Live Email Delivery** | **PASS** | Dispatched to `robinsonjoseph.va@gmail.com` via `google_apps_script`:<br>• Outbox Job ID: `4e182147-6b29-4429-a651-1f426fa9a123`<br>• Idempotency Key: `PHASE1_PREVIEW_TEST:2fd82555-7743-46bd-a57a-182845db93f2:1795192366462`<br>• Ticket / Order: `SSFI-000063` / `ORD-2026-000050`<br>• Provider Message ID: `gas-ORD-2026-000050-1795192367300`<br>• Final Status: **`SENT`** (`sentAt: 2026-11-20T16:32:50.047+00:00`)<br>• Template checks: `htmlContainsQrImage: true`, `htmlContainsVerifyUrl: true` |

---

## 4. Remaining Items & Conditions for Full `PASS`

1. **Authorize Preview Commit, Push & Deployment:** Deploy the 4 Phase 1 files (specifically `src/app/api/tickets/[ticketNumber]/qr/route.ts`) to Vercel Preview (`preview/production-mirror`) so `https://ssfiticket-git-preview-production-mirror-rose1996ivs-projects.vercel.app/api/tickets/SSFI-000063/qr` resolves with `HTTP 200` (`image/png`) instead of `404`.
2. **Gmail Inbox Visual Confirmation:** After Preview deployment, visually verify the delivered ticket email in `robinsonjoseph.va@gmail.com`'s Gmail Inbox (confirming ticket number, scannable QR image rendering, clickable verification link, and layout).
3. **Informational Note (Pre-existing Preview Outbox Rows):** Preview `customer_email_outbox` retains 8 older `QUEUED` and 1 `FAILED` synthetic `WINNER_ANNOUNCED` test rows from prior phases; these were intentionally left untouched to preserve existing Preview records and audit history.

---

## 5. Safety Boundaries Confirmed

- **Production (`fohpqheglxhfdecadhzw`):** Strictly untouched (zero reads or writes).
- **Recipient Restriction:** Live email sent **only** to `robinsonjoseph.va@gmail.com`; unrestricted customer delivery remains disabled and Preview allowlist bypass was hardened.
- **No Payments / Draws / Destructive Changes:** Zero payment operations, lucky draws, or modifications to existing ticket records or audit history.
- **No Secrets / PII Exposed:** No HMAC keys, Apps Script URLs, tokens, or real customer PII were logged or written.
- **No Unauthorized Release:** No Git commit, Git push, or Vercel deployment was executed.
