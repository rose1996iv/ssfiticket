# SSFI Lucky Draw — Phase 9F System-wide Security & Production Readiness Audit

**Audit Date:** 2026-11-08T17:50:00+05:30  
**Lead Auditor:** Antigravity Autonomous Security & Verification Suite  
**Audit Scope:** Comprehensive 12-Domain Pre-Production Security and Integrity Audit  
**Target Repository:** `https://github.com/rose1996iv/ssfiticket`  
**Git Branch:** `preview/production-mirror` (Commit `2f3ce76` + Phase 8C.1 & Phase 9 workspace changes)  
**Preview Supabase Project:** `jiyuiydzsfydjklosvvq` (`db.jiyuiydzsfydjklosvvq.supabase.co`) — **READ-ONLY AUDITED**  
**Production Supabase Project:** `fohpqheglxhfdecadhzw` — **AIR-GAPPED — STRICTLY ZERO CONTACT**  
**Final Audit Verdict:** **READY FOR PREVIEW UAT** *(Production Release: **BLOCKED BY RSK-01**)*

---

## 1. Executive Summary

Following the successful completion of **Phase 9E (Full Lucky Draw Workflow Verification)** and **Phase 9D.3 (Winner Notification Integration)**, a comprehensive, evidence-based, system-wide security and production readiness audit was performed across the entire SSFI Lucky Draw Application.

The audit rigorously evaluated the application source code, API routes, Server Actions, authorization boundaries, client/server interfaces, database Row Level Security (RLS) policies, database triggers, stored procedures, cryptographic randomness engines, rate limiters, storage bucket permissions, transactional email queues, and disaster recovery preparations across **12 defined audit domains**.

### Key Audit Conclusions

1. **Preview Environment Health & Stability:**  
   The Preview environment (`jiyuiydzsfydjklosvvq`) is completely configured, verified, and hardened. All 28 database tables enforce active Row Level Security (`rowsecurity = true`). All sensitive stored procedures are configured with `SECURITY DEFINER`, strict `search_path`, and have `EXECUTE` privileges revoked from `PUBLIC`, `anon`, and `authenticated` (granted exclusively to `service_role`). All 402 automated unit and integration tests pass cleanly (100% success rate), TypeScript compiles with zero errors (`tsc --noEmit`), and ESLint passes with zero warnings. The Preview environment is fully verified and **READY FOR PREVIEW UAT**.

2. **Production Release Status (Strict Blocker):**  
   While the application code is production-ready, **Production Supabase (`fohpqheglxhfdecadhzw`) cannot accept application traffic in its current state**. Production Supabase lacks 10 tables (5 from Phases 6–8, 5 from Phase 9), 25+ columns, 2 private storage buckets, 7 security triggers, updated sequence limits, and hardened stored procedures. Deploying the application to Production without prior database migration will cause immediate runtime exceptions across all order, payment, and draw flows (**RSK-01**).

3. **Remediation Provenance:**  
   The critical transactional email defect identified in Phase 8C (**RSK-02**: central UPI fallback in `ORDER_CREATED` emails) remains comprehensively remediated in `src/lib/delivery/outbox.ts` and `src/lib/delivery/templates.ts`, binding only immutable seller snapshot credentials and validated by 5 regression test suites.

---

## 2. Audit Scope & Methodology

### 2.1 Environmental Boundaries & Safety Rules
- **Preview Project (`jiyuiydzsfydjklosvvq`):** Audited via strictly read-only SQL queries (`BEGIN TRANSACTION READ ONLY; SET ROLE postgres; ... ROLLBACK;`) executed through `psql.exe` using credentials dynamically extracted via `supabase db dump --dry-run`. Zero mutations executed.
- **Production Project (`fohpqheglxhfdecadhzw`):** Maintained under strict air-gap isolation. Zero network connections, zero API queries, and zero database connections were established with the Production Supabase project.
- **Version Control:** Branch `preview/production-mirror`. Zero commits, pushes, merges, or deployments were performed. All uncommitted Phase 8C.1 files were preserved intact.
- **Email Safety:** Master gate `customer_email_live_enabled = false` in `system_settings` remained enforced. Zero live customer emails dispatched.

### 2.2 Quality Gates Baseline

```
Quality Gate                  Command                Result
-------------------------------------------------------------------------
Automated Test Suites         npm test               PASS (402/402 tests pass, 29 suites)
TypeScript Compilation        npx tsc --noEmit       PASS (0 errors)
ESLint Static Analysis        npm run lint           PASS (0 errors, 0 warnings)
Database RLS Inspection       pg_tables (Preview)    PASS (28/28 public tables RLS enabled)
Storage Bucket Exposure       storage.buckets        PASS (2 private buckets, 0 public)
Routine Access Control        routine_privileges     PASS (0 public EXECUTE on sensitive RPCs)
```

---

## 3. Comprehensive Domain-by-Domain Audit Findings

```
+-------------------------------------------------------------------------------+
| DOMAIN 1: AUTHENTICATION & SESSION MANAGEMENT                                  |
| Status: PASS                                                                  |
+-------------------------------------------------------------------------------+
```
- **Session Architecture:** Implemented via Supabase Auth with `@supabase/ssr` cookies in Next.js App Router Server Components, Server Actions, and Route Handlers.
- **Cookie Security:** Cookies are configured with `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` (in production/preview environments).
- **Token Verification:** User resolution via `getCurrentUser()` invokes `supabase.auth.getUser()`, which validates the cryptographic JWT against the Supabase Auth server, completely rejecting forged local authorization headers.
- **Login Flow (`src/server/actions/auth.ts`):** Validates email and password using Zod schema. Evaluates roles server-side via `has_role` RPC. Deactivated sellers (`is_active = false`) are rejected immediately, signed out, and denied session generation.
- **Redirect Security:** Login targets are hardcoded (`/admin`, `/seller`, `/unauthorized`). No untrusted redirect parameters are accepted, eliminating Open Redirect vulnerabilities.

```
+-------------------------------------------------------------------------------+
| DOMAIN 2: RBAC, RLS, AND SERVER ACTIONS AUTHORIZATION                         |
| Status: PASS                                                                  |
+-------------------------------------------------------------------------------+
```
- **Role Hierarchy:** System strictly defines 5 roles: `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`, `SELLER`, and `CUSTOMER` (plus unauthenticated `ANONYMOUS`).
- **Layout Route Guards:**
  - `src/app/admin/layout.tsx`: Strictly guarded by `requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"])`. Unauthenticated callers redirected to `/login`; unauthorized roles redirected to `/unauthorized`.
  - `src/app/seller/layout.tsx`: Strictly guarded by `requireRole("SELLER")` and validates `seller.is_active`.
- **Server Action Protection:**
  - Administrative actions resolve caller identity strictly via `requireAuth()` or `requireAnyRole()`. Untrusted client parameters are completely ignored for actor attribution.
  - Critical actions (customer PII modification, manual draw exclusions, snapshot locking, 1st prize approval, draw execution, winner notification dispatch) require `["SUPER_ADMIN", "ADMIN"]`, excluding `FUNDRAISING_MANAGER` and `SELLER`.
  - Screenshot downloads are strictly restricted to `SUPER_ADMIN`.
- **Database Row Level Security (RLS):**
  - **100% Table Coverage:** All 28 public tables have `rowsecurity = true` in PostgreSQL catalog.
  - **Direct PostgREST Isolation:** Direct anonymous queries to `customers`, `orders`, `tickets`, `customer_email_outbox`, `audit_logs`, `payment_recovery_tokens`, `system_settings`, `draw_approvals`, and `draw_randomness_evidence` return 0 rows.
- **Stored Procedures Security:**
  - 43 routines defined in `public` schema.
  - All critical business routines (`verify_payment_and_issue`, `issue_tickets`, `execute_draw_winner_selection`, `admin_lock_eligibility_snapshot`, `admin_request_first_prize_approval`, `admin_record_first_prize_approval`, `admin_stamp_winner_notification`, `create_seller_order`) are configured with `SECURITY DEFINER` and hardened `search_path = ''` (or `search_path = public`).
  - `EXECUTE` privileges revoked from `PUBLIC`, `anon`, and `authenticated`; granted exclusively to `service_role`.

```
+-------------------------------------------------------------------------------+
| DOMAIN 3: CUSTOMER, SELLER, ADMIN, FUNDRAISING_MANAGER, & SUPER_ADMIN ROLES  |
| Status: PASS                                                                  |
+-------------------------------------------------------------------------------+
```
- **Boundary Verification:**
  - **Customer:** Has zero login privileges; interactions governed by 256-bit CSPRNG order access tokens (`payment_recovery_tokens`) with mode separation (`READ` vs `WRITE`).
  - **Seller:** Cannot access `/admin/*` routes; cannot view or download payment screenshots; cannot verify payments or mint tickets; cannot activate their own payment QR (`is_qr_active = false` on upload; requires Admin approval); reviews are strictly advisory (`RECOMMENDED_APPROVAL`, `RECOMMENDED_REJECTION`, `FLAGGED_DISCREPANCY`). Cross-seller IDOR prevented by server-side order ownership verification.
  - **Fundraising Manager:** Can view dashboard, orders, payments, sellers, and draw overview, but CANNOT download payment screenshots, CANNOT edit customer profiles/tickets, and CANNOT execute lucky draw winner selections.
  - **Admin:** Authoritative operations: payment verification, ticket issuance, seller management, draw snapshot locking, 1st prize approval (subject to dual-control), draw execution, and winner notification dispatch. Cannot download screenshots.
  - **Super Admin:** Highest privilege tier; sole role authorized to execute payment screenshot downloads (`executeDownloadPaymentScreenshot`).

```
+-------------------------------------------------------------------------------+
| DOMAIN 4: PAYMENT SCREENSHOT UPLOAD AND VERIFICATION                          |
| Status: PASS                                                                  |
+-------------------------------------------------------------------------------+
```
- **Upload Validation:** `validatePaymentScreenshot` enforces magic-byte inspection (validating true JPEG, PNG, or WebP byte signatures), 2MB file size cap, and MIME validation.
- **Storage Isolation:** Uploads stored in private bucket `payment-screenshots` (`public = false`) using random UUID keys (`${crypto.randomUUID()}.${extension}`).
- **Access Control:**
  - Viewing: 5-minute signed URL generated for authorized staff (`SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`) for inline browser preview.
  - Downloading: Restricted exclusively to `SUPER_ADMIN` with a 60-second signed URL and structured audit log emission.
  - Filename Sanitization: Downloads named strictly `{ORDER_NUMBER}.{ext}` (e.g. `ORD-2026-000042.png`), stripping customer PII.
  - Replay / Replacement Protection: Once payment status is `VERIFIED` or `REFUNDED`, screenshot replacement is rejected at server and database layers.

```
+-------------------------------------------------------------------------------+
| DOMAIN 5: SELLER-OWNED UPI QR & IMMUTABLE PAYMENT DESTINATION SNAPSHOTS       |
| Status: PASS                                                                  |
+-------------------------------------------------------------------------------+
```
- **Decentralized Seller Routing:** Orders capture seller payment credentials at reservation time (`snapshot_seller_id`, `snapshot_seller_code`, `snapshot_seller_display_name`, `snapshot_qr_storage_path`, `snapshot_upi_id`, `snapshot_account_name`, `snapshot_payment_instructions`).
- **Zero Central Fallback in UI:** If a seller's payment QR is unconfigured or inactive, the checkout page renders *"Seller Payment QR Unavailable"* and never exposes central organization accounts.
- **Snapshot Immutability Trigger:** Trigger `trg_protect_order_payment_snapshot` executing `protect_order_payment_snapshot()` unconditionally raises SQLSTATE `P0001` on any UPDATE to any snapshot column once captured.
- **Seller QR Governance:** Uploading or replacing a QR resets `is_qr_active = false`. Sellers cannot self-activate. Admin activation (`adminActivateSellerPaymentQr`) requires active seller, valid QR path, and valid UPI ID.

```
+-------------------------------------------------------------------------------+
| DOMAIN 6: TICKET ISSUANCE AND PUBLIC VERIFICATION                             |
| Status: PASS                                                                  |
+-------------------------------------------------------------------------------+
```
- **Sequence Capacity:** `ssfi_ticket_number_sequence` upgraded to `MAXVALUE 999999` (verified in Preview; last_value = 44).
- **Issuance Engine:** `verify_payment_and_issue` executes atomically in a single PostgreSQL transaction: verifies payment is `SUBMITTED`, updates payment to `VERIFIED`, transitions order to `TICKETS_ISSUED`, fetches sequence numbers, inserts ticket records, and enqueues outbox records.
- **Identity Immutability:** Trigger `trg_protect_ticket_identity_immutability` blocks any UPDATE on `id`, `ticket_number`, `order_id`, `campaign_id`, `customer_id`, `seller_id`, or `issued_at`.
- **Public Verification (`/verify/[ticketNumber]`):**
  - Selects only public metadata: `ticket_number`, `status`, `issued_at`, `void_reason`, `campaigns(name)`. Customer PII is completely omitted.
  - Environment Isolation: In Production runtime (`VERCEL_ENV === "production"`), tickets with prefix `PRV-` are unconditionally rejected.

```
+-------------------------------------------------------------------------------+
| DOMAIN 7: RATE LIMITING, ACCESS TOKENS, REPLAY PREVENTION, & ABUSE PROTECTION  |
| Status: PASS WITH CONDITIONS (Upstash Redis Required in Production)           |
+-------------------------------------------------------------------------------+
```
- **Order Access Tokens (`orderAccessToken.ts`):**
  - Generated via 256-bit CSPRNG (`crypto.randomBytes(32)`), stored exclusively as SHA-256 digest in `public.payment_recovery_tokens`.
  - Constant-time comparison `safeCompareHexDigests` using `crypto.timingSafeEqual`.
  - Mode Separation: `READ` (viewing order and tickets) vs `WRITE` (uploading payment proof). Once payment is submitted, `CONSUME_WRITE` sets `write_consumed_at = now()`, permanently revoking write privileges while preserving customer read access.
- **Rate Limiting (`rateLimit.ts`):**
  - Enforces 10 attempts per IP/order and 30 attempts per order globally over a 15-minute sliding window.
  - Hashed client IP with salt (`RATE_LIMIT_SALT`).
  - **Risk Finding (RSK-03):** When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are unconfigured, rate limiting falls back to an in-memory `Map`. In serverless runtime environments (Vercel), in-memory state is isolated to individual containers and resets on cold starts.
  - **Risk Finding (RSK-04):** `getClientIpFromHeaders` inspects `x-forwarded-for.split(",")[0]`. On Vercel, client could prepend an arbitrary IP header. Should inspect `x-vercel-forwarded-for` or take edge-verified IP.

```
+-------------------------------------------------------------------------------+
| DOMAIN 8: STORAGE BUCKET POLICIES AND PRIVATE FILE ACCESS                     |
| Status: PASS                                                                  |
+-------------------------------------------------------------------------------+
```
- **Bucket Inventory (Preview Catalog Inspection):**
  - `payment-screenshots`: `public = false`, 2MB file size limit, `{image/jpeg, image/png, image/webp}`.
  - `seller-payment-qrs`: `public = false`, 2MB file size limit, `{image/jpeg, image/png, image/webp}`.
  - Total public buckets: **0**.
- **Access Mechanism:** Storage objects are private. All reads are mediated by server-side signed URLs with strict TTLs (60s for download, 300s for view). Direct anonymous or authenticated download via PostgREST/Storage API is blocked.

```
+-------------------------------------------------------------------------------+
| DOMAIN 9: CUSTOMER EMAIL OUTBOX, IDEMPOTENCY, RETRIES, & FAILURE HANDLING     |
| Status: PASS                                                                  |
+-------------------------------------------------------------------------------+
```
- **Outbox Pattern:** All transactional emails are persisted to `public.customer_email_outbox` prior to dispatch.
- **Check Constraint:** `customer_email_outbox_event_type_check` verified in Preview to permit exactly five event types: `ORDER_CREATED`, `PAYMENT_APPROVED`, `TICKETS_ISSUED`, `ADMIN_TEST`, `WINNER_ANNOUNCED`.
- **Idempotency Keys:** Unique deterministic keys (`WINNER_ANNOUNCED:${resultId}`, `ORDER_CREATED:${orderId}`, `PAYMENT_APPROVED:${orderId}`, `TICKETS_ISSUED:${orderId}`). Once a record is `SENT` or `SIMULATED`, it is never re-dispatched.
- **Dual Safety Gates:**
  - Master Gate: `customer_email_live_enabled = false` in `system_settings`. Live emails remain held in `QUEUED` unless explicitly toggled by an administrator with confirmation phrase `CONFIRM_ENABLE_LIVE_EMAIL`.
  - Non-Production Gate: In development/preview, emails to non-approved recipients are marked `SIMULATED` and never dispatched to providers.
- **Provider Protocol:** Google Apps Script Web App with HMAC-SHA256 signature (`timestamp.idempotencyKey.recipient`) and 6-hour deduplication cache.
- **Snapshot Binding (RSK-02 Remediation):** In `ORDER_CREATED` notifications, seller snapshot fields (`snapshot_upi_id`, `snapshot_account_name`, `snapshot_payment_instructions`) are bound directly without central fallback.

```
+-------------------------------------------------------------------------------+
| DOMAIN 10: LUCKY DRAW SECURITY AND RANDOMNESS INTEGRATION                     |
| Status: PASS                                                                  |
+-------------------------------------------------------------------------------+
```
- **Architecture:** Verified across Phases 9A–9E. 5 dedicated tables (`draw_manual_exclusions`, `draw_eligibility_snapshots`, `draw_snapshot_tickets`, `draw_approvals`, `draw_randomness_evidence`) plus `draws` and `draw_results`.
- **Dual Control (Policy A):** 1st prize draw requires separate initiator and approver (`initiator_id <> approver_id` database check constraint `draw_approvals_distinct_actors`). Self-approval and execution without approval are blocked by database trigger and stored procedure guards.
- **Prize Sequence & Winner Uniqueness:** Strict 5th -> 4th -> 3rd -> 2nd -> 1st prize sequence. Previous winners cannot win subsequent prizes in the same campaign (`draw_results_campaign_ticket_unique` constraint).
- **Provable Randomness:** Commit-reveal scheme using CSPRNG server seed commitment (SHA-256), client entropy, and SHA-256 combined seed (`sha256(server_seed_revealed || client_seed || snapshot_hash)`). Deterministic winner selection verified with independent tamper detection in Phase 9E.
- **Immutability:** Triggers unconditionally block updates and deletes on results, snapshots, snapshot tickets, and evidence records.

```
+-------------------------------------------------------------------------------+
| DOMAIN 11: PRODUCTION ENVIRONMENT VARIABLES & FAIL-CLOSED CONFIGURATION       |
| Status: PASS WITH CONDITIONS (Production Vercel Provisioning Required)         |
+-------------------------------------------------------------------------------+
```
- **Fail-Closed Guards in Code:**
  - Mock payments permanently disabled if `VERCEL_ENV === "production"`.
  - Cron schedule synchronization strictly returns 500 error if `CRON_SECRET` is missing in production, and 401 if unauthorized.
  - Public ticket verification strictly rejects `PRV-` tickets in production.
  - Master email gate defaults to `customer_email_live_enabled = false`.
- **Mandatory Production Environment Variables:**
  - `NEXT_PUBLIC_SUPABASE_URL`: Must point to `https://fohpqheglxhfdecadhzw.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Production Supabase anon key
  - `SUPABASE_SERVICE_ROLE_KEY`: Production Supabase service role key
  - `APP_BASE_URL` / `NEXT_PUBLIC_APP_URL`: Canonical production domain (e.g. `https://ssfiticket.vercel.app`)
  - `CRON_SECRET`: 32+ character high-entropy secret
  - `APPS_SCRIPT_WEB_APP_URL`: Deployed Google Apps Script Web App endpoint
  - `APPS_SCRIPT_SHARED_SECRET`: 32+ character HMAC shared secret
  - `UPSTASH_REDIS_REST_URL` & `UPSTASH_REDIS_REST_TOKEN`: Upstash Redis instance
  - `RATE_LIMIT_SALT`: Dedicated salt for IP hashing
  - `NEXT_PUBLIC_MOCK_PAYMENTS`: `false`

```
+-------------------------------------------------------------------------------+
| DOMAIN 12: OUTSTANDING PHASE 8C PRODUCTION READINESS FINDINGS                 |
| Status: RSK-01 BLOCKER ACTIVE; RSK-02 RESOLVED; RSK-03/04/05/06 TRACKED        |
+-------------------------------------------------------------------------------+
```
- **RSK-01 (CRITICAL — Production Database Schema Gap):** **ACTIVE PRODUCTION RELEASE BLOCKER**. Production Supabase lacks 10 tables, 25+ columns, 2 storage buckets, triggers, and sequences.
- **RSK-02 (HIGH — Email Outbox Central Fallback):** **RESOLVED** in Phase 8C.1. Verified by 5 regression test suites.
- **RSK-03 (HIGH — Upstash Redis Distributed Rate Limiting):** **ACTIVE CONDITION FOR PRODUCTION**.
- **RSK-04 (MEDIUM — IP Spoofing via Leftmost Header):** **ACTIVE RECOMMENDATION**.
- **RSK-05 (MEDIUM — Storage Bucket Disaster Recovery Sync):** **ACTIVE RECOMMENDATION**.
- **RSK-06 (LOW — Master Email Safety Gate Operational Confirmation):** **VERIFIED**.

---

## 4. Consolidated Risk Register

| Risk ID | Severity | Category | Target Component | Finding & Impact | Blocker for Preview UAT? | Blocker for Production Release? |
| :--- | :---: | :---: | :--- | :--- | :---: | :---: |
| **RSK-01** | **CRITICAL** | Database | Production Supabase (`fohpqheglxhfdecadhzw`) | Production database lacks 10 tables, 25+ columns, 2 storage buckets, 7 triggers, sequences, and RPCs. Deploying now will crash all order, payment, and draw flows. | **NO (Preview is fully migrated)** | **YES (ACTIVE PRODUCTION BLOCKER)** |
| **RSK-02** | ~~HIGH~~ **RESOLVED** | Logic | Email Outbox | Phase 8C.1 remediated `outbox.ts` and `templates.ts` to strictly bind seller snapshot UPI fields with zero central fallback. | **NO (RESOLVED)** | **NO (RESOLVED)** |
| **RSK-03** | **HIGH** | Infrastructure | Upstash Redis | Missing Upstash credentials in Vercel causes rate limiting to fall back to ephemeral in-memory storage, which does not protect against distributed brute-force attacks across serverless lambdas. | **NO (Acceptable in Preview)** | **YES (Requires Upstash provisioning)** |
| **RSK-04** | **MEDIUM** | Security | Rate Limiting IP Extraction | `getClientIpFromHeaders` reads leftmost IP in `X-Forwarded-For`. Clients could spoof headers before edge proxies. On Vercel, `x-vercel-forwarded-for` should be authoritative. | **NO** | **NO** |
| **RSK-05** | **MEDIUM** | Disaster Recovery | Supabase Storage | No automated off-site sync or backup script exists for private storage buckets (`payment-screenshots` and `seller-payment-qrs`). Standard `pg_dump` only covers relational database records. | **NO** | **NO** |
| **RSK-06** | **LOW** | Operations | System Settings | Toggling customer emails to live requires manual admin intervention via `/admin/settings` with confirmation phrase `CONFIRM_ENABLE_LIVE_EMAIL`. | **NO** | **NO** |

---

## 5. Production Blockers & Prerequisites

To transition the SSFI Lucky Draw Application from **READY FOR PREVIEW UAT** to **READY FOR PRODUCTION**, the following strict sequence of prerequisites must be fulfilled:

```
[Phase 9F Audit: PASS]
        │
        ▼
[Push & Deploy to Preview Branch] ──▶ [Perform User Acceptance Testing in Preview]
        │
        ▼ (Upon Owner Approval)
[Prerequisite 1: Pre-Migration Production Backup]
  - Execute full physical pg_dump of Production Supabase fohpqheglxhfdecadhzw
        │
        ▼
[Prerequisite 2: Execute Production Database Migration Package]
  - Apply consolidated additive schema migrations to fohpqheglxhfdecadhzw:
      * 10 missing tables (system_settings, customer_email_outbox, payment_recovery_tokens,
        payment_screenshots, order_collaboration_notes, draw_manual_exclusions,
        draw_eligibility_snapshots, draw_snapshot_tickets, draw_approvals, draw_randomness_evidence)
      * 25+ columns on orders, sellers, payments, tickets
      * Upgrade ssfi_ticket_number_sequence to MAXVALUE 999999
      * 7 immutability and append-only triggers
      * 2 private storage buckets (payment-screenshots, seller-payment-qrs)
      * Hardened SECURITY DEFINER RPCs with search_path = ''
        │
        ▼
[Prerequisite 3: Provision Production Vercel Environment Variables]
  - Configure UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, CRON_SECRET,
    APPS_SCRIPT_WEB_APP_URL, APPS_SCRIPT_SHARED_SECRET, and Production Supabase keys
        │
        ▼
[Prerequisite 4: Merge to main & Deploy to Production]
```

---

## 6. Remediation Plan

### Remediation 1 (Production Migration Package Preparation)
- **Action:** Consolidate all database migrations (Phases 6B, 6C, 8B, 9C, 9D.2) into a structured, additive, idempotent Production rollout migration script with preflight validation checks and corresponding rollback scripts.
- **Affected Environment:** Production Supabase `fohpqheglxhfdecadhzw`.
- **Target Timing:** Pre-production release window under explicit owner authorization.

### Remediation 2 (Rate Limiter Edge IP Hardening)
- **Action:** Update `getClientIpFromHeaders` in `src/lib/security/rateLimit.ts` to inspect `x-vercel-forwarded-for` as the primary IP source, eliminating potential leftmost `X-Forwarded-For` client spoofing.
- **Affected File:** `src/lib/security/rateLimit.ts`.

### Remediation 3 (Storage Backup Automation)
- **Action:** Develop a script to periodically sync private storage bucket objects (`payment-screenshots` and `seller-payment-qrs`) to an encrypted off-site backup archive.

---

## 7. Final Verdict

### Final Verdict: **READY FOR PREVIEW UAT**

#### Verdict Justification
1. **Preview Environment:** Fully migrated, verified, and hardened. All 28 database tables have active RLS. Sensitive stored procedures have `search_path = ''` and service-role execution grants. The email outbox constraint accepts `WINNER_ANNOUNCED`. All 402 test cases pass. TypeScript and ESLint pass cleanly.
2. **Preview UAT Eligibility:** The system is completely prepared for stakeholders to perform User Acceptance Testing (UAT) on the Preview environment upon deploying the current codebase to the `preview/production-mirror` Vercel deployment.
3. **Production Release Status:** Strictly **BLOCKED BY RSK-01** (Production Database Migration Blocker). Production Supabase `fohpqheglxhfdecadhzw` must not receive application traffic until the database migrations are approved and executed under strict pre-migration backup protocols.

---

## 8. Final Safety Certification

The lead auditor explicitly certifies under strict operational safety protocols:
- [x] **Production database (`fohpqheglxhfdecadhzw`) received ZERO contact.** (Air-gapped; zero queries, mutations, or migrations).
- [x] **Preview database (`jiyuiydzsfydjklosvvq`) was accessed in READ-ONLY mode only.** (Zero schema or data modifications).
- [x] **No migrations were applied.**
- [x] **No Git commit, push, merge, or deployment was performed.**
- [x] **Phase 8C.1 uncommitted workspace changes remain intact.**
- [x] **No real customer emails were dispatched; master gate remained `false`.**
- [x] **Zero credentials, secrets, or private keys were exposed.**

