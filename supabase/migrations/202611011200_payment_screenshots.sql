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
