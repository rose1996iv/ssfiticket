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

