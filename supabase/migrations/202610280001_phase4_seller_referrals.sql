-- Migration: 202610280001_phase4_seller_referrals.sql
-- Description: Phase 4 seller referral and public QR ordering helpers.
-- Note: This is a reviewed migration artifact. Do not apply directly to a production database without approval.

-- 1. Helper to safely query active seller by referral code without exposing private profile fields.
create or replace function public.get_active_seller_by_code(p_code text)
returns table (
  id uuid,
  seller_code text,
  display_name text,
  is_active boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select id, seller_code, display_name, is_active
  from public.sellers
  where upper(trim(seller_code)) = upper(trim(p_code))
    and is_active = true
  limit 1;
$$;

revoke all on function public.get_active_seller_by_code(text) from public;
grant execute on function public.get_active_seller_by_code(text) to anon, authenticated, service_role;

comment on function public.get_active_seller_by_code(text) is
'Returns public-safe seller details for an active seller referral code (e.g. SELLER-001) used in QR code scanning.';
