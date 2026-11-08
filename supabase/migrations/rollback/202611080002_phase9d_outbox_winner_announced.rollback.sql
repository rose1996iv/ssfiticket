-- ============================================================================
-- Rollback Migration: 202611080002_phase9d_outbox_winner_announced.rollback.sql
-- Description: Safely revert customer_email_outbox_event_type_check to baseline.
-- Target Table: public.customer_email_outbox
-- Target Constraint: customer_email_outbox_event_type_check
-- Safety Rules:
--   1. Strict lock before validation: Acquires ACCESS EXCLUSIVE lock upfront
--      with a bounded lock timeout to eliminate TOCTOU races.
--   2. Strict refusal guard: Refuses to execute if ANY WINNER_ANNOUNCED records
--      exist (using BIGINT count).
--   3. Zero data rewriting: Never updates, deletes, or reclassifies records.
--   4. Exact semantic verification: Validates structural AST pattern and exact
--      event type allowlist (rejects unexpected operators, clauses, or types).
--   5. Idempotency: Exits cleanly if exact 4-type baseline definition exists.
--   6. Single-statement atomic replacement in BEGIN ... COMMIT.
-- Author: SSFI Security & Database Engineering Team
-- Date: 2026-11-08
-- ============================================================================

-- TRANSACTION BOUNDARY: Atomically validate and revert constraint
BEGIN;

-- Bounded lock timeout: Prevent indefinite blocking if table is busy
SET LOCAL lock_timeout = '5s';

-- Lock before validation: Acquire ACCESS EXCLUSIVE lock on target table upfront
-- to prevent TOCTOU races between record inspection, constraint check, and reversion.
LOCK TABLE public.customer_email_outbox IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  v_winner_count bigint;
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
  -- 1. Finding D: Refusal Guard with BIGINT count
  -- Refuse to proceed if ANY 'WINNER_ANNOUNCED' records exist in the table.
  -- Existing records must never be silently deleted, updated, or reclassified into other event types.
  SELECT COUNT(*) INTO v_winner_count
  FROM public.customer_email_outbox
  WHERE event_type = 'WINNER_ANNOUNCED';

  IF v_winner_count > 0 THEN
    RAISE EXCEPTION 'Rollback aborted: Found % record(s) with event_type = ''WINNER_ANNOUNCED'' in public.customer_email_outbox. Rollback cannot proceed without violating data integrity. Existing records must never be rewritten or deleted. Resolve or archive rows before rolling back.', v_winner_count
      USING ERRCODE = '23514';
  END IF;

  -- 2. Retrieve attnum for event_type column
  SELECT a.attnum
  INTO v_attnum
  FROM pg_attribute a
  WHERE a.attrelid = 'public.customer_email_outbox'::regclass
    AND a.attname = 'event_type';

  IF v_attnum IS NULL THEN
    RAISE EXCEPTION 'Rollback aborted: Column event_type does not exist on public.customer_email_outbox.'
      USING ERRCODE = '42703';
  END IF;

  -- 3. Inspect current constraint definition and validation state
  SELECT c.oid, pg_get_constraintdef(c.oid), c.convalidated, c.conkey
  INTO v_con_oid, v_con_def, v_con_validated, v_con_key
  FROM pg_constraint c
  WHERE c.conrelid = 'public.customer_email_outbox'::regclass
    AND c.conname = 'customer_email_outbox_event_type_check'
    AND c.contype = 'c';

  IF v_con_oid IS NULL THEN
    RAISE EXCEPTION 'Rollback aborted: Constraint customer_email_outbox_event_type_check does not exist on public.customer_email_outbox.'
      USING ERRCODE = '42704';
  END IF;

  -- Ensure existing constraint is validated
  IF NOT v_con_validated THEN
    RAISE EXCEPTION 'Rollback aborted: Constraint customer_email_outbox_event_type_check is not validated (convalidated = false).'
      USING ERRCODE = '23514';
  END IF;

  -- Ensure constraint strictly binds to event_type column
  IF v_con_key IS DISTINCT FROM ARRAY[v_attnum] THEN
    RAISE EXCEPTION 'Rollback aborted: Constraint customer_email_outbox_event_type_check key (%) does not match event_type column (attnum %).', v_con_key, v_attnum
      USING ERRCODE = '23514';
  END IF;

  -- 4. Finding A & Finding 2: Exact Semantic Expression Validation
  -- Normalize whitespace for consistent structural matching
  v_norm_def := trim(regexp_replace(v_con_def, '\s+', ' ', 'g'));

  -- Verify structural syntax matches strictly a ScalarArrayOpExpr array of text literals:
  --   CHECK ((event_type = ANY (ARRAY['TYPE_1'::text, 'TYPE_2'::text, ...])))
  IF NOT (v_norm_def ~* '^CHECK \(\(event_type = ANY \(ARRAY\[(''([A-Za-z0-9_]+)''::text(\s*,\s*''([A-Za-z0-9_]+)''::text)*)\]\)\)\)$') THEN
    RAISE EXCEPTION 'Rollback aborted: Constraint definition does not match expected ScalarArrayOpExpr array structure. Definition: "%"', v_con_def
      USING ERRCODE = '23514';
  END IF;

  -- Extract sorted distinct array of literal event types
  SELECT coalesce(array_agg(m[1] ORDER BY m[1]), ARRAY[]::text[])
  INTO v_extracted_types
  FROM regexp_matches(v_norm_def, '''([A-Za-z0-9_]+)''::text', 'g') AS m;

  -- Finding 2: Idempotency Guard: If ALREADY exactly at baseline 4-type definition, exit cleanly
  IF v_extracted_types = v_baseline_types THEN
    RAISE NOTICE 'Constraint customer_email_outbox_event_type_check is already exactly at baseline 4-type definition. Rollback is idempotent; no action required.';
    RETURN;
  END IF;

  -- Finding 2: Strict Upgraded State Check: Must match exact 5-type upgraded definition to be rolled back
  IF v_extracted_types <> v_upgraded_types THEN
    RAISE EXCEPTION 'Rollback aborted: Constraint customer_email_outbox_event_type_check is in unexpected state. Definition: "%". Extracted types: %. Expected either baseline % or upgraded %.',
      v_con_def, v_extracted_types, v_baseline_types, v_upgraded_types
      USING ERRCODE = '23514';
  END IF;

  -- 5. Single-Statement Atomic Replacement: Restore baseline 4-type constraint
  ALTER TABLE public.customer_email_outbox
    DROP CONSTRAINT customer_email_outbox_event_type_check,
    ADD CONSTRAINT customer_email_outbox_event_type_check
    CHECK (event_type IN (
      'ORDER_CREATED',
      'PAYMENT_APPROVED',
      'TICKETS_ISSUED',
      'ADMIN_TEST'
    ));

  RAISE NOTICE 'Constraint customer_email_outbox_event_type_check successfully rolled back to exact baseline 4-type definition.';

END $$;

COMMIT;
