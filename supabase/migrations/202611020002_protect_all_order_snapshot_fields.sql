-- SSFI Lucky Draw — Complete Order Payment Destination Snapshot Protection
-- Migration: 202611020002_protect_all_order_snapshot_fields.sql
-- Additive security enhancement: Updates protect_order_payment_snapshot() trigger function
-- to explicitly protect snapshot_seller_code and snapshot_seller_display_name alongside
-- all preexisting snapshot fields.

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

