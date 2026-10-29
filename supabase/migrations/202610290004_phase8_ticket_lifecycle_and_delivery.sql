-- ============================================================================
-- Migration: 202610290004_phase8_ticket_lifecycle_and_delivery.sql
-- Description: Ticket entry auditing, soft-voiding, reissue, and delivery tracking
-- Note: Review before applying to production. Do not execute automatically.
-- ============================================================================

-- 1. Extend public.tickets for soft-void, reissuance, and administrative notes
alter table public.tickets
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null,
  add column if not exists original_ticket_id uuid references public.tickets(id) on delete set null,
  add column if not exists reissued_ticket_id uuid references public.tickets(id) on delete set null,
  add column if not exists admin_notes text;

-- Allow sequential replacement ticket reissuance up to 6 digits without sequence exhaustion
alter sequence if exists public.ssfi_ticket_number_sequence maxvalue 999999;

create index if not exists idx_tickets_voided on public.tickets(status) where status = 'VOID';
create index if not exists idx_tickets_reissued on public.tickets(original_ticket_id) where original_ticket_id is not null;

-- 2. Delivery channels and status types
do $$
begin
  if not exists (select 1 from pg_type where typname = 'delivery_channel') then
    create type public.delivery_channel as enum ('WHATSAPP', 'EMAIL');
  end if;
  if not exists (select 1 from pg_type where typname = 'delivery_status') then
    create type public.delivery_status as enum ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SIMULATED');
  end if;
end $$;

-- 3. Ticket Deliveries Table for official SSFI delivery tracking
create table if not exists public.ticket_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  channel public.delivery_channel not null,
  recipient text not null,
  status public.delivery_status not null default 'PENDING',
  provider text not null default 'mock',
  provider_message_id text,
  subject text,
  rendered_content text not null,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, channel)
);

create index if not exists idx_ticket_deliveries_order on public.ticket_deliveries(order_id);
create index if not exists idx_ticket_deliveries_status on public.ticket_deliveries(status);
create index if not exists idx_ticket_deliveries_customer on public.ticket_deliveries(customer_id);

-- Attach standard set_updated_at trigger
drop trigger if exists ticket_deliveries_updated on public.ticket_deliveries;
create trigger ticket_deliveries_updated
  before update on public.ticket_deliveries
  for each row execute function public.set_updated_at();

-- 4. Enable Row Level Security on ticket_deliveries
alter table public.ticket_deliveries enable row level security;

-- Staff Read Policy: Administrative staff can view all delivery records
drop policy if exists ticket_deliveries_staff_read on public.ticket_deliveries;
create policy ticket_deliveries_staff_read on public.ticket_deliveries
  for select to authenticated
  using (public.is_staff(auth.uid()));

-- Seller Read Policy: Sellers can view delivery status for their own attributed orders only
drop policy if exists ticket_deliveries_seller_read on public.ticket_deliveries;
create policy ticket_deliveries_seller_read on public.ticket_deliveries
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = ticket_deliveries.order_id
        and o.seller_id = public.current_seller_id()
    )
  );

-- Customer Read Policy: Customers can view deliveries for their own orders
drop policy if exists ticket_deliveries_customer_read on public.ticket_deliveries;
create policy ticket_deliveries_customer_read on public.ticket_deliveries
  for select to authenticated
  using (
    public.owns_customer(ticket_deliveries.customer_id)
  );

-- Revoke dangerous direct modifications from non-service roles
revoke insert, update, delete on public.ticket_deliveries from anon, authenticated;
grant select on public.ticket_deliveries to authenticated;
grant all on public.ticket_deliveries to service_role;
grant select on public.audit_logs to service_role;
grant all on public.tickets to service_role;

-- 5. Atomic Void Ticket Procedure (ADMIN and SUPER_ADMIN only)
create or replace function public.admin_void_ticket(
  p_ticket_id uuid,
  p_actor uuid,
  p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_ticket public.tickets;
  v_role_ok boolean;
begin
  -- Restrict strictly to SUPER_ADMIN or ADMIN (not sellers, customers, or managers)
  v_role_ok := public.has_role(p_actor, 'SUPER_ADMIN') or public.has_role(p_actor, 'ADMIN');
  if not v_role_ok then
    raise exception 'unauthorized: administrative permissions required to void tickets';
  end if;

  if trim(p_reason) is null or char_length(trim(p_reason)) < 3 then
    raise exception 'a specific void reason of at least 3 characters is required';
  end if;

  select * into v_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'ticket not found';
  end if;

  if v_ticket.status = 'VOID' then
    raise exception 'ticket is already voided';
  end if;

  update public.tickets
  set status = 'VOID',
      voided_at = now(),
      voided_by = p_actor,
      void_reason = trim(p_reason),
      updated_at = now()
  where id = p_ticket_id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor,
    'TICKET_VOIDED',
    'ticket',
    p_ticket_id,
    jsonb_build_object(
      'ticket_number', v_ticket.ticket_number,
      'order_id', v_ticket.order_id,
      'customer_id', v_ticket.customer_id,
      'reason', trim(p_reason),
      'voided_at', now()
    )
  );
end $$;

-- 6. Atomic Reissue Ticket Procedure (ADMIN and SUPER_ADMIN only)
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
  -- Restrict strictly to SUPER_ADMIN or ADMIN
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

  -- Generate sequential replacement ticket number
  v_number := nextval('public.ssfi_ticket_number_sequence');
  v_new_ticket_number := format('SSFI-%s', lpad(v_number::text, 6, '0'));

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

  -- Mark old ticket as VOID and link to replacement
  update public.tickets
  set status = 'VOID',
      voided_at = now(),
      voided_by = p_actor,
      void_reason = trim(p_reason),
      reissued_ticket_id = v_new_ticket_id,
      updated_at = now()
  where id = p_ticket_id;

  -- Record structured audit trail
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

-- Revoke all direct calls from anon and authenticated; grant only to service_role
revoke all on function public.admin_void_ticket(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_void_ticket(uuid, uuid, text) to service_role;

revoke all on function public.admin_reissue_ticket(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_reissue_ticket(uuid, uuid, text) to service_role;

