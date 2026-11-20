# SSFI Lucky Draw — Phase 2C-R: Security Remediation Report (Local Only)

**Date:** 2026-11-20  
**Repository:** `F:\PROJECT\Lucky Draw`  
**Branch:** `preview/production-mirror`  
**HEAD Commit (Unchanged):** `f15d6a45d2ea1ef150aa85f65d7242940a5dbe8d`  
**Final Verdict:** **`PASS`**

---

## 1. Executive Summary

All seven confirmed findings from the Phase 2C Independent Security Review (`REV-2C-01` through `REV-2C-07`), plus defense-in-depth cleanup for `REV-2C-08`, have been remediated locally and verified across six automated test suites (**470 / 470 tests passing**, `0` TypeScript errors, `0` failures, `0` skipped). No external environments, remote databases, Auth accounts, roles, deployments, or Git history were accessed or modified.

---

## 2. Finding-by-Finding Remediation Details

### `REV-2C-01` (MEDIUM) — Fail-Closed Mobile Profile Status Validation
- **File & Lines:** `src/lib/auth/mobile.ts:276-283`
- **Before:** Checked `if (profileActive === false)`, allowing a missing `public.profiles` row (`null`) to fall through as `accountStatus: "ACTIVE"`.
- **After:** Changed to `if (profileActive !== true)` so both missing (`null`) and inactive (`false`) profiles fail closed with `403 FORBIDDEN`.
- **Verification:** Covered by `tests/phase2cRemediation.test.ts` (`REV-2C-01`).

### `REV-2C-02` (MEDIUM) — Trusted Client IP Extraction & Production-Safe Distributed Rate Limiting
- **Files & Lines:** `src/lib/security/rateLimit.ts:60-99,264-322`, `src/lib/auth/mobile.ts:331-375`, `src/lib/export/adminExportHandler.ts:302-327`
- **Before:** `getClientIpFromHeaders()` read the leftmost (client-spoofable) `x-forwarded-for` IP first, and `checkScopedRateLimit()` silently fell back to per-instance in-memory maps in production when Upstash Redis was unconfigured or unreachable.
- **After:**
  - `getClientIpFromHeaders()` now prioritizes platform-overwritten trusted headers (`x-vercel-forwarded-for` → `x-real-ip` → `cf-connecting-ip`) and falls back to the **rightmost** proxy-appended hop in `x-forwarded-for`.
  - `checkScopedRateLimit()` logs an explicit structured warning in production when Upstash Redis is missing or unreachable, and when `failClosedIfUnavailable: true` is set (enabled on both `/api/mobile/v1/me` and `/api/admin/export`), returns `{ allowed: false, reason: "SERVICE_UNAVAILABLE", retryAfterSeconds: 60 }`, producing HTTP `503` with `Retry-After`.
- **Verification:** Covered by `tests/phase2cRemediation.test.ts` (`REV-2C-02`).

### `REV-2C-03` (MEDIUM) — Separate `CUSTOMER` Account Linkage from Authoritative RBAC Roles
- **Files & Lines:** `src/lib/auth/mobile.ts:10-39,285-315`, `reports/phase-2b-implementation/MOBILE_API_V1_CONTRACT.md:41-55`
- **Before:** Synthesized `"CUSTOMER"` into `roles[]` from `customers.profile_id`, conflating customer-account linkage with authoritative `public.roles` / `public.profile_roles` / `public.has_role`.
- **After:** `roles: MobileRbacRole[]` strictly contains authoritative database RBAC roles (`SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`, `SELLER`) only. Customer linkage is exposed separately as `customerProfileLinked: boolean` and can never satisfy `requireMobileRoles(...)`.
- **Verification:** Covered by `tests/phase2bSecurityHardening.test.ts` and `tests/phase2cRemediation.test.ts` (`REV-2C-03`).

### `REV-2C-04` (MEDIUM) — Direct Handler-Level Security Tests & `FUNDRAISING_MANAGER` PG18 RLS Coverage
- **Files & Lines:** `tests/phase2cRemediation.test.ts` (new, 6 test groups), `tests/phase2bPostgresRLSAndRealtime.test.ts:71,163-197,243-260`, `src/lib/export/adminExportHandler.ts` (new), `src/lib/security/orderAccessToken.ts:352-490`
- **Before:** `verifyOrderAccess` and `/api/admin/export` were verified via extracted helpers/substrings; `FUNDRAISING_MANAGER` was not explicitly seeded in `phase2bPostgresRLSAndRealtime.test.ts`.
- **After:** Added direct handler-level tests invoking `verifyOrderAccess()`, `handleAdminExportGet()`, and `handleMobileMeGet()` end-to-end across positive and negative paths, and added an explicit `FUNDRAISING_MANAGER` actor to `phase2bPostgresRLSAndRealtime.test.ts` verifying direct write denial across all 10 hardened tables + valid staff `SELECT`s.

### `REV-2C-05` (LOW) — Active Staff/Seller Profile Checks, Seller Role Validation & Atomic Token Consumption
- **File & Lines:** `src/lib/security/orderAccessToken.ts:310-339,352-476`
- **Before:** `verifyOrderAccess` did not check `profiles.is_active` for staff/seller or `has_role('SELLER')` for seller; `CONSUME_WRITE` direct-query fallback updated `used_at` without an atomic `used_at IS NULL` predicate.
- **After:**
  - `verifyOrderAccess` enforces `profiles.is_active === true` before granting `STAFF` or `SELLER` access, and enforces BOTH `has_role(user.id, 'SELLER') === true` AND `sellers.profile_id = user.id AND sellers.is_active === true` AND `order.seller_id === sellerRow.id`.
  - Fallback `CONSUME_WRITE` now executes an atomic conditional update (`.eq("id", tokenRow.id).is("used_at", null).select("id").maybeSingle()`), returning `TOKEN_WRITE_ALREADY_CONSUMED` on concurrent races.
- **Verification:** Covered by `tests/phase2cRemediation.test.ts` (`REV-2C-04 & REV-2C-05`).

### `REV-2C-06` (LOW) — Audit Bulk PII Exports & Verify Export Authorization Policy
- **Files & Lines:** `src/lib/export/adminExportHandler.ts:273-436`, `src/app/api/admin/export/route.ts:1-218`
- **Business Policy Verified:** `tests/export.test.ts:217` confirms intended administrative export roles are `SUPER_ADMIN`, `ADMIN`, and `FUNDRAISING_MANAGER` (`is_staff`), with `SELLER` and `CUSTOMER` denied.
- **After:** Added `profiles.is_active === true` check alongside `is_staff`, enabled `failClosedIfUnavailable: true` rate limiting, preserved PostgREST FK disambiguation hints in `route.ts`, and added a non-PII `ADMIN_EXPORT_DOWNLOADED` `audit_logs` entry (`actor_user_id`, `resource`, `format`, `row_count`, `status_filter`) on every successful export.
- **Verification:** Covered by `tests/phase2cRemediation.test.ts` (`REV-2C-04 & REV-2C-06`) and existing `tests/export.test.ts` + `tests/sellerPaymentQrAndReview.test.ts`.

### `REV-2C-07` (LOW) — Single Auth Lookup & Explicit Zero-Row Delivery Handling
- **File & Lines:** `src/server/actions/whatsappDelivery.ts:17-62,217-420`
- **Before:** Called `getCurrentUser()` 5 times per WhatsApp action (via 4 `hasCurrentUserRole` calls); `UPDATE ticket_deliveries` silently matched 0 rows when no `WHATSAPP` delivery record existed yet.
- **After:** Calls `getCurrentUser()` **once** and queries `admin.rpc("has_role", { p_user_id: user.id, p_role })` in parallel; `recordWhatsAppOpenedAction` and `recordWhatsAppManuallySentAction` now check `.select("id").maybeSingle()`, insert a valid `ticket_deliveries` row if absent, and return `deliveryRecordUpdated: boolean`.
- **Verification:** Covered by `tests/phase2cRemediation.test.ts` (`REV-2C-07`).

### `REV-2C-08` & `REV-2C-09` (INFORMATIONAL) — Assessment
- **`REV-2C-08` (Action Taken — Defense-in-Depth):** Added `DROP POLICY IF EXISTS` for the 4 dormant `authenticated` write policies on `public.seller_messages` inside the unapplied migration `supabase/migrations/202611200002_phase_2b2_direct_write_rls_hardening.sql:128-133`, verified (`0` remaining write policies) in disposable PostgreSQL 18 (`tests/phase2bPostgresRLSAndRealtime.test.ts:251-259`).
- **`REV-2C-09` (No Local Action Required — Preview Prerequisite):** Upstash Redis env vars (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`), live Preview `supabase_realtime` publication membership, and live Preview Supabase Auth JWT validation against `/api/mobile/v1/me` must be verified during separately authorized Preview deployment.

---

## 3. Files Changed in Phase 2C-R

**Created (2 files):**
- `src/lib/export/adminExportHandler.ts`
- `tests/phase2cRemediation.test.ts`

**Modified (8 files; pre-existing `package.json` / `package-lock.json` preserved untouched):**
- `src/lib/auth/mobile.ts`
- `src/lib/security/rateLimit.ts`
- `src/lib/security/orderAccessToken.ts`
- `src/app/api/admin/export/route.ts`
- `src/server/actions/whatsappDelivery.ts`
- `supabase/migrations/202611200002_phase_2b2_direct_write_rls_hardening.sql`
- `tests/phase2bSecurityHardening.test.ts`
- `tests/phase2bPostgresRLSAndRealtime.test.ts`
- `reports/phase-2b-implementation/MOBILE_API_V1_CONTRACT.md`

---

## 4. Verification Results by Suite

| Verification Suite | Command | Result |
|---|---|---|
| **TypeScript Typecheck** | `npm run typecheck` | **PASS** (`0` errors) |
| **Full Existing Regression Suite** | `npm test` | **PASS** (`433 / 433` passed, `0` fail, `0` skip) |
| **Phase 2B Security Suite** | `node --test tests/phase2bSecurityHardening.test.ts` | **PASS** (`19 / 19` passed, `0` fail, `0` skip) |
| **Phase 2C-R Remediation Suite** | `node --test tests/phase2cRemediation.test.ts` | **PASS** (`6 / 6` passed, `0` fail, `0` skip) |
| **Disposable PG18 RLS & Realtime Suite** | `node --test tests/phase2bPostgresRLSAndRealtime.test.ts` | **PASS** (`5 / 5` passed, `0` fail, `0` skip) |
| **Phase 10B First Prize Dual-Auth PG18 Regression** | `node --test tests/phase10bRBACAndApproval.test.ts` | **PASS** (`7 / 7` passed, `0` fail, `0` skip) |
| **Grand Total** | All 6 suites | **470 / 470 PASS** (`0` fail, `0` skip) |

---

## 5. Remaining Risks & Unresolved Questions

- **Operational Prerequisite (`REV-2C-09`):** Because `/api/mobile/v1/me` and `/api/admin/export` now fail closed (`503 SERVICE_UNAVAILABLE`) in production when Upstash Redis is unavailable, confirm `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured in Vercel Preview and Production **before** deploying to production.
- **No remaining code/database security blockers** for Preview migration and release once separately authorized by the owner.

---

## 6. Safety Boundary Confirmation

- **No Preview (`jiyuiydzsfydjklosvvq`) or Production (`fohpqheglxhfdecadhzw`) database access or mutations.**
- **No Supabase Auth account or role changes.**
- **No emails, WhatsApp messages, push notifications, ticket operations, payments, or draws executed.**
- **No Vercel deployment or environment configuration changes.**
- **No Git commit, push, merge, reset, or rebase** (HEAD remains `f15d6a45d2ea1ef150aa85f65d7242940a5dbe8d` on `preview/production-mirror`).
- **Pre-existing `package.json` and `package-lock.json` modifications preserved untouched.**
- **No secrets, tokens, passwords, or customer PII exposed.**
