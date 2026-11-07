-- ============================================================================
-- SSFI Lucky Draw — Phase 5 Revised Security Remediation Migrations
-- File: docs/security/PHASE_5_REVISED_SECURITY_MIGRATIONS.sql
-- Target Environment: Preview Supabase (jiyuiydzsfydjklosvvq) — DO NOT EXECUTE WITHOUT OWNER APPROVAL
-- Companion File: docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql
--
-- Resolves Phase 4 Audit Findings:
--   - SEC-04 / SQL-03: Separate 'READ', 'WRITE', and 'CONSUME_WRITE' token
--     verification modes so payment submission consumes write capability
--     (`used_at = now()`) while preserving customer read access to order status.
--   - SEC-05 / SQL-01: Hardens `public.protect_order_payment_snapshot()` so the
--     trigger itself validates Preview environment identity, the explicit
--     16-order allowlist (`ORD-2026-000031`..`ORD-2026-000046`), synthetic
--     Preview UPI format (`^preview\.[a-z0-9_]+@upi$`), and caller context,
--     without ever disabling the trigger.
--   - SEC-06 / SQL-02: Enforces the explicit 16-order allowlist, SUPER_ADMIN
--     role verification, transactional redacted audit logging, and exact row
--     count assertion (`v_sanitized_count IN (0, 16)`) in
--     `public.admin_sanitize_preview_historical_order_snapshots`.
--   - SQL-04: Complete rollback script including function privilege revocations.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: CUSTOMER ORDER ACCESS TOKEN ARCHITECTURE (P0-1 / SEC-04 / SQL-03)
-- ============================================================================

-- 1A. Issue a new SHA-256 hashed access token for an order and revoke prior active tokens
CREATE OR REPLACE FUNCTION public.issue_customer_order_access_token(
  p_order_id uuid,
  p_token_hash text,
  p_expires_in_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_hash text;
  v_days integer;
  v_order_number text;
  v_order_status public.order_status;
  v_token_id uuid;
  v_expires_at timestamptz;
  v_revoked_count integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'access denied: service_role required' USING ERRCODE = '42501';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'p_order_id is required' USING ERRCODE = '22023';
  END IF;

  v_clean_hash := lower(trim(coalesce(p_token_hash, '')));
  IF length(v_clean_hash) <> 64 OR v_clean_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'p_token_hash must be a valid 64-character lowercase hexadecimal SHA-256 digest'
      USING ERRCODE = '22023';
  END IF;

  v_days := GREATEST(1, LEAST(coalesce(p_expires_in_days, 7), 30));

  SELECT o.order_number, o.status
    INTO v_order_number, v_order_status
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id USING ERRCODE = 'P0002';
  END IF;

  IF v_order_status::text IN ('CANCELLED', 'REFUNDED', 'VOID') THEN
    RAISE EXCEPTION 'Cannot issue access token for inactive order %', v_order_number
      USING ERRCODE = 'P0001';
  END IF;

  -- Revoke all prior active tokens for this order
  UPDATE public.payment_recovery_tokens
     SET revoked_at = now(),
         updated_at = now()
   WHERE order_id = p_order_id
     AND revoked_at IS NULL;
  GET DIAGNOSTICS v_revoked_count = ROW_COUNT;

  v_expires_at := now() + make_interval(days => v_days);

  INSERT INTO public.payment_recovery_tokens (
    order_id,
    token_hash,
    created_by,
    expires_at
  )
  VALUES (
    p_order_id,
    v_clean_hash,
    NULL,
    v_expires_at
  )
  RETURNING id INTO v_token_id;

  -- Audit log records token_id only (never raw token or token_hash)
  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    NULL,
    'ORDER_ACCESS_TOKEN_ISSUED',
    'orders',
    p_order_id,
    jsonb_build_object(
      'token_id', v_token_id,
      'order_number', v_order_number,
      'expires_at', v_expires_at,
      'revoked_prior_tokens', v_revoked_count
    )
  );

  RETURN jsonb_build_object(
    'token_id', v_token_id,
    'order_id', p_order_id,
    'order_number', v_order_number,
    'order_status', v_order_status,
    'expires_at', v_expires_at,
    'revoked_prior_tokens', v_revoked_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_customer_order_access_token(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_customer_order_access_token(uuid, text, integer) TO service_role;


-- 1B. Verify order payment access with explicit READ / WRITE / CONSUME_WRITE mode separation
DROP FUNCTION IF EXISTS public.verify_order_payment_access(uuid, text);
DROP FUNCTION IF EXISTS public.verify_order_payment_access(uuid, text, text);

CREATE OR REPLACE FUNCTION public.verify_order_payment_access(
  p_order_id uuid,
  p_token_hash text,
  p_access_mode text DEFAULT 'READ'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_hash text;
  v_mode text;
  v_token record;
  v_consumed_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'access denied: service_role required' USING ERRCODE = '42501';
  END IF;

  v_mode := upper(trim(coalesce(p_access_mode, 'READ')));
  IF v_mode NOT IN ('READ', 'WRITE', 'CONSUME_WRITE') THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'code', 'INVALID_ACCESS_MODE'
    );
  END IF;

  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'code', 'MISSING_ORDER_ID'
    );
  END IF;

  v_clean_hash := lower(trim(coalesce(p_token_hash, '')));
  IF length(v_clean_hash) <> 64 OR v_clean_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'code', 'INVALID_TOKEN_HASH'
    );
  END IF;

  SELECT
    prt.id AS token_id,
    prt.order_id,
    prt.expires_at,
    prt.used_at,
    prt.revoked_at,
    o.status AS order_status,
    o.order_number
  INTO v_token
  FROM public.payment_recovery_tokens prt
  JOIN public.orders o ON o.id = prt.order_id
  WHERE prt.order_id = p_order_id
    AND prt.token_hash = v_clean_hash
  ORDER BY prt.created_at DESC
  LIMIT 1
  FOR UPDATE OF prt;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'code', 'UNAUTHORIZED'
    );
  END IF;

  IF v_token.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'code', 'TOKEN_REVOKED'
    );
  END IF;

  IF v_token.expires_at <= now() THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'code', 'TOKEN_EXPIRED'
    );
  END IF;

  IF v_token.order_status::text IN ('CANCELLED', 'REFUNDED', 'VOID') THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'code', 'ORDER_INACTIVE',
      'order_status', v_token.order_status
    );
  END IF;

  -- Mode 1: READ (Customer viewing /buy/order/[orderId] status, payment receipt status, or issued tickets)
  IF v_mode = 'READ' THEN
    RETURN jsonb_build_object(
      'authorized', true,
      'code', 'AUTHORIZED_READ',
      'access_mode', 'READ',
      'token_id', v_token.token_id,
      'order_id', v_token.order_id,
      'order_number', v_token.order_number,
      'order_status', v_token.order_status,
      'expires_at', v_token.expires_at,
      'write_consumed_at', v_token.used_at
    );
  END IF;

  -- Mode 2 & 3: WRITE / CONSUME_WRITE (Uploading screenshot or submitting UTR)
  IF v_token.used_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'code', 'TOKEN_WRITE_ALREADY_CONSUMED',
      'order_status', v_token.order_status,
      'write_consumed_at', v_token.used_at
    );
  END IF;

  IF v_token.order_status <> 'PENDING_PAYMENT'::public.order_status THEN
    RETURN jsonb_build_object(
      'authorized', false,
      'code', 'ORDER_NOT_EDITABLE',
      'order_status', v_token.order_status
    );
  END IF;

  IF v_mode = 'CONSUME_WRITE' THEN
    v_consumed_at := now();
    UPDATE public.payment_recovery_tokens
       SET used_at = v_consumed_at,
           updated_at = v_consumed_at
     WHERE id = v_token.token_id;

    RETURN jsonb_build_object(
      'authorized', true,
      'code', 'AUTHORIZED_WRITE_CONSUMED',
      'access_mode', 'CONSUME_WRITE',
      'token_id', v_token.token_id,
      'order_id', v_token.order_id,
      'order_number', v_token.order_number,
      'order_status', v_token.order_status,
      'expires_at', v_token.expires_at,
      'write_consumed_at', v_consumed_at
    );
  END IF;

  -- Mode 'WRITE' (pre-submission screenshot upload while order is PENDING_PAYMENT)
  RETURN jsonb_build_object(
    'authorized', true,
    'code', 'AUTHORIZED_WRITE',
    'access_mode', 'WRITE',
    'token_id', v_token.token_id,
    'order_id', v_token.order_id,
    'order_number', v_token.order_number,
    'order_status', v_token.order_status,
    'expires_at', v_token.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_order_payment_access(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_order_payment_access(uuid, text, text) TO service_role;


-- ============================================================================
-- PART 2: HARDENED HISTORICAL ORDER SNAPSHOT SANITIZATION (SEC-05 & SEC-06)
-- ============================================================================

-- 2A. Hardened trigger function `public.protect_order_payment_snapshot()`
--     Never disabled; validates Preview environment identity, explicit 16-order
--     allowlist, synthetic UPI format, and immutable identity columns inside the trigger.
CREATE OR REPLACE FUNCTION public.protect_order_payment_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed_orders constant text[] := ARRAY[
    'ORD-2026-000031', 'ORD-2026-000032', 'ORD-2026-000033', 'ORD-2026-000034',
    'ORD-2026-000035', 'ORD-2026-000036', 'ORD-2026-000037', 'ORD-2026-000038',
    'ORD-2026-000039', 'ORD-2026-000040', 'ORD-2026-000041', 'ORD-2026-000042',
    'ORD-2026-000043', 'ORD-2026-000044', 'ORD-2026-000045', 'ORD-2026-000046'
  ];
  v_preview_target_ref text;
BEGIN
  IF OLD.snapshot_captured_at IS NOT NULL THEN
    IF OLD.snapshot_seller_id IS DISTINCT FROM NEW.snapshot_seller_id
       OR OLD.snapshot_seller_code IS DISTINCT FROM NEW.snapshot_seller_code
       OR OLD.snapshot_seller_display_name IS DISTINCT FROM NEW.snapshot_seller_display_name
       OR OLD.snapshot_qr_storage_path IS DISTINCT FROM NEW.snapshot_qr_storage_path
       OR OLD.snapshot_upi_id IS DISTINCT FROM NEW.snapshot_upi_id
       OR OLD.snapshot_account_name IS DISTINCT FROM NEW.snapshot_account_name
       OR OLD.snapshot_payment_instructions IS DISTINCT FROM NEW.snapshot_payment_instructions
       OR OLD.snapshot_captured_at IS DISTINCT FROM NEW.snapshot_captured_at
    THEN
      -- Narrowly scoped, multi-factor verified exception for the 16 historical Preview orders ONLY:
      IF current_setting('ssfi.allow_preview_snapshot_sanitization', true) = 'true'
         AND current_setting('ssfi.sanitization_caller', true) = 'admin_sanitize_preview_historical_order_snapshots'
         AND coalesce(current_setting('app.settings.project_ref', true), '') <> 'fohpqheglxhfdecadhzw'
      THEN
        -- 1. Verify Preview environment identity from public.system_settings inside the trigger
        SELECT value->>'target_project_ref'
          INTO v_preview_target_ref
        FROM public.system_settings
        WHERE key = 'preview_data_mirror_metadata';

        -- 2. Enforce that seller & order identity columns are NOT modified even during sanitization
        -- 3. Enforce that OLD.order_number is in the exact 16-order allowlist
        -- 4. Enforce that NEW.snapshot_upi_id matches the synthetic Preview UPI pattern
        IF v_preview_target_ref = 'jiyuiydzsfydjklosvvq'
           AND OLD.order_number = ANY(v_allowed_orders)
           AND NEW.snapshot_upi_id ~ '^preview\.[a-z0-9_]+@upi$'
           AND OLD.id IS NOT DISTINCT FROM NEW.id
           AND OLD.order_number IS NOT DISTINCT FROM NEW.order_number
           AND OLD.customer_id IS NOT DISTINCT FROM NEW.customer_id
           AND OLD.seller_id IS NOT DISTINCT FROM NEW.seller_id
           AND OLD.campaign_id IS NOT DISTINCT FROM NEW.campaign_id
           AND OLD.snapshot_seller_id IS NOT DISTINCT FROM NEW.snapshot_seller_id
           AND OLD.snapshot_seller_code IS NOT DISTINCT FROM NEW.snapshot_seller_code
           AND OLD.snapshot_seller_display_name IS NOT DISTINCT FROM NEW.snapshot_seller_display_name
           AND OLD.snapshot_captured_at IS NOT DISTINCT FROM NEW.snapshot_captured_at
        THEN
          RETURN NEW;
        END IF;
      END IF;

      RAISE EXCEPTION 'Order payment snapshot fields are immutable once captured (order_id=%)', OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.snapshot_upi_id IS NOT NULL
     OR NEW.snapshot_seller_id IS NOT NULL
     OR NEW.snapshot_qr_storage_path IS NOT NULL
  THEN
    -- Ensure initial snapshot population always stamps snapshot_captured_at so it cannot remain unlocked
    NEW.snapshot_captured_at := coalesce(NEW.snapshot_captured_at, now());
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_order_payment_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_order_payment_snapshot() TO service_role;


-- 2B. Controlled SUPER_ADMIN RPC for sanitizing the 16 historical Preview order snapshots
DROP FUNCTION IF EXISTS public.admin_sanitize_preview_historical_order_snapshots(uuid, text);

CREATE OR REPLACE FUNCTION public.admin_sanitize_preview_historical_order_snapshots(
  p_actor_user_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed_orders constant text[] := ARRAY[
    'ORD-2026-000031', 'ORD-2026-000032', 'ORD-2026-000033', 'ORD-2026-000034',
    'ORD-2026-000035', 'ORD-2026-000036', 'ORD-2026-000037', 'ORD-2026-000038',
    'ORD-2026-000039', 'ORD-2026-000040', 'ORD-2026-000041', 'ORD-2026-000042',
    'ORD-2026-000043', 'ORD-2026-000044', 'ORD-2026-000045', 'ORD-2026-000046'
  ];
  v_clean_reason text;
  v_mirror_meta jsonb;
  v_rec record;
  v_new_instructions text;
  v_sanitized_count integer := 0;
  v_already_synthetic_count integer := 0;
  v_total_allowlist_present integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'access denied: service_role required' USING ERRCODE = '42501';
  END IF;

  -- 1. Validate actor is SUPER_ADMIN
  IF p_actor_user_id IS NULL OR NOT public.has_role(p_actor_user_id, 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Forbidden: Only SUPER_ADMIN may execute historical Preview snapshot sanitization'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validate reason length
  v_clean_reason := trim(coalesce(p_reason, ''));
  IF length(v_clean_reason) < 10 OR length(v_clean_reason) > 500 THEN
    RAISE EXCEPTION 'Reason must be between 10 and 500 characters'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Validate Preview environment identity and block Production
  IF coalesce(current_setting('app.settings.project_ref', true), '') = 'fohpqheglxhfdecadhzw' THEN
    RAISE EXCEPTION 'CRITICAL SAFETY BLOCK: Cannot execute Preview snapshot sanitization on Production project'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT value INTO v_mirror_meta
  FROM public.system_settings
  WHERE key = 'preview_data_mirror_metadata';

  IF v_mirror_meta IS NULL OR coalesce(v_mirror_meta->>'target_project_ref', '') <> 'jiyuiydzsfydjklosvvq' THEN
    RAISE EXCEPTION 'CRITICAL SAFETY BLOCK: Missing or mismatched preview_data_mirror_metadata for Preview project jiyuiydzsfydjklosvvq'
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Verify all 16 allowlisted orders exist in public.orders
  SELECT count(*)
    INTO v_total_allowlist_present
  FROM public.orders o
  WHERE o.order_number = ANY(v_allowed_orders);

  IF v_total_allowlist_present <> 16 THEN
    RAISE EXCEPTION 'ABORT: Expected all 16 allowlisted historical orders (ORD-2026-000031..000046) to exist, found %', v_total_allowlist_present
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Enable transaction-local sanitization flags (automatically cleared on transaction end)
  PERFORM set_config('ssfi.allow_preview_snapshot_sanitization', 'true', true);
  PERFORM set_config('ssfi.sanitization_caller', 'admin_sanitize_preview_historical_order_snapshots', true);

  FOR v_rec IN
    SELECT
      o.id AS order_id,
      o.order_number,
      o.snapshot_seller_id,
      o.snapshot_seller_code,
      s.upi_id AS synthetic_upi_id,
      s.account_name AS synthetic_account_name,
      s.qr_storage_path AS synthetic_qr_path
    FROM public.orders o
    JOIN public.sellers s ON s.id = coalesce(o.snapshot_seller_id, o.seller_id)
    WHERE o.order_number = ANY(v_allowed_orders)
      AND o.snapshot_captured_at IS NOT NULL
      AND o.snapshot_upi_id IS NOT NULL
      AND o.snapshot_upi_id !~ '^preview\.[a-z0-9_]+@upi$'
    ORDER BY o.order_number ASC
    FOR UPDATE OF o
  LOOP
    IF v_rec.synthetic_upi_id IS NULL OR v_rec.synthetic_upi_id !~ '^preview\.[a-z0-9_]+@upi$' THEN
      RAISE EXCEPTION 'Target seller % does not have a valid synthetic Preview UPI ID (found: %)',
        v_rec.snapshot_seller_code, coalesce(v_rec.synthetic_upi_id, 'NULL')
        USING ERRCODE = 'P0001';
    END IF;

    v_new_instructions := 'PREVIEW TEST ONLY — Do not transfer real funds. Synthetic UPI: ' || v_rec.synthetic_upi_id;

    UPDATE public.orders
       SET snapshot_upi_id = v_rec.synthetic_upi_id,
           snapshot_account_name = coalesce(v_rec.synthetic_account_name, '[PREVIEW TEST] Seller Account'),
           snapshot_qr_storage_path = v_rec.synthetic_qr_path,
           snapshot_payment_instructions = v_new_instructions,
           updated_at = now()
     WHERE id = v_rec.order_id;

    -- Transactional redacted audit log (never logs previous real UPI or payee name)
    INSERT INTO public.audit_logs (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      metadata
    )
    VALUES (
      p_actor_user_id,
      'PREVIEW_HISTORICAL_SNAPSHOT_SANITIZED',
      'orders',
      v_rec.order_id,
      jsonb_build_object(
        'order_number', v_rec.order_number,
        'seller_code', v_rec.snapshot_seller_code,
        'redacted_previous', true,
        'new_snapshot_upi_id', v_rec.synthetic_upi_id,
        'new_snapshot_qr_storage_path', v_rec.synthetic_qr_path,
        'reason', v_clean_reason
      )
    );

    v_sanitized_count := v_sanitized_count + 1;
  END LOOP;

  -- Immediately clear transaction-local flags after the loop
  PERFORM set_config('ssfi.allow_preview_snapshot_sanitization', 'false', true);
  PERFORM set_config('ssfi.sanitization_caller', '', true);

  -- 6. Strict count assertion: must be 16 (initial run) or 0 (idempotent re-run where all 16 are already synthetic)
  SELECT count(*)
    INTO v_already_synthetic_count
  FROM public.orders o
  WHERE o.order_number = ANY(v_allowed_orders)
    AND o.snapshot_upi_id ~ '^preview\.[a-z0-9_]+@upi$';

  IF v_sanitized_count NOT IN (0, 16) OR v_already_synthetic_count <> 16 THEN
    RAISE EXCEPTION 'ABORT: Sanitization integrity check failed (sanitized_count=%, synthetic_allowlist_count=%/16)',
      v_sanitized_count, v_already_synthetic_count
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'sanitized_orders_count', v_sanitized_count,
    'verified_synthetic_allowlist_count', v_already_synthetic_count,
    'already_sanitized', (v_sanitized_count = 0),
    'actor_id', p_actor_user_id,
    'executed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_sanitize_preview_historical_order_snapshots(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_sanitize_preview_historical_order_snapshots(uuid, text) TO service_role;


-- 2C. Post-Sanitization Trigger Lockdown Helper
--     Restores `public.protect_order_payment_snapshot()` to unconditional immutability
--     once the 16 historical Preview orders have been sanitized.
CREATE OR REPLACE FUNCTION public.lock_order_payment_snapshot_trigger_unconditional()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'access denied: service_role required' USING ERRCODE = '42501';
  END IF;

  EXECUTE $trig$
    CREATE OR REPLACE FUNCTION public.protect_order_payment_snapshot()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $body$
    BEGIN
      IF OLD.snapshot_captured_at IS NOT NULL THEN
        IF OLD.snapshot_seller_id IS DISTINCT FROM NEW.snapshot_seller_id
           OR OLD.snapshot_seller_code IS DISTINCT FROM NEW.snapshot_seller_code
           OR OLD.snapshot_seller_display_name IS DISTINCT FROM NEW.snapshot_seller_display_name
           OR OLD.snapshot_qr_storage_path IS DISTINCT FROM NEW.snapshot_qr_storage_path
           OR OLD.snapshot_upi_id IS DISTINCT FROM NEW.snapshot_upi_id
           OR OLD.snapshot_account_name IS DISTINCT FROM NEW.snapshot_account_name
           OR OLD.snapshot_payment_instructions IS DISTINCT FROM NEW.snapshot_payment_instructions
           OR OLD.snapshot_captured_at IS DISTINCT FROM NEW.snapshot_captured_at
        THEN
          RAISE EXCEPTION 'Order payment snapshot fields are immutable once captured (order_id=%)', OLD.id
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $body$;
  $trig$;

  REVOKE ALL ON FUNCTION public.protect_order_payment_snapshot() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.protect_order_payment_snapshot() TO service_role;

  RETURN jsonb_build_object(
    'locked_unconditional', true,
    'locked_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lock_order_payment_snapshot_trigger_unconditional() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_order_payment_snapshot_trigger_unconditional() TO service_role;

COMMIT;

-- ============================================================================
-- ROLLBACK SCRIPT (Reference Only — Do Not Execute Automatically)
-- ============================================================================
/*
BEGIN;

SELECT public.lock_order_payment_snapshot_trigger_unconditional();
DROP FUNCTION IF EXISTS public.lock_order_payment_snapshot_trigger_unconditional();
DROP FUNCTION IF EXISTS public.admin_sanitize_preview_historical_order_snapshots(uuid, text);
DROP FUNCTION IF EXISTS public.verify_order_payment_access(uuid, text, text);
DROP FUNCTION IF EXISTS public.issue_customer_order_access_token(uuid, text, integer);

REVOKE ALL ON FUNCTION public.protect_order_payment_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_order_payment_snapshot() TO service_role;

COMMIT;
*/
