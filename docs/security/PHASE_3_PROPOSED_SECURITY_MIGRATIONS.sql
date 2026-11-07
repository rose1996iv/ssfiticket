-- ============================================================================
-- SSFI LUCKY DRAW — PHASE 3: PROPOSED P0/P1 SECURITY MIGRATIONS
-- ============================================================================
-- STATUS: PROPOSED ONLY — DO NOT EXECUTE WITHOUT EXPLICIT PROJECT OWNER APPROVAL
-- TARGET ENVIRONMENT (WHEN APPROVED): Preview Supabase ONLY (jiyuiydzsfydjklosvvq)
-- PRODUCTION ENVIRONMENT (fohpqheglxhfdecadhzw): STRICTLY OFF-LIMITS
--
-- GUARANTEES:
--   1. Does NOT disable or drop any immutability or append-only triggers.
--   2. Does NOT grant EXECUTE on public.is_staff(uuid) to anon or public.
--   3. Enforces order-scoped SHA-256 capability tokens for customer payment access.
--   4. Sanitizes the 16 historical Preview order snapshots via an audited,
--      SUPER_ADMIN-only, Preview-locked SECURITY DEFINER RPC.
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: P0 — CUSTOMER PAYMENT PAGE AUTHORIZATION RPCs
-- ============================================================================

-- 1.1 Issue an order-scoped SHA-256 capability token at public order creation
CREATE OR REPLACE FUNCTION public.issue_customer_order_access_token(
  p_order_id uuid,
  p_token_hash text,
  p_expires_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders;
  v_token_id uuid;
  v_expires_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'access denied: service_role required';
  END IF;

  IF p_order_id IS NULL OR p_token_hash IS NULL OR char_length(trim(p_token_hash)) <> 64 THEN
    RAISE EXCEPTION 'invalid order_id or SHA-256 token_hash';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  IF v_order.status::text IN ('CANCELLED', 'REFUNDED', 'VOID') THEN
    RAISE EXCEPTION 'cannot issue access token for inactive order';
  END IF;

  v_expires_at := now() + ( greatest(1, least(coalesce(p_expires_days, 7), 30)) || ' days' )::interval;

  -- Revoke any prior active tokens scoped to this order
  UPDATE public.payment_recovery_tokens
  SET
    revoked_at = now(),
    updated_at = now()
  WHERE order_id = p_order_id
    AND revoked_at IS NULL
    AND expires_at > now();

  INSERT INTO public.payment_recovery_tokens (
    order_id,
    token_hash,
    created_by,
    expires_at
  ) VALUES (
    p_order_id,
    lower(trim(p_token_hash)),
    NULL,
    v_expires_at
  )
  RETURNING id INTO v_token_id;

  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    NULL,
    'ORDER_ACCESS_TOKEN_ISSUED',
    'order',
    p_order_id,
    jsonb_build_object(
      'token_id', v_token_id,
      'order_number', v_order.order_number,
      'expires_at', v_expires_at
    )
  );

  RETURN jsonb_build_object(
    'token_id', v_token_id,
    'order_id', p_order_id,
    'order_number', v_order.order_number,
    'expires_at', v_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_customer_order_access_token(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_customer_order_access_token(uuid, text, integer) TO service_role;


-- 1.2 Verify order-scoped capability token (strictly binds token_hash to p_order_id)
CREATE OR REPLACE FUNCTION public.verify_order_payment_access(
  p_order_id uuid,
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token public.payment_recovery_tokens;
  v_order public.orders;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'access denied: service_role required';
  END IF;

  IF p_order_id IS NULL OR p_token_hash IS NULL OR char_length(trim(p_token_hash)) <> 64 THEN
    RETURN jsonb_build_object('authorized', false, 'code', 'UNAUTHORIZED');
  END IF;

  -- Strictly match BOTH order_id and token_hash to prevent cross-order token reuse
  SELECT * INTO v_token
  FROM public.payment_recovery_tokens
  WHERE order_id = p_order_id
    AND token_hash = lower(trim(p_token_hash))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('authorized', false, 'code', 'UNAUTHORIZED');
  END IF;

  IF v_token.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('authorized', false, 'code', 'TOKEN_REVOKED');
  END IF;

  IF v_token.expires_at <= now() THEN
    RETURN jsonb_build_object('authorized', false, 'code', 'TOKEN_EXPIRED');
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('authorized', false, 'code', 'UNAUTHORIZED');
  END IF;

  IF v_order.status::text IN ('CANCELLED', 'REFUNDED', 'VOID') THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'code', 'ORDER_INACTIVE',
      'order_status', v_order.status::text
    );
  END IF;

  RETURN jsonb_build_object(
    'authorized', true,
    'code', 'AUTHORIZED',
    'token_id', v_token.id,
    'order_id', v_order.id,
    'order_status', v_order.status::text,
    'expires_at', v_token.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_order_payment_access(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_order_payment_access(uuid, text) TO service_role;


-- ============================================================================
-- SECTION 2: P0 — TRIGGER-PRESERVING HISTORICAL SNAPSHOT SANITIZATION (PREVIEW)
-- ============================================================================

-- 2.1 Upgrade protect_order_payment_snapshot() WITHOUT ever disabling the trigger.
--     Normal updates to captured snapshots remain strictly blocked.
--     Only a transaction-local GUC set inside admin_sanitize_preview_historical_order_snapshots
--     can transition a non-synthetic historical UPI snapshot to a 'preview.*@upi' synthetic value,
--     while keeping snapshot_seller_id, snapshot_seller_code, and snapshot_captured_at immutable.
CREATE OR REPLACE FUNCTION public.protect_order_payment_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allow_preview_sanitization boolean;
BEGIN
  IF OLD.snapshot_captured_at IS NOT NULL THEN
    v_allow_preview_sanitization :=
      coalesce(current_setting('ssfi.allow_preview_snapshot_sanitization', true), '') = 'true';

    IF v_allow_preview_sanitization
       AND OLD.snapshot_upi_id IS NOT NULL
       AND OLD.snapshot_upi_id NOT LIKE 'preview.%@upi'
       AND NEW.snapshot_upi_id IS NOT NULL
       AND NEW.snapshot_upi_id LIKE 'preview.%@upi'
       AND NEW.snapshot_seller_id IS NOT DISTINCT FROM OLD.snapshot_seller_id
       AND NEW.snapshot_seller_code IS NOT DISTINCT FROM OLD.snapshot_seller_code
       AND NEW.snapshot_seller_display_name IS NOT DISTINCT FROM OLD.snapshot_seller_display_name
       AND NEW.snapshot_captured_at IS NOT DISTINCT FROM OLD.snapshot_captured_at THEN
      RETURN NEW;
    END IF;

    IF NEW.snapshot_seller_id IS DISTINCT FROM OLD.snapshot_seller_id
       OR NEW.snapshot_seller_code IS DISTINCT FROM OLD.snapshot_seller_code
       OR NEW.snapshot_seller_display_name IS DISTINCT FROM OLD.snapshot_seller_display_name
       OR NEW.snapshot_qr_storage_path IS DISTINCT FROM OLD.snapshot_qr_storage_path
       OR NEW.snapshot_upi_id IS DISTINCT FROM OLD.snapshot_upi_id
       OR NEW.snapshot_account_name IS DISTINCT FROM OLD.snapshot_account_name
       OR NEW.snapshot_payment_instructions IS DISTINCT FROM OLD.snapshot_payment_instructions
       OR NEW.snapshot_captured_at IS DISTINCT FROM OLD.snapshot_captured_at THEN
      RAISE EXCEPTION 'Order payment destination snapshot is immutable and cannot be modified.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


-- 2.2 Audited, SUPER_ADMIN-only, Preview-locked RPC to sanitize the 16 historical order snapshots
CREATE OR REPLACE FUNCTION public.admin_sanitize_preview_historical_order_snapshots(
  p_actor uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_preview boolean;
  v_rec record;
  v_masked_old_upi text;
  v_masked_old_acct text;
  v_new_upi text;
  v_new_acct text;
  v_new_qr_path text;
  v_new_instructions text;
  v_sanitized_count integer := 0;
BEGIN
  -- 1. Caller & Role Guard: Must be service_role and verified SUPER_ADMIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'access denied: service_role required';
  END IF;

  IF p_actor IS NULL OR NOT public.has_role(p_actor, 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'SUPER_ADMIN role required to execute historical snapshot sanitization';
  END IF;

  IF p_reason IS NULL OR char_length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'A detailed audit reason (at least 10 characters) is required';
  END IF;

  -- 2. Preview Environment Guard: Refuse execution unless Preview mirror metadata exists
  SELECT EXISTS (
    SELECT 1
    FROM public.system_settings
    WHERE key = 'preview_data_mirror_metadata'
      AND (value->>'target_project_ref') = 'jiyuiydzsfydjklosvvq'
  ) INTO v_is_preview;

  IF NOT coalesce(v_is_preview, false) THEN
    RAISE EXCEPTION 'environment guard blocked execution: not a verified Preview mirror database';
  END IF;

  -- 3. Enable transaction-local sanitization gate for protect_order_payment_snapshot()
  PERFORM set_config('ssfi.allow_preview_snapshot_sanitization', 'true', true);

  -- 4. Iterate over unsanitized historical orders and replace destination fields with seller synthetic values
  FOR v_rec IN
    SELECT
      o.id,
      o.order_number,
      o.seller_id,
      o.snapshot_seller_id,
      o.snapshot_seller_code,
      o.snapshot_upi_id,
      o.snapshot_account_name,
      o.snapshot_qr_storage_path,
      s.seller_code AS active_seller_code,
      s.upi_id AS seller_synthetic_upi,
      s.account_name AS seller_synthetic_account,
      s.qr_storage_path AS seller_synthetic_qr_path
    FROM public.orders o
    LEFT JOIN public.sellers s ON s.id = coalesce(o.snapshot_seller_id, o.seller_id)
    WHERE o.snapshot_captured_at IS NOT NULL
      AND o.snapshot_upi_id IS NOT NULL
      AND o.snapshot_upi_id NOT LIKE 'preview.%@upi'
    ORDER BY o.created_at ASC
    FOR UPDATE OF o
  LOOP
    -- Mask old values for safe audit logging (never store unmasked historical UPI in new audit metadata)
    v_masked_old_upi :=
      left(split_part(v_rec.snapshot_upi_id, '@', 1), 4)
      || '******@'
      || split_part(v_rec.snapshot_upi_id, '@', 2);
    v_masked_old_acct := left(coalesce(v_rec.snapshot_account_name, ''), 3) || '***';

    v_new_upi := coalesce(
      v_rec.seller_synthetic_upi,
      'preview.' || lower(replace(coalesce(v_rec.snapshot_seller_code, 'seller007'), '-', '')) || '@upi'
    );
    v_new_acct := coalesce(
      v_rec.seller_synthetic_account,
      '[PREVIEW TEST] ' || coalesce(v_rec.snapshot_seller_code, 'SELLER-007') || ' Account'
    );
    v_new_qr_path := coalesce(
      v_rec.seller_synthetic_qr_path,
      'seller-edebd069-4bea-4f69-8afd-f34743def4ab/preview-synthetic-qr-seller007.png'
    );
    v_new_instructions :=
      'PREVIEW TEST ONLY — Do not transfer real funds. Synthetic UPI: ' || v_new_upi;

    UPDATE public.orders
    SET
      snapshot_upi_id = v_new_upi,
      snapshot_account_name = v_new_acct,
      snapshot_qr_storage_path = v_new_qr_path,
      snapshot_payment_instructions = v_new_instructions,
      updated_at = now()
    WHERE id = v_rec.id;

    INSERT INTO public.audit_logs (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      metadata
    ) VALUES (
      p_actor,
      'PREVIEW_HISTORICAL_SNAPSHOT_SANITIZED',
      'order',
      v_rec.id,
      jsonb_build_object(
        'order_number', v_rec.order_number,
        'seller_code', coalesce(v_rec.snapshot_seller_code, v_rec.active_seller_code),
        'previous_upi_masked', v_masked_old_upi,
        'previous_account_masked', v_masked_old_acct,
        'previous_qr_storage_path', v_rec.snapshot_qr_storage_path,
        'new_upi_id', v_new_upi,
        'new_account_name', v_new_acct,
        'new_qr_storage_path', v_new_qr_path,
        'reason', trim(p_reason)
      )
    );

    v_sanitized_count := v_sanitized_count + 1;
  END LOOP;

  -- 5. Reset transaction-local sanitization gate immediately
  PERFORM set_config('ssfi.allow_preview_snapshot_sanitization', 'false', true);

  RETURN jsonb_build_object(
    'success', true,
    'sanitized_orders_count', v_sanitized_count,
    'actor_id', p_actor,
    'executed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_sanitize_preview_historical_order_snapshots(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_sanitize_preview_historical_order_snapshots(uuid, text) TO service_role;


-- ============================================================================
-- SECTION 3: P1 — LEAST-PRIVILEGE RLS POLICIES FOR CAMPAIGNS & PRIZES
-- ============================================================================

-- 3.1 Preserve strict is_staff(uuid) execution boundary (NEVER grant to anon or PUBLIC)
REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;

-- 3.2 Grant table-level SELECT on campaigns and prizes to anon and authenticated
--     (Row visibility is strictly governed by the RLS policies below)
GRANT SELECT ON TABLE public.campaigns TO anon, authenticated;
GRANT SELECT ON TABLE public.prizes TO anon, authenticated;

-- 3.3 Replace campaigns_public_read with separate anon and authenticated policies
DROP POLICY IF EXISTS "campaigns_public_read" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_anon_active_read" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_authenticated_read" ON public.campaigns;

CREATE POLICY "campaigns_anon_active_read"
  ON public.campaigns
  FOR SELECT
  TO anon
  USING (status = 'ACTIVE'::public.campaign_status);

CREATE POLICY "campaigns_authenticated_read"
  ON public.campaigns
  FOR SELECT
  TO authenticated
  USING (
    status = 'ACTIVE'::public.campaign_status
    OR public.is_staff(auth.uid())
  );

-- 3.4 Replace prizes_public_read with separate anon and authenticated policies
DROP POLICY IF EXISTS "prizes_public_read" ON public.prizes;
DROP POLICY IF EXISTS "prizes_anon_active_read" ON public.prizes;
DROP POLICY IF EXISTS "prizes_authenticated_read" ON public.prizes;

CREATE POLICY "prizes_anon_active_read"
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

CREATE POLICY "prizes_authenticated_read"
  ON public.prizes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.campaigns c
      WHERE c.id = prizes.campaign_id
        AND (
          c.status = 'ACTIVE'::public.campaign_status
          OR public.is_staff(auth.uid())
        )
    )
  );

COMMIT;


-- ============================================================================
-- SECTION 4: COMPANION ROLLBACK PROCEDURE (REFERENCE ONLY — DO NOT AUTO-RUN)
-- ============================================================================
/*
BEGIN;

DROP FUNCTION IF EXISTS public.admin_sanitize_preview_historical_order_snapshots(uuid, text);
DROP FUNCTION IF EXISTS public.verify_order_payment_access(uuid, text);
DROP FUNCTION IF EXISTS public.issue_customer_order_access_token(uuid, text, integer);

CREATE OR REPLACE FUNCTION public.protect_order_payment_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.snapshot_captured_at IS NOT NULL THEN
    IF NEW.snapshot_seller_id IS DISTINCT FROM OLD.snapshot_seller_id
       OR NEW.snapshot_seller_code IS DISTINCT FROM OLD.snapshot_seller_code
       OR NEW.snapshot_seller_display_name IS DISTINCT FROM OLD.snapshot_seller_display_name
       OR NEW.snapshot_qr_storage_path IS DISTINCT FROM OLD.snapshot_qr_storage_path
       OR NEW.snapshot_upi_id IS DISTINCT FROM OLD.snapshot_upi_id
       OR NEW.snapshot_account_name IS DISTINCT FROM OLD.snapshot_account_name
       OR NEW.snapshot_payment_instructions IS DISTINCT FROM OLD.snapshot_payment_instructions
       OR NEW.snapshot_captured_at IS DISTINCT FROM OLD.snapshot_captured_at THEN
      RAISE EXCEPTION 'Order payment destination snapshot is immutable and cannot be modified.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "campaigns_anon_active_read" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_authenticated_read" ON public.campaigns;
CREATE POLICY "campaigns_public_read" ON public.campaigns
  FOR SELECT USING ((status = 'ACTIVE'::public.campaign_status) OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "prizes_anon_active_read" ON public.prizes;
DROP POLICY IF EXISTS "prizes_authenticated_read" ON public.prizes;
CREATE POLICY "prizes_public_read" ON public.prizes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = prizes.campaign_id
        AND (c.status = 'ACTIVE'::public.campaign_status OR public.is_staff(auth.uid()))
    )
  );

COMMIT;
*/

