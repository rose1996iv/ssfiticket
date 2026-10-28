create sequence public.ssfi_order_number_sequence minvalue 1 no cycle;

-- Prevent one bank reference being attached to two orders. This migration is
-- intentionally separate from Phase 2 and has not been applied by the app.
create unique index payments_manual_upi_utr_unique on public.payments(utr_reference)
where utr_reference is not null;

create or replace function public.validate_status_transition() returns trigger language plpgsql as $$ begin
 if tg_table_name='payments' and old.status<>new.status and not ((old.status='PENDING' and new.status in ('SUBMITTED','CANCELLED')) or (old.status='SUBMITTED' and new.status in ('VERIFIED','FAILED','CANCELLED')) or (old.status='FAILED' and new.status='SUBMITTED') or (old.status='VERIFIED' and new.status='REFUNDED')) then raise exception 'invalid payment status transition'; end if;
 if tg_table_name='orders' and old.status<>new.status and not ((old.status='PENDING_PAYMENT' and new.status in ('PAYMENT_SUBMITTED','CANCELLED')) or (old.status='PAYMENT_SUBMITTED' and new.status in ('PAYMENT_VERIFIED','PENDING_PAYMENT','CANCELLED')) or (old.status='PAYMENT_VERIFIED' and new.status in ('TICKETS_ISSUED','REFUNDED','CANCELLED'))) then raise exception 'invalid order status transition'; end if; return new; end $$;

create or replace function public.create_seller_order(p_seller_id uuid,p_name text,p_whatsapp text,p_email text,p_quantity integer) returns uuid language plpgsql security definer set search_path=public as $$
declare v_campaign public.campaigns; v_customer uuid; v_order uuid; v_number bigint;
begin
 select * into v_campaign from campaigns where public_id='ssfi-fundraising-lucky-draw' and status='ACTIVE' for update;
 if not found then raise exception 'active campaign not found'; end if;
 if p_quantity < 1 or p_quantity > v_campaign.total_ticket_limit-v_campaign.sold_ticket_count then raise exception 'requested quantity exceeds remaining campaign capacity'; end if;
 if not exists(select 1 from sellers where id=p_seller_id and is_active) then raise exception 'seller is inactive'; end if;
 insert into customers(full_name,phone,whatsapp_number,email) values(trim(p_name),trim(p_whatsapp),trim(p_whatsapp),nullif(trim(p_email),'')) returning id into v_customer;
 v_number:=nextval('public.ssfi_order_number_sequence');
 insert into orders(order_number,campaign_id,customer_id,seller_id,quantity,unit_price_paise,total_amount_paise) values(format('ORD-%s-%s',to_char(now(),'YYYY'),lpad(v_number::text,6,'0')),v_campaign.id,v_customer,p_seller_id,p_quantity,v_campaign.ticket_price_paise,p_quantity*v_campaign.ticket_price_paise) returning id into v_order;
 insert into order_items(order_id,quantity,unit_price_paise,total_amount_paise) values(v_order,p_quantity,v_campaign.ticket_price_paise,p_quantity*v_campaign.ticket_price_paise);
 insert into payments(order_id,amount_paise,currency) values(v_order,p_quantity*v_campaign.ticket_price_paise,v_campaign.currency);
 insert into audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),'ORDER_CREATED','order',v_order,jsonb_build_object('quantity',p_quantity));
 return v_order;
end $$;

create or replace function public.submit_manual_upi(p_order_id uuid,p_utr text,p_payer_name text) returns void language plpgsql security definer set search_path=public as $$
declare v_order public.orders; v_payment public.payments;
begin
 select * into v_order from orders where id=p_order_id for update; if not found or v_order.status<>'PENDING_PAYMENT' then raise exception 'order is not ready for payment submission'; end if;
 select * into v_payment from payments where order_id=p_order_id for update; if not found or v_payment.status not in ('PENDING','FAILED') then raise exception 'payment is not ready for submission'; end if;
 if exists(select 1 from payments where utr_reference=trim(p_utr) and id<>v_payment.id) then raise exception 'UTR is already attached to another payment'; end if;
 update payments set status='SUBMITTED',utr_reference=trim(p_utr),payer_name=nullif(trim(p_payer_name),''),submitted_at=now(),rejection_reason=null where id=v_payment.id;
 update orders set status='PAYMENT_SUBMITTED' where id=p_order_id;
 insert into audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(auth.uid(),'PAYMENT_SUBMITTED','payment',v_payment.id,jsonb_build_object('order_id',p_order_id));
end $$;

create or replace function public.verify_payment_and_issue(p_payment_id uuid,p_actor uuid) returns setof public.tickets language plpgsql security definer set search_path=public as $$
declare v_payment public.payments; v_order public.orders;
begin
 if not public.is_staff(p_actor) then raise exception 'administrator role required'; end if;
 select * into v_payment from payments where id=p_payment_id for update; if not found or v_payment.status<>'SUBMITTED' then raise exception 'payment is not awaiting verification'; end if;
 select * into v_order from orders where id=v_payment.order_id for update; if not found or v_order.status<>'PAYMENT_SUBMITTED' or v_payment.amount_paise<>v_order.total_amount_paise then raise exception 'payment and order do not match'; end if;
 update payments set status='VERIFIED',verified_at=now(),verified_by=p_actor where id=v_payment.id;
 update orders set status='PAYMENT_VERIFIED' where id=v_order.id;
 insert into audit_logs(actor_user_id,action,entity_type,entity_id) values(p_actor,'PAYMENT_VERIFIED','payment',v_payment.id);
 return query select * from public.issue_tickets(v_order.id);
end $$;

create or replace function public.reject_payment(p_payment_id uuid,p_actor uuid,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare v_payment public.payments;
begin
 if not public.is_staff(p_actor) then raise exception 'administrator role required'; end if;
 select * into v_payment from payments where id=p_payment_id for update; if not found or v_payment.status<>'SUBMITTED' then raise exception 'payment is not awaiting verification'; end if;
 update payments set status='FAILED',rejection_reason=trim(p_reason) where id=v_payment.id;
 update orders set status='PENDING_PAYMENT' where id=v_payment.order_id;
 insert into audit_logs(actor_user_id,action,entity_type,entity_id,metadata) values(p_actor,'PAYMENT_REJECTED','payment',v_payment.id,jsonb_build_object('reason',trim(p_reason)));
end $$;
revoke all on function public.create_seller_order(uuid,text,text,text,integer), public.submit_manual_upi(uuid,text,text), public.verify_payment_and_issue(uuid,uuid), public.reject_payment(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.create_seller_order(uuid,text,text,text,integer), public.submit_manual_upi(uuid,text,text), public.verify_payment_and_issue(uuid,uuid), public.reject_payment(uuid,uuid,text) to service_role;
