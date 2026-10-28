-- ==============================================================================
-- SSFI Lucky Draw — Administrator Account Provisioning Script
-- ==============================================================================
-- Purpose: Safely and idempotently grants SUPER_ADMIN privileges to an existing
--          Supabase Auth user.
--
-- How to use:
-- 1. Create a user in the Supabase Dashboard:
--    Dashboard -> Authentication -> Users -> Click "Add user" -> "Create user"
--    (Enter your admin email and a secure password).
-- 2. Open Supabase Dashboard -> SQL Editor.
-- 3. Replace 'admin@example.com' below with the email address you just created.
-- 4. Click Run.
-- ==============================================================================

do $$
declare
  v_user_id uuid;
  v_role_id uuid;
  -- >>> CHANGE THIS TO YOUR ACTUAL SUPABASE AUTH EMAIL <<<
  v_admin_email text := 'admin@example.com';
  v_full_name text := 'SSFI Super Administrator';
begin
  -- 1. Locate the authenticated user in auth.users
  select id into v_user_id
  from auth.users
  where lower(email) = lower(trim(v_admin_email));

  if v_user_id is null then
    raise exception 'User "%" not found in auth.users. Please create the user first in Supabase Dashboard -> Authentication -> Users.', v_admin_email;
  end if;

  -- 2. Ensure the profile record exists in public.profiles
  insert into public.profiles (id, full_name, email, is_active)
  values (v_user_id, v_full_name, trim(v_admin_email), true)
  on conflict (id) do update
  set is_active = true,
      email = trim(v_admin_email);

  -- 3. Retrieve the SUPER_ADMIN role ID
  select id into v_role_id
  from public.roles
  where name = 'SUPER_ADMIN';

  if v_role_id is null then
    raise exception 'SUPER_ADMIN role not found in public.roles. Please run migration 202610270001_phase2_core.sql first.';
  end if;

  -- 4. Assign the role in public.profile_roles (idempotent)
  insert into public.profile_roles (profile_id, role_id)
  values (v_user_id, v_role_id)
  on conflict (profile_id, role_id) do nothing;

  raise notice 'SUCCESS: Granted SUPER_ADMIN privileges to "%" (UUID: %).', v_admin_email, v_user_id;
end $$;
