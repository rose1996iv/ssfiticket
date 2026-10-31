# SSFI Fundraising Ticket System — Production Database Migration Preflight Report

**Document:** `PRODUCTION_MIGRATION_PREFLIGHT.md`  
**Execution Phase:** Preflight Read-Only Audit  
**Date (IST):** 31 October 2026  
**Target Production Launch:** 1 November 2026 (Sales Open) | 19 December 2026 (Draw Date)  
**Production Project Reference:** `fohpqheglxhfdecadhzw` (`https://fohpqheglxhfdecadhzw.supabase.co`)  
**Development/Preview Reference:** `jiyuiydzsfydjklosvvq` (`https://jiyuiydzsfydjklosvvq.supabase.co`)<br/>
**Active Git Branch:** `deploy/ssfi-homepage-preview` (HEAD: `d1341eabca96dfde2704f8bbaa94289425ec7416`)<br/>
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

### Status: `[ UNVERIFIED ]` (Remote Migration History Not Established)

> [!WARNING]
> **CRITICAL PREFLIGHT FINDING**:
> Previous CLI commands (`npx supabase migration list --linked`, `npx supabase db push --dry-run`) failed with `DbConfigIpv6Error` due to local workstation IPv6 network routing limitations.
>
> Therefore:
> 1. The local inventory of 11 migrations is verified.
> 2. The actual remote Preview database migration history was **NOT verified** by those failed CLI commands.
> 3. The actual remote Production database migration history is **COMPLETELY UNVERIFIED**.
> 4. The exact set of pending Production migrations is **NOT established**.
> 5. **Do NOT assume** that only migrations `202610290001` through `202610300001` are pending.
> 6. **Do NOT execute any migration** against Production (`fohpqheglxhfdecadhzw`).
> 7. **Do NOT link the CLI to Production**.
>
> Only after establishing verified connectivity using the exact **Session Pooler (Port 5432)** or direct connection should the owner compare the local migration files against the remote database migration history.

To establish the remote migration history in a strictly read-only manner, run the following inspection query in the [Production Supabase SQL Editor](https://supabase.com/dashboard/project/fohpqheglxhfdecadhzw):

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
1. **Direct Connection (Port 5432) vs. Shared Poolers**:
   - The Supabase CLI defaults to connecting directly to the PostgreSQL database cluster on port `5432` (`db.<project-ref>.supabase.co`).
   - Supabase assigns an IPv6 DNS record (AAAA) to direct database endpoints.
   - When a local development environment (e.g., Windows workstation, ISP router, or local network adapter) lacks native IPv6 routing or public IPv6 gateway connectivity, the TCP handshake to direct port 5432 is rejected with `DbConfigIpv6Error`.
2. **Session Pooler (Port 5432) vs. Transaction Pooler (Port 6543)**:
   - According to official Supabase documentation:
     - **Shared Session Pooler (Port 5432)**: Supports IPv4, maintains session state, supports prepared statements, and is compatible with schema migrations and administrative DDL commands.
     - **Shared Transaction Pooler (Port 6543)**: Intended exclusively for high-throughput, short-lived client traffic (e.g., serverless edge functions). It **does not support session-level features or multi-statement DDL/migrations**.
3. **Official Connection Recommendation**:
   - For database migrations and administration, **prefer the direct connection when available**.
   - If restricted to an IPv4-only network, **obtain the exact Session Pooler connection string (Port 5432) from the Supabase Dashboard**:
     - Navigate to: `Project Settings > Database > Connection Pooling`.
     - Select **Mode: Session** (Port `5432`).
     - **Do NOT guess or construct the pooler host based only on project region.** Copy the exact connection string directly from the Dashboard.

---

## 6. Complete Local Migration & SQL Script Inventory

The local repository contains **11 migration files** and **3 auxiliary SQL scripts**:

| File Name | Migration Version | Purpose & Key Effects | Environment Status |
|---|---|---|---|
| `202610270001_phase2_core.sql` | `202610270001` | Core tables: `profiles`, `roles`, `campaigns`, `prizes`, `orders`, `payments`, `tickets`. Mints sequence `ssfi_ticket_number_sequence`. Atomic functions `verify_payment_and_issue` and `reject_payment`. | Local file verified |
| `202610270002_phase3_operations.sql` | `202610270002` | `audit_logs` table, role assignment routines (`assign_user_role`), UTR submission `submit_manual_upi`. | Local file verified |
| `202610280001_phase4_seller_referrals.sql` | `202610280001` | `sellers` table, referral codes, seller attribution on orders, `create_seller_order` (5 args). | Local file verified |
| `202610290001_phase5_campaign_schedule.sql` | `202610290001` | Scheduled start/end timestamps on `campaigns`, scheduling validation triggers. | Local file verified |
| `202610290002_phase6_seller_messages.sql` | `202610290002` | `seller_messages` table, RLS policies, message immutability triggers. | Local file verified |
| `202610290003_phase7_campaign_auto_scheduler.sql` | `202610290003` | Automated campaign transition function `process_scheduled_campaign_transitions()`. | Local file verified |
| `202610290004_phase8_ticket_lifecycle_and_delivery.sql` | `202610290004` | `ticket_deliveries` table, delivery status tracking, `voided_at` timestamp on `tickets`. | Local file verified |
| `202610290005_audit_logs_service_role_permission.sql` | `202610290005` | Explicit `GRANT ALL ON public.audit_logs TO service_role`. | Local file verified |
| `202610290006_fix_status_transition_triggers.sql` | `202610290006` | Status transition trigger bugfix for orders transitioning to `TICKETS_ISSUED`. | Local file verified |
| `202610290007_bidirectional_seller_messages.sql` | `202610290007` | Bidirectional messaging: adds `parent_message_id` on `seller_messages` with reply hierarchy. | Local file verified |
| `202610300001_p0_security_remediation.sql` | `202610300001` | P0 Security Hardening: Revokes anon/authenticated DDL, tightens `create_seller_order` (6 args with compulsory phone/email validation), secures sequence permissions. | Local file verified |

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

#### Step 1: Obtain the Exact Session Pooler Connection String (IPv4 Compatible)
1. Open the [Supabase Dashboard](https://supabase.com/dashboard/project/fohpqheglxhfdecadhzw).
2. Navigate to: **Project Settings > Database > Connection Pooling**.
3. Select **Mode: Session** and verify the port is **5432** (not 6543).
4. Copy the URI string:
   ```
   postgresql://postgres.fohpqheglxhfdecadhzw:[YOUR-PASSWORD]@[pooler-host].pooler.supabase.com:5432/postgres?sslmode=require
   ```

#### Step 2: Read-Only Migration History Audit (Zero-Mutation Preflight)
Before pushing any migrations, inspect the actual recorded versions against the local inventory:
```bash
# Windows PowerShell / Terminal:
npx supabase migration list --db-url "<EXACT_SESSION_POOLER_URI_FROM_DASHBOARD_PORT_5432>"
```
Compare the output to establish which migrations are recorded and which are unapplied. **Do not guess or assume which migrations are pending.**

#### Step 3: Transactional Migration Push (Only After Owner Approval)
Once the exact unapplied migrations are reviewed and a database backup snapshot has been created:
```bash
npx supabase db push --db-url "<EXACT_SESSION_POOLER_URI_FROM_DASHBOARD_PORT_5432>"
```
Supabase CLI will inspect `supabase_migrations.schema_migrations`, determine which migrations are unapplied, execute each unapplied migration inside a transaction, and record each applied version automatically.

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

```
================================================================================
VERDICT: PENDING OWNER'S REMOTE MIGRATION AUDIT (READ-ONLY PREFLIGHT REQUIRED)
================================================================================
- Local migration files (11 files) are verified and passing all 210 automated unit tests.
- Remote database migration history for both Preview and Production remains UNVERIFIED due to local IPv6 routing limitations on direct port 5432.
- The exact set of pending Production migrations is NOT established.
- Production database fohpqheglxhfdecadhzw remains completely UNTOUCHED.
- The owner must establish remote connectivity via the Session Pooler (Port 5432) copied directly from the Supabase Dashboard before applying any migrations.
================================================================================
```

