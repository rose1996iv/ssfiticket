-- Migration: 202611011000_seller_messages_preserve_on_delete.sql
-- Description: Enable safe permanent seller deletion while preserving historical seller messages
-- 1. Add snapshot columns recipient_seller_code and recipient_display_name to public.seller_messages
-- 2. Backfill existing messages with seller identity snapshots
-- 3. Make recipient_seller_id nullable and update foreign key to ON DELETE SET NULL
-- 4. Update immutability trigger to allow foreign key ON DELETE SET NULL and snapshot population
-- 5. Add trigger to auto-populate snapshots on future inserts if not provided

begin;

-- 1. Add snapshot columns
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

commit;
