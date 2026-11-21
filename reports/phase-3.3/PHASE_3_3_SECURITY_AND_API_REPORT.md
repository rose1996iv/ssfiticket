# SSFI Lucky Draw — Phase 3.3 Security, RBAC & Mobile API Contract Report

**Date:** 2026-11-21  
**Repository:** `F:\PROJECT\Lucky Draw`  
**Branch:** `preview/production-mirror` (`642304442ce0a10a851a8dc2bcaba010d9a57d81`)  

---

## 1. Mobile API v1 Endpoint & Authorization Matrix

Every endpoint under `/api/mobile/v1/*` enforces:
1. Trusted proxy IP rate limiting (`getClientIpFromHeaders` + `checkScopedRateLimit`, failing closed with HTTP `503` + `Retry-After` if distributed Redis rate limiting is unavailable in production).
2. Syntactic & cryptographic Bearer JWT verification via Supabase Auth (`authenticateMobileRequest` → `supabase.auth.getUser(token)`).
3. Fail-closed active profile verification (`profiles.is_active === true` required; missing or inactive profiles receive `403 FORBIDDEN`).
4. Authoritative PostgreSQL role verification (`public.has_role` and `sellers.is_active === true`), with `customerProfileLinked` (`customers.profile_id = auth.user.id`) tracked strictly separately and never merged into `roles[]`.

| Endpoint | Method | Permitted Authority | Backend Business Contract / RPC Reused | Cross-Role / Ownership Isolation Guard |
| --- | --- | --- | --- | --- |
| `/api/mobile/v1/me` | `GET` | Any active authenticated user | `handleMobileMeGet` (`src/lib/auth/mobile.ts`) | Never trusts JWT metadata or client headers |
| `/api/mobile/v1/super-admin/overview` | `GET` | `SUPER_ADMIN` only | `handleMobileSuperAdminOverviewGet` | Denies `ADMIN`, `SELLER`, `CUSTOMER` (`403`) |
| `/api/mobile/v1/super-admin/first-prize-approval` | `POST` | `REQUEST`: `SUPER_ADMIN` only<br>`DECIDE`: `SUPER_ADMIN` or `ADMIN` | `admin_request_first_prize_approval`<br>`admin_record_first_prize_approval` | Policy A four-eyes guard: `initiator_id !== actorUserId` (`403` on self-approval) |
| `/api/mobile/v1/super-admin/sellers/[sellerId]/status` | `POST` | `SUPER_ADMIN` only | `handleMobileSuperAdminSellerStatusPost` | Updates `sellers.is_active` + `profiles.is_active` + writes `audit_logs` |
| `/api/mobile/v1/super-admin/payments/[paymentId]/screenshot` | `GET` | `SUPER_ADMIN` only | `executeDownloadPaymentScreenshot` (`src/lib/payment/screenshotDownload.ts`) | Verifies private `payment-screenshots` bucket, 60s TTL, PII-safe filename, writes audit log |
| `/api/mobile/v1/admin/summary` | `GET` | `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER` | `handleMobileAdminSummaryGet` | Denies `SELLER` and `CUSTOMER` (`403`) |
| `/api/mobile/v1/admin/payments` | `GET` | `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER` | `handleMobileAdminPaymentsGet` | Staff-only payment queue & filters |
| `/api/mobile/v1/admin/payments/[paymentId]` | `GET` | `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER` | `handleMobileAdminPaymentDetailGet` | Staff-only payment/order detail |
| `/api/mobile/v1/admin/payments/[paymentId]/decision` | `POST` | `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER` | `verify_payment_and_issue` → `issue_tickets()`<br>`reject_payment` | Requires `status === 'SUBMITTED'` (idempotency guard); enforces `1,000` ticket cap & sequential `SSFI-XXXXXX` allocation |
| `/api/mobile/v1/admin/lookup` | `GET` | `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER` | `handleMobileAdminLookupGet` | Staff-only directory search (`q.length >= 2`) |
| `/api/mobile/v1/admin/audit-logs` | `GET` | `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER` | `handleMobileAdminAuditLogsGet` | Sanitized audit summaries (no raw tokens/PII) |
| `/api/mobile/v1/seller/dashboard` | `GET` | Active `SELLER` only | `handleMobileSellerDashboardGet` + `evaluateCampaignSchedule` | Scoped strictly to `sellers.profile_id = auth.user.id` and `orders.seller_id = seller.id` |
| `/api/mobile/v1/seller/customers` | `GET` | Active `SELLER` only | `handleMobileSellerCustomerLookupGet` | Scoped strictly to customers on seller's own orders (`seller_owns_customer` boundary) |
| `/api/mobile/v1/seller/orders` | `GET`, `POST` | Active `SELLER` only | `create_seller_order` + immutable `orders.snapshot_*` capture | Requires `seller.is_qr_active && qr_storage_path && upi_id`, `ACTIVE` campaign, and `<= 1,000` cap |
| `/api/mobile/v1/seller/orders/[orderId]` | `GET` | Active `SELLER` only | `handleMobileSellerOrderDetailGet` | Rejects cross-seller order access (`404`) |
| `/api/mobile/v1/seller/orders/[orderId]/screenshot` | `POST` | Active `SELLER` only | `validatePaymentScreenshot` + private `payment-screenshots` bucket + `payment_screenshots` + `payment_events` + `audit_logs` | Canonical seller ownership (`403` cross-seller), magic-byte/MIME/extension/`<= 2 MB` validation, private-bucket fail-closed check (`503`), safe duplicate replacement, never returns `storage_path` or public URL |
| `/api/mobile/v1/seller/orders/[orderId]/payment` | `POST` | Active `SELLER` only | `submit_manual_upi` | Enforces seller ownership (`403`), `PENDING_PAYMENT` state, mandatory screenshot (`payment_screenshots`), and UTR uniqueness |
| `/api/mobile/v1/customer/dashboard` | `GET` | Authenticated user with `customerProfileLinked === true` | `handleMobileCustomerDashboardGet` | Resolves `customers.profile_id = auth.user.id`; returns only own `orders` & `tickets`; public winners return ticket numbers only |
| `/api/mobile/v1/tickets/verify/[ticketNumber]` | `GET` | Any active authenticated user | `handleMobileTicketVerifyGet` | Validates `SSFI-XXXXXX` format, enforces Preview `PRV-` isolation, and returns ticket-number-only status (zero customer PII) |

---

## 2. Mobile Screenshot Upload Contract & Private Storage Security Design

- **Endpoint:** `POST /api/mobile/v1/seller/orders/[orderId]/screenshot` (`multipart/form-data`, field name `screenshot`).
- **Authorization:** Requires valid Bearer JWT, active `profiles.is_active === true`, authoritative `SELLER` role, active `sellers.is_active === true`, and canonical ownership `orders.seller_id = seller.id` (`403 FORBIDDEN` for cross-seller attempts).
- **Content & Filename Validation:**
  - Enforces `1 byte .. 2 MB` (`MAX_PAYMENT_SCREENSHOT_BYTES`).
  - Verifies magic-byte signatures via `validatePaymentScreenshot` (`image/jpeg` `FF D8 FF`, `image/png` `89 50 4E 47 0D 0A 1A 0A`, `image/webp` `RIFF....WEBP`).
  - Validates filename extension against verified MIME via `validateMobileScreenshotFilename` (rejects path traversal `../`, slashes, null bytes, `.svg`, `.exe`, or mismatched extensions).
- **Private Storage & Replacement Safety:**
  - Verifies `payment-screenshots` bucket is strictly private (`bucketInfo.public !== true`); fails closed with `503` otherwise.
  - Stores under random UUID key `${crypto.randomUUID()}.${extension}` (never client filenames, never creates a public URL).
  - Supports safe retries/replacements while payment is `PENDING`, `SUBMITTED`, or `FAILED` (`200 OK`, removes superseded storage object, cleans up new object on DB error); blocks modifications once `VERIFIED`, `REFUNDED`, or `CANCELLED` (`400 BAD_REQUEST`).
  - Writes non-PII `payment_events` (`SCREENSHOT_SUBMITTED` / `SCREENSHOT_REPLACED`) and `audit_logs` (`PAYMENT_SCREENSHOT_UPLOADED` / `PAYMENT_SCREENSHOT_REPLACED`) with zero image bytes, secrets, or customer PII.

## 3. Security Audit Hardening Applied in Finalization

1. **PostgREST Filter-Clause Injection Prevention (`sanitizePostgrestSearchTerm`):** Strips PostgREST `.or()` control characters (`,`, `(`, `)`, `*`, `\`, control chars) and caps query length to `80` chars in `adminLookup`.
2. **Post-Auth Per-User Rate Limiting on Customer & Verification Routes:** Added `checkScopedRateLimit` keyed on verified `auth.user.id` in `handleMobileCustomerDashboardGet` (`mobile_customer_dashboard_user`) and `handleMobileTicketVerifyGet` (`mobile_ticket_verify_user`), matching all staff and seller routes.
3. **Preserved Core Invariants:**
   - `public.issue_tickets()` invoked exclusively via `public.verify_payment_and_issue(p_payment_id, p_actor)` (`1,000` cap, sequential `SSFI-XXXXXX`, atomic `FOR UPDATE`, audit trail).
   - `public.submit_manual_upi` unchanged; mandatory `payment_screenshots` check preserved.
   - Policy A First Prize dual authorization (`SUPER_ADMIN`-only initiation, zero self-approval) preserved.
   - Public ticket verification & certified winners strictly ticket-number-only (zero customer PII, zero sealed draw seeds).
   - Disposable PostgreSQL 18 suite (`phase2bPostgresRLSAndRealtime.test.ts`, `5 / 5 PASS`) confirms direct-write RLS revocation on all 10 hardened tables and exact `supabase_realtime` publication exclusion of sensitive tables.

---

## 4. Exact Remaining Preview Release Dependencies

1. **Preview Vercel Deployment Required for Live On-Device Calls to New `/api/mobile/v1/*` Endpoints:**
   - All 18 new `/api/mobile/v1/*` route handlers (including `/seller/orders/[orderId]/screenshot`) exist in local source and pass all local automated suites (`20 / 20` Phase 3.3 API tests, `35 / 35` Flutter tests, `5 / 5` disposable PG18 tests, `433 / 433` backend tests).
   - Deploying these routes to Preview Vercel requires separate user authorization for Git commit/push and Vercel preview deployment.
2. **Preview Customer Account Linkage for Live Physical-Device `CUSTOMER` UAT:**
   - Preview project `jiyuiydzsfydjklosvvq` currently has `0` rows in `public.customers` with `profile_id IS NOT NULL`; linking a synthetic Preview `customers` row requires separate user authorization before live on-device `CUSTOMER` UAT.
