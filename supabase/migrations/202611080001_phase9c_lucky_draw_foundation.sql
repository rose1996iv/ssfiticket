-- ============================================================================
-- Migration: 202611080001_phase9c_lucky_draw_foundation.sql
-- Description: Phase 9C Foundation — Secure Lucky Draw Winner Selection Architecture
--
-- Features:
--   1. Upgrade public.draws (session seed commitments, revealed seed, client entropy)
--   2. Create public.draw_manual_exclusions (administrative ticket disqualification)
--   3. Create public.draw_eligibility_snapshots (immutable candidate rosters)
--   4. Create public.draw_snapshot_tickets (canonically indexed snapshot items)
--   5. Create public.draw_approvals (Owner Policy A First Prize two-person dual control)
--   6. Create public.draw_randomness_evidence (verifiable cryptographic proof)
--   7. Upgrade public.draw_results (campaign-wide single-winner invariant & notification tracking)
--   8. Immutability triggers on results, snapshots, snapshot tickets, and evidence
--   9. Authoritative stored procedures (SECURITY DEFINER with empty search_path)
--  10. Strict Row-Level Security (RLS) policies and least-privilege role grants
-- ============================================================================

-- ============================================================================
-- 1. UPGRADE PUBLIC.DRAWS
-- ============================================================================

ALTER TABLE public.draws
  ADD COLUMN IF NOT EXISTS current_prize_id uuid REFERENCES public.prizes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS seed_commitment text,
  ADD COLUMN IF NOT EXISTS seed_revealed text,
  ADD COLUMN IF NOT EXISTS client_entropy text,
  ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS draws_current_prize_idx ON public.draws(current_prize_id);

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
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Partial unique indexes to strictly prevent duplicate exclusions:
CREATE UNIQUE INDEX IF NOT EXISTS draw_manual_exclusions_prize_ticket_idx
  ON public.draw_manual_exclusions (campaign_id, prize_id, ticket_id)
  WHERE prize_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS draw_manual_exclusions_campaign_ticket_idx
  ON public.draw_manual_exclusions (campaign_id, ticket_id)
  WHERE prize_id IS NULL;

CREATE INDEX IF NOT EXISTS draw_manual_exclusions_lookup_idx
  ON public.draw_manual_exclusions(campaign_id, prize_id, ticket_id);

CREATE INDEX IF NOT EXISTS draw_manual_exclusions_ticket_idx
  ON public.draw_manual_exclusions(ticket_id);

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

CREATE INDEX IF NOT EXISTS draw_snapshots_hash_idx
  ON public.draw_eligibility_snapshots(snapshot_hash);

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

CREATE INDEX IF NOT EXISTS draw_snapshot_tickets_ticket_idx
  ON public.draw_snapshot_tickets(ticket_id);

-- ============================================================================
-- 5. CREATE FIRST PRIZE TWO-PERSON APPROVALS TABLE (POLICY A)
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
  reviewed_at timestamptz,
  review_notes text,
  UNIQUE (draw_id, prize_id, snapshot_hash),
  CONSTRAINT draw_approvals_distinct_actors CHECK (approver_id IS NULL OR initiator_id <> approver_id)
);

CREATE INDEX IF NOT EXISTS draw_approvals_lookup_idx
  ON public.draw_approvals(draw_id, prize_id, snapshot_hash);

CREATE INDEX IF NOT EXISTS draw_approvals_status_idx
  ON public.draw_approvals(status);

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
  total_candidates integer NOT NULL CHECK (total_candidates > 0),
  winning_ticket_number text NOT NULL,
  verification_status text NOT NULL DEFAULT 'VERIFIED' CHECK (verification_status IN ('VERIFIED', 'DISCREPANCY')),
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draw_id, prize_id)
);

CREATE INDEX IF NOT EXISTS draw_randomness_evidence_lookup_idx
  ON public.draw_randomness_evidence(draw_id, prize_id);

-- ============================================================================
-- 7. UPGRADE PUBLIC.DRAW_RESULTS (WITH CAMPAIGN-WIDE UNIQUE WINNER INVARIANT)
-- ============================================================================

ALTER TABLE public.draw_results
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.campaigns(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS snapshot_id uuid REFERENCES public.draw_eligibility_snapshots(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS selection_index integer CHECK (selection_index IS NULL OR selection_index >= 0),
  ADD COLUMN IF NOT EXISTS seed_commitment text,
  ADD COLUMN IF NOT EXISTS seed_revealed text,
  ADD COLUMN IF NOT EXISTS combined_seed text,
  ADD COLUMN IF NOT EXISTS drawn_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS notified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notification_outbox_id uuid REFERENCES public.customer_email_outbox(id) ON DELETE SET NULL;

-- Backfill campaign_id from parent draws if any legacy records exist
UPDATE public.draw_results dr
SET campaign_id = d.campaign_id
FROM public.draws d
WHERE dr.draw_id = d.id AND dr.campaign_id IS NULL;

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

CREATE INDEX IF NOT EXISTS draw_results_campaign_ticket_idx
  ON public.draw_results(campaign_id, ticket_id);

CREATE INDEX IF NOT EXISTS draw_results_notified_idx
  ON public.draw_results(notified_at)
  WHERE notified_at IS NULL;

-- ============================================================================
-- 8. IMMUTABILITY TRIGGERS
-- ============================================================================

-- 8.1 Results Immutability: Winner alteration or deletion strictly prohibited
CREATE OR REPLACE FUNCTION public.protect_draw_results_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Allow UPDATE strictly for recording notified_at, notified_by, and notification_outbox_id
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
       AND OLD.notified_at IS NULL
       AND NEW.notified_at IS NOT NULL
    THEN
      RETURN NEW; -- Authorized one-time notification stamp
    END IF;
  END IF;

  RAISE EXCEPTION 'draw_results records are strictly immutable. Winner alteration or deletion is prohibited.'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_draw_results_immutability ON public.draw_results;
CREATE TRIGGER trg_protect_draw_results_immutability
  BEFORE UPDATE OR DELETE ON public.draw_results
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_draw_results_immutability();

-- 8.2 Snapshot Immutability: Locked snapshots cannot be updated or deleted
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

  -- SEC-02: Return OLD on DELETE to allow proper deletion of unlocked draft snapshots
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_draw_snapshot_immutability ON public.draw_eligibility_snapshots;
CREATE TRIGGER trg_protect_draw_snapshot_immutability
  BEFORE UPDATE OR DELETE ON public.draw_eligibility_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_draw_snapshot_immutability();

-- 8.3 Snapshot Tickets Immutability: Tickets in locked snapshots cannot be modified
CREATE OR REPLACE FUNCTION public.protect_draw_snapshot_tickets_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.draw_eligibility_snapshots s
    WHERE s.id = OLD.snapshot_id AND s.is_locked = true
  ) THEN
    RAISE EXCEPTION 'Snapshot tickets cannot be modified or deleted from a locked snapshot.'
      USING ERRCODE = '23514';
  END IF;

  -- SEC-02: Return OLD on DELETE to allow proper deletion of unlocked draft snapshot tickets
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_draw_snapshot_tickets_immutability ON public.draw_snapshot_tickets;
CREATE TRIGGER trg_protect_draw_snapshot_tickets_immutability
  BEFORE UPDATE OR DELETE ON public.draw_snapshot_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_draw_snapshot_tickets_immutability();

-- 8.4 Randomness Evidence Immutability: Evidence records are strictly append-only
CREATE OR REPLACE FUNCTION public.protect_draw_randomness_evidence_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'draw_randomness_evidence is strictly append-only and immutable; UPDATE and DELETE operations are prohibited.'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_draw_randomness_evidence_immutability ON public.draw_randomness_evidence;
CREATE TRIGGER trg_protect_draw_randomness_evidence_immutability
  BEFORE UPDATE OR DELETE ON public.draw_randomness_evidence
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_draw_randomness_evidence_immutability();

-- ============================================================================
-- 9. AUTHORITATIVE STORED PROCEDURES
-- ============================================================================

-- 9.1 admin_lock_eligibility_snapshot
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

  -- 2. Concurrency Lock: Lock Draw
  SELECT * INTO v_draw FROM public.draws WHERE id = p_draw_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draw session not found.' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Concurrency Lock: Lock Prize
  SELECT * INTO v_prize FROM public.prizes WHERE id = p_prize_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prize not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_prize.campaign_id <> v_draw.campaign_id THEN
    RAISE EXCEPTION 'Prize does not belong to the draw campaign.' USING ERRCODE = '23514';
  END IF;

  -- 4. Verify Array Parity & Non-Zero
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
    algorithm_version,
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
    'SSFI-CSPRNG-V1',
    true,
    now(),
    p_actor
  ) RETURNING id INTO v_snapshot_id;

  -- 7. Insert Canonically Indexed Snapshot Tickets
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
      'campaign_id', v_draw.campaign_id,
      'prize_id', p_prize_id,
      'prize_number', v_prize.prize_number,
      'total_eligible_count', v_count,
      'snapshot_hash', p_snapshot_hash
    )
  );

  RETURN v_snapshot_id;
END;
$$;

-- 9.2 admin_request_first_prize_approval (Policy A)
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
  -- Policy A: Must possess SUPER_ADMIN role to initiate
  IF p_actor IS NULL OR NOT public.has_role(p_actor, 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Only SUPER_ADMIN can initiate 1st Prize approval.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_draw FROM public.draws WHERE id = p_draw_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draw session not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_prize FROM public.prizes WHERE id = p_prize_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prize not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_prize.prize_number <> 1 THEN
    RAISE EXCEPTION 'Dual approval is strictly reserved for 1st Prize.' USING ERRCODE = '23514';
  END IF;

  -- SEC-05: Prevent approval request modification after prize has already been drawn
  IF EXISTS (
    SELECT 1 FROM public.draw_results
    WHERE draw_id = p_draw_id AND prize_id = p_prize_id
  ) THEN
    RAISE EXCEPTION 'Cannot modify approval request: Prize has already been drawn.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_snapshot
  FROM public.draw_eligibility_snapshots
  WHERE id = p_snapshot_id
    AND draw_id = p_draw_id
    AND prize_id = p_prize_id
    AND is_locked = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Locked eligibility snapshot not found.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.draw_approvals (
    draw_id,
    campaign_id,
    prize_id,
    snapshot_id,
    snapshot_hash,
    initiator_id,
    approver_id,
    status,
    requested_at,
    reviewed_at,
    review_notes
  ) VALUES (
    p_draw_id,
    v_snapshot.campaign_id,
    p_prize_id,
    p_snapshot_id,
    v_snapshot.snapshot_hash,
    p_actor,
    NULL,
    'PENDING',
    now(),
    NULL,
    NULL
  )
  ON CONFLICT (draw_id, prize_id, snapshot_hash)
  DO UPDATE SET
    initiator_id = p_actor,
    approver_id = NULL,
    status = 'PENDING',
    requested_at = now(),
    reviewed_at = NULL,
    review_notes = NULL
  RETURNING id INTO v_approval_id;

  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    p_actor,
    'APPROVAL_REQUESTED',
    'draw_approval',
    v_approval_id,
    jsonb_build_object(
      'draw_id', p_draw_id,
      'campaign_id', v_snapshot.campaign_id,
      'prize_id', p_prize_id,
      'snapshot_id', p_snapshot_id,
      'snapshot_hash', v_snapshot.snapshot_hash
    )
  );

  RETURN v_approval_id;
END;
$$;

-- 9.3 admin_record_first_prize_approval (Policy A)
CREATE OR REPLACE FUNCTION public.admin_record_first_prize_approval(
  p_approval_id uuid,
  p_decision text,
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
  -- Policy A: Approver must be ADMIN or SUPER_ADMIN
  IF p_actor IS NULL OR NOT (public.has_role(p_actor, 'SUPER_ADMIN') OR public.has_role(p_actor, 'ADMIN')) THEN
    RAISE EXCEPTION 'Unauthorized: ADMIN or SUPER_ADMIN role required to review 1st Prize.' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Invalid decision: Must be APPROVED or REJECTED.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_approval FROM public.draw_approvals WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval record not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_approval.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Approval request is not pending (status: %)', v_approval.status USING ERRCODE = '23514';
  END IF;

  -- SEC-05: Prevent approval recording after prize has already been drawn
  IF EXISTS (
    SELECT 1 FROM public.draw_results
    WHERE draw_id = v_approval.draw_id AND prize_id = v_approval.prize_id
  ) THEN
    RAISE EXCEPTION 'Cannot record approval: Prize has already been drawn.' USING ERRCODE = '23514';
  END IF;

  -- Policy A & Rule 10: Initiator cannot approve own request
  IF v_approval.initiator_id = p_actor THEN
    RAISE EXCEPTION 'Four-eyes violation: The initiator cannot approve their own 1st Prize request.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.draw_approvals
  SET
    status = p_decision,
    approver_id = p_actor,
    reviewed_at = now(),
    review_notes = p_notes
  WHERE id = p_approval_id;

  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
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

-- 9.4 execute_draw_winner_selection (Ceremonial Sequence 5->1 and Dual Approval)
CREATE OR REPLACE FUNCTION public.execute_draw_winner_selection(
  p_draw_id uuid,
  p_prize_id uuid,
  p_snapshot_id uuid,
  p_winning_index integer,
  p_seed_commitment text,
  p_seed_revealed text,
  p_combined_seed text,
  p_actor uuid,
  p_client_entropy text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draw public.draws;
  v_prize public.prizes;
  v_snapshot public.draw_eligibility_snapshots;
  v_winning_ticket public.draw_snapshot_tickets;
  v_ticket_master public.tickets;
  v_result_id uuid;
  v_max_prize_number smallint;
BEGIN
  -- 1. Actor Authorization Guard
  IF p_actor IS NULL OR NOT public.is_staff(p_actor) THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required.' USING ERRCODE = '42501';
  END IF;

  -- 2. Concurrency Lock: Lock Draw
  SELECT * INTO v_draw FROM public.draws WHERE id = p_draw_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draw session not found.' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Concurrency Lock: Lock Prize
  SELECT * INTO v_prize FROM public.prizes WHERE id = p_prize_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prize not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_prize.campaign_id <> v_draw.campaign_id THEN
    RAISE EXCEPTION 'Prize does not belong to the draw campaign.' USING ERRCODE = '23514';
  END IF;

  -- 4. Check If Prize Already Drawn (Idempotency Guard)
  IF EXISTS (
    SELECT 1 FROM public.draw_results
    WHERE draw_id = p_draw_id AND prize_id = p_prize_id
  ) THEN
    RAISE EXCEPTION 'Prize has already been drawn in this session.' USING ERRCODE = '23505';
  END IF;

  -- SEC-03: Seed Grinding Guard — Prevent replacing pre-committed session seed
  IF v_draw.seed_commitment IS NOT NULL AND v_draw.seed_commitment <> p_seed_commitment THEN
    RAISE EXCEPTION 'Commitment mismatch: Supplied commitment does not match pre-committed session seed.'
      USING ERRCODE = '23514';
  END IF;

  -- SEC-04: Cryptographic Verification Guard — Verify revealed seed hashes to commitment
  IF lower(encode(sha256(convert_to(p_seed_revealed, 'UTF8')), 'hex')) <> lower(p_seed_commitment) THEN
    RAISE EXCEPTION 'Cryptographic verification failure: SHA-256 of revealed seed does not match commitment.'
      USING ERRCODE = '23514';
  END IF;

  -- 5. Sequence Guard: Enforce Ceremonial Ascending Sequence (5th -> 4th -> 3rd -> 2nd -> 1st)
  SELECT COALESCE(MAX(prize_number), 5) INTO v_max_prize_number
  FROM public.prizes
  WHERE campaign_id = v_draw.campaign_id;

  IF v_prize.prize_number < v_max_prize_number THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.draw_results dr
      JOIN public.prizes p ON p.id = dr.prize_id
      WHERE dr.campaign_id = v_draw.campaign_id
        AND p.prize_number = v_prize.prize_number + 1
    ) THEN
      RAISE EXCEPTION 'Sequence violation: Prize % cannot be drawn until Prize % is completed and recorded.',
        v_prize.prize_number, v_prize.prize_number + 1
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- 6. Lock & Validate Snapshot
  SELECT * INTO v_snapshot
  FROM public.draw_eligibility_snapshots
  WHERE id = p_snapshot_id
    AND draw_id = p_draw_id
    AND prize_id = p_prize_id
    AND is_locked = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Locked eligibility snapshot not found for this prize.' USING ERRCODE = 'P0002';
  END IF;

  -- 7. First Prize Two-Person Dual Control Guard (Policy A)
  IF v_prize.prize_number = 1 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.draw_approvals da
      WHERE da.draw_id = p_draw_id
        AND da.prize_id = p_prize_id
        AND da.snapshot_hash = v_snapshot.snapshot_hash
        AND da.status = 'APPROVED'
        AND da.initiator_id <> da.approver_id
        AND public.has_role(da.initiator_id, 'SUPER_ADMIN')
        AND (public.has_role(da.approver_id, 'SUPER_ADMIN') OR public.has_role(da.approver_id, 'ADMIN'))
    ) THEN
      RAISE EXCEPTION 'Dual approval violation: 1st Prize requires dual authorization (SUPER_ADMIN initiator and distinct ADMIN/SUPER_ADMIN approver) on the locked snapshot.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 8. Bounds Check
  IF p_winning_index < 0 OR p_winning_index >= v_snapshot.total_eligible_count THEN
    RAISE EXCEPTION 'Winning index % out of bounds [0, %)', p_winning_index, v_snapshot.total_eligible_count
      USING ERRCODE = '22003';
  END IF;

  -- 9. Retrieve Winning Ticket from Snapshot
  SELECT * INTO v_winning_ticket
  FROM public.draw_snapshot_tickets
  WHERE snapshot_id = p_snapshot_id
    AND display_index = p_winning_index;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Corrupt snapshot: Missing ticket at index %', p_winning_index
      USING ERRCODE = 'P0002';
  END IF;

  -- 10. Validate Against Master Tickets Table
  SELECT * INTO v_ticket_master
  FROM public.tickets
  WHERE id = v_winning_ticket.ticket_id
  FOR UPDATE;

  IF v_ticket_master.status <> 'ISSUED' THEN
    RAISE EXCEPTION 'Disqualified: Ticket % is not in ISSUED state (status=%)',
      v_ticket_master.ticket_number, v_ticket_master.status
      USING ERRCODE = '23514';
  END IF;

  -- SEC-06: Campaign Consistency Guard — Verify ticket belongs to draw campaign
  IF v_ticket_master.campaign_id <> v_draw.campaign_id THEN
    RAISE EXCEPTION 'Disqualified: Ticket % does not belong to campaign %',
      v_winning_ticket.ticket_number, v_draw.campaign_id
      USING ERRCODE = '23514';
  END IF;

  -- 11. Enforce Rule 3: Single Winner Per Campaign
  IF EXISTS (
    SELECT 1 FROM public.draw_results
    WHERE campaign_id = v_draw.campaign_id
      AND ticket_id = v_winning_ticket.ticket_id
  ) THEN
    RAISE EXCEPTION 'Disqualified: Ticket % has already won a prize in campaign %',
      v_winning_ticket.ticket_number, v_draw.campaign_id
      USING ERRCODE = '23505';
  END IF;

  -- 12. Insert Draw Result
  INSERT INTO public.draw_results (
    draw_id,
    campaign_id,
    prize_id,
    ticket_id,
    snapshot_id,
    selection_index,
    seed_commitment,
    seed_revealed,
    combined_seed,
    drawn_by
  ) VALUES (
    p_draw_id,
    v_draw.campaign_id,
    p_prize_id,
    v_winning_ticket.ticket_id,
    p_snapshot_id,
    p_winning_index,
    p_seed_commitment,
    p_seed_revealed,
    p_combined_seed,
    p_actor
  ) RETURNING id INTO v_result_id;

  -- 13. Insert Cryptographic Randomness Evidence
  INSERT INTO public.draw_randomness_evidence (
    draw_id,
    prize_id,
    snapshot_id,
    algorithm_version,
    server_seed_commitment,
    server_seed_revealed,
    client_entropy,
    combined_seed,
    selected_index,
    total_candidates,
    winning_ticket_number,
    verification_status
  ) VALUES (
    p_draw_id,
    p_prize_id,
    p_snapshot_id,
    'SSFI-CSPRNG-V1',
    p_seed_commitment,
    p_seed_revealed,
    p_client_entropy,
    p_combined_seed,
    p_winning_index,
    v_snapshot.total_eligible_count,
    v_winning_ticket.ticket_number,
    'VERIFIED'
  );

  -- 14. Update Draw Status & Current Prize
  UPDATE public.draws
  SET
    current_prize_id = p_prize_id,
    seed_commitment = COALESCE(seed_commitment, p_seed_commitment),
    seed_revealed = p_seed_revealed,
    client_entropy = p_client_entropy,
    locked_by = p_actor,
    status = CASE WHEN v_prize.prize_number = 1 THEN 'EXECUTED'::public.draw_status ELSE status END,
    executed_at = CASE WHEN v_prize.prize_number = 1 THEN now() ELSE executed_at END
  WHERE id = p_draw_id;

  -- 15. Write Structured Audit Log Entry
  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    p_actor,
    'DRAW_EXECUTED',
    'draw',
    p_draw_id,
    jsonb_build_object(
      'result_id', v_result_id,
      'draw_id', p_draw_id,
      'campaign_id', v_draw.campaign_id,
      'prize_id', p_prize_id,
      'prize_title', v_prize.title,
      'prize_number', v_prize.prize_number,
      'ticket_id', v_winning_ticket.ticket_id,
      'ticket_number', v_winning_ticket.ticket_number,
      'customer_id', v_ticket_master.customer_id,
      'selection_index', p_winning_index,
      'total_eligible_count', v_snapshot.total_eligible_count,
      'snapshot_hash', v_snapshot.snapshot_hash,
      'seed_commitment', p_seed_commitment
    )
  );

  -- 16. Return Confirmed Output
  RETURN jsonb_build_object(
    'success', true,
    'result_id', v_result_id,
    'draw_id', p_draw_id,
    'campaign_id', v_draw.campaign_id,
    'prize_id', p_prize_id,
    'ticket_id', v_winning_ticket.ticket_id,
    'ticket_number', v_winning_ticket.ticket_number,
    'selection_index', p_winning_index,
    'executed_at', now()
  );
END;
$$;

-- 9.5 admin_stamp_winner_notification
CREATE OR REPLACE FUNCTION public.admin_stamp_winner_notification(
  p_result_id uuid,
  p_outbox_id uuid,
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
    RAISE EXCEPTION 'Winner notification has already been recorded at %', v_res.notified_at
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.draw_results
  SET
    notified_at = now(),
    notified_by = p_actor,
    notification_outbox_id = p_outbox_id
  WHERE id = p_result_id;

  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    p_actor,
    'WINNER_NOTIFICATION_REQUESTED',
    'draw_result',
    p_result_id,
    jsonb_build_object(
      'draw_id', v_res.draw_id,
      'ticket_id', v_res.ticket_id,
      'prize_id', v_res.prize_id,
      'outbox_id', p_outbox_id
    )
  );
END;
$$;

-- ============================================================================
-- 10. ROW-LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- 10.1 draw_manual_exclusions
ALTER TABLE public.draw_manual_exclusions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'draw_manual_exclusions' AND policyname = 'exclusions_staff_access'
  ) THEN
    CREATE POLICY exclusions_staff_access ON public.draw_manual_exclusions
      FOR ALL TO authenticated
      USING (public.is_staff(auth.uid()))
      WITH CHECK (public.is_staff(auth.uid()));
  END IF;
END $$;

-- 10.2 draw_eligibility_snapshots
ALTER TABLE public.draw_eligibility_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'draw_eligibility_snapshots' AND policyname = 'snapshots_staff_access'
  ) THEN
    CREATE POLICY snapshots_staff_access ON public.draw_eligibility_snapshots
      FOR ALL TO authenticated
      USING (public.is_staff(auth.uid()))
      WITH CHECK (public.is_staff(auth.uid()));
  END IF;
END $$;

-- 10.3 draw_snapshot_tickets
ALTER TABLE public.draw_snapshot_tickets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'draw_snapshot_tickets' AND policyname = 'snapshot_tickets_staff_access'
  ) THEN
    CREATE POLICY snapshot_tickets_staff_access ON public.draw_snapshot_tickets
      FOR ALL TO authenticated
      USING (public.is_staff(auth.uid()))
      WITH CHECK (public.is_staff(auth.uid()));
  END IF;
END $$;

-- 10.4 draw_approvals
ALTER TABLE public.draw_approvals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'draw_approvals' AND policyname = 'approvals_staff_access'
  ) THEN
    CREATE POLICY approvals_staff_access ON public.draw_approvals
      FOR ALL TO authenticated
      USING (public.is_staff(auth.uid()))
      WITH CHECK (public.is_staff(auth.uid()));
  END IF;
END $$;

-- 10.5 draw_randomness_evidence
ALTER TABLE public.draw_randomness_evidence ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'draw_randomness_evidence' AND policyname = 'evidence_staff_access'
  ) THEN
    CREATE POLICY evidence_staff_access ON public.draw_randomness_evidence
      FOR ALL TO authenticated
      USING (public.is_staff(auth.uid()))
      WITH CHECK (public.is_staff(auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'draw_randomness_evidence' AND policyname = 'evidence_public_read'
  ) THEN
    CREATE POLICY evidence_public_read ON public.draw_randomness_evidence
      FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.draws d WHERE d.id = draw_id AND d.status = 'EXECUTED'));
  END IF;
END $$;

-- 10.6 draws public read policy for executed draws
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'draws' AND policyname = 'draws_public_read'
  ) THEN
    CREATE POLICY draws_public_read ON public.draws
      FOR SELECT
      USING (status = 'EXECUTED');
  END IF;
END $$;

-- 10.7 draw_results public read policy for executed draws
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'draw_results' AND policyname = 'results_public_read'
  ) THEN
    CREATE POLICY results_public_read ON public.draw_results
      FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.draws d WHERE d.id = draw_id AND d.status = 'EXECUTED'));
  END IF;
END $$;

-- ============================================================================
-- 11. ROLE PERMISSIONS & GRANTS
-- ============================================================================

-- Table permissions
REVOKE ALL ON TABLE public.draw_manual_exclusions FROM public, anon;
REVOKE ALL ON TABLE public.draw_eligibility_snapshots FROM public, anon;
REVOKE ALL ON TABLE public.draw_snapshot_tickets FROM public, anon;
REVOKE ALL ON TABLE public.draw_approvals FROM public, anon;
REVOKE ALL ON TABLE public.draw_randomness_evidence FROM public, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.draw_manual_exclusions TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.draw_eligibility_snapshots TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.draw_snapshot_tickets TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.draw_approvals TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.draw_randomness_evidence TO authenticated, service_role;

-- SEC-07: Explicit public read grants for executed draws (governed by RLS)
GRANT SELECT ON TABLE public.draws TO anon;
GRANT SELECT ON TABLE public.draw_results TO anon;
GRANT SELECT ON TABLE public.draw_randomness_evidence TO anon;

-- Function permissions
-- SEC-01: Revoke EXECUTE from public, anon, and authenticated; grant EXCLUSIVELY to service_role
REVOKE ALL ON FUNCTION public.admin_lock_eligibility_snapshot(uuid, uuid, text, uuid[], text[], uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_request_first_prize_approval(uuid, uuid, uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_record_first_prize_approval(uuid, text, text, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_draw_winner_selection(uuid, uuid, uuid, integer, text, text, text, uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_stamp_winner_notification(uuid, uuid, uuid) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_lock_eligibility_snapshot(uuid, uuid, text, uuid[], text[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_request_first_prize_approval(uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_record_first_prize_approval(uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_draw_winner_selection(uuid, uuid, uuid, integer, text, text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_stamp_winner_notification(uuid, uuid, uuid) TO service_role;

