# SSFI Lucky Draw — Phase 2B.1–2B.7 Implementation & Security Regression Report

**Date:** 2026-11-20  
**Repository:** `F:\PROJECT\Lucky Draw`  
**Branch:** `preview/production-mirror`  
**HEAD Commit (Unchanged):** `f15d6a45d2ea1ef150aa85f65d7242940a5dbe8d`  
**Phase 2B Verdict:** **`PASS`**

---

## 1. Executive Summary

All seven Phase 2B workstreams (2B.1 through 2B.7) have been implemented locally and verified against TypeScript strict typechecking, the existing 433-test regression suite, a dedicated 19-test Phase 2B unit/security suite, and two real disposable local PostgreSQL 18 integration suites (Phase 2B RLS/Realtime + Phase 10B First Prize dual-authorization regression).

- **Critical Security Fix (2B.1):** Closed unauthenticated `service_role` customer PII reads and `ticket_deliveries`/`audit_logs` mutations in `src/server/actions/whatsappDelivery.ts` with server-side authentication, active-profile validation, role/seller-ownership authorization, ticket-order-campaign integrity checks, and audit-log PII minimization.
- **High Security Fix (2B.2):** Created forward-only migration `202611200002_phase_2b2_direct_write_rls_hardening.sql` revoking direct `authenticated` write privileges across all 10 audit-flagged operational/draw tables while preserving public `ACTIVE` reads (also fixing an `anon` `permission denied for function is_staff` RLS evaluation bug discovered in real PostgreSQL 18 testing), authenticated staff `SELECT`s, Phase B2 R4 `anon` draw revocations, Phase 10B First Prize dual authorization, and `service_role` writes.
- **High Security Fix (2B.3):** Fixed the broken `.eq("user_id", user.id)` seller lookup in `src/lib/security/orderAccessToken.ts` to use canonical `sellers.profile_id = user.id` plus `is_active === true`.
- **Medium Security Fix (2B.4):** Added `user.id`-keyed scoped rate limiting (`20` exports / 15 min, immune to spoofed IP headers) and sanitized `500` error responses in `src/app/api/admin/export/route.ts`.
- **Medium Infrastructure Fix (2B.5):** Created idempotent migration `202611200003_phase_2b5_realtime_publication.sql` codifying `supabase_realtime` membership strictly for the 3 subscribed draw tables (`draw_results`, `draw_eligibility_snapshots`, `draw_approvals`) and excluding sensitive PII/financial tables.
- **High Architecture Foundation (2B.6):** Implemented reusable Bearer JWT authentication and authoritative database RBAC resolution in `src/lib/auth/mobile.ts` and the minimal protected identity endpoint `GET /api/mobile/v1/me` (`src/app/api/mobile/v1/me/route.ts`).
- **Verification (2B.7):** **464 / 464 tests passing**, `0` TypeScript errors, `0` failures, `0` skipped.

---

## 2. Initial Repository Safety Check

- **Repository Path:** `F:\PROJECT\Lucky Draw`
- **Branch:** `preview/production-mirror`
- **HEAD Commit:** `f15d6a45d2ea1ef150aa85f65d7242940a5dbe8d` (Phase 1 release; verified unchanged before and after implementation)
- **Pre-existing Modified Files (Preserved Untouched):** `package.json`, `package-lock.json`
- **Pre-existing Untracked Files (Preserved Untouched):** `docs/security/*`, `reports/*`, `scripts/*`, `preview-*.zip`, `tests/phaseB2_8_2RestoreVerification.test.ts`
- **No dependencies were installed or upgraded.**

---

## 3. Exact Files Inspected

- `reports/phase-2a-api-audit/PHASE_2A_BACKEND_API_AUDIT.md`
- `src/server/actions/whatsappDelivery.ts`
- `src/components/delivery/WhatsAppTicketDeliveryButton.tsx`
- `src/lib/security/orderAccessToken.ts`
- `src/lib/security/rateLimit.ts`
- `src/app/api/admin/export/route.ts`
- `src/lib/auth/server.ts`
- `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase/admin.ts`, `src/lib/supabase/config.ts`
- `src/components/admin/draw/LuckyDrawDashboard.tsx`, `src/components/home/PublicDrawWinnersSection.tsx`
- `tests/phaseB1_1PostgresSecurity.test.ts`, `tests/phase10bRBACAndApproval.test.ts`
- `supabase/migrations/202610270001_phase2_core.sql`, `202610300001_p0_security_remediation.sql`, `202611010001_customer_email_outbox.sql`, `202611080001_phase9c_lucky_draw_foundation.sql`, `202611140003_phase_b2_public_rls_hardening.sql`, `202611200001_phase_10b_initiator_role_and_approval_hardening.sql`

---

## 4. Exact Files Created

1. `src/lib/delivery/whatsappAuth.ts` — Pure, strictly typed WhatsApp delivery authorization and ticket/order/campaign integrity evaluator (Phase 2B.1).
2. `supabase/migrations/202611200002_phase_2b2_direct_write_rls_hardening.sql` — Forward-only RLS & privilege hardening migration (Phase 2B.2; **NOT applied**).
3. `supabase/migrations/202611200003_phase_2b5_realtime_publication.sql` — Idempotent `supabase_realtime` publication migration (Phase 2B.5; **NOT applied**).
4. `src/lib/auth/mobile.ts` — Reusable Bearer JWT authentication, authoritative DB role resolution, sanitized response helpers, and `/api/mobile/v1/me` handler (Phase 2B.6).
5. `src/app/api/mobile/v1/me/route.ts` — Protected `GET /api/mobile/v1/me` Next.js Route Handler (Phase 2B.6).
6. `tests/phase2bSecurityHardening.test.ts` — Unit & security regression test suite for Phases 2B.1, 2B.3, 2B.4, and 2B.6 (19 tests).
7. `tests/phase2bPostgresRLSAndRealtime.test.ts` — Disposable local PostgreSQL 18 integration suite for Phases 2B.2, 2B.3, and 2B.5 (5 tests).
8. `reports/phase-2b-implementation/MOBILE_API_V1_CONTRACT.md` — Mobile API v1 contract documentation.
9. `reports/phase-2b-implementation/PHASE_2B_IMPLEMENTATION_REPORT.md` — This implementation report.

---

## 5. Exact Files Modified

1. `src/server/actions/whatsappDelivery.ts` — Added trusted server-side authentication, active-profile check, authoritative role & seller ownership verification, ticket-order-campaign integrity checks, PII-minimized audit logging, and safe error handling across `prepareWhatsAppTicketDelivery`, `recordWhatsAppOpenedAction`, and `recordWhatsAppManuallySentAction`.
2. `src/lib/security/orderAccessToken.ts` — Fixed `verifyOrderAccess` seller lookup from `.eq("user_id", user.id)` to canonical `.eq("profile_id", user.id)` and enforced `sellerRow.is_active === true`.
3. `src/lib/security/rateLimit.ts` — Added reusable `checkScopedRateLimit()` reusing the existing Upstash Redis pipeline + salted hashing + in-memory fallback.
4. `src/app/api/admin/export/route.ts` — Added `user.id`-keyed scoped rate limiting (`20` / 15m, HTTP `429` + `Retry-After`) and removed raw `details: errorObj?.message` from `500` responses and error logs.

---

## 6. Workstream Implementation & Security Design Decisions

### Phase 2B.1 — WhatsApp Delivery Authorization
- **Decision:** Separated `evaluateWhatsAppDeliveryAuthorization` (`src/lib/delivery/whatsappAuth.ts`) from Next.js Server Action plumbing so all positive, negative, IDOR, inactive-account, and ticket-relationship-mismatch paths are deterministically unit-tested.
- **Enforcement:** All three actions validate `orderId` as a UUID, resolve identity strictly from `getCurrentUser()` (never accepting client-supplied user IDs, roles, or seller IDs), verify `profiles.is_active === true`, check authoritative roles via `hasCurrentUserRole`, enforce `sellers.profile_id = user.id AND sellers.is_active = true AND order.seller_id = seller.id` for `SELLER`, verify every ticket's `order_id` and `campaign_id` match the order, and omit raw `recipient_phone` from `audit_logs`.

### Phase 2B.2 — Direct Write RLS & Privilege Hardening
- **Audit Scan:** Verified zero client-side (`createSupabaseBrowserClient`) or user-session (`createSupabaseServerClient`) direct writes exist anywhere in `src/` for all 10 tables; all legitimate writes already route through `service_role` or `SECURITY DEFINER` RPCs.
- **Policy & Grant Changes (`202611200002_phase_2b2_direct_write_rls_hardening.sql`):**

| Table | Readers Preserved | Direct `authenticated`/`anon` Writes | Server-Side Writer |
|---|---|---|---|
| `public.system_settings` | `authenticated` staff (`is_staff`) | **Revoked** (`system_settings_staff_update` dropped) | `service_role` |
| `public.campaigns` | `anon, authenticated` (`ACTIVE`); `authenticated` staff (all) | **Revoked** (`campaigns_staff_write` dropped) | `service_role` / scheduler RPC |
| `public.prizes` | `anon, authenticated` (for `ACTIVE` campaign); `authenticated` staff (all) | **Revoked** (`prizes_staff_write` dropped) | `service_role` |
| `public.profiles` | `authenticated` (own profile or `is_staff`) | **Revoked** (`profiles_staff_write` dropped) | `service_role` / `handle_new_user` trigger |
| `public.draws` | `authenticated` staff (`draws_staff_read`); `anon` stays **revoked** | **Revoked** (`draws_staff_access` replaced) | `service_role` / draw RPCs |
| `public.draw_results` | `authenticated` staff (`results_staff_read`); `anon` stays **revoked** | **Revoked** (`results_staff_access` replaced) | `service_role` / `execute_draw_winner_selection` |
| `public.draw_manual_exclusions` | `authenticated` staff (`exclusions_staff_read`) | **Revoked** (`exclusions_staff_access` replaced) | `service_role` |
| `public.draw_eligibility_snapshots` | `authenticated` staff (`snapshots_staff_read`) | **Revoked** (`snapshots_staff_access` replaced) | `service_role` / `admin_lock_eligibility_snapshot` |
| `public.draw_snapshot_tickets` | `authenticated` staff (`snapshot_tickets_staff_read`) | **Revoked** (`snapshot_tickets_staff_access` replaced) | `service_role` / `admin_lock_eligibility_snapshot` |
| `public.draw_randomness_evidence` | `authenticated` staff (`evidence_staff_read`); `anon` stays **revoked** | **Revoked** (`evidence_staff_access` replaced) | `service_role` / `execute_draw_winner_selection` |

- **Bonus PostgreSQL RLS Fix Discovered During Testing:** Splitting `campaigns_public_read` and `prizes_public_read` into separate `anon, authenticated` (`status = 'ACTIVE'`) and `authenticated` (`is_staff`) policies eliminated `ERROR: permission denied for function is_staff` when `anon` queried `campaigns`/`prizes` directly under PostgreSQL 18.

### Phase 2B.3 — Seller Ownership Fix
- Verified in `202610270001_phase2_core.sql` and live PostgreSQL 18 `information_schema.columns` that `public.sellers` uses `profile_id` referencing `public.profiles(id)` (no `user_id` column exists). Updated `src/lib/security/orderAccessToken.ts:380` to `.eq("profile_id", user.id)` and added `is_active === true` enforcement while leaving all cryptographic token verification, SHA-256 constant-time digest comparison, and rate limiting unchanged.

### Phase 2B.4 — Admin Export Hardening
- Added `checkScopedRateLimit({ scope: "admin_export", identifier: user.id, maxAttempts: 20, windowSeconds: 900 })` keyed strictly on verified server-side `user.id` so spoofed `X-Forwarded-For` headers cannot bypass export throttling. Removed `details: errorObj?.message` from the `500` JSON body and error logs.

### Phase 2B.5 — Realtime Publication Migration
- Created idempotent `202611200003_phase_2b5_realtime_publication.sql` ensuring `supabase_realtime` includes ONLY `draw_results`, `draw_eligibility_snapshots`, and `draw_approvals` (the exact 3 tables subscribed to in `LuckyDrawDashboard.tsx`), preserving existing publication membership and excluding sensitive PII/financial/audit tables.

### Phase 2B.6 — Mobile API Authentication Foundation
- Created `src/lib/auth/mobile.ts` and `src/app/api/mobile/v1/me/route.ts` enforcing `Authorization: Bearer <jwt>` extraction, server-side `supabase.auth.getUser(token)` validation, `profiles.is_active` enforcement, authoritative database role resolution (`public.has_role` + `sellers.is_active` + `customers.profile_id`), dual IP/user rate limiting, and sanitized `{ apiVersion: "v1", ... }` JSON responses. Full contract documented in `reports/phase-2b-implementation/MOBILE_API_V1_CONTRACT.md`.

---

## 7. Verification Results & Before/After Baseline

| Suite | Before (Baseline) | After (Phase 2B) | Result |
|---|---|---|---|
| `npm run typecheck` (`tsc --noEmit`) | `0` errors | `0` errors | **PASS** |
| `npm test` (existing 30-file regression suite) | `433 / 433` passed | `433 / 433` passed (`0` fail, `0` skip) | **PASS** |
| `node --test tests/phase2bSecurityHardening.test.ts` | *(new)* | `19 / 19` passed (`0` fail, `0` skip) | **PASS** |
| `node --test tests/phase2bPostgresRLSAndRealtime.test.ts` (Disposable PG18) | *(new)* | `5 / 5` passed (`0` fail, `0` skip) | **PASS** |
| `node --test tests/phase10bRBACAndApproval.test.ts` (Disposable PG18) | `7 / 7` passed | `7 / 7` passed (`0` fail, `0` skip) | **PASS** |
| **Total** | **440 / 440** | **464 / 464** | **PASS** |

- **Failed or Skipped Tests:** None (`0` failed, `0` skipped).

---

## 8. Remaining Risks, Compatibility Notes & Deployment Prerequisites

1. **Migrations Not Yet Applied:** `202611200002_phase_2b2_direct_write_rls_hardening.sql` and `202611200003_phase_2b5_realtime_publication.sql` are local files only and require separate owner authorization before applying to Preview (`jiyuiydzsfydjklosvvq`).
2. **Upstash Redis in Production:** `checkScopedRateLimit` falls back to in-memory buckets in local/dev environments; ensure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured in Vercel Preview/Production for distributed multi-instance rate limiting.
3. **Compatibility:** `WhatsAppTicketDeliveryButton.tsx` return shapes and `/api/admin/export` success payload formats remain 100% backward-compatible for authorized users.
4. **Deferred to Future Phases:** Business mobile endpoints (`/orders`, `/tickets`, `/payments`, `/members`, `/sellers`, `/notifications`), `CUSTOMER` role seeding in `public.roles`, and FCM device token table remain deferred per Phase 2B.6 scope.

---

## 9. Explicit Safety Boundary Confirmation

- **No Preview database changes** (`jiyuiydzsfydjklosvvq` untouched).
- **No Production database changes** (`fohpqheglxhfdecadhzw` untouched).
- **No migrations applied or rolled back** against any Supabase environment.
- **No Auth account, password, session, or role changes.**
- **No emails, WhatsApp messages, or push notifications sent.**
- **No real ticket, payment, or draw operations executed.**
- **No Vercel configuration or deployment changes.**
- **No Git commit, push, merge, rebase, or history alteration.**
- **No secrets, tokens, service-role keys, or customer PII exposed.**
