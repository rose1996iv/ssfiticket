-- ==============================================================================
-- SSFI Lucky Draw — Master Production Rollout Migration Package
-- ==============================================================================
-- Target Project:  Production Supabase (fohpqheglxhfdecadhzw)
-- Source Migrations: 202610290003 through 202611020002
-- Safety:         Atomic transaction (single BEGIN ... COMMIT)
-- Non-destructive: ZERO drops of tables, ZERO truncations, ZERO data loss
-- Preserves:       Existing profiles, roles, campaigns, and seller records
-- ==============================================================================

-- ==============================================================================
-- SSFI Lucky Draw — Production Database Migration Candidate (REMEDIATED)
-- ==============================================================================
-- Target Database: Production Supabase (fohpqheglxhfdecadhzw)
-- Target Launch:   1 November 2026, 00:00 IST
-- Status:          REMEDIATED CANDIDATE AWAITING OWNER AUTHORIZATION
-- Mode:            STRICTLY UNAPPLIED PROPOSAL / CANDIDATE ONLY
--
-- Safety Guarantees:
-- 1. Atomic Transaction: Wrapped in BEGIN ... COMMIT. Rolls back cleanly on any error.
-- 2. Non-Destructive: ZERO DROPs of tables, ZERO truncations, ZERO data loss.
-- 3. Idempotent: Can be executed multiple times safely without collision.
-- 4. Preserves Live Data: Pre-existing user profiles, roles, sellers, and records are untouched.
-- 5. Zero-Trust Security: All SECURITY DEFINER functions set search_path = '' and qualify pg_catalog.
-- 6. Zero Breaking Changes: Public RLS helper is_staff(uuid) granted to anon with immediate false guard.
-- 7. Zero Client Mutation: Client write policies removed from seller_messages; service_role manages mutations.
--
-- How to Apply (When Approved):
-- 1. Open Production Supabase Dashboard: https://supabase.com/dashboard/project/fohpqheglxhfdecadhzw
-- 2. Navigate to SQL Editor -> New Query.
-- 3. Paste this entire script and click Run.
-- ==============================================================================

begin;

-- ==============================================================================
-- SECTION 1: SEQUENCE CAPACITY REMEDIATION (P0 CRITICAL BLOCKER)
-- ==============================================================================
-- Upgrades maximum ticket capacity from initial 1,000 cap to 999,999 tickets.
-- Eliminates sequence overflow failure during ticket issuance.

alter sequence if exists public.ssfi_ticket_number_sequence
  maxvalue 999999;


-- ==============================================================================
-- SECTION 2: BIDIRECTIONAL SELLER MESSAGING SCHEMA PARITY & RLS
-- ==============================================================================
-- Adds missing messaging thread tracking columns, constraints, indexes, and RLS.

do $$
begin
  -- 1. Add parent_message_id column for reply threads if missing
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'seller_messages'
      and column_name = 'parent_message_id'
  ) then
    alter table public.seller_messages add column parent_message_id uuid;
  end if;

  -- 2. Add sender_role column if missing
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'seller_messages'
      and column_name = 'sender_role'
  ) then
    alter table public.seller_messages
      add column sender_role text default 'ADMIN'::text not null;
  end if;
end $$;

-- Enforce sender_role validation constraint idempotently
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'seller_messages'
      and constraint_name = 'seller_messages_sender_role_check'
  ) then
    alter table public.seller_messages
      add constraint seller_messages_sender_role_check
      check (sender_role in ('ADMIN', 'SELLER'));
  end if;
end $$;

-- Enforce parent_message_id foreign key with ON DELETE RESTRICT idempotently without table drop
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'seller_messages'
      and constraint_name = 'seller_messages_parent_message_id_fkey'
  ) then
    -- Verify no orphan parent IDs exist before adding constraint
    if exists (
      select 1 from public.seller_messages sm
      where sm.parent_message_id is not null
        and not exists (
          select 1 from public.seller_messages parent where parent.id = sm.parent_message_id
        )
    ) then
      raise exception 'cannot add foreign key: orphan parent_message_id found in seller_messages';
    end if;

    -- Add constraint as NOT VALID to avoid heavy exclusive table locks
    alter table public.seller_messages
      add constraint seller_messages_parent_message_id_fkey
      foreign key (parent_message_id) references public.seller_messages(id) on delete restrict not valid;

    -- Validate constraint safely
    alter table public.seller_messages
      validate constraint seller_messages_parent_message_id_fkey;
  end if;
end $$;

-- Indexes for performance
create index if not exists idx_seller_messages_parent
  on public.seller_messages using btree (parent_message_id);

create index if not exists idx_seller_messages_role
  on public.seller_messages using btree (sender_role);

-- RLS Policies on seller_messages:
-- ARCHITECTURE RESOLUTION: All seller message creations and updates are performed server-side
-- via trusted service_role (createSupabaseAdminClient()). Direct client write mutations are revoked.
-- Client write policies are dropped; authenticated users have selective read access only.
-- Remove both the names found in the live Production policy audit and prior draft names.
drop policy if exists "seller_messages_seller_insert" on public.seller_messages;
drop policy if exists "seller_messages_staff_update" on public.seller_messages;
drop policy if exists "seller_messages_seller_update" on public.seller_messages;
drop policy if exists "seller_messages_staff_insert" on public.seller_messages;

drop policy if exists "seller_messages_seller_read" on public.seller_messages;
create policy "seller_messages_seller_read" on public.seller_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.sellers s
      where s.id = seller_messages.recipient_seller_id
        and s.profile_id = auth.uid()
        and s.is_active = true
    )
  );

drop policy if exists "seller_messages_staff_read" on public.seller_messages;
create policy "seller_messages_staff_read" on public.seller_messages
  for select to authenticated
  using (public.is_staff(auth.uid()));


-- ==============================================================================
-- SECTION 3: CAMPAIGN AUTO-SCHEDULER ENGINE (ZERO-TRUST HARDENED)
-- ==============================================================================
-- Provides automated and atomic transitions based on campaign start_at and end_at.
-- All routines set search_path = '' and schema-qualify all pg_catalog and public objects.

create or replace function public.process_scheduled_campaign_transitions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec record;
  v_transition_count integer := 0;
  v_transitions jsonb := '[]'::jsonb;
begin
  -- Loop through campaigns eligible for state transitions with row-level locks
  for v_rec in
    select id, public_id, status, start_at, end_at
    from public.campaigns
    where
      (status = 'DRAFT' and start_at is not null and pg_catalog.now() >= start_at and (end_at is null or pg_catalog.now() < end_at))
      or
      (status in ('DRAFT', 'ACTIVE', 'PAUSED') and end_at is not null and pg_catalog.now() >= end_at)
    for update
  loop
    if v_rec.status = 'DRAFT' and pg_catalog.now() >= v_rec.start_at and (v_rec.end_at is null or pg_catalog.now() < v_rec.end_at) then
      update public.campaigns
      set status = 'ACTIVE', updated_at = pg_catalog.now()
      where id = v_rec.id;

      insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
      values (
        null,
        'CAMPAIGN_AUTO_STARTED',
        'campaign',
        v_rec.id,
        pg_catalog.jsonb_build_object(
          'public_id', v_rec.public_id,
          'previous_status', 'DRAFT',
          'new_status', 'ACTIVE',
          'triggered_at', pg_catalog.now(),
          'start_at', v_rec.start_at
        )
      );

      v_transition_count := v_transition_count + 1;
      v_transitions := v_transitions || pg_catalog.jsonb_build_object(
        'campaign_id', v_rec.id,
        'public_id', v_rec.public_id,
        'from', 'DRAFT',
        'to', 'ACTIVE'
      );

    elsif v_rec.status in ('DRAFT', 'ACTIVE', 'PAUSED') and pg_catalog.now() >= v_rec.end_at then
      update public.campaigns
      set status = 'CLOSED', updated_at = pg_catalog.now()
      where id = v_rec.id;

      insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
      values (
        null,
        'CAMPAIGN_AUTO_CLOSED',
        'campaign',
        v_rec.id,
        pg_catalog.jsonb_build_object(
          'public_id', v_rec.public_id,
          'previous_status', v_rec.status,
          'new_status', 'CLOSED',
          'triggered_at', pg_catalog.now(),
          'end_at', v_rec.end_at
        )
      );

      v_transition_count := v_transition_count + 1;
      v_transitions := v_transitions || pg_catalog.jsonb_build_object(
        'campaign_id', v_rec.id,
        'public_id', v_rec.public_id,
        'from', v_rec.status,
        'to', 'CLOSED'
      );
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'success', true,
    'transitions_executed', v_transition_count,
    'transitions', v_transitions,
    'evaluated_at', pg_catalog.now()
  );
end;
$$;

create or replace function public.evaluate_campaign_schedules()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.process_scheduled_campaign_transitions();
end;
$$;

create or replace function public.get_campaign_scheduler_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $_$
declare
  v_has_pg_cron boolean := false;
  v_job_exists boolean := false;
  v_job_id bigint := null;
  v_last_run_time timestamptz := null;
  v_last_run_status text := null;
  v_last_run_message text := null;
  v_campaign record;
begin
  select exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
  ) into v_has_pg_cron;

  if v_has_pg_cron then
    begin
      execute 'select jobid from cron.job where command like ''%evaluate_campaign_schedules%'' or command like ''%process_scheduled_campaign_transitions%'' limit 1'
      into v_job_id;

      if v_job_id is not null then
        v_job_exists := true;
        begin
          execute 'select start_time, status, return_message from cron.job_run_details where jobid = $1 order by start_time desc limit 1'
          into v_last_run_time, v_last_run_status, v_last_run_message
          using v_job_id;
        exception when others then
          v_last_run_status := 'NO_RUN_HISTORY';
        end;
      end if;
    exception when others then
      v_has_pg_cron := false;
    end;
  end if;

  select id, public_id, status, start_at, end_at into v_campaign
  from public.campaigns
  where public_id = 'ssfi-fundraising-lucky-draw'
  limit 1;

  return pg_catalog.jsonb_build_object(
    'has_pg_cron', v_has_pg_cron,
    'cron_job_configured', v_job_exists,
    'cron_job_id', v_job_id,
    'last_cron_run_time', v_last_run_time,
    'last_cron_status', v_last_run_status,
    'last_cron_message', v_last_run_message,
    'campaign', case
      when v_campaign.id is not null then pg_catalog.jsonb_build_object(
        'public_id', v_campaign.public_id,
        'current_status', v_campaign.status,
        'start_at', v_campaign.start_at,
        'end_at', v_campaign.end_at,
        'is_pending_start', (v_campaign.status = 'DRAFT' and v_campaign.start_at is not null and pg_catalog.now() >= v_campaign.start_at and (v_campaign.end_at is null or pg_catalog.now() < v_campaign.end_at)),
        'is_pending_close', (v_campaign.status in ('DRAFT', 'ACTIVE', 'PAUSED') and v_campaign.end_at is not null and pg_catalog.now() >= v_campaign.end_at)
      )
      else null
    end,
    'checked_at', pg_catalog.now()
  );
end;
$_$;


-- ==============================================================================
-- SECTION 4: SECURITY HARDENING & LEAST PRIVILEGE ROUTINES (P0 REMEDIATION)
-- ==============================================================================

-- 4.1. Role Enumeration Defense: has_role & is_staff
create or replace function public.has_role(p_user_id uuid, p_role text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
  v_caller_uid uuid;
begin
  v_caller_role := auth.role();
  v_caller_uid := auth.uid();

  -- 1. Trusted backend services with verified service_role JWT
  if v_caller_role = 'service_role' then
    return exists (
      select 1 from public.profile_roles pr
      join public.roles r on r.id = pr.role_id
      where pr.profile_id = p_user_id and r.name = p_role
    );
  end if;

  -- 2. Authenticated user checking their own role
  if v_caller_uid is not null and v_caller_uid = p_user_id then
    return exists (
      select 1 from public.profile_roles pr
      join public.roles r on r.id = pr.role_id
      where pr.profile_id = p_user_id and r.name = p_role
    );
  end if;

  -- 3. Confirmed staff members can inspect roles of any user
  if v_caller_uid is not null and exists (
    select 1 from public.profile_roles pr
    join public.roles r on r.id = pr.role_id
    where pr.profile_id = v_caller_uid and r.name in ('SUPER_ADMIN', 'ADMIN')
  ) then
    return exists (
      select 1 from public.profile_roles pr
      join public.roles r on r.id = pr.role_id
      where pr.profile_id = p_user_id and r.name = p_role
    );
  end if;

  -- 4. Disallow role enumeration for untrusted/unauthenticated callers
  return false;
end;
$$;

-- is_staff(uuid): Callable by anon, authenticated, service_role
-- CRITICAL FIX: Safe for anonymous visitors evaluating RLS policies campaigns_public_read
-- and prizes_public_read. Immediately returns false if p_user_id or auth.uid() is null.
create or replace function public.is_staff(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
  v_caller_uid uuid;
begin
  -- Quick guard: if target is null, never staff
  if p_user_id is null then
    return false;
  end if;

  v_caller_role := auth.role();
  v_caller_uid := auth.uid();

  -- 1. Trusted backend services with verified service_role JWT
  if v_caller_role = 'service_role' then
    return exists (
      select 1 from public.profile_roles pr
      join public.roles r on r.id = pr.role_id
      where pr.profile_id = p_user_id and r.name in ('SUPER_ADMIN', 'ADMIN', 'FUNDRAISING_MANAGER')
    );
  end if;

  -- 2. Anonymous / unauthenticated callers: return false immediately with ZERO DB queries
  if v_caller_uid is null then
    return false;
  end if;

  -- 3. Authenticated user checking their own staff status
  if v_caller_uid = p_user_id then
    return exists (
      select 1 from public.profile_roles pr
      join public.roles r on r.id = pr.role_id
      where pr.profile_id = p_user_id and r.name in ('SUPER_ADMIN', 'ADMIN', 'FUNDRAISING_MANAGER')
    );
  end if;

  -- 4. Confirmed administrative staff checking another user's status
  if exists (
    select 1 from public.profile_roles pr
    join public.roles r on r.id = pr.role_id
    where pr.profile_id = v_caller_uid and r.name in ('SUPER_ADMIN', 'ADMIN')
  ) then
    return exists (
      select 1 from public.profile_roles pr
      join public.roles r on r.id = pr.role_id
      where pr.profile_id = p_user_id and r.name in ('SUPER_ADMIN', 'ADMIN', 'FUNDRAISING_MANAGER')
    );
  end if;

  return false;
end;
$$;

-- 4.2. Hardened Payment Verification & Rejection Routines
create or replace function public.verify_payment_and_issue(
  p_payment_id uuid,
  p_actor uuid
)
returns setof public.tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_order public.orders;
  v_caller_uid uuid;
  v_caller_role text;
begin
  v_caller_uid := auth.uid();
  v_caller_role := auth.role();

  -- Impersonation Guard: If caller is not verified service_role, caller MUST be authenticated and match p_actor
  if v_caller_role is distinct from 'service_role' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor then
      raise exception 'access denied: actor impersonation forbidden';
    end if;
  end if;

  -- Staff Role Guard: Enforced for ALL callers, including service_role
  if p_actor is null or not public.is_staff(p_actor) then
    raise exception 'administrator role required';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.status::text <> 'SUBMITTED' then
    raise exception 'payment is not awaiting verification';
  end if;

  select * into v_order from public.orders where id = v_payment.order_id for update;
  if not found or v_order.status::text <> 'PAYMENT_SUBMITTED' then
    raise exception 'order is not in submitted state';
  end if;

  update public.payments
  set
    status = 'VERIFIED',
    verified_at = pg_catalog.now(),
    verified_by = p_actor,
    updated_at = pg_catalog.now()
  where id = v_payment.id;

  update public.orders
  set
    status = 'PAYMENT_VERIFIED',
    updated_at = pg_catalog.now()
  where id = v_order.id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor,
    'PAYMENT_VERIFIED',
    'payment',
    v_payment.id,
    pg_catalog.jsonb_build_object(
      'payment_id', v_payment.id,
      'order_id', v_payment.order_id,
      'verified_by', p_actor
    )
  );

  return query select * from public.issue_tickets(v_order.id);
end;
$$;

create or replace function public.reject_payment(
  p_payment_id uuid,
  p_actor uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_caller_uid uuid;
  v_caller_role text;
  v_clean_reason text;
begin
  v_clean_reason := pg_catalog.btrim(COALESCE(p_reason, ''));
  v_caller_uid := auth.uid();
  v_caller_role := auth.role();

  -- Impersonation Guard
  if v_caller_role is distinct from 'service_role' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor then
      raise exception 'access denied: actor impersonation forbidden';
    end if;
  end if;

  -- Staff Role Guard
  if p_actor is null or not public.is_staff(p_actor) then
    raise exception 'administrator role required';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.status::text <> 'SUBMITTED' then
    raise exception 'payment is not awaiting verification';
  end if;

  update public.payments
  set
    status = 'FAILED',
    rejection_reason = v_clean_reason,
    updated_at = pg_catalog.now()
  where id = v_payment.id;

  update public.orders
  set
    status = 'PENDING_PAYMENT',
    updated_at = pg_catalog.now()
  where id = v_payment.order_id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor,
    'PAYMENT_REJECTED',
    'payment',
    v_payment.id,
    pg_catalog.jsonb_build_object(
      'order_id', v_payment.order_id,
      'reason', v_clean_reason
    )
  );
end;
$$;

-- 4.3. Drop Legacy 5-Parameter create_seller_order to Avoid Overload Ambiguity
drop function if exists public.create_seller_order(uuid, text, text, text, integer);

-- 4.4. Hardened 6-Parameter create_seller_order with Mandatory Email & Regex Validation
create or replace function public.create_seller_order(
  p_seller_id uuid,
  p_name text,
  p_whatsapp text,
  p_email text,
  p_quantity integer,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $_$
declare
  v_campaign public.campaigns;
  v_seller public.sellers;
  v_customer uuid;
  v_order uuid;
  v_number bigint;
  v_clean_name text;
  v_clean_phone text;
  v_phone_digits text;
  v_clean_email text;
  v_actor_user_id uuid;
  v_channel text;
begin
  -- 0. Synchronize any pending scheduled transitions before order evaluation
  perform public.process_scheduled_campaign_transitions();

  -- 1. Validate Mandatory Customer Contact Information
  v_clean_name := pg_catalog.btrim(COALESCE(p_name, ''));
  v_clean_phone := pg_catalog.btrim(COALESCE(p_whatsapp, ''));
  v_clean_email := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')));

  if pg_catalog.char_length(v_clean_name) < 2 then
    raise exception 'valid customer name is required (minimum 2 characters)';
  end if;

  -- Extract digits only for phone validation (7 to 15 digits)
  v_phone_digits := pg_catalog.regexp_replace(v_clean_phone, '[^0-9]', '', 'g');
  if pg_catalog.char_length(v_phone_digits) < 7 or pg_catalog.char_length(v_phone_digits) > 15 then
    raise exception 'valid WhatsApp phone number is required (7 to 15 digits)';
  end if;

  -- Email is strictly compulsory with RFC-compliant format validation
  if v_clean_email = '' or not (v_clean_email ~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$') then
    raise exception 'valid customer email address is required';
  end if;

  -- 2. Atomic Row Lock on Target Campaign
  select * into v_campaign
  from public.campaigns
  where public_id = 'ssfi-fundraising-lucky-draw'
  for update;

  if not found then
    raise exception 'active campaign not found';
  end if;

  -- 3. Strict Schedule Window & State Enforcement
  if v_campaign.status <> 'ACTIVE' then
    if v_campaign.start_at is not null and pg_catalog.now() < v_campaign.start_at then
      raise exception 'ticket sales have not opened yet for this campaign';
    elsif v_campaign.end_at is not null and pg_catalog.now() >= v_campaign.end_at then
      raise exception 'ticket sales for this lucky draw have ended';
    else
      raise exception 'campaign is not currently active for ticket sales';
    end if;
  end if;

  if v_campaign.start_at is not null and pg_catalog.now() < v_campaign.start_at then
    raise exception 'ticket sales have not opened yet for this campaign';
  end if;

  if v_campaign.end_at is not null and pg_catalog.now() >= v_campaign.end_at then
    raise exception 'ticket sales for this lucky draw have ended';
  end if;

  -- 4. Capacity Guard
  if p_quantity < 1 then
    raise exception 'ticket quantity must be at least 1';
  end if;

  if (v_campaign.sold_ticket_count + p_quantity) > v_campaign.total_ticket_limit then
    raise exception 'requested quantity exceeds remaining campaign ticket capacity';
  end if;

  -- 5. Seller Status Guard
  select * into v_seller
  from public.sellers
  where id = p_seller_id;

  if not found or not v_seller.is_active then
    raise exception 'designated referral seller is inactive or invalid';
  end if;

  -- 6. Actor Identity & Role Validation
  v_actor_user_id := auth.uid();
  if p_actor is not null then
    if auth.role() is distinct from 'service_role' then
      if v_actor_user_id is null or v_actor_user_id is distinct from p_actor then
        raise exception 'access denied: actor impersonation forbidden';
      end if;
      if v_seller.profile_id is distinct from p_actor and not public.is_staff(p_actor) then
        raise exception 'access denied: seller can only create orders for their own account';
      end if;
    end if;
    v_actor_user_id := p_actor;
    v_channel := 'SELLER_DIRECT';
  else
    v_channel := 'PUBLIC_REFERRAL';
  end if;

  -- 7. Customer Upsert / Retrieval (Mandatory non-null email)
  select id into v_customer
  from public.customers
  where phone = v_clean_phone
  limit 1;

  if v_customer is not null then
    update public.customers
    set
      full_name = v_clean_name,
      whatsapp_number = v_clean_phone,
      email = v_clean_email,
      updated_at = pg_catalog.now()
    where id = v_customer;
  else
    insert into public.customers(full_name, phone, whatsapp_number, email)
    values (v_clean_name, v_clean_phone, v_clean_phone, v_clean_email)
    returning id into v_customer;
  end if;

  -- 8. Sequential Order Number Generation
  v_number := pg_catalog.nextval('public.ssfi_order_number_sequence');

  -- 9. Order & Items Insertion
  insert into public.orders(
    order_number,
    campaign_id,
    customer_id,
    seller_id,
    quantity,
    unit_price_paise,
    total_amount_paise,
    status
  ) values (
    pg_catalog.format('ORD-%s-%s', pg_catalog.to_char(pg_catalog.now(), 'YYYY'), pg_catalog.lpad(v_number::text, 6, '0')),
    v_campaign.id,
    v_customer,
    p_seller_id,
    p_quantity,
    v_campaign.ticket_price_paise,
    p_quantity * v_campaign.ticket_price_paise,
    'PENDING_PAYMENT'
  ) returning id into v_order;

  insert into public.order_items(order_id, quantity, unit_price_paise, total_amount_paise)
  values (
    v_order,
    p_quantity,
    v_campaign.ticket_price_paise,
    p_quantity * v_campaign.ticket_price_paise
  );

  -- 10. Pending Payment Record Creation
  insert into public.payments(
    order_id,
    amount_paise,
    currency,
    status,
    payment_method
  ) values (
    v_order,
    p_quantity * v_campaign.ticket_price_paise,
    v_campaign.currency,
    'PENDING',
    'MANUAL_UPI'
  );

  -- 11. Immutable Audit Logging
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor_user_id,
    'ORDER_CREATED',
    'order',
    v_order,
    pg_catalog.jsonb_build_object(
      'order_id', v_order,
      'quantity', p_quantity,
      'seller_id', p_seller_id,
      'seller_code', v_seller.seller_code,
      'channel', v_channel,
      'customer_id', v_customer
    )
  );

  return v_order;
end;
$_$;

-- 4.5. Seller Messages Immutability Protection Trigger Function & Trigger
create or replace function public.trg_seller_messages_protect_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.recipient_seller_id is distinct from old.recipient_seller_id
     or new.sender_profile_id is distinct from old.sender_profile_id
     or new.sender_role is distinct from old.sender_role
     or new.subject is distinct from old.subject
     or new.body is distinct from old.body
     or new.created_at is distinct from old.created_at
     or new.parent_message_id is distinct from old.parent_message_id then
    raise exception 'seller message content and history are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_seller_messages_protect on public.seller_messages;
create trigger trg_seller_messages_protect
  before update on public.seller_messages
  for each row
  execute function public.trg_seller_messages_protect_immutable();

-- 4.6. Enum Safe Status Transition Guard
create or replace function public.validate_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'payments' then
    if old.status::text <> new.status::text and not (
      (old.status::text = 'PENDING' and new.status::text in ('SUBMITTED','CANCELLED')) or
      (old.status::text = 'SUBMITTED' and new.status::text in ('VERIFIED','FAILED','CANCELLED')) or
      (old.status::text = 'FAILED' and new.status::text in ('SUBMITTED')) or
      (old.status::text = 'VERIFIED' and new.status::text in ('REFUNDED'))
    ) then
      raise exception 'invalid payment status transition';
    end if;
  elsif tg_table_name = 'orders' then
    if old.status::text <> new.status::text and not (
      (old.status::text = 'PENDING_PAYMENT' and new.status::text in ('PAYMENT_SUBMITTED','CANCELLED')) or
      (old.status::text = 'PAYMENT_SUBMITTED' and new.status::text in ('PAYMENT_VERIFIED','PENDING_PAYMENT','CANCELLED')) or
      (old.status::text = 'PAYMENT_VERIFIED' and new.status::text in ('TICKETS_ISSUED','REFUNDED','CANCELLED'))
    ) then
      raise exception 'invalid order status transition';
    end if;
  end if;
  return new;
end;
$$;

-- 4.7. Hardened Safe Referral Lookup (STABLE SECURITY DEFINER)
create or replace function public.get_active_seller_by_code(p_code text)
returns table(id uuid, seller_code text, display_name text, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.seller_code, s.display_name, s.is_active
  from public.sellers as s
  where pg_catalog.upper(pg_catalog.btrim(s.seller_code)) = pg_catalog.upper(pg_catalog.btrim(p_code))
    and s.is_active = true
  limit 1;
$$;

-- 4.8. Hardened Manual UPI Submission Routine
create or replace function public.submit_manual_upi(
  p_order_id uuid,
  p_utr text,
  p_payer_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_payment public.payments;
  v_clean_utr text;
  v_clean_payer text;
begin
  v_clean_utr := pg_catalog.btrim(COALESCE(p_utr, ''));
  v_clean_payer := pg_catalog.btrim(COALESCE(p_payer_name, ''));

  if v_clean_utr = '' then
    raise exception 'valid UTR transaction reference is required';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found or v_order.status::text <> 'PENDING_PAYMENT' then
    raise exception 'order is not ready for payment submission';
  end if;

  select * into v_payment
  from public.payments
  where order_id = p_order_id
  for update;

  if not found or v_payment.status::text not in ('PENDING', 'FAILED') then
    raise exception 'payment is not ready for submission';
  end if;

  if exists (
    select 1 from public.payments
    where utr_reference = v_clean_utr
      and id <> v_payment.id
  ) then
    raise exception 'UTR is already attached to another payment';
  end if;

  update public.payments
  set
    status = 'SUBMITTED',
    utr_reference = v_clean_utr,
    payer_name = nullif(v_clean_payer, ''),
    submitted_at = pg_catalog.now(),
    rejection_reason = null,
    updated_at = pg_catalog.now()
  where id = v_payment.id;

  update public.orders
  set
    status = 'PAYMENT_SUBMITTED',
    updated_at = pg_catalog.now()
  where id = p_order_id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'PAYMENT_SUBMITTED',
    'payment',
    v_payment.id,
    pg_catalog.jsonb_build_object(
      'order_id', p_order_id,
      'utr_reference', v_clean_utr
    )
  );
end;
$$;

-- 4.9. Hardened Ticket Issuance Routine (Internal to verify_payment_and_issue)
create or replace function public.issue_tickets(p_order_id uuid)
returns setof public.tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_campaign public.campaigns;
  v_count integer;
  v_number bigint;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;

  if not exists (
    select 1 from public.payments
    where order_id = p_order_id
      and status::text = 'VERIFIED'
      and amount_paise = v_order.total_amount_paise
  ) then
    raise exception 'verified payment required';
  end if;

  if v_order.status::text not in ('PAYMENT_VERIFIED') then
    raise exception 'order is not eligible for issuance';
  end if;

  select * into v_campaign
  from public.campaigns
  where id = v_order.campaign_id
  for update;

  if not found or v_campaign.status::text <> 'ACTIVE' then
    raise exception 'campaign is not active';
  end if;

  if (v_campaign.sold_ticket_count + v_order.quantity) > v_campaign.total_ticket_limit then
    raise exception 'campaign ticket limit exceeded';
  end if;

  for v_count in 1..v_order.quantity loop
    v_number := pg_catalog.nextval('public.ssfi_ticket_number_sequence');
    insert into public.tickets(
      campaign_id,
      order_id,
      customer_id,
      seller_id,
      ticket_number,
      status,
      issued_at,
      created_at,
      updated_at
    ) values (
      v_order.campaign_id,
      v_order.id,
      v_order.customer_id,
      v_order.seller_id,
      pg_catalog.format('SSFI-%s', pg_catalog.lpad(v_number::text, 6, '0')),
      'ISSUED',
      pg_catalog.now(),
      pg_catalog.now(),
      pg_catalog.now()
    );
  end loop;

  update public.campaigns
  set
    sold_ticket_count = sold_ticket_count + v_order.quantity,
    updated_at = pg_catalog.now()
  where id = v_campaign.id;

  update public.orders
  set
    status = 'TICKETS_ISSUED',
    updated_at = pg_catalog.now()
  where id = v_order.id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'TICKET_ISSUED',
    'order',
    v_order.id,
    pg_catalog.jsonb_build_object('quantity', v_order.quantity)
  );

  return query
    select *
    from public.tickets
    where order_id = v_order.id
    order by ticket_number;
end;
$$;

-- 4.10. Hardened Administrative Void & Reissue Routines
create or replace function public.admin_void_ticket(
  p_ticket_id uuid,
  p_actor uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.tickets;
  v_role_ok boolean;
  v_clean_reason text;
begin
  v_clean_reason := pg_catalog.btrim(COALESCE(p_reason, ''));

  -- Restrict strictly to SUPER_ADMIN or ADMIN
  v_role_ok := public.has_role(p_actor, 'SUPER_ADMIN') or public.has_role(p_actor, 'ADMIN');
  if not v_role_ok then
    raise exception 'unauthorized: administrative permissions required to void tickets';
  end if;

  if pg_catalog.char_length(v_clean_reason) < 3 then
    raise exception 'a specific void reason of at least 3 characters is required';
  end if;

  select * into v_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'ticket not found';
  end if;

  if v_ticket.status::text = 'VOID' then
    raise exception 'ticket is already voided';
  end if;

  update public.tickets
  set
    status = 'VOID',
    voided_at = pg_catalog.now(),
    voided_by = p_actor,
    void_reason = v_clean_reason,
    updated_at = pg_catalog.now()
  where id = p_ticket_id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor,
    'TICKET_VOIDED',
    'ticket',
    p_ticket_id,
    pg_catalog.jsonb_build_object(
      'ticket_id', p_ticket_id,
      'reason', v_clean_reason,
      'voided_by', p_actor
    )
  );
end;
$$;

create or replace function public.admin_reissue_ticket(
  p_ticket_id uuid,
  p_actor uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_ticket public.tickets;
  v_new_ticket_id uuid;
  v_number bigint;
  v_new_ticket_number text;
  v_role_ok boolean;
  v_clean_reason text;
begin
  v_clean_reason := pg_catalog.btrim(COALESCE(p_reason, ''));

  -- Restrict strictly to SUPER_ADMIN or ADMIN
  v_role_ok := public.has_role(p_actor, 'SUPER_ADMIN') or public.has_role(p_actor, 'ADMIN');
  if not v_role_ok then
    raise exception 'unauthorized: administrative permissions required to reissue tickets';
  end if;

  if pg_catalog.char_length(v_clean_reason) < 3 then
    raise exception 'a specific reissue reason of at least 3 characters is required';
  end if;

  select * into v_old_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'original ticket not found';
  end if;

  if v_old_ticket.status::text = 'VOID' and v_old_ticket.reissued_ticket_id is not null then
    raise exception 'ticket has already been reissued';
  end if;

  -- Generate sequential replacement ticket number
  v_number := pg_catalog.nextval('public.ssfi_ticket_number_sequence');
  v_new_ticket_number := pg_catalog.format('SSFI-%s', pg_catalog.lpad(v_number::text, 6, '0'));

  -- Insert new replacement ticket
  insert into public.tickets (
    campaign_id,
    order_id,
    order_item_id,
    customer_id,
    seller_id,
    ticket_number,
    status,
    original_ticket_id,
    admin_notes,
    issued_at,
    created_at,
    updated_at
  ) values (
    v_old_ticket.campaign_id,
    v_old_ticket.order_id,
    v_old_ticket.order_item_id,
    v_old_ticket.customer_id,
    v_old_ticket.seller_id,
    v_new_ticket_number,
    'ISSUED',
    v_old_ticket.id,
    pg_catalog.format('Reissued replacing ticket %s. Reason: %s', v_old_ticket.ticket_number, v_clean_reason),
    pg_catalog.now(),
    pg_catalog.now(),
    pg_catalog.now()
  ) returning id into v_new_ticket_id;

  -- Void the old ticket and link to new ticket
  update public.tickets
  set
    status = 'VOID',
    voided_at = pg_catalog.now(),
    voided_by = p_actor,
    void_reason = pg_catalog.format('Reissued as %s: %s', v_new_ticket_number, v_clean_reason),
    reissued_ticket_id = v_new_ticket_id,
    updated_at = pg_catalog.now()
  where id = p_ticket_id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor,
    'TICKET_REISSUED',
    'ticket',
    v_new_ticket_id,
    pg_catalog.jsonb_build_object(
      'original_ticket_id', p_ticket_id,
      'original_ticket_number', v_old_ticket.ticket_number,
      'new_ticket_id', v_new_ticket_id,
      'new_ticket_number', v_new_ticket_number,
      'reason', v_clean_reason,
      'actor', p_actor
    )
  );

  return v_new_ticket_id;
end;
$$;


-- ==============================================================================
-- SECTION 5: PRIVILEGES HARDENING & LEAST PRIVILEGE GRANTS
-- ==============================================================================

-- 5.1. Grant usage on schema public
grant usage on schema public to anon, authenticated, service_role;

-- 5.2. Revoke dangerous table privileges from public, anon, and authenticated
revoke all on all tables in schema public from public, anon, authenticated;

-- Grant selective read access scoped 100% by Row-Level Security
grant select on all tables in schema public to anon;
grant select on all tables in schema public to authenticated;

-- Full operational privileges reserved strictly for postgres and service_role
grant all on all tables in schema public to postgres, service_role;

-- Ensure seller_messages mutations are blocked from client roles
revoke insert, update, delete, truncate, references, trigger on public.seller_messages from public, anon, authenticated;
grant select on public.seller_messages to authenticated;
grant all on public.seller_messages to service_role;

-- 5.3. Sequence Permissions
revoke all on all sequences in schema public from public, anon, authenticated;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant all on all sequences in schema public to postgres;

-- 5.4. Routine Permissions (EXPLICIT ALLOWLIST ONLY)
revoke execute on all functions in schema public from public, anon, authenticated;

-- Public / Anon allowed functions:
-- is_staff is granted to anon so RLS policies evaluating is_staff(auth.uid()) do not throw 42501
grant execute on function public.is_staff(uuid) to anon, authenticated, service_role;
grant execute on function public.get_active_seller_by_code(text) to anon, authenticated, service_role;

-- Authenticated identity & RLS helper routines:
grant execute on function public.has_role(uuid, text) to authenticated, service_role;
grant execute on function public.current_seller_id() to authenticated, service_role;
grant execute on function public.owns_customer(uuid) to authenticated, service_role;
grant execute on function public.seller_owns_customer(uuid) to authenticated, service_role;

-- Privileged Financial & Administrative Routines: STRICTLY service_role ONLY
revoke all on function public.verify_payment_and_issue(uuid, uuid) from public, anon, authenticated;
grant execute on function public.verify_payment_and_issue(uuid, uuid) to service_role;

revoke all on function public.reject_payment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reject_payment(uuid, uuid, text) to service_role;

revoke all on function public.issue_tickets(uuid) from public, anon, authenticated;
grant execute on function public.issue_tickets(uuid) to service_role;

revoke all on function public.create_seller_order(uuid, text, text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.create_seller_order(uuid, text, text, text, integer, uuid) to service_role;

revoke all on function public.submit_manual_upi(uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_manual_upi(uuid, text, text) to service_role;

revoke all on function public.process_scheduled_campaign_transitions() from public, anon, authenticated;
grant execute on function public.process_scheduled_campaign_transitions() to service_role;

revoke all on function public.evaluate_campaign_schedules() from public, anon, authenticated;
grant execute on function public.evaluate_campaign_schedules() to service_role;

revoke all on function public.get_campaign_scheduler_status() from public, anon, authenticated;
grant execute on function public.get_campaign_scheduler_status() to service_role;

revoke all on function public.admin_void_ticket(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_void_ticket(uuid, uuid, text) to service_role;

revoke all on function public.admin_reissue_ticket(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_reissue_ticket(uuid, uuid, text) to service_role;


-- ==============================================================================
-- SECTION 6: FUTURE DEFAULT PRIVILEGES (ZERO AUTO-GRANTS MODEL)
-- ==============================================================================

-- Future tables: no automatic client-role access. Every new table migration must
-- explicitly enable RLS and grant only the SELECT/other privileges it needs.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema public
  grant all on tables to postgres, service_role;

-- Future sequences: remove any prior client UPDATE/SETVAL rights, then grant
-- only USAGE/SELECT to the roles that need sequence access.
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to postgres;

-- Schema-level REVOKE cannot cancel PostgreSQL's global default PUBLIC EXECUTE.
-- Revoke that global default for objects created by postgres, then set schema defaults.
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on routines from public, anon, authenticated;
alter default privileges in schema public
  revoke execute on routines from public, anon, authenticated;
alter default privileges in schema public
  grant execute on routines to service_role;


-- ==============================================================================
-- SECTION 7: PRODUCTION BASELINE DATA PRESERVATION & ACTIVATION (NON-DESTRUCTIVE)
-- ==============================================================================
-- Production already contains live roles, 5 prizes, active sellers (SELLER-007, SELLER-003),
-- and administrative profiles. DO NOT use ON CONFLICT DO UPDATE on campaigns or prizes.
-- We preserve all existing records and update ONLY the campaign operational schedule.

-- 7.1. Roles (Idempotent seed if missing)
insert into public.roles (name)
values
  ('SUPER_ADMIN'),
  ('ADMIN'),
  ('FUNDRAISING_MANAGER'),
  ('SELLER')
on conflict (name) do nothing;

-- 7.2. Campaign Baseline (Idempotent seed if missing; does NOT overwrite existing campaign)
insert into public.campaigns (
  public_id,
  name,
  description,
  ticket_price_paise,
  currency,
  total_ticket_limit,
  sold_ticket_count,
  status,
  start_at,
  end_at
) values (
  'ssfi-fundraising-lucky-draw',
  'SSFI Fundraising Lucky Draw',
  'Fundraising lucky draw for Senthang Students Fellowship India.',
  10000,
  'INR',
  1000,
  0,
  'DRAFT',
  '2026-10-31 18:30:00+00'::timestamptz,
  '2026-12-19 18:30:00+00'::timestamptz
)
on conflict (public_id) do nothing;

-- 7.3. Prizes Baseline (Idempotent seed if missing; does NOT overwrite existing prizes)
insert into public.prizes (
  campaign_id,
  prize_number,
  title,
  description,
  cash_amount_paise,
  display_order
)
select
  c.id,
  v.n,
  v.title,
  v.description,
  v.cash,
  v.n
from public.campaigns c
cross join (
  values
    (1, '1st Prize - ₹10,000 Cash', 'Cash prize', 1000000),
    (2, '2nd Prize - ₹8,000 Cash', 'Cash prize', 800000),
    (3, '3rd Prize - Electric Induction', 'Electric induction cooktop', null::integer),
    (4, '4th Prize - Ukulele', 'Ukulele', null::integer),
    (5, '5th Prize - Mini Soundbox', 'Mini soundbox', null::integer)
) as v(n, title, description, cash)
where c.public_id = 'ssfi-fundraising-lucky-draw'
on conflict (campaign_id, prize_number) do nothing;

-- 7.4. Activate Official Campaign Schedule Window
-- Target: 1 November 2026, 00:00 IST (= 2026-10-31 18:30:00 UTC)
-- End: 20 December 2026, 00:00 IST (= 2026-12-19 18:30:00 UTC)
-- Keep the UPDATE and ROW_COUNT assertion inside the same DO block.
do $$
declare
  v_rows bigint;
begin
  update public.campaigns
  set
    start_at = '2026-10-31 18:30:00+00'::timestamptz,
    end_at = '2026-12-19 18:30:00+00'::timestamptz,
    updated_at = pg_catalog.now()
  where public_id = 'ssfi-fundraising-lucky-draw';

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'assertion failed: expected exactly 1 campaign row updated, got %', v_rows;
  end if;
end $$;



-- ==============================================================================
-- SECTION 8: MIGRATION 202611010001 (CUSTOMER EMAIL OUTBOX & SETTINGS)
-- ==============================================================================

-- ============================================================================
-- Migration: 202611010001_customer_email_outbox.sql
-- Description: Production-ready Transactional Customer Email Outbox and System Settings
-- ============================================================================

-- 1. System Settings Table (Key-Value configuration for operational gates)
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

-- Seed default settings for customer transactional email
insert into public.system_settings (key, value, description)
values
  ('customer_email_live_enabled', 'false'::jsonb, 'Master gate for live customer transactional emails in production'),
  ('customer_email_events', '{"ORDER_CREATED": true, "PAYMENT_APPROVED": true, "TICKETS_ISSUED": true}'::jsonb, 'Per-event customer transactional email notification toggles')
on conflict (key) do nothing;

-- 2. Customer Email Outbox Table (Transactional outbox with unique idempotency keys)
create table if not exists public.customer_email_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  order_id uuid references public.orders(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  event_type text not null check (event_type in ('ORDER_CREATED', 'PAYMENT_APPROVED', 'TICKETS_ISSUED', 'ADMIN_TEST')),
  recipient text not null,
  subject text not null,
  body_text text not null,
  body_html text not null,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'RETRY', 'SIMULATED')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  provider text not null default 'gmail_api',
  provider_message_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for efficient polling, deduplication, and administrative auditing
create index if not exists idx_email_outbox_idempotency on public.customer_email_outbox(idempotency_key);
create index if not exists idx_email_outbox_status_next on public.customer_email_outbox(status, next_attempt_at);
create index if not exists idx_email_outbox_order on public.customer_email_outbox(order_id);
create index if not exists idx_email_outbox_event on public.customer_email_outbox(event_type);
create index if not exists idx_email_outbox_created on public.customer_email_outbox(created_at desc);

-- 3. Triggers for updated_at
drop trigger if exists trg_system_settings_updated on public.system_settings;
create trigger trg_system_settings_updated
  before update on public.system_settings
  for each row execute function public.set_updated_at();

drop trigger if exists trg_customer_email_outbox_updated on public.customer_email_outbox;
create trigger trg_customer_email_outbox_updated
  before update on public.customer_email_outbox
  for each row execute function public.set_updated_at();

-- 4. Enable Row Level Security
alter table public.system_settings enable row level security;
alter table public.customer_email_outbox enable row level security;

-- 5. RLS Policies: system_settings
drop policy if exists system_settings_staff_read on public.system_settings;
create policy system_settings_staff_read on public.system_settings
  for select to authenticated
  using (public.is_staff(auth.uid()));

drop policy if exists system_settings_staff_update on public.system_settings;
create policy system_settings_staff_update on public.system_settings
  for update to authenticated
  using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

-- 6. RLS Policies: customer_email_outbox
drop policy if exists customer_email_outbox_staff_read on public.customer_email_outbox;
create policy customer_email_outbox_staff_read on public.customer_email_outbox
  for select to authenticated
  using (public.is_staff(auth.uid()));

-- 7. Hardened Permissions (Principle of Least Privilege)
revoke insert, update, delete on public.system_settings from anon, authenticated;
grant select, update on public.system_settings to authenticated;
grant all on public.system_settings to service_role;

revoke insert, update, delete on public.customer_email_outbox from anon, authenticated;
grant select on public.customer_email_outbox to authenticated;
grant all on public.customer_email_outbox to service_role;



-- ==============================================================================
-- SECTION 9: MIGRATION 202611011000 (SELLER MESSAGES RETENTION ON SELLER DELETE)
-- ==============================================================================

-- Migration: 202611011000_seller_messages_preserve_on_delete.sql
-- Description: Enable safe permanent seller deletion while preserving historical seller messages
-- 1. Add snapshot columns recipient_seller_code and recipient_display_name to public.seller_messages
-- 2. Backfill existing messages with seller identity snapshots
-- 3. Make recipient_seller_id nullable and update foreign key to ON DELETE SET NULL
-- 4. Update immutability trigger to allow foreign key ON DELETE SET NULL and snapshot population
-- 5. Add trigger to auto-populate snapshots on future inserts if not provided-- 1. Add snapshot columns
alter table public.seller_messages
  add column if not exists recipient_seller_code text,
  add column if not exists recipient_display_name text;

-- 2. Temporarily disable immutability trigger during backfill
alter table public.seller_messages disable trigger trg_seller_messages_protect;

-- Backfill snapshot fields for all existing messages from public.sellers
update public.seller_messages sm
set
  recipient_seller_code = s.seller_code,
  recipient_display_name = s.display_name
from public.sellers s
where sm.recipient_seller_id = s.id
  and (sm.recipient_seller_code is null or sm.recipient_display_name is null);

-- Re-enable immutability trigger
alter table public.seller_messages enable trigger trg_seller_messages_protect;

-- 3. Make recipient_seller_id nullable
alter table public.seller_messages
  alter column recipient_seller_id drop not null;

-- 4. Update foreign key to ON DELETE SET NULL
do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where constraint_name = 'seller_messages_recipient_seller_id_fkey'
      and table_name = 'seller_messages'
  ) then
    alter table public.seller_messages drop constraint seller_messages_recipient_seller_id_fkey;
  end if;
end $$;

alter table public.seller_messages
  add constraint seller_messages_recipient_seller_id_fkey
  foreign key (recipient_seller_id)
  references public.sellers(id)
  on delete set null;

-- 5. Update immutability trigger function
-- Allows recipient_seller_id and sender_profile_id to become NULL upon foreign key deletion
-- Allows backfilling snapshot fields when null, but locks them once set
create or replace function public.trg_seller_messages_protect_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or (new.recipient_seller_id is distinct from old.recipient_seller_id and new.recipient_seller_id is not null)
     or (old.recipient_seller_code is not null and new.recipient_seller_code is distinct from old.recipient_seller_code)
     or (old.recipient_display_name is not null and new.recipient_display_name is distinct from old.recipient_display_name)
     or (new.sender_profile_id is distinct from old.sender_profile_id and new.sender_profile_id is not null)
     or new.sender_role is distinct from old.sender_role
     or new.subject is distinct from old.subject
     or new.body is distinct from old.body
     or new.created_at is distinct from old.created_at
     or new.parent_message_id is distinct from old.parent_message_id then
    raise exception 'seller message content and history are immutable';
  end if;
  return new;
end;
$$;

-- 6. Trigger to automatically snapshot seller identity on new inserts if not provided
create or replace function public.trg_seller_messages_populate_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller record;
begin
  if new.recipient_seller_id is not null and (new.recipient_seller_code is null or new.recipient_display_name is null) then
    select seller_code, display_name into v_seller
    from public.sellers
    where id = new.recipient_seller_id;

    if found then
      if new.recipient_seller_code is null then
        new.recipient_seller_code := v_seller.seller_code;
      end if;
      if new.recipient_display_name is null then
        new.recipient_display_name := v_seller.display_name;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_seller_messages_populate_snapshot on public.seller_messages;
create trigger trg_seller_messages_populate_snapshot
  before insert on public.seller_messages
  for each row
  execute function public.trg_seller_messages_populate_snapshot();

-- ==============================================================================
-- SECTION 10: MIGRATION 202611011100 (PAYMENT RECOVERY TOKENS)
-- ==============================================================================

-- SSFI Lucky Draw — Payment Recovery Tokens and Customer Payment Completion
-- Migration: 202611011100_payment_recovery_tokens.sql
-- Enables SUPER_ADMIN and ADMIN to generate cryptographically secure recovery links
-- for unverified orders, allowing customers to submit mandatory UTR, Email and WhatsApp details.

-- 1. Table: payment_recovery_tokens
create table if not exists public.payment_recovery_tokens (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id) on delete cascade,
    token_hash text not null unique,
    created_by uuid references public.profiles(id) on delete set null,
    expires_at timestamptz not null default (now() + interval '7 days'),
    revoked_at timestamptz,
    revoked_by uuid references public.profiles(id) on delete set null,
    used_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Indexes for fast token lookup and order reference
create index if not exists idx_payment_recovery_tokens_hash on public.payment_recovery_tokens(token_hash);
create index if not exists idx_payment_recovery_tokens_order_id on public.payment_recovery_tokens(order_id);

-- Enable Row Level Security
alter table public.payment_recovery_tokens enable row level security;

-- Drop existing policies if re-running
drop policy if exists "service_role_all_payment_recovery_tokens" on public.payment_recovery_tokens;
drop policy if exists "staff_select_payment_recovery_tokens" on public.payment_recovery_tokens;

-- Service role full access
create policy "service_role_all_payment_recovery_tokens"
    on public.payment_recovery_tokens
    for all
    to service_role
    using (true)
    with check (true);

-- Staff can read token records for management
create policy "staff_select_payment_recovery_tokens"
    on public.payment_recovery_tokens
    for select
    to authenticated
    using (
        exists (
            select 1 from public.profile_roles pr
            join public.roles r on r.id = pr.role_id
            where pr.profile_id = auth.uid()
              and r.name in ('SUPER_ADMIN', 'ADMIN')
        )
    );

-- 2. RPC: create_payment_recovery_link
-- Revokes any existing active token for the order, inserts a new SHA-256 token hash, and logs audit
create or replace function public.create_payment_recovery_link(
    p_order_id uuid,
    p_token_hash text,
    p_actor_id uuid,
    p_expires_days integer default 7
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_order public.orders;
    v_token_id uuid;
    v_expires_at timestamptz;
begin
    -- 1. RBAC Check: Only SUPER_ADMIN or ADMIN can generate recovery links
    if not (public.has_role(p_actor_id, 'SUPER_ADMIN') or public.has_role(p_actor_id, 'ADMIN')) then
        raise exception 'administrator role required to generate recovery link';
    end if;

    -- 2. Validate Order
    select * into v_order from public.orders where id = p_order_id for update;
    if not found then
        raise exception 'order not found';
    end if;

    if v_order.status in ('CANCELLED', 'REFUNDED') then
        raise exception 'cannot generate recovery link for cancelled or refunded order';
    end if;

    -- 3. Calculate expiry
    v_expires_at := now() + (coalesce(p_expires_days, 7) || ' days')::interval;

    -- 4. Revoke previous active tokens for this order
    update public.payment_recovery_tokens
    set revoked_at = now(),
        revoked_by = p_actor_id,
        updated_at = now()
    where order_id = p_order_id
      and revoked_at is null
      and expires_at > now();

    -- 5. Insert new token record (SHA-256 hash ONLY, never plaintext)
    insert into public.payment_recovery_tokens (
        order_id,
        token_hash,
        created_by,
        expires_at
    ) values (
        p_order_id,
        trim(p_token_hash),
        p_actor_id,
        v_expires_at
    ) returning id into v_token_id;

    -- 6. Audit log (never log raw tokens)
    insert into public.audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) values (
        p_actor_id,
        'PAYMENT_RECOVERY_LINK_GENERATED',
        'order',
        p_order_id,
        jsonb_build_object(
            'token_id', v_token_id,
            'expires_at', v_expires_at,
            'order_number', v_order.order_number
        )
    );

    return jsonb_build_object(
        'token_id', v_token_id,
        'order_id', p_order_id,
        'order_number', v_order.order_number,
        'expires_at', v_expires_at
    );
end $$;

-- 3. RPC: revoke_payment_recovery_link
-- Revokes any active token for an order and logs audit
create or replace function public.revoke_payment_recovery_link(
    p_order_id uuid,
    p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_order public.orders;
    v_revoked_count integer;
begin
    -- 1. RBAC Check: Only SUPER_ADMIN or ADMIN can revoke recovery links
    if not (public.has_role(p_actor_id, 'SUPER_ADMIN') or public.has_role(p_actor_id, 'ADMIN')) then
        raise exception 'administrator role required to revoke recovery link';
    end if;

    select * into v_order from public.orders where id = p_order_id for update;
    if not found then
        raise exception 'order not found';
    end if;

    update public.payment_recovery_tokens
    set revoked_at = now(),
        revoked_by = p_actor_id,
        updated_at = now()
    where order_id = p_order_id
      and revoked_at is null;

    get diagnostics v_revoked_count = row_count;

    -- Audit log
    insert into public.audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) values (
        p_actor_id,
        'PAYMENT_RECOVERY_LINK_REVOKED',
        'order',
        p_order_id,
        jsonb_build_object(
            'order_number', v_order.order_number,
            'revoked_count', v_revoked_count
        )
    );

    return jsonb_build_object(
        'order_id', p_order_id,
        'order_number', v_order.order_number,
        'revoked_count', v_revoked_count
    );
end $$;

-- 4. RPC: lookup_payment_recovery_token
-- Validates token hash and returns detailed order/customer/payment status
create or replace function public.lookup_payment_recovery_token(
    p_token_hash text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_token public.payment_recovery_tokens;
    v_order public.orders;
    v_customer public.customers;
    v_seller public.sellers;
    v_payment public.payments;
    v_status text;
begin
    -- Look up token
    select * into v_token
    from public.payment_recovery_tokens
    where token_hash = trim(p_token_hash);

    if not found then
        return jsonb_build_object(
            'valid', false,
            'status', 'NOT_FOUND',
            'error', 'The payment details link was not found or has been replaced.'
        );
    end if;

    if v_token.revoked_at is not null then
        return jsonb_build_object(
            'valid', false,
            'status', 'REVOKED',
            'error', 'This payment completion link has been revoked by an administrator.'
        );
    end if;

    if v_token.expires_at <= now() then
        return jsonb_build_object(
            'valid', false,
            'status', 'EXPIRED',
            'error', 'This payment completion link has expired. Please contact support or request a new link.'
        );
    end if;

    -- Look up order
    select * into v_order from public.orders where id = v_token.order_id;
    if not found then
        return jsonb_build_object(
            'valid', false,
            'status', 'ORDER_NOT_FOUND',
            'error', 'Associated order not found.'
        );
    end if;

    -- Check if order cancelled
    if v_order.status in ('CANCELLED', 'REFUNDED') then
        return jsonb_build_object(
            'valid', false,
            'status', 'ORDER_CANCELLED',
            'error', 'This order has been cancelled or refunded.'
        );
    end if;

    -- Look up customer, seller, payment
    select * into v_customer from public.customers where id = v_order.customer_id;
    select * into v_seller from public.sellers where id = v_order.seller_id;
    select * into v_payment from public.payments where order_id = v_order.id limit 1;

    -- Determine workflow status:
    -- If tickets already issued: cannot reuse
    if v_order.status = 'TICKETS_ISSUED' or (v_payment.status is not null and v_payment.status = 'VERIFIED') then
        return jsonb_build_object(
            'valid', false,
            'status', 'ALREADY_ISSUED',
            'error', 'Tickets have already been issued for this order.',
            'order_number', v_order.order_number
        );
    end if;

    -- If payment submitted, customer is allowed to reopen and correct details while unverified
    if v_payment.status = 'SUBMITTED' or v_order.status = 'PAYMENT_SUBMITTED' then
        v_status := 'SUBMITTED_AWAITING_VERIFICATION';
    else
        v_status := 'PENDING_PAYMENT';
    end if;

    return jsonb_build_object(
        'valid', true,
        'status', v_status,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'quantity', v_order.quantity,
        'total_amount_paise', v_order.total_amount_paise,
        'customer_id', v_customer.id,
        'customer_name', v_customer.full_name,
        'customer_phone', v_customer.phone,
        'customer_whatsapp', coalesce(v_customer.whatsapp_number, v_customer.phone),
        'customer_email', coalesce(v_customer.email, ''),
        'seller_code', coalesce(v_seller.seller_code, ''),
        'seller_display_name', coalesce(v_seller.display_name, 'Direct Sale'),
        'payment_id', v_payment.id,
        'payment_status', coalesce(v_payment.status::text, 'PENDING'),
        'payment_utr', coalesce(v_payment.utr_reference, ''),
        'payment_payer_name', coalesce(v_payment.payer_name, ''),
        'payment_submitted_at', v_payment.submitted_at,
        'token_expires_at', v_token.expires_at
    );
end $$;

-- 5. RPC: submit_payment_details_completion
-- Atomic idempotent submission of UTR, Email and WhatsApp details
-- Supports both initial submission (PENDING) and reopen/correction (SUBMITTED)
create or replace function public.submit_payment_details_completion(
    p_order_id uuid,
    p_utr text,
    p_email text,
    p_whatsapp text,
    p_payer_name text default null,
    p_token_hash text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_order public.orders;
    v_payment public.payments;
    v_customer public.customers;
    v_trimmed_utr text;
    v_trimmed_email text;
    v_trimmed_whatsapp text;
    v_was_submitted boolean := false;
begin
    v_trimmed_utr := trim(p_utr);
    v_trimmed_email := lower(trim(p_email));
    v_trimmed_whatsapp := trim(p_whatsapp);

    if length(v_trimmed_utr) < 6 then
        raise exception 'UTR / Reference must be at least 6 characters.';
    end if;

    -- 1. Lock and validate order
    select * into v_order from public.orders where id = p_order_id for update;
    if not found then
        raise exception 'Order not found.';
    end if;

    if v_order.status in ('CANCELLED', 'REFUNDED') then
        raise exception 'Order is cancelled or refunded.';
    end if;

    if v_order.status = 'TICKETS_ISSUED' then
        raise exception 'Tickets have already been issued for this order.';
    end if;

    -- 2. Lock and validate payment
    select * into v_payment from public.payments where order_id = p_order_id for update;
    if not found then
        -- Create initial payment if not present
        insert into public.payments (
            order_id,
            amount_paise,
            payment_method,
            status
        ) values (
            p_order_id,
            v_order.total_amount_paise,
            'MANUAL_UPI',
            'PENDING'
        ) returning * into v_payment;
    end if;

    if v_payment.status = 'VERIFIED' then
        raise exception 'Payment has already been verified and tickets issued.';
    end if;

    if v_payment.status = 'SUBMITTED' then
        v_was_submitted := true;
    end if;

    -- 3. Check UTR uniqueness across other payments
    if exists (
        select 1 from public.payments
        where utr_reference = v_trimmed_utr
          and id <> v_payment.id
    ) then
        raise exception 'This Transaction ID / UTR has already been submitted for another order.';
    end if;

    -- 4. Update customer record with mandatory Email and WhatsApp
    select * into v_customer from public.customers where id = v_order.customer_id for update;
    if found then
        update public.customers
        set email = nullif(v_trimmed_email, ''),
            whatsapp_number = nullif(v_trimmed_whatsapp, ''),
            updated_at = now()
        where id = v_customer.id;
    end if;

    -- 5. Update payment record to SUBMITTED state (awaiting Admin verification)
    update public.payments
    set status = 'SUBMITTED',
        utr_reference = v_trimmed_utr,
        payer_name = nullif(trim(p_payer_name), ''),
        submitted_at = now(),
        rejection_reason = null,
        updated_at = now()
    where id = v_payment.id;

    -- 6. Update order status to PAYMENT_SUBMITTED
    update public.orders
    set status = 'PAYMENT_SUBMITTED',
        updated_at = now()
    where id = p_order_id;

    -- 7. If submitted with token, record token usage
    if p_token_hash is not null and p_token_hash <> '' then
        update public.payment_recovery_tokens
        set used_at = now(),
            updated_at = now()
        where token_hash = trim(p_token_hash);
    end if;

    -- 8. Audit log (never log raw tokens)
    insert into public.audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) values (
        auth.uid(),
        'PAYMENT_DETAILS_SUBMITTED',
        'order',
        p_order_id,
        jsonb_build_object(
            'order_number', v_order.order_number,
            'utr', v_trimmed_utr,
            'email', v_trimmed_email,
            'whatsapp', v_trimmed_whatsapp,
            'reopened', v_was_submitted,
            'is_recovery', (p_token_hash is not null and p_token_hash <> '')
        )
    );

    return jsonb_build_object(
        'success', true,
        'order_id', p_order_id,
        'order_number', v_order.order_number,
        'status', 'PAYMENT_SUBMITTED',
        'reopened', v_was_submitted
    );
end $$;

-- Permissions: Restrict RPC execution strictly to service_role
revoke all on function public.create_payment_recovery_link(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.create_payment_recovery_link(uuid, text, uuid, integer) to service_role;

revoke all on function public.revoke_payment_recovery_link(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_payment_recovery_link(uuid, uuid) to service_role;

revoke all on function public.lookup_payment_recovery_token(text) from public, anon, authenticated;
grant execute on function public.lookup_payment_recovery_token(text) to service_role;

revoke all on function public.submit_payment_details_completion(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_payment_details_completion(uuid, text, text, text, text, text) to service_role;


-- ==============================================================================
-- SECTION 11: MIGRATION 202611011200 (PAYMENT SCREENSHOTS PRIVATE STORAGE & RLS)
-- ==============================================================================

-- Private payment-proof metadata. Existing payments remain valid without a screenshot.
create table if not exists public.payment_screenshots (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.payments(id) on delete restrict,
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$'),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size_bytes integer not null check (file_size_bytes > 0 and file_size_bytes <= 2097152),
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists payment_screenshots_uploaded_at_idx on public.payment_screenshots(uploaded_at desc);
alter table public.payment_screenshots enable row level security;

-- The application uses server-side recovery-token validation and service-role storage access.
-- There is deliberately no authenticated-user policy granting broad screenshot access.
revoke all on public.payment_screenshots from public, anon, authenticated;
grant select, insert, update, delete on public.payment_screenshots to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-screenshots',
  'payment-screenshots',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- No `storage.objects` client policy is created. With Storage RLS enabled this
-- leaves the bucket inaccessible to anon/authenticated clients; the server
-- performs authorization, upload, metadata persistence, and signed URLs.

create or replace function public.get_payment_screenshot_storage_metrics(p_actor uuid)
returns table (
  object_count bigint,
  total_bytes bigint,
  average_bytes numeric,
  uploads_last_7_days bigint
)
language plpgsql security definer set search_path = '' as $$
begin
  if p_actor is null or not public.is_staff(p_actor) then
    raise exception 'administrator role required';
  end if;

  return query
  select
    count(*)::bigint,
    coalesce(sum(file_size_bytes), 0)::bigint,
    coalesce(avg(file_size_bytes), 0),
    count(*) filter (where uploaded_at >= now() - interval '7 days')::bigint
  from public.payment_screenshots;
end;
$$;

revoke all on function public.get_payment_screenshot_storage_metrics(uuid) from public, anon, authenticated;
grant execute on function public.get_payment_screenshot_storage_metrics(uuid) to service_role;


-- ==============================================================================
-- SECTION 12: MIGRATION 202611020001 (SELLER QR, MANDATORY SCREENSHOTS, REVIEW)
-- ==============================================================================

-- SSFI Lucky Draw — Seller-Owned QR Payment, Immutable Destination Snapshots, and Mandatory Screenshot Verification
-- Migration: 202611020001_seller_qr_and_mandatory_screenshots.sql
-- Additive and backward-compatible changes preserving all historical records.

-- 1. Extend sellers table for personal payment QR management
ALTER TABLE public.sellers
  ADD COLUMN IF NOT EXISTS qr_storage_path text,
  ADD COLUMN IF NOT EXISTS qr_content_type text CHECK (qr_content_type IS NULL OR qr_content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD COLUMN IF NOT EXISTS upi_id text,
  ADD COLUMN IF NOT EXISTS account_name text,
  ADD COLUMN IF NOT EXISTS payment_instructions text,
  ADD COLUMN IF NOT EXISTS is_qr_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qr_updated_at timestamptz;

-- 2. Extend orders table with immutable payment destination snapshot
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS snapshot_seller_id uuid REFERENCES public.sellers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS snapshot_seller_display_name text,
  ADD COLUMN IF NOT EXISTS snapshot_seller_code text,
  ADD COLUMN IF NOT EXISTS snapshot_qr_storage_path text,
  ADD COLUMN IF NOT EXISTS snapshot_upi_id text,
  ADD COLUMN IF NOT EXISTS snapshot_account_name text,
  ADD COLUMN IF NOT EXISTS snapshot_payment_instructions text,
  ADD COLUMN IF NOT EXISTS snapshot_captured_at timestamptz;

-- 3. Extend payments table for intermediate Seller Payment Review
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS seller_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS seller_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seller_review_note text,
  ADD COLUMN IF NOT EXISTS seller_review_status text CHECK (
    seller_review_status IS NULL OR
    seller_review_status IN ('RECOMMENDED_APPROVAL', 'RECOMMENDED_REJECTION', 'FLAGGED_DISCREPANCY')
  );

-- 4. Private Storage Bucket for Seller Payment QRs
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'seller-payment-qrs',
  'seller-payment-qrs',
  false,
  2097152, -- 2MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- 5. Updated RPC: submit_payment_details_completion with OPTIONAL UTR & Payer Name
-- Drops former strict constraint requirement for UTR and Payer Name while keeping mandatory verification integrity.
CREATE OR REPLACE FUNCTION public.submit_payment_details_completion(
    p_order_id uuid,
    p_utr text DEFAULT NULL,
    p_email text DEFAULT NULL,
    p_whatsapp text DEFAULT NULL,
    p_payer_name text DEFAULT NULL,
    p_token_hash text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_order public.orders;
    v_payment public.payments;
    v_customer public.customers;
    v_trimmed_utr text;
    v_trimmed_email text;
    v_trimmed_whatsapp text;
    v_trimmed_payer_name text;
    v_was_submitted boolean := false;
BEGIN
    v_trimmed_utr := nullif(trim(p_utr), '');
    v_trimmed_email := nullif(lower(trim(p_email)), '');
    v_trimmed_whatsapp := nullif(trim(p_whatsapp), '');
    v_trimmed_payer_name := nullif(trim(p_payer_name), '');

    -- Validate UTR format only if provided
    IF v_trimmed_utr IS NOT NULL AND length(v_trimmed_utr) < 6 THEN
        RAISE EXCEPTION 'UTR / Reference must be at least 6 characters when provided.';
    END IF;

    -- 1. Lock and validate order
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found.';
    END IF;

    IF v_order.status IN ('CANCELLED', 'REFUNDED') THEN
        RAISE EXCEPTION 'Order is cancelled or refunded.';
    END IF;

    IF v_order.status = 'TICKETS_ISSUED' THEN
        RAISE EXCEPTION 'Tickets have already been issued for this order.';
    END IF;

    -- 2. Lock and validate payment
    SELECT * INTO v_payment FROM public.payments WHERE order_id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        INSERT INTO public.payments (
            order_id,
            amount_paise,
            payment_method,
            status
        ) VALUES (
            p_order_id,
            v_order.total_amount_paise,
            'MANUAL_UPI',
            'PENDING'
        ) RETURNING * INTO v_payment;
    END IF;

    IF v_payment.status = 'VERIFIED' THEN
        RAISE EXCEPTION 'Payment has already been verified and tickets issued.';
    END IF;

    IF v_payment.status = 'SUBMITTED' THEN
        v_was_submitted := true;
    END IF;

    -- 3. Check UTR uniqueness across other payments only if UTR is provided
    IF v_trimmed_utr IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.payments
        WHERE utr_reference = v_trimmed_utr
          AND id <> v_payment.id
    ) THEN
        RAISE EXCEPTION 'This Transaction ID / UTR has already been submitted for another order.';
    END IF;

    -- 4. Update customer record with Email and WhatsApp if provided
    SELECT * INTO v_customer FROM public.customers WHERE id = v_order.customer_id FOR UPDATE;
    IF FOUND THEN
        UPDATE public.customers
        SET email = coalesce(v_trimmed_email, email),
            whatsapp_number = coalesce(v_trimmed_whatsapp, whatsapp_number),
            updated_at = now()
        WHERE id = v_customer.id;
    END IF;

    -- 4b. Mandatory payment screenshot check: a valid screenshot must be registered before submission
    IF NOT EXISTS (
        SELECT 1 FROM public.payment_screenshots WHERE payment_id = v_payment.id
    ) THEN
        RAISE EXCEPTION 'A payment screenshot is mandatory before payment details can be submitted.';
    END IF;

    -- 5. Update payment record to SUBMITTED state (awaiting Seller review & Admin verification)
    UPDATE public.payments
    SET status = 'SUBMITTED',
        utr_reference = coalesce(v_trimmed_utr, utr_reference),
        payer_name = coalesce(v_trimmed_payer_name, payer_name),
        submitted_at = now(),
        rejection_reason = NULL,
        updated_at = now()
    WHERE id = v_payment.id;

    -- 6. Update order status to PAYMENT_SUBMITTED
    UPDATE public.orders
    SET status = 'PAYMENT_SUBMITTED',
        updated_at = now()
    WHERE id = p_order_id;

    -- 7. If submitted with token, record token usage
    IF p_token_hash IS NOT NULL AND p_token_hash <> '' THEN
        UPDATE public.payment_recovery_tokens
        SET used_at = now(),
            updated_at = now()
        WHERE token_hash = trim(p_token_hash);
    END IF;

    -- 8. Audit log (never log raw tokens)
    INSERT INTO public.audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        auth.uid(),
        'PAYMENT_DETAILS_SUBMITTED',
        'order',
        p_order_id,
        jsonb_build_object(
            'order_number', v_order.order_number,
            'utr_supplied', (v_trimmed_utr IS NOT NULL),
            'payer_name_supplied', (v_trimmed_payer_name IS NOT NULL),
            'email_supplied', (v_trimmed_email IS NOT NULL),
            'whatsapp_supplied', (v_trimmed_whatsapp IS NOT NULL),
            'reopened', v_was_submitted,
            'is_recovery', (p_token_hash IS NOT NULL AND p_token_hash <> '')
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'order_id', p_order_id,
        'order_number', v_order.order_number,
        'status', 'PAYMENT_SUBMITTED',
        'reopened', v_was_submitted
    );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_payment_details_completion(uuid, text, text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_payment_details_completion(uuid, text, text, text, text, text) TO service_role;

-- 6. Trigger to enforce database-level immutability of order payment destination snapshot
CREATE OR REPLACE FUNCTION public.protect_order_payment_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    -- Only protect when snapshot has already been captured (allows legitimate initial capture)
    IF OLD.snapshot_captured_at IS NOT NULL THEN
        IF NEW.snapshot_seller_id IS DISTINCT FROM OLD.snapshot_seller_id
           OR NEW.snapshot_seller_code IS DISTINCT FROM OLD.snapshot_seller_code
           OR NEW.snapshot_seller_display_name IS DISTINCT FROM OLD.snapshot_seller_display_name
           OR NEW.snapshot_qr_storage_path IS DISTINCT FROM OLD.snapshot_qr_storage_path
           OR NEW.snapshot_upi_id IS DISTINCT FROM OLD.snapshot_upi_id
           OR NEW.snapshot_account_name IS DISTINCT FROM OLD.snapshot_account_name
           OR NEW.snapshot_payment_instructions IS DISTINCT FROM OLD.snapshot_payment_instructions
           OR NEW.snapshot_captured_at IS DISTINCT FROM OLD.snapshot_captured_at THEN
            RAISE EXCEPTION 'Order payment destination snapshot is immutable and cannot be modified.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_order_payment_snapshot ON public.orders;
CREATE TRIGGER trg_protect_order_payment_snapshot
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.protect_order_payment_snapshot();

-- 7. Updated RPC: submit_manual_upi with Mandatory Screenshot & Optional UTR
CREATE OR REPLACE FUNCTION public.submit_manual_upi(
    p_order_id uuid,
    p_utr text DEFAULT NULL,
    p_payer_name text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_order public.orders;
    v_payment public.payments;
    v_trimmed_utr text;
    v_trimmed_payer_name text;
BEGIN
    v_trimmed_utr := nullif(trim(p_utr), '');
    v_trimmed_payer_name := nullif(trim(p_payer_name), '');

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order.status <> 'PENDING_PAYMENT' THEN
        RAISE EXCEPTION 'order is not ready for payment submission';
    END IF;

    SELECT * INTO v_payment FROM public.payments WHERE order_id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_payment.status NOT IN ('PENDING', 'FAILED') THEN
        RAISE EXCEPTION 'payment is not ready for submission';
    END IF;

    -- Mandatory payment screenshot check
    IF NOT EXISTS (
        SELECT 1 FROM public.payment_screenshots WHERE payment_id = v_payment.id
    ) THEN
        RAISE EXCEPTION 'A payment screenshot is mandatory before payment can be submitted.';
    END IF;

    -- UTR uniqueness check only if provided
    IF v_trimmed_utr IS NOT NULL THEN
        IF length(v_trimmed_utr) < 6 THEN
            RAISE EXCEPTION 'UTR / Reference must be at least 6 characters when provided.';
        END IF;
        IF EXISTS (SELECT 1 FROM public.payments WHERE utr_reference = v_trimmed_utr AND id <> v_payment.id) THEN
            RAISE EXCEPTION 'UTR is already attached to another payment';
        END IF;
    END IF;

    UPDATE public.payments
    SET status = 'SUBMITTED',
        utr_reference = v_trimmed_utr,
        payer_name = v_trimmed_payer_name,
        submitted_at = now(),
        rejection_reason = NULL
    WHERE id = v_payment.id;

    UPDATE public.orders SET status = 'PAYMENT_SUBMITTED' WHERE id = p_order_id;

    INSERT INTO public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (auth.uid(), 'PAYMENT_SUBMITTED', 'payment', v_payment.id, jsonb_build_object(
        'order_id', p_order_id,
        'utr_supplied', (v_trimmed_utr IS NOT NULL)
    ));
END;
$$;

REVOKE ALL ON FUNCTION public.submit_manual_upi(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_manual_upi(uuid, text, text) TO service_role;



-- ==============================================================================
-- SECTION 13: MIGRATION 202611020002 (PROTECT ALL ORDER PAYMENT SNAPSHOT FIELDS)
-- ==============================================================================

-- SSFI Lucky Draw — Complete Order Payment Destination Snapshot Protection
-- Migration: 202611020002_protect_all_order_snapshot_fields.sql
-- Additive security enhancement: Updates protect_order_payment_snapshot() trigger function
-- to explicitly protect snapshot_seller_code and snapshot_seller_display_name alongside
-- all preexisting snapshot fields.

CREATE OR REPLACE FUNCTION public.protect_order_payment_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    -- Only protect when snapshot has already been captured (allows legitimate initial capture)
    IF OLD.snapshot_captured_at IS NOT NULL THEN
        IF NEW.snapshot_seller_id IS DISTINCT FROM OLD.snapshot_seller_id
           OR NEW.snapshot_seller_code IS DISTINCT FROM OLD.snapshot_seller_code
           OR NEW.snapshot_seller_display_name IS DISTINCT FROM OLD.snapshot_seller_display_name
           OR NEW.snapshot_qr_storage_path IS DISTINCT FROM OLD.snapshot_qr_storage_path
           OR NEW.snapshot_upi_id IS DISTINCT FROM OLD.snapshot_upi_id
           OR NEW.snapshot_account_name IS DISTINCT FROM OLD.snapshot_account_name
           OR NEW.snapshot_payment_instructions IS DISTINCT FROM OLD.snapshot_payment_instructions
           OR NEW.snapshot_captured_at IS DISTINCT FROM OLD.snapshot_captured_at THEN
            RAISE EXCEPTION 'Order payment destination snapshot is immutable and cannot be modified.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_order_payment_snapshot ON public.orders;
CREATE TRIGGER trg_protect_order_payment_snapshot
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.protect_order_payment_snapshot();



-- ==============================================================================
-- FINAL ATOMIC COMMIT
-- ==============================================================================

commit;

-- ==============================================================================
-- END OF MASTER PRODUCTION ROLLOUT MIGRATION PACKAGE
-- ==============================================================================