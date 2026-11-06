-- ==============================================================================
-- SCRIPT 03: SYNTHETIC TEST FIXTURES SEED (VERIFIED ORDER_ITEMS PARITY)
-- Target Environment: Supabase Preview (jiyuiydzsfydjklosvvq) ONLY
-- NEVER execute against Production (fohpqheglxhfdecadhzw)
-- ==============================================================================

BEGIN;

-- 1. Synthetic Customer (dedicated test customer with synthetic phone/email)
INSERT INTO public.customers (id, full_name, phone, whatsapp_number, email)
VALUES
  ('e0000000-0000-0000-0000-000000000001', 'Preview Test Customer', '+919999999999', '+919999999999', 'preview-customer@example.invalid')
ON CONFLICT (id) DO UPDATE
SET full_name = excluded.full_name;

-- 2. Synthetic Order in PAYMENT_SUBMITTED status (order_number matching ^ORD-[0-9]{4}-[0-9]{6}$)
INSERT INTO public.orders (
  id,
  order_number,
  campaign_id,
  customer_id,
  seller_id,
  quantity,
  unit_price_paise,
  total_amount_paise,
  status
)
VALUES (
  'f0000000-0000-0000-0000-000000000001',
  'ORD-2026-999901',
  '0f719dad-4547-4660-aed9-f5c6c7b8ed80', -- Active SSFI Campaign
  'e0000000-0000-0000-0000-000000000001', -- Synthetic Customer
  'edebd069-4bea-4f69-8afd-f34743def4ab', -- Existing Seller SELLER-007
  2,
  10000,
  20000,
  'PAYMENT_SUBMITTED'
)
ON CONFLICT (id) DO NOTHING;

-- 3. Synthetic Order Item
INSERT INTO public.order_items (
  id,
  order_id,
  quantity,
  unit_price_paise,
  total_amount_paise
)
VALUES (
  'f0000000-0000-0000-0000-000000000011',
  'f0000000-0000-0000-0000-000000000001',
  2,
  10000,
  20000
)
ON CONFLICT (id) DO NOTHING;

-- 4. Synthetic Payment Record in SUBMITTED status
INSERT INTO public.payments (
  id,
  order_id,
  payment_method,
  status,
  amount_paise,
  currency,
  utr_reference,
  payer_name,
  submitted_at
)
VALUES (
  'f0000000-0000-0000-0000-000000000021',
  'f0000000-0000-0000-0000-000000000001',
  'MANUAL_UPI',
  'SUBMITTED',
  20000,
  'INR',
  'TESTUTR999999',
  'Preview Test Customer',
  now()
)
ON CONFLICT (id) DO NOTHING;

-- 5. Active Synthetic Payment Recovery Token (Valid for 7 days)
INSERT INTO public.payment_recovery_tokens (
  id,
  order_id,
  token_hash,
  expires_at,
  created_by
)
VALUES (
  'f0000000-0000-0000-0000-000000000031',
  'f0000000-0000-0000-0000-000000000001',
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', -- SHA-256 test hash
  now() + interval '7 days',
  '72054ec1-13a8-4b02-8d4e-d2b78f2df978' -- Admin user
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
