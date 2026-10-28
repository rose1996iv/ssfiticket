# SSFI Lucky Draw — Administrator Account Setup Guide

This document explains how administrative authentication works and how to safely provision your administrator account in Supabase.

---

## 1. Authentication Architecture

The SSFI Lucky Draw application uses **Supabase Auth** with email and password:

1. **User Authentication**:
   - The user signs in via `/login`.
   - Credentials are submitted to Supabase Auth (`supabase.auth.signInWithPassword`).
2. **Role Verification**:
   - The application checks user roles in `public.profile_roles` using the database function `has_role(user_id, role)`.
   - Supported staff roles: `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`.
   - Supported seller role: `SELLER`.
3. **Route Protection**:
   - Protected routes in `/admin` use `requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"])`.
   - If an authenticated user lacks an authorized role, they are redirected to `/unauthorized`.

---

## 2. Why Default Admin Credentials Do Not Exist

By security design, this repository contains **zero hardcoded passwords, administrator accounts, or exposed secrets**. 

Admin credentials must be created by the project owner in the connected Supabase project.

---

## 3. Step-by-Step Administrator Provisioning

Follow these steps to create and activate your administrator account:

### Step 1: Create the User in Supabase Auth
1. Log in to your [Supabase Dashboard](https://supabase.com/dashboard).
2. Select your SSFI project.
3. In the left navigation, go to **Authentication** → **Users**.
4. Click **Add User** → **Create User**.
5. Enter:
   - **Email**: Your chosen admin email (e.g. `admin@ssfi.org.in` or personal email).
   - **Password**: A strong password (at least 8 characters).
   - **Auto-confirm user?**: Check **Yes** (or verify the confirmation email).
6. Click **Create User**.

### Step 2: Grant the `SUPER_ADMIN` Role
1. In the Supabase Dashboard, go to **SQL Editor** in the left menu.
2. Open [`supabase/provision_admin.sql`](../supabase/provision_admin.sql) from this repository.
3. Update line 19 with the exact email address you created in Step 1:
   ```sql
   v_admin_email text := 'admin@ssfi.org.in';
   ```
4. Click **Run** in the SQL Editor.
5. You will see a success message:
   ```text
   NOTICE: SUCCESS: Granted SUPER_ADMIN privileges to "admin@ssfi.org.in"
   ```

### Step 3: Sign in to the Portal
1. Open your SSFI web app at `/login`.
2. Enter your admin email and password.
3. You will be automatically redirected to the `/admin` Operations Dashboard.

---

## 4. Seller Account Setup (Optional)

To create a seller account:
1. Create a user in Supabase Auth (same as Step 1).
2. In SQL Editor, assign the `SELLER` role and create a `sellers` record:
   ```sql
   do $$
   declare
     v_user_id uuid;
     v_seller_role uuid;
   begin
     select id into v_user_id from auth.users where email = 'seller1@ssfi.org.in';
     select id into v_seller_role from public.roles where name = 'SELLER';
     
     -- Assign SELLER role
     insert into public.profile_roles (profile_id, role_id)
     values (v_user_id, v_seller_role) on conflict do nothing;

     -- Create seller entry with unique code
     insert into public.sellers (profile_id, seller_code, display_name, is_active)
     values (v_user_id, 'SELLER-001', 'John Doe', true)
     on conflict (seller_code) do update set is_active = true;
   end $$;
   ```
3. When this user logs in at `/login`, they are automatically routed to `/seller`.
