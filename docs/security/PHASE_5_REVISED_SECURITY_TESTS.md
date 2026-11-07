# SSFI — Phase 5: Revised Security Test Plan & Local Execution Report

**Document ID:** `PHASE_5_REVISED_SECURITY_TESTS`  
**Date:** 2026-11-07  
**Mode:** `CODE AND DOCUMENT REVISION ONLY` (Executed on Isolated Local Disposable PostgreSQL 18.6 `127.0.0.1:54399`)  
**Production Supabase (`fohpqheglxhfdecadhzw`):** `READ-ONLY / UNTOUCHED`  
**Preview Supabase (`jiyuiydzsfydjklosvvq`):** `READ-ONLY / UNTOUCHED`  
**Supersedes:** [`docs/security/PHASE_3_SECURITY_TEST_PLAN.md`](file:///f:/PROJECT/Lucky%20Draw/docs/security/PHASE_3_SECURITY_TEST_PLAN.md)

---

## 1. Executive Summary

A complete automated security test suite (`scratch/run_phase5_security_tests.mjs`) was authored and executed against an isolated local disposable **PostgreSQL 18.6** database (`127.0.0.1:54399`) restored with the verified **776-row / 23-table** pre-clone Preview baseline and migrated with:
1. [`supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql`](file:///f:/PROJECT/Lucky%20Draw/supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql) *(revised with `REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon`)*
2. [`docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql`](file:///f:/PROJECT/Lucky%20Draw/docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql)
3. [`docs/security/PHASE_5_REVISED_SECURITY_MIGRATIONS.sql`](file:///f:/PROJECT/Lucky%20Draw/docs/security/PHASE_5_REVISED_SECURITY_MIGRATIONS.sql)

### Test Execution Summary

| Suite ID | Security Test Category | Target Finding(s) | Execution Environment | Result |
|---|---|---|---|---|
| **T01** | Token Leakage, Cookie Attributes & Referrer/History Protection | `SEC-01`, `SEC-03` | Local Node.js + PG 18.6 | `PASS` |
| **T02** | Token Expiration Enforcement (`expires_at <= now()`) | `P0-1` | Local PG 18.6 | `PASS` |
| **T03** | Token Revocation on Re-Issue (`revoked = true`) | `P0-1` | Local PG 18.6 | `PASS` |
| **T04** | Cross-Order Token Reuse Isolation (`Order A` token on `Order B`) | `P0-1` | Local PG 18.6 | `PASS` |
| **T05** | Rate-Limit Bypass Attempts (Random Token Prefix & Distributed IP Attacks) | `SEC-02` | Local Node.js | `PASS` |
| **T06** | `READ` vs. `WRITE` vs. `CONSUME_WRITE` Authorization Separation | `SEC-04`, `SQL-03` | Local PG 18.6 | `PASS` |
| **T07** | Anonymous Order Access Without Valid Token | `P0-1` | Local PG 18.6 | `PASS` |
| **T08** | Historical Sanitization Allowlist, In-Trigger Guards & Unconditional Lockdown | `SEC-05`, `SEC-06`, `SQL-01`, `SQL-02` | Local PG 18.6 | `PASS` |
| **T09** | Unauthorized RPC Execution (`anon`, `authenticated`, Non-`SUPER_ADMIN`) | `P0-1`, `P0-2` | Local PG 18.6 | `PASS` |
| **T10** | RLS Policy Split (`campaigns` & `prizes`) & `is_staff(uuid)` Revocation | `SEC-07`, `P1` | Local PG 18.6 | `PASS` |

---

## 2. Detailed Test Specifications & Local Verification Assertions

### T01 — Token Leakage, Cookie Attributes & Referrer/History Protection (`SEC-01`, `SEC-03`)
- **Objective:** Prove that bearer tokens never appear in normal checkout redirect URLs, cross-device exchange responses strip the token via `303 See Other`, cookies enforce `HttpOnly; Secure; SameSite=Lax; Path=/`, and raw tokens are never stored in `public.payment_recovery_tokens`.
- **Verified Assertions:**
  - `checkoutRes.location === "/buy/order/<orderId>"` (`!location.includes("?t=")` and `!location.includes(rawToken)`).
  - `Set-Cookie` header matches `^ssfi_order_access_<orderId>=<64-hex>; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax`.
  - Response headers include `Referrer-Policy: no-referrer`, `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`, and `X-Robots-Tag: noindex, nofollow, noarchive`.
  - Cross-device exchange route returns `303 See Other` to `/buy/order/<orderId>` with zero query string.
  - `SELECT count(*) FROM public.payment_recovery_tokens WHERE token_hash = '<rawToken>'` equals `0`.

### T02 — Token Expiration Enforcement
- **Objective:** Prove that an expired token (`expires_at = now() - interval '1 minute'`) is deterministically rejected.
- **Verified Assertions:**
  - `public.verify_order_payment_access(orderB, expiredHash, 'READ')` returns `{"authorized": false, "code": "TOKEN_EXPIRED"}`.

### T03 — Token Revocation on Re-Issue
- **Objective:** Prove that issuing a replacement token for an order automatically revokes all previous active tokens for that order.
- **Verified Assertions:**
  - Issuing `token2` after `token1` on `ORD-2026-000041` returns `revoked_prior_tokens >= 1`.
  - Verifying `token1` returns `{"authorized": false, "code": "TOKEN_REVOKED"}`.
  - Verifying `token2` returns `{"authorized": true, "code": "AUTHORIZED_READ"}`.

### T04 — Cross-Order Token Reuse Isolation
- **Objective:** Prove that a valid token issued for `Order A` (`ORD-2026-000041`) cannot authorize access to `Order B` (`ORD-2026-000042`).
- **Verified Assertions:**
  - `public.verify_order_payment_access(orderB, tokenA.tokenHash, 'READ')` returns `{"authorized": false, "code": "UNAUTHORIZED"}`.

### T05 — Rate-Limit Bypass Attempts (`SEC-02`)
- **Objective:** Prove that varying random token prefixes on each request cannot bypass rate limiting, and that distributed multi-IP brute-force attacks against a single `orderId` are throttled by the global per-order bucket.
- **Verified Assertions:**
  - Attacker submitting 10 failed attempts with 10 distinct random token prefixes from `203.0.113.55` is blocked on attempt `#11` with `RATE_LIMITED_IP_BUCKET`.
  - Distributed attacker submitting 20 additional failed attempts across 20 distinct IPs (`198.51.100.1..20`) against the same `orderId` is blocked on global attempt `#31` with `RATE_LIMITED_ORDER_GLOBAL_BUCKET`.

### T06 — `READ` vs. `WRITE` vs. `CONSUME_WRITE` Authorization (`SEC-04`, `SQL-03`)
- **Objective:** Prove that `WRITE` access (`uploadPaymentScreenshot`) is permitted while `orders.status = 'PENDING_PAYMENT'` and `used_at IS NULL`, `CONSUME_WRITE` (`submitPublicUpiPayment`) atomically sets `used_at = now()`, subsequent `WRITE` or `CONSUME_WRITE` replay attempts are blocked, and `READ` access continues to succeed so the customer can view their confirmation page and issued tickets.
- **Verified Assertions:**
  1. `verify_order_payment_access(orderA, hash, 'WRITE')` -> `{"authorized": true, "code": "AUTHORIZED_WRITE"}`.
  2. `verify_order_payment_access(orderA, hash, 'CONSUME_WRITE')` -> `{"authorized": true, "code": "AUTHORIZED_WRITE_CONSUMED", "write_consumed_at": "<timestamp>"}`.
  3. Replay `verify_order_payment_access(orderA, hash, 'WRITE')` -> `{"authorized": false, "code": "TOKEN_WRITE_ALREADY_CONSUMED"}`.
  4. Replay `verify_order_payment_access(orderA, hash, 'CONSUME_WRITE')` -> `{"authorized": false, "code": "TOKEN_WRITE_ALREADY_CONSUMED"}`.
  5. Post-submission `verify_order_payment_access(orderA, hash, 'READ')` -> `{"authorized": true, "code": "AUTHORIZED_READ"}`.

### T07 — Anonymous Order Access Without Valid Token
- **Objective:** Prove that accessing an order with an empty, malformed, or unissued token is rejected.
- **Verified Assertions:**
  - Empty token hash `""` -> `{"authorized": false, "code": "INVALID_TOKEN_HASH"}`.
  - Unissued 64-char SHA-256 hash -> `{"authorized": false, "code": "UNAUTHORIZED"}`.

### T08 — Historical Sanitization Allowlist, In-Trigger Guards & Unconditional Lockdown (`SEC-05`, `SEC-06`)
- **Objective:** Prove that `protect_order_payment_snapshot()` blocks non-allowlisted orders and non-synthetic UPIs even when transaction-local GUC flags are set, that `admin_sanitize_preview_historical_order_snapshots` sanitizes the exact 16 allowlisted orders (`ORD-2026-000031`..`ORD-2026-000046`) idempotently with transactional redacted audit logs, and that `lock_order_payment_snapshot_trigger_unconditional()` locks the trigger unconditionally afterwards.
- **Verified Assertions:**
  - **8a (Non-Allowlisted Order Blocked):** Setting both GUC flags (`ssfi.allow_preview_snapshot_sanitization = 'true'` and `ssfi.sanitization_caller = 'admin_sanitize_preview_historical_order_snapshots'`) and running `UPDATE public.orders SET snapshot_upi_id = 'preview.hacked@upi' WHERE order_number = 'ORD-2026-000018'` throws `P0001: Order payment snapshot fields are immutable once captured`.
  - **8b (Non-Synthetic UPI Blocked):** Setting both GUC flags and running `UPDATE public.orders SET snapshot_upi_id = 'real.attacker@okaxis' WHERE order_number = 'ORD-2026-000041'` throws `P0001`.
  - **8c (Authorized Sanitization Run 1):** Returns `{"success": true, "sanitized_orders_count": 16, "verified_synthetic_allowlist_count": 16, "already_sanitized": false}` and inserts 16 `PREVIEW_HISTORICAL_SNAPSHOT_SANITIZED` rows in `public.audit_logs`.
  - **8d (Idempotent Run 2):** Returns `{"success": true, "sanitized_orders_count": 0, "verified_synthetic_allowlist_count": 16, "already_sanitized": true}`.
  - **8e (Unconditional Lockdown):** `SELECT public.lock_order_payment_snapshot_trigger_unconditional()` returns `{"locked_unconditional": true}`.

### T09 — Unauthorized RPC Execution Blocked
- **Objective:** Prove that `anon` and `authenticated` roles cannot call `SECURITY DEFINER` token or sanitization RPCs directly, and that non-`SUPER_ADMIN` staff profiles are rejected by `admin_sanitize_preview_historical_order_snapshots`.
- **Verified Assertions:**
  - `SET LOCAL ROLE anon; SELECT public.issue_customer_order_access_token(...)` -> blocked (`42501 permission denied`).
  - `SET LOCAL ROLE authenticated; SELECT public.verify_order_payment_access(...)` -> blocked (`42501 permission denied`).
  - `SELECT public.admin_sanitize_preview_historical_order_snapshots('<seller_profile_id>', ...)` -> blocked (`42501 Forbidden: Only SUPER_ADMIN may execute...`).

### T10 — RLS Policy Behavior (`campaigns` & `prizes`) & `is_staff(uuid)` Revocation (`SEC-07`, `P1`)
- **Objective:** Prove that anonymous visitors can query active campaigns and prizes without triggering `42501`, while `public.is_staff(uuid)` remains strictly uncallable by `anon`.
- **Verified Assertions:**
  - `SET LOCAL ROLE anon; SELECT count(*) FROM public.campaigns;` -> returns `1`.
  - `SET LOCAL ROLE anon; SELECT count(*) FROM public.prizes;` -> returns `5`.
  - `SET LOCAL ROLE anon; SELECT public.is_staff('00000000-0000-0000-0000-000000000000');` -> blocked (`42501 permission denied for function is_staff`).

---

## 3. Local Disposable PostgreSQL 18.6 Test Execution Proof

Executed via `scratch/run_phase5_security_tests.mjs` on `2026-11-07T12:22:45.765Z` (`PostgreSQL 18.6 on x86_64-windows, compiled by msvc-19.44.35229, 64-bit`):

```json
{
  "executedAt": "2026-11-07T12:22:45.765Z",
  "postgresVersion": "PostgreSQL 18.6 on x86_64-windows, compiled by msvc-19.44.35229, 64-bit",
  "restoredRows": 776,
  "testsPassed": 10,
  "testsFailed": 0,
  "teardownCompleted": true
}
```

---

## 4. Remaining Issues & Unresolved Assumptions

1. **In-Memory Rate Limiter vs. Multi-Instance Serverless Deployment:**
   - The dual-bucket rate limiter (`rl:order_ip:${orderId}:${ipHash}` and `rl:order_global:${orderId}`) in `orderAccessToken.ts` uses an in-process LRU/TTL map unless backed by Redis/Upstash or a PostgreSQL rate-limit counter table. On Vercel serverless functions, cold starts or concurrent instances do not share in-process memory, although the 256-bit ($2^{256}$) CSPRNG token entropy makes online brute-forcing computationally impossible regardless of instance count.
2. **Pre-Existing Historical Orders Created Before Token Rollout:**
   - Existing Preview orders created prior to deploying `createPublicCustomerOrder` token issuance will not have a browser cookie on the customer's device; accessing `/buy/order/[orderId]` as an anonymous customer for those historical orders will require either an Admin-issued recovery link (`/payment/complete/[token]` / `/api/order-access/exchange`) or an authenticated Seller/Staff session.
3. **11 Unrecoverable Pre-Clone Preview Storage Binaries:**
   - As documented in [`PHASE_4_STORAGE_RECOVERY_VALIDATION.md`](file:///f:/PROJECT/Lucky%20Draw/docs/security/PHASE_4_STORAGE_RECOVERY_VALIDATION.md), 11 of the 16 overwritten Preview Storage files (`3` `SELLER-008` JPEG QR uploads + `8` browser-uploaded payment screenshots) have no local or Git binary backup and remain permanently unrecoverable (`BLOCKED`).
4. **Pending Application Code (`src/**`) & Remote Preview Execution:**
   - Because Phase 5 operated under strict `CODE AND DOCUMENT REVISION ONLY` rules, `src/**` files (`src/app/buy/order/[orderId]/page.tsx`, `src/app/buy/actions.ts`, `src/app/orders/[orderId]/payment-actions.ts`, `src/lib/security/orderAccessToken.ts`) and remote Preview Supabase (`jiyuiydzsfydjklosvvq`) have **not** yet been modified.

