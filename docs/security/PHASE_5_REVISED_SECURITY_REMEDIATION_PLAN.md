# SSFI — Phase 5: Revised Security Remediation Plan

**Document ID:** `PHASE_5_REVISED_SECURITY_REMEDIATION_PLAN`  
**Date:** 2026-11-07  
**Mode:** `CODE AND DOCUMENT REVISION ONLY` (Zero Remote DB Writes, Zero Storage Mutations, Zero `src/**` Changes)  
**Production Supabase (`fohpqheglxhfdecadhzw`):** `READ-ONLY / UNTOUCHED`  
**Preview Supabase (`jiyuiydzsfydjklosvvq`):** `READ-ONLY / UNTOUCHED`  
**Supersedes:** [`docs/security/PHASE_3_P0_SECURITY_REMEDIATION_PLAN.md`](file:///f:/PROJECT/Lucky%20Draw/docs/security/PHASE_3_P0_SECURITY_REMEDIATION_PLAN.md)  
**Addresses Phase 4 Audit Findings:** `SEC-01`, `SEC-02`, `SEC-03`, `SEC-04`, `SEC-05`, `SEC-06`, `SEC-07`, `SQL-01`..`SQL-04`, `R-1`..`R-5`

---

## 1. Executive Summary of Phase 5 Revisions

| Phase 4 Finding ID | Vulnerability / Defect Identified in Phase 4 Review | Phase 5 Revised Architectural Resolution | Status |
|---|---|---|---|
| **SEC-01** | Bearer token placed in normal checkout URL (`/buy/order/${orderId}?t=${rawOrderToken}`) leaked credentials in browser history, Vercel logs, and `Referer` headers. | **Zero bearer tokens in `/buy/order/[orderId]` URLs.** Same-browser checkout (`createPublicCustomerOrder`) sets the `HttpOnly` cookie directly in the Server Action response and redirects cleanly to `/buy/order/${orderId}`. Cross-device recovery links use a dedicated cookie-exchange route (`GET /api/order-access/exchange?orderId=...&token=...` or `/payment/complete/[token]`) that sets the `HttpOnly` cookie, emits `Referrer-Policy: no-referrer` + `Cache-Control: no-store`, and immediately returns HTTP `303 See Other` to clean `/buy/order/${orderId}`. | `RESOLVED` |
| **SEC-02** | Rate limiter keyed by `order_access:${orderId}:${tokenPrefix}` allowed unlimited brute-force attempts by varying random token prefixes. | **Dual-bucket rate limiting keyed by `(orderId, clientIpHash)` and global `orderId`**, independent of caller-supplied token strings (`10` attempts / 15 min per `(orderId, ipHash)`; `30` attempts / 15 min per `orderId` globally). | `RESOLVED` |
| **SEC-03** | Cookie `Path=/buy/order/${orderId}` prevented Next.js Server Actions invoked from `/payment/complete/[token]` or root endpoints from receiving the cookie. | **Cookie `Path=/`** with order-scoped cookie name `ssfi_order_access_${orderId}` (`HttpOnly; Secure; SameSite=Lax; Max-Age=604800; Path=/`). | `RESOLVED` |
| **SEC-04 / SQL-03** | `verify_order_payment_access` lacked separation between `READ` and `WRITE` operations, either locking out customers from viewing their confirmation page after setting `used_at` or allowing post-submission write replay. | **Explicit 3-mode verification (`'READ'`, `'WRITE'`, `'CONSUME_WRITE'`)** in `public.verify_order_payment_access(p_order_id, p_token_hash, p_access_mode)`. `READ` permits viewing order status until token expiration/revocation; `WRITE` (`uploadPaymentScreenshot`) requires `used_at IS NULL` and `orders.status = 'PENDING_PAYMENT'`; `CONSUME_WRITE` (`submitPublicUpiPayment`) atomically stamps `used_at = now()` so write capability is single-use. | `RESOLVED` |
| **SEC-05 / SQL-01** | Session GUC `ssfi.allow_preview_snapshot_sanitization` in `protect_order_payment_snapshot()` was not reinforced by in-trigger environment/allowlist checks or post-sanitization lockdown. | **Multi-factor in-trigger verification + post-sanitization unconditional lockdown.** `protect_order_payment_snapshot()` verifies inside the trigger body: (1) caller GUC flags, (2) `system_settings.preview_data_mirror_metadata.target_project_ref = 'jiyuiydzsfydjklosvvq'`, (3) `OLD.order_number` in explicit 16-order allowlist, (4) `NEW.snapshot_upi_id ~ '^preview\.[a-z0-9_]+@upi$'`, and (5) immutability of all order/seller identity columns. Companion RPC `lock_order_payment_snapshot_trigger_unconditional()` restores the zero-GUC trigger immediately after execution. | `RESOLVED` |
| **SEC-06 / SQL-02** | `admin_sanitize_preview_historical_order_snapshots` matched dynamically without an explicit 16-order allowlist or `v_sanitized_count IN (0, 16)` assertion. | **Explicit 16-order allowlist (`ORD-2026-000031`..`ORD-2026-000046`) + strict count assertion** (`v_sanitized_count IN (0, 16)` and `v_already_synthetic_count = 16`). | `RESOLVED` |
| **SEC-07** | Working-tree migration `supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql` contained `GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO anon`. | **Removed `anon` grant** from `202611070002_preview_clone_alignment_and_isolation.sql` and created standalone [`docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql`](file:///f:/PROJECT/Lucky%20Draw/docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql) splitting `campaigns` and `prizes` SELECT policies by role while keeping `public.is_staff(uuid)` revoked from `PUBLIC` and `anon`. | `RESOLVED` |

---

## 2. Task 1 — Revised Customer Order Access Token Architecture (P0-1)

### 2.1 End-to-End Customer Authorization Flows (Zero URL Token Leakage)

```mermaid
sequenceDiagram
    autonumber
    actor Customer as Anonymous Customer
    participant Action as createPublicCustomerOrder (Server Action)
    participant Exchange as GET /api/order-access/exchange (Route Handler)
    participant Page as GET /buy/order/[orderId] (Server Component)
    participant Mutate as uploadPaymentScreenshot / submitPublicUpiPayment
    participant DB as Supabase PostgreSQL (RPCs)

    rect rgb(235, 248, 240)
    Note over Customer,DB: Flow A — Same-Browser Checkout (Zero Token in URL)
    Customer->>Action: POST checkout form (sellerCode, customerInfo, quantity)
    Action->>DB: INSERT order + issue_customer_order_access_token(orderId, sha256(rawToken), 7)
    Action-->>Customer: Set-Cookie: ssfi_order_access_<orderId>=<rawToken>; HttpOnly; Secure; SameSite=Lax; Path=/
    Action-->>Customer: Redirect 303 -> /buy/order/<orderId> (CLEAN URL — no ?t=)
    end

    rect rgb(240, 244, 255)
    Note over Customer,DB: Flow B — Cross-Device Recovery Link (Cookie Exchange + 303 Strip)
    Customer->>Exchange: GET /api/order-access/exchange?orderId=<uuid>&token=<rawToken>
    Exchange->>DB: verify_order_payment_access(orderId, sha256(rawToken), 'READ')
    Exchange-->>Customer: Set-Cookie: ssfi_order_access_<orderId>=<rawToken>; HttpOnly; Secure; SameSite=Lax; Path=/
    Exchange-->>Customer: Headers: Referrer-Policy: no-referrer, Cache-Control: no-store
    Exchange-->>Customer: Redirect 303 -> /buy/order/<orderId> (CLEAN URL — token stripped before page render)
    end

    rect rgb(255, 248, 235)
    Note over Customer,DB: Flow C — Authorized Page Render & Single-Use Write Mutations
    Customer->>Page: GET /buy/order/<orderId> (sends HttpOnly cookie)
    Page->>DB: verify_order_payment_access(orderId, sha256(cookieToken), 'READ')
    DB-->>Page: {"authorized": true, "code": "AUTHORIZED_READ"}
    Page-->>Customer: Render payment destination & upload form (Headers: Referrer-Policy: no-referrer)
    Customer->>Mutate: uploadPaymentScreenshot(formData) (sends HttpOnly cookie + Origin header)
    Mutate->>DB: verify_order_payment_access(orderId, sha256(cookieToken), 'WRITE')
    DB-->>Mutate: {"authorized": true, "code": "AUTHORIZED_WRITE"} (requires status=PENDING_PAYMENT & used_at IS NULL)
    Customer->>Mutate: submitPublicUpiPayment(orderId, utr) (sends HttpOnly cookie + Origin header)
    Mutate->>DB: verify_order_payment_access(orderId, sha256(cookieToken), 'CONSUME_WRITE')
    DB-->>Mutate: Sets used_at = now(), returns {"authorized": true, "code": "AUTHORIZED_WRITE_CONSUMED"}
    end
```

### 2.2 Revised Token Security Helper Specification (`src/lib/security/orderAccessToken.ts` — Design Only)

1. **Cryptographic Generation & Hashing:**
   - Raw token: `crypto.randomBytes(32).toString("hex")` (`256` bits of entropy, `64` lowercase hex characters).
   - SHA-256 digest: `crypto.createHash("sha256").update(rawToken.trim().toLowerCase(), "utf8").digest("hex")`.
   - Constant-time hash comparison helper (`safeCompareHexDigests(hashA, hashB)`): uses `crypto.timingSafeEqual(Buffer.from(hashA, "hex"), Buffer.from(hashB, "hex"))`.
   - **Strict Redaction Rule:** Never log `rawToken` or `tokenHash` in console logs, error messages, or `public.audit_logs`.
2. **Cookie Specification (`SEC-01`, `SEC-03`):**
   - **Cookie Name:** `ssfi_order_access_${orderId.toLowerCase()}` (order-scoped so a customer purchasing multiple orders in the same browser retains independent cookies per order).
   - **Cookie Attributes:**
     - `httpOnly: true` (inaccessible to `document.cookie` / XSS).
     - `secure: process.env.NODE_ENV === "production"` (HTTPS-only in Preview/Production deployments).
     - `sameSite: "lax"` (sent on top-level GET navigations and same-origin Server Action POSTs; blocked on cross-site POSTs).
     - `path: "/"` (`SEC-03` fix: ensures cookie is sent to `/buy/order/[orderId]`, `/payment/complete/[token]`, `/api/order-access/exchange`, and Next.js Server Action POST endpoints).
     - `maxAge: 7 * 24 * 60 * 60` (`604,800` seconds = 7 days, matching DB `expires_at`).
3. **Dual-Bucket Rate Limiting (`SEC-02`):**
   - Client IP is normalized and hashed with a daily rotating or environment salt (`ipHash = sha256(clientIp + RATE_LIMIT_SALT).slice(0, 16)`) so raw IP addresses are not stored in memory/logs.
   - **Bucket 1 — Per `(orderId, ipHash)`:** Key `rl:order_ip:${orderId}:${ipHash}`, limit **10 verification checks per 15 minutes** (`900,000` ms).
   - **Bucket 2 — Global Per `orderId`:** Key `rl:order_global:${orderId}`, limit **30 failed verification checks per 15 minutes** (`900,000` ms).
   - Rate limit buckets are checked **before** querying PostgreSQL and incremented on any failed verification (`!result.authorized`), defeating random-token brute-force attacks regardless of token prefix.
4. **CSRF & Referrer / Browser-History Leakage Protection (`SEC-01`, `SEC-03`):**
   - **No `?t=` on `/buy/order/[orderId]`:** `/buy/order/[orderId]/page.tsx` reads **only** the `HttpOnly` cookie `ssfi_order_access_${orderId}` (or an authenticated staff/seller session). If a user visits `/buy/order/[orderId]?t=...`, the page ignores `?t=` and redirects (`303`) to `/api/order-access/exchange` or strips the query string before rendering any sensitive data.
   - **Response Headers on `/buy/order/[orderId]` and `/api/order-access/exchange`:**
     - `Referrer-Policy: no-referrer`
     - `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`
     - `X-Robots-Tag: noindex, nofollow, noarchive`
   - **Server Action Origin Verification (`assertSameOriginAction()`):**
     - `uploadPaymentScreenshot` and `submitPublicUpiPayment` verify that the request `Origin` header host matches the `Host` / `X-Forwarded-Host` header before executing any database or storage operation.
5. **Authorization Matrix Across All Order Access Points:**

| Endpoint / Action | Allowed Callers | Token Mode Required | Unauthorized Behavior |
|---|---|---|---|
| `GET /buy/order/[orderId]` | (1) Anonymous customer with valid `ssfi_order_access_${orderId}` cookie; (2) Authenticated owning Seller (`sellers.id = orders.seller_id`); (3) Authenticated Staff (`is_staff(auth.uid())`) | `'READ'` | Render generic **"Payment Link Required or Expired"** card; **zero** `snapshot_upi_id`, `snapshot_payee_name`, `snapshot_qr_url`, customer PII, or signed Storage URLs fetched or rendered. |
| `GET /api/order-access/exchange` | Anonymous customer clicking recovery link (`orderId` + `token`) | `'READ'` | If valid: set `HttpOnly` cookie + `303 See Other` -> `/buy/order/[orderId]`. If invalid/expired/revoked: `303 See Other` -> `/buy/order/[orderId]?error=invalid_token` (without token in URL). |
| `uploadPaymentScreenshot` (Server Action) | Anonymous customer with valid `ssfi_order_access_${orderId}` cookie (or owning Seller / Staff) | `'WRITE'` | Reject with `403 Unauthorized` before reading file buffer or calling Supabase Storage if token is missing, expired, revoked, `used_at IS NOT NULL`, or `orders.status <> 'PENDING_PAYMENT'`. |
| `submitPublicUpiPayment` (Server Action) | Anonymous customer with valid `ssfi_order_access_${orderId}` cookie | `'CONSUME_WRITE'` | Atomically verifies `status = 'PENDING_PAYMENT'` and `used_at IS NULL`, stamps `used_at = now()`, and submits UTR. Any subsequent replay returns `TOKEN_WRITE_ALREADY_CONSUMED`. |

---

## 3. Task 2 — Revised Historical Preview Order Snapshot Sanitization (P0-2)

### 3.1 Multi-Layer Defense in `PHASE_5_REVISED_SECURITY_MIGRATIONS.sql` (`SEC-05` & `SEC-06`)

1. **Trigger Never Disabled:** `trg_protect_order_payment_snapshot` remains enabled (`tgenabled = 'O'`) at all times.
2. **In-Trigger Environment, Allowlist, and Format Enforcement (`SEC-05`):**
   - Even if a malicious or buggy SQL session executes `PERFORM set_config('ssfi.allow_preview_snapshot_sanitization', 'true', true)`, `public.protect_order_payment_snapshot()` rejects the update unless **all** of the following hold inside the trigger itself:
     - `current_setting('ssfi.sanitization_caller', true) = 'admin_sanitize_preview_historical_order_snapshots'`
     - `coalesce(current_setting('app.settings.project_ref', true), '') <> 'fohpqheglxhfdecadhzw'`
     - `public.system_settings` row `'preview_data_mirror_metadata'` has `value->>'target_project_ref' = 'jiyuiydzsfydjklosvvq'`
     - `OLD.order_number` is one of the **16 explicitly allowlisted order numbers**:
       `ORD-2026-000031`, `ORD-2026-000032`, `ORD-2026-000033`, `ORD-2026-000034`, `ORD-2026-000035`, `ORD-2026-000036`, `ORD-2026-000037`, `ORD-2026-000038`, `ORD-2026-000039`, `ORD-2026-000040`, `ORD-2026-000041`, `ORD-2026-000042`, `ORD-2026-000043`, `ORD-2026-000044`, `ORD-2026-000045`, `ORD-2026-000046`
     - `NEW.snapshot_upi_id ~ '^preview\.[a-z0-9_]+@upi$'`
     - All order/seller identity columns (`id`, `order_number`, `customer_id`, `seller_id`, `campaign_id`, `snapshot_seller_id`, `snapshot_seller_code`, `snapshot_seller_name`, `snapshot_captured_at`) are unchanged (`IS NOT DISTINCT FROM`).
3. **Post-Execution Unconditional Trigger Lockdown:**
   - Immediately after running `admin_sanitize_preview_historical_order_snapshots`, calling `SELECT public.lock_order_payment_snapshot_trigger_unconditional();` replaces `public.protect_order_payment_snapshot()` with its unconditional body (zero GUC branch).
4. **RPC Safeguards (`SEC-06`):**
   - Verifies `public.has_role(p_actor_user_id, 'SUPER_ADMIN')`.
   - Verifies all 16 allowlisted orders exist (`v_total_allowlist_present = 16`).
   - Updates only allowlisted rows where `snapshot_upi_id !~ '^preview\.[a-z0-9_]+@upi$'`.
   - Writes transactional `public.audit_logs` entries with `redacted_previous = true` and zero raw historical UPIs.
   - Asserts `v_sanitized_count IN (0, 16)` and `v_already_synthetic_count = 16` before returning.

---

## 4. Task 3 — Resolution of Migration Conflict (`SEC-07`)

1. **Repository Migration Updated (`supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql`):**
   - Removed the unsafe `GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO anon, authenticated, service_role;` on line 25 and replaced it with:
     ```sql
     REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
     GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;
     ```
2. **Standalone Proposed RLS Policy Migration Created (`docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql`):**
   - Splits `campaigns_public_read` into `campaigns_anon_active_read` (`FOR SELECT TO anon USING (status = 'ACTIVE')`) and `campaigns_authenticated_read` (`FOR SELECT TO authenticated USING (status = 'ACTIVE' OR public.is_staff(auth.uid()))`).
   - Splits `prizes_public_read` into `prizes_anon_active_read` (`FOR SELECT TO anon`) and `prizes_authenticated_read` (`FOR SELECT TO authenticated`).
   - Keeps `public.is_staff(uuid)` strictly uncallable by `PUBLIC` and `anon`.

