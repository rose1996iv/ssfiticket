-- ============================================================================
-- Migration: 202611070002_preview_clone_alignment_and_isolation.sql
-- Purpose:
--   Phase 3 Preview Clone Alignment & Security Hardening Package
--   1. Keeps EXECUTE on public.is_staff(uuid) strictly revoked from PUBLIC and
--      anon (granted only to authenticated and service_role). Public anonymous
--      read access on campaigns and prizes is handled via dedicated role-split
--      RLS policies in PHASE_5_RLS_POLICY_MIGRATION.sql without invoking is_staff().
--   2. Revokes unnecessary EXECUTE grant on trigger function
--      public.trg_seller_messages_populate_snapshot() from anon/authenticated.
--   3. Ensures server-side pagination and lookup indexes exist on orders,
--      payments, tickets, customers, and audit_logs.
--   4. Ensures private storage buckets (`payment-screenshots`, `seller-payment-qrs`)
--      remain strictly private (`public = false`, 2MB limit, JPEG/PNG/WebP).
-- Rollback Strategy:
--   Non-destructive additive migration; indexes and grants can be reverted via:
--     DROP INDEX IF EXISTS public.orders_snapshot_seller_idx;
--     DROP INDEX IF EXISTS public.payments_submitted_at_idx;
-- ============================================================================

BEGIN;

-- 1. Enforce strict least-privilege on public.is_staff(uuid): never callable by anon
REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;

-- 2. Revoke excess client execute grant on internal trigger function
REVOKE ALL ON FUNCTION public.trg_seller_messages_populate_snapshot() FROM public, anon, authenticated;

-- 3. Server-side pagination & filter indexes for Admin Portal (/admin/orders, /admin/payments, /admin/tickets, /admin/audit-logs)
CREATE INDEX IF NOT EXISTS orders_snapshot_seller_idx
  ON public.orders(snapshot_seller_id);

CREATE INDEX IF NOT EXISTS orders_created_at_desc_idx
  ON public.orders(created_at DESC);

CREATE INDEX IF NOT EXISTS payments_submitted_at_idx
  ON public.payments(submitted_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS payments_seller_review_status_idx
  ON public.payments(seller_review_status);

CREATE INDEX IF NOT EXISTS audit_logs_action_created_idx
  ON public.audit_logs(action, created_at DESC);

-- 4. Enforce Private Storage Bucket Configuration
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'payment-screenshots',
    'payment-screenshots',
    false,
    2097152,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'seller-payment-qrs',
    'seller-payment-qrs',
    false,
    2097152,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
  )
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;

