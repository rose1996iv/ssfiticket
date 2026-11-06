-- ==============================================================================
-- SCRIPT 01: APPLY MISSING MIGRATION & ESTABLISH MIGRATION TRACKING
-- Target Environment: Supabase Preview (jiyuiydzsfydjklosvvq) ONLY
-- NEVER execute against Production (fohpqheglxhfdecadhzw)
-- ==============================================================================

BEGIN;

-- 1. Apply Migration 202611011200_payment_screenshots.sql
CREATE TABLE IF NOT EXISTS public.payment_screenshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id) ON DELETE RESTRICT,
  storage_path text NOT NULL UNIQUE CHECK (storage_path ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$'),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  file_size_bytes integer NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 2097152),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_screenshots_uploaded_at_idx ON public.payment_screenshots(uploaded_at DESC);
ALTER TABLE public.payment_screenshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.payment_screenshots FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_screenshots TO service_role;

-- 2. Configure Storage Bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-screenshots',
  'payment-screenshots',
  false,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- 3. Create Storage Metrics Function
CREATE OR REPLACE FUNCTION public.get_payment_screenshot_storage_metrics(p_actor uuid)
RETURNS TABLE (
  object_count bigint,
  total_bytes bigint,
  average_bytes numeric,
  uploads_last_7_days bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_actor IS NULL OR NOT public.is_staff(p_actor) THEN
    RAISE EXCEPTION 'administrator role required';
  END IF;

  RETURN QUERY
  SELECT
    count(*)::bigint,
    coalesce(sum(file_size_bytes), 0)::bigint,
    coalesce(avg(file_size_bytes), 0),
    count(*) FILTER (WHERE uploaded_at >= now() - interval '7 days')::bigint
  FROM public.payment_screenshots;
END;
$$;

REVOKE ALL ON FUNCTION public.get_payment_screenshot_storage_metrics(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_payment_screenshot_storage_metrics(uuid) TO service_role;

-- 4. Create and Seed Migration Tracking Schema
CREATE SCHEMA IF NOT EXISTS supabase_migrations;

CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text
);

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('202610270001', 'phase2_core'),
  ('202610270002', 'phase3_operations'),
  ('202610280001', 'phase4_seller_referrals'),
  ('202610290001', 'phase5_campaign_schedule'),
  ('202610290002', 'phase6_seller_messages'),
  ('202610290003', 'phase7_campaign_auto_scheduler'),
  ('202610290004', 'phase8_ticket_lifecycle_and_delivery'),
  ('202610290005', 'audit_logs_service_role_permission'),
  ('202610290006', 'fix_status_transition_triggers'),
  ('202610290007', 'bidirectional_seller_messages'),
  ('202610300001', 'p0_security_remediation'),
  ('202611010001', 'customer_email_outbox'),
  ('202611011000', 'seller_messages_preserve_on_delete'),
  ('202611011100', 'payment_recovery_tokens'),
  ('202611011200', 'payment_screenshots')
ON CONFLICT (version) DO NOTHING;

COMMIT;

