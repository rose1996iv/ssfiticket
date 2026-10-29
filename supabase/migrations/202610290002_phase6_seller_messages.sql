-- ============================================================================
-- Migration: 202610290002_phase6_seller_messages.sql
-- Description: Add public.seller_messages table for Admin-to-Seller private messaging
-- Note: Review before applying to production. Do not execute automatically.
-- ============================================================================

create table if not exists public.seller_messages (
  id uuid primary key default gen_random_uuid(),
  recipient_seller_id uuid not null references public.sellers(id) on delete restrict,
  sender_profile_id uuid references public.profiles(id) on delete set null,
  subject text not null check (char_length(trim(subject)) >= 2 and char_length(subject) <= 200),
  body text not null check (char_length(trim(body)) >= 5 and char_length(body) <= 5000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  archived_at timestamptz
);

-- Optimized indexes for recipient lookup, unread counts, and sender history
create index if not exists idx_seller_messages_recipient_created on public.seller_messages(recipient_seller_id, created_at desc);
create index if not exists idx_seller_messages_unread on public.seller_messages(recipient_seller_id) where read_at is null;
create index if not exists idx_seller_messages_sender_created on public.seller_messages(sender_profile_id, created_at desc);

-- Enable Row Level Security
alter table public.seller_messages enable row level security;

-- 1. Staff Read Policy: Authorized administrative staff can view all seller messages
create policy seller_messages_staff_read on public.seller_messages
  for select to authenticated
  using (public.is_staff(auth.uid()));

-- 2. Staff Insert Policy: Only authorized administrative staff can send seller messages
create policy seller_messages_staff_insert on public.seller_messages
  for insert to authenticated
  with check (public.is_staff(auth.uid()));

-- 3. Seller Read Policy: A seller can only read private messages addressed to their own seller profile
create policy seller_messages_seller_read on public.seller_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.sellers s
      where s.id = seller_messages.recipient_seller_id
        and s.profile_id = auth.uid()
    )
  );

-- 4. Seller Update Policy: A seller can only update read_at / archived_at on their own messages
create policy seller_messages_seller_update on public.seller_messages
  for update to authenticated
  using (
    exists (
      select 1 from public.sellers s
      where s.id = seller_messages.recipient_seller_id
        and s.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.sellers s
      where s.id = seller_messages.recipient_seller_id
        and s.profile_id = auth.uid()
    )
  );

-- Revoke broad delete and public permissions
revoke delete on public.seller_messages from anon, authenticated;
grant select, insert, update on public.seller_messages to authenticated;
grant all on public.seller_messages to service_role;

