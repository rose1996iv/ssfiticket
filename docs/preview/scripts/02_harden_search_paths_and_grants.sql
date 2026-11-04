-- ==============================================================================
-- SCRIPT 02: P0 SEARCH_PATH HARDENING & PRIVILEGE REFINEMENT
-- Target Environment: Supabase Preview (jiyuiydzsfydjklosvvq) ONLY
-- NEVER execute against Production (fohpqheglxhfdecadhzw)
-- ==============================================================================

BEGIN;

-- 1. Hardening search_path to empty string for routines identified with search_path=public
ALTER FUNCTION public.admin_reissue_ticket(uuid, uuid, text) SET search_path = '';
ALTER FUNCTION public.admin_void_ticket(uuid, uuid, text) SET search_path = '';
ALTER FUNCTION public.create_payment_recovery_link(uuid, text, uuid, integer) SET search_path = '';
ALTER FUNCTION public.current_seller_id() SET search_path = '';
ALTER FUNCTION public.evaluate_campaign_schedules() SET search_path = '';
ALTER FUNCTION public.get_active_seller_by_code(text) SET search_path = '';
ALTER FUNCTION public.get_campaign_scheduler_status() SET search_path = '';
ALTER FUNCTION public.handle_new_user() SET search_path = '';
ALTER FUNCTION public.issue_tickets(uuid) SET search_path = '';
ALTER FUNCTION public.lookup_payment_recovery_token(text) SET search_path = '';
ALTER FUNCTION public.owns_customer(uuid) SET search_path = '';
ALTER FUNCTION public.process_scheduled_campaign_transitions() SET search_path = '';
ALTER FUNCTION public.record_payment_event() SET search_path = '';
ALTER FUNCTION public.revoke_payment_recovery_link(uuid, uuid) SET search_path = '';
ALTER FUNCTION public.seller_owns_customer(uuid) SET search_path = '';
ALTER FUNCTION public.submit_manual_upi(uuid, text, text) SET search_path = '';
ALTER FUNCTION public.submit_payment_details_completion(uuid, text, text, text, text, text) SET search_path = '';

-- 2. Revoke unnecessary trigger function execution from anon and authenticated
REVOKE EXECUTE ON FUNCTION public.trg_seller_messages_populate_snapshot() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_seller_messages_populate_snapshot() TO service_role;

COMMIT;

