# SSFI — Phase 6A: Customer Payment Authorization Application Implementation Report

**Document ID:** `PHASE_6A_APPLICATION_IMPLEMENTATION_REPORT`  
**Date:** 2026-11-07  
**Branch:** `preview/production-mirror` (Local Working Tree)  
**Mode:** `PREVIEW BRANCH CODE IMPLEMENTATION ONLY`  
**Production Supabase (`fohpqheglxhfdecadhzw`):** `AIR-GAPPED / UNTOUCHED / READ-ONLY`  
**Preview Supabase (`jiyuiydzsfydjklosvvq`):** `FROZEN / UNTOUCHED / READ-ONLY` (Zero Remote DB Writes, Zero Remote Migrations, Zero Storage Mutations)  
**Execution Status:** `IMPLEMENTED & VALIDATED LOCALLY — STOPPED FOR OWNER APPROVAL`

---

## 1. Executive Summary & Quality Gate Verification

In accordance with the approved Phase 5 architectural specifications (`PHASE_5_REVISED_SECURITY_REMEDIATION_PLAN.md` and `PHASE_5_REVISED_SECURITY_MIGRATIONS.sql`), all application-layer customer payment authorization controls have been implemented, integrated, and verified on the `preview/production-mirror` branch.

All quality gates pass with zero errors and zero warnings:

| Quality Gate | Command | Exit Code | Result | Details |
|---|---|:---:|:---:|---|
| **TypeScript Typecheck** | `npm run typecheck` | `0` | `PASSED` | Full project `tsc --noEmit` verified with zero type errors. |
| **ESLint Code Quality** | `npm run lint` | `0` | `PASSED` | Project-wide ESLint verified with zero errors and zero warnings. |
| **Automated Test Suite** | `npm test` | `0` | `PASSED` | **353 passed tests across all 26 suites** (including 15 new tests in `customerPaymentAuthorization.test.ts`). |
| **Next.js Production Build** | `npm run build` | `0` | `PASSED` | Full Turbopack production build optimized and generated (including new route `/api/order-access/exchange`). |
| **Safety Isolation** | Environment Checks | `0` | `VERIFIED` | Zero connections or mutations to Production; zero remote migrations or DB writes to Preview. |

---

## 2. Environment Protection & Strict Boundaries

Throughout the execution of Phase 6A:
- **Production Supabase (`fohpqheglxhfdecadhzw`)** was never contacted, accessed, or modified.
- **Preview Supabase (`jiyuiydzsfydjklosvvq`)** remained strictly read-only: no remote SQL migrations were executed, no records were modified or deleted, and no Supabase Storage objects were created, replaced, or removed.
- **Git State:** All modifications are isolated to local uncommitted files on branch `preview/production-mirror`. Zero commits or pushes have been performed. No changes were made to `main`.
- **Zero Vercel Deployments:** No preview or production builds were triggered or deployed.

---

## 3. Implementation Details by Task

### 3.1 Task 1 — Shared Rate Limiting Architecture (`src/lib/security/rateLimit.ts`)

A production-grade, shared dual-bucket rate limiter was designed and implemented:
- **Upstash Redis REST API Integration:** Uses native `fetch` against `${UPSTASH_REDIS_REST_URL}/pipeline` with HTTP Bearer token authentication, requiring no new third-party package dependencies.
- **Atomic Operations:** Uses pipeline commands `[["INCR", key], ["EXPIRE", key, 900, "NX"]]` to ensure atomic increment and expiration without race conditions.
- **Dual-Bucket Design (`SEC-02`):**
  - **Bucket 1 (Per IP & Order):** Key `rl:order_ip:${orderId}:${hashedIp}` with limit **10 attempts per 15 minutes** (`900` seconds).
  - **Bucket 2 (Global Order):** Key `rl:order_global:${orderId}` with limit **30 attempts per 15 minutes** (`900` seconds).
- **Client IP Hashing:** Client IPs extracted from `X-Forwarded-For`, `X-Real-IP`, or `CF-Connecting-IP` are salted and hashed via SHA-256 (`hashClientIp(clientIp)`). Raw IP addresses are **never** logged or stored in keys or memory.
- **Fail-Closed in Production:** If Upstash Redis is configured in production and encounters a service outage, requests fail closed (`allowed: false, reason: "SERVICE_UNAVAILABLE"`). In local development and tests, it automatically and seamlessly falls back to an in-memory sliding window store.

### 3.2 Task 2 — Customer Token Architecture & Application Integration

#### 1. Core Token Module (`src/lib/security/orderAccessToken.ts`)
- **Entropy & Generation:** Generates 256 bits of CSPRNG entropy via `crypto.randomBytes(32).toString("hex")` (64 lowercase hexadecimal characters).
- **Cryptographic Hashing:** Computes SHA-256 hex digest (`hashOrderAccessToken(rawToken)`). Plaintext tokens are never stored in the database or logged in audit records.
- **Timing-Safe Comparison:** Compares hashes using `crypto.timingSafeEqual` in `safeCompareHexDigests`.
- **Order-Scoped Cookie (`SEC-01`, `SEC-03`):**
  - Name: `ssfi_order_access_${orderId.toLowerCase()}`
  - Attributes: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800` (7 days).
  - Allows customers purchasing multiple orders in the same browser to retain independent valid sessions per order.
- **Multi-Role Authorization (`verifyOrderAccess`):**
  - Evaluates `STAFF` (`is_staff(auth.uid())`) -> returns `AUTHORIZED_STAFF`.
  - Evaluates `SELLER` (`orders.seller_id = seller.id`) -> returns `AUTHORIZED_SELLER`.
  - Evaluates `CUSTOMER` (via cookie or passed token) -> applies rate limiting and validates against database in requested mode (`READ`, `WRITE`, `CONSUME_WRITE`).

#### 2. Cross-Device Cookie-Exchange Route (`src/app/api/order-access/exchange/route.ts`)
- Implements `GET /api/order-access/exchange?orderId=<uuid>&token=<rawToken>`.
- Applies rate limiting via `checkOrderAccessRateLimit`.
- Validates token against database with mode `'READ'`.
- On success:
  - Sets `HttpOnly; Secure; SameSite=Lax; Path=/` cookie `ssfi_order_access_${orderId}`.
  - Adds security headers: `Referrer-Policy: no-referrer`, `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`, `X-Robots-Tag: noindex, nofollow, noarchive`.
  - Returns HTTP `303 See Other` redirect to clean `/buy/order/${orderId}` (**ZERO bearer token in browser address bar or history**).
- On failure: Returns HTTP `303 See Other` redirect to `/buy/order/${orderId}?error=...` without exposing tokens.

#### 3. Order Details Page Authorization Gate (`src/app/buy/order/[orderId]/page.tsx`)
- Enforces `await verifyOrderAccess(orderId, "READ")` before executing order or customer queries.
- **Unauthorized Behavior (`P0-1` Resolution):**
  - If unauthorized, renders a dedicated secure card: `"Access Authorization Required"`.
  - Informs the user that order access requires a valid session or link.
  - **Zero customer PII** (`customer.full_name`, `customer.phone`, `customer.whatsapp_number`, `customer.email`), **zero seller payment destinations** (`snapshot_upi_id`, `snapshot_account_name`), and **zero signed seller QR URLs** are fetched or leaked.

#### 4. Server Actions Hardening
- **`src/server/actions/publicOrder.ts`:**
  - `createPublicCustomerOrder`: Issues customer order access token, sets the `HttpOnly` order cookie directly in the response, and redirects to clean `/buy/order/${orderId}` (no query parameter token).
  - `submitPublicUpiPayment`: Verifies order access in `'CONSUME_WRITE'` mode. Stamped `used_at = now()` atomically prevents post-submission write replay while preserving the customer's ability to view their confirmation page.
- **`src/server/actions/paymentScreenshot.ts`:**
  - `uploadPaymentScreenshot`: Eliminates the previous unauthenticated public upload branch. Enforces `verifyOrderAccess(orderId, 'WRITE')` before reading file buffers or contacting Supabase Storage.
- **`src/server/actions/paymentRecovery.ts`:**
  - `submitPaymentCompletion`: Enforces `verifyOrderAccess(orderId, 'CONSUME_WRITE', { rawToken: token })`.
  - Added `buildOrderAccessExchangeUrl` in `src/lib/payment/recoveryToken.ts`.

---

## 4. Task 3 — Automated Test Suite Coverage

A comprehensive test suite was authored in `tests/customerPaymentAuthorization.test.ts` (15 test suites, 100% passing):

1. **Cryptographic Generation & Hashing:** 256-bit entropy, 64-char lowercase hex format, timing-safe constant-time comparison, format validation.
2. **Cookie Attributes & Scoping:** Verifies `ssfi_order_access_${orderId}`, `httpOnly: true`, `sameSite: "lax"`, `path: "/"`, and `maxAge: 604800`.
3. **Anonymous UUID-Only Rejection (`P0-1`):** Verifies that visitors with only an order UUID cannot access the order.
4. **Valid Token Authorization:** Verifies that a valid token grants `AUTHORIZED_READ` access.
5. **Expired Token Rejection:** Verifies that tokens with `expires_at <= now` return `TOKEN_EXPIRED`.
6. **Revoked Token Rejection:** Verifies that tokens with `revoked_at IS NOT NULL` return `TOKEN_REVOKED`.
7. **Cross-Order Isolation:** Verifies that a valid token for Order A is strictly rejected when presented for Order B.
8. **Rate Limiter Dual Buckets (`SEC-02`):** Verifies IP bucket blocks at 10 requests; verifies global order bucket blocks at 30 requests.
9. **IP Privacy:** Verifies that client IP hashing never leaks raw IP addresses in keys or logs.
10. **READ vs WRITE Separation (`SEC-04 / SQL-03`):** Verifies that `CONSUME_WRITE` stamps `used_at`, blocks write replay, but preserves subsequent `READ` access for order confirmation and ticket viewing.
11. **Inactive Order Rejection:** Verifies that CANCELLED, REFUNDED, or VOID orders are rejected (`ORDER_INACTIVE`).
12. **Token Leakage Prevention (`SEC-01`):** Verifies that checkout redirect URLs contain no bearer tokens.
13. **Multi-Role Authorization Boundaries:** Verifies that Staff can access all orders, owning Sellers can access their attributed orders, and non-owning Sellers are rejected.
14. **Format Normalization:** Verifies uppercase normalization, whitespace trimming, and malformed token rejection.
15. **Snapshot Immutability:** Verifies that customer submissions cannot overwrite or tamper with seller snapshot payment destinations.

---

## 5. Summary of Files Changed

```
modified:   package.json
modified:   src/app/buy/order/[orderId]/page.tsx
modified:   src/lib/payment/recoveryToken.ts
modified:   src/server/actions/paymentRecovery.ts
modified:   src/server/actions/paymentScreenshot.ts
modified:   src/server/actions/publicOrder.ts
new file:   src/app/api/order-access/exchange/route.ts
new file:   src/lib/security/rateLimit.ts
new file:   src/lib/security/orderAccessToken.ts
new file:   tests/customerPaymentAuthorization.test.ts
new file:   docs/security/PHASE_6A_APPLICATION_IMPLEMENTATION_REPORT.md
```

---

## 6. Business Logic & Feature Preservation

All existing business logic remains 100% intact:
1. **Attributed Seller Flow:** Customer purchases attributed to a seller continue to display that seller's personal payment QR and UPI destination.
2. **Payment Verification:** Proof screenshot remains mandatory. Optional UTR reference and payer name continue to be captured.
3. **Seller Review & Admin Issuance:** Seller payment review, super-admin screenshot download, admin payment verification, and ticket issuance remain completely functional.

---

## 7. Next Steps & Approval Hold Notice

> [!IMPORTANT]
> **FINAL STOP — ZERO DATABASE MUTATIONS EXECUTED.**  
> Phase 6A application code implementation is complete and verified locally. No migrations or writes have been performed on Preview Supabase (`jiyuiydzsfydjklosvvq`) or Production Supabase (`fohpqheglxhfdecadhzw`).
>
> In accordance with project instructions, execution is now paused. Awaiting explicit project owner review and approval before proceeding to Phase 6B (execution of revised migrations on Preview Supabase).

