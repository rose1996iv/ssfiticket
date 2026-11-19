-- ============================================================================
-- PHASE 10B: OPTION B — INITIATOR ROLE SNAPSHOT & APPROVAL RLS HARDENING
-- ============================================================================
-- Purpose:
--   1. Add immutable initiator_role_at_request to public.draw_approvals so
--      a First Prize request initiated by a verified SUPER_ADMIN remains valid
--      after that account is demoted to ADMIN (preserving request 924790fc-...
--      and its original initiator_id, requested_at, snapshot_hash, and audit trail).
--   2. Backfill initiator_role_at_request = 'SUPER_ADMIN' ONLY for existing rows
--      backed by immutable APPROVAL_REQUESTED audit evidence and verified
--      SUPER_ADMIN role assignment.
--   3. Prevent unauthorized modification or forgery of initiator_role_at_request
--      via a dedicated BEFORE INSERT OR UPDATE trigger.
--   4. Update admin_request_first_prize_approval to record authoritative DB
--      initiator_role_at_request and prevent overwriting an existing PENDING
--      request from another initiator.
--   5. Update execute_draw_winner_selection to validate historical initiator role
--      (initiator_role_at_request = 'SUPER_ADMIN') alongside current independent
--      approver role (ADMIN or SUPER_ADMIN), initiator_id <> approver_id, and
--      exact (draw_id, prize_id, snapshot_hash) binding.
--   6. Tighten approvals_staff_access RLS and grants on public.draw_approvals to
--      SELECT-only for authenticated staff; all mutations flow exclusively
--      through authorized SECURITY DEFINER RPCs.
-- ============================================================================

BEGIN;

-- 1. Add initiator_role_at_request column & CHECK constraint
ALTER TABLE public.draw_approvals
  ADD COLUMN IF NOT EXISTS initiator_role_at_request text;

ALTER TABLE public.draw_approvals
  DROP CONSTRAINT IF EXISTS draw_approvals_initiator_role_at_request_check;

ALTER TABLE public.draw_approvals
  ADD CONSTRAINT draw_approvals_initiator_role_at_request_check
  CHECK (initiator_role_at_request IS NULL OR initiator_role_at_request IN ('SUPER_ADMIN'));

-- 2. Trusted backfill ONLY when supported by:
--    (a) immutable APPROVAL_REQUESTED audit evidence matching exact snapshot_hash, AND
--    (b) verified SUPER_ADMIN role assignment in public.profile_roles whose
--        created_at <= da.requested_at (temporal historical evidence at request time).
--    If historical role status cannot be established reliably, leave NULL (never guess).
--    (Must run BEFORE demoting admin@ssfi.org; queries profile_roles directly
--     because migrations execute as postgres without a service_role JWT.)
UPDATE public.draw_approvals da
SET initiator_role_at_request = 'SUPER_ADMIN'
WHERE da.initiator_role_at_request IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.profile_roles pr
    JOIN public.roles r ON r.id = pr.role_id
    WHERE pr.profile_id = da.initiator_id
      AND r.name = 'SUPER_ADMIN'
      AND pr.created_at <= da.requested_at
  )
  AND EXISTS (
    SELECT 1
    FROM public.audit_logs al
    WHERE al.entity_type = 'draw_approval'
      AND al.entity_id = da.id
      AND al.action = 'APPROVAL_REQUESTED'
      AND al.actor_user_id = da.initiator_id
      AND al.metadata ->> 'snapshot_hash' = da.snapshot_hash
      AND al.created_at <= da.requested_at + interval '5 seconds'
  );

-- 3. Immutability, anti-forgery & delete-protection trigger for draw_approvals
CREATE OR REPLACE FUNCTION public.protect_draw_approvals_initiator_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.initiator_role_at_request IS DISTINCT FROM 'SUPER_ADMIN' THEN
      RAISE EXCEPTION 'Policy A violation: initiator_role_at_request must be SUPER_ADMIN at request creation.'
        USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.profile_roles pr
      JOIN public.roles r ON r.id = pr.role_id
      WHERE pr.profile_id = NEW.initiator_id
        AND r.name = 'SUPER_ADMIN'
    ) THEN
      RAISE EXCEPTION 'Unauthorized: Initiator % does not hold authoritative SUPER_ADMIN role.', NEW.initiator_id
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Block any modification once initiator_role_at_request is recorded
    IF OLD.initiator_role_at_request IS NOT NULL
       AND NEW.initiator_role_at_request IS DISTINCT FROM OLD.initiator_role_at_request THEN
      RAISE EXCEPTION 'Immutable field violation: initiator_role_at_request cannot be modified once recorded.'
        USING ERRCODE = '42501';
    END IF;

    -- Block unauthorized NULL -> SUPER_ADMIN promotion on PENDING or APPROVED rows
    -- (Allow setting SUPER_ADMIN from NULL ONLY during legitimate re-initiation from REJECTED/INVALIDATED -> PENDING by an active SUPER_ADMIN)
    IF OLD.initiator_role_at_request IS NULL
       AND NEW.initiator_role_at_request IS NOT NULL THEN
      IF OLD.status NOT IN ('REJECTED', 'INVALIDATED')
         OR NEW.status <> 'PENDING'
         OR NEW.initiator_role_at_request <> 'SUPER_ADMIN'
         OR NOT EXISTS (
           SELECT 1
           FROM public.profile_roles pr
           JOIN public.roles r ON r.id = pr.role_id
           WHERE pr.profile_id = NEW.initiator_id
             AND r.name = 'SUPER_ADMIN'
         ) THEN
        RAISE EXCEPTION 'Unauthorized promotion: Cannot promote initiator_role_at_request from NULL on % approval record.', OLD.status
          USING ERRCODE = '42501';
      END IF;
    END IF;

    IF NEW.initiator_id IS DISTINCT FROM OLD.initiator_id THEN
      IF OLD.status IN ('PENDING', 'APPROVED') THEN
        RAISE EXCEPTION 'Immutable field violation: initiator_id cannot be overwritten while request is %.', OLD.status
          USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.profile_roles pr
        JOIN public.roles r ON r.id = pr.role_id
        WHERE pr.profile_id = NEW.initiator_id
          AND r.name = 'SUPER_ADMIN'
      ) THEN
        RAISE EXCEPTION 'Unauthorized: New initiator % does not hold authoritative SUPER_ADMIN role.', NEW.initiator_id
          USING ERRCODE = '42501';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('PENDING', 'APPROVED') THEN
      RAISE EXCEPTION 'Protected record violation: Cannot delete % 1st Prize approval record (%).', OLD.status, OLD.id
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_draw_approvals_initiator_role() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_draw_approvals_initiator_role ON public.draw_approvals;
CREATE TRIGGER trg_protect_draw_approvals_initiator_role
  BEFORE INSERT OR UPDATE OR DELETE ON public.draw_approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_draw_approvals_initiator_role();

-- 4. Update admin_request_first_prize_approval to capture authoritative initiator role
--    and enforce safe duplicate-request behavior (preserving existing PENDING requests).
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
  v_existing public.draw_approvals;
  v_approval_id uuid;
BEGIN
  -- Policy A: Must possess authoritative SUPER_ADMIN role in DB to initiate
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

  -- Safe duplicate request handling: lock existing row for this exact snapshot if present
  SELECT * INTO v_existing
  FROM public.draw_approvals
  WHERE draw_id = p_draw_id
    AND prize_id = p_prize_id
    AND snapshot_hash = v_snapshot.snapshot_hash
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'APPROVED' THEN
      RAISE EXCEPTION 'Approval request % for this snapshot is already APPROVED.', v_existing.id
        USING ERRCODE = '23514';
    END IF;

    IF v_existing.status = 'PENDING' THEN
      IF v_existing.initiator_id = p_actor THEN
        -- Idempotent return for same initiator without mutating requested_at or audit trail
        RETURN v_existing.id;
      END IF;
      RAISE EXCEPTION 'Duplicate request blocked: A PENDING 1st Prize approval (%) already exists for this snapshot.', v_existing.id
        USING ERRCODE = '23505';
    END IF;

    -- Prior row was REJECTED or INVALIDATED: safe re-initiation with fresh authoritative SUPER_ADMIN role
    UPDATE public.draw_approvals
    SET
      initiator_id = p_actor,
      initiator_role_at_request = 'SUPER_ADMIN',
      approver_id = NULL,
      status = 'PENDING',
      requested_at = now(),
      reviewed_at = NULL,
      review_notes = NULL
    WHERE id = v_existing.id
    RETURNING id INTO v_approval_id;
  ELSE
    INSERT INTO public.draw_approvals (
      draw_id,
      campaign_id,
      prize_id,
      snapshot_id,
      snapshot_hash,
      initiator_id,
      initiator_role_at_request,
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
      'SUPER_ADMIN',
      NULL,
      'PENDING',
      now(),
      NULL,
      NULL
    )
    RETURNING id INTO v_approval_id;
  END IF;

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
      'snapshot_hash', v_snapshot.snapshot_hash,
      'initiator_role_at_request', 'SUPER_ADMIN'
    )
  );

  RETURN v_approval_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_request_first_prize_approval(uuid, uuid, uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_request_first_prize_approval(uuid, uuid, uuid, uuid) TO service_role;

-- 5. Update execute_draw_winner_selection to validate historical initiator role
--    (initiator_role_at_request = 'SUPER_ADMIN') AND current independent approver role.
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
  v_canonical_campaign_id uuid;
  v_canonical_count integer;
  v_campaign public.campaigns;
  v_draw public.draws;
  v_prize public.prizes;
  v_snapshot public.draw_eligibility_snapshots;
  v_stored_count integer;
  v_distinct_idx integer;
  v_min_idx integer;
  v_max_idx integer;
  v_winning_ticket public.draw_snapshot_tickets;
  v_ticket_master public.tickets;
  v_order public.orders;
  v_verified_paid_paise bigint;
  v_result_id uuid;
  v_max_prize_number smallint;
BEGIN
  IF p_actor IS NULL OR NOT public.is_staff(p_actor) THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required.' USING ERRCODE = '42501';
  END IF;

  IF p_seed_commitment IS NULL OR char_length(trim(p_seed_commitment)) = 0 THEN
    RAISE EXCEPTION 'Seed commitment must be non-NULL and non-empty.' USING ERRCODE = '22004';
  END IF;

  IF trim(p_seed_commitment) !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Malformed seed commitment: expected 64-character hex SHA-256 digest.' USING ERRCODE = '22023';
  END IF;

  IF p_seed_revealed IS NULL OR char_length(trim(p_seed_revealed)) = 0 THEN
    RAISE EXCEPTION 'Revealed seed must be non-NULL and non-empty.' USING ERRCODE = '22004';
  END IF;

  IF lower(encode(sha256(convert_to(trim(p_seed_revealed), 'UTF8')), 'hex')) <> lower(trim(p_seed_commitment)) THEN
    RAISE EXCEPTION 'Cryptographic verification failure: SHA-256 of revealed seed does not match commitment.'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)
  INTO v_canonical_count
  FROM public.campaigns
  WHERE public_id = 'ssfi-fundraising-lucky-draw';

  IF v_canonical_count = 0 THEN
    RAISE EXCEPTION 'Canonical campaign ssfi-fundraising-lucky-draw not found.' USING ERRCODE = 'P0002';
  ELSIF v_canonical_count > 1 THEN
    RAISE EXCEPTION 'Data integrity error: multiple canonical campaigns found for ssfi-fundraising-lucky-draw.' USING ERRCODE = '21000';
  END IF;

  SELECT id
  INTO STRICT v_canonical_campaign_id
  FROM public.campaigns
  WHERE public_id = 'ssfi-fundraising-lucky-draw';

  SELECT * INTO v_campaign
  FROM public.campaigns
  WHERE id = v_canonical_campaign_id
  FOR UPDATE;

  SELECT * INTO v_draw FROM public.draws WHERE id = p_draw_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draw session not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_draw.campaign_id <> v_canonical_campaign_id THEN
    RAISE EXCEPTION 'Canonical campaign violation: draw % belongs to campaign %, expected %.',
      p_draw_id, v_draw.campaign_id, v_canonical_campaign_id
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_prize FROM public.prizes WHERE id = p_prize_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prize not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_prize.campaign_id <> v_draw.campaign_id THEN
    RAISE EXCEPTION 'Prize does not belong to the draw campaign.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.draw_results
    WHERE draw_id = p_draw_id AND prize_id = p_prize_id
  ) THEN
    RAISE EXCEPTION 'Prize has already been drawn in this session.' USING ERRCODE = '23505';
  END IF;

  IF v_draw.seed_commitment IS NOT NULL AND v_draw.seed_revealed IS NULL
     AND lower(trim(v_draw.seed_commitment)) <> lower(trim(p_seed_commitment)) THEN
    RAISE EXCEPTION 'Commitment mismatch: Supplied commitment does not match pre-committed session seed.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.draw_results
    WHERE draw_id = p_draw_id
      AND (lower(seed_commitment) = lower(trim(p_seed_commitment))
           OR lower(seed_revealed) = lower(trim(p_seed_revealed)))
  ) THEN
    RAISE EXCEPTION 'Seed reuse violation: each prize in a draw session requires an independent server seed.'
      USING ERRCODE = '23514';
  END IF;

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

  SELECT * INTO v_snapshot
  FROM public.draw_eligibility_snapshots
  WHERE id = p_snapshot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Eligibility snapshot % not found.', p_snapshot_id USING ERRCODE = 'P0002';
  END IF;

  IF v_snapshot.campaign_id <> v_draw.campaign_id
     OR v_snapshot.prize_id <> p_prize_id
     OR v_snapshot.draw_id <> p_draw_id
     OR v_snapshot.is_locked IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'Snapshot integrity failure: snapshot % does not match locked draw/campaign/prize.', p_snapshot_id
      USING ERRCODE = '23514';
  END IF;

  -- R2: Verify revealed seed commitment matches sealed commitment stored at snapshot lock
  IF v_snapshot.seed_commitment IS NOT NULL
     AND lower(trim(p_seed_commitment)) <> lower(trim(v_snapshot.seed_commitment)) THEN
    RAISE EXCEPTION 'Commitment mismatch: revealed seed commitment does not match sealed snapshot commitment.'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*), count(DISTINCT display_index), min(display_index), max(display_index)
  INTO v_stored_count, v_distinct_idx, v_min_idx, v_max_idx
  FROM public.draw_snapshot_tickets
  WHERE snapshot_id = p_snapshot_id;

  IF v_stored_count <> v_snapshot.total_eligible_count
     OR v_distinct_idx <> v_snapshot.total_eligible_count
     OR v_min_idx IS DISTINCT FROM 0
     OR v_max_idx IS DISTINCT FROM (v_snapshot.total_eligible_count - 1)
  THEN
    RAISE EXCEPTION 'Snapshot candidate integrity failure: expected contiguous 0..% (% rows), found count=%, distinct=%, min=%, max=%.',
      v_snapshot.total_eligible_count - 1, v_snapshot.total_eligible_count,
      v_stored_count, v_distinct_idx, v_min_idx, v_max_idx
      USING ERRCODE = '23514';
  END IF;

  -- Phase 10B Policy A: Validate historical SUPER_ADMIN initiator role, distinct actors,
  -- exact (draw_id, prize_id, snapshot_hash) binding, and current independent approver role.
  IF v_prize.prize_number = 1 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.draw_approvals da
      WHERE da.draw_id = p_draw_id
        AND da.prize_id = p_prize_id
        AND da.snapshot_hash = v_snapshot.snapshot_hash
        AND da.status = 'APPROVED'
        AND da.initiator_id <> da.approver_id
        AND da.initiator_role_at_request = 'SUPER_ADMIN'
        AND (public.has_role(da.approver_id, 'SUPER_ADMIN') OR public.has_role(da.approver_id, 'ADMIN'))
    ) THEN
      RAISE EXCEPTION 'Dual approval violation: 1st Prize requires dual authorization (SUPER_ADMIN initiator at request time and distinct active ADMIN/SUPER_ADMIN approver) on the locked snapshot.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_winning_index IS NULL OR p_winning_index < 0 OR p_winning_index >= v_snapshot.total_eligible_count THEN
    RAISE EXCEPTION 'Winning index % out of bounds [0, %)', p_winning_index, v_snapshot.total_eligible_count
      USING ERRCODE = '22003';
  END IF;

  SELECT * INTO v_winning_ticket
  FROM public.draw_snapshot_tickets
  WHERE snapshot_id = p_snapshot_id
    AND display_index = p_winning_index;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Corrupt snapshot: Missing ticket at index %', p_winning_index
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_ticket_master
  FROM public.tickets
  WHERE id = v_winning_ticket.ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Disqualified: Master ticket % not found.', v_winning_ticket.ticket_id USING ERRCODE = 'P0002';
  END IF;

  IF v_ticket_master.id <> v_winning_ticket.ticket_id
     OR trim(v_ticket_master.ticket_number) <> trim(v_winning_ticket.ticket_number)
  THEN
    RAISE EXCEPTION 'Snapshot integrity failure: snapshot ticket (%, %) mismatches master ticket (%, %).',
      v_winning_ticket.ticket_id, v_winning_ticket.ticket_number, v_ticket_master.id, v_ticket_master.ticket_number
      USING ERRCODE = '23514';
  END IF;

  IF v_ticket_master.status <> 'ISSUED'::public.ticket_status THEN
    RAISE EXCEPTION 'Disqualified: Ticket % is not in ISSUED state (status=%)',
      v_ticket_master.ticket_number, v_ticket_master.status
      USING ERRCODE = '23514';
  END IF;

  IF v_ticket_master.campaign_id <> v_draw.campaign_id THEN
    RAISE EXCEPTION 'Disqualified: Ticket % does not belong to campaign %',
      v_ticket_master.ticket_number, v_draw.campaign_id
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = v_ticket_master.order_id
    AND campaign_id = v_draw.campaign_id
  FOR UPDATE;

  IF NOT FOUND OR v_order.status <> 'TICKETS_ISSUED'::public.order_status THEN
    RAISE EXCEPTION 'Disqualified: Parent order for ticket % is not in TICKETS_ISSUED state.',
      v_ticket_master.ticket_number
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM public.payments p
  WHERE p.order_id = v_order.id
  ORDER BY p.id ASC
  FOR UPDATE;

  SELECT COALESCE(SUM(p.amount_paise), 0) INTO v_verified_paid_paise
  FROM public.payments p
  WHERE p.order_id = v_order.id
    AND p.status = 'VERIFIED'::public.payment_status;

  IF v_verified_paid_paise <> v_order.total_amount_paise THEN
    RAISE EXCEPTION 'Disqualified: Verified payment total (%) does not match order total (%) for ticket %.',
      v_verified_paid_paise, v_order.total_amount_paise, v_ticket_master.ticket_number
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.draw_manual_exclusions dme
    WHERE dme.campaign_id = v_draw.campaign_id
      AND dme.ticket_id = v_winning_ticket.ticket_id
      AND (dme.prize_id IS NULL OR dme.prize_id = p_prize_id)
  ) THEN
    RAISE EXCEPTION 'Disqualified: Ticket % is manually excluded.',
      v_ticket_master.ticket_number
      USING ERRCODE = '23514';
  END IF;

  BEGIN
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
      lower(trim(p_seed_commitment)),
      trim(p_seed_revealed),
      p_combined_seed,
      p_actor
    ) RETURNING id INTO v_result_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Duplicate winner violation: ticket % has already won a prize in campaign %.',
      v_ticket_master.ticket_number, v_draw.campaign_id
      USING ERRCODE = '23505';
  END;

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
    lower(trim(p_seed_commitment)),
    trim(p_seed_revealed),
    p_client_entropy,
    p_combined_seed,
    p_winning_index,
    v_snapshot.total_eligible_count,
    v_winning_ticket.ticket_number,
    'VERIFIED'
  );

  UPDATE public.draws
  SET
    current_prize_id = p_prize_id,
    seed_commitment = COALESCE(seed_commitment, lower(trim(p_seed_commitment))),
    seed_revealed = COALESCE(seed_revealed, trim(p_seed_revealed)),
    client_entropy = p_client_entropy,
    locked_by = p_actor,
    status = CASE WHEN v_prize.prize_number = 1 THEN 'EXECUTED'::public.draw_status ELSE status END,
    executed_at = CASE WHEN v_prize.prize_number = 1 THEN now() ELSE executed_at END
  WHERE id = p_draw_id;

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
      'seed_commitment', lower(trim(p_seed_commitment))
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'result_id', v_result_id,
    'draw_id', p_draw_id,
    'campaign_id', v_draw.campaign_id,
    'prize_id', p_prize_id,
    'ticket_id', v_winning_ticket.ticket_id,
    'ticket_number', v_winning_ticket.ticket_number,
    'selection_index', p_winning_index
  );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_draw_winner_selection(uuid, uuid, uuid, integer, text, text, text, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_draw_winner_selection(uuid, uuid, uuid, integer, text, text, text, uuid, text) TO service_role;

-- 6. Tighten approvals_staff_access RLS and table grants to SELECT-only for authenticated staff
DROP POLICY IF EXISTS approvals_staff_access ON public.draw_approvals;
CREATE POLICY approvals_staff_access
  ON public.draw_approvals
  FOR SELECT
  TO authenticated
  USING (public.is_staff(auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON TABLE public.draw_approvals FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.draw_approvals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.draw_approvals TO service_role;

COMMIT;
