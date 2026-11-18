-- ============================================================================
-- Phase B1: Ticket Lifecycle & Database Eligibility Hardening (Preview Draft)
-- Target: Preview Supabase (jiyuiydzsfydjklosvvq) — DO NOT APPLY TO PRODUCTION
-- Note: Preserves SSFI-CSPRNG-V1 (B2 cryptographic changes are out of scope).
-- ============================================================================

-- 1. Harden Ticket Identity & Lifecycle Immutability Trigger Function
CREATE OR REPLACE FUNCTION public.protect_ticket_identity_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- 1a. Core identity fields are strictly immutable once issued
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.ticket_number IS DISTINCT FROM OLD.ticket_number
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Ticket identity fields (id, ticket_number, order_id, campaign_id, customer_id, seller_id, issued_at, created_at) are strictly immutable once issued.'
      USING ERRCODE = '23514';
  END IF;

  -- 1b. Prevent VOID -> ISSUED (or any status reversal out of terminal VOID)
  IF OLD.status = 'VOID'::public.ticket_status AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Ticket lifecycle violation: VOID is a terminal state and cannot transition to %.', NEW.status
      USING ERRCODE = '23514';
  END IF;

  -- 1c. Protect void audit fields once populated
  IF OLD.voided_at IS NOT NULL AND NEW.voided_at IS DISTINCT FROM OLD.voided_at THEN
    RAISE EXCEPTION 'Ticket voided_at is immutable once recorded.' USING ERRCODE = '23514';
  END IF;

  IF OLD.voided_by IS NOT NULL AND NEW.voided_by IS DISTINCT FROM OLD.voided_by THEN
    RAISE EXCEPTION 'Ticket voided_by is immutable once recorded.' USING ERRCODE = '23514';
  END IF;

  IF OLD.void_reason IS NOT NULL AND NEW.void_reason IS DISTINCT FROM OLD.void_reason THEN
    RAISE EXCEPTION 'Ticket void_reason is immutable once recorded.' USING ERRCODE = '23514';
  END IF;

  -- 1d. Protect reissue lineage fields
  IF NEW.original_ticket_id IS DISTINCT FROM OLD.original_ticket_id THEN
    RAISE EXCEPTION 'Ticket original_ticket_id lineage is immutable.' USING ERRCODE = '23514';
  END IF;

  IF OLD.reissued_ticket_id IS NOT NULL AND NEW.reissued_ticket_id IS DISTINCT FROM OLD.reissued_ticket_id THEN
    RAISE EXCEPTION 'Ticket reissued_ticket_id is immutable once linked.' USING ERRCODE = '23514';
  END IF;

  IF OLD.reissued_ticket_id IS NULL AND NEW.reissued_ticket_id IS NOT NULL AND NEW.status <> 'VOID'::public.ticket_status THEN
    RAISE EXCEPTION 'Ticket reissued_ticket_id can only be set when transitioning ticket to VOID.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Prevent Unauthorized Hard Deletion of Tickets
CREATE OR REPLACE FUNCTION public.protect_tickets_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion of tickets is prohibited; use admin_void_ticket to void a ticket.'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_tickets_no_delete ON public.tickets;
CREATE TRIGGER trg_protect_tickets_no_delete
  BEFORE DELETE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_tickets_no_delete();

-- 3. Enforce Unique Replacement Lineage & Valid Replacement Creation
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_unique_original_ticket_id
  ON public.tickets(original_ticket_id)
  WHERE original_ticket_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.protect_ticket_replacement_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_orig public.tickets;
BEGIN
  IF NEW.original_ticket_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_orig
  FROM public.tickets
  WHERE id = NEW.original_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Replacement ticket references nonexistent original_ticket_id %.', NEW.original_ticket_id
      USING ERRCODE = '23503';
  END IF;

  IF v_orig.campaign_id <> NEW.campaign_id
     OR v_orig.order_id <> NEW.order_id
     OR v_orig.customer_id <> NEW.customer_id
  THEN
    RAISE EXCEPTION 'Replacement ticket must match original ticket campaign_id, order_id, and customer_id.'
      USING ERRCODE = '23514';
  END IF;

  IF v_orig.status = 'VOID'::public.ticket_status THEN
    RAISE EXCEPTION 'Cannot create replacement for an already VOID ticket %.', v_orig.id
      USING ERRCODE = '23514';
  END IF;

  IF v_orig.reissued_ticket_id IS NOT NULL THEN
    RAISE EXCEPTION 'Original ticket % already has a replacement ticket.', v_orig.id
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_ticket_replacement_lineage ON public.tickets;
CREATE TRIGGER trg_protect_ticket_replacement_lineage
  BEFORE INSERT ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_ticket_replacement_lineage();

-- 4. Harden admin_reissue_ticket (Reject Any VOID Ticket & Enforce Order/Payment Validity)
CREATE OR REPLACE FUNCTION public.admin_reissue_ticket(
  p_ticket_id uuid,
  p_actor uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_ticket public.tickets;
  v_order public.orders;
  v_verified_paid_paise bigint;
  v_new_ticket_id uuid;
  v_number bigint;
  v_new_ticket_number text;
  v_role_ok boolean;
BEGIN
  v_role_ok := public.has_role(p_actor, 'SUPER_ADMIN') OR public.has_role(p_actor, 'ADMIN');
  IF NOT v_role_ok THEN
    RAISE EXCEPTION 'unauthorized: administrative permissions required to reissue tickets'
      USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR char_length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'a specific reissue reason of at least 3 characters is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old_ticket
  FROM public.tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'original ticket not found' USING ERRCODE = 'P0002';
  END IF;

  -- Reject ANY VOID ticket (including VOID without replacement)
  IF v_old_ticket.status = 'VOID'::public.ticket_status THEN
    RAISE EXCEPTION 'cannot reissue a VOID ticket (status=VOID)'
      USING ERRCODE = '23514';
  END IF;

  IF v_old_ticket.reissued_ticket_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.tickets t WHERE t.original_ticket_id = v_old_ticket.id
  ) THEN
    RAISE EXCEPTION 'ticket has already been reissued'
      USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = v_old_ticket.order_id
    AND campaign_id = v_old_ticket.campaign_id
  FOR SHARE;

  IF NOT FOUND OR v_order.status <> 'TICKETS_ISSUED'::public.order_status THEN
    RAISE EXCEPTION 'cannot reissue ticket: parent order is not in TICKETS_ISSUED state'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(p.amount_paise), 0) INTO v_verified_paid_paise
  FROM public.payments p
  WHERE p.order_id = v_order.id
    AND p.status = 'VERIFIED'::public.payment_status;

  IF v_verified_paid_paise <> v_order.total_amount_paise THEN
    RAISE EXCEPTION 'cannot reissue ticket: verified payment total (%) does not match order total (%)',
      v_verified_paid_paise, v_order.total_amount_paise
      USING ERRCODE = '23514';
  END IF;

  v_number := nextval('public.ssfi_ticket_number_sequence');
  v_new_ticket_number := format('SSFI-%s', lpad(v_number::text, 6, '0'));

  INSERT INTO public.tickets (
    campaign_id,
    order_id,
    order_item_id,
    customer_id,
    seller_id,
    ticket_number,
    status,
    original_ticket_id,
    admin_notes
  ) VALUES (
    v_old_ticket.campaign_id,
    v_old_ticket.order_id,
    v_old_ticket.order_item_id,
    v_old_ticket.customer_id,
    v_old_ticket.seller_id,
    v_new_ticket_number,
    'ISSUED'::public.ticket_status,
    v_old_ticket.id,
    format('Replacement for %s. Reason: %s', v_old_ticket.ticket_number, trim(p_reason))
  ) RETURNING id INTO v_new_ticket_id;

  UPDATE public.tickets
  SET status = 'VOID'::public.ticket_status,
      voided_at = now(),
      voided_by = p_actor,
      void_reason = trim(p_reason),
      reissued_ticket_id = v_new_ticket_id,
      updated_at = now()
  WHERE id = p_ticket_id;

  INSERT INTO public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_actor,
    'TICKET_REISSUED',
    'ticket',
    v_new_ticket_id,
    jsonb_build_object(
      'old_ticket_id', v_old_ticket.id,
      'old_ticket_number', v_old_ticket.ticket_number,
      'new_ticket_id', v_new_ticket_id,
      'new_ticket_number', v_new_ticket_number,
      'order_id', v_old_ticket.order_id,
      'reason', trim(p_reason)
    )
  );

  RETURN v_new_ticket_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reissue_ticket(uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reissue_ticket(uuid, uuid, text) TO service_role;

-- 5. Authoritative DB Eligibility Enforcement in admin_lock_eligibility_snapshot
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
  v_campaign public.campaigns;
  v_prize public.prizes;
  v_snapshot_id uuid;
  v_count integer;
  v_distinct_ids integer;
  v_distinct_numbers integer;
  v_invalid_count integer;
  v_prev_winners integer;
  v_manual_exclusions integer;
  i integer;
BEGIN
  IF p_actor IS NULL OR NOT public.is_staff(p_actor) THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_draw FROM public.draws WHERE id = p_draw_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draw session not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_campaign FROM public.campaigns WHERE id = v_draw.campaign_id FOR SHARE;
  IF NOT FOUND OR v_campaign.status NOT IN ('ACTIVE'::public.campaign_status, 'CLOSED'::public.campaign_status) THEN
    RAISE EXCEPTION 'Draw campaign is missing or not in ACTIVE/CLOSED state.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_prize FROM public.prizes WHERE id = p_prize_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prize not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_prize.campaign_id <> v_draw.campaign_id THEN
    RAISE EXCEPTION 'Prize does not belong to the draw campaign.' USING ERRCODE = '23514';
  END IF;

  v_count := array_length(p_ticket_ids, 1);
  IF v_count IS NULL OR v_count <> array_length(p_ticket_numbers, 1) THEN
    RAISE EXCEPTION 'Ticket IDs and numbers array length mismatch.' USING ERRCODE = '2202E';
  END IF;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Cannot lock snapshot with zero eligible tickets.' USING ERRCODE = '22003';
  END IF;

  -- Enforce duplicate-free candidate list
  SELECT count(DISTINCT u.tid), count(DISTINCT trim(u.tnum))
  INTO v_distinct_ids, v_distinct_numbers
  FROM unnest(p_ticket_ids, p_ticket_numbers) AS u(tid, tnum);

  IF v_distinct_ids <> v_count OR v_distinct_numbers <> v_count THEN
    RAISE EXCEPTION 'Duplicate ticket IDs or ticket numbers detected in snapshot.' USING ERRCODE = '23505';
  END IF;

  -- Authoritative DB eligibility validation for every ticket in the snapshot
  SELECT count(*) INTO v_invalid_count
  FROM unnest(p_ticket_ids, p_ticket_numbers) AS u(tid, tnum)
  LEFT JOIN public.tickets t ON t.id = u.tid
  LEFT JOIN public.orders o ON o.id = t.order_id
  WHERE t.id IS NULL
     OR t.ticket_number <> trim(u.tnum)
     OR t.campaign_id <> v_draw.campaign_id
     OR t.status <> 'ISSUED'::public.ticket_status
     OR o.id IS NULL
     OR o.campaign_id <> v_draw.campaign_id
     OR o.status <> 'TICKETS_ISSUED'::public.order_status
     OR (
       SELECT COALESCE(SUM(p.amount_paise), 0)
       FROM public.payments p
       WHERE p.order_id = o.id
         AND p.status = 'VERIFIED'::public.payment_status
     ) <> o.total_amount_paise
     OR EXISTS (
       SELECT 1 FROM public.draw_results dr
       WHERE dr.campaign_id = v_draw.campaign_id
         AND dr.ticket_id = t.id
     )
     OR EXISTS (
       SELECT 1 FROM public.draw_manual_exclusions dme
       WHERE dme.campaign_id = v_draw.campaign_id
         AND dme.ticket_id = t.id
         AND (dme.prize_id IS NULL OR dme.prize_id = p_prize_id)
     );

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Eligibility violation: % ticket(s) failed DB eligibility, verified payment, or exclusion checks.', v_invalid_count
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_prev_winners
  FROM public.draw_results dr
  WHERE dr.campaign_id = v_draw.campaign_id;

  SELECT count(*) INTO v_manual_exclusions
  FROM public.draw_manual_exclusions dme
  WHERE dme.campaign_id = v_draw.campaign_id
    AND (dme.prize_id IS NULL OR dme.prize_id = p_prize_id);

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

  FOR i IN 1..v_count LOOP
    INSERT INTO public.draw_snapshot_tickets (
      snapshot_id,
      ticket_id,
      ticket_number,
      display_index
    ) VALUES (
      v_snapshot_id,
      p_ticket_ids[i],
      trim(p_ticket_numbers[i]),
      i - 1
    );
  END LOOP;

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

REVOKE ALL ON FUNCTION public.admin_lock_eligibility_snapshot(uuid, uuid, text, uuid[], text[], uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_lock_eligibility_snapshot(uuid, uuid, text, uuid[], text[], uuid) TO service_role;

-- 6. Authoritative Eligibility Re-Verification in execute_draw_winner_selection
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
  v_order public.orders;
  v_verified_paid_paise bigint;
  v_result_id uuid;
  v_max_prize_number smallint;
BEGIN
  IF p_actor IS NULL OR NOT public.is_staff(p_actor) THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_draw FROM public.draws WHERE id = p_draw_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draw session not found.' USING ERRCODE = 'P0002';
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

  IF v_draw.seed_commitment IS NOT NULL AND v_draw.seed_commitment <> p_seed_commitment THEN
    RAISE EXCEPTION 'Commitment mismatch: Supplied commitment does not match pre-committed session seed.'
      USING ERRCODE = '23514';
  END IF;

  IF lower(encode(sha256(convert_to(p_seed_revealed, 'UTF8')), 'hex')) <> lower(p_seed_commitment) THEN
    RAISE EXCEPTION 'Cryptographic verification failure: SHA-256 of revealed seed does not match commitment.'
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
    AND draw_id = p_draw_id
    AND prize_id = p_prize_id
    AND is_locked = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Locked eligibility snapshot not found for this prize.' USING ERRCODE = 'P0002';
  END IF;

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

  IF p_winning_index < 0 OR p_winning_index >= v_snapshot.total_eligible_count THEN
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

  IF NOT FOUND OR v_ticket_master.status <> 'ISSUED'::public.ticket_status THEN
    RAISE EXCEPTION 'Disqualified: Ticket % is not in ISSUED state (status=%)',
      v_winning_ticket.ticket_number, v_ticket_master.status
      USING ERRCODE = '23514';
  END IF;

  IF v_ticket_master.campaign_id <> v_draw.campaign_id THEN
    RAISE EXCEPTION 'Disqualified: Ticket % does not belong to campaign %',
      v_winning_ticket.ticket_number, v_draw.campaign_id
      USING ERRCODE = '23514';
  END IF;

  -- Authoritative Order & Verified Payment Re-Check
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = v_ticket_master.order_id
    AND campaign_id = v_draw.campaign_id
  FOR SHARE;

  IF NOT FOUND OR v_order.status <> 'TICKETS_ISSUED'::public.order_status THEN
    RAISE EXCEPTION 'Disqualified: Parent order for ticket % is not in TICKETS_ISSUED state.',
      v_winning_ticket.ticket_number
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(p.amount_paise), 0) INTO v_verified_paid_paise
  FROM public.payments p
  WHERE p.order_id = v_order.id
    AND p.status = 'VERIFIED'::public.payment_status;

  IF v_verified_paid_paise <> v_order.total_amount_paise THEN
    RAISE EXCEPTION 'Disqualified: Verified payment total (%) does not match order total (%) for ticket %.',
      v_verified_paid_paise, v_order.total_amount_paise, v_winning_ticket.ticket_number
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.draw_manual_exclusions dme
    WHERE dme.campaign_id = v_draw.campaign_id
      AND dme.ticket_id = v_winning_ticket.ticket_id
      AND (dme.prize_id IS NULL OR dme.prize_id = p_prize_id)
  ) THEN
    RAISE EXCEPTION 'Disqualified: Ticket % is manually excluded.',
      v_winning_ticket.ticket_number
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.draw_results
    WHERE campaign_id = v_draw.campaign_id
      AND ticket_id = v_winning_ticket.ticket_id
  ) THEN
    RAISE EXCEPTION 'Disqualified: Ticket % has already won a prize in campaign %',
      v_winning_ticket.ticket_number, v_draw.campaign_id
      USING ERRCODE = '23505';
  END IF;

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

-- ============================================================================
-- ROLLBACK INSTRUCTIONS (DO NOT EXECUTE UNLESS REVERTING B1 ON PREVIEW)
-- 1. DROP TRIGGER IF EXISTS trg_protect_tickets_no_delete ON public.tickets;
-- 2. DROP FUNCTION IF EXISTS public.protect_tickets_no_delete();
-- 3. DROP TRIGGER IF EXISTS trg_protect_ticket_replacement_lineage ON public.tickets;
-- 4. DROP FUNCTION IF EXISTS public.protect_ticket_replacement_lineage();
-- 5. DROP INDEX IF EXISTS public.idx_tickets_unique_original_ticket_id;
-- 6. Restore prior definitions of protect_ticket_identity_immutability,
--    admin_reissue_ticket (202610290004), admin_lock_eligibility_snapshot (202611080001),
--    and execute_draw_winner_selection (202611080001).
-- ============================================================================
