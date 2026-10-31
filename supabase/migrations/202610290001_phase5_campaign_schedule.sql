-- ============================================================================
-- Migration: 202610290001_phase5_campaign_schedule.sql
-- Description: Enforce campaign schedule window (start_at, end_at) inside create_seller_order()
-- Note: Review before applying to production. Do not execute automatically.
-- ============================================================================

-- Update create_seller_order to enforce start_at and end_at schedule window
create or replace function public.create_seller_order(
  p_seller_id uuid,
  p_name text,
  p_whatsapp text,
  p_email text,
  p_quantity integer
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_campaign public.campaigns;
  v_customer uuid;
  v_order uuid;
  v_number bigint;
begin
  -- 1. Atomic row lock on active campaign
  select * into v_campaign
  from public.campaigns
  where public_id = 'ssfi-fundraising-lucky-draw'
    and status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'active campaign not found';
  end if;

  -- 2. Strict Schedule Window Enforcement
  if v_campaign.start_at is not null and now() < v_campaign.start_at then
    raise exception 'campaign ticket sales have not opened yet';
  end if;

  if v_campaign.end_at is not null and now() >= v_campaign.end_at then
    raise exception 'campaign ticket sales have ended';
  end if;

  -- 3. Capacity Guard
  if p_quantity < 1 or p_quantity > (v_campaign.total_ticket_limit - v_campaign.sold_ticket_count) then
    raise exception 'requested quantity exceeds remaining campaign capacity';
  end if;

  -- 4. Seller Status Guard
  if not exists(select 1 from public.sellers where id = p_seller_id and is_active) then
    raise exception 'seller is inactive';
  end if;

  -- 5. Customer Record Creation
  insert into public.customers(full_name, phone, whatsapp_number, email)
  values (trim(p_name), trim(p_whatsapp), trim(p_whatsapp), nullif(trim(p_email), ''))
  returning id into v_customer;

  -- 6. Sequential Order Number Generation
  v_number := nextval('public.ssfi_order_number_sequence');

  -- 7. Order & Items Insertion
  insert into public.orders(
    order_number,
    campaign_id,
    customer_id,
    seller_id,
    quantity,
    unit_price_paise,
    total_amount_paise
  ) values (
    format('ORD-%s-%s', to_char(now(), 'YYYY'), lpad(v_number::text, 6, '0')),
    v_campaign.id,
    v_customer,
    p_seller_id,
    p_quantity,
    v_campaign.ticket_price_paise,
    p_quantity * v_campaign.ticket_price_paise
  ) returning id into v_order;

  insert into public.order_items(order_id, quantity, unit_price_paise, total_amount_paise)
  values (v_order, p_quantity, v_campaign.ticket_price_paise, p_quantity * v_campaign.ticket_price_paise);

  -- 8. Payment Pending Creation
  insert into public.payments(order_id, amount_paise, currency)
  values (v_order, p_quantity * v_campaign.ticket_price_paise, v_campaign.currency);

  -- 9. Audit Logging
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'ORDER_CREATED', 'order', v_order, jsonb_build_object('quantity', p_quantity));

  return v_order;
end $$;

-- Enforce security restrictions on function
revoke all on function public.create_seller_order(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_seller_order(uuid, text, text, text, integer) to service_role;

