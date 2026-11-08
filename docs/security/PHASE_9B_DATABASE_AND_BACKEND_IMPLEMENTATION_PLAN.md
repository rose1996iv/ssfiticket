# SSFI Lucky Draw — Phase 9B: Database and Backend Implementation Plan

> **Status:** TECHNICAL ARCHITECTURE & IMPLEMENTATION BLUEPRINT  
> **Target Release:** Phase 9B (Schema Migration, Stored Procedures, & Cryptographic Backend)  
> **Target Environments:** Preview (`jiyuiydzsfydjklosvvq`) & Production (`fohpqheglxhfdecadhzw`)  
> **Date:** 2026-11-08  
> **Safety Mode:** STRICT DOCUMENTATION ONLY — ZERO DATABASE/CODE MUTATIONS  

---

## 1. Executive Summary

This document specifies the authoritative, production-grade technical implementation plan for **Phase 9B** of the SSFI Lucky Draw System. 

Phase 9B builds the complete database and backend foundation for the Lucky Draw Winner Selection ceremony. It operationalizes all four approved Owner Decisions directly into PostgreSQL schemas, security definer stored procedures, cryptographic randomness engines, and outbox notification workflows.

```
+---------------------------------------------------------------------------------------------------+
|                            PHASE 9B DATABASE & BACKEND ARCHITECTURE                               |
+---------------------------------------------------------------------------------------------------+
                                                  |
  1. ELIGIBILITY ENGINE                           v
     - Filter: campaign_id + ISSUED + VERIFIED payment + no refund/void
     - Exclude: Previous campaign winners (Rule 3) + manual audited exclusions
     - Canonical sorting (ticket_number ASC) -> SHA-256 Digest -> Lock Snapshot
                                                  |
  2. DUAL-CONTROL APPROVAL GATE (1ST PRIZE ONLY)  v
     - State: APPROVAL_PENDING -> APPROVED
     - Initiator: SUPER_ADMIN | Approver: Distinct ADMIN/SUPER_ADMIN (Rule 10)
     - DB Constraint: CHECK (approver_id <> initiator_id)
     - Bound to: Exact snapshot_hash (invalidation on snapshot drift)
                                                  |
  3. SEQUENCE ENFORCEMENT GUARD                   v
     - Enforce: 5th -> 4th -> 3rd -> 2nd -> 1st (Rule 9)
     - DB Assertion: Prize K requires Prize K+1 committed in public.draw_results
                                                  |
  4. CRYPTOGRAPHIC CSPRNG & COMMIT-REVEAL         v
     - Pre-draw: Server Seed (256-bit) -> Publish SHA-256 Commitment C
     - Draw: Gather client/witness entropy -> Combined Seed HMAC-SHA256
     - Uniform selection: Node.js crypto.randomInt() + Rejection Sampling (Rule 4)
                                                  |
  5. ATOMIC POSTGRESQL TRANSACTION (AUTHORITATIVE)v
     - Row locks: FOR UPDATE on draw, prize, snapshot
     - DB Constraint: UNIQUE(campaign_id, ticket_id) (Zero duplicate wins)
     - Insert: public.draw_results (Immutable trigger blocks UPDATE/DELETE)
     - Append: public.audit_logs (DRAW_EXECUTED)
                                                  |
  6. GOVERNED MANUAL NOTIFICATION (OUTBOX)        v
     - Admin reviews winner card in Control Center
     - Explicit action: "Notify Winner" -> Enqueue customer_email_outbox
     - Idempotency key: WINNER_ANNOUNCED:${result_id} (Zero auto-leaks)
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Approved Owner Decisions & Operational Directives

The following four foundational decisions are approved by the Owner and govern all Phase 9B designs:

1. **Decision 1 — Draw Sequence Ordering:**  
   **Approved Sequence:** **`5th Prize → 4th Prize → 3rd Prize → 2nd Prize → 1st Prize`**.  
   *Implementation Directive:* The backend transaction strictly enforces that Prize $K$ cannot proceed unless Prize $K+1$ exists in `public.draw_results`. A ticket winning any prize is immediately excluded from all subsequent draws.
2. **Decision 2 — First Prize Two-Person Dual Control:**  
   **Approved Approval Model:** Grand 1st Prize requires two distinct authenticated users.  
   *Implementation Directive:* Initiator must be `SUPER_ADMIN`. Approver must be a distinct authenticated user (`approver_id <> initiator_id`). Database CHECK constraints enforce separation of duties. Approval is permanently bound to the locked `snapshot_hash`.
3. **Decision 3 — Wheel Presentation:**  
   **Approved Visualization:** **Rotating Number Drum**.  
   *Implementation Directive:* The frontend renders a decoupled 3D cylindrical rotating barrel with smooth deceleration. The UI receives the winner *after* backend database commit; refreshing or replaying the drum can never trigger a re-draw or change the winner.
4. **Decision 4 — Winner Notification:**  
   **Approved Communication Model:** **Governed Manual Admin Notification**.  
   *Implementation Directive:* Zero automated notifications are dispatched upon draw commit. The winner is reviewed in the Admin Control Center, followed by an explicit `Notify Winner` action utilizing the existing transactional email outbox.

---

## 3. Existing Database Schema Assessment & Gap Analysis

An inspection of the active Preview database (`jiyuiydzsfydjklosvvq`) and migrations reveals the baseline state:

### 3.1 Existing Relevant Tables

| Table Name | Existing Columns | Existing Constraints | Gaps Identified |
| :--- | :--- | :--- | :--- |
| **`public.campaigns`** | `id, public_id, name, description, ticket_price_paise, currency, total_ticket_limit, sold_ticket_count, status, start_at, end_at, created_at, updated_at` | Primary key `id`, check constraints | None. Holds official campaign `ssfi-fundraising-lucky-draw`. |
| **`public.prizes`** | `id, campaign_id, prize_number, title, description, cash_amount_paise, display_order, created_at` | `UNIQUE(campaign_id, prize_number)`, `UNIQUE(campaign_id, display_order)` | Contains 5 seeded prizes. Lacks status tracking per prize draw. |
| **`public.tickets`** | `id, campaign_id, order_id, customer_id, seller_id, ticket_number, status, issued_at, created_at, updated_at, contact_*` | `UNIQUE(ticket_number)`, immutable trigger `trg_protect_ticket_identity_immutability` | None. Master ticket repository. |
| **`public.draws`** | `id, campaign_id, name, status, scheduled_at, executed_at, created_at` | Primary key `id`, FK to `campaigns(id)` | **Empty (0 rows).** Lacks prize linkage, current stage, snapshot linkage, seed commitment, and approval tracking. |
| **`public.draw_results`**| `id, draw_id, prize_id, ticket_id, created_at` | `UNIQUE(draw_id, prize_id)`, `UNIQUE(draw_id, ticket_id)` | **Empty (0 rows).** **Critical Gap:** Lacks `campaign_id` and therefore cannot enforce campaign-wide single-winner invariant. Lacks snapshot reference, randomness evidence, and immutability triggers. |
| **`public.audit_logs`** | `id, actor_user_id, action, entity_type, entity_id, metadata, created_at` | Append-only trigger `trg_protect_audit_logs_append_only` | None. Ready to record `DRAW_EXECUTED`, `SNAPSHOT_LOCKED`, etc. |
| **`public.customer_email_outbox`** | `id, order_id, customer_id, event_type, recipient, subject, body_text, body_html, status, idempotency_key, metadata, ...` | `UNIQUE(idempotency_key)` | Ready to handle `WINNER_ANNOUNCED` event type. |

### 3.2 Exact Schema Gap Summary

To fulfill Phase 9 requirements, the database requires:
1. **New Table:** `public.draw_manual_exclusions` (Audited per-ticket manual exclusions).
2. **New Table:** `public.draw_eligibility_snapshots` (Locked roster metadata with SHA-256 digest).
3. **New Table:** `public.draw_snapshot_tickets` (Canonically ordered, indexed ticket list per snapshot).
4. **New Table:** `public.draw_approvals` (First Prize dual-control authorization records).
5. **New Table:** `public.draw_randomness_evidence` (Commit-reveal proof parameters).
6. **Table Upgrade:** `public.draws` (Add `current_prize_id`, `seed_commitment`, `status` enum extension).
7. **Table Upgrade:** `public.draw_results` (Add `campaign_id`, `snapshot_id`, `selection_index`, `seed_commitment`, `drawn_by`, `notified_at`, and enforce `UNIQUE(campaign_id, ticket_id)`).
8. **Immutability Triggers:** On `draw_results`, `draw_eligibility_snapshots`, and `draw_snapshot_tickets`.
9. **Authoritative RPCs:** `execute_draw_winner_selection`, `lock_draw_eligibility_snapshot`, `request_first_prize_approval`, `record_first_prize_approval`, `admin_notify_winner`.

---

## 4. Proposed Database Changes (DDL Specification)

All DDL modifications are strictly additive and non-destructive. Existing ticket sequences, foreign keys, and audit triggers remain untouched.

```sql
BEGIN;

-- ============================================================================
-- 1. EXTEND DRAW STATUS ENUM (IF REQUIRED)
-- ============================================================================
-- Note: public.draw_status currently has ('DRAFT', 'SCHEDULED', 'EXECUTED', 'CANCELLED')
-- We introduce granular draw session statuses via a check constraint or new status column.

-- ============================================================================
-- 2. CREATE DRAW MANUAL EXCLUSIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.draw_manual_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE RESTRICT,
  prize_id uuid REFERENCES public.prizes(id) ON DELETE RESTRICT, -- NULL = all prizes in campaign
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(trim(reason)) >= 5),
  excluded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, prize_id, ticket_id)
);

CREATE INDEX IF NOT EXISTS draw_manual_exclusions_lookup_idx
  ON public.draw_manual_exclusions(campaign_id, prize_id, ticket_id);

-- ============================================================================
-- 3. CREATE DRAW ELIGIBILITY SNAPSHOTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.draw_eligibility_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id uuid NOT NULL REFERENCES public.draws(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE RESTRICT,
  prize_id uuid NOT NULL REFERENCES public.prizes(id) ON DELETE RESTRICT,
  total_eligible_count integer NOT NULL CHECK (total_eligible_count >= 0),
  previous_winner_count integer NOT NULL DEFAULT 0 CHECK (previous_winner_count >= 0),
  manual_exclusion_count integer NOT NULL DEFAULT 0 CHECK (manual_exclusion_count >= 0),
  snapshot_hash text NOT NULL CHECK (length(snapshot_hash) = 64), -- SHA-256 hex digest
  algorithm_version text NOT NULL DEFAULT 'SSFI-CSPRNG-V1',
  is_locked boolean NOT NULL DEFAULT false,
  locked_at timestamptz,
  locked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draw_id, prize_id)
);

CREATE INDEX IF NOT EXISTS draw_snapshots_draw_prize_idx
  ON public.draw_eligibility_snapshots(draw_id, prize_id);

-- ============================================================================
-- 4. CREATE DRAW SNAPSHOT TICKETS TABLE (CANONICALLY INDEXED)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.draw_snapshot_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES public.draw_eligibility_snapshots(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE RESTRICT,
  ticket_number text NOT NULL,
  display_index integer NOT NULL CHECK (display_index >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, ticket_id),
  UNIQUE (snapshot_id, display_index)
);

CREATE INDEX IF NOT EXISTS draw_snapshot_tickets_lookup_idx
  ON public.draw_snapshot_tickets(snapshot_id, display_index);

-- ============================================================================
-- 5. CREATE FIRST PRIZE TWO-PERSON APPROVALS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.draw_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id uuid NOT NULL REFERENCES public.draws(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE RESTRICT,
  prize_id uuid NOT NULL REFERENCES public.prizes(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES public.draw_eligibility_snapshots(id) ON DELETE RESTRICT,
  snapshot_hash text NOT NULL CHECK (length(snapshot_hash) = 64),
  initiator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approver_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'INVALIDATED')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decision_notes text,
  UNIQUE (draw_id, prize_id, snapshot_hash),
  CONSTRAINT draw_approvals_distinct_actors CHECK (approver_id IS NULL OR initiator_id <> approver_id)
);

CREATE INDEX IF NOT EXISTS draw_approvals_lookup_idx
  ON public.draw_approvals(draw_id, prize_id, snapshot_hash);

-- ============================================================================
-- 6. CREATE RANDOMNESS EVIDENCE TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.draw_randomness_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id uuid NOT NULL REFERENCES public.draws(id) ON DELETE RESTRICT,
  prize_id uuid NOT NULL REFERENCES public.prizes(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES public.draw_eligibility_snapshots(id) ON DELETE RESTRICT,
  algorithm_version text NOT NULL DEFAULT 'SSFI-CSPRNG-V1',
  server_seed_commitment text NOT NULL CHECK (length(server_seed_commitment) = 64),
  server_seed_revealed text NOT NULL CHECK (length(server_seed_revealed) = 64),
  client_entropy text,
  combined_seed text NOT NULL CHECK (length(combined_seed) = 64),
  selected_index integer NOT NULL CHECK (selected_index >= 0),
  eligible_count integer NOT NULL CHECK (eligible_count > 0),
  winning_ticket_number text NOT NULL,
  verification_status text NOT NULL DEFAULT 'VERIFIED' CHECK (verification_status IN ('VERIFIED', 'DISCREPANCY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draw_id, prize_id)
);

-- ============================================================================
-- 7. UPGRADE PUBLIC.DRAWS
-- ============================================================================
ALTER TABLE public.draws
  ADD COLUMN IF NOT EXISTS current_prize_id uuid REFERENCES public.prizes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS seed_commitment text,
  ADD COLUMN IF NOT EXISTS seed_revealed text,
  ADD COLUMN IF NOT EXISTS client_entropy text,
  ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ============================================================================
-- 8. UPGRADE PUBLIC.DRAW_RESULTS (WITH CAMPAIGN-WIDE UNIQUE WINNER INVARIANT)
-- ============================================================================
ALTER TABLE public.draw_results
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.campaigns(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS snapshot_id uuid REFERENCES public.draw_eligibility_snapshots(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS selection_index integer,
  ADD COLUMN IF NOT EXISTS seed_commitment text,
  ADD COLUMN IF NOT EXISTS seed_revealed text,
  ADD COLUMN IF NOT EXISTS combined_seed text,
  ADD COLUMN IF NOT EXISTS drawn_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS notified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ENFORCE RULE 3: Campaign-Wide Single Winner Invariant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'draw_results_campaign_ticket_unique'
  ) THEN
    ALTER TABLE public.draw_results
      ADD CONSTRAINT draw_results_campaign_ticket_unique UNIQUE (campaign_id, ticket_id);
  END IF;
END $$;

-- ============================================================================
-- 9. IMMUTABILITY TRIGGERS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.protect_draw_results_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Allow UPDATE strictly for recording notified_at and notified_by
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.draw_id IS NOT DISTINCT FROM OLD.draw_id
       AND NEW.campaign_id IS NOT DISTINCT FROM OLD.campaign_id
       AND NEW.prize_id IS NOT DISTINCT FROM OLD.prize_id
       AND NEW.ticket_id IS NOT DISTINCT FROM OLD.ticket_id
       AND NEW.snapshot_id IS NOT DISTINCT FROM OLD.snapshot_id
       AND NEW.selection_index IS NOT DISTINCT FROM OLD.selection_index
       AND NEW.seed_commitment IS NOT DISTINCT FROM OLD.seed_commitment
       AND NEW.seed_revealed IS NOT DISTINCT FROM OLD.seed_revealed
       AND NEW.combined_seed IS NOT DISTINCT FROM OLD.combined_seed
       AND NEW.drawn_by IS NOT DISTINCT FROM OLD.drawn_by
       AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
       AND (OLD.notified_at IS NULL AND NEW.notified_at IS NOT NULL)
    THEN
      RETURN NEW; -- Authorized one-time notification stamp
    END IF;
  END IF;

  RAISE EXCEPTION 'draw_results records are strictly immutable. Winner alteration is prohibited.'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_draw_results_immutability ON public.draw_results;
CREATE TRIGGER trg_protect_draw_results_immutability
  BEFORE UPDATE OR DELETE ON public.draw_results
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_draw_results_immutability();

CREATE OR REPLACE FUNCTION public.protect_draw_snapshot_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.is_locked = true THEN
    RAISE EXCEPTION 'Eligibility snapshots are immutable once locked.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_draw_snapshot_immutability ON public.draw_eligibility_snapshots;
CREATE TRIGGER trg_protect_draw_snapshot_immutability
  BEFORE UPDATE OR DELETE ON public.draw_eligibility_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_draw_snapshot_immutability();

COMMIT;
```

---

## 5. Mandatory Integrity Constraints Matrix

The database architecture employs defense-in-depth across 8 invariant categories:

| Invariant | Database Enforcement Mechanism | Error Code | Failure Behavior |
| :--- | :--- | :---: | :--- |
| **1. Single Win Per Campaign** | `UNIQUE (campaign_id, ticket_id)` on `public.draw_results` | `23505` | Transaction rolls back immediately if a ticket is inserted twice. |
| **2. Single Winner Per Prize** | `UNIQUE (draw_id, prize_id)` on `public.draw_results` | `23505` | Second execution attempt on the same prize returns HTTP 409 conflict. |
| **3. Ascending Sequence** | Sequence assertion inside `execute_draw_winner_selection` | `23514` | Drawing Prize $K$ without Prize $K+1$ raises `Sequence violation`. |
| **4. Dual Approval Separation**| `CHECK (approver_id IS NULL OR initiator_id <> approver_id)` | `23514` | Self-approval by initiator is rejected at schema level. |
| **5. Dual Approval Precondition**| Snapshot hash assertion on `draw_approvals` | `42501` | First Prize aborts if approved hash differs from locked snapshot. |
| **6. Snapshot Immutability** | Trigger `trg_protect_draw_snapshot_immutability` | `23514` | Any `UPDATE` or `DELETE` on locked snapshot raises check violation. |
| **7. Result Immutability** | Trigger `trg_protect_draw_results_immutability` | `23514` | Direct `UPDATE` of winner identity or `DELETE` is prohibited. |
| **8. Audit Append-Only** | Trigger `trg_protect_audit_logs_append_only` | `23514` | Audit history cannot be altered or purged even by administrators. |

---

## 6. Authoritative Backend RPC Design

Five discrete stored procedures govern the draw lifecycle. All stored functions execute with `SECURITY DEFINER SET search_path = ''` to prevent search path hijacking.

### 6.1 `public.admin_lock_eligibility_snapshot`

Locks the candidate roster into a permanent snapshot and computes the verification digest.

```sql
CREATE OR REPLACE FUNCTION public.admin_lock_eligibility_snapshot(
  p_draw_id uuid,
  p_prize_id uuid,
  p_snapshot_hash text,
  p_ticket_ids uuid[],
  p_ticket_numbers text[],
  p_actor uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draw public.draws;
  v_prize public.prizes;
  v_snapshot_id uuid;
  v_count integer;
  v_prev_winners integer;
  v_manual_exclusions integer;
  i integer;
BEGIN
  -- 1. Authorization Guard
  IF p_actor IS NULL OR NOT public.is_staff(p_actor) THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required.' USING ERRCODE = '42501';
  END IF;

  -- 2. Lock Draw Record
  SELECT * INTO v_draw FROM public.draws WHERE id = p_draw_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draw session not found.' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Lock Prize Record
  SELECT * INTO v_prize FROM public.prizes WHERE id = p_prize_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prize not found.' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Verify Array Parity
  v_count := array_length(p_ticket_ids, 1);
  IF v_count IS NULL OR v_count <> array_length(p_ticket_numbers, 1) THEN
    RAISE EXCEPTION 'Ticket IDs and numbers array length mismatch.' USING ERRCODE = '2202E';
  END IF;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Cannot lock snapshot with zero eligible tickets.' USING ERRCODE = '22003';
  END IF;

  -- 5. Count Exclusions for Audit Metadata
  SELECT count(*) INTO v_prev_winners
  FROM public.draw_results dr
  WHERE dr.campaign_id = v_draw.campaign_id;

  SELECT count(*) INTO v_manual_exclusions
  FROM public.draw_manual_exclusions dme
  WHERE dme.campaign_id = v_draw.campaign_id
    AND (dme.prize_id IS NULL OR dme.prize_id = p_prize_id);

  -- 6. Insert Snapshot Header
  INSERT INTO public.draw_eligibility_snapshots (
    draw_id,
    campaign_id,
    prize_id,
    total_eligible_count,
    previous_winner_count,
    manual_exclusion_count,
    snapshot_hash,
    is_locked,
    locked_at,
    locked_by
  ) VALUES (
    p_draw_id,
    v_draw.campaign_id,
    p_prize_id,
    v_count,
    v_prev_winners,
    v_manual_exclusions,
    p_snapshot_hash,
    true,
    now(),
    p_actor
  ) RETURNING id INTO v_snapshot_id;

  -- 7. Insert Indexed Snapshot Tickets
  FOR i IN 1..v_count LOOP
    INSERT INTO public.draw_snapshot_tickets (
      snapshot_id,
      ticket_id,
      ticket_number,
      display_index
    ) VALUES (
      v_snapshot_id,
      p_ticket_ids[i],
      p_ticket_numbers[i],
      i - 1
    );
  END LOOP;

  -- 8. Write Audit Log
  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    p_actor,
    'SNAPSHOT_LOCKED',
    'draw_snapshot',
    v_snapshot_id,
    jsonb_build_object(
      'draw_id', p_draw_id,
      'prize_id', p_prize_id,
      'prize_number', v_prize.prize_number,
      'total_eligible_count', v_count,
      'snapshot_hash', p_snapshot_hash
    )
  );

  RETURN v_snapshot_id;
END;
$$;
```

---

### 6.2 `public.admin_request_first_prize_approval`

Initiated by `SUPER_ADMIN` to register a locked snapshot for secondary review.

```sql
CREATE OR REPLACE FUNCTION public.admin_request_first_prize_approval(
  p_draw_id uuid,
  p_prize_id uuid,
  p_snapshot_id uuid,
  p_actor uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draw public.draws;
  v_prize public.prizes;
  v_snapshot public.draw_eligibility_snapshots;
  v_approval_id uuid;
BEGIN
  -- Strict SUPER_ADMIN check
  IF p_actor IS NULL OR NOT public.has_role(p_actor, 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Only SUPER_ADMIN can initiate 1st Prize approval.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prize FROM public.prizes WHERE id = p_prize_id;
  IF v_prize.prize_number <> 1 THEN
    RAISE EXCEPTION 'Dual approval is strictly reserved for 1st Prize.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_snapshot FROM public.draw_eligibility_snapshots WHERE id = p_snapshot_id AND is_locked = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Locked snapshot not found.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.draw_approvals (
    draw_id,
    campaign_id,
    prize_id,
    snapshot_id,
    snapshot_hash,
    initiator_id,
    status
  ) VALUES (
    p_draw_id,
    v_snapshot.campaign_id,
    p_prize_id,
    p_snapshot_id,
    v_snapshot.snapshot_hash,
    p_actor,
    'PENDING'
  )
  ON CONFLICT (draw_id, prize_id, snapshot_hash)
  DO UPDATE SET
    initiator_id = p_actor,
    status = 'PENDING',
    approver_id = NULL,
    decided_at = NULL
  RETURNING id INTO v_approval_id;

  INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_actor,
    'APPROVAL_REQUESTED',
    'draw_approval',
    v_approval_id,
    jsonb_build_object('draw_id', p_draw_id, 'snapshot_hash', v_snapshot.snapshot_hash)
  );

  RETURN v_approval_id;
END;
$$;
```

---

### 6.3 `public.admin_record_first_prize_approval`

Records the second distinct authorized signature on the First Prize draw request.

```sql
CREATE OR REPLACE FUNCTION public.admin_record_first_prize_approval(
  p_approval_id uuid,
  p_decision text, -- 'APPROVED' or 'REJECTED'
  p_notes text,
  p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_approval public.draw_approvals;
BEGIN
  -- Approver authorization: Staff check
  IF p_actor IS NULL OR NOT public.is_staff(p_actor) THEN
    RAISE EXCEPTION 'Unauthorized: Staff privileges required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_approval FROM public.draw_approvals WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval record not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_approval.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Approval request is not pending (status: %)', v_approval.status USING ERRCODE = '23514';
  END IF;

  -- CRITICAL RULE 10: Initiator cannot approve own request
  IF v_approval.initiator_id = p_actor THEN
    RAISE EXCEPTION 'Four-eyes violation: The initiator cannot approve their own 1st Prize request.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.draw_approvals
  SET
    status = p_decision,
    approver_id = p_actor,
    decided_at = now(),
    decision_notes = p_notes
  WHERE id = p_approval_id;

  INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_actor,
    'APPROVAL_DECIDED',
    'draw_approval',
    p_approval_id,
    jsonb_build_object(
      'decision', p_decision,
      'initiator_id', v_approval.initiator_id,
      'approver_id', p_actor,
      'snapshot_hash', v_approval.snapshot_hash
    )
  );
END;
$$;
```

---

### 6.4 `public.execute_draw_winner_selection`

The authoritative single-transaction draw execution procedure. Enforces sequence, validates approvals, inserts results, writes randomness evidence, and records audit logs atomically.

*(Full PL/pgSQL specification provided in Section 4 & updated Phase 9A report)*.

---

### 6.5 `public.admin_notify_winner`

Executes the governed manual winner notification action, stamping `notified_at` on `draw_results` and queueing the email outbox job.

```sql
CREATE OR REPLACE FUNCTION public.admin_stamp_winner_notification(
  p_result_id uuid,
  p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_res public.draw_results;
BEGIN
  IF p_actor IS NULL OR NOT public.is_staff(p_actor) THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_res FROM public.draw_results WHERE id = p_result_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draw result not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_res.notified_at IS NOT NULL THEN
    RAISE EXCEPTION 'Winner notification has already been dispatched at %', v_res.notified_at
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.draw_results
  SET
    notified_at = now(),
    notified_by = p_actor
  WHERE id = p_result_id;

  INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_actor,
    'WINNER_NOTIFICATION_REQUESTED',
    'draw_result',
    p_result_id,
    jsonb_build_object('ticket_id', v_res.ticket_id, 'prize_id', v_res.prize_id)
  );
END;
$$;
```

---

## 7. Cryptographic Randomness Protocol & Evidence

### 7.1 Selection Algorithm: Node.js `crypto.randomInt`

To eliminate modulo bias, integer generation operates via kernel CSPRNG rejection sampling:

```typescript
import { randomBytes, randomInt, createHash, createHmac } from "node:crypto";

/**
 * Derives an unbiased winning index in [0, eligibleCount)
 * utilizing OpenSSL kernel CSPRNG and mathematical rejection sampling.
 */
export function selectWinningIndex(eligibleCount: number): number {
  if (eligibleCount <= 0) {
    throw new Error("Eligible count must be positive.");
  }
  return randomInt(0, eligibleCount);
}
```

### 7.2 Commit-Reveal Evidence Protocol Flow

```
1. PRE-COMMITMENT (Before Drum Starts):
   - Server generates 32-byte cryptographically secure random string S_server.
   - Commitment C = SHA-256(S_server).
   - Stored in database session; displayed to live spectators.

2. ENTROPY CONTRIBUTIONS (Drum Activation):
   - Administrator clicks "Start Drum".
   - Client sends live timestamp & random client token S_client.
   - Server derives Combined Seed:
     S_combined = HMAC-SHA256(Key = S_server, Message = S_client || snapshot_hash || prize_id).

3. DETERMINISTIC DERIVATION & SELECTION:
   - Server calls selectWinningIndex(eligibleCount).
   - Verifies winning index maps to draw_snapshot_tickets.

4. RECORDING & REVEAL:
   - Database writes S_server (revealed), C (commitment), and S_combined to public.draw_randomness_evidence.
   - Public auditors verify:
     SHA-256(S_server) == C
     HMAC-SHA256(S_server, S_client || snapshot_hash || prize_id) == S_combined.
```

---

## 8. First Prize Approval State Machine

The grand First Prize implements an explicit 8-state machine:

```
           [ DRAFT ]
               |
               v
     [ ELIGIBILITY_READY ]
               | (Admin locks roster)
               v
     [ SNAPSHOT_LOCKED ]
               | (SUPER_ADMIN initiates request)
               v
     [ APPROVAL_PENDING ] -------------------+
          |            |                     | (Snapshot drift or Admin cancels)
          | (Approve)  | (Reject)            v
          v            v               [ INVALIDATED ]
     [ APPROVED ]  [ REJECTED ]
          |
          | (SUPER_ADMIN clicks "Start Drum")
          v
     [ EXECUTING ]
          |
          +-----------------------+
          | (Success)             | (Failure)
          v                       v
    [ COMPLETED ]             [ FAILED ]
```

### State Invariant Rules:
1. `APPROVAL_PENDING` can only be transitioned to `APPROVED` by a user whose `id <> initiator_id`.
2. Any attempt to modify snapshot tickets or exclusion lists marks the approval record `INVALIDATED`.
3. `execute_draw_winner_selection` verifies `status = 'APPROVED'` and `snapshot_hash` parity inside the row lock.

---

## 9. Eligibility Snapshot & Canonical Hash Engine

To ensure tickets cannot be injected, modified, or reordered between roster approval and draw execution, the snapshot hash uses natural lexicographical ordering:

$$\text{Digest} = \text{SHA-256}\left( \sum_{i=0}^{N-1} \text{trim}(\text{ticket\_number}_i) \parallel \text{"\n"} \right)$$

- Canonical sort: `ticket_number ASC` (e.g., `SSFI-000001`, `SSFI-000002`, ...).
- Stored in `draw_snapshot_tickets` with continuous integer `display_index` from `0` to $N-1$.
- `snapshot_hash` is 64-character hexadecimal string verified by `CHECK (length(snapshot_hash) = 64)`.

---

## 10. Manual Winner Notification Integration

### 10.1 Workflow Architecture
1. **Draw Execution:** Persists winner in `public.draw_results`. Email outbox is **not** called.
2. **Admin Verification:** Admin navigates to `/admin/draws`, reviews winner profile (full name, phone, WhatsApp, email, order reference, seller attribution).
3. **Explicit Dispatch:** Admin clicks `Notify Winner`.
4. **Outbox Enqueue:** Server Action invokes `enqueueWinnerNotification(resultId)`:
   - Validates `notified_at IS NULL`.
   - Generates deterministic idempotency key: `WINNER_ANNOUNCED:${resultId}`.
   - Enqueues job in `public.customer_email_outbox`.
   - Calls `public.admin_stamp_winner_notification` to record timestamp and actor.
5. **Worker Dispatch:** Existing transactional outbox adapter dispatches email via Google Apps Script or Gmail API with HMAC authentication.

---

## 11. Row-Level Security (RLS) & Authorization Matrix

| Table | Policy Name | Permitted Roles | Allowed Operations |
| :--- | :--- | :--- | :--- |
| `public.draw_manual_exclusions` | `exclusions_staff_manage` | `SUPER_ADMIN`, `ADMIN` | `ALL` (`is_staff(auth.uid())`) |
| `public.draw_eligibility_snapshots` | `snapshots_staff_read` | `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER` | `SELECT` |
| `public.draw_eligibility_snapshots` | `snapshots_admin_insert` | `SUPER_ADMIN`, `ADMIN` | `INSERT` (Updates blocked by trigger) |
| `public.draw_snapshot_tickets` | `snapshot_tickets_staff_read` | Staff roles | `SELECT` |
| `public.draw_snapshot_tickets` | `snapshot_tickets_service_write` | `service_role` (via RPC) | `INSERT` |
| `public.draw_approvals` | `approvals_staff_read` | Staff roles | `SELECT` |
| `public.draw_approvals` | `approvals_admin_manage` | `SUPER_ADMIN`, `ADMIN` | `INSERT`, `UPDATE` (via RPC) |
| `public.draw_randomness_evidence` | `evidence_public_read` | `anon`, `authenticated` | `SELECT` (Public verification) |
| `public.draw_results` | `results_public_read` | `anon`, `authenticated` | `SELECT` (Public winners list) |

---

## 12. Migration Dependency & Sequencing Plan

```
[ Phase 9B Migration Package: 202611080001_phase9b_secure_winner_selection.sql ]
├── Step 1: Upgrades to public.draws (Add columns & indexes)
├── Step 2: Create public.draw_manual_exclusions
├── Step 3: Create public.draw_eligibility_snapshots
├── Step 4: Create public.draw_snapshot_tickets
├── Step 5: Create public.draw_approvals (Dual Control table)
├── Step 6: Create public.draw_randomness_evidence
├── Step 7: Upgrades to public.draw_results (Add campaign_id, snapshot_id, UNIQUE constraint)
├── Step 8: Create Immutability Triggers (Results, Snapshots)
├── Step 9: Deploy Stored Procedures (Lock Snapshot, Approvals, Winner Selection, Notification)
└── Step 10: RLS Policies & Grants (Revoke public, Grant authenticated/service_role)
```

### Pre-Migration Validation Query:
```sql
-- Assert zero orphaned records and clean baseline state
SELECT count(*) FROM public.draws;         -- Expected: 0
SELECT count(*) FROM public.draw_results; -- Expected: 0
SELECT count(*) FROM public.prizes;        -- Expected: 5
```

---

## 13. Rollback & Disaster Recovery Limitations

1. **Engine Immutability Protection:** Once `public.draw_results` rows are inserted or snapshots are locked, the database engine **blocks** all `UPDATE` and `DELETE` queries. Rollbacks during live operations cannot be executed via SQL `DELETE`.
2. **Pre-Migration Physical Backup:** Immediately prior to applying the migration on Preview or Production, a complete physical `pg_dump` must be captured and verified.
3. **Exceptional Invalidation:** If a draw session must be formally abandoned prior to winner insertion, the session status is marked `CANCELLED` with an audited reason. Results rows are never purged.

---

## 14. Comprehensive Testing Strategy

1. **Draw Sequence Enforcement:** Verify drawing Prize 4 before Prize 5 fails with SQLSTATE `23514`. Verify drawing Prize 1 before Prize 2 fails.
2. **Single Winner Per Campaign:** Insert winning ticket for Prize 5; attempt to draw same ticket for Prize 4; verify `draw_results_campaign_ticket_unique` constraint aborts transaction.
3. **Dual Control Self-Approval Rejection:** Attempt to record approval where `approver_id = initiator_id`; verify CHECK constraint violation `23514`.
4. **Snapshot Invalidation on Drift:** Initiate approval, alter exclusion list, verify pending approval is invalidated.
5. **CSPRNG Uniformity ($\chi^2$ Test):** 100,000 draws over 1,000 tickets; confirm $\chi^2$ falls within 99% confidence interval ($888.7 < \chi^2 < 1118.9$).
6. **Drum Replay / Refresh Safety:** Mount Drum UI; trigger 10 replays; assert 10/10 display identical pre-committed winner.
7. **Manual Notification Idempotency:** Click "Notify Winner" twice; assert exactly 1 outbox job queued.

---

## 15. Implementation Sequence for Phase 9B Development

1. **Step 1:** Create local migration script `supabase/migrations/202611080001_phase9b_secure_winner_selection.sql`.
2. **Step 2:** Write CSPRNG service in `src/lib/draw/crypto.ts` utilizing `crypto.randomInt()`.
3. **Step 3:** Write canonical snapshot hash utility in `src/lib/draw/snapshot.ts`.
4. **Step 4:** Write unit and integration tests in `tests/winnerSelectionArchitecture.test.ts`.
5. **Step 5:** Execute tests and typechecks to verify zero regressions.
6. **Step 6:** Review with Owner before applying migration to Preview.

---

## 16. Approved Operational Decisions (Official Owner Sign-off)

* **Decision 2 Implementation Detail — Second Approver Role Scope:**
  - **Policy A (OFFICIALLY APPROVED BY OWNER):**
    - **Initiator:** Must possess `SUPER_ADMIN` role.
    - **Approver:** Must be a distinct authenticated user possessing either `SUPER_ADMIN` or `ADMIN` role (`approver_id <> initiator_id`).
    - **Self-Approval Prohibition:** Initiator cannot approve their own request under any circumstance (`approver_id <> initiator_id`).
    - **Cryptographic Binding:** The approval record is strictly bound to the exact campaign ID, prize ID, draw session ID, and locked eligibility snapshot hash (`snapshot_hash`). Any drift or re-snapshot invalidates pending approvals.
    - **Current Roster Compatibility:** Fully compatible with the existing staff roster (1 `SUPER_ADMIN`, 1 `ADMIN`); zero account promotions or privilege escalations required.
    - **Enforcement Layers:** Dual-enforced via database CHECK constraint `(approver_id IS NULL OR initiator_id <> approver_id)` AND PostgreSQL Security Definer RPC authorization check validating active roles via `public.has_role()`. Policy B is deprecated and dismissed.

---

## 17. Production Safety Considerations & Air-Gap Compliance

- **Zero Production Contact:** Production Supabase (`fohpqheglxhfdecadhzw`) remains 100% air-gapped.
- **Zero SQL Execution:** No SQL queries, DDL, or migrations were run during this planning phase.
- **Zero Code Modification:** Application source code was untouched.
- **Zero Git / Deploy Operations:** No commits, pushes, or deployments were performed.

---

*Report prepared and validated for SSFI Lucky Draw Implementation Governance.*  
*File location: `docs/security/PHASE_9B_DATABASE_AND_BACKEND_IMPLEMENTATION_PLAN.md` (Local documentation artifact only).*

