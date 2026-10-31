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

