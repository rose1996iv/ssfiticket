-- ============================================================================
-- Migration: 202611080002_phase9d_outbox_winner_announced.sql
-- Description: Atomically expand customer_email_outbox_event_type_check
--              to permit 'WINNER_ANNOUNCED' alongside the baseline event types.
-- Environment: PREVIEW ONLY (Preparation for Phase 9D Winner Notification)
-- Target Table: public.customer_email_outbox
-- Target Constraint: customer_email_outbox_event_type_check
-- Safety Rules:
--   1. Strict lock before validation: Acquires ACCESS EXCLUSIVE lock upfront
--      with a bounded lock timeout to eliminate TOCTOU races.
--   2. Strict schema drift detection: Aborts if baseline constraint is missing.
--   3. Exact semantic verification: Validates structural AST pattern and exact
--      event type allowlist (rejects unexpected operators, clauses, or types).
--   4. Idempotency: Exits cleanly if exact 5-type upgraded definition exists.
--   5. Non-destructive: Zero DML, zero record modifications, zero index/trigger/RLS impact.
-- Author: SSFI Security & Database Engineering Team
-- Date: 2026-11-08
-- ============================================================================

-- TRANSACTION BOUNDARY: Atomically validate and upgrade constraint
BEGIN;

-- Bounded lock timeout: Prevent indefinite blocking if table is busy
SET LOCAL lock_timeout = '5s';

-- Lock before validation: Acquire ACCESS EXCLUSIVE lock on the target table upfront
-- to prevent Time-Of-Check to Time-Of-Use (TOCTOU) races between metadata inspection
-- and constraint replacement.
-- NOTE: ACCESS EXCLUSIVE blocks all concurrent reads and writes on this table.
LOCK TABLE public.customer_email_outbox IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  v_table_exists boolean;
  v_col_is_nullable text;
  v_attnum smallint;
  v_con_oid oid;
  v_con_def text;
  v_norm_def text;
  v_con_validated boolean;
  v_con_key smallint[];
  v_extracted_types text[];
  v_baseline_types CONSTANT text[] := ARRAY[
    'ADMIN_TEST',
    'ORDER_CREATED',
    'PAYMENT_APPROVED',
    'TICKETS_ISSUED'
  ];
  v_upgraded_types CONSTANT text[] := ARRAY[
    'ADMIN_TEST',
    'ORDER_CREATED',
    'PAYMENT_APPROVED',
    'TICKETS_ISSUED',
    'WINNER_ANNOUNCED'
  ];
BEGIN
  -- 1. Pre-condition Check: Verify table existence
  SELECT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'customer_email_outbox'
  ) INTO v_table_exists;

  IF NOT v_table_exists THEN
    RAISE EXCEPTION 'Pre-condition failed: Table public.customer_email_outbox does not exist.'
      USING ERRCODE = '42P01';
  END IF;

  -- 2. Pre-condition Check: Verify column existence, attnum, and NOT NULL invariant
  SELECT a.attnum, c.is_nullable
  INTO v_attnum, v_col_is_nullable
  FROM information_schema.columns c
  JOIN pg_attribute a
    ON a.attrelid = 'public.customer_email_outbox'::regclass
   AND a.attname = c.column_name
  WHERE c.table_schema = 'public'
    AND c.table_name = 'customer_email_outbox'
    AND c.column_name = 'event_type';

  IF v_attnum IS NULL THEN
    RAISE EXCEPTION 'Pre-condition failed: Column event_type does not exist on public.customer_email_outbox.'
      USING ERRCODE = '42703';
  ELSIF v_col_is_nullable <> 'NO' THEN
    RAISE EXCEPTION 'Pre-condition failed: Column event_type is expected to be NOT NULL, found is_nullable = %', v_col_is_nullable
      USING ERRCODE = '23502';
  END IF;

  -- 3. Pre-condition Check: Inspect existing constraint metadata
  SELECT c.oid, pg_get_constraintdef(c.oid), c.convalidated, c.conkey
  INTO v_con_oid, v_con_def, v_con_validated, v_con_key
  FROM pg_constraint c
  WHERE c.conrelid = 'public.customer_email_outbox'::regclass
    AND c.conname = 'customer_email_outbox_event_type_check'
    AND c.contype = 'c';

  -- Finding C: Fail closed on missing baseline constraint (Schema Drift)
  IF v_con_oid IS NULL THEN
    RAISE EXCEPTION 'Schema drift detected: Expected baseline constraint customer_email_outbox_event_type_check does not exist on public.customer_email_outbox. Aborting migration to prevent applying changes to an unverified schema. Manual investigation required.'
      USING ERRCODE = '42704';
  END IF;

  -- Ensure existing constraint is validated
  IF NOT v_con_validated THEN
    RAISE EXCEPTION 'Pre-condition failed: Constraint customer_email_outbox_event_type_check is not validated (convalidated = false).'
      USING ERRCODE = '23514';
  END IF;

  -- Ensure constraint strictly and exclusively references the event_type column
  IF v_con_key IS DISTINCT FROM ARRAY[v_attnum] THEN
    RAISE EXCEPTION 'Pre-condition failed: Constraint customer_email_outbox_event_type_check key (%) does not match event_type column (attnum %).', v_con_key, v_attnum
      USING ERRCODE = '23514';
  END IF;

  -- 4. Finding A: Exact Semantic Expression Validation
  -- Normalize whitespace for consistent structural matching
  v_norm_def := trim(regexp_replace(v_con_def, '\s+', ' ', 'g'));

  -- Verify structural syntax matches strictly a ScalarArrayOpExpr array of text literals:
  --   CHECK ((event_type = ANY (ARRAY['TYPE_1'::text, 'TYPE_2'::text, ...])))
  -- This rejects additional OR/AND clauses, unexpected operators, extra columns, or subqueries.
  IF NOT (v_norm_def ~* '^CHECK \(\(event_type = ANY \(ARRAY\[(''([A-Za-z0-9_]+)''::text(\s*,\s*''([A-Za-z0-9_]+)''::text)*)\]\)\)\)$') THEN
    RAISE EXCEPTION 'Semantic check failed: Constraint definition does not match expected ScalarArrayOpExpr array structure. Definition: "%"', v_con_def
      USING ERRCODE = '23514';
  END IF;

  -- Extract sorted distinct array of literal event types from the validated structure
  SELECT coalesce(array_agg(m[1] ORDER BY m[1]), ARRAY[]::text[])
  INTO v_extracted_types
  FROM regexp_matches(v_norm_def, '''([A-Za-z0-9_]+)''::text', 'g') AS m;

  -- Idempotency Guard: If already at exact 5-type upgraded definition, exit cleanly
  IF v_extracted_types = v_upgraded_types THEN
    RAISE NOTICE 'Constraint customer_email_outbox_event_type_check already matches the exact 5-type upgraded definition. Migration is idempotent; no action required.';
    RETURN;
  END IF;

  -- Strict Baseline Check: Ensure it matches the exact 4-type baseline definition
  IF v_extracted_types <> v_baseline_types THEN
    RAISE EXCEPTION 'Pre-condition failed: Existing constraint definition does not match expected baseline 4-type definition. Definition: "%". Extracted types: %. Expected: %.',
      v_con_def, v_extracted_types, v_baseline_types
      USING ERRCODE = '23514';
  END IF;

  -- 5. Single-Statement Atomic Replacement:
  -- Drops existing baseline constraint and establishes upgraded 5-type constraint
  -- in a single ALTER TABLE catalog operation under ACCESS EXCLUSIVE lock.
  ALTER TABLE public.customer_email_outbox
    DROP CONSTRAINT customer_email_outbox_event_type_check,
    ADD CONSTRAINT customer_email_outbox_event_type_check
    CHECK (event_type IN (
      'ORDER_CREATED',
      'PAYMENT_APPROVED',
      'TICKETS_ISSUED',
      'WINNER_ANNOUNCED',
      'ADMIN_TEST'
    ));

  RAISE NOTICE 'Constraint customer_email_outbox_event_type_check successfully replaced with upgraded 5-type definition.';

END $$;

COMMIT;
