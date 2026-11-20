# SSFI Lucky Draw — Phase 2C: Independent Security Review of Phase 2B

**Date:** 2026-11-20  
**Repository:** `F:\PROJECT\Lucky Draw`  
**Branch:** `preview/production-mirror`  
**HEAD Commit (Verified Unchanged):** `f15d6a45d2ea1ef150aa85f65d7242940a5dbe8d`  
**Review Mode:** STRICTLY READ-ONLY (zero modifications to source, migrations, tests, configuration, databases, or Git)  
**Overall Verdict:** **`CONDITIONAL PASS`**

---

## 1. Executive Summary

An independent, read-only security review was conducted across all Phase 2B deliverables (Phases 2B.1–2B.7), historical SQL migrations (28 files total), server actions, API routes, mobile authentication utilities, and unit/PostgreSQL 18 test suites.

- **No CRITICAL or HIGH security vulnerabilities remain.** The four severe Phase 2A risks — unauthenticated `service_role` WhatsApp actions, overly broad direct `authenticated` write RLS on 10 operational/draw tables, broken `sellers.user_id` lookup in `verifyOrderAccess`, and absence of a verified Bearer JWT mobile auth layer — were genuinely remediated.
- **Four MEDIUM and three LOW findings** were identified (plus two informational observations). Notably:
  1. `REV-2C-01` (**MEDIUM**): Missing `public.profiles` row (`profileActive === null`) fails open as `"ACTIVE"` in `authenticateMobileRequest`.
  2. `REV-2C-02` (**MEDIUM**): `getClientIpFromHeaders()` trusts the leftmost (client-spoofable) `x-forwarded-for` IP for pre-auth rate limiting on `GET /api/mobile/v1/me`, and `checkScopedRateLimit` silently falls back to ephemeral in-memory storage if Upstash Redis is unconfigured/unreachable in serverless production.
  3. `REV-2C-03` (**MEDIUM**): `CUSTOMER` is synthesized into `roles[]` via `customers.profile_id` rather than `public.roles`/`public.profile_roles`/`public.has_role`, conflating customer-account linkage with authoritative RBAC roles.
  4. `REV-2C-04` (**MEDIUM**): Several security tests in `tests/phase2bSecurityHardening.test.ts` rely on extracted helpers and static source-string assertions rather than invoking the actual Server Action / Route Handler functions directly.
- **Verdict Rationale (`CONDITIONAL PASS`):** Phase 2B is safe to advance to a targeted, small remediation pass (`REV-2C-01` and `REV-2C-02` mandatory before Preview release; `REV-2C-03` mandatory before shipping customer mobile endpoints; `REV-2C-04` strongly recommended).

---

## 2. Review Scope & Methodology

- **Reviewed Artifacts:** `src/lib/delivery/whatsappAuth.ts`, `src/server/actions/whatsappDelivery.ts`, `src/components/delivery/WhatsAppTicketDeliveryButton.tsx`, `src/lib/security/orderAccessToken.ts`, `src/lib/security/rateLimit.ts`, `src/app/api/admin/export/route.ts`, `src/lib/auth/mobile.ts`, `src/app/api/mobile/v1/me/route.ts`, `src/lib/auth/server.ts`, `supabase/migrations/202611200002_phase_2b2_direct_write_rls_hardening.sql`, `supabase/migrations/202611200003_phase_2b5_realtime_publication.sql`, all 26 historical migrations in `supabase/migrations/*.sql`, `tests/phase2bSecurityHardening.test.ts`, `tests/phase2bPostgresRLSAndRealtime.test.ts`, `tests/phase10bRBACAndApproval.test.ts`, `reports/phase-2b-implementation/PHASE_2B_IMPLEMENTATION_REPORT.md`, and `reports/phase-2b-implementation/MOBILE_API_V1_CONTRACT.md`.
- **Automated Read-Only Checks:** Verified Git branch/HEAD/status, ran a full-migration static analyzer across all 28 SQL migrations tracking every active non-`service_role` write policy (`FOR INSERT/UPDATE/DELETE/ALL`) and every `SECURITY DEFINER` function's `SET search_path` declaration.
- **Boundary Compliance:** Zero live Supabase (Preview/Production) connections, zero code edits, zero migration runs.

---

## 3. Repository State

- **Path:** `F:\PROJECT\Lucky Draw`
- **Branch:** `preview/production-mirror`
- **HEAD:** `f15d6a45d2ea1ef150aa85f65d7242940a5dbe8d` (matches expected Phase 1 baseline)
- **Phase 2B Modified Files Present:** `src/app/api/admin/export/route.ts`, `src/lib/security/orderAccessToken.ts`, `src/lib/security/rateLimit.ts`, `src/server/actions/whatsappDelivery.ts`
- **Phase 2B Untracked Files Present:** `src/lib/delivery/whatsappAuth.ts`, `src/lib/auth/mobile.ts`, `src/app/api/mobile/v1/me/route.ts`, `supabase/migrations/202611200002_phase_2b2_direct_write_rls_hardening.sql`, `supabase/migrations/202611200003_phase_2b5_realtime_publication.sql`, `tests/phase2bSecurityHardening.test.ts`, `tests/phase2bPostgresRLSAndRealtime.test.ts`, `reports/phase-2b-implementation/PHASE_2B_IMPLEMENTATION_REPORT.md`, `reports/phase-2b-implementation/MOBILE_API_V1_CONTRACT.md`
- **Pre-existing User Changes Preserved Untouched:** `package.json`, `package-lock.json`, `docs/security/*`, `reports/*`, `scripts/*`, `preview-*.zip`, `tests/phaseB2_8_2RestoreVerification.test.ts`.

---

## 4. Findings by Severity

### Summary Table

| Finding ID | Severity | Area | Status |
|---|---|---|---|
| `REV-2C-01` | **MEDIUM** | Mobile JWT Auth (`profiles.is_active` null fail-open) | Confirmed |
| `REV-2C-02` | **MEDIUM** | Rate Limiting (`X-Forwarded-For` spoofing + in-memory fallback) | Confirmed (Upstash config requires live Preview verification) |
| `REV-2C-03` | **MEDIUM** | Mobile RBAC (`CUSTOMER` linkage conflated with `public.roles`) | Confirmed |
| `REV-2C-04` | **MEDIUM** | Test Quality (helper/substring tests vs handler execution) | Confirmed |
| `REV-2C-05` | **LOW** | Seller/Order Access (`profiles.is_active`, `has_role('SELLER')`, non-atomic fallback) | Confirmed |
| `REV-2C-06` | **LOW** | Admin Export (missing export audit log; `FUNDRAISING_MANAGER` bulk PII access) | Confirmed |
| `REV-2C-07` | **LOW** | WhatsApp Delivery (5x `auth.getUser()` calls; silent 0-row `ticket_deliveries` update) | Confirmed |
| `REV-2C-08` | **INFORMATIONAL** | Dormant write RLS policies on `public.seller_messages` | Confirmed |
| `REV-2C-09` | **INFORMATIONAL** | Live Preview items unverifiable in local read-only review | Requires live Preview verification |

---

### Detailed Findings

#### `REV-2C-01` — Missing `public.profiles` Row Fails Open as `ACTIVE` in Mobile Auth
- **Severity:** **MEDIUM**
- **Location:** `src/lib/auth/mobile.ts:255-305` (specifically line `275`)
- **Technical Explanation:** `resolveProfileActive(verifiedUser.id)` returns `null` when no row exists in `public.profiles` for the authenticated `auth.users.id`. Line `275` checks `if (profileActive === false)` rather than `if (profileActive !== true)`, so an orphaned or partially provisioned Auth user without a `public.profiles` row passes authentication and receives `accountStatus: "ACTIVE"`.
- **Realistic Attack Scenario:** An attacker or misprovisioned OAuth/Auth account whose `handle_new_user` trigger failed or whose `profiles` row was deleted authenticates to `/api/mobile/v1/me` and is treated as an active account (`200 OK`).
- **Potential Impact:** Violates deny-by-default account activation enforcement. (Note: `roles` would still be `[]` unless `profile_roles` existed, limiting immediate privilege impact.)
- **Recommended Remediation:** Change line `275` from `if (profileActive === false)` to `if (profileActive !== true)` and add a negative unit test for `resolveProfileActive: async () => null` expecting `403 FORBIDDEN`.
- **Evidence:** Direct code inspection of `src/lib/auth/mobile.ts:154-166,275,303`.
- **Verification Status:** **Confirmed**.

#### `REV-2C-02` — Spoofable `X-Forwarded-For` on Pre-Auth Mobile Rate Limit & Silent In-Memory Fallback
- **Severity:** **MEDIUM**
- **Location:** `src/lib/security/rateLimit.ts:78-90,182-194`, `src/lib/auth/mobile.ts:328-344`, `src/app/api/admin/export/route.ts:62-79`
- **Technical Explanation:**
  1. `getClientIpFromHeaders()` reads the **first (leftmost)** IP from `x-forwarded-for`. Unless a reverse proxy strips incoming `x-forwarded-for`, a client can send arbitrary `X-Forwarded-For: 1.2.3.<random>` headers on each request to bypass the pre-auth `mobile_me_ip` rate limit (`60` / `300s`).
  2. Both `export/route.ts:68` (`failClosedIfUnavailable: false`) and `handleMobileMeGet` (`mobile.ts:331,353`, default `false`) fall back silently to a process-local `Map` (`memoryStore`) whenever `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are absent or Upstash returns an error. On Vercel serverless functions, each cold instance has its own memory map, rendering in-memory rate limiting ineffective under distributed load.
- **Realistic Attack Scenario:** An attacker rotates spoofed `X-Forwarded-For` values while probing `/api/mobile/v1/me` with stolen/brute-forced tokens, or triggers high-frequency `/api/admin/export` downloads across serverless instances if Upstash Redis is not configured in Preview/Production.
- **Potential Impact:** Pre-auth brute-force protection on `/api/mobile/v1/me` can be bypassed; export rate limiting becomes best-effort if Upstash is missing.
- **Recommended Remediation:** On Vercel, prefer `x-real-ip` or `x-vercel-forwarded-for` (platform-overwritten) over leftmost `x-forwarded-for`. Confirm `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are provisioned in Preview and Production, and log an operational warning (or fail closed in production) when Upstash is unavailable on sensitive endpoints.
- **Evidence:** Direct code inspection of `rateLimit.ts:78-90,260-296`, `mobile.ts:328-344`, `export/route.ts:62-79`.
- **Verification Status:** **Confirmed** (actual Upstash env var presence in Preview/Production requires live verification).

#### `REV-2C-03` — `CUSTOMER` Account Linkage Conflated with Authoritative `public.roles` RBAC
- **Severity:** **MEDIUM**
- **Location:** `src/lib/auth/mobile.ts:261,294-296`, `reports/phase-2b-implementation/MOBILE_API_V1_CONTRACT.md:45`, `supabase/migrations/202610270001_phase2_core.sql:14,22`
- **Technical Explanation:** In PostgreSQL, `public.roles` enforces `CHECK (name IN ('SUPER_ADMIN','ADMIN','FUNDRAISING_MANAGER','SELLER'))` — **`CUSTOMER` is NOT an authoritative RBAC role** in `public.roles` / `public.profile_roles` / `public.has_role`. Instead, `mobile.ts` derives `"CUSTOMER"` from `customers.profile_id = user.id` and merges it into the same `roles: MobileAppRole[]` array as database RBAC roles.
- **Realistic Attack Scenario:** Future Phase 2C+ mobile endpoints or Flutter guards assume `roles.includes("CUSTOMER")` is backed by `public.has_role` (or vice versa), or a customer account-linking bug attaches a `profile_id` to an existing `customers` row without verified ownership, silently granting `"CUSTOMER"` role status.
- **Potential Impact:** Architectural divergence between PostgreSQL RBAC (`has_role`) and mobile API role classification (`mobile.ts`), risking authorization bugs when customer-facing mobile routes are built.
- **Recommended Remediation:** Explicitly decide before Phase 2C+ customer routes: either (a) add `'CUSTOMER'` to `public.roles` via migration and resolve it through `public.has_role`, or (b) keep `roles` strictly for `public.profile_roles` and expose customer linkage as a separate boolean (`isLinkedCustomer: boolean`) in `/api/mobile/v1/me`.
- **Evidence:** `202610270001_phase2_core.sql:14,22`, `src/lib/auth/mobile.ts:183-195,294-296`.
- **Verification Status:** **Confirmed**.

#### `REV-2C-04` — Security Tests Rely on Extracted Helpers & Static Substring Assertions for Several Endpoints
- **Severity:** **MEDIUM**
- **Location:** `tests/phase2bSecurityHardening.test.ts:199-270`, `tests/phase2bPostgresRLSAndRealtime.test.ts:171-218`
- **Technical Explanation:**
  1. `prepareWhatsAppTicketDelivery`, `recordWhatsAppOpenedAction`, `recordWhatsAppManuallySentAction`, `verifyOrderAccess`, and `GET /api/admin/export` are not invoked directly in tests; instead, tests exercise extracted helpers (`evaluateWhatsAppDeliveryAuthorization`, `checkScopedRateLimit`) and assert source substrings via `fs.readFileSync`. If a future edit accidentally moves or comments out a guard inside the actual action/route, substring assertions can produce false positives.
  2. `phase2bPostgresRLSAndRealtime.test.ts` tests `anon`, `CUSTOMER`, `SELLER`, `ADMIN`, and `SUPER_ADMIN` against the 10 hardened tables, but omits an explicit `FUNDRAISING_MANAGER` test identity (even though `is_staff` includes `FUNDRAISING_MANAGER`).
- **Realistic Attack Scenario:** A refactor breaks the wiring between `whatsappDelivery.ts` and `evaluateWhatsAppDeliveryAuthorization`, or re-introduces a leaky error field in `export/route.ts` under a different variable name, while static substring tests still pass.
- **Potential Impact:** Reduced regression detection confidence on critical authorization boundaries.
- **Recommended Remediation:** Inject lightweight test dependencies (matching the clean pattern already used in `handleMobileMeGet`) into `whatsappDelivery.ts`, `verifyOrderAccess`, and `export/route.ts` so tests invoke the actual functions directly, and add a `FUNDRAISING_MANAGER` actor to `phase2bPostgresRLSAndRealtime.test.ts`.
- **Evidence:** Direct inspection of `tests/phase2bSecurityHardening.test.ts` and `tests/phase2bPostgresRLSAndRealtime.test.ts`.
- **Verification Status:** **Confirmed**.

#### `REV-2C-05` — `verifyOrderAccess` Missing `profiles.is_active` & `has_role('SELLER')` Checks + Non-Atomic Fallback
- **Severity:** **LOW**
- **Location:** `src/lib/security/orderAccessToken.ts:310-327,363-398`
- **Technical Explanation:**
  1. In `verifyOrderAccess`, staff authorization (`is_staff(user.id)`) does not check `profiles.is_active = true`; seller authorization checks `sellers.profile_id = user.id AND sellers.is_active = true` without also checking `profiles.is_active = true` and `has_role(user.id, 'SELLER')`.
  2. In `verifyOrderPaymentAccess`, the direct-query fallback for `CONSUME_WRITE` (lines `310-327`, used only if the atomic DB RPC fails) executes `UPDATE payment_recovery_tokens SET used_at = ... WHERE id = tokenRow.id` without `AND used_at IS NULL`, creating a TOCTOU replay window if the RPC fallback were ever triggered concurrently.
- **Realistic Attack Scenario:** A deactivated staff profile (whose `profile_roles` row was not yet removed) retains `verifyOrderAccess` access until JWT expiry; or concurrent requests during an RPC outage replay a single-use `CONSUME_WRITE` token.
- **Potential Impact:** Minor authorization window for deactivated accounts; low-likelihood replay window in fallback code path.
- **Recommended Remediation:** Verify `profiles.is_active = true` (and `has_role(user.id, 'SELLER')` for sellers) in `verifyOrderAccess`, and add `.is("used_at", null).select("id").maybeSingle()` to the `CONSUME_WRITE` fallback update.
- **Evidence:** `src/lib/security/orderAccessToken.ts:310-327,363-398`.
- **Verification Status:** **Confirmed**.

#### `REV-2C-06` — Admin Export Lacks Audit Log Record & Grants Bulk PII Access to `FUNDRAISING_MANAGER`
- **Severity:** **LOW**
- **Location:** `src/app/api/admin/export/route.ts:45-54,331-340`
- **Technical Explanation:** `/api/admin/export` allows any `is_staff` user (`SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`) to export up to 5,000–10,000 rows of customer PII (`customers`, `orders`, `payments`, `tickets`), and does not record an entry in `public.audit_logs` when an export completes.
- **Realistic Attack Scenario:** A `FUNDRAISING_MANAGER` or compromised staff account bulk-exports customer PII without leaving an immutable audit trail of who exported what dataset and when.
- **Potential Impact:** Reduced forensic accountability for bulk PII exfiltration.
- **Recommended Remediation:** Insert a minimal `audit_logs` record (`action: 'ADMIN_EXPORT_DOWNLOADED'`, `actor_user_id: user.id`, `metadata: { resource, format, row_count }`, zero PII) on successful exports, and confirm whether `FUNDRAISING_MANAGER` should be permitted to export `customers`/`payments`.
- **Evidence:** `src/app/api/admin/export/route.ts:45-54,331-340`.
- **Verification Status:** **Confirmed**.

#### `REV-2C-07` — Redundant `auth.getUser()` Network Calls & Silent 0-Row Delivery Update in `whatsappDelivery.ts`
- **Severity:** **LOW**
- **Location:** `src/server/actions/whatsappDelivery.ts:27-35,248-281`, `src/lib/auth/server.ts:22-26`
- **Technical Explanation:**
  1. `resolveTrustedWhatsAppAuthContext` calls `getCurrentUser()` and then `hasCurrentUserRole(...)` 4 times in parallel; each `hasCurrentUserRole` call invokes `getCurrentUser()` again, causing 5 Supabase Auth `getUser()` network round-trips per action.
  2. In `recordWhatsAppOpenedAction` and `recordWhatsAppManuallySentAction`, if no row exists in `ticket_deliveries` for `(order_id, 'WHATSAPP')`, the `UPDATE` silently affects 0 rows while returning `{ success: true }` and inserting an audit log.
- **Realistic Attack Scenario:** High latency or Supabase Auth rate-limit errors under concurrent staff usage; audit log records `TICKET_DELIVERY_MANUALLY_SENT` while `ticket_deliveries` remains unchanged if the row was missing.
- **Potential Impact:** Operational reliability and minor delivery-state inconsistency (no authorization bypass).
- **Recommended Remediation:** Query `has_role` directly using the already-resolved `user.id` (1 `getUser()` call total), and handle missing `ticket_deliveries` rows explicitly (or upsert safely).
- **Evidence:** `src/server/actions/whatsappDelivery.ts:22-35,248-281`, `src/lib/auth/server.ts:8-27`.
- **Verification Status:** **Confirmed**.

#### `REV-2C-08` — Dormant Write Policies Remaining on `public.seller_messages`
- **Severity:** **INFORMATIONAL**
- **Location:** `supabase/migrations/202610290002_phase6_seller_messages.sql`, `202610290007_bidirectional_seller_messages.sql`, `202610300001_p0_security_remediation.sql`
- **Technical Explanation:** Full-migration analysis across all 28 migrations confirmed that the only remaining non-`service_role` write RLS policies in the entire schema are 4 policies on `public.seller_messages`. They are currently **non-exploitable** because `202610300001` revoked `INSERT, UPDATE, DELETE` on `public.seller_messages` from `public, anon, authenticated` and enforced an immutability trigger.
- **Recommended Remediation:** Drop the 4 dormant write policies in a future cleanup migration for defense-in-depth so an accidental future `GRANT` cannot re-activate direct PostgREST writes.
- **Verification Status:** **Confirmed**.

#### `REV-2C-09` — Live Preview Items Unverifiable in Read-Only Local Review
- **Severity:** **INFORMATIONAL**
- **Technical Explanation:** The following cannot be independently verified without live Preview (`jiyuiydzsfydjklosvvq`) / Vercel inspection:
  1. Whether `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured in Vercel Preview/Production.
  2. Exact current `pg_publication_tables` membership of `supabase_realtime` on Preview before `202611200003` is applied.
  3. End-to-end live Supabase Auth JWT verification (`supabase.auth.getUser(token)`) against Preview `GET /api/mobile/v1/me` after deployment.

---

## 5. Area-by-Area Assessment

- **Review A — WhatsApp Authorization:** **STRONG.** All three actions (`prepareWhatsAppTicketDelivery`, `recordWhatsAppOpenedAction`, `recordWhatsAppManuallySentAction`) now enforce server-side session auth, active profile check, authoritative RBAC, canonical seller ownership (`sellers.profile_id = user.id AND is_active = true`), ticket-order-campaign integrity, and PII-minimized audit logs. Minor operational/test gaps logged in `REV-2C-04` and `REV-2C-07`.
- **Review B — RLS, Grants & SQL Migrations:** **STRONG.** All 28 tables have RLS enabled; zero `SECURITY DEFINER` functions lack `SET search_path`; all 10 audit-flagged tables are now strictly `SELECT`-only for `authenticated` with `service_role` writes preserved; splitting `campaigns_public_read`/`prizes_public_read` cleanly resolved the `anon` `is_staff` permission error; Phase B2 R4 `anon` draw revocations and Phase 10B First Prize dual authorization remain intact; `202611200003` is strictly idempotent and publishes only the 3 draw tables (`draw_results`, `draw_eligibility_snapshots`, `draw_approvals`) while excluding all sensitive PII/financial tables.
- **Review C — Seller Ownership & Order Access:** **GOOD.** Canonical `sellers.profile_id` + `is_active === true` is fixed in `orderAccessToken.ts:380`, and all token cryptographic/expiry/SHA-256 constant-time protections remain intact. Minor hardening items logged in `REV-2C-05`.
- **Review D — Admin Export:** **GOOD.** Staff-only auth (`is_staff`), `user.id`-keyed rate limiting (`20`/15m, HTTP `429` + `Retry-After`), and sanitized `500` responses are properly implemented. Upstash fallback behavior and missing export audit logging noted in `REV-2C-02` and `REV-2C-06`.
- **Review E — Mobile JWT & RBAC:** **GOOD (with conditions).** `extractBearerToken` and `supabase.auth.getUser(token)` properly reject missing/malformed/invalid/expired JWTs without trusting unverified claims or client-supplied headers, and `/api/mobile/v1/me` returns a minimal, sanitized payload with `Cache-Control: no-store`. Must fix missing-profile fail-open (`REV-2C-01`), spoofable `X-Forwarded-For` on pre-auth IP rate limit (`REV-2C-02`), and clarify `CUSTOMER` vs `public.roles` (`REV-2C-03`).
- **Review F — Test Quality:** **MIXED.** `tests/phase2bPostgresRLSAndRealtime.test.ts` and `tests/phase10bRBACAndApproval.test.ts` are high-quality real PostgreSQL 18 integration tests exercising actual database RLS/privileges/publications. `tests/phase2bSecurityHardening.test.ts` tests `handleMobileMeGet` thoroughly, but relies on extracted helpers and static substring checks for `whatsappDelivery.ts`, `verifyOrderAccess`, and `export/route.ts` (`REV-2C-04`).

---

## 6. Recommended Remediation Order & Preview Migration Prerequisites

### Recommended Remediation Order (Phase 2D — Small Targeted Pass)
1. **Fix `REV-2C-01`:** Fail closed (`profileActive !== true`) in `src/lib/auth/mobile.ts:275` + unit test.
2. **Fix `REV-2C-02`:** Prefer platform-trusted IP header (`x-real-ip` / `x-vercel-forwarded-for`) in `getClientIpFromHeaders()` before `x-forwarded-for`.
3. **Fix `REV-2C-05` & `REV-2C-06`:** Add `profiles.is_active` check + atomic fallback guard in `orderAccessToken.ts`, and add non-PII `ADMIN_EXPORT_DOWNLOADED` audit log in `export/route.ts`.
4. **Fix `REV-2C-04`:** Add direct handler/action negative tests and `FUNDRAISING_MANAGER` PG18 actor test.
5. **Address `REV-2C-03` before Phase 2C+ customer mobile routes:** Formalize `CUSTOMER` in `public.roles` or separate `isLinkedCustomer` from `roles[]`.

### Preview Migration Prerequisites (Before Applying `202611200002` & `202611200003`)
1. Confirm `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set in Vercel Preview.
2. Snapshot Preview `pg_publication_tables` for `supabase_realtime` and verify active Preview web workflows (public `/`, `/buy`, `/verify/*`, `/admin/draw`) immediately after applying `202611200002` and `202611200003`.
3. Run live Preview smoke tests on `GET /api/mobile/v1/me` with synthetic Preview JWTs (valid, expired, malformed, inactive).

---

## 7. Final Safety Confirmation

Confirmed — during Phase 2C:
- **No source files modified.**
- **No migrations created, applied, or executed.**
- **No Preview (`jiyuiydzsfydjklosvvq`) or Production (`fohpqheglxhfdecadhzw`) database accessed.**
- **No Auth accounts or roles changed.**
- **No tickets, payments, or draws modified.**
- **No email, WhatsApp, or push notifications sent.**
- **No Vercel deployment or configuration changed.**
- **No Git commit or push.**
- **No secrets or customer PII exposed.**
