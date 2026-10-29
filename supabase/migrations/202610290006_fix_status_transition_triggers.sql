-- ==============================================================================
-- Migration: 202610290006_fix_status_transition_triggers.sql
-- Description: Fix enum type collision in validate_status_transition() trigger function
-- Note: Apply to Development Supabase project. Do NOT apply to Production until approved.
-- ==============================================================================
--
-- Root Cause Analysis:
-- The trigger function validate_status_transition() was shared between public.payments
-- and public.orders.
--
-- 1. When updating public.payments, old.status has type payment_status ('PENDING',
--    'SUBMITTED', etc.). The function then evaluated:
--      if tg_table_name='orders' and old.status<>new.status and not ((old.status='PENDING_PAYMENT' ...
--    Because PL/pgSQL compiles and evaluates expression trees, comparing old.status
--    with string literal 'PENDING_PAYMENT' forced PostgreSQL to attempt casting
--    'PENDING_PAYMENT' to payment_status. Since 'PENDING_PAYMENT' is not a member of
--    payment_status, PostgreSQL crashed with:
--      22P02: invalid input value for enum payment_status: "PENDING_PAYMENT"
--
-- 2. Conversely, when updating public.orders, old.status has type order_status, and
--    evaluating the payment condition forced casting string literal 'PENDING' to
--    order_status, crashing with:
--      22P02: invalid input value for enum order_status: "PENDING"
--
-- Resolution:
-- Cast old.status::text and new.status::text to text inside explicit IF/ELSIF table branches.
-- This guarantees exact text comparison without runtime enum coercion errors.
-- ==============================================================================

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

