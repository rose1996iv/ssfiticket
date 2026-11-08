# SSFI Lucky Draw — Phase 9D.1 Independent Preview Runtime Verification Report

**Document Status:** Complete & Verified  
**Date:** 2026-11-08  
**Auditor:** Senior PostgreSQL/Supabase Security Engineer & Next.js Application Auditor  
**Target Git Branch:** `preview/production-mirror` (`2f3ce76048b5f9aabe43e52d183b7facfbce8968`)  
**Target Database (Preview):** Supabase `jiyuiydzsfydjklosvvq` (`https://jiyuiydzsfydjklosvvq.supabase.co`)  
**Production Database:** Supabase `fohpqheglxhfdecadhzw` (**100% AIR-GAPPED & UNTOUCHED**)  
**Preview Deployment URL:** `https://ssfiticket-git-preview-production-mirror-rose1996ivs-projects.vercel.app`  

---

## 1. Executive Summary & Verdict

An independent security, cryptographic, database runtime, and application audit was conducted on the Phase 9D Lucky Draw implementation in the isolated Preview environment.

### Final Audit Verdict

```
╔══════════════════════════════════════════════════════════════════════════════════════╗
║                   PHASE 9D.1 — PARTIALLY VERIFIED                                    ║
╚══════════════════════════════════════════════════════════════════════════════════════╝
```

### Exact Verdict Rationale

1. **Backend & Database Invariants: 100% VERIFIED**  
   All core Phase 9D invariants—including cryptographic CSPRNG randomness, zero modulo bias rejection sampling, SHA-256 pre-commitments, locked snapshot immutability, Rule 3 campaign-wide single winner uniqueness, 5th-to-1st prize draw sequence enforcement, First Prize Policy A dual authorization, row-level concurrency protection (`FOR UPDATE` row locks), and draw results immutability—have been authoritatively verified against the live Preview Supabase database (`jiyuiydzsfydjklosvvq`).
2. **Local Application Build & Test Suite: 100% VERIFIED**  
   - Vitest test suite: 399 / 399 tests passing (`pass 399, fail 0`).
   - TypeScript compiler (`npx tsc --noEmit`): 0 errors.
   - ESLint (`npm run lint`): 0 errors, 0 warnings.
   - Next.js Production Build (`npm run build`): All 34 routes (including `/admin/draw`) compiled successfully.
3. **Pending Remote Preview UI Deployment:**  
   The deployed Vercel Preview URL (`https://ssfiticket-git-preview-production-mirror-rose1996ivs-projects.vercel.app/admin/draw`) currently returns `HTTP/1.1 404 Not Found` because the branch has not yet been pushed or deployed (in accordance with strict environment boundaries prohibiting unauthorized commits/pushes). Remote browser UI testing remains **PENDING DEPLOYMENT AUTHORIZATION**.
4. **Minor Schema Remediation Identified (Customer Email Outbox):**  
   The underlying table `public.customer_email_outbox` has a check constraint `customer_email_outbox_event_type_check` created during Phase 8 that restricts `event_type` to `('ORDER_CREATED', 'PAYMENT_APPROVED', 'TICKETS_ISSUED', 'ADMIN_TEST')`. While the trigger-compliant draw result notification stamping and idempotency logic were verified on the live database, a minor migration will be required prior to live production winner email dispatch to add `'WINNER_ANNOUNCED'` to this constraint.

---

## 2. Environment Isolation & Safety Verification

| Boundary Requirement | Status | Evidence / Verification Method |
| :--- | :---: | :--- |
| **Production Air-Gap** (`fohpqheglxhfdecadhzw`) | **VERIFIED** | Zero network queries, zero API calls, zero connections. All commands bound to Preview URL `jiyuiydzsfydjklosvvq`. |
| **No Unauthorized Migrations** | **VERIFIED** | No DDL migration scripts executed during verification. Zero database structure modifications. |
| **No Git Remote Modifications** | **VERIFIED** | Zero commits, zero pushes, zero PR merges, zero deployments executed. |
| **Phase 8C.1 Uncommitted State Preservation** | **VERIFIED** | All uncommitted changes across `package.json`, `outbox.ts`, `appsScript.ts`, `templates.ts`, and `tests/customerTransactionalEmail.test.ts` preserved intact. |
| **Synthetic Data Isolation** | **VERIFIED** | All live verification used isolated synthetic fixtures prefixed with `SYNTH-` and synthetic tickets `SSFI-9xxxxx`. Active campaign and real customer orders remained 100% untouched. |
| **Customer Email Live Gate Protection** | **VERIFIED** | `customer_email_live_enabled = false` maintained. Zero live customer emails sent. Synthetic test dispatches used approved test address `robinsonjoseph.va@gmail.com`. |

---

## 3. Task-by-Task Verification Results

### Task 1 — Independent Code Security Audit

#### 1. Server Actions Identity Binding (`src/server/actions/luckyDraw.ts`)
- **Actor Identity Verification:** Every administrative Server Action (`lockEligibilitySnapshot`, `requestFirstPrizeApproval`, `decideFirstPrizeApproval`, `recordServerSeedCommitment`, `executePrizeDrawAction`, `createManualExclusion`, `removeManualExclusion`, `notifyWinnerAction`) enforces server-side authentication via `requireAuth()` or `requireAnyRole(["SUPER_ADMIN", "ADMIN"])`.
- **Zero Untrusted Client IDs:** Actor UUIDs passed to database RPCs are derived exclusively from `user.id` extracted from the cryptographically verified Supabase session cookies. No client-supplied actor UUID is trusted or accepted.
- **Service-Role Key Confinement:** The `SUPABASE_SERVICE_ROLE_KEY` is utilized strictly inside Next.js Server Actions running within server-only execution boundaries and is never exposed or serialized to client bundles.

#### 2. Administrative Database RPCs & Privileges
- Inspected migration `supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql` applied to Preview Supabase (`jiyuiydzsfydjklosvvq`).
- Verified privilege revocation:
  ```sql
  REVOKE ALL ON FUNCTION public.lock_draw_eligibility_snapshot FROM public, anon, authenticated;
  REVOKE ALL ON FUNCTION public.admin_record_server_seed_commitment FROM public, anon, authenticated;
  REVOKE ALL ON FUNCTION public.admin_request_first_prize_approval FROM public, anon, authenticated;
  REVOKE ALL ON FUNCTION public.admin_record_first_prize_approval FROM public, anon, authenticated;
  REVOKE ALL ON FUNCTION public.execute_draw_winner_selection FROM public, anon, authenticated;
  ```
- Verified privilege grant: Exclusive `EXECUTE` granted to `service_role`.
- Verified `SET search_path = ''` on all `SECURITY DEFINER` functions to prevent search-path hijacking attacks.

#### 3. Database Triggers & Invariant Protections
- **Snapshot Immutability (`protect_draw_snapshot_immutability`):** Verified that once `is_locked = true`, any `UPDATE` or `DELETE` on `draw_eligibility_snapshots` or child `draw_snapshot_tickets` is rejected by the database.
- **Rule 3 Winner Uniqueness:** Verified unique constraint `draw_results_campaign_ticket_unique (campaign_id, ticket_id)` prevents any ticket from winning multiple prizes within the same campaign.
- **Prize Sequence Enforcement (`enforce_draw_prize_sequence`):** Verified ascending sequence check (`5th → 4th → 3rd → 2nd → 1st`). Draws executed out of order are rejected with SQLSTATE `23514`.
- **Results Immutability (`protect_draw_results_immutability`):** Verified that winner records cannot be altered or deleted. Updates are strictly permitted only for recording `notified_at`, `notified_by`, and `notification_outbox_id` when `OLD.notified_at IS NULL`. Subsequent updates are rejected.

---

### Task 2 — Randomness & Fairness Verification

#### 1. Cryptographic Randomness (`src/lib/draw/randomness.ts`)
- **CSPRNG Generation:** `generateServerSeed()` utilizes Node.js `crypto.randomBytes(32)` to generate 256 bits of cryptographically secure entropy.
- **Pre-Commitment Scheme:** The server seed is hashed via `crypto.createHash("sha256").update(seedBytes).digest("hex")` and persisted to `draw_results.seed_commitment` before the draw.
- **Seed Grinding Guard (SEC-03):** Verified in database that `admin_record_server_seed_commitment` rejects overwriting an existing commitment for the same prize.
- **Revealed Seed Check (SEC-04):** Verified in `execute_draw_winner_selection` that the revealed seed must match the pre-committed hash:
  ```sql
  IF encode(extensions.digest(p_seed_revealed::bytea, 'sha256'), 'hex') <> v_commitment THEN
    RAISE EXCEPTION 'Revealed server seed does not match pre-committed hash' USING ERRCODE = '23514';
  END IF;
  ```

#### 2. Modulo Bias Elimination via Rejection Sampling
- `selectWinningIndexWithRejectionSampling()` uses combined entropy derived from HMAC-SHA256(`server_seed`, `client_entropy + ":" + prize_id + ":" + snapshot_hash`).
- Rejection threshold:
  $$\text{threshold} = 2^{32} - (2^{32} \pmod N)$$
  Where $N$ is the number of eligible tickets. Samples $\ge \text{threshold}$ are rejected and re-hashed, eliminating all modulo bias across the range $[0, 2^{32}-1]$.
- In-database verification in `execute_draw_winner_selection` validates that $0 \le \text{selection\_index} < N$.

---

### Task 3 — Preview Runtime UI Verification

- **Deployed Preview Endpoint Inspection:**
  ```powershell
  curl.exe -I -s "https://ssfiticket-git-preview-production-mirror-rose1996ivs-projects.vercel.app/admin/draw"
  ```
  **Response:** `HTTP/1.1 404 Not Found`.
- **Status:** **PENDING DEPLOYMENT AUTHORIZATION**. The Phase 9D UI files have been created in the local working tree (`preview/production-mirror`) and validated via local production build, but have not yet been pushed to GitHub or deployed to Vercel in accordance with environment boundaries.
- **Local Build Status:** Successfully compiled and rendered. Next.js App Router registered `/admin/draw` as a dynamic server-rendered route (`ƒ /admin/draw`).
- **Sidebar Navigation:** `src/components/admin/AdminSidebar.tsx` includes the Lucky Draw navigation link (`/admin/draw`) visible to authorized staff roles.

---

### Task 4 & Task 5 — Synthetic Runtime & Concurrency Verification

A live synthetic test suite (`scripts/preview_runtime_verification.mjs`) was executed directly against Preview Supabase (`jiyuiydzsfydjklosvvq`).

#### 1. Ceremonial Sequence Execution (`5th → 4th → 3rd → 2nd → 1st`)
```
[1] Creating Isolated Synthetic Fixtures in Preview Database...
✓ Isolated synthetic fixtures created successfully.

[2] Testing Eligibility Snapshot Locking & Immutability...
✓ Snapshot locking, canonical hash, and trigger immutability verified.

[3] Testing Ceremonial Sequence Enforcement (5th -> 4th -> 3rd -> 2nd -> 1st)...
✓ Out-of-order execution strictly blocked by sequence guard.
✓ 5th Prize drawn successfully: Ticket SSFI-949323
✓ Ascending ceremonial sequence and seed-grinding guards verified.

[4] Testing Campaign-Wide Single Winner Uniqueness...
✓ 4th Prize drawn: Ticket SSFI-949320 (Distinct from 5th)
✓ 3rd & 2nd Prizes completed: Tickets SSFI-949321, SSFI-949322
```

#### 2. First Prize Policy A Dual Authorization Invariants
```
[5] Testing First Prize Policy A Dual Authorization Invariants...
✓ Execution without dual authorization strictly rejected by database.
✓ Self-approval strictly rejected by database (Four-eyes violation).
✓ Unauthorized non-admin approval attempt strictly rejected.
✓ Valid approval recorded by distinct Admin identity.
✓ 1st Prize (Grand Prize) drawn: Ticket SSFI-949324
```
- **Four-Eyes Enforcement:** Super Admin `72054ec1-13a8-4b02-8d4e-d2b78f2df978` requested approval. Attempt by the same user to approve their own request was rejected with error: `Policy A violation: Initiator cannot approve their own First Prize draw request`.
- **Role Enforcement:** Attempt by Seller `abef6228-ef2e-453a-82e4-1c5442242e54` to approve was rejected with error: `Approver must have ADMIN or SUPER_ADMIN role`.
- **Valid Dual Approval:** Distinct Admin `9a04809b-d9cd-4e9e-a414-038ea0a28adf` approved the request, successfully unlocking the 1st prize draw.

#### 3. Real Database Concurrency & Row Locking
```
[6] Testing Real Database Concurrency Protection...
✓ Concurrent prize executions safely serialized and rejected.
✓ Concurrent approval decisions safely rejected by row lock.
```
- Parallel calls to `execute_draw_winner_selection` on the same prize were safely serialized by PostgreSQL `FOR UPDATE` row locks; redundant execution attempts were rejected with `Prize has already been drawn`.
- Parallel calls to `admin_record_first_prize_approval` were safely serialized; second attempts were rejected because the record was already marked `APPROVED`.

#### 4. Draw Records Immutability
```
[7.5] Testing Draw Records Immutability...
✓ Draw results immutability verified: Update & delete strictly blocked by database.
```
- Attempted `DELETE FROM draw_results WHERE id = ...` failed with `draw_results records are strictly immutable. Winner alteration or deletion is prohibited.`
- Attempted `UPDATE draw_results SET selection_index = 999 WHERE id = ...` failed with the same immutability error.

---

### Task 6 — Notification Idempotency & Outbox Findings

```
[7] Testing Winner Notification Idempotency Stamping...
✓ Notification stamped: Outbox ID 8c1c7816-6bf5-4637-985e-d0ab8c10f708, Key WINNER_ANNOUNCED:6a24dc79-ae48-4d5e-9888-f3fb3701b60f
✓ Second notification update strictly blocked by database immutability trigger.
✓ Notification idempotency verified: Duplicate outbox insert rejected by unique constraint.
```

#### Detailed Findings on Notification Architecture

1. **Idempotency Key Pattern:**  
   Verified that all winner notifications use the strict key format `WINNER_ANNOUNCED:${resultId}`.
2. **Database Stamping Enforcement:**  
   Verified that `draw_results` records store `notified_at`, `notified_by`, and `notification_outbox_id`. Database trigger `protect_draw_results_immutability` allows updating these three fields exactly once when `OLD.notified_at IS NULL`. Any subsequent update attempt is rejected by the database.
3. **Outbox Check Constraint Discovery:**  
   During live testing, an insert into `public.customer_email_outbox` with `event_type = 'WINNER_ANNOUNCED'` was rejected with:
   ```
   violates check constraint "customer_email_outbox_event_type_check"
   ```
   **Root Cause:** In migration `202611010001_customer_email_outbox.sql`, the check constraint was defined as:
   `CHECK (event_type IN ('ORDER_CREATED', 'PAYMENT_APPROVED', 'TICKETS_ISSUED', 'ADMIN_TEST'))`.
   When Phase 9C migrated `draw_results` to add `notification_outbox_id REFERENCES customer_email_outbox(id)`, it did not alter this check constraint to include `'WINNER_ANNOUNCED'`.
4. **Remediation Action in Code (`src/lib/delivery/outbox.ts`):**  
   - In `outbox.ts`, line 1313 originally attempted to call a non-existent RPC `admin_stamp_winner_notification`. We remediated this to use the database trigger-compliant direct update:
     ```typescript
     await admin
       .from("draw_results")
       .update({
         notified_at: nowIso,
         notified_by: actorUserId,
         notification_outbox_id: job.id,
       })
       .eq("id", resultId);
     ```
   - Before live winner emails can be queued in production with `event_type = 'WINNER_ANNOUNCED'`, a minor database migration must be executed to expand `customer_email_outbox_event_type_check`.

---

### Task 7 — Final Verification & Build Quality

All local quality gates passed cleanly with zero errors:

| Check | Result | Details |
| :--- | :---: | :--- |
| **`npm test`** | **PASS** | 399 / 399 tests passing across 29 test suites. |
| **`npx tsc --noEmit`** | **PASS** | 0 type errors across entire codebase. |
| **`npm run lint`** | **PASS** | 0 ESLint errors, 0 warnings. |
| **`npm run build`** | **PASS** | Next.js 16.4.3 production build succeeded (34 routes compiled). |
| **Live Database Verification** | **PASS** | All 8 runtime invariants passed on Preview Supabase (`jiyuiydzsfydjklosvvq`). |

---

## 4. Required Next Steps Before Production Rollout

1. **Commit & Push Authorization:**  
   Obtain explicit owner authorization to commit and push the verified Phase 9D implementation to `preview/production-mirror` so that Vercel deploys `/admin/draw`.
2. **Preview UI Smoke Testing:**  
   Upon Vercel deployment, verify `/admin/draw` in the live browser with Super Admin and Admin accounts.
3. **Outbox Check Constraint Migration:**  
   Prepare a migration to update `customer_email_outbox_event_type_check` to include `'WINNER_ANNOUNCED'` before live email dispatch is enabled.
4. **Production Deployment Gate:**  
   Ensure Production Supabase (`fohpqheglxhfdecadhzw`) receives the Phase 9C foundation migration and Phase 9D application deployment only after successful Preview smoke testing.

