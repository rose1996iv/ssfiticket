-- ============================================================================
-- Migration: 202610290007_bidirectional_seller_messages.sql
-- Description: Add bidirectional messaging and reply threading to public.seller_messages
-- Note: Review before applying to production. Do not execute automatically.
-- ============================================================================

-- 1. Add sender_role and parent_message_id for conversation threading
alter table public.seller_messages
  add column if not exists sender_role text not null default 'ADMIN' check (sender_role in ('ADMIN', 'SELLER')),
  add column if not exists parent_message_id uuid references public.seller_messages(id) on delete cascade;

create index if not exists idx_seller_messages_parent on public.seller_messages(parent_message_id);
create index if not exists idx_seller_messages_role on public.seller_messages(sender_role);

-- 2. Allow active authenticated sellers to insert inquiries and replies to Admin
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

-- 3. Allow administrative staff to update read_at on messages received from sellers
create policy seller_messages_staff_update on public.seller_messages
  for update to authenticated
  using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));
