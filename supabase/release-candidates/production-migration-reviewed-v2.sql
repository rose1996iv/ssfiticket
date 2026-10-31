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

commit;

-- ==============================================================================
-- END OF CANDIDATE PRODUCTION MIGRATION
-- ==============================================================================
