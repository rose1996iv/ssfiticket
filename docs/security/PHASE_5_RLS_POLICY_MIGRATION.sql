-- ============================================================================
-- SSFI Lucky Draw — Phase 5 Standalone RLS Policy Split Migration
-- File: docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql
-- Target Environment: Preview Supabase (jiyuiydzsfydjklosvvq) — DO NOT EXECUTE WITHOUT OWNER APPROVAL
-- Resolves:
--   - Phase 1 / Phase 3 Finding P1: Anonymous `42501: permission denied for function is_staff`
--     on `public.campaigns` and `public.prizes`
--   - Phase 4 Finding SEC-07: Replaces the blocked `GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO anon`
--     with role-segregated RLS policies so `public.is_staff(uuid)` remains strictly
--     revoked from `PUBLIC` and `anon`.
-- ============================================================================

BEGIN;

-- 1. Enforce strict least-privilege on public.is_staff(uuid)
--    Anonymous callers must NEVER hold EXECUTE privilege on staff role-checking functions.
REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;

-- 2. Ensure table-level SELECT privileges exist for anon and authenticated
--    (Row visibility is strictly governed by the RLS policies below.)
GRANT SELECT ON TABLE public.campaigns TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.prizes TO anon, authenticated, service_role;

-- 3. Split `public.campaigns` SELECT RLS policies by role (`anon` vs `authenticated`)
DROP POLICY IF EXISTS campaigns_public_read ON public.campaigns;
DROP POLICY IF EXISTS campaigns_anon_active_read ON public.campaigns;
DROP POLICY IF EXISTS campaigns_authenticated_read ON public.campaigns;

-- 3a. Anonymous visitors may only read ACTIVE campaigns (never invokes public.is_staff)
CREATE POLICY campaigns_anon_active_read
  ON public.campaigns
  FOR SELECT
  TO anon
  USING (status = 'ACTIVE'::public.campaign_status);

-- 3b. Authenticated users may read ACTIVE campaigns, or all campaigns if authorized staff
CREATE POLICY campaigns_authenticated_read
  ON public.campaigns
  FOR SELECT
  TO authenticated
  USING (
    (status = 'ACTIVE'::public.campaign_status)
    OR public.is_staff(auth.uid())
  );

-- 4. Split `public.prizes` SELECT RLS policies by role (`anon` vs `authenticated`)
DROP POLICY IF EXISTS prizes_public_read ON public.prizes;
DROP POLICY IF EXISTS prizes_anon_active_read ON public.prizes;
DROP POLICY IF EXISTS prizes_authenticated_read ON public.prizes;

-- 4a. Anonymous visitors may only read prizes belonging to an ACTIVE campaign (never invokes public.is_staff)
CREATE POLICY prizes_anon_active_read
  ON public.prizes
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM public.campaigns c
      WHERE c.id = prizes.campaign_id
        AND c.status = 'ACTIVE'::public.campaign_status
    )
  );

-- 4b. Authenticated users may read prizes of ACTIVE campaigns, or all prizes if authorized staff
CREATE POLICY prizes_authenticated_read
  ON public.prizes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.campaigns c
      WHERE c.id = prizes.campaign_id
        AND c.status = 'ACTIVE'::public.campaign_status
    )
    OR public.is_staff(auth.uid())
  );

COMMIT;

-- ============================================================================
-- ROLLBACK SCRIPT (Reference Only — Do Not Execute Automatically)
-- ============================================================================
/*
BEGIN;

DROP POLICY IF EXISTS campaigns_anon_active_read ON public.campaigns;
DROP POLICY IF EXISTS campaigns_authenticated_read ON public.campaigns;
CREATE POLICY campaigns_public_read
  ON public.campaigns
  FOR SELECT
  USING ((status = 'ACTIVE'::public.campaign_status) OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS prizes_anon_active_read ON public.prizes;
DROP POLICY IF EXISTS prizes_authenticated_read ON public.prizes;
CREATE POLICY prizes_public_read
  ON public.prizes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.campaigns c
      WHERE c.id = prizes.campaign_id
        AND (c.status = 'ACTIVE'::public.campaign_status OR public.is_staff(auth.uid()))
    )
  );

REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;

COMMIT;
*/

