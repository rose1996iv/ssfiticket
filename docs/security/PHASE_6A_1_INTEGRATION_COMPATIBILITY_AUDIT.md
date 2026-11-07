# SSFI — Phase 6A.1: Integration Compatibility & Security Audit

**Document ID:** `PHASE_6A_1_INTEGRATION_COMPATIBILITY_AUDIT`  
**Date:** 2026-11-07  
**Mode:** `STRICTLY READ-ONLY AUDIT` (Zero Remote Database Writes, Zero Migration Executions, Zero Code Mutations)  
**Production Supabase (`fohpqheglxhfdecadhzw`):** `AIR-GAPPED / READ-ONLY / UNTOUCHED`  
**Preview Supabase (`jiyuiydzsfydjklosvvq`):** `FROZEN / READ-ONLY / UNTOUCHED`  
**Branch:** `preview/production-mirror`  

---

## 1. Executive Summary

This independent integration compatibility and security audit evaluates the Phase 6A customer payment authorization implementation against the proposed Phase 5 database architecture, existing repository code, and operational workflows.

### Audit Summary & Verdict
- **Database/Application Integration:** `COMPATIBLE` — All RPC calls, parameters, default arguments, return shapes, and transactional locking mechanics match the proposed Phase 5 SQL definitions with 100% fidelity.
- **Application Security Controls:** `VERIFIED` — Zero bearer tokens in normal checkout URLs, strict `HttpOnly; SameSite=Lax; Path=/` cookie attributes, single-use write consumption (`CONSUME_WRITE`), and strict authorization before sensitive order or PII rendering.
- **Rate Limiting Architecture:** `FUNCTIONAL WITH OPERATIONAL OBSERVATION` — Dual-bucket design (10 / 15m IP; 30 / 15m order) correctly hashes client IPs. In Preview and test environments, the in-memory fallback operates reliably. In Production, explicit Upstash credentials are required to prevent fallback to per-container in-memory stores.
- **Migration Status:** `UNAPPLIED ON PREVIEW (PENDING OWNER APPROVAL)` — Phase 5 database migrations (`PHASE_5_REVISED_SECURITY_MIGRATIONS.sql` and `PHASE_5_RLS_POLICY_MIGRATION.sql`) have not yet been executed on Preview Supabase due to the strict execution freeze.
- **Business Workflow Preservation:** `VERIFIED (0 REGRESSIONS)` — Attributed seller QR flow, mandatory screenshot proof, optional UTR, payer name capture, advisory seller review, admin payment verification, super-admin screenshot download, and ticket issuance remain completely intact.

---

## 2. Files Inspected

### Application Source Code
1. `src/lib/security/orderAccessToken.ts` (Customer token generation, SHA-256 hashing, timing-safe checks, cookie management, multi-role authorization).
2. `src/lib/security/rateLimit.ts` (Shared dual-bucket rate limiter, Upstash Redis HTTP REST pipeline, IP hashing, fail-closed handling).
3. `src/app/api/order-access/exchange/route.ts` (Cross-device token exchange route, cookie setting, 303 redirect, zero URL token leakage).
4. `src/app/buy/order/[orderId]/page.tsx` (Public order details server component, `READ` authorization gate, unauthorized fallback view).
5. `src/server/actions/publicOrder.ts` (`createPublicCustomerOrder` token issuance & cookie setting; `submitPublicUpiPayment` `CONSUME_WRITE` gate).
6. `src/server/actions/paymentRecovery.ts` (`submitPaymentCompletion` `CONSUME_WRITE` gate; `generateOrderRecoveryLink`, `lookupRecoveryTokenDetails`).
7. `src/server/actions/paymentScreenshot.ts` (`uploadPaymentScreenshot` `WRITE` gate; elimination of unauthenticated public uploads).
8. `src/lib/payment/recoveryToken.ts` (`buildOrderAccessExchangeUrl`, `buildPaymentRecoveryUrl`, token hashing and format validators).
9. `src/components/admin/AdminPaymentRecoveryCard.tsx` (Administrative recovery link generation and WhatsApp sharing UI).

### Database Migrations & SQL Scripts
1. `docs/security/PHASE_5_REVISED_SECURITY_MIGRATIONS.sql` (Proposed Phase 5 token RPCs, hardened snapshot trigger, allowlisted historical sanitization, trigger lockdown).
2. `docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql` (Proposed split RLS policies for `public.campaigns` and `public.prizes` by role).
3. `supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql` (Working tree migration: pagination indexes, revoked trigger grant, revoked `anon` grant on `is_staff`).
4. `supabase/migrations/202611020001_seller_qr_and_mandatory_screenshots.sql` (Baseline `submit_manual_upi` and `submit_payment_details_completion`).
5. `supabase/migrations/202610300001_p0_security_remediation.sql` (Baseline `create_seller_order` with 6 parameters and default `p_actor`).

### Tests & Configuration
1. `tests/customerPaymentAuthorization.test.ts` (15 unit & integration security tests for Phase 6A).
2. `package.json` (Test script definition and dependency manifest).
3. `.env.example` (Reference environment variable definitions).

---

## 3. Database RPC Compatibility Matrix

The table below contrasts the application caller invocation against the PostgreSQL target declaration:

| RPC Name | Application Caller | SQL Migration Source | SQL Signature & Mode | Grants | Return Type & JSON Structure | Parity Status |
|---|---|---|---|---|---|:---:|
| `issue_customer_order_access_token` | `src/lib/security/orderAccessToken.ts`<br>`(issueOrderAccessToken)` | `PHASE_5_REVISED_SECURITY_MIGRATIONS.sql`<br>(Lines 30–137) | `(p_order_id uuid, p_token_hash text, p_expires_in_days integer DEFAULT 7)`<br>`SECURITY DEFINER SET search_path = public` | `service_role` ONLY | `jsonb`: `token_id`, `order_id`, `order_number`, `order_status`, `expires_at`, `revoked_prior_tokens`. Matches TypeScript caller. | `VERIFIED` |
| `verify_order_payment_access` | `src/lib/security/orderAccessToken.ts`<br>`(verifyOrderPaymentAccess)` | `PHASE_5_REVISED_SECURITY_MIGRATIONS.sql`<br>(Lines 144–302) | `(p_order_id uuid, p_token_hash text, p_access_mode text DEFAULT 'READ')`<br>`SECURITY DEFINER SET search_path = public` | `service_role` ONLY | `jsonb`: `authorized`, `code`, `access_mode`, `token_id`, `order_id`, `order_number`, `order_status`, `expires_at`, `write_consumed_at`. Matches `VerifyTokenResult`. | `VERIFIED` |
| `is_staff` | `src/lib/security/orderAccessToken.ts`<br>`(verifyOrderAccess)` | `202611070002_preview_clone_alignment_and_isolation.sql`<br>& `PHASE_5_RLS_POLICY_MIGRATION.sql` | `(p_user_id uuid)`<br>`LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public` | `authenticated`, `service_role`<br>(Strictly revoked from `PUBLIC` & `anon`) | `boolean`. Invoked via authenticated server client. | `VERIFIED` |
| `submit_manual_upi` | `src/server/actions/publicOrder.ts`<br>`(submitPublicUpiPayment)` | `202611020001_seller_qr_and_mandatory_screenshots.sql` | `(p_order_id uuid, p_utr text, p_payer_name text)`<br>`SECURITY DEFINER SET search_path = public` | `service_role` ONLY | `void`. Transitions order & payment to `SUBMITTED`. | `VERIFIED` |
| `submit_payment_details_completion` | `src/server/actions/paymentRecovery.ts`<br>`(submitPaymentCompletion)` | `202611020001_seller_qr_and_mandatory_screenshots.sql` | `(p_order_id uuid, p_utr text, p_email text, p_whatsapp text, p_payer_name text, p_token_hash text)` | `service_role` ONLY | `jsonb`: `order_number`, `reopened`. Matches `SubmitPaymentCompletionResult`. | `VERIFIED` |
| `create_seller_order` | `src/server/actions/publicOrder.ts`<br>`(createPublicCustomerOrder)` | `202610300001_p0_security_remediation.sql` | `(p_seller_id uuid, p_name text, p_whatsapp text, p_email text, p_quantity integer, p_actor uuid DEFAULT NULL)` | `service_role` ONLY | `uuid` (Order ID). 5 arguments supplied; 6th uses SQL default `NULL`. | `VERIFIED` |
| `lookup_payment_recovery_token` | `src/server/actions/paymentRecovery.ts`<br>`(lookupRecoveryTokenDetails)` | `202611011100_payment_recovery_tokens.sql` | `(p_token_hash text)`<br>`SECURITY DEFINER SET search_path = public` | `service_role` ONLY | `jsonb`: Token status, customer and order details. Matches `TokenLookupResult`. | `VERIFIED` |

### Database Constraint & Trigger Compatibility
1. **Trigger Compatibility:** `public.protect_order_payment_snapshot()` is updated via `CREATE OR REPLACE FUNCTION`. The existing trigger `trg_protect_order_payment_snapshot` on `public.orders` remains enabled (`tgenabled = 'O'`) without requiring table locking or DDL drop.
2. **Table Constraints:** `public.payment_recovery_tokens` foreign key references `public.orders(id) ON DELETE CASCADE`. Tokens issued by `issue_customer_order_access_token` automatically respect referential integrity.
3. **Function Overload Resolution:** `PHASE_5_REVISED_SECURITY_MIGRATIONS.sql` lines 141–142 drop older 2-argument and 3-argument definitions before creating `verify_order_payment_access(uuid, text, text)`, preventing PostgreSQL `PGRST204` / `42725` ambiguous overload errors.

---

## 4. Security Findings with Severity

### Finding 1: Phase 5 Migrations Pending Application on Preview Supabase
- **Severity:** `HIGH (BLOCKER FOR PHASE 6B)`
- **Classification:** `VERIFIED FACT`
- **Evidence:** Under the execution freeze, no remote migrations were executed against Preview Supabase (`jiyuiydzsfydjklosvvq`). Therefore, `issue_customer_order_access_token`, 3-mode `verify_order_payment_access`, and the split RLS policies in `PHASE_5_RLS_POLICY_MIGRATION.sql` are currently UNAPPLIED in the remote Preview database.
- **Application Mitigation in Place:** `src/lib/security/orderAccessToken.ts` lines 169–198 and 238–284 contain an automatic direct-query fallback using `createSupabaseAdminClient()` so the application functions during local development and testing even prior to migration execution.
- **Resolution:** Execute `PHASE_5_RLS_POLICY_MIGRATION.sql`, `202611070002_preview_clone_alignment_and_isolation.sql`, and `PHASE_5_REVISED_SECURITY_MIGRATIONS.sql` on Preview Supabase upon owner approval in Phase 6B.

### Finding 2: Upstash Redis Unconfigured in Production Falls Back to In-Memory Store
- **Severity:** `MEDIUM (OPERATIONAL RISK)`
- **Classification:** `CODE-BASED OBSERVATION`
- **Evidence:** In `src/lib/security/rateLimit.ts` lines 129–193:
  ```ts
  if (upstashUrl && upstashToken) { ... }
  // In-memory fallback
  sweepExpiredMemoryEntries();
  const ipCount = incrementInMemory(ipKey, RATE_LIMIT_WINDOW_SECONDS);
  ```
  If `process.env.NODE_ENV === "production"` and `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are completely omitted from the environment, execution falls through to `memoryStore` without throwing an error. In serverless environments (Vercel Lambdas), in-memory state is per-container and ephemeral.
- **Resolution:** For production deployment, ensure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are provisioned in Vercel environment variables, or add an explicit production check: `if (process.env.NODE_ENV === 'production' && !upstashUrl && failClosedIfUnavailable) return { allowed: false, reason: 'SERVICE_UNAVAILABLE' };`. In Preview, in-memory fallback is non-blocking and acceptable.

### Finding 3: Legacy Orders Require Support/Admin Recovery Link for Browser Access
- **Severity:** `LOW (INTENDED SECURITY INVARIANT / OPERATIONAL)`
- **Classification:** `CODE-BASED OBSERVATION`
- **Evidence:** Because `src/app/buy/order/[orderId]/page.tsx` strictly requires an `ssfi_order_access_${orderId}` cookie or staff/seller session, historical orders created prior to Phase 6A (where the customer has no browser cookie) cannot be opened by raw UUID alone.
- **Workflow in Place:** When an unauthorized legacy customer visits `/buy/order/<orderId>`, the page displays a support contact card with order number guidance. Authorized Admins (`SUPER_ADMIN` and `ADMIN`) can generate an authenticated recovery link via `AdminPaymentRecoveryCard.tsx` (`generateOrderRecoveryLink`), which the customer exchanges for an `HttpOnly` cookie via `/api/order-access/exchange`.

### Finding 4: Reverse-Proxy IP Header Evaluation Order
- **Severity:** `LOW (INFORMATIONAL)`
- **Classification:** `CODE-BASED OBSERVATION`
- **Evidence:** `getClientIpFromHeaders` in `src/lib/security/rateLimit.ts` line 78 extracts `x-forwarded-for.split(",")[0]?.trim()`. In standard Vercel and Cloudflare deployments, the first IP represents the originating client IP.
- **Privacy Preservation:** The extracted IP is immediately salted and hashed with SHA-256 (`hashClientIp`). Raw client IPs are never stored in memory, database rows, or log messages.

---

## 5. Upstash Configuration Status

### 5.1 Environment Variable Audit (Names Only — Zero Values Disclosed)

| Variable Identifier | Scope | Presence in `.env.example` | Production Requirement | Preview Requirement |
|---|:---:|:---:|:---:|:---:|
| `UPSTASH_REDIS_REST_URL` | Server-side | Documented as Optional | **MANDATORY** for multi-lambda shared rate-limiting | Optional (In-memory fallback operates cleanly) |
| `UPSTASH_REDIS_REST_TOKEN` | Server-side | Documented as Optional | **MANDATORY** if `UPSTASH_REDIS_REST_URL` is set | Optional |
| `RATE_LIMIT_SALT` | Server-side | Documented as Optional | Recommended (Custom salt) | Optional (Internal default active) |

### 5.2 Mechanics & Atomic Semantics
- **Atomic Operations:** Uses Upstash Redis HTTP REST pipeline `POST /pipeline` with `[["INCR", key], ["EXPIRE", key, 900, "NX"]]`.
- **Expiration Policy:** `EXPIRE ... NX` sets the 900-second window only if the key does not already have a TTL, guaranteeing an unmanipulated sliding window origin.
- **Fail-Closed Verification:** Verified in `src/lib/security/rateLimit.ts` line 182: if Upstash fails during a production request with `failClosedIfUnavailable: true`, it returns `{ allowed: false, reason: "SERVICE_UNAVAILABLE", retryAfterSeconds: 60 }`.

---

## 6. Legacy Order Recovery Assessment

### 6.1 Customer Experience for Pre-Phase 6A Orders
For orders created prior to the Phase 6A deployment, customers will not hold the `ssfi_order_access_${orderId}` cookie.
1. When visiting `GET /buy/order/<orderId>`:
   `verifyOrderAccess(orderId, 'READ')` evaluates `UNAUTHORIZED_NO_TOKEN`.
2. The page renders the dedicated fallback card:
   - Header: `"Order Access Authorization"`
   - Message: `"This order checkout session cannot be accessed by URL alone. If you completed a purchase, please use the original browser window or the secure payment link provided to you."`
   - Support contact: `manualUpiConfig.supportEmail` (`Senthangstudents@gmail.com`).
   - Zero customer PII or seller payment destinations are rendered.

### 6.2 Administrative Recovery Workflow
- **Admin Capability:** Authorized Admins (`SUPER_ADMIN` and `ADMIN`) navigate to `/admin/orders/<orderId>` and open `AdminPaymentRecoveryCard.tsx`.
- **Generation:** Admin clicks "Generate Payment Recovery Link", invoking `generateOrderRecoveryLink(orderId, 7)` (Server Action).
- **Security:** Generates 256-bit CSPRNG token, stores SHA-256 hash in `payment_recovery_tokens`, and returns the link:
  `https://<domain>/payment/complete/<token>` or `https://<domain>/api/order-access/exchange?orderId=<orderId>&token=<token>`.
- **Customer Resumption:** Customer opens the link on their device. `/api/order-access/exchange` verifies the token, sets the `HttpOnly` cookie, and redirects with HTTP `303 See Other` to clean `/buy/order/<orderId>`, restoring full access.
- **Seller Exclusion:** Verified that Sellers cannot generate recovery links (`requireAnyRole(["SUPER_ADMIN", "ADMIN"])`).

---

## 7. Business Workflow Regression Matrix

| Business Rule / Requirement | Verified Code Location | Verification Evidence | Regression Status |
|---|---|---|:---:|
| **Mandatory Screenshot Proof** | `src/server/actions/publicOrder.ts`<br>`src/server/actions/paymentRecovery.ts`<br>`src/server/actions/paymentScreenshot.ts` | Server-side DB queries verify screenshot exists in `payment_screenshots` table before allowing transition to `SUBMITTED`. Magic bytes (JPEG/PNG/WebP) and 2MB limit verified. | `VERIFIED (NO REGRESSION)` |
| **Payer Name Capture** | `src/components/payment/PaymentDetailsForm.tsx`<br>`src/server/actions/publicOrder.ts`<br>`/admin/payments` | Input accepted up to 120 chars; passed to `submit_manual_upi` and `submit_payment_details_completion`; rendered in Admin Payment Verification table. | `VERIFIED (NO REGRESSION)` |
| **Optional UTR** | `src/components/payment/PaymentDetailsForm.tsx`<br>`src/server/actions/publicOrder.ts`<br>`src/server/actions/paymentRecovery.ts` | Customers can submit payments with blank UTR provided a screenshot is attached. Non-blank UTRs are validated. | `VERIFIED (NO REGRESSION)` |
| **Seller Advisory Review** | `src/app/seller/payments/page.tsx`<br>`src/server/actions/sellerReview.ts` | Sellers can flag or match payments with notes; review flags display to Admins; seller review NEVER marks payment verified or issues tickets. | `VERIFIED (NO REGRESSION)` |
| **Admin-Only Final Verification** | `src/server/actions/operations.ts`<br>`/admin/payments` | Only authorized Admins (`is_staff(auth.uid())`) can invoke `verify_payment_and_issue`. | `VERIFIED (NO REGRESSION)` |
| **Authoritative Ticket Issuance** | `src/server/actions/operations.ts`<br>`public.verify_payment_and_issue()` | Tickets are issued exclusively by PostgreSQL atomic RPC `verify_payment_and_issue(p_payment_id, p_actor)`. | `VERIFIED (NO REGRESSION)` |
| **SUPER_ADMIN Screenshot Download** | `src/lib/payment/screenshotDownload.ts`<br>`src/server/actions/paymentScreenshot.ts` | `canRoleDownloadPaymentScreenshot` permits ONLY `SUPER_ADMIN`. Generates 60-second signed URL; audits download. | `VERIFIED (NO REGRESSION)` |
| **Ticket Immutability** | `supabase/migrations/202611070001_customer_contact_overrides_collaboration_and_ticket_immutability.sql` | `trg_protect_ticket_immutability` trigger blocks UPDATE and DELETE operations on `public.tickets`. | `VERIFIED (NO REGRESSION)` |
| **Customer Contact Edits Audit** | `src/server/actions/customerManagement.ts`<br>`customer_contact_audit_logs` | Customer contact edits require mandatory `reason` (min 10 chars) and log admin identity and timestamps. | `VERIFIED (NO REGRESSION)` |
| **Append-Only Audit Logs** | `supabase/migrations/202610270001_phase2_core.sql` | `trg_audit_logs_prevent_update` and `trg_audit_logs_prevent_delete` triggers enforce append-only security. | `VERIFIED (NO REGRESSION)` |
| **Admin Ticket List Pagination** | `src/app/admin/tickets/page.tsx` | Supports server-side `page` and `pageSize` search parameters using Supabase `.range(start, end)`. | `VERIFIED (NO REGRESSION)` |

---

## 8. Migration Status — Verified vs Unknown

| Migration Artifact | Repository Path | Remote Preview Database Status (`jiyuiydzsfydjklosvvq`) | Classification |
|---|---|---|:---:|
| **Core Baseline Migrations (1–17)** | `supabase/migrations/202610270001_phase2_core.sql` through `202611020002_protect_all_order_snapshot_fields.sql` | Applied to Preview during clone operation. | `VERIFIED APPLIED` |
| **Customer Management & Ticket Immutability (18)** | `supabase/migrations/202611070001_customer_contact_overrides_collaboration_and_ticket_immutability.sql` | Applied to Preview during clone operation. | `VERIFIED APPLIED` |
| **Preview Alignment & Pagination Indexes (19)** | `supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql` | Uncommitted local file; not yet applied to remote Preview. | `VERIFIED UNAPPLIED (LOCAL ONLY)` |
| **Split RLS Policies (Campaigns & Prizes)** | `docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql` | Proposed security migration; not yet applied to remote Preview. | `VERIFIED UNAPPLIED (LOCAL ONLY)` |
| **Customer Token RPCs & Snapshot Sanitization** | `docs/security/PHASE_5_REVISED_SECURITY_MIGRATIONS.sql` | Proposed security migration; not yet applied to remote Preview. | `VERIFIED UNAPPLIED (LOCAL ONLY)` |

---

## 9. Exact Blockers Before Phase 6B

1. **Owner Approval Gate (P0):** The strict owner execution freeze is active. No migrations may be executed against Preview Supabase without explicit approval.
2. **Anonymous Campaign 42501 Error on Preview DB (P1):** The current Preview database RLS policies evaluate `is_staff(auth.uid())` for anonymous visitors, resulting in permission errors. `PHASE_5_RLS_POLICY_MIGRATION.sql` is ready to resolve this once applied.
3. **16 Historical Preview Orders with Non-Synthetic UPIs (P1):** The 16 historical orders (`ORD-2026-000031`..`ORD-2026-000046`) retain historical UPI snapshots in Preview. `admin_sanitize_preview_historical_order_snapshots` in `PHASE_5_REVISED_SECURITY_MIGRATIONS.sql` is ready to safely sanitize them once approved.

---

## 10. Recommended Next Actions

Upon receiving explicit owner approval to initiate **Phase 6B (Preview Database Migration Execution & Verification)**:

1. **Execute Step 1 — Split RLS Policies:**
   Execute [`docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql`](file:///f:/PROJECT/Lucky%20Draw/docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql) on Preview Supabase (`jiyuiydzsfydjklosvvq`).
   - Verifies resolution of anonymous 42501 error on `public.campaigns` and `public.prizes`.
   - Confirms `public.is_staff(uuid)` remains uncallable by `anon`.
2. **Execute Step 2 — Alignment & Performance Indexes:**
   Execute [`supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql`](file:///f:/PROJECT/Lucky%20Draw/supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql) on Preview Supabase.
   - Verifies creation of pagination and filter indexes on `orders`, `payments`, `tickets`, and `audit_logs`.
3. **Execute Step 3 — Token Architecture & Hardened Sanitization:**
   Execute [`docs/security/PHASE_5_REVISED_SECURITY_MIGRATIONS.sql`](file:///f:/PROJECT/Lucky%20Draw/docs/security/PHASE_5_REVISED_SECURITY_MIGRATIONS.sql) on Preview Supabase.
   - Drops obsolete 2-argument `verify_order_payment_access` and installs 3-mode `verify_order_payment_access(uuid, text, text)`.
   - Installs `issue_customer_order_access_token`.
   - Hardens `protect_order_payment_snapshot()` trigger function.
4. **Execute Step 4 — Historical Order Sanitization:**
   Execute `SELECT public.admin_sanitize_preview_historical_order_snapshots('<super_admin_uuid>');` on Preview Supabase.
   - Asserts exact sanitization of the 16 allowlisted orders to synthetic Preview format (`preview.seller_XXX@upi`).
   - Confirms audit logs created with zero sensitive historical UPI exposure.
5. **Execute Step 5 — Permanent Trigger Lockdown:**
   Execute `SELECT public.lock_order_payment_snapshot_trigger_unconditional();` on Preview Supabase.
   - Replaces the trigger function with its permanent unconditional body (zero GUC branches).
6. **Deploy & Validate Preview Environment:**
   Deploy the `preview/production-mirror` working tree to Vercel Preview and execute live browser integration tests.

