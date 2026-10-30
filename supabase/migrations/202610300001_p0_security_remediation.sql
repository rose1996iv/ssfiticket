-- ============================================================================
-- Migration: 202610300001_p0_security_remediation.sql
-- Description: P0 Security Hardening & Least-Privilege Access Control
-- Target Project: jiyuiydzsfydjklosvvq (PREVIEW ONLY)
--
-- Summary of Remediations:
--   1. Self-only identity guard on public.has_role(uuid, text) and public.is_staff(uuid)
--      with SET search_path = '' and fully schema-qualified tables.
--      current_user = 'postgres' check is strictly removed. Only verified service_role JWT
--      is treated as trusted backend access.
--   2. NULL-safe actor validation on public.verify_payment_and_issue(uuid, uuid)
--      and public.reject_payment(uuid, uuid, text) using IS DISTINCT FROM.
--      Staff authorization is enforced for EVERY actor, including service_role callers.
--   3. Least-privilege EXECUTE grants on critical administrative routines:
--      - verify_payment_and_issue: service_role ONLY
--      - reject_payment: service_role ONLY
--      - issue_tickets: service_role ONLY
--      - create_seller_order: service_role ONLY
--      - submit_manual_upi: service_role ONLY
--      - process_scheduled_campaign_transitions: service_role ONLY
--      - evaluate_campaign_schedules: service_role ONLY
--      - get_campaign_scheduler_status: service_role ONLY
--      - admin_void_ticket: service_role ONLY
--      - admin_reissue_ticket: service_role ONLY
--   4. Seller messaging least privilege & strict immutability:
--      - Revoke direct table INSERT, UPDATE, DELETE from public, anon, authenticated.
--      - Grant SELECT to authenticated (scoped by existing RLS policies).
--      - BEFORE UPDATE trigger enforcing immutability of id, recipient_seller_id,
--        sender_profile_id, sender_role, subject, body, created_at, parent_message_id
--        using IS DISTINCT FROM (NULL-safe).
--      - Only read_at and archived_at are permitted to update.
--   5. Customer contact validation & audit log integrity in create_seller_order:
--      - WhatsApp: 7 to 15 digits (ITU-T E.164), strictly rejects punctuation-only strings.
--      - Email: RFC regex validation.
--      - Backward-compatible p_actor parameter recording authenticated actor
--        and distinguishing SELLER_DIRECT from PUBLIC_REFERRAL channels.
--   6. Status transition trigger validation using safe text comparisons.
--   7. Secure default routine privileges to prevent blanket auto-grant regressions.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. HARDEN: public.has_role & public.is_staff (Role Enumeration Defense)
-- ----------------------------------------------------------------------------

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

  -- 2. Authenticated user checking their own role (standard auth pattern / RLS)
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

  -- 2. Authenticated user checking their own staff status (standard for RLS policies)
  if v_caller_uid is not null and v_caller_uid = p_user_id then
    return exists (
      select 1 from public.profile_roles pr
      join public.roles r on r.id = pr.role_id
      where pr.profile_id = p_user_id and r.name in ('SUPER_ADMIN', 'ADMIN', 'FUNDRAISING_MANAGER')
    );
  end if;

  -- 3. Confirmed administrative staff checking another user's status
  if v_caller_uid is not null and exists (
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

  -- 4. Disallow staff status enumeration by returning false
  return false;
end;
$$;

revoke all on function public.has_role(uuid, text) from public, anon;
grant execute on function public.has_role(uuid, text) to authenticated, service_role;

revoke all on function public.is_staff(uuid) from public, anon;
grant execute on function public.is_staff(uuid) to authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 2. HARDEN: public.verify_payment_and_issue & reject_payment
-- ----------------------------------------------------------------------------

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

  -- Staff Role Guard: Actor must be non-null and possess staff privileges (enforced for ALL callers, including service_role)
  if p_actor is null or not public.is_staff(p_actor) then
    raise exception 'administrator role required';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.status::text <> 'SUBMITTED' then
    raise exception 'payment is not awaiting verification';
  end if;

  select * into v_order from public.orders where id = v_payment.order_id for update;
  if not found or v_order.status::text <> 'PAYMENT_SUBMITTED' or v_payment.amount_paise <> v_order.total_amount_paise then
    raise exception 'payment and order do not match';
  end if;

  update public.payments
  set
    status = 'VERIFIED',
    verified_at = now(),
    verified_by = p_actor,
    updated_at = now()
  where id = v_payment.id;

  update public.orders
  set
    status = 'PAYMENT_VERIFIED',
    updated_at = now()
  where id = v_order.id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor,
    'PAYMENT_VERIFIED',
    'payment',
    v_payment.id,
    jsonb_build_object(
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
begin
  v_caller_uid := auth.uid();
  v_caller_role := auth.role();

  -- Impersonation Guard: If caller is not verified service_role, caller MUST be authenticated and match p_actor
  if v_caller_role is distinct from 'service_role' then
    if v_caller_uid is null or v_caller_uid is distinct from p_actor then
      raise exception 'access denied: actor impersonation forbidden';
    end if;
  end if;

  -- Staff Role Guard: Actor must be non-null and possess staff privileges (enforced for ALL callers, including service_role)
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
    rejection_reason = trim(p_reason),
    updated_at = now()
  where id = v_payment.id;

  update public.orders
  set
    status = 'PENDING_PAYMENT',
    updated_at = now()
  where id = v_payment.order_id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor,
    'PAYMENT_REJECTED',
    'payment',
    v_payment.id,
    jsonb_build_object(
      'order_id', v_payment.order_id,
      'reason', trim(p_reason)
    )
  );
end;
$$;

revoke all on function public.verify_payment_and_issue(uuid, uuid) from public, anon, authenticated;
grant execute on function public.verify_payment_and_issue(uuid, uuid) to service_role;

revoke all on function public.reject_payment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reject_payment(uuid, uuid, text) to service_role;


-- ----------------------------------------------------------------------------
-- 3. HARDEN: public.issue_tickets
-- ----------------------------------------------------------------------------

revoke all on function public.issue_tickets(uuid) from public, anon, authenticated;
grant execute on function public.issue_tickets(uuid) to service_role;


-- ----------------------------------------------------------------------------
-- 4. HARDEN: Order & Campaign Management RPCs & Customer Contact Validation
-- ----------------------------------------------------------------------------

-- Drop 5-argument function signature to ensure clean resolution with default parameter
drop function if exists public.create_seller_order(uuid, text, text, text, integer);

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
as $$
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
  v_clean_name := trim(coalesce(p_name, ''));
  v_clean_phone := trim(coalesce(p_whatsapp, ''));
  v_clean_email := lower(trim(coalesce(p_email, '')));

  if char_length(v_clean_name) < 2 then
    raise exception 'Customer full name is required and must be at least 2 characters.';
  end if;

  -- Validate phone character format (digits with optional +, spaces, hyphens, or parentheses)
  if v_clean_phone !~ '^\+?[0-9\s\-()]{7,25}$' then
    raise exception 'WhatsApp number contains invalid characters.';
  end if;

  -- Extract actual digits and ensure 7 to 15 digits (ITU-T E.164 international standard)
  v_phone_digits := regexp_replace(v_clean_phone, '[^0-9]', '', 'g');
  if char_length(v_phone_digits) < 7 or char_length(v_phone_digits) > 15 then
    raise exception 'WhatsApp number must contain between 7 and 15 digits.';
  end if;

  -- Validate email format (standard local@domain.tld with at least 2 chars TLD)
  if char_length(v_clean_email) < 5 or v_clean_email !~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$' then
    raise exception 'Valid customer email address is required.';
  end if;

  -- 2. Atomic row lock on active campaign
  select * into v_campaign
  from public.campaigns
  where public_id = 'ssfi-fundraising-lucky-draw'
    and status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'active campaign not found';
  end if;

  -- 3. Strict Schedule Window Enforcement
  if v_campaign.start_at is not null and now() < v_campaign.start_at then
    raise exception 'campaign ticket sales have not opened yet';
  end if;

  if v_campaign.end_at is not null and now() >= v_campaign.end_at then
    raise exception 'campaign ticket sales have ended';
  end if;

  -- 4. Capacity Guard
  if p_quantity < 1 or p_quantity > (v_campaign.total_ticket_limit - v_campaign.sold_ticket_count) then
    raise exception 'requested quantity exceeds remaining campaign capacity';
  end if;

  -- 5. Seller Status Guard & Seller Record Retrieval
  select * into v_seller from public.sellers where id = p_seller_id;
  if not found or not v_seller.is_active then
    raise exception 'seller is inactive';
  end if;

  -- 6. Resolve Actor Identity & Channel for Audit Integrity
  v_actor_user_id := coalesce(p_actor, auth.uid());
  if v_actor_user_id is not null then
    -- Actor must match the seller's profile user or confirmed staff
    if v_actor_user_id is distinct from v_seller.profile_id and not public.is_staff(v_actor_user_id) then
      raise exception 'access denied: invalid actor for seller order';
    end if;
    v_channel := 'SELLER_DIRECT';
  else
    -- Unauthenticated public referral purchase
    v_channel := 'PUBLIC_REFERRAL';
  end if;

  -- 7. Customer Record Creation with Authoritative WhatsApp and Email
  insert into public.customers(full_name, phone, whatsapp_number, email)
  values (v_clean_name, v_clean_phone, v_clean_phone, v_clean_email)
  returning id into v_customer;

  -- 8. Sequential Order Number Generation
  v_number := nextval('public.ssfi_order_number_sequence');

  -- 9. Order & Items Insertion
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

  -- 10. Payment Pending Creation
  insert into public.payments(order_id, amount_paise, currency)
  values (v_order, p_quantity * v_campaign.ticket_price_paise, v_campaign.currency);

  -- 11. Audit Logging with Accurate Actor Attribution
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_actor_user_id,
    'ORDER_CREATED',
    'order',
    v_order,
    jsonb_build_object(
      'quantity', p_quantity,
      'channel', v_channel,
      'seller_code', v_seller.seller_code
    )
  );

  return v_order;
end $$;

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


-- ----------------------------------------------------------------------------
-- 5. HARDEN: public.seller_messages (Least Privilege & Immutability)
-- ----------------------------------------------------------------------------

-- Revoke blanket table mutation grants from untrusted roles
revoke insert, update, delete on public.seller_messages from public, anon, authenticated;
grant select on public.seller_messages to authenticated;
grant all on public.seller_messages to service_role;

-- Enforce strict immutability on message content, sender, recipient, and timestamps
-- NULL-safe comparisons using IS DISTINCT FROM across all immutable columns
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

-- Ensure foreign key constraint idempotently uses ON DELETE RESTRICT to prevent thread cascade and resolve immutability conflict
do $$ begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'seller_messages_parent_message_id_fkey'
      and table_name = 'seller_messages'
  ) then
    alter table public.seller_messages drop constraint seller_messages_parent_message_id_fkey;
  end if;

  alter table public.seller_messages
    add constraint seller_messages_parent_message_id_fkey
    foreign key (parent_message_id) references public.seller_messages(id) on delete restrict;
end $$;


-- ----------------------------------------------------------------------------
-- 6. REVISE DEFAULT PRIVILEGES (Zero Auto-Grants for Future Objects)
-- ----------------------------------------------------------------------------

alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public grant all on tables to postgres, service_role;

alter default privileges for role postgres in schema public revoke all on sequences from public, anon;
alter default privileges in schema public revoke all on sequences from public, anon;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres;

alter default privileges for role postgres in schema public revoke execute on routines from public, anon, authenticated;
alter default privileges in schema public revoke execute on routines from public, anon, authenticated;
alter default privileges in schema public grant execute on routines to service_role;


-- ----------------------------------------------------------------------------
-- 7. ROBUST STATUS TRANSITION VALIDATION (Enum Safe Text Comparison)
-- ----------------------------------------------------------------------------

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

commit;
