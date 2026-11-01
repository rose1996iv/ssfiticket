-- SSFI Lucky Draw — Payment Recovery Tokens and Customer Payment Completion
-- Migration: 202611011100_payment_recovery_tokens.sql
-- Enables SUPER_ADMIN and ADMIN to generate cryptographically secure recovery links
-- for unverified orders, allowing customers to submit mandatory UTR, Email and WhatsApp details.

-- 1. Table: payment_recovery_tokens
create table if not exists public.payment_recovery_tokens (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id) on delete cascade,
    token_hash text not null unique,
    created_by uuid references public.profiles(id) on delete set null,
    expires_at timestamptz not null default (now() + interval '7 days'),
    revoked_at timestamptz,
    revoked_by uuid references public.profiles(id) on delete set null,
    used_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Indexes for fast token lookup and order reference
create index if not exists idx_payment_recovery_tokens_hash on public.payment_recovery_tokens(token_hash);
create index if not exists idx_payment_recovery_tokens_order_id on public.payment_recovery_tokens(order_id);

-- Enable Row Level Security
alter table public.payment_recovery_tokens enable row level security;

-- Drop existing policies if re-running
drop policy if exists "service_role_all_payment_recovery_tokens" on public.payment_recovery_tokens;
drop policy if exists "staff_select_payment_recovery_tokens" on public.payment_recovery_tokens;

-- Service role full access
create policy "service_role_all_payment_recovery_tokens"
    on public.payment_recovery_tokens
    for all
    to service_role
    using (true)
    with check (true);

-- Staff can read token records for management
create policy "staff_select_payment_recovery_tokens"
    on public.payment_recovery_tokens
    for select
    to authenticated
    using (
        exists (
            select 1 from public.profile_roles pr
            join public.roles r on r.id = pr.role_id
            where pr.profile_id = auth.uid()
              and r.name in ('SUPER_ADMIN', 'ADMIN')
        )
    );

-- 2. RPC: create_payment_recovery_link
-- Revokes any existing active token for the order, inserts a new SHA-256 token hash, and logs audit
create or replace function public.create_payment_recovery_link(
    p_order_id uuid,
    p_token_hash text,
    p_actor_id uuid,
    p_expires_days integer default 7
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_order public.orders;
    v_token_id uuid;
    v_expires_at timestamptz;
begin
    -- 1. RBAC Check: Only SUPER_ADMIN or ADMIN can generate recovery links
    if not (public.has_role(p_actor_id, 'SUPER_ADMIN') or public.has_role(p_actor_id, 'ADMIN')) then
        raise exception 'administrator role required to generate recovery link';
    end if;

    -- 2. Validate Order
    select * into v_order from public.orders where id = p_order_id for update;
    if not found then
        raise exception 'order not found';
    end if;

    if v_order.status in ('CANCELLED', 'REFUNDED') then
        raise exception 'cannot generate recovery link for cancelled or refunded order';
    end if;

    -- 3. Calculate expiry
    v_expires_at := now() + (coalesce(p_expires_days, 7) || ' days')::interval;

    -- 4. Revoke previous active tokens for this order
    update public.payment_recovery_tokens
    set revoked_at = now(),
        revoked_by = p_actor_id,
        updated_at = now()
    where order_id = p_order_id
      and revoked_at is null
      and expires_at > now();

    -- 5. Insert new token record (SHA-256 hash ONLY, never plaintext)
    insert into public.payment_recovery_tokens (
        order_id,
        token_hash,
        created_by,
        expires_at
    ) values (
        p_order_id,
        trim(p_token_hash),
        p_actor_id,
        v_expires_at
    ) returning id into v_token_id;

    -- 6. Audit log (never log raw tokens)
    insert into public.audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) values (
        p_actor_id,
        'PAYMENT_RECOVERY_LINK_GENERATED',
        'order',
        p_order_id,
        jsonb_build_object(
            'token_id', v_token_id,
            'expires_at', v_expires_at,
            'order_number', v_order.order_number
        )
    );

    return jsonb_build_object(
        'token_id', v_token_id,
        'order_id', p_order_id,
        'order_number', v_order.order_number,
        'expires_at', v_expires_at
    );
end $$;

-- 3. RPC: revoke_payment_recovery_link
-- Revokes any active token for an order and logs audit
create or replace function public.revoke_payment_recovery_link(
    p_order_id uuid,
    p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_order public.orders;
    v_revoked_count integer;
begin
    -- 1. RBAC Check: Only SUPER_ADMIN or ADMIN can revoke recovery links
    if not (public.has_role(p_actor_id, 'SUPER_ADMIN') or public.has_role(p_actor_id, 'ADMIN')) then
        raise exception 'administrator role required to revoke recovery link';
    end if;

    select * into v_order from public.orders where id = p_order_id for update;
    if not found then
        raise exception 'order not found';
    end if;

    update public.payment_recovery_tokens
    set revoked_at = now(),
        revoked_by = p_actor_id,
        updated_at = now()
    where order_id = p_order_id
      and revoked_at is null;

    get diagnostics v_revoked_count = row_count;

    -- Audit log
    insert into public.audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) values (
        p_actor_id,
        'PAYMENT_RECOVERY_LINK_REVOKED',
        'order',
        p_order_id,
        jsonb_build_object(
            'order_number', v_order.order_number,
            'revoked_count', v_revoked_count
        )
    );

    return jsonb_build_object(
        'order_id', p_order_id,
        'order_number', v_order.order_number,
        'revoked_count', v_revoked_count
    );
end $$;

-- 4. RPC: lookup_payment_recovery_token
-- Validates token hash and returns detailed order/customer/payment status
create or replace function public.lookup_payment_recovery_token(
    p_token_hash text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_token public.payment_recovery_tokens;
    v_order public.orders;
    v_customer public.customers;
    v_seller public.sellers;
    v_payment public.payments;
    v_status text;
begin
    -- Look up token
    select * into v_token
    from public.payment_recovery_tokens
    where token_hash = trim(p_token_hash);

    if not found then
        return jsonb_build_object(
            'valid', false,
            'status', 'NOT_FOUND',
            'error', 'The payment details link was not found or has been replaced.'
        );
    end if;

    if v_token.revoked_at is not null then
        return jsonb_build_object(
            'valid', false,
            'status', 'REVOKED',
            'error', 'This payment completion link has been revoked by an administrator.'
        );
    end if;

    if v_token.expires_at <= now() then
        return jsonb_build_object(
            'valid', false,
            'status', 'EXPIRED',
            'error', 'This payment completion link has expired. Please contact support or request a new link.'
        );
    end if;

    -- Look up order
    select * into v_order from public.orders where id = v_token.order_id;
    if not found then
        return jsonb_build_object(
            'valid', false,
            'status', 'ORDER_NOT_FOUND',
            'error', 'Associated order not found.'
        );
    end if;

    -- Check if order cancelled
    if v_order.status in ('CANCELLED', 'REFUNDED') then
        return jsonb_build_object(
            'valid', false,
            'status', 'ORDER_CANCELLED',
            'error', 'This order has been cancelled or refunded.'
        );
    end if;

    -- Look up customer, seller, payment
    select * into v_customer from public.customers where id = v_order.customer_id;
    select * into v_seller from public.sellers where id = v_order.seller_id;
    select * into v_payment from public.payments where order_id = v_order.id limit 1;

    -- Determine workflow status:
    -- If tickets already issued: cannot reuse
    if v_order.status = 'TICKETS_ISSUED' or (v_payment.status is not null and v_payment.status = 'VERIFIED') then
        return jsonb_build_object(
            'valid', false,
            'status', 'ALREADY_ISSUED',
            'error', 'Tickets have already been issued for this order.',
            'order_number', v_order.order_number
        );
    end if;

    -- If payment submitted, customer is allowed to reopen and correct details while unverified
    if v_payment.status = 'SUBMITTED' or v_order.status = 'PAYMENT_SUBMITTED' then
        v_status := 'SUBMITTED_AWAITING_VERIFICATION';
    else
        v_status := 'PENDING_PAYMENT';
    end if;

    return jsonb_build_object(
        'valid', true,
        'status', v_status,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'quantity', v_order.quantity,
        'total_amount_paise', v_order.total_amount_paise,
        'customer_id', v_customer.id,
        'customer_name', v_customer.full_name,
        'customer_phone', v_customer.phone,
        'customer_whatsapp', coalesce(v_customer.whatsapp_number, v_customer.phone),
        'customer_email', coalesce(v_customer.email, ''),
        'seller_code', coalesce(v_seller.seller_code, ''),
        'seller_display_name', coalesce(v_seller.display_name, 'Direct Sale'),
        'payment_id', v_payment.id,
        'payment_status', coalesce(v_payment.status::text, 'PENDING'),
        'payment_utr', coalesce(v_payment.utr_reference, ''),
        'payment_payer_name', coalesce(v_payment.payer_name, ''),
        'payment_submitted_at', v_payment.submitted_at,
        'token_expires_at', v_token.expires_at
    );
end $$;

-- 5. RPC: submit_payment_details_completion
-- Atomic idempotent submission of UTR, Email and WhatsApp details
-- Supports both initial submission (PENDING) and reopen/correction (SUBMITTED)
create or replace function public.submit_payment_details_completion(
    p_order_id uuid,
    p_utr text,
    p_email text,
    p_whatsapp text,
    p_payer_name text default null,
    p_token_hash text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_order public.orders;
    v_payment public.payments;
    v_customer public.customers;
    v_trimmed_utr text;
    v_trimmed_email text;
    v_trimmed_whatsapp text;
    v_was_submitted boolean := false;
begin
    v_trimmed_utr := trim(p_utr);
    v_trimmed_email := lower(trim(p_email));
    v_trimmed_whatsapp := trim(p_whatsapp);

    if length(v_trimmed_utr) < 6 then
        raise exception 'UTR / Reference must be at least 6 characters.';
    end if;

    -- 1. Lock and validate order
    select * into v_order from public.orders where id = p_order_id for update;
    if not found then
        raise exception 'Order not found.';
    end if;

    if v_order.status in ('CANCELLED', 'REFUNDED') then
        raise exception 'Order is cancelled or refunded.';
    end if;

    if v_order.status = 'TICKETS_ISSUED' then
        raise exception 'Tickets have already been issued for this order.';
    end if;

    -- 2. Lock and validate payment
    select * into v_payment from public.payments where order_id = p_order_id for update;
    if not found then
        -- Create initial payment if not present
        insert into public.payments (
            order_id,
            amount_paise,
            payment_method,
            status
        ) values (
            p_order_id,
            v_order.total_amount_paise,
            'MANUAL_UPI',
            'PENDING'
        ) returning * into v_payment;
    end if;

    if v_payment.status = 'VERIFIED' then
        raise exception 'Payment has already been verified and tickets issued.';
    end if;

    if v_payment.status = 'SUBMITTED' then
        v_was_submitted := true;
    end if;

    -- 3. Check UTR uniqueness across other payments
    if exists (
        select 1 from public.payments
        where utr_reference = v_trimmed_utr
          and id <> v_payment.id
    ) then
        raise exception 'This Transaction ID / UTR has already been submitted for another order.';
    end if;

    -- 4. Update customer record with mandatory Email and WhatsApp
    select * into v_customer from public.customers where id = v_order.customer_id for update;
    if found then
        update public.customers
        set email = nullif(v_trimmed_email, ''),
            whatsapp_number = nullif(v_trimmed_whatsapp, ''),
            updated_at = now()
        where id = v_customer.id;
    end if;

    -- 5. Update payment record to SUBMITTED state (awaiting Admin verification)
    update public.payments
    set status = 'SUBMITTED',
        utr_reference = v_trimmed_utr,
        payer_name = nullif(trim(p_payer_name), ''),
        submitted_at = now(),
        rejection_reason = null,
        updated_at = now()
    where id = v_payment.id;

    -- 6. Update order status to PAYMENT_SUBMITTED
    update public.orders
    set status = 'PAYMENT_SUBMITTED',
        updated_at = now()
    where id = p_order_id;

    -- 7. If submitted with token, record token usage
    if p_token_hash is not null and p_token_hash <> '' then
        update public.payment_recovery_tokens
        set used_at = now(),
            updated_at = now()
        where token_hash = trim(p_token_hash);
    end if;

    -- 8. Audit log (never log raw tokens)
    insert into public.audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) values (
        auth.uid(),
        'PAYMENT_DETAILS_SUBMITTED',
        'order',
        p_order_id,
        jsonb_build_object(
            'order_number', v_order.order_number,
            'utr', v_trimmed_utr,
            'email', v_trimmed_email,
            'whatsapp', v_trimmed_whatsapp,
            'reopened', v_was_submitted,
            'is_recovery', (p_token_hash is not null and p_token_hash <> '')
        )
    );

    return jsonb_build_object(
        'success', true,
        'order_id', p_order_id,
        'order_number', v_order.order_number,
        'status', 'PAYMENT_SUBMITTED',
        'reopened', v_was_submitted
    );
end $$;

-- Permissions: Restrict RPC execution strictly to service_role
revoke all on function public.create_payment_recovery_link(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.create_payment_recovery_link(uuid, text, uuid, integer) to service_role;

revoke all on function public.revoke_payment_recovery_link(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_payment_recovery_link(uuid, uuid) to service_role;

revoke all on function public.lookup_payment_recovery_token(text) from public, anon, authenticated;
grant execute on function public.lookup_payment_recovery_token(text) to service_role;

revoke all on function public.submit_payment_details_completion(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_payment_details_completion(uuid, text, text, text, text, text) to service_role;
