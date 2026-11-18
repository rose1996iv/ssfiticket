-- ============================================================================
-- Phase B2 Remediation R4 Rollback Draft (Do NOT execute remotely)
-- Restores pre-B2-R4 anon SELECT grants and policies from 202611080001.
-- ============================================================================

REVOKE ALL ON FUNCTION public.get_public_draw_winners(text) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.get_public_draw_winners(text);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'draw_randomness_evidence' AND policyname = 'evidence_public_read'
  ) THEN
    CREATE POLICY evidence_public_read ON public.draw_randomness_evidence
      FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.draws d WHERE d.id = draw_id AND d.status = 'EXECUTED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'draws' AND policyname = 'draws_public_read'
  ) THEN
    CREATE POLICY draws_public_read ON public.draws
      FOR SELECT
      USING (status = 'EXECUTED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'draw_results' AND policyname = 'results_public_read'
  ) THEN
    CREATE POLICY results_public_read ON public.draw_results
      FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.draws d WHERE d.id = draw_id AND d.status = 'EXECUTED'));
  END IF;
END $$;

GRANT SELECT ON TABLE public.draws TO anon;
GRANT SELECT ON TABLE public.draw_results TO anon;
GRANT SELECT ON TABLE public.draw_randomness_evidence TO anon;

-- Restore exact pre-B2 execute_draw_winner_selection from 202611140002_phase_b1_1_security_corrections.sql
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

  -- B1.1-01: Strict Seed & Commitment Pre-Validation (Before SHA-256)
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

  -- B1.1-05: Canonical Campaign Enforcement
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

  -- Lock Order Step 1: Lock Campaign Row
  SELECT * INTO v_campaign
  FROM public.campaigns
  WHERE id = v_canonical_campaign_id
  FOR UPDATE;

  -- Lock Order Step 2: Lock Draw Row
  SELECT * INTO v_draw FROM public.draws WHERE id = p_draw_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draw session not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_draw.campaign_id <> v_canonical_campaign_id THEN
    RAISE EXCEPTION 'Canonical campaign violation: draw % belongs to campaign %, expected %.',
      p_draw_id, v_draw.campaign_id, v_canonical_campaign_id
      USING ERRCODE = '23514';
  END IF;

  -- Lock Order Step 3: Lock Prize Row
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

  IF v_draw.seed_commitment IS NOT NULL AND lower(trim(v_draw.seed_commitment)) <> lower(trim(p_seed_commitment)) THEN
    RAISE EXCEPTION 'Commitment mismatch: Supplied commitment does not match pre-committed session seed.'
      USING ERRCODE = '23514';
  END IF;

  -- Sequence Guard (5 -> 4 -> 3 -> 2 -> 1)
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

  -- Lock Order Step 4 & B1.1-02: Lock Snapshot & Validate Integrity
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

  -- First Prize Dual Control Guard
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

  -- Lock Order Step 5 & 6: Lock Ticket, then Parent Order, then Payments
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

  -- B1.1-04: Database-level UNIQUE (campaign_id, ticket_id) + controlled exception
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
    seed_revealed = trim(p_seed_revealed),
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
    'selection_index', p_winning_index,
    'executed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_draw_winner_selection(uuid, uuid, uuid, integer, text, text, text, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_draw_winner_selection(uuid, uuid, uuid, integer, text, text, text, uuid, text) TO service_role;
