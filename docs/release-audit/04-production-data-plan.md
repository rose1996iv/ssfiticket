# SSFI Lucky Draw — Production Data Verification & Pre-Seeding Plan

This document establishes the verified baseline data records, administrative configuration, and data preservation plan for the Production database (`fohpqheglxhfdecadhzw`).

---

## 1. Verified Live Production Data Inventory

A read-only inspection of the Production database was executed via the Supabase Management API (`npx supabase db query --linked`). The results confirm that Production **already contains legitimate operational records**:

| Table | Production Record Count | Verified Contents & Status |
|---|---|---|
| `public.roles` | **4** | `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`, `SELLER` (Complete) |
| `public.prizes` | **5** | 1st Prize (₹10,000 Cash), 2nd Prize (₹8,000 Cash), 3rd Prize (Induction), 4th Prize (Ukulele), 5th Prize (Soundbox) (Complete) |
| `public.profiles` | **3** | `admin@ssfi.org`, `seller1@ssfi.org`, `robinsonjoseph.va@gmail.com` |
| `public.profile_roles` | **3** | Links `admin@ssfi.org` -> `SUPER_ADMIN`; links both seller profiles -> `SELLER` |
| `public.sellers` | **2** | `SELLER-007` ("Dehradun", Joseph, Active) and `SELLER-003` ("Delhi", Leo, Active) |
| `public.campaigns` | **1** | `ssfi-fundraising-lucky-draw` (`status = 'DRAFT'`, `start_at = NULL`, `end_at = NULL`) |
| `public.customers` | **0** | Clean (Zero test records) |
| `public.orders` | **0** | Clean (Zero test records) |
| `public.payments` | **0** | Clean (Zero test records) |
| `public.tickets` | **0** | Clean (Zero test records) |
| `public.audit_logs` | **0** | Clean (Zero test records) |

---

## 2. Actual Production Table Schemas (Avoid Insertion Errors)

### Critical Schema Discovery: `public.sellers`
- **Actual Columns in Production:**
  `id` (uuid), `profile_id` (uuid), `seller_code` (text), `display_name` (text), `is_active` (boolean), `created_at` (timestamptz), `updated_at` (timestamptz).
- **Important Warning:** There is **NO `full_name`** column and **NO `phone`** column on `public.sellers`. Seller names and phone numbers are stored in `public.profiles`. Any insert targeting `full_name` or `phone` on `sellers` will fail with PostgreSQL error `42703`.

---

## 3. Data Adjustments Required for Launch

Because roles, prizes, sellers, and administrator accounts are already provisioned, **NO artificial user or seller seeding is required or recommended for launch**.

The **SINGLE** data adjustment required in Production is updating the campaign schedule dates on the existing campaign record:

```sql
UPDATE public.campaigns
SET
  start_at = '2026-10-31 18:30:00+00'::timestamptz, -- 2026-11-01 00:00:00 IST (Ticket sales opening)
  end_at = '2026-12-19 18:30:00+00'::timestamptz,   -- 2026-12-20 00:00:00 IST (Grand Draw date)
  updated_at = pg_catalog.now()
WHERE public_id = 'ssfi-fundraising-lucky-draw';

-- Assert exactly 1 campaign record was updated
DO $$
DECLARE
  v_rows integer;
BEGIN
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'assertion failed: expected exactly 1 campaign row updated, got %', v_rows;
  END IF;
END $$;
```

### Strict Non-Destructive Data Rule:
- DO NOT use `ON CONFLICT DO UPDATE` on `campaigns` or `prizes`. All pre-existing production records are protected.
- If rows already exist, `ON CONFLICT DO NOTHING` is used.
- Only the campaign operational schedule timestamps (`start_at`, `end_at`) are updated, with an atomic row count assertion (`v_rows = 1`).

### Why this update is essential:
1. Currently in Production, `start_at` and `end_at` are `NULL`.
2. With `NULL` timestamps, the Next.js homepage countdown component cannot calculate remaining hours/days to sales opening.
3. The automated scheduler (`process_scheduled_campaign_transitions`) requires `now() >= start_at` to auto-activate the campaign from `DRAFT` to `ACTIVE` on 1 November 2026.

---

## 4. Existing Verified Seller Referral Codes

Public buyers can immediately test and place orders using the existing active Production sellers:
- **Dehradun Seller:** `https://ssfiticket.vercel.app/buy?ref=SELLER-007`
- **Delhi Seller:** `https://ssfiticket.vercel.app/buy?ref=SELLER-003`

If additional sellers (e.g. `SELLER-001`) are desired by the owner, they should be added cleanly through the authenticated Admin Portal at `/admin/sellers` by the Super Administrator, ensuring proper auth user creation and profile linking.

---

## 5. Existing Verified Super Administrator

The Production database already contains an active Super Administrator account:
- **Email:** `admin@ssfi.org`
- **User ID:** `f8844250-1618-4836-a702-57d7d0f2b804`
- **Role:** `SUPER_ADMIN` in `public.profile_roles`
- **Login Portal:** `https://ssfiticket.vercel.app/admin/login`

No manual `provision_admin.sql` execution is required unless an additional administrator email needs to be granted privileges in the future.
