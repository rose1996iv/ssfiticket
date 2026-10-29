-- ============================================================================
-- Migration: 202610290003_phase7_campaign_auto_scheduler.sql
-- Description: Automated Campaign Activation, Closing, and Scheduling via pg_cron
-- Note: Review before applying to production. Do not execute automatically.
-- ============================================================================

-- 1. Create or replace the atomic state transition function
create or replace function public.process_scheduled_campaign_transitions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
  v_transition_count integer := 0;
  v_transitions jsonb := '[]'::jsonb;
begin
  -- Loop through campaigns eligible for state transitions with row-level locks
  -- to prevent race conditions from concurrent cron or RPC invocations.
  for v_rec in
    select id, public_id, status, start_at, end_at, name
    from public.campaigns
    where
      -- 1. Eligible for Auto-Activation:
      -- Must be in DRAFT (never PAUSED, CANCELLED, or CLOSED),
      -- start_at must be reached (now() >= start_at),
      -- and closing time end_at must either be null or still in the future (now() < end_at).
      (status = 'DRAFT' and start_at is not null and now() >= start_at and (end_at is null or now() < end_at))
      or
      -- 2. Eligible for Auto-Closing:
      -- Must be in ACTIVE, and end_at must be reached (now() >= end_at).
      (status = 'ACTIVE' and end_at is not null and now() >= end_at)
      or
      -- 3. Overdue DRAFT (schedule expired before launch):
      -- If a campaign in DRAFT has an end_at that has already passed,
      -- transition it directly to CLOSED to avoid ever auto-activating in an expired window.
      (status = 'DRAFT' and end_at is not null and now() >= end_at)
    for update skip locked
  loop
    if v_rec.status = 'DRAFT' and (v_rec.end_at is null or now() < v_rec.end_at) then
      -- Auto-activation
      update public.campaigns
      set status = 'ACTIVE',
          updated_at = now()
      where id = v_rec.id;

      insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
      values (
        null,
        'CAMPAIGN_AUTO_ACTIVATED',
        'campaign',
        v_rec.id,
        jsonb_build_object(
          'campaign_public_id', v_rec.public_id,
          'previous_status', 'DRAFT',
          'new_status', 'ACTIVE',
          'start_at', v_rec.start_at,
          'end_at', v_rec.end_at,
          'transition_timestamp', now()
        )
      );

      v_transitions := v_transitions || jsonb_build_object(
        'campaign_id', v_rec.id,
        'public_id', v_rec.public_id,
        'from', 'DRAFT',
        'to', 'ACTIVE',
        'reason', 'scheduled_start_reached'
      );
      v_transition_count := v_transition_count + 1;

    elsif (v_rec.status = 'ACTIVE' and now() >= v_rec.end_at) or
          (v_rec.status = 'DRAFT' and now() >= v_rec.end_at) then
      -- Auto-closing
      update public.campaigns
      set status = 'CLOSED',
          updated_at = now()
      where id = v_rec.id;

      insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
      values (
        null,
        'CAMPAIGN_AUTO_CLOSED',
        'campaign',
        v_rec.id,
        jsonb_build_object(
          'campaign_public_id', v_rec.public_id,
          'previous_status', v_rec.status,
          'new_status', 'CLOSED',
          'start_at', v_rec.start_at,
          'end_at', v_rec.end_at,
          'transition_timestamp', now()
        )
      );

      v_transitions := v_transitions || jsonb_build_object(
        'campaign_id', v_rec.id,
        'public_id', v_rec.public_id,
        'from', v_rec.status,
        'to', 'CLOSED',
        'reason', 'scheduled_end_reached'
      );
      v_transition_count := v_transition_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'processed_at', now(),
    'transition_count', v_transition_count,
    'transitions', v_transitions
  );
end;
$$;

-- Secure function permissions
revoke all on function public.process_scheduled_campaign_transitions() from public, anon;
grant execute on function public.process_scheduled_campaign_transitions() to authenticated, service_role;

-- Backward-compatible alias for callers or cron jobs referencing evaluate_campaign_schedules()
create or replace function public.evaluate_campaign_schedules()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.process_scheduled_campaign_transitions();
end;
$$;

revoke all on function public.evaluate_campaign_schedules() from public, anon;
grant execute on function public.evaluate_campaign_schedules() to authenticated, service_role;

-- 2. Update create_seller_order to trigger synchronous transition pre-flight
create or replace function public.create_seller_order(
  p_seller_id uuid,
  p_name text,
  p_whatsapp text,
  p_email text,
  p_quantity integer
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_campaign public.campaigns;
  v_customer uuid;
  v_order uuid;
  v_number bigint;
begin
  -- 0. Synchronize any pending scheduled transitions before order evaluation
  perform public.process_scheduled_campaign_transitions();

  -- 1. Atomic row lock on active campaign
  select * into v_campaign
  from public.campaigns
  where public_id = 'ssfi-fundraising-lucky-draw'
    and status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'active campaign not found';
  end if;

  -- 2. Strict Schedule Window Enforcement
  if v_campaign.start_at is not null and now() < v_campaign.start_at then
    raise exception 'campaign ticket sales have not opened yet';
  end if;

  if v_campaign.end_at is not null and now() >= v_campaign.end_at then
    raise exception 'campaign ticket sales have ended';
  end if;

  -- 3. Capacity Guard
  if p_quantity < 1 or p_quantity > (v_campaign.total_ticket_limit - v_campaign.sold_ticket_count) then
    raise exception 'requested quantity exceeds remaining campaign capacity';
  end if;

  -- 4. Seller Status Guard
  if not exists(select 1 from public.sellers where id = p_seller_id and is_active) then
    raise exception 'seller is inactive';
  end if;

  -- 5. Customer Record Creation
  insert into public.customers(full_name, phone, whatsapp_number, email)
  values (trim(p_name), trim(p_whatsapp), trim(p_whatsapp), nullif(trim(p_email), ''))
  returning id into v_customer;

  -- 6. Sequential Order Number Generation
  v_number := nextval('public.ssfi_order_number_sequence');

  -- 7. Order & Items Insertion
  insert into public.orders(
    order_number,
    campaign_id,
    customer_id,
    seller_id,
    quantity,
    unit_price_paise,
    total_amount_paise
  ) values (
    format('ORD-%s-%s', to_char(now(), 'YYYY'), lpad(v_number::text, 6, '0')),
    v_campaign.id,
    v_customer,
    p_seller_id,
    p_quantity,
    v_campaign.ticket_price_paise,
    p_quantity * v_campaign.ticket_price_paise
  ) returning id into v_order;

  insert into public.order_items(order_id, quantity, unit_price_paise, total_amount_paise)
  values (v_order, p_quantity, v_campaign.ticket_price_paise, p_quantity * v_campaign.ticket_price_paise);

  -- 8. Payment Pending Creation
  insert into public.payments(order_id, amount_paise, currency)
  values (v_order, p_quantity * v_campaign.ticket_price_paise, v_campaign.currency);

  -- 9. Audit Logging
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'ORDER_CREATED', 'order', v_order, jsonb_build_object('quantity', p_quantity));

  return v_order;
end $$;

revoke all on function public.create_seller_order(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_seller_order(uuid, text, text, text, integer) to service_role;

-- 3. Register pg_cron background job (every minute) if pg_cron is enabled in Supabase
do $$
declare
  v_cron_available boolean;
  v_job_registered boolean := false;
begin
  select exists (select 1 from pg_available_extensions where name = 'pg_cron') into v_cron_available;

  if not v_cron_available then
    raise warning 'CRON NOT AVAILABLE: Extension pg_cron is not available on this PostgreSQL instance. Background scheduler job was NOT registered. The system will rely on external cron endpoint (/api/cron/campaign-schedule) and synchronous order pre-flight.';
    return;
  end if;

  -- Attempt to enable pg_cron extension (with extensions schema if present, or standard)
  begin
    create extension if not exists pg_cron with schema extensions;
  exception when others then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise warning 'CRON EXTENSION ERROR: Failed to create extension pg_cron [%: %]. Please enable pg_cron in the Supabase Dashboard under Database -> Extensions.', sqlstate, sqlerrm;
      return;
    end;
  end;

  -- Unschedule existing job if already registered to guarantee idempotent update
  if exists (select 1 from cron.job where jobname = 'ssfi-campaign-schedule-sync') then
    perform cron.unschedule('ssfi-campaign-schedule-sync');
  end if;

  -- Schedule to run every minute (* * * * *)
  perform cron.schedule(
    'ssfi-campaign-schedule-sync',
    '* * * * *',
    'select public.process_scheduled_campaign_transitions();'
  );

  -- Explicit verification: confirm job was created in cron.job
  select exists (select 1 from cron.job where jobname = 'ssfi-campaign-schedule-sync') into v_job_registered;

  if not v_job_registered then
    raise warning 'CRON VERIFICATION WARNING: cron.schedule() completed but job "ssfi-campaign-schedule-sync" was not found in cron.job table.';
  else
    raise notice 'SUCCESS: pg_cron job "ssfi-campaign-schedule-sync" successfully scheduled (every minute).';
  end if;

exception when others then
  raise warning 'CRON SETUP ERROR: Failed to register pg_cron job [%: %]. Automatic transitions will fall back to /api/cron/campaign-schedule and synchronous pre-flight until pg_cron is enabled.', sqlstate, sqlerrm;
end $$;

-- 4. Diagnostic helper to inspect scheduler health (available to authenticated staff & service_role)
create or replace function public.get_campaign_scheduler_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_pg_cron boolean := false;
  v_job_exists boolean := false;
  v_job_id bigint := null;
  v_last_run_time timestamptz := null;
  v_last_run_status text := null;
  v_last_run_message text := null;
  v_campaign record;
begin
  -- Check if pg_cron extension is installed
  select exists (select 1 from pg_extension where extname = 'pg_cron') into v_has_pg_cron;

  -- Inspect cron job if extension is present
  if v_has_pg_cron then
    begin
      execute 'select jobid from cron.job where jobname = ''ssfi-campaign-schedule-sync''' into v_job_id;
      v_job_exists := (v_job_id is not null);

      if v_job_exists then
        execute 'select start_time, status, return_message from cron.job_run_details where jobid = $1 order by start_time desc limit 1'
          into v_last_run_time, v_last_run_status, v_last_run_message
          using v_job_id;
      end if;
    exception when others then
      v_last_run_status := 'QUERY_ERROR: ' || sqlerrm;
    end;
  end if;

  select id, public_id, status, start_at, end_at into v_campaign
  from public.campaigns
  where public_id = 'ssfi-fundraising-lucky-draw'
  limit 1;

  return jsonb_build_object(
    'checked_at', now(),
    'pg_cron_installed', v_has_pg_cron,
    'cron_job_scheduled', v_job_exists,
    'cron_job_id', v_job_id,
    'last_run_time', v_last_run_time,
    'last_run_status', v_last_run_status,
    'last_run_message', v_last_run_message,
    'campaign', jsonb_build_object(
      'id', v_campaign.id,
      'public_id', v_campaign.public_id,
      'status', v_campaign.status,
      'start_at', v_campaign.start_at,
      'end_at', v_campaign.end_at
    )
  );
end;
$$;

revoke all on function public.get_campaign_scheduler_status() from public, anon;
grant execute on function public.get_campaign_scheduler_status() to authenticated, service_role;


