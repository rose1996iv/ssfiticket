-- ============================================================================
-- Migration: 202610290007_bidirectional_seller_messages.sql
-- Description: Add bidirectional messaging and reply threading to public.seller_messages
-- Note: Review before applying to production. Do not execute automatically.
-- ============================================================================

-- 1. Add sender_role and parent_message_id for conversation threading
-- Note: parent_message_id references public.seller_messages with ON DELETE SET NULL
-- to preserve historical replies if a parent message is archived or deleted.
alter table public.seller_messages
  add column if not exists sender_role text not null default 'ADMIN' check (sender_role in ('ADMIN', 'SELLER')),
  add column if not exists parent_message_id uuid references public.seller_messages(id) on delete set null;

create index if not exists idx_seller_messages_parent on public.seller_messages(parent_message_id);
create index if not exists idx_seller_messages_role on public.seller_messages(sender_role);

-- Ensure foreign key constraint uses ON DELETE SET NULL to prevent cascade loss of replies
do $$ begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'seller_messages_parent_message_id_fkey'
      and table_name = 'seller_messages'
  ) then
    alter table public.seller_messages drop constraint seller_messages_parent_message_id_fkey;
    alter table public.seller_messages
      add constraint seller_messages_parent_message_id_fkey
      foreign key (parent_message_id) references public.seller_messages(id) on delete set null;
  end if;
end $$;

-- 2. Allow active authenticated sellers to insert inquiries and replies to Admin
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

-- 3. Allow administrative staff to update read_at on messages received from sellers
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'seller_messages' and policyname = 'seller_messages_staff_update'
  ) then
    create policy seller_messages_staff_update on public.seller_messages
      for update to authenticated
      using (public.is_staff(auth.uid()))
      with check (public.is_staff(auth.uid()));
  end if;
end $$;
