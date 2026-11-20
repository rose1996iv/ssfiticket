# SSFI Lucky Draw — Phase 2C-R Independent Security Re-Review

**Date:** 2026-11-21  
**Repository:** `F:\PROJECT\Lucky Draw`  
**Branch:** `preview/production-mirror`  
**HEAD Commit (Verified Unchanged):** `f15d6a45d2ea1ef150aa85f65d7242940a5dbe8d`  
**Review Mode:** STRICTLY READ-ONLY  
**Final Verdict:** **`CONDITIONAL PASS`**

> **Why `CONDITIONAL PASS` (instead of unconditional `PASS`)?**  
> All **7 confirmed Phase 2C findings (`REV-2C-01`–`REV-2C-07`)** and **`REV-2C-08`** are verified **remediated at the code, migration, and local PostgreSQL 18 level** with zero CRITICAL or HIGH issues remaining.  
> The verdict is **`CONDITIONAL PASS`** strictly because of **one high-priority operational prerequisite** (`REV-2C-02` / `REV-2C-09`): on Vercel Preview, Next.js executes with `process.env.NODE_ENV === "production"`. Because `checkScopedRateLimit` now fails closed (`503 SERVICE_UNAVAILABLE`) whenever `NODE_ENV === "production"` and Upstash Redis is absent, **deploying Phase 2B/2C-R to Preview without verifying `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Vercel Preview will cause `GET /api/mobile/v1/me` and `GET /api/admin/export` to return HTTP `503`**.

---

## 1. Finding-by-Finding Re-Review

### `REV-2C-01` — Fail-Closed Mobile Profile Status Validation
- **Status:** **`PASS`**
- **File & Lines:** `src/lib/auth/mobile.ts:276-283`; `tests/phase2cRemediation.test.ts:43-59`
- **Evidence & Attack Scenario:** Line `276` now enforces `if (profileActive !== true)` before resolving roles, rejecting both `false` (deactivated) and `null` (missing/orphaned `public.profiles` row) with `403 FORBIDDEN`. Verified directly in `tests/phase2cRemediation.test.ts` against both `authenticateMobileRequest` and `handleMobileMeGet`.
- **Remaining Risk:** None.
- **Required Remediation:** None.

### `REV-2C-02` — Trusted Proxy IP Extraction & Production Redis Outage Behavior
- **Status:** **`NEEDS LIVE VERIFICATION`** *(Code implementation: **`PASS`**; Vercel Preview Upstash env configuration: **`NEEDS LIVE VERIFICATION`**)*
- **File & Lines:** `src/lib/security/rateLimit.ts:60-99,264-322`; `src/lib/auth/mobile.ts:331-375`; `src/lib/export/adminExportHandler.ts:302-327`; `tests/phase2cRemediation.test.ts:64-125`
- **Evidence & Attack Scenario:**
  - `getClientIpFromHeaders()` now prioritizes platform-overwritten headers (`x-vercel-forwarded-for` → `x-real-ip` → `cf-connecting-ip`) and falls back to the **rightmost** proxy-appended hop in `x-forwarded-for`, neutralizing client-prepended `X-Forwarded-For` spoofing.
  - When `isProdRuntime` (`NODE_ENV === "production" || VERCEL_ENV === "production"`) is true and Upstash Redis is unconfigured or fails, `checkScopedRateLimit(..., { failClosedIfUnavailable: true })` logs a safe structured warning and returns `reason: "SERVICE_UNAVAILABLE"`, causing `/api/mobile/v1/me` and `/api/admin/export` to return HTTP `503` with `Retry-After: 60`.
- **Remaining Risk:** Operational — Next.js Preview builds run with `NODE_ENV === "production"`. If Upstash Redis env vars are missing in Vercel Preview, both `/api/mobile/v1/me` and `/api/admin/export` will fail closed with `503`.
- **Required Remediation:** Verify `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set in Vercel Preview (and Production) before deploying.

### `REV-2C-03` — Authoritative RBAC Roles vs Customer Account Linkage
- **Status:** **`PASS`**
- **File & Lines:** `src/lib/auth/mobile.ts:10-39,285-315`; `reports/phase-2b-implementation/MOBILE_API_V1_CONTRACT.md:41-55`; `tests/phase2cRemediation.test.ts:130-149`
- **Evidence & Attack Scenario:** `roles: MobileRbacRole[]` strictly holds authoritative database roles from `public.roles` / `public.profile_roles` / `public.has_role` (`SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`, `SELLER`). Customer linkage is isolated in `customerProfileLinked: boolean` and cannot pass `requireMobileRoles(...)`, preventing customer-profile linkage from ever implicitly granting privileged RBAC access.
- **Remaining Risk:** None for Phase 2B/2C-R. Future customer-facing mobile routes must continue enforcing `customer_id` ownership via `customers.profile_id = auth.uid()` and server-verified account linking.
- **Required Remediation:** None.

### `REV-2C-04` — Handler-Level Test Quality & `FUNDRAISING_MANAGER` PG18 Coverage
- **Status:** **`PASS`** *(with minor non-blocking note)*
- **File & Lines:** `tests/phase2cRemediation.test.ts:154-366`; `tests/phase2bPostgresRLSAndRealtime.test.ts:71,163-197,243-260`
- **Evidence & Attack Scenario:**
  - `verifyOrderAccess()`, `handleAdminExportGet()`, and `handleMobileMeGet()` are now invoked **directly** across positive and negative security paths (auth failure, inactive profile, cross-seller IDOR, revoked `SELLER` role, rate-limit `429`, production fail-closed `503`, sanitized `500`, non-PII audit log).
  - `FUNDRAISING_MANAGER` is now explicitly seeded in disposable PostgreSQL 18 (`phase2bPostgresRLSAndRealtime.test.ts`) and verified denied on all 10 hardened write probes while retaining valid staff `SELECT` access.
- **Remaining Risk:** Minor — `whatsappDelivery.ts` Server Actions (`prepareWhatsAppTicketDelivery`, `recordWhatsAppOpenedAction`, `recordWhatsAppManuallySentAction`) are still verified via the extracted `evaluateWhatsAppDeliveryAuthorization` evaluator + static source assertions rather than direct Server Action invocation (due to Next.js `"use server"` + `next/cache` coupling).
- **Required Remediation:** Non-blocking; optional future refactor to inject deps into a `whatsappDeliveryService.ts` module if desired.

### `REV-2C-05` — Seller Ownership, Active Profile Validation & Atomic Token Consumption
- **Status:** **`PASS`**
- **File & Lines:** `src/lib/security/orderAccessToken.ts:310-339,352-476`; `tests/phase2cRemediation.test.ts:154-271`
- **Evidence & Attack Scenario:**
  - `verifyOrderAccess` verifies `profiles.is_active === true` before granting `STAFF` or `SELLER` access, and for sellers enforces ALL THREE: `has_role(user.id, 'SELLER') === true`, `sellers.profile_id = user.id AND sellers.is_active === true`, and `order.seller_id === sellerRow.id`.
  - Fallback `CONSUME_WRITE` (lines `310-328`) uses atomic conditional update `.eq("id", tokenRow.id).is("used_at", null).select("id").maybeSingle()`, returning `TOKEN_WRITE_ALREADY_CONSUMED` if a concurrent request consumed the token first.
- **Remaining Risk:** None.
- **Required Remediation:** None.

### `REV-2C-06` — Admin Export Authorization, Audit Logging & Rate Limiting
- **Status:** **`PASS`**
- **File & Lines:** `src/lib/export/adminExportHandler.ts:273-436`; `src/app/api/admin/export/route.ts:1-218`; `tests/phase2cRemediation.test.ts:276-365`
- **Evidence & Attack Scenario:** Preserves documented business policy (`SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER` via `is_staff`, matching `tests/export.test.ts:217`), enforces `profiles.is_active === true`, preserves PostgREST FK disambiguation hints in `route.ts`, enforces `user.id`-keyed rate limiting (`20` / 15m, fail-closed in production), sanitizes `500` responses, and records a non-PII `ADMIN_EXPORT_DOWNLOADED` `audit_logs` entry (`actor_user_id`, `resource`, `format`, `row_count`, `status_filter`) on every export.
- **Remaining Risk:** None (subject to Upstash Redis verification in `REV-2C-02`).
- **Required Remediation:** None.

### `REV-2C-07` — WhatsApp Auth Lookup Efficiency & Zero-Row Delivery Handling
- **Status:** **`PASS`**
- **File & Lines:** `src/server/actions/whatsappDelivery.ts:17-62,217-420`; `tests/phase2cRemediation.test.ts:370-379`
- **Evidence & Attack Scenario:** `resolveTrustedWhatsAppAuthContext` now calls `getCurrentUser()` **once** (down from 5) and checks `has_role` in parallel via `admin.rpc`. `recordWhatsAppOpenedAction` and `recordWhatsAppManuallySentAction` check `.select("id").maybeSingle()` on updates, insert a valid `ticket_deliveries` row if absent, and return `deliveryRecordUpdated: boolean`.
- **Remaining Risk:** Negligible — under an extreme concurrent first-time race on an order missing a `WHATSAPP` delivery row, the second `.insert()` hits `unique(order_id, channel)` (`23505`) and is caught gracefully without crashing (`deliveryRecordUpdated: false`).
- **Required Remediation:** None required.

### `REV-2C-08` — Dormant `seller_messages` Write Policies
- **Status:** **`PASS`**
- **File & Lines:** `supabase/migrations/202611200002_phase_2b2_direct_write_rls_hardening.sql:133-138`; `tests/phase2bPostgresRLSAndRealtime.test.ts:251-259`
- **Evidence:** All 4 dormant `authenticated` write policies on `public.seller_messages` are dropped via `DROP POLICY IF EXISTS` and verified `0` remaining in disposable PostgreSQL 18.
- **Remaining Risk:** None.

### `REV-2C-09` — Realtime Publication & Live Preview Prerequisites
- **Status:** **`NEEDS LIVE VERIFICATION`**
- **File & Lines:** `supabase/migrations/202611200003_phase_2b5_realtime_publication.sql:1-53`
- **Evidence:** Local idempotency and strict 3-table membership (`draw_results`, `draw_eligibility_snapshots`, `draw_approvals`) with sensitive tables excluded are verified in disposable PostgreSQL 18. Live Preview Upstash env vars, pre-existing Preview `supabase_realtime` membership, and live Preview Supabase Auth JWT validation against `/api/mobile/v1/me` cannot be verified without live Preview access.
- **Required Remediation:** Verify during separately authorized Preview migration & post-deploy smoke testing.

---

## 2. Migration Order, Compatibility, Rollback Safety & First Prize Dual Authorization

- **Execution Order:** `202611200001_phase_10b_initiator_role_and_approval_hardening.sql` → `202611200002_phase_2b2_direct_write_rls_hardening.sql` → `202611200003_phase_2b5_realtime_publication.sql`. Strictly monotonic with zero timestamp collisions or dependency inversions.
- **Existing Migration & RLS Compatibility:** Splitting `campaigns_public_read` and `prizes_public_read` (`202611200002:32-62`) cleanly eliminates `anon` `is_staff` evaluation errors while preserving public `ACTIVE` reads and staff reads. Phase B2 R4 `anon` revocations on `draws`, `draw_results`, and `draw_randomness_evidence` are explicitly preserved (`202611200002:77,88,129`).
- **First Prize Dual Authorization & Existing Pending Approval (`924790fc-...`):** Neither `202611200002` nor `202611200003` modifies `public.draw_approvals` rows, columns, triggers, or RPCs (`202611200003` only adds `draw_approvals` to `supabase_realtime`). Verified intact by `tests/phase10bRBACAndApproval.test.ts` (`7 / 7` PG18 tests passing).
- **Rollback Safety:** Both `202611200002` and `202611200003` are pure DDL/ACL/policy/publication migrations containing **zero** `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` statements against application data — reversing policies/grants/publication membership cannot delete or alter any existing rows. *(Informational note: no standalone rollback `.sql` files were created for `202611200002`/`202611200003`; optional to add before Production.)*

---

## 3. Assessment of the 470 Passing Tests

The reported **470 / 470** passing tests break down as:
- `433` existing unit/security regression tests (`npm test`) — genuine coverage of payments, referrals, exports, FK disambiguation, campaign scheduler, email outbox, tickets, and draw security.
- `19` Phase 2B security tests (`tests/phase2bSecurityHardening.test.ts`) — genuine behavioral coverage of `evaluateWhatsAppDeliveryAuthorization`, token crypto, `checkScopedRateLimit`, and `handleMobileMeGet`.
- `6` Phase 2C-R remediation tests (`tests/phase2cRemediation.test.ts`) — genuine direct handler-level coverage of `verifyOrderAccess`, `handleAdminExportGet`, `handleMobileMeGet`, trusted IP extraction, and production fail-closed `503`.
- `5` disposable PostgreSQL 18 RLS/Realtime tests (`tests/phase2bPostgresRLSAndRealtime.test.ts`) — genuine live PostgreSQL 18 privilege, RLS, canonical FK, `FUNDRAISING_MANAGER`, dormant policy, and Realtime publication idempotency verification.
- `7` disposable PostgreSQL 18 First Prize dual-auth tests (`tests/phase10bRBACAndApproval.test.ts`) — genuine live PostgreSQL 18 verification of Phase 10B invariants.

**Honest Assessment:** The 470 tests genuinely validate the claimed security properties, with the sole minor caveat noted in `REV-2C-04` (`whatsappDelivery.ts` Server Actions tested via extracted evaluator + static invariants rather than direct Server Action invocation).

---

## 4. Final Safety Confirmation

Confirmed — during Phase 2C-R Independent Re-Review:
- **No source files, migrations, tests, or configurations modified.**
- **No Preview or Production database accessed.**
- **No migrations executed.**
- **No Auth accounts or roles changed.**
- **No emails, WhatsApp messages, ticket, payment, or draw operations executed.**
- **No Vercel configuration or deployment changes.**
- **No Git commit, push, merge, reset, or rebase** (HEAD unchanged at `f15d6a45d2ea1ef150aa85f65d7242940a5dbe8d` on `preview/production-mirror`).
- **Working tree and all existing modifications preserved intact.**
