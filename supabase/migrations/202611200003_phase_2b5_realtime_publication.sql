-- ============================================================================
-- PHASE 2B.5: IDEMPOTENT SUPABASE REALTIME PUBLICATION MIGRATION
-- ============================================================================
-- Purpose:
--   Codify the exact `supabase_realtime` publication membership required by
--   existing authenticated staff Realtime subscriptions (`LuckyDrawDashboard.tsx`):
--     - public.draw_results
--     - public.draw_eligibility_snapshots
--     - public.draw_approvals
--
-- Security & Safety Guarantees:
--   1. Fully idempotent: checks `pg_publication` and `pg_publication_tables`
--      before creating or adding tables (never fails on re-execution).
--   2. Preserves any existing publication membership without dropping tables.
--   3. Intentionally EXCLUDES sensitive PII, financial, auth, and audit tables
--      (`customers`, `payments`, `payment_recovery_tokens`, `audit_logs`,
--      `system_settings`, `customer_email_outbox`, `profiles`, `profile_roles`).
--   4. Preserves all RLS policies on the published tables (Supabase Realtime
--      evaluates SELECT RLS for every `postgres_changes` subscriber).
-- ============================================================================

DO $$
DECLARE
  v_table text;
  v_required_tables constant text[] := ARRAY[
    'draw_results',
    'draw_eligibility_snapshots',
    'draw_approvals'
  ];
BEGIN
  -- 1. Ensure `supabase_realtime` publication exists (e.g. fresh local PostgreSQL)
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  -- 2. Add only the required tables if not already members
  FOREACH v_table IN ARRAY v_required_tables LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$$;
