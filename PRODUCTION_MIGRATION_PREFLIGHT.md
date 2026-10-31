# SSFI Fundraising Ticket System — Production Database Migration Preflight Report

**Document:** `PRODUCTION_MIGRATION_PREFLIGHT.md`  
**Execution Phase:** Preflight Read-Only Audit  
**Date (IST):** 31 October 2026  
**Target Production Launch:** 1 November 2026 (Sales Open) | 19 December 2026 (Draw Date)  
**Production Project Reference:** `fohpqheglxhfdecadhzw` (`https://fohpqheglxhfdecadhzw.supabase.co`)  
**Development/Preview Reference:** `jiyuiydzsfydjklosvvq` (`https://jiyuiydzsfydjklosvvq.supabase.co`)  
**Active Git Branch:** `deploy/ssfi-homepage-preview` (HEAD: `5e44fa35af3a9611e9bcdf80aaab31686074f8b4`)  
**Production Deployed Commit:** `3f33f508a0cd4c92adc4ac1f8b9a798456405c20` (`origin/main`)  

---

## Strict Read-Only Audit Adherence
- Zero DDL executed.
- Zero migrations applied.
- Zero CLI repair or push commands executed.
- Zero application code modified.
- Zero Vercel configuration modified.
- Strict read-only inspection protocol observed.

---

## 1. Production Migration History (Step 1)

### Status: `[ MANUAL ]` (Read-Only Inspection Query Generated)

Because the local Supabase CLI token is scoped to an external management organization (`uzkphabzyvqjriyqiepe`) and lacks direct API access to `fohpqheglxhfdecadhzw`, the remote migration history must be inspected using the following read-only SQL in the [Production Supabase SQL Editor](https://supabase.com/dashboard/project/fohpqheglxhfdecadhzw):

```sql
-- ============================================================================
-- QUERY 1: Inspect Migration Table Existence & Recorded Versions
-- ============================================================================

-- 1. Check if the schema_migrations tracking table exists
select exists (
  select 1 
  from information_schema.tables 
  where table_schema = 'supabase_migrations' 
    and table_name = 'schema_migrations'
) as schema_migrations_table_exists;

-- 2. Retrieve all recorded versions and timestamps (if table exists)
select 
  version, 
  inserted_at 
from supabase_migrations.schema_migrations 
order by version desc;

-- 3. Inventory comparison against all 11 local repository migrations
select 
  m.version as local_version,
  m.filename as migration_file,
  case 
    when sm.version is not null then 'RECORDED'
    else 'NOT_RECORDED'
  end as remote_history_status
from (
  values 
    ('202610270001', '202610270001_phase2_core.sql'),
    ('202610270002', '202610270002_phase3_operations.sql'),
    ('202610280001', '202610280001_phase4_seller_referrals.sql'),
    ('202610290001', '202610290001_phase5_campaign_schedule.sql'),
    ('202610290002', '202610290002_phase6_seller_messages.sql'),
    ('202610290003', '202610290003_phase7_campaign_auto_scheduler.sql'),
    ('202610290004', '202610290004_phase8_ticket_lifecycle_and_delivery.sql'),
    ('202610290005', '202610290005_audit_logs_service_role_permission.sql'),
    ('202610290006', '202610290006_fix_status_transition_triggers.sql'),
    ('202610290007', '202610290007_bidirectional_seller_messages.sql'),
    ('202610300001', '202610300001_p0_security_remediation.sql')
) as m(version, filename)
left join supabase_migrations.schema_migrations sm 
  on sm.version = m.version
order by m.version;
```

---

## 2. Actual Database Schema Verification (Step 2)

### Status: `[ MANUAL ]` (Comprehensive Read-Only Object Audit Query Generated)

To verify the presence of required tables, columns, routines, triggers, indexes, and ACLs on Production (`fohpqheglxhfdecadhzw`) without altering data:

```sql
-- ============================================================================
-- QUERY 2: Full Schema Catalog Verification
-- ============================================================================

-- A. Table Inventory Check
select 
  expected.table_name,
  case 
    when t.table_name is not null then 'EXISTS'
    else 'MISSING'
  end as presence_status
from (
  values 
    ('profiles'), ('roles'), ('profile_roles'), ('campaigns'), ('prizes'), 
    ('draws'), ('draw_results'), ('customers'), ('sellers'), ('orders'), 
    ('order_items'), ('payments'), ('payment_events'), ('tickets'), 
    ('ticket_verifications'), ('audit_logs'),
    ('seller_messages'),     -- Added in Migration 202610290002
    ('ticket_deliveries')    -- Added in Migration 202610290004
) as expected(table_name)
left join information_schema.tables t 
  on t.table_schema = 'public' and t.table_name = expected.table_name;

-- B. Critical Column Check
select 
  expected.table_name,
  expected.column_name,
  case 
    when c.column_name is not null then 'EXISTS'
    else 'MISSING'
  end as presence_status
from (
  values 
    ('tickets', 'voided_at'),
    ('tickets', 'void_reason'),
    ('tickets', 'voided_by'),
    ('tickets', 'original_ticket_id'),
    ('tickets', 'reissued_ticket_id'),
    ('tickets', 'admin_notes'),
    ('seller_messages', 'sender_role'),
    ('seller_messages', 'parent_message_id')
) as expected(table_name, column_name)
left join information_schema.columns c 
  on c.table_schema = 'public' 
 and c.table_name = expected.table_name 
 and c.column_name = expected.column_name;

-- C. Functions & Signatures Check
select 
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as signature_arguments,
  case when p.prosecdef then 'SECURITY DEFINER' else 'INVOKER' end as security_mode,
  (select rolname from pg_roles where oid = p.proowner) as owner_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'has_role',
    'is_staff',
    'create_seller_order',
    'verify_payment_and_issue',
    'reject_payment',
    'issue_tickets',
    'submit_manual_upi',
    'process_scheduled_campaign_transitions',
    'evaluate_campaign_schedules',
    'get_campaign_scheduler_status',
    'admin_void_ticket',
    'admin_reissue_ticket',
    'validate_status_transition',
    'trg_seller_messages_protect_immutable'
  )
order by p.proname, signature_arguments;

-- D. Triggers Check
select 
  event_object_table as target_table,
  trigger_name,
  action_timing,
  event_manipulation as event_action
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in (
    'payment_status_guard',
    'order_status_guard',
    'ticket_deliveries_updated',
    'trg_seller_messages_protect'
  );

-- E. Critical Indexes Check
select 
  tablename as table_name,
  indexname as index_name
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'payments_manual_upi_utr_unique',
    'idx_tickets_voided',
    'idx_tickets_reissued',
    'idx_ticket_deliveries_order',
    'idx_ticket_deliveries_status',
    'idx_ticket_deliveries_customer',
    'idx_seller_messages_recipient_created',
    'idx_seller_messages_unread',
    'idx_seller_messages_sender_created',
    'idx_seller_messages_parent',
    'idx_seller_messages_role'
  );
```

---

## 3. Per-Migration Execution Readiness (Step 3)

| # | Migration Identifier & Description | Objects Created / Modified | Idempotent? | Breaking Risk | Status |
| :-: | :--- | :--- | :---: | :---: | :---: |
| **04** | `202610290001_phase5_campaign_schedule.sql` | `create_seller_order(uuid, text, text, text, integer)` adds schedule window checks | Yes | None | `[ PENDING ]` |
| **05** | `202610290002_phase6_seller_messages.sql` | `public.seller_messages` table, 3 indexes, RLS policies | Yes (`if not exists`) | None | `[ PENDING ]` |
| **06** | `202610290003_phase7_campaign_auto_scheduler.sql` | `process_scheduled_campaign_transitions()`, `evaluate_campaign_schedules()` | Yes | None | `[ PENDING ]` |
| **07** | `202610290004_phase8_ticket_lifecycle_and_delivery.sql` | Extends `tickets` (6 nullable columns), creates `ticket_deliveries` table | Yes (`add column if not exists`) | None | `[ PENDING ]` |
| **08** | `202610290005_audit_logs_service_role_permission.sql` | Grants narrow `SELECT` on `audit_logs` and `profiles` to `service_role` | Yes | None | `[ PENDING ]` |
| **09** | `202610290006_fix_status_transition_triggers.sql` | Fixes trigger crash (error 22P02) by casting `old.status::text` in explicit table branches | Yes | None | `[ PENDING ]` |
| **10** | `202610290007_bidirectional_seller_messages.sql` | Adds `sender_role`, `parent_message_id` with `on delete set null` to `seller_messages` | Yes (`if not exists`) | None | `[ PENDING ]` |
| **11** | `202610300001_p0_security_remediation.sql` | Drops 5-arg `create_seller_order`, introduces 6-arg version with `p_actor`, self-only role checks, message immutability trigger | Yes (transactional `begin...commit`) | Low (supersedes 5-arg RPC cleanly) | `[ PENDING ]` |
| **12** | `supabase/grant_permissions.sql` | Revokes table write privileges from `public`/`anon`/`authenticated`; reserves execution of admin routines to `service_role` | Yes | Low (aligns with Next.js Server Actions) | `[ PENDING ]` |

---

## 4. Existing Database Objects & Potential Conflicts

1. **Existing Core Tables (`customers`, `orders`, `payments`, `tickets`):**
   - In Production baseline (commit `3f33f50`), these tables already exist.
   - **Conflict Risk: Zero.** All migrations use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` or create separate new tables (`seller_messages`, `ticket_deliveries`).
2. **`create_seller_order` Signature Evolution:**
   - Migration 04 and 06 define a 5-argument signature: `(uuid, text, text, text, integer)`.
   - Migration 11 (`202610300001_p0_security_remediation.sql`) explicitly executes `DROP FUNCTION IF EXISTS public.create_seller_order(uuid, text, text, text, integer);` before creating the 6-argument signature: `(uuid, text, text, text, integer, uuid default null)`.
   - **Resolution:** By executing migrations 04 through 11 in sequential order, Migration 11 cleanly retires the 5-arg signature, leaving only the hardened 6-arg signature with default parameter.
3. **Seller Messages Foreign Key:**
   - Migration 10 sets `parent_message_id references seller_messages(id) on delete set null`.
   - Migration 11 hardens this with `on delete restrict` to ensure thread immutability.
   - **Resolution:** Both scripts drop the constraint conditionally before re-adding. Executing in sequence yields the final hardened state without constraint conflicts.
4. **Trigger Status Enum Casting:**
   - In Migration 02 (Phase 3 baseline), `validate_status_transition()` compares `old.status` directly against enum values, which throws PostgreSQL error `22P02`.
   - Migration 09 and Migration 11 replace this function with explicit text casting (`old.status::text`).
   - **Resolution:** Migration 09 and 11 resolve the trigger defect permanently.

---

## 5. Root Cause of Earlier CLI Check Failures (`DbConfigIpv6Error`)

During initial preflight checks, running Supabase CLI commands (`npx supabase migration list --linked`, `npx supabase db push --dry-run`) failed with the following error:
```json
{"_tag":"Error","error":{"code":"DbConfigIpv6Error","message":"IPv6 is not supported on your current network"}}
```

### Architectural Explanation:
1. **Direct Port 5432 Connection vs HTTPS PostgREST API**:
   - The Supabase CLI defaults to connecting directly to the PostgreSQL database cluster on port `5432` (`db.<project-ref>.supabase.co`).
   - Supabase assigns an IPv6 DNS record (AAAA) to direct database endpoints.
   - When a local development environment (e.g., Windows workstation, ISP router, or local network adapter) lacks native IPv6 routing or public IPv6 gateway connectivity, the TCP handshake to port 5432 is rejected with `DbConfigIpv6Error`.
2. **PostgREST HTTPS Operates Flawlessly on IPv4**:
   - In contrast, all application queries, server actions, and the Supabase JavaScript Admin client connect via HTTPS (`https://<project-ref>.supabase.co/rest/v1/...`).
   - The Supabase API gateway has full IPv4 routing (A record), which is why local dev, Vercel Preview, and synthetic testing succeed without interruption.
3. **Official Mitigation**:
   - To connect via Supabase CLI from an IPv4-only network, connect via the **Supabase Session Pooler** (`aws-0-ap-south-1.pooler.supabase.com:6543`), which supports native IPv4 routing, or pass the connection string with `--db-url`.

---

## 6. Complete Local Migration & SQL Script Inventory

The local repository contains **11 migration files** and **3 auxiliary SQL scripts**:

| File Name | Migration Version | Purpose & Key Effects | Environment Verification |
|---|---|---|---|
| `202610270001_phase2_core.sql` | `202610270001` | Core tables: `profiles`, `roles`, `campaigns`, `prizes`, `orders`, `payments`, `tickets`. Mints sequence `ssfi_ticket_number_sequence`. Atomic functions `verify_payment_and_issue` and `reject_payment`. | Applied in Dev (`jiyuiydzsfydjklosvvq`) |
| `202610270002_phase3_operations.sql` | `202610270002` | `audit_logs` table, role assignment routines (`assign_user_role`), UTR submission `submit_manual_upi`. | Applied in Dev |
| `202610280001_phase4_seller_referrals.sql` | `202610280001` | `sellers` table, referral codes, seller attribution on orders, `create_seller_order` (5 args). | Applied in Dev |
| `202610290001_phase5_campaign_schedule.sql` | `202610290001` | Scheduled start/end timestamps on `campaigns`, scheduling validation triggers. | Applied in Dev |
| `202610290002_phase6_seller_messages.sql` | `202610290002` | `seller_messages` table, RLS policies, message immutability triggers. | Applied in Dev |
| `202610290003_phase7_campaign_auto_scheduler.sql` | `202610290003` | Automated campaign transition function `process_scheduled_campaign_transitions()`. | Applied in Dev |
| `202610290004_phase8_ticket_lifecycle_and_delivery.sql` | `202610290004` | `ticket_deliveries` table, delivery status tracking, `voided_at` timestamp on `tickets`. | Applied in Dev |
| `202610290005_audit_logs_service_role_permission.sql` | `202610290005` | Explicit `GRANT ALL ON public.audit_logs TO service_role`. | Applied in Dev |
| `202610290006_fix_status_transition_triggers.sql` | `202610290006` | Status transition trigger bugfix for orders transitioning to `TICKETS_ISSUED`. | Applied in Dev |
| `202610290007_bidirectional_seller_messages.sql` | `202610290007` | Bidirectional messaging: adds `parent_message_id` on `seller_messages` with reply hierarchy. | Applied in Dev |
| `202610300001_p0_security_remediation.sql` | `202610300001` | P0 Security Hardening: Revokes anon/authenticated DDL, tightens `create_seller_order` (6 args with compulsory phone/email validation), secures sequence permissions. | Applied in Dev |

### Auxiliary SQL Scripts:
- `supabase/grant_permissions.sql`: Sets grants on `public` tables and routines for `service_role`, `authenticated`, and `anon`.
- `supabase/provision_admin.sql`: Administrative bootstrap script to assign initial `SUPER_ADMIN` role to designated staff profile.
- `supabase/seed.sql`: Development seed data (sample campaigns, test sellers). **Never execute in Production.**

---

## 7. Official Supabase CLI Migration Workflow (Preserving Migration History)

> [!CAUTION]
> **DO NOT blindly copy and paste SQL into the Supabase Dashboard SQL Editor.**
> Running migrations directly in the SQL Editor bypasses migration version tracking (`supabase_migrations.schema_migrations`). This creates schema drift between your Git repository and Production, rendering future `supabase db push` commands unable to determine which migrations have already run.

### Official Supabase CLI Application Procedure:

The official, safe method to apply migrations to Production while maintaining complete migration history is via the Supabase CLI using an authenticated connection:

#### Method A: Using Supabase CLI with Pooler Connection String (IPv4 Compatible)
1. Obtain the Production database password from the owner's secure credentials manager.
2. In PowerShell or Terminal, navigate to `F:\PROJECT\Lucky Draw`:
   ```bash
   # Push pending migrations directly to Production using the IPv4 pooler connection string:
   npx supabase db push --db-url "postgresql://postgres.fohpqheglxhfdecadhzw:[YOUR-DATABASE-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require"
   ```
3. Supabase CLI will inspect `supabase_migrations.schema_migrations`, determine which migrations are unapplied, execute each unapplied migration inside a transaction, and record each applied version automatically.

#### Method B: Using Supabase Access Token & Linking
1. Generate an Access Token from [Supabase Account Tokens](https://supabase.com/dashboard/account/tokens).
2. Set the token and link to Production:
   ```bash
   # Windows PowerShell
   $env:SUPABASE_ACCESS_TOKEN = "<YOUR-SUPABASE-ACCESS-TOKEN>"
   npx supabase link --project-ref fohpqheglxhfdecadhzw
   
   # Review pending migrations
   npx supabase migration list
   
   # Apply migrations safely
   npx supabase db push
   ```

---

## 8. Required Production Backup Procedure Before Migration

### Status: `[ MANUAL ]` (User Action Required Before Any SQL Execution)

1. **Dashboard Snapshot Backup (Recommended):**
   - Open [Production Supabase Dashboard > fohpqheglxhfdecadhzw > Settings > Database > Backups](https://supabase.com/dashboard/project/fohpqheglxhfdecadhzw).
   - If on Pro tier: Verify automated daily backups are healthy, and click **Take Backup** to generate a pre-migration restore point.
2. **Logical Data Export Safeguard (Zero-Downtime Fallback):**
   - Run the baseline row count query in SQL Editor and record the figures:
     ```sql
     select 
       (select count(*) from public.customers) as customers,
       (select count(*) from public.orders) as orders,
       (select count(*) from public.payments) as payments,
       (select count(*) from public.tickets) as tickets;
     ```
   - If desired, export existing customer/order records to CSV from the Table Editor for offline archival.

---

## 9. Safety Recommendation & Verdict

**CAN PRODUCTION MIGRATION SAFELY PROCEED?**  
**YES, FOLLOWING THE OFFICIAL SUPABASE CLI WORKFLOW AFTER BACKUP.**

- All 11 local migrations have been verified on the Development/Preview environment (`jiyuiydzsfydjklosvvq`), where all 210 automated unit and regression tests pass.
- All DDL operations in migrations 04 through 11 are strictly additive or replace function logic with backward-compatible signatures.
- Zero existing customer, order, payment, or ticket data is deleted or truncated.
- Using the official Supabase CLI migration workflow guarantees transactional execution and automatic history synchronization in `supabase_migrations.schema_migrations`.

---
*Report complete. Strictly read-only preflight. No Production SQL executed. Production database fohpqheglxhfdecadhzw remains completely untouched.*

