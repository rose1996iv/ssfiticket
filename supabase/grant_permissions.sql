-- ==============================================================================
-- SSFI Lucky Draw — Database Table Privileges & Schema Grants
-- ==============================================================================
-- Purpose: Hardened, explicit least-privilege schema, table, sequence, and routine grants.
--          Resolves PostgreSQL error 42501 without granting excessive permissions or
--          exposing administrative RPCs to untrusted roles.
--
-- Security Model:
-- - Row-Level Security (RLS) remains 100% active and strictly enforced on all tables.
-- - Explicit REVOKE removes previously accumulated write privileges (INSERT, UPDATE,
--   DELETE, TRUNCATE, REFERENCES, TRIGGER) from public, anon, and authenticated.
-- - Default privileges for future tables grant ZERO auto-access to anon or authenticated.
-- - Only trusted service_role and postgres possess execution rights over sensitive
--   financial, ticket issuance, campaign scheduling, and order creation routines.
-- - No duplicate DDL/schema changes: foreign key constraints, triggers, and
--   table structures are maintained canonically in migrations only.
--
-- How to apply:
-- 1. Open your Supabase Dashboard: https://supabase.com/dashboard
-- 2. Select Preview project jiyuiydzsfydjklosvvq (NEVER production fohpqheglxhfdecadhzw).
-- 3. Navigate to SQL Editor.
-- 4. Paste this script and click Run.
-- ==============================================================================

-- 1. Grant usage on schema public
grant usage on schema public to anon, authenticated, service_role;

-- 2. Explicit Least-Privilege Table Permissions
-- First, revoke all privileges from public, anon, and authenticated to eliminate stale write permissions
revoke all on all tables in schema public from public, anon, authenticated;

-- Grant selective read access scoped 100% by Row-Level Security (RLS)
grant select on all tables in schema public to anon;
grant select on all tables in schema public to authenticated;

-- Full operational privileges reserved strictly for postgres and service_role
grant all on all tables in schema public to postgres, service_role;

-- Explicitly ensure seller_messages mutations are blocked from all client roles
revoke insert, update, delete, truncate, references, trigger on public.seller_messages from public, anon, authenticated;
grant select on public.seller_messages to authenticated;
grant all on public.seller_messages to service_role;

-- 3. Sequence Permissions (Order and ticket number sequence generation)
revoke all on all sequences in schema public from public, anon;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant all on all sequences in schema public to postgres;

-- 4. Routine Permissions (EXPLICIT ALLOWLIST ONLY — NO BLANKET GRANTS)
-- First, revoke execute on all public routines to remove inherited permissions
revoke execute on all functions in schema public from public, anon, authenticated;

-- Public / Anon allowed functions:
grant execute on function public.get_active_seller_by_code(text) to anon, authenticated, service_role;

-- Authenticated identity & RLS helper routines:
grant execute on function public.has_role(uuid, text) to authenticated, service_role;
grant execute on function public.is_staff(uuid) to authenticated, service_role;
grant execute on function public.current_seller_id() to authenticated, service_role;
grant execute on function public.owns_customer(uuid) to authenticated, service_role;
grant execute on function public.seller_owns_customer(uuid) to authenticated, service_role;

-- Privileged Administrative & Financial Routines: STRICTLY service_role ONLY
revoke all on function public.verify_payment_and_issue(uuid, uuid) from public, anon, authenticated;
grant execute on function public.verify_payment_and_issue(uuid, uuid) to service_role;

revoke all on function public.reject_payment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reject_payment(uuid, uuid, text) to service_role;

revoke all on function public.issue_tickets(uuid) from public, anon, authenticated;
grant execute on function public.issue_tickets(uuid) to service_role;

revoke all on function public.create_seller_order(uuid, text, text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.create_seller_order(uuid, text, text, text, integer, uuid) to service_role;

revoke all on function public.submit_manual_upi(uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_manual_upi(uuid, text, text) to service_role;

revoke all on function public.process_scheduled_campaign_transitions() from public, anon, authenticated;
grant execute on function public.process_scheduled_campaign_transitions() to service_role;

revoke all on function public.evaluate_campaign_schedules() from public, anon, authenticated;
grant execute on function public.evaluate_campaign_schedules() to service_role;

revoke all on function public.get_campaign_scheduler_status() from public, anon, authenticated;
grant execute on function public.get_campaign_scheduler_status() to service_role;

revoke all on function public.admin_void_ticket(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_void_ticket(uuid, uuid, text) to service_role;

revoke all on function public.admin_reissue_ticket(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_reissue_ticket(uuid, uuid, text) to service_role;

-- 5. Future Table & Routine Default Privileges (Zero Auto-Grants Model)
-- Future tables must NOT automatically become readable or writable by anon or authenticated
alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public grant all on tables to postgres, service_role;

alter default privileges for role postgres in schema public revoke all on sequences from public, anon;
alter default privileges in schema public revoke all on sequences from public, anon;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres;

alter default privileges for role postgres in schema public revoke execute on routines from public, anon, authenticated;
alter default privileges in schema public revoke execute on routines from public, anon, authenticated;
alter default privileges in schema public grant execute on routines to service_role;
