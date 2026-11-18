-- ============================================================================
-- Phase B1.1 Complete Executable Rollback Script (Preview Only)
-- Restores exact pre-B1 definitions from:
--   - 202610290004_phase8_ticket_lifecycle_and_delivery.sql (admin_reissue_ticket)
--   - 202611070001_customer_contact_overrides_collaboration_and_ticket_immutability.sql (protect_ticket_identity_immutability)
--   - 202611080001_phase9c_lucky_draw_foundation.sql (admin_lock_eligibility_snapshot, execute_draw_winner_selection)
-- Preserves unrelated database objects and historical records.
-- ============================================================================

-- ============================================================================
-- 0. PRE-ROLLBACK CHECKS
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.tickets') IS NULL
     OR to_regclass('public.draws') IS NULL
     OR to_regclass('public.draw_results') IS NULL
  THEN
    RAISE EXCEPTION 'Pre-rollback check failed: core tables missing.';
  END IF;
END $$;

-- ============================================================================
-- 1. REMOVE B1 / B1.1-ADDED TRIGGERS, FUNCTIONS, AND INDEX
-- ============================================================================
DROP TRIGGER IF EXISTS trg_protect_tickets_no_delete ON public.tickets;
DROP FUNCTION IF EXISTS public.protect_tickets_no_delete();

DROP TRIGGER IF EXISTS trg_protect_ticket_replacement_lineage ON public.tickets;
DROP FUNCTION IF EXISTS public.protect_ticket_replacement_lineage();

DROP INDEX IF EXISTS public.idx_tickets_unique_original_ticket_id;

-- ============================================================================
-- 2. RESTORE EXACT PRE-B1 protect_ticket_identity_immutability (202611070001)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.protect_ticket_identity_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.ticket_number IS DISTINCT FROM OLD.ticket_number
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
  THEN
    RAISE EXCEPTION 'Ticket identity fields (id, ticket_number, order_id, campaign_id, customer_id, seller_id, issued_at) are strictly immutable once issued.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_ticket_identity_immutability ON public.tickets;
CREATE TRIGGER trg_protect_ticket_identity_immutability
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_ticket_identity_immutability();

-- ============================================================================
-- 3. RESTORE EXACT PRE-B1 admin_reissue_ticket (202610290004)
-- ============================================================================
create or replace function public.admin_reissue_ticket(
  p_ticket_id uuid,
  p_actor uuid,
  p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_old_ticket public.tickets;
  v_new_ticket_id uuid;
  v_number bigint;
  v_new_ticket_number text;
  v_role_ok boolean;
begin
  v_role_ok := public.has_role(p_actor, 'SUPER_ADMIN') or public.has_role(p_actor, 'ADMIN');
  if not v_role_ok then
    raise exception 'unauthorized: administrative permissions required to reissue tickets';
  end if;

  if trim(p_reason) is null or char_length(trim(p_reason)) < 3 then
    raise exception 'a specific reissue reason of at least 3 characters is required';
  end if;

  select * into v_old_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'original ticket not found';
  end if;

  if v_old_ticket.status = 'VOID' and v_old_ticket.reissued_ticket_id is not null then
    raise exception 'ticket has already been reissued';
  end if;

  v_number := nextval('public.ssfi_ticket_number_sequence');
  v_new_ticket_number := format('SSFI-%s', lpad(v_number::text, 6, '0'));

  insert into public.tickets (
    campaign_id,
    order_id,
    order_item_id,
    customer_id,
    seller_id,
    ticket_number,
    status,
    original_ticket_id,
    admin_notes
  ) values (
    v_old_ticket.campaign_id,
    v_old_ticket.order_id,
    v_old_ticket.order_item_id,
    v_old_ticket.customer_id,
    v_old_ticket.seller_id,
    v_new_ticket_number,
    'ISSUED',
    v_old_ticket.id,
    format('Replacement for %s. Reason: %s', v_old_ticket.ticket_number, trim(p_reason))
  ) returning id into v_new_ticket_id;

  update public.tickets
  set status = 'VOID',
      voided_at = now(),
      voided_by = p_actor,
      void_reason = trim(p_reason),
      reissued_ticket_id = v_new_ticket_id,
      updated_at = now()
  where id = p_ticket_id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
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

  return v_new_ticket_id;
end $$;

revoke all on function public.admin_reissue_ticket(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_reissue_ticket(uuid, uuid, text) to service_role;

-- ============================================================================
-- 4. RESTORE EXACT PRE-B1 admin_lock_eligibility_snapshot (202611080001)
-- ============================================================================
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

  v_count := array_length(p_ticket_ids, 1);
  IF v_count IS NULL OR v_count <> array_length(p_ticket_numbers, 1) THEN
    RAISE EXCEPTION 'Ticket IDs and numbers array length mismatch.' USING ERRCODE = '2202E';
  END IF;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Cannot lock snapshot with zero eligible tickets.' USING ERRCODE = '22003';
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
      p_ticket_numbers[i],
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

-- ============================================================================
-- 5. RESTORE EXACT PRE-B1 execute_draw_winner_selection (202611080001)
-- ============================================================================
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

  IF v_ticket_master.status <> 'ISSUED' THEN
    RAISE EXCEPTION 'Disqualified: Ticket % is not in ISSUED state (status=%)',
      v_ticket_master.ticket_number, v_ticket_master.status
      USING ERRCODE = '23514';
  END IF;

  IF v_ticket_master.campaign_id <> v_draw.campaign_id THEN
    RAISE EXCEPTION 'Disqualified: Ticket % does not belong to campaign %',
      v_winning_ticket.ticket_number, v_draw.campaign_id
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
-- 6. POST-ROLLBACK VERIFICATION QUERIES
-- ============================================================================
SELECT tgname
FROM pg_trigger
WHERE tgrelid = 'public.tickets'::regclass
  AND NOT tgisinternal
ORDER BY tgname;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'tickets'
  AND indexname = 'idx_tickets_unique_original_ticket_id';

SELECT proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN (
    'protect_ticket_identity_immutability',
    'protect_tickets_no_delete',
    'protect_ticket_replacement_lineage',
    'admin_reissue_ticket',
    'admin_lock_eligibility_snapshot',
    'execute_draw_winner_selection'
  )
ORDER BY proname;
