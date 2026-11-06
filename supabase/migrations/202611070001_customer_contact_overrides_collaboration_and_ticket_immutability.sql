-- ============================================================================
-- Migration: 202611070001_customer_contact_overrides_collaboration_and_ticket_immutability.sql
-- Description:
--   1. Adds ticket-scoped contact override fields on public.tickets so Admin can
--      perform either a Master Customer Profile Update or a Single-Ticket Contact
--      Update without altering other tickets belonging to the same customer.
--   2. Enforces strict database-level immutability on ticket identity fields
--      (id, ticket_number, order_id, campaign_id, customer_id, seller_id, issued_at).
--   3. Enforces strict append-only immutability on public.audit_logs (blocking
--      UPDATE and DELETE even for privileged roles) and indexes entity timelines.
--   4. Creates public.order_collaboration_notes for order-specific Admin-Seller
--      collaboration with strict visibility scopes (ADMIN_ONLY, SELLER_AND_ADMIN,
--      CUSTOMER_VISIBLE) and RLS enforcement.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TICKET-SCOPED CONTACT OVERRIDE FIELDS (PHASE 3)
-- ============================================================================

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS contact_full_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_whatsapp text,
  ADD COLUMN IF NOT EXISTS contact_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS contact_updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_update_reason text;

GRANT SELECT, UPDATE (
  contact_full_name,
  contact_email,
  contact_whatsapp,
  contact_updated_at,
  contact_updated_by,
  contact_update_reason,
  updated_at
) ON public.tickets TO service_role;

GRANT SELECT, UPDATE (
  full_name,
  email,
  whatsapp_number,
  phone,
  updated_at
) ON public.customers TO service_role;

-- ============================================================================
-- 2. TICKET IDENTITY IMMUTABILITY TRIGGER (PHASE 7)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_ticket_identity_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.ticket_number IS DISTINCT FROM OLD.ticket_number
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
  THEN
    RAISE EXCEPTION 'Ticket identity fields (id, ticket_number, order_id, campaign_id, customer_id, seller_id, issued_at) are strictly immutable once issued.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_ticket_identity_immutability ON public.tickets;
CREATE TRIGGER trg_protect_ticket_identity_immutability
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_ticket_identity_immutability();

-- ============================================================================
-- 3. APPEND-ONLY AUDIT TIMELINE PROTECTION & INDEXING (PHASE 5)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_audit_logs_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is strictly append-only; UPDATE and DELETE operations are prohibited.'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_audit_logs_append_only ON public.audit_logs;
CREATE TRIGGER trg_protect_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_audit_logs_append_only();

REVOKE UPDATE, DELETE ON public.audit_logs FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.audit_logs TO service_role;

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
  ON public.audit_logs(entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
  ON public.audit_logs(created_at DESC);

-- ============================================================================
-- 4. ORDER-SPECIFIC ADMIN-SELLER COLLABORATION TABLE (PHASE 6)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.order_collaboration_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  author_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  author_role text NOT NULL CHECK (author_role IN ('SUPER_ADMIN', 'ADMIN', 'FUNDRAISING_MANAGER', 'SELLER')),
  note_type text NOT NULL CHECK (
    note_type IN (
      'SELLER_REVIEW_NOTE',
      'SELLER_RECOMMENDATION',
      'ADMIN_INSTRUCTION',
      'CLARIFICATION_REQUEST',
      'SELLER_RESPONSE',
      'SUPPORTING_EVIDENCE',
      'ISSUE_RESOLVED',
      'CUSTOMER_NOTICE'
    )
  ),
  visibility text NOT NULL CHECK (
    visibility IN ('ADMIN_ONLY', 'SELLER_AND_ADMIN', 'CUSTOMER_VISIBLE')
  ),
  body text NOT NULL CHECK (char_length(trim(body)) >= 2 AND char_length(body) <= 2000),
  evidence_reference text CHECK (evidence_reference IS NULL OR char_length(evidence_reference) <= 500),
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_collab_seller_visibility_guard CHECK (
    NOT (author_role = 'SELLER' AND visibility = 'ADMIN_ONLY')
  )
);

CREATE INDEX IF NOT EXISTS order_collaboration_notes_order_idx
  ON public.order_collaboration_notes(order_id, created_at ASC);

DROP TRIGGER IF EXISTS order_collaboration_notes_updated ON public.order_collaboration_notes;
CREATE TRIGGER order_collaboration_notes_updated
  BEFORE UPDATE ON public.order_collaboration_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.order_collaboration_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.order_collaboration_notes FROM public, anon, authenticated;
GRANT SELECT ON public.order_collaboration_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.order_collaboration_notes TO service_role;

DROP POLICY IF EXISTS order_collab_staff_select ON public.order_collaboration_notes;
CREATE POLICY order_collab_staff_select
  ON public.order_collaboration_notes
  FOR SELECT
  TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS order_collab_seller_select ON public.order_collaboration_notes;
CREATE POLICY order_collab_seller_select
  ON public.order_collaboration_notes
  FOR SELECT
  TO authenticated
  USING (
    visibility IN ('SELLER_AND_ADMIN', 'CUSTOMER_VISIBLE')
    AND EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_collaboration_notes.order_id
        AND (
          o.seller_id = public.current_seller_id()
          OR o.snapshot_seller_id = public.current_seller_id()
        )
    )
  );

COMMIT;

