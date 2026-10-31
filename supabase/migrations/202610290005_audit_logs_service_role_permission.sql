-- ============================================================================
-- Migration: 202610290005_audit_logs_service_role_permission.sql
-- Description: Grant narrow SELECT permissions on audit_logs and profiles to service_role
-- Note: Review before applying to production. Do not execute automatically.
-- ============================================================================

-- Grant schema usage
grant usage on schema public to service_role;

-- Grant narrow read-only privilege on audit_logs and profiles to service_role
-- Resolves PostgreSQL error 42501 (permission denied for table audit_logs)
grant select on public.audit_logs to service_role;
grant select on public.profiles to service_role;

-- Explicitly ensure anon has NO access to audit_logs
revoke all on public.audit_logs from anon;

