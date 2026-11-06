# SSFI Lucky Draw — Preview Migration Execution Package (Pre-Apply Review)

**Target Project:** `jiyuiydzsfydjklosvvq` (`ssfi-lucky-draw-dev`)  
**Protected Project:** `fohpqheglxhfdecadhzw` (Production — Strictly Air-Gapped)  
**Date:** 2026-11-02  
**Mode:** READ-ONLY PRE-APPLY AUDIT PACKAGE

---

## 1. Migration Overview & Dependency Chain

The three pending migrations must be applied in strict numerical order:

```
Step 1: 202611011200_payment_screenshots.sql
           ↓ (Creates payment_screenshots table & bucket)
Step 2: 202611020001_seller_qr_and_mandatory_screenshots.sql
           ↓ (Extends sellers/orders/payments schema & RPCs with screenshot checks)
Step 3: 202611020002_protect_all_order_snapshot_fields.sql
             (Hardens snapshot protection trigger across all 8 fields)
```

---

## 2. Statement-by-Statement Security Review

### File 1: `supabase/migrations/202611011200_payment_screenshots.sql`
- **`CREATE TABLE IF NOT EXISTS public.payment_screenshots`**:
  - `payment_id UUID NOT NULL UNIQUE REFERENCES public.payments(id) ON DELETE RESTRICT` (Prevents orphan screenshot records; restricts payment deletion if proof exists).
  - `storage_path TEXT NOT NULL UNIQUE CHECK (storage_path ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$')` (Strict regex enforces UUIDv4 storage keys with valid image extensions).
  - `file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 2097152)` (Enforces 2 MB database-level boundary).
- **Index**: `payment_screenshots_uploaded_at_idx` on `uploaded_at DESC`.
- **Security & RLS**: RLS enabled; all access revoked from `public, anon, authenticated`; granted strictly to `service_role`.
- **Storage Bucket**: Upserts `payment-screenshots` bucket as private (`public = false`), 2 MB limit, image MIME types only.
- **RPC `get_payment_screenshot_storage_metrics`**: `SECURITY DEFINER SET search_path = ''`; verifies `is_staff(p_actor)`; granted exclusively to `service_role`.

### File 2: `supabase/migrations/202611020001_seller_qr_and_mandatory_screenshots.sql`
- **Table Alterations (Additive)**:
  - `sellers`: Adds `qr_storage_path`, `qr_content_type`, `upi_id`, `account_name`, `payment_instructions`, `is_qr_active`, `qr_updated_at`.
  - `orders`: Adds `snapshot_seller_id`, `snapshot_seller_display_name`, `snapshot_seller_code`, `snapshot_qr_storage_path`, `snapshot_upi_id`, `snapshot_account_name`, `snapshot_payment_instructions`, `snapshot_captured_at`.
  - `payments`: Adds `seller_reviewed_at`, `seller_reviewed_by`, `seller_review_note`, `seller_review_status` with CHECK constraint (`RECOMMENDED_APPROVAL`, `RECOMMENDED_REJECTION`, `FLAGGED_DISCREPANCY`).
- **Storage Bucket**: Upserts `seller-payment-qrs` bucket as private (`public = false`), 2 MB limit, image MIME types only.
- **RPC `submit_payment_details_completion`**:
  - `SECURITY DEFINER SET search_path = ''`.
  - Optional UTR & Payer Name handling.
  - Mandatory screenshot check: `IF NOT EXISTS (SELECT 1 FROM public.payment_screenshots WHERE payment_id = v_payment.id) THEN RAISE EXCEPTION ...`.
  - Revoked from `public, anon, authenticated`; granted to `service_role`.
- **RPC `submit_manual_upi`**:
  - Mandatory screenshot check before status transition.
  - Optional UTR format and uniqueness validation.

### File 3: `supabase/migrations/202611020002_protect_all_order_snapshot_fields.sql`
- **Trigger Function `protect_order_payment_snapshot()`**:
  - `SECURITY DEFINER SET search_path = ''`.
  - `IF OLD.snapshot_captured_at IS NOT NULL`:
    - Evaluates all 8 snapshot fields: `snapshot_seller_id`, `snapshot_seller_code`, `snapshot_seller_display_name`, `snapshot_qr_storage_path`, `snapshot_upi_id`, `snapshot_account_name`, `snapshot_payment_instructions`, `snapshot_captured_at`.
    - Uses `IS DISTINCT FROM` to block any unauthorized alteration.
  - Attached to `BEFORE UPDATE ON public.orders`.

---

## 3. Transaction Safety & Execution Scripts

Each script is designed to be executed inside a single transaction block (`BEGIN; ... COMMIT;`) in the **Supabase Dashboard SQL Editor** on Preview (`jiyuiydzsfydjklosvvq`).

### Script 1 (Execute First)
```sql
BEGIN;

-- 202611011200_payment_screenshots.sql
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
    count(*) filter (WHERE uploaded_at >= now() - interval '7 days')::bigint
  FROM public.payment_screenshots;
END;
$$;

REVOKE ALL ON FUNCTION public.get_payment_screenshot_storage_metrics(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_payment_screenshot_storage_metrics(uuid) TO service_role;

COMMIT;
```

### Script 2 (Execute Second)
```sql
BEGIN;

-- 202611020001_seller_qr_and_mandatory_screenshots.sql
ALTER TABLE public.sellers
  ADD COLUMN IF NOT EXISTS qr_storage_path text,
  ADD COLUMN IF NOT EXISTS qr_content_type text CHECK (qr_content_type IS NULL OR qr_content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD COLUMN IF NOT EXISTS upi_id text,
  ADD COLUMN IF NOT EXISTS account_name text,
  ADD COLUMN IF NOT EXISTS payment_instructions text,
  ADD COLUMN IF NOT EXISTS is_qr_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qr_updated_at timestamptz;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS snapshot_seller_id uuid REFERENCES public.sellers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS snapshot_seller_display_name text,
  ADD COLUMN IF NOT EXISTS snapshot_seller_code text,
  ADD COLUMN IF NOT EXISTS snapshot_qr_storage_path text,
  ADD COLUMN IF NOT EXISTS snapshot_upi_id text,
  ADD COLUMN IF NOT EXISTS snapshot_account_name text,
  ADD COLUMN IF NOT EXISTS snapshot_payment_instructions text,
  ADD COLUMN IF NOT EXISTS snapshot_captured_at timestamptz;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS seller_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS seller_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seller_review_note text,
  ADD COLUMN IF NOT EXISTS seller_review_status text CHECK (
    seller_review_status IS NULL OR
    seller_review_status IN ('RECOMMENDED_APPROVAL', 'RECOMMENDED_REJECTION', 'FLAGGED_DISCREPANCY')
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'seller-payment-qrs',
  'seller-payment-qrs',
  false,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.submit_payment_details_completion(
    p_order_id uuid,
    p_utr text DEFAULT NULL,
    p_email text DEFAULT NULL,
    p_whatsapp text DEFAULT NULL,
    p_payer_name text DEFAULT NULL,
    p_token_hash text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_order public.orders;
    v_payment public.payments;
    v_customer public.customers;
    v_trimmed_utr text;
    v_trimmed_email text;
    v_trimmed_whatsapp text;
    v_trimmed_payer_name text;
    v_was_submitted boolean := false;
BEGIN
    v_trimmed_utr := nullif(trim(p_utr), '');
    v_trimmed_email := nullif(lower(trim(p_email)), '');
    v_trimmed_whatsapp := nullif(trim(p_whatsapp), '');
    v_trimmed_payer_name := nullif(trim(p_payer_name), '');

    IF v_trimmed_utr IS NOT NULL AND length(v_trimmed_utr) < 6 THEN
        RAISE EXCEPTION 'UTR / Reference must be at least 6 characters when provided.';
    END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found.';
    END IF;

    IF v_order.status IN ('CANCELLED', 'REFUNDED') THEN
        RAISE EXCEPTION 'Order is cancelled or refunded.';
    END IF;

    IF v_order.status = 'TICKETS_ISSUED' THEN
        RAISE EXCEPTION 'Tickets have already been issued for this order.';
    END IF;

    SELECT * INTO v_payment FROM public.payments WHERE order_id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        INSERT INTO public.payments (
            order_id,
            amount_paise,
            payment_method,
            status
        ) VALUES (
            p_order_id,
            v_order.total_amount_paise,
            'MANUAL_UPI',
            'PENDING'
        ) RETURNING * INTO v_payment;
    END IF;

    IF v_payment.status = 'VERIFIED' THEN
        RAISE EXCEPTION 'Payment has already been verified and tickets issued.';
    END IF;

    IF v_payment.status = 'SUBMITTED' THEN
        v_was_submitted := true;
    END IF;

    IF v_trimmed_utr IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.payments
        WHERE utr_reference = v_trimmed_utr
          AND id <> v_payment.id
    ) THEN
        RAISE EXCEPTION 'This Transaction ID / UTR has already been submitted for another order.';
    END IF;

    SELECT * INTO v_customer FROM public.customers WHERE id = v_order.customer_id FOR UPDATE;
    IF FOUND THEN
        UPDATE public.customers
        SET email = coalesce(v_trimmed_email, email),
            whatsapp_number = coalesce(v_trimmed_whatsapp, whatsapp_number),
            updated_at = now()
        WHERE id = v_customer.id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.payment_screenshots WHERE payment_id = v_payment.id
    ) THEN
        RAISE EXCEPTION 'A payment screenshot is mandatory before payment details can be submitted.';
    END IF;

    UPDATE public.payments
    SET status = 'SUBMITTED',
        utr_reference = coalesce(v_trimmed_utr, utr_reference),
        payer_name = coalesce(v_trimmed_payer_name, payer_name),
        submitted_at = now(),
        rejection_reason = NULL,
        updated_at = now()
    WHERE id = v_payment.id;

    UPDATE public.orders
    SET status = 'PAYMENT_SUBMITTED',
        updated_at = now()
    WHERE id = p_order_id;

    IF p_token_hash IS NOT NULL AND p_token_hash <> '' THEN
        UPDATE public.payment_recovery_tokens
        SET used_at = now(),
            updated_at = now()
        WHERE token_hash = trim(p_token_hash);
    END IF;

    INSERT INTO public.audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        auth.uid(),
        'PAYMENT_DETAILS_SUBMITTED',
        'order',
        p_order_id,
        jsonb_build_object(
            'order_number', v_order.order_number,
            'utr_supplied', (v_trimmed_utr IS NOT NULL),
            'payer_name_supplied', (v_trimmed_payer_name IS NOT NULL),
            'email_supplied', (v_trimmed_email IS NOT NULL),
            'whatsapp_supplied', (v_trimmed_whatsapp IS NOT NULL),
            'reopened', v_was_submitted,
            'is_recovery', (p_token_hash IS NOT NULL AND p_token_hash <> '')
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'order_id', p_order_id,
        'order_number', v_order.order_number,
        'status', 'PAYMENT_SUBMITTED',
        'reopened', v_was_submitted
    );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_payment_details_completion(uuid, text, text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_payment_details_completion(uuid, text, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_manual_upi(
    p_order_id uuid,
    p_utr text DEFAULT NULL,
    p_payer_name text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_order public.orders;
    v_payment public.payments;
    v_trimmed_utr text;
    v_trimmed_payer_name text;
BEGIN
    v_trimmed_utr := nullif(trim(p_utr), '');
    v_trimmed_payer_name := nullif(trim(p_payer_name), '');

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order.status <> 'PENDING_PAYMENT' THEN
        RAISE EXCEPTION 'order is not ready for payment submission';
    END IF;

    SELECT * INTO v_payment FROM public.payments WHERE order_id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_payment.status NOT IN ('PENDING', 'FAILED') THEN
        RAISE EXCEPTION 'payment is not ready for submission';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.payment_screenshots WHERE payment_id = v_payment.id
    ) THEN
        RAISE EXCEPTION 'A payment screenshot is mandatory before payment can be submitted.';
    END IF;

    IF v_trimmed_utr IS NOT NULL THEN
        IF length(v_trimmed_utr) < 6 THEN
            RAISE EXCEPTION 'UTR / Reference must be at least 6 characters when provided.';
        END IF;
        IF EXISTS (SELECT 1 FROM public.payments WHERE utr_reference = v_trimmed_utr AND id <> v_payment.id) THEN
            RAISE EXCEPTION 'UTR is already attached to another payment';
        END IF;
    END IF;

    UPDATE public.payments
    SET status = 'SUBMITTED',
        utr_reference = v_trimmed_utr,
        payer_name = v_trimmed_payer_name,
        submitted_at = now(),
        rejection_reason = NULL
    WHERE id = v_payment.id;

    UPDATE public.orders SET status = 'PAYMENT_SUBMITTED' WHERE id = p_order_id;

    INSERT INTO public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (auth.uid(), 'PAYMENT_SUBMITTED', 'payment', v_payment.id, jsonb_build_object(
        'order_id', p_order_id,
        'utr_supplied', (v_trimmed_utr IS NOT NULL)
    ));
END;
$$;

REVOKE ALL ON FUNCTION public.submit_manual_upi(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_manual_upi(uuid, text, text) TO service_role;

COMMIT;
```

### Script 3 (Execute Third)
```sql
BEGIN;

-- 202611020002_protect_all_order_snapshot_fields.sql
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

DROP TRIGGER IF EXISTS trg_protect_order_payment_snapshot ON public.orders;
CREATE TRIGGER trg_protect_order_payment_snapshot
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.protect_order_payment_snapshot();

COMMIT;
```

---

## 4. Post-Apply Verification SQL

After running the three scripts, execute this single query block in the Preview SQL Editor to confirm complete deployment:

```sql
-- Comprehensive Preview Verification Query
SELECT 'table: payment_screenshots' AS check_name, count(*)::text AS result 
FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payment_screenshots'
UNION ALL
SELECT 'bucket: payment-screenshots', count(*)::text 
FROM storage.buckets WHERE id = 'payment-screenshots' AND public = false
UNION ALL
SELECT 'bucket: seller-payment-qrs', count(*)::text 
FROM storage.buckets WHERE id = 'seller-payment-qrs' AND public = false
UNION ALL
SELECT 'orders: snapshot columns count (expected 8)', count(*)::text 
FROM information_schema.columns WHERE table_name = 'orders' AND column_name LIKE 'snapshot_%'
UNION ALL
SELECT 'payments: seller review columns count (expected 4)', count(*)::text 
FROM information_schema.columns WHERE table_name = 'payments' AND column_name LIKE 'seller_review%'
UNION ALL
SELECT 'trigger: trg_protect_order_payment_snapshot', count(*)::text 
FROM information_schema.triggers WHERE event_object_table = 'orders' AND trigger_name = 'trg_protect_order_payment_snapshot';
```

**Expected Results:**
- `table: payment_screenshots`: `1`
- `bucket: payment-screenshots`: `1`
- `bucket: seller-payment-qrs`: `1`
- `orders: snapshot columns count`: `8`
- `payments: seller review columns count`: `4`
- `trigger: trg_protect_order_payment_snapshot`: `1`

---

## 5. Rollback Limitations & Non-Destructive Recovery Plan

Because migrations are additive, an explicit rollback is usually unnecessary. However, if Preview testing reveals an issue, use this non-destructive compensation script:

```sql
BEGIN;
-- Safe Rollback Compensation Script (Preview Only)
DROP TRIGGER IF EXISTS trg_protect_order_payment_snapshot ON public.orders;
DROP FUNCTION IF EXISTS public.protect_order_payment_snapshot();
-- Retain columns to avoid data loss on any test orders created during Preview testing
COMMIT;
```

