-- ============================================================================
-- PHASE 2B.2: DIRECT-WRITE RLS & PRIVILEGE HARDENING
-- ============================================================================
-- Purpose:
--   Eliminate direct PostgREST INSERT/UPDATE/DELETE bypasses for `authenticated`
--   users (including `is_staff()` callers with a mobile or browser JWT) on
--   sensitive operational, campaign, profile, and lucky draw tables.
--
--   All legitimate writes to these tables already execute exclusively through
--   server-side Next.js actions/routes using `service_role` and hardened
--   SECURITY DEFINER RPCs. This mirrors the Phase 10B hardening applied to
--   `public.draw_approvals`.
--
-- Preserves:
--   - Public read access on `campaigns` (ACTIVE) and `prizes` (for ACTIVE campaigns)
--   - Authenticated staff SELECT access on operational & draw tables
--   - Authenticated self-SELECT on `profiles`
--   - Phase B2 R4 anon revocation on `draws`, `draw_results`, `draw_randomness_evidence`
--   - Phase 10B First Prize dual authorization and `draw_approvals` protections
--   - `service_role` full access for authoritative server-side operations
-- ============================================================================

BEGIN;

-- 1. public.system_settings (prevent direct authenticated UPDATE on operational gates)
DROP POLICY IF EXISTS system_settings_staff_update ON public.system_settings;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.system_settings FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.system_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.system_settings TO service_role;

-- 2. public.campaigns (preserve public ACTIVE read without invoking is_staff for anon; block direct authenticated writes)
DROP POLICY IF EXISTS campaigns_staff_write ON public.campaigns;
DROP POLICY IF EXISTS campaigns_public_read ON public.campaigns;
DROP POLICY IF EXISTS campaigns_staff_read ON public.campaigns;
CREATE POLICY campaigns_public_read ON public.campaigns
  FOR SELECT TO anon, authenticated
  USING (status = 'ACTIVE');
CREATE POLICY campaigns_staff_read ON public.campaigns
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON TABLE public.campaigns FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.campaigns TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.campaigns TO service_role;

-- 3. public.prizes (preserve public ACTIVE campaign read without invoking is_staff for anon; block direct authenticated writes)
DROP POLICY IF EXISTS prizes_staff_write ON public.prizes;
DROP POLICY IF EXISTS prizes_public_read ON public.prizes;
DROP POLICY IF EXISTS prizes_staff_read ON public.prizes;
CREATE POLICY prizes_public_read ON public.prizes
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND c.status = 'ACTIVE'
    )
  );
CREATE POLICY prizes_staff_read ON public.prizes
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON TABLE public.prizes FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.prizes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.prizes TO service_role;

-- 4. public.profiles (preserve own/staff SELECT; block direct authenticated writes)
DROP POLICY IF EXISTS profiles_staff_write ON public.profiles;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO service_role;

-- 5. public.draws (preserve staff SELECT; keep anon revoked; block direct authenticated writes)
DROP POLICY IF EXISTS draws_staff_access ON public.draws;
DROP POLICY IF EXISTS draws_staff_read ON public.draws;
CREATE POLICY draws_staff_read ON public.draws
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON TABLE public.draws FROM public, anon, authenticated;
REVOKE SELECT ON TABLE public.draws FROM anon;
GRANT SELECT ON TABLE public.draws TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.draws TO service_role;

-- 6. public.draw_results (preserve staff SELECT; keep anon revoked; block direct authenticated writes)
DROP POLICY IF EXISTS results_staff_access ON public.draw_results;
DROP POLICY IF EXISTS results_staff_read ON public.draw_results;
CREATE POLICY results_staff_read ON public.draw_results
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON TABLE public.draw_results FROM public, anon, authenticated;
REVOKE SELECT ON TABLE public.draw_results FROM anon;
GRANT SELECT ON TABLE public.draw_results TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.draw_results TO service_role;

-- 7. public.draw_manual_exclusions (preserve staff SELECT; block direct authenticated writes)
DROP POLICY IF EXISTS exclusions_staff_access ON public.draw_manual_exclusions;
DROP POLICY IF EXISTS exclusions_staff_read ON public.draw_manual_exclusions;
CREATE POLICY exclusions_staff_read ON public.draw_manual_exclusions
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON TABLE public.draw_manual_exclusions FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.draw_manual_exclusions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.draw_manual_exclusions TO service_role;

-- 8. public.draw_eligibility_snapshots (preserve staff SELECT; block direct authenticated writes)
DROP POLICY IF EXISTS snapshots_staff_access ON public.draw_eligibility_snapshots;
DROP POLICY IF EXISTS snapshots_staff_read ON public.draw_eligibility_snapshots;
CREATE POLICY snapshots_staff_read ON public.draw_eligibility_snapshots
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON TABLE public.draw_eligibility_snapshots FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.draw_eligibility_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.draw_eligibility_snapshots TO service_role;

-- 9. public.draw_snapshot_tickets (preserve staff SELECT; block direct authenticated writes)
DROP POLICY IF EXISTS snapshot_tickets_staff_access ON public.draw_snapshot_tickets;
DROP POLICY IF EXISTS snapshot_tickets_staff_read ON public.draw_snapshot_tickets;
CREATE POLICY snapshot_tickets_staff_read ON public.draw_snapshot_tickets
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON TABLE public.draw_snapshot_tickets FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.draw_snapshot_tickets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.draw_snapshot_tickets TO service_role;

-- 10. public.draw_randomness_evidence (preserve staff SELECT; keep anon revoked; block direct authenticated writes)
DROP POLICY IF EXISTS evidence_staff_access ON public.draw_randomness_evidence;
DROP POLICY IF EXISTS evidence_staff_read ON public.draw_randomness_evidence;
CREATE POLICY evidence_staff_read ON public.draw_randomness_evidence
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON TABLE public.draw_randomness_evidence FROM public, anon, authenticated;
REVOKE SELECT ON TABLE public.draw_randomness_evidence FROM anon;
GRANT SELECT ON TABLE public.draw_randomness_evidence TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.draw_randomness_evidence TO service_role;

-- 11. REV-2C-08 Defense-in-Depth: drop dormant authenticated write policies on public.seller_messages
--     (Table-level INSERT/UPDATE/DELETE were already revoked in 202610300001; dropping policies prevents accidental reactivation)
DROP POLICY IF EXISTS seller_messages_staff_insert ON public.seller_messages;
DROP POLICY IF EXISTS seller_messages_seller_update ON public.seller_messages;
DROP POLICY IF EXISTS seller_messages_seller_insert ON public.seller_messages;
DROP POLICY IF EXISTS seller_messages_staff_update ON public.seller_messages;

COMMIT;
