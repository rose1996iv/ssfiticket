-- SSFI Lucky Draw — Seller-Owned QR Payment, Immutable Destination Snapshots, and Mandatory Screenshot Verification
-- Migration: 202611020001_seller_qr_and_mandatory_screenshots.sql
-- Additive and backward-compatible changes preserving all historical records.

-- 1. Extend sellers table for personal payment QR management
ALTER TABLE public.sellers
  ADD COLUMN IF NOT EXISTS qr_storage_path text,
  ADD COLUMN IF NOT EXISTS qr_content_type text CHECK (qr_content_type IS NULL OR qr_content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD COLUMN IF NOT EXISTS upi_id text,
  ADD COLUMN IF NOT EXISTS account_name text,
  ADD COLUMN IF NOT EXISTS payment_instructions text,
  ADD COLUMN IF NOT EXISTS is_qr_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qr_updated_at timestamptz;

-- 2. Extend orders table with immutable payment destination snapshot
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS snapshot_seller_id uuid REFERENCES public.sellers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS snapshot_seller_display_name text,
  ADD COLUMN IF NOT EXISTS snapshot_seller_code text,
  ADD COLUMN IF NOT EXISTS snapshot_qr_storage_path text,
  ADD COLUMN IF NOT EXISTS snapshot_upi_id text,
  ADD COLUMN IF NOT EXISTS snapshot_account_name text,
  ADD COLUMN IF NOT EXISTS snapshot_payment_instructions text,
  ADD COLUMN IF NOT EXISTS snapshot_captured_at timestamptz;

-- 3. Extend payments table for intermediate Seller Payment Review
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS seller_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS seller_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seller_review_note text,
  ADD COLUMN IF NOT EXISTS seller_review_status text CHECK (
    seller_review_status IS NULL OR
    seller_review_status IN ('RECOMMENDED_APPROVAL', 'RECOMMENDED_REJECTION', 'FLAGGED_DISCREPANCY')
  );

-- 4. Private Storage Bucket for Seller Payment QRs
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'seller-payment-qrs',
  'seller-payment-qrs',
  false,
  2097152, -- 2MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- 5. Updated RPC: submit_payment_details_completion with OPTIONAL UTR & Payer Name
-- Drops former strict constraint requirement for UTR and Payer Name while keeping mandatory verification integrity.
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

    -- Validate UTR format only if provided
    IF v_trimmed_utr IS NOT NULL AND length(v_trimmed_utr) < 6 THEN
        RAISE EXCEPTION 'UTR / Reference must be at least 6 characters when provided.';
    END IF;

    -- 1. Lock and validate order
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

    -- 2. Lock and validate payment
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

    -- 3. Check UTR uniqueness across other payments only if UTR is provided
    IF v_trimmed_utr IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.payments
        WHERE utr_reference = v_trimmed_utr
          AND id <> v_payment.id
    ) THEN
        RAISE EXCEPTION 'This Transaction ID / UTR has already been submitted for another order.';
    END IF;

    -- 4. Update customer record with Email and WhatsApp if provided
    SELECT * INTO v_customer FROM public.customers WHERE id = v_order.customer_id FOR UPDATE;
    IF FOUND THEN
        UPDATE public.customers
        SET email = coalesce(v_trimmed_email, email),
            whatsapp_number = coalesce(v_trimmed_whatsapp, whatsapp_number),
            updated_at = now()
        WHERE id = v_customer.id;
    END IF;

    -- 4b. Mandatory payment screenshot check: a valid screenshot must be registered before submission
    IF NOT EXISTS (
        SELECT 1 FROM public.payment_screenshots WHERE payment_id = v_payment.id
    ) THEN
        RAISE EXCEPTION 'A payment screenshot is mandatory before payment details can be submitted.';
    END IF;

    -- 5. Update payment record to SUBMITTED state (awaiting Seller review & Admin verification)
    UPDATE public.payments
    SET status = 'SUBMITTED',
        utr_reference = coalesce(v_trimmed_utr, utr_reference),
        payer_name = coalesce(v_trimmed_payer_name, payer_name),
        submitted_at = now(),
        rejection_reason = NULL,
        updated_at = now()
    WHERE id = v_payment.id;

    -- 6. Update order status to PAYMENT_SUBMITTED
    UPDATE public.orders
    SET status = 'PAYMENT_SUBMITTED',
        updated_at = now()
    WHERE id = p_order_id;

    -- 7. If submitted with token, record token usage
    IF p_token_hash IS NOT NULL AND p_token_hash <> '' THEN
        UPDATE public.payment_recovery_tokens
        SET used_at = now(),
            updated_at = now()
        WHERE token_hash = trim(p_token_hash);
    END IF;

    -- 8. Audit log (never log raw tokens)
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

-- 6. Trigger to enforce database-level immutability of order payment destination snapshot
CREATE OR REPLACE FUNCTION public.protect_order_payment_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    -- Only protect when snapshot has already been captured (allows legitimate initial capture)
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

-- 7. Updated RPC: submit_manual_upi with Mandatory Screenshot & Optional UTR
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

    -- Mandatory payment screenshot check
    IF NOT EXISTS (
        SELECT 1 FROM public.payment_screenshots WHERE payment_id = v_payment.id
    ) THEN
        RAISE EXCEPTION 'A payment screenshot is mandatory before payment can be submitted.';
    END IF;

    -- UTR uniqueness check only if provided
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

