-- ==============================================================================
-- SSFI Lucky Draw — Database Table Privileges & Schema Grants
-- ==============================================================================
-- Purpose: Grants standard schema and table permissions to Supabase roles.
--          Resolves PostgreSQL error 42501 ("permission denied for table ...").
--
-- Security:
-- Row-Level Security (RLS) remains 100% active and strictly enforced on all
-- tables. These grants provide the required PostgreSQL table access so that
-- RLS policies can evaluate row permissions for authenticated users, and
-- privileged administrative queries (service_role) can execute successfully.
--
-- How to apply:
-- 1. Open your Supabase Dashboard: https://supabase.com/dashboard
-- 2. Navigate to SQL Editor.
-- 3. Paste this script and click Run.
-- ==============================================================================

-- 1. Grant usage on schema public
grant usage on schema public to anon, authenticated, service_role;

-- 2. Grant table permissions (Restricted: anon only gets select where explicitly allowed by RLS)
grant select on all tables in schema public to anon;
grant select, insert, update on all tables in schema public to authenticated;
grant all on all tables in schema public to postgres, service_role;

-- 3. Grant sequence permissions (for order and ticket number sequences)
grant usage, select on all sequences in schema public to authenticated, service_role;
grant all on all sequences in schema public to postgres;

-- 4. Grant routine permissions (functions and procedures)
grant execute on all routines in schema public to authenticated, service_role;

-- 5. Ensure future tables, sequences, and routines inherit secure privileges
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant select, insert, update on tables to authenticated;
alter default privileges in schema public grant all on tables to postgres, service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public grant execute on routines to authenticated, service_role;

-- 6. Fix Status Transition Trigger Function (Enum Comparison Conflict Resolution)
-- Resolves PostgreSQL error 22P02: invalid input value for enum payment_status: "PENDING_PAYMENT"
create or replace function public.validate_status_transition() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'payments' then
    if old.status::text <> new.status::text and not (
      (old.status::text = 'PENDING' and new.status::text in ('SUBMITTED','CANCELLED')) or
      (old.status::text = 'SUBMITTED' and new.status::text in ('VERIFIED','FAILED','CANCELLED')) or
      (old.status::text = 'FAILED' and new.status::text = 'SUBMITTED') or
      (old.status::text = 'VERIFIED' and new.status::text = 'REFUNDED')
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
end $$;

-- 7. Bidirectional Seller Messaging Columns & Policies
alter table public.seller_messages
  add column if not exists sender_role text not null default 'ADMIN' check (sender_role in ('ADMIN', 'SELLER')),
  add column if not exists parent_message_id uuid references public.seller_messages(id) on delete cascade;

create index if not exists idx_seller_messages_parent on public.seller_messages(parent_message_id);
create index if not exists idx_seller_messages_role on public.seller_messages(sender_role);

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'seller_messages' and policyname = 'seller_messages_seller_insert'
  ) then
    create policy seller_messages_seller_insert on public.seller_messages
      for insert to authenticated
      with check (
        sender_role = 'SELLER'
        and exists (
          select 1 from public.sellers s
          where s.id = seller_messages.recipient_seller_id
            and s.profile_id = auth.uid()
            and s.is_active = true
        )
      );
  end if;
end $$;


