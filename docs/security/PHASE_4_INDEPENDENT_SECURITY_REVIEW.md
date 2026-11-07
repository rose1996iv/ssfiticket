# SSFI — Phase 4: Independent Security Design Review

**Document ID:** `PHASE_4_INDEPENDENT_SECURITY_REVIEW`  
**Date:** 2026-11-07  
**Mode:** `VALIDATION ONLY` (Zero Remote DB Writes, Zero Storage Mutations, Zero Code Mutations)  
**Production Supabase (`fohpqheglxhfdecadhzw`):** `READ-ONLY / UNTOUCHED`  
**Preview Supabase (`jiyuiydzsfydjklosvvq`):** `READ-ONLY / UNTOUCHED`  
**Scope:** Independent cryptographic, authorization, database trigger, and recovery review of all five Phase 3 deliverables (`PHASE_3_P0_SECURITY_REMEDIATION_PLAN.md`, `PHASE_3_PROPOSED_SECURITY_MIGRATIONS.sql`, `PHASE_3_SECURITY_TEST_PLAN.md`, `PHASE_3_STORAGE_RECOVERY_REPORT.md`, and `PHASE_3_BACKUP_RESTORE_TEST_PLAN.md`).

---

## 1. Executive Summary

An independent adversarial security review and local PostgreSQL 18 execution test were conducted across all five Phase 3 deliverables.

While the core cryptographic primitives (256-bit CSPRNG token generation, SHA-256 hashed persistence, order-scoped database verification RPC, and split RLS policies for `public.campaigns` / `public.prizes`) are sound, **seven (7) architectural and operational design flaws** were identified that require revision before implementation:

1. **Finding SEC-01 (`REQUIRES REVISION` — High): Bearer Token Exposure in Redirect URL Query Parameter (`?t=`)**  
   Phase 3 Section 2.3.C proposed redirecting from `createPublicCustomerOrder` to `/buy/order/${orderId}?t=${rawOrderToken}`. Placing the 256-bit bearer token in a URL query parameter exposes it in browser history, Vercel request logs, proxy logs, and `Referer` headers.
2. **Finding SEC-02 (`REQUIRES REVISION` — High): Rate Limiter Keying Bypass (`order_access:${orderId}:${tokenPrefix}`)**  
   Phase 3 Section 2.3.B keyed the rate limiter on `tokenPrefix` (`rawToken.slice(0, 8)`). An attacker submitting random tokens gets a fresh 20-request bucket per random prefix, bypassing per-order brute-force throttling.
3. **Finding SEC-03 (`REQUIRES REVISION` — Medium): Cookie `Path=/buy/order/${orderId}` Breaks Next.js Server Action Submissions from Recovery/Exchange Routes**  
   Restricting the `HttpOnly` cookie path to `/buy/order/${orderId}` prevents the browser from sending the cookie when a Server Action is invoked from `/payment/complete/[token]` or an order-access exchange endpoint.
4. **Finding SEC-04 (`REQUIRES REVISION` — Medium): Missing Write-Replay Cutoff After Payment Submission/Verification**  
   `verify_order_payment_access` allows valid unexpired tokens to authorize both read and write operations. While customers need continued **read** access to `/buy/order/[orderId]` to view verification status and issued tickets, **write** actions (`submitPublicUpiPayment`, `uploadPaymentScreenshot`) must stamp `used_at = now()` on `payment_recovery_tokens` and reject write replay once `orders.status <> 'PENDING_PAYMENT'`.
5. **Finding SEC-05 (`REQUIRES REVISION` — High): Unprotected Session GUC (`ssfi.allow_preview_snapshot_sanitization`) in `protect_order_payment_snapshot()`**  
   In PostgreSQL, any role capable of executing SQL or a permissive function in the same transaction can call `set_config('ssfi.allow_preview_snapshot_sanitization', 'true', true)`. Leaving this GUC bypass active in `protect_order_payment_snapshot()` weakens trigger immutability unless the trigger also enforces the explicit 16-order allowlist and preview project check, or is immediately restored to unconditional immutability after the one-time sanitization runs.
6. **Finding SEC-06 (`REQUIRES REVISION` — Medium): Missing Explicit 16-Order Allowlist and Exact Row-Count Assertion in `admin_sanitize_preview_historical_order_snapshots`**  
   The proposed RPC matches rows dynamically (`WHERE snapshot_captured_at IS NOT NULL AND snapshot_upi_id NOT LIKE 'preview.%@upi'`) instead of constraining the update to the exact 16 audited order numbers (`ORD-2026-000031` through `ORD-2026-000046`) and asserting `v_sanitized_count = 16` before commit.
7. **Finding SEC-07 (`BLOCKED` — Critical): Conflicting Working-Tree Migration `supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql`**  
   An unapplied migration file left in the working tree (`supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql`, line 25) executes `GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO anon, authenticated, service_role;`. This directly violates the Phase 3 P1 requirement and must be removed/replaced before any migration is applied.

---

## 2. Independent Review of Proposed Token Architecture (P0)

### 2.1 Evaluation Matrix Against Required Criteria

| # | Security Criterion | Phase 3 Proposed Design | Independent Validation Finding | Verdict |
|---|---|---|---|---|
| 1 | **Cryptographic Token Entropy** | `crypto.randomBytes(32).toString("hex")` (32 bytes = 256 bits, 64 hex chars) generated server-side via Node.js CSPRNG (`src/lib/security/orderAccessToken.ts`). | 256 bits of CSPRNG entropy ($2^{256}$ keyspace) makes offline and online guessing computationally infeasible. Enforced at DB layer via `length(lower(trim(p_token_hash))) = 64`. | `APPROVED FOR IMPLEMENTATION` |
| 2 | **SHA-256 Token Storage** | Raw token hashed with `crypto.createHash("sha256").update(rawToken.trim()).digest("hex")`; stored only in `public.payment_recovery_tokens.token_hash`. | Verified locally on PostgreSQL 18. Neither `public.payment_recovery_tokens` nor `public.audit_logs` stores the raw token; database compromise does not leak active bearer tokens without preimage inversion. | `APPROVED FOR IMPLEMENTATION` |
| 3 | **Expiration & Revocation Behavior** | `issue_customer_order_access_token` sets `Revoked = true` on all prior active tokens for `p_order_id` (`WHERE order_id = p_order_id AND revoked = false AND used_at IS NULL`) before inserting the new token with `expires_at = now() + make_interval(days => p_expires_in_days)` (clamped 1–30 days, default 7). | Verified on local PostgreSQL 18. Re-issuing a token deterministically invalidates prior tokens for the same order, and `verify_order_payment_access` rejects `revoked = true` and `expires_at <= now()`. | `APPROVED FOR IMPLEMENTATION` |
| 4 | **Cookie Security Attributes (`HttpOnly`, `Secure`, `SameSite`)** | `httpOnly: true`, `secure: process.env.NODE_ENV === "production"`, `sameSite: "lax"`, `maxAge: 604800`, `path: "/buy/order/${orderId}"`. | `HttpOnly`, `Secure`, and `SameSite=Lax` are appropriate, **but** setting `path: "/buy/order/${orderId}"` breaks Server Action invocations initiated from `/payment/complete/[token]` or root endpoints (`Finding SEC-03`). Must use `path: "/"` with order-scoped cookie name `ssfi_order_access_${orderId}`. | `REQUIRES REVISION` |
| 5 | **Constant-Time Verification** | `verify_order_payment_access` compares `token_hash = lower(trim(p_token_hash))` in PostgreSQL B-tree index lookup after SHA-256 hashing of the input token. | Because the user-supplied input is first hashed with SHA-256 before any comparison occurs, timing variations on `token_hash` comparison cannot leak character-by-character information about the raw token. Adding `crypto.timingSafeEqual` in the Node.js helper when comparing two hashes in memory is good defense-in-depth. | `APPROVED FOR IMPLEMENTATION` |
| 6 | **Replay Protection After Payment Submission / Verification** | Phase 3 Section 2.3 checked `verifyOrderPaymentAccess` before `submitPublicUpiPayment` and `uploadPaymentScreenshot`, but `verify_order_payment_access` did not distinguish **read** access from **write** access or mark `used_at` upon payment submission. | Customers need continued **read** access to `/buy/order/[orderId]` after submitting payment (`PAYMENT_SUBMITTED`, `PAYMENT_VERIFIED`, `TICKETS_ISSUED`). However, **write** operations (`submitPublicUpiPayment`, `uploadPaymentScreenshot`) must reject replay once `orders.status <> 'PENDING_PAYMENT'` and record `used_at = now()` on the token (`Finding SEC-04`). | `REQUIRES REVISION` |
| 7 | **Cross-Order Token Isolation** | `verify_order_payment_access(p_order_id, p_token_hash)` filters strictly on `WHERE prt.order_id = p_order_id AND prt.token_hash = v_clean_hash`. | Verified on local PostgreSQL 18 (`testOrderId = ORD-2026-000041` token presented against `otherOrderId = ORD-2026-000042` returned `{"authorized": false, "reason": "INVALID_TOKEN"}`). | `APPROVED FOR IMPLEMENTATION` |
| 8 | **Query-String Token Leakage Risks (Logs, Referrer Headers, Browser History)** | Phase 3 Section 2.3.C proposed `redirect('/buy/order/' + orderId + '?t=' + rawOrderToken)` after `createPublicCustomerOrder`. | **High Risk (`Finding SEC-01`):** Passing `?t=` in the page URL leaks the bearer secret into browser history, Vercel request logs, and `Referer` headers. Same-browser checkout must set the `HttpOnly` cookie inside `createPublicCustomerOrder` and redirect cleanly to `/buy/order/${orderId}` **without** `?t=`. External recovery links must hit a cookie-exchange endpoint (`303 See Other`) that strips the token from the URL before rendering `/buy/order/${orderId}`, paired with `Referrer-Policy: no-referrer`. | `REQUIRES REVISION` |
| 9 | **CSRF Protection on Upload and Payment Submission Actions** | Next.js Server Actions (`submitPublicUpiPayment`, `uploadPaymentScreenshot`) enforce `POST`-only execution and `Origin` vs `Host` header validation, combined with `SameSite=Lax` `HttpOnly` cookie and explicit `orderId` binding. | Strong multi-layer CSRF defense once cookie `Path` is corrected to `"/"` (`Finding SEC-03`) and explicit `Origin` header verification is included in the action guard. | `REQUIRES REVISION` |
| 10 | **Compatibility with Current Anonymous Customer Purchase Workflow** | Anonymous customer submits `/buy?seller=SELLER-xxx` -> `createPublicCustomerOrder` creates order + issues token -> sets `HttpOnly` cookie -> redirects to `/buy/order/[orderId]` -> uploads screenshot -> submits UTR -> views confirmation. | Preserves the 100% unauthenticated customer purchase flow without requiring customer login accounts, while completely blocking UUID-only IDOR access (`Finding P0-1`). | `APPROVED FOR IMPLEMENTATION` |

### 2.2 Detailed Remediation Specifications for Token Architecture Flaws

#### Finding SEC-01 — Eliminate `?t=` Query-String Bearer Token from `/buy/order/[orderId]`
- **Vulnerability in Phase 3 Design:** In `PHASE_3_P0_SECURITY_REMEDIATION_PLAN.md` Section 2.3.C, `createPublicCustomerOrder` returned `/buy/order/${orderId}?t=${rawOrderToken}`, and `/buy/order/[orderId]/page.tsx` accepted `searchParams.t`. Whenever a URL contains `?t=<64-hex-token>`, the secret token is persisted in:
  1. Local browser history and session restore state on shared devices.
  2. Edge/serverless HTTP request logs (`GET /buy/order/...?t=...`).
  3. Outbound `Referer` headers if any external asset or link is clicked before URL replacement.
- **Required Fix:**
  1. **Same-Browser Checkout (`createPublicCustomerOrder`):** Call `setOrderAccessCookie(orderId, rawToken)` directly inside the `createPublicCustomerOrder` Server Action response headers and redirect to `/buy/order/${orderId}` **with zero query parameters**.
  2. **Cross-Device Recovery Links (`/payment/complete/[token]` or `/api/order-access/exchange`):** When a customer clicks a recovery link from email/WhatsApp, the route handler validates the token, sets the `HttpOnly; Secure; SameSite=Lax; Path=/` cookie `ssfi_order_access_${orderId}`, sets response header `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and immediately returns an HTTP `303 See Other` redirect to `/buy/order/${orderId}` (no query string).
  3. **Reject `?t=` on `/buy/order/[orderId]`:** If `/buy/order/[orderId]` ever receives `?t=` in `searchParams`, do not render the page with `?t=` in the address bar; either exchange via route handler or reject direct query-string auth.

#### Finding SEC-02 — Fix Rate Limiter Keying Bypass (`orderId + clientIp`)
- **Vulnerability in Phase 3 Design:** Section 2.3.B defined `checkTokenRateLimit(orderId, tokenPrefix)` with key `order_access:${orderId}:${tokenPrefix}`. An attacker brute-forcing an `orderId` generates random tokens with different 8-character prefixes on every request, creating a new rate-limit bucket on each attempt.
- **Required Fix:** Key rate limiting on two independent buckets:
  1. Per `(orderId, clientIpHash)`: max `10` failed verification attempts per 15-minute window.
  2. Per `orderId` (global across all IPs): max `30` failed verification attempts per 15-minute window before temporary lockout of token verification on that `orderId`.

#### Finding SEC-03 & SEC-04 — Cookie Path & Read vs. Write Token Lifecycle
- **Required Fix:**
  1. Set cookie `path: "/"` on `ssfi_order_access_${orderId}` so Next.js Server Actions invoked from any route receive the cookie.
  2. Split verification semantics into `mode: "READ" | "WRITE"`:
     - `mode = "READ"` (rendering `/buy/order/[orderId]`): allows valid non-revoked, non-expired token (even if `used_at IS NOT NULL`) so the customer can see `PAYMENT_SUBMITTED` / `TICKETS_ISSUED` status after submitting their UTR.
     - `mode = "WRITE"` (`uploadPaymentScreenshot`, `submitPublicUpiPayment`): requires `orders.status = 'PENDING_PAYMENT'`, and when `submitPublicUpiPayment` transitions the order to `PAYMENT_SUBMITTED`, updates `payment_recovery_tokens.used_at = now()` so the token cannot be replayed for further mutations.

---

## 3. Independent Review of Historical Snapshot Sanitization RPC (P0-2)

Phase 3 proposed `public.admin_sanitize_preview_historical_order_snapshots(p_actor_user_id uuid, p_reason text)` and an updated trigger function `public.protect_order_payment_snapshot()`.

### 3.1 Evaluation Matrix Against Required Criteria

| # | Security Criterion | Phase 3 Proposed Design | Independent Validation Finding | Verdict |
|---|---|---|---|---|
| 1 | **Strict Preview-Only Execution Guard** | Verifies `public.system_settings` key `'preview_data_mirror_metadata'` has `value->>'target_project_ref' = 'jiyuiydzsfydjklosvvq'`, plus checks `current_setting('app.settings.project_ref', true)` is not `'fohpqheglxhfdecadhzw'`. | Tested on local PostgreSQL 18. Blocks execution if `'preview_data_mirror_metadata'` is missing or points to any project other than `'jiyuiydzsfydjklosvvq'`. However, this guard must also exist inside `protect_order_payment_snapshot()` (`Finding SEC-05`). | `REQUIRES REVISION` |
| 2 | **Protection Against Accidental Execution in Production** | Production (`fohpqheglxhfdecadhzw`) does not have `'preview_data_mirror_metadata'` = `'jiyuiydzsfydjklosvvq'`. | Even if accidentally deployed to Production, the `system_settings` guard aborts immediately with `P0001`. Adding the explicit 16-order allowlist and restoring the unconditional trigger post-sanitization makes Production execution impossible. | `APPROVED FOR IMPLEMENTATION` |
| 3 | **Preservation of Immutability Trigger (`trg_protect_order_payment_snapshot`)** | Trigger remains enabled (`tgenabled = 'O'`); no `ALTER TABLE ... DISABLE TRIGGER` is executed. Instead, the trigger checks `current_setting('ssfi.allow_preview_snapshot_sanitization', true) = 'true'`. | **High Risk (`Finding SEC-05`):** Any SQL session or function can call `set_config('ssfi.allow_preview_snapshot_sanitization', 'true', true)` within a transaction! Leaving that GUC check permanently in `protect_order_payment_snapshot()` creates a permanent trigger bypass vector. | `REQUIRES REVISION` |
| 4 | **Scope Limited Strictly to the 16 Audited Historical Preview Orders** | Phase 3 SQL used `WHERE o.snapshot_captured_at IS NOT NULL AND o.snapshot_upi_id IS NOT NULL AND o.snapshot_upi_id NOT LIKE 'preview.%@upi'`. | **Medium Risk (`Finding SEC-06`):** Does not explicitly restrict the `UPDATE` to the 16 audited order numbers (`ORD-2026-000031`..`ORD-2026-000046`) or assert `v_sanitized_count = 16`. | `REQUIRES REVISION` |
| 5 | **Audit Log Completeness Without PII Leakage** | Inserts one `public.audit_logs` entry per row (`action = 'PREVIEW_HISTORICAL_SNAPSHOT_SANITIZED'`) with `redacted_previous = true`, `new_snapshot_upi_id`, `new_snapshot_qr_path`, and `reason`. | Verified on local PostgreSQL 18: 16 audit entries created, zero previous real UPI IDs or account names written to `audit_logs.metadata`. | `APPROVED FOR IMPLEMENTATION` |
| 6 | **Idempotency** | Second execution finds 0 matching rows (`snapshot_upi_id NOT LIKE 'preview.%@upi'`) and updates 0 rows. | Verified on local PostgreSQL 18. With `Finding SEC-06` applied, the RPC should return `already_sanitized = true` when all 16 allowlisted orders already match `preview.%@upi`, and raise an exception if any unexpected count occurs. | `REQUIRES REVISION` |
| 7 | **Rollback Safety** | Pre-clone backup (`backups/preview-database-backup-20261107.json`) and pre-sanitization snapshot allow restoring exact values in disposable/test environments. | Verified on local PostgreSQL 18. | `APPROVED FOR IMPLEMENTATION` |

### 3.2 Detailed Remediation Specifications for Sanitization RPC Flaws (`SEC-05` & `SEC-06`)

1. **Eliminate Permanent GUC Bypass (`Finding SEC-05`):**
   - Do **not** leave a permanent `current_setting('ssfi.allow_preview_snapshot_sanitization', true) = 'true'` bypass in `public.protect_order_payment_snapshot()`.
   - Even inside the temporary trigger definition used during sanitization, `protect_order_payment_snapshot()` itself must verify:
     - `current_setting('ssfi.allow_preview_snapshot_sanitization', true) = 'true'`
     - `EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'preview_data_mirror_metadata' AND value->>'target_project_ref' = 'jiyuiydzsfydjklosvvq')`
     - `OLD.order_number = ANY(ARRAY['ORD-2026-000031','ORD-2026-000032','ORD-2026-000033','ORD-2026-000034','ORD-2026-000035','ORD-2026-000036','ORD-2026-000037','ORD-2026-000038','ORD-2026-000039','ORD-2026-000040','ORD-2026-000041','ORD-2026-000042','ORD-2026-000043','ORD-2026-000044','ORD-2026-000045','ORD-2026-000046'])`
     - `NEW.snapshot_upi_id LIKE 'preview.%@upi'`
   - Furthermore, immediately after `admin_sanitize_preview_historical_order_snapshots` is executed in Preview, re-apply the **unconditional** `public.protect_order_payment_snapshot()` function and `DROP FUNCTION public.admin_sanitize_preview_historical_order_snapshots(uuid, text)` so zero bypass mechanism remains in the schema.
2. **Enforce Explicit 16-Order Allowlist & Count Assertion (`Finding SEC-06`):**
   - Filter `admin_sanitize_preview_historical_order_snapshots` with `AND o.order_number = ANY(v_allowed_order_numbers)`.
   - Assert `IF v_sanitized_count NOT IN (0, 16) THEN RAISE EXCEPTION 'Unexpected sanitized row count: % (expected 16 or 0 if already sanitized)', v_sanitized_count; END IF;`.

---

## 4. Final Decision Matrix (All Phase 3 Proposed Operations)

Every proposed operation across the Phase 3 deliverables has been classified below:

| Component ID | Proposed Operation / Deliverable Item | Classification | Mandatory Conditions / Required Revisions Before Execution |
|---|---|---|---|
| **OP-01** | **P1 RLS Policy Split (`campaigns` & `prizes`)** (`PHASE_3_PROPOSED_SECURITY_MIGRATIONS.sql` Part 1) | `APPROVED FOR IMPLEMENTATION` | Validated on local PostgreSQL 18. Fixes anonymous `42501` error on `public.campaigns` and `public.prizes` while keeping `public.is_staff(uuid)` revoked from `anon`. |
| **OP-02** | **Working-Tree Migration `202611070002_preview_clone_alignment_and_isolation.sql` (Line 25 `GRANT EXECUTE ON is_staff TO anon`)** | `BLOCKED` | **CRITICAL (`Finding SEC-07`):** Line 25 grants `EXECUTE` on `public.is_staff(uuid)` to `anon`. Must be deleted or replaced with the Part 1 RLS policy split before any migration runs. |
| **OP-03** | **Order Access Token DB RPCs (`issue_customer_order_access_token` & `verify_order_payment_access`)** (`PHASE_3_PROPOSED_SECURITY_MIGRATIONS.sql` Part 2) | `REQUIRES REVISION` | Must add `p_mode text DEFAULT 'READ'` (`'READ'` vs `'WRITE'`) or a dedicated `consume_order_payment_write_access` check so payment submission marks `used_at = now()` and blocks post-submission write replay (`Finding SEC-04`). |
| **OP-04** | **Order Access Token Helper & Server Action / Page Integration** (`PHASE_3_P0_SECURITY_REMEDIATION_PLAN.md` Section 2.3) | `REQUIRES REVISION` | Must revise 3 items before coding: (1) Remove `?t=` from `createPublicCustomerOrder` redirect URL and use `303 See Other` cookie exchange for recovery links (`Finding SEC-01`); (2) Key rate limiter by `(orderId, clientIp)` and `orderId` instead of `tokenPrefix` (`Finding SEC-02`); (3) Change cookie `Path` from `/buy/order/${orderId}` to `/` (`Finding SEC-03`). |
| **OP-05** | **Historical Order Snapshot Sanitization Trigger & RPC** (`PHASE_3_PROPOSED_SECURITY_MIGRATIONS.sql` Part 3) | `REQUIRES REVISION` | Must revise 2 items before execution: (1) Enforce the explicit 16-order allowlist (`ORD-2026-000031`..`ORD-2026-000046`) and preview `system_settings` check inside `protect_order_payment_snapshot()` AND restore unconditional trigger immediately after one-time sanitization (`Finding SEC-05`); (2) Assert `v_sanitized_count = 16` inside `admin_sanitize_preview_historical_order_snapshots` (`Finding SEC-06`). |
| **OP-06** | **Local Backup Restore Procedure** (`PHASE_3_BACKUP_RESTORE_TEST_PLAN.md`) | `REQUIRES REVISION` | Local PostgreSQL 18.6 restore test (`PHASE_4_LOCAL_RESTORE_TEST_REPORT.md`) succeeded for all 23 tables / `776` rows **after** fixing five defects in the Phase 3 plan: (1) Step 2.2 must start incremental migrations at `202610290003` (not `202610290001`, which is already in `production-public-schema.sql`); (2) Step 2.3 must use a 2-pass insert+update for `public.tickets` (`original_ticket_id <-> reissued_ticket_id` cycle) and topological ordering on `public.seller_messages.parent_message_id`; (3) Step 2.3 must `TRUNCATE public.system_settings, public.roles CASCADE` before inserting backup rows; (4) Step 2.3 must `TRUNCATE public.payment_events` and `TRUNCATE public.audit_logs` before restoring those tables to clear side-effect rows created by `payment_event_log` during `payments` insertion; (5) Update expected backup row total from `686` (`180` `audit_logs`) to the actual backup total of `776` (`270` `audit_logs`). |
| **OP-07** | **Storage Recovery of 5 Synthetic 67-Byte 1x1 PNG Test Fixtures** (`PHASE_3_STORAGE_RECOVERY_REPORT.md` Group A) | `REQUIRES REVISION` | Validated byte-for-byte (`67` bytes, actual SHA-256 `ebf4f635a17d10d6eb46ba680b70142419aa3220f228001a036d311a22ee9d2a` — Phase 3 report listed an incorrect placeholder hash `67a13b...`). Note: these 5 files are synthetic `1x1` transparent PNG E2E test fixtures, not real photographic receipts. |
| **OP-08** | **Storage Recovery of 11 Browser-Uploaded Pre-Clone Preview Files** (`PHASE_3_STORAGE_RECOVERY_REPORT.md` Group B) | `BLOCKED` | **NOT RECOVERABLE:** The 11 original browser-uploaded Preview test images (`3` `SELLER-008` QR JPEGs + `8` payment screenshot JPEGs/PNG) do not exist in Git, local workspace, or `backups/preview-database-backup-20261107.json`. Cannot be restored to original pre-clone bytes. |
| **OP-09** | **Playwright Browser E2E Execution Against Live Preview Deployment** (`PHASE_3_SECURITY_TEST_PLAN.md` Suite 3) | `NOT TESTED` | Intentionally not executed against remote Preview (`jiyuiydzsfydjklosvvq`) during Phase 4 because remote database migrations and code changes are strictly forbidden in `VALIDATION ONLY` mode. |
