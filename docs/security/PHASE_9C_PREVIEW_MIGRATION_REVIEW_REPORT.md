# SSFI Lucky Draw — Phase 9C: Preview Database Migration Review Report

**Date:** 8 November 2026  
**Status:** READY FOR PREVIEW DEPLOYMENT REVIEW (ZERO EXECUTION COMPLETED)  
**Target Migration File:** `supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql`  
**Migration SHA-256 Digest:** `eb1927bf5dad3651f918745785627c85aa244b8ebd1619a748fd72565f9c8edf`  
**Target Environment:** Preview Supabase (`jiyuiydzsfydjklosvvq`)  
**Production Air-Gap Status:** 100% UNTOUCHED / ZERO CONTACT (`fohpqheglxhfdecadhzw`)  

---

## 1. Executive Summary

This report delivers the comprehensive database migration preparation and static review for **SSFI Lucky Draw Phase 9C: Secure Lucky Draw Winner Selection Foundation**.

All foundational architecture and database specifications from **Phase 9A** and **Phase 9B** have been updated to reflect the Owner's official sign-off on **Policy A (First Prize Two-Person Dual Authorization)**.

A single, non-destructive, idempotent migration script has been authored at:
`supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql`

### Strict Execution Safety Declaration
- **NO SQL MIGRATION WAS EXECUTED.** Neither Preview Supabase nor Production Supabase were modified during this phase.
- **NO DATA WAS ALTERED.** Existing ticket sequences, order payment snapshots, audit logs, and customer profiles remain intact.
- **NO APPLICATION SOURCE CODE WAS COMMITTED OR DEPLOYED.** Working tree integrity has been preserved.

---

## 2. Official Policy A Integration

The Owner has approved **Policy A** for First Prize authorization, which establishes dual-control separation of duties using the existing staff roster without requiring account promotions.

### 2.1 Core Authorization Invariants

```
                [ Locked Snapshot Ready ]
                          |
                          v
         [ SUPER_ADMIN Initiates Request ]
           (admin_request_first_prize_approval)
                          |
                          v
         Status: PENDING (approver_id = NULL)
                          |
                          v
       [ Distinct ADMIN or SUPER_ADMIN Approves ]
           (admin_record_first_prize_approval)
         (Enforces approver_id <> initiator_id)
                          |
                          v
                  Status: APPROVED
                          |
                          v
        [ Ceremonial Drum Activation & Draw ]
           (execute_draw_winner_selection)
```

1. **Initiator Role:** Must possess `SUPER_ADMIN` role (`public.has_role(actor, 'SUPER_ADMIN')`). Staff with `ADMIN` role cannot initiate.
2. **Approver Role:** Must possess either `ADMIN` or `SUPER_ADMIN` role (`public.has_role(actor, 'ADMIN') OR public.has_role(actor, 'SUPER_ADMIN')`).
3. **Distinct Identity Separation:** The initiator and approver must be two distinct authenticated users. Self-approval is prohibited at the database schema level:
   ```sql
   CONSTRAINT draw_approvals_distinct_actors CHECK (approver_id IS NULL OR initiator_id <> approver_id)
   ```
4. **Cryptographic Snapshot Binding:** Approvals are strictly bound to `(draw_id, prize_id, snapshot_hash)`. If the candidate roster or snapshot hash changes, any pending approval is immediately invalidated.
5. **Preview Roster Compatibility:**
   - Active `SUPER_ADMIN`: `72054ec1-13a8-4b02-8d4e-d2b78f2df978` (`ssfi.lucky.draw@gmail.com`)
   - Active `ADMIN`: `9a04809b-d9cd-4e9e-a414-038ea0a28adf` (`alok.mishra.preview.admin@gmail.com`)
   - *Result:* 100% operational readiness with 0 account escalations or role adjustments needed.

---

## 3. Schema Delta Breakdown

The migration introduces five new tables, upgrades two existing tables, creates four immutability triggers, and deploys five security-definer stored procedures.

### 3.1 Table Upgrades

| Table | Modification | Purpose |
| :--- | :--- | :--- |
| `public.draws` | `ADD COLUMN IF NOT EXISTS current_prize_id uuid` | Tracks active ceremonial stage |
| `public.draws` | `ADD COLUMN IF NOT EXISTS seed_commitment text` | SHA-256 pre-commitment hash |
| `public.draws` | `ADD COLUMN IF NOT EXISTS seed_revealed text` | Revealed CSPRNG server seed |
| `public.draws` | `ADD COLUMN IF NOT EXISTS client_entropy text` | Live administrator client seed |
| `public.draws` | `ADD COLUMN IF NOT EXISTS locked_by uuid` | Staff member who locked session |
| `public.draw_results` | `ADD COLUMN IF NOT EXISTS campaign_id uuid` | Scope results to campaign |
| `public.draw_results` | `ADD COLUMN IF NOT EXISTS snapshot_id uuid` | Foreign key to locked roster |
| `public.draw_results` | `ADD COLUMN IF NOT EXISTS selection_index integer` | Unbiased winning index |
| `public.draw_results` | `ADD COLUMN IF NOT EXISTS seed_commitment text` | Auditable randomness commitment |
| `public.draw_results` | `ADD COLUMN IF NOT EXISTS seed_revealed text` | Auditable randomness reveal |
| `public.draw_results` | `ADD COLUMN IF NOT EXISTS combined_seed text` | HMAC-SHA256 combined entropy |
| `public.draw_results` | `ADD COLUMN IF NOT EXISTS drawn_by uuid` | Staff actor executing draw |
| `public.draw_results` | `ADD COLUMN IF NOT EXISTS notified_at timestamptz` | Governed notification timestamp |
| `public.draw_results` | `ADD COLUMN IF NOT EXISTS notified_by uuid` | Staff actor authorizing email |
| `public.draw_results` | `ADD COLUMN IF NOT EXISTS notification_outbox_id uuid` | Outbox deduplication link |
| `public.draw_results` | `ADD CONSTRAINT draw_results_campaign_ticket_unique` | **Rule 3:** Single prize win per campaign |

### 3.2 New Tables

| Table Name | Primary Purpose | Key Constraints |
| :--- | :--- | :--- |
| `public.draw_manual_exclusions` | Administrative candidate exclusions prior to draw locking | `UNIQUE (campaign_id, prize_id, ticket_id)` via partial index |
| `public.draw_eligibility_snapshots` | Locked, immutable candidate roster and SHA-256 digest | `UNIQUE (draw_id, prize_id)`, `CHECK (length(snapshot_hash) = 64)` |
| `public.draw_snapshot_tickets` | Canonically indexed snapshot roster items (`0` to `N - 1`) | `UNIQUE (snapshot_id, ticket_id)`, `UNIQUE (snapshot_id, display_index)` |
| `public.draw_approvals` | Policy A two-person dual control records for 1st Prize | `UNIQUE (draw_id, prize_id, snapshot_hash)`, `CHECK (approver_id IS NULL OR initiator_id <> approver_id)` |
| `public.draw_randomness_evidence` | Append-only public audit trail of cryptographic proofs | `UNIQUE (draw_id, prize_id)`, `CHECK (total_candidates > 0)` |

### 3.3 Immutability Triggers

| Trigger Name | Target Table | Allowed Operations | Enforcement |
| :--- | :--- | :--- | :--- |
| `trg_protect_draw_results_immutability` | `public.draw_results` | `INSERT`, and one-time `UPDATE` of `notified_at` | Raises `23514` on any winner alteration or row deletion |
| `trg_protect_draw_snapshot_immutability` | `public.draw_eligibility_snapshots` | `INSERT` (when locked) | Raises `23514` on any `UPDATE` or `DELETE` once `is_locked = true` |
| `trg_protect_draw_snapshot_tickets_immutability` | `public.draw_snapshot_tickets` | `INSERT` during snapshot creation | Raises `23514` on modification or deletion if parent snapshot is locked |
| `trg_protect_draw_randomness_evidence_immutability` | `public.draw_randomness_evidence` | `INSERT` only | Strictly append-only; raises `23514` on `UPDATE` or `DELETE` |

### 3.4 Authoritative Stored Procedures

All stored procedures execute with `SECURITY DEFINER SET search_path = ''` to prevent search path poisoning.

1. **`public.admin_lock_eligibility_snapshot`**
   - Atomically locks candidate roster, calculates exclusions, writes canonical snapshot items, and logs audit record.
2. **`public.admin_request_first_prize_approval`**
   - Enforces `SUPER_ADMIN` caller, validates prize 1, binds to locked snapshot hash, and registers pending dual approval.
3. **`public.admin_record_first_prize_approval`**
   - Enforces `ADMIN` or `SUPER_ADMIN` caller, verifies pending status, rejects self-approval (`approver_id <> initiator_id`), and stamps decision.
4. **`public.execute_draw_winner_selection`**
   - Single-transaction atomic draw execution:
     - Enforces ascending sequence (`5th → 4th → 3rd → 2nd → 1st`).
     - Enforces Policy A dual approval for Prize 1.
     - Validates snapshot bounds (`0 <= winning_index < total_eligible_count`).
     - Verifies ticket status is `ISSUED`.
     - Enforces Rule 3 (single win per campaign).
     - Writes `draw_results`, `draw_randomness_evidence`, and `audit_logs` atomically.
5. **`public.admin_stamp_winner_notification`**
   - Stamped one-time notification dispatch, preventing duplicate emails.

---

## 4. Static SQL Review & Security Analysis

Static analysis was performed on `supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql`:

1. **Syntax & Block Balance:**
   - 34 dollar quote (`$$`) tags = exactly 17 balanced PL/pgSQL function/block definitions.
   - Net parenthesis nesting depth outside functions = `0`.
   - All SQL statements terminate cleanly with semicolons.
2. **Search Path Isolation:**
   - All 5 stored procedures specify `SECURITY DEFINER SET search_path = ''`.
   - All object references (`public.draws`, `public.prizes`, `public.tickets`, `public.audit_logs`, `public.is_staff`, `public.has_role`) are explicitly schema-qualified.
3. **Referential Integrity & Cascades:**
   - Sensitive parent foreign keys (`draw_id`, `campaign_id`, `prize_id`, `ticket_id`, `snapshot_id`) use `ON DELETE RESTRICT` to guarantee no accidental cascade deletions.
   - `public.draw_snapshot_tickets` uses `ON DELETE CASCADE` specifically on `snapshot_id` to maintain parent-child referential cleanup if an unlocked draft snapshot is ever discarded.
4. **Concurrency & Deadlock Prevention:**
   - `execute_draw_winner_selection` locks `draws`, `prizes`, and `draw_eligibility_snapshots` using `SELECT ... FOR UPDATE` in strict deterministic hierarchy to prevent deadlocks under concurrent requests.
5. **Least Privilege & RLS:**
   - All five new tables have Row-Level Security enabled (`ENABLE ROW LEVEL SECURITY`).
   - Default access for `public` and `anon` is explicitly revoked.
   - Public read policies (`draws_public_read`, `results_public_read`, `evidence_public_read`) grant read-only visibility exclusively to executed draws for transparent public auditability.

---

## 5. Verification Test Suite Results

The codebase was validated to ensure that no existing functionality was broken by the migration preparation:

```
TypeScript Compilation:   npx tsc --noEmit        --> PASSED (0 errors)
ESLint Static Analysis:   npm run lint             --> PASSED (0 errors, 0 warnings)
Unit & Integration Tests: npm test                 --> PASSED (364 / 364 tests passing)
Production Build Check:   npm run build            --> PASSED (25 / 25 routes generated)
```

---

## 6. Pre-Migration and Post-Migration SQL Verification Queries

When authorized to apply this migration to Preview, the database operator should execute the following verification queries:

### 6.1 Pre-Migration Baseline Query

```sql
-- Verify baseline table state before migration
SELECT table_name, (
  SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t.table_name
) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public' AND table_name IN ('draws', 'draw_results');

-- Confirm 0 existing rows
SELECT 'draws' as tbl, count(*) FROM public.draws
UNION ALL
SELECT 'draw_results' as tbl, count(*) FROM public.draw_results;
```

### 6.2 Post-Migration Verification Query

```sql
-- 1. Check all 7 Lucky Draw tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'draws',
    'draw_results',
    'draw_manual_exclusions',
    'draw_eligibility_snapshots',
    'draw_snapshot_tickets',
    'draw_approvals',
    'draw_randomness_evidence'
  )
ORDER BY table_name;

-- 2. Verify all 4 Immutability Triggers exist
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name IN (
    'trg_protect_draw_results_immutability',
    'trg_protect_draw_snapshot_immutability',
    'trg_protect_draw_snapshot_tickets_immutability',
    'trg_protect_draw_randomness_evidence_immutability'
  );

-- 3. Verify all 5 Stored Procedures exist
SELECT routine_name, routine_type, security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'admin_lock_eligibility_snapshot',
    'admin_request_first_prize_approval',
    'admin_record_first_prize_approval',
    'execute_draw_winner_selection',
    'admin_stamp_winner_notification'
  );

-- 4. Verify Single Winner Invariant Constraint
SELECT conname, contype
FROM pg_constraint
WHERE conname IN (
  'draw_results_campaign_ticket_unique',
  'draw_approvals_distinct_actors'
);
```

---

## 7. Rollback & Backout Strategy

If rollback is required prior to live draws, execute the following non-destructive down-script:

```sql
BEGIN;

-- 1. Drop Stored Procedures
DROP FUNCTION IF EXISTS public.admin_stamp_winner_notification(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.execute_draw_winner_selection(uuid, uuid, uuid, integer, text, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.admin_record_first_prize_approval(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.admin_request_first_prize_approval(uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.admin_lock_eligibility_snapshot(uuid, uuid, text, uuid[], text[], uuid);

-- 2. Drop Triggers and Trigger Functions
DROP TRIGGER IF EXISTS trg_protect_draw_randomness_evidence_immutability ON public.draw_randomness_evidence;
DROP FUNCTION IF EXISTS public.protect_draw_randomness_evidence_immutability();

DROP TRIGGER IF EXISTS trg_protect_draw_snapshot_tickets_immutability ON public.draw_snapshot_tickets;
DROP FUNCTION IF EXISTS public.protect_draw_snapshot_tickets_immutability();

DROP TRIGGER IF EXISTS trg_protect_draw_snapshot_immutability ON public.draw_eligibility_snapshots;
DROP FUNCTION IF EXISTS public.protect_draw_snapshot_immutability();

DROP TRIGGER IF EXISTS trg_protect_draw_results_immutability ON public.draw_results;
DROP FUNCTION IF EXISTS public.protect_draw_results_immutability();

-- 3. Drop Constraints & New Tables
ALTER TABLE public.draw_results DROP CONSTRAINT IF EXISTS draw_results_campaign_ticket_unique;

DROP TABLE IF EXISTS public.draw_randomness_evidence;
DROP TABLE IF EXISTS public.draw_approvals;
DROP TABLE IF EXISTS public.draw_snapshot_tickets;
DROP TABLE IF EXISTS public.draw_eligibility_snapshots;
DROP TABLE IF EXISTS public.draw_manual_exclusions;

-- 4. Revert Column Additions (Optional / Clean)
ALTER TABLE public.draw_results
  DROP COLUMN IF EXISTS notification_outbox_id,
  DROP COLUMN IF EXISTS notified_by,
  DROP COLUMN IF EXISTS notified_at,
  DROP COLUMN IF EXISTS drawn_by,
  DROP COLUMN IF EXISTS combined_seed,
  DROP COLUMN IF EXISTS seed_revealed,
  DROP COLUMN IF EXISTS seed_commitment,
  DROP COLUMN IF EXISTS selection_index,
  DROP COLUMN IF EXISTS snapshot_id,
  DROP COLUMN IF EXISTS campaign_id;

ALTER TABLE public.draws
  DROP COLUMN IF EXISTS locked_by,
  DROP COLUMN IF EXISTS client_entropy,
  DROP COLUMN IF EXISTS seed_revealed,
  DROP COLUMN IF EXISTS seed_commitment,
  DROP COLUMN IF EXISTS current_prize_id;

COMMIT;
```

---

## 8. Summary Table of Phase 9C Deliverables

| Deliverable | File Path | Status |
| :--- | :--- | :---: |
| **Phase 9A Architecture (Updated)** | `docs/security/PHASE_9A_SECURE_LUCKY_DRAW_ARCHITECTURE.md` | ✅ Complete |
| **Phase 9B Plan (Updated)** | `docs/security/PHASE_9B_DATABASE_AND_BACKEND_IMPLEMENTATION_PLAN.md` | ✅ Complete |
| **Phase 9C Migration File** | `supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql` | ✅ Prepared |
| **Phase 9C Review Report** | `docs/security/PHASE_9C_PREVIEW_MIGRATION_REVIEW_REPORT.md` | ✅ Complete |
| **Database Execution** | Supabase Preview / Production | ⏸️ **NOT EXECUTED** (Awaiting Owner Review) |

---

*Report prepared and statically verified for SSFI Lucky Draw Project Governance.*  
*File location: `docs/security/PHASE_9C_PREVIEW_MIGRATION_REVIEW_REPORT.md`*

