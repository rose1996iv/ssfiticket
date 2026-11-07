# SSFI — Phase 5: Corrected Backup Restore Plan

**Document ID:** `PHASE_5_CORRECTED_BACKUP_RESTORE_PLAN`  
**Date:** 2026-11-07  
**Mode:** `CODE AND DOCUMENT REVISION ONLY` (Do NOT Restore Into Active Preview or Production)  
**Production Supabase (`fohpqheglxhfdecadhzw`):** `READ-ONLY / UNTOUCHED`  
**Preview Supabase (`jiyuiydzsfydjklosvvq`):** `READ-ONLY / UNTOUCHED`  
**Supersedes:** [`docs/security/PHASE_3_BACKUP_RESTORE_TEST_PLAN.md`](file:///f:/PROJECT/Lucky%20Draw/docs/security/PHASE_3_BACKUP_RESTORE_TEST_PLAN.md)  
**Resolves Phase 4 Restore Findings:** `R-1`, `R-2`, `R-3`, `R-4`, `R-5` (Proven on Local Disposable PostgreSQL 18.6)

---

## 1. Summary of Phase 5 Corrections to the Restore Procedure

| Finding ID | Defect in Phase 3 Plan | Phase 5 Corrected Procedure | Verification Status |
|---|---|---|---|
| **R-1** | Replaying `202610290001` and `202610290002` on top of `backups/production-public-schema.sql` failed with duplicate policy `seller_messages_staff_read` because `production-public-schema.sql` already includes migrations `202610270001`..`202610290002`. | Start incremental migration replay on top of `backups/production-public-schema.sql` at **`202610290003_phase7_campaign_auto_scheduler.sql`** through **`202611070001_customer_contact_overrides_collaboration_and_ticket_immutability.sql`** (13 migrations). | `PROVEN ON LOCAL PG 18.6` |
| **R-2** | `public.tickets` has a mutual self-referential foreign key cycle (`original_ticket_id <-> reissued_ticket_id` on voided/reissued ticket `846a768d-9b7a-4572-88bb-c4cd08954194`) with `NOT DEFERRABLE` constraints, causing single-pass `INSERT` to fail. | **Two-pass `public.tickets` restore** within the restore transaction: Pass 1 inserts all 36 `tickets` rows with `original_ticket_id = NULL, reissued_ticket_id = NULL`; Pass 2 executes `UPDATE public.tickets SET original_ticket_id = ..., reissued_ticket_id = ... WHERE id = ...` (permitted by `trg_protect_ticket_identity_immutability`, which only locks identity columns). Also sort `public.seller_messages` with `parent_message_id IS NULL` rows first. | `PROVEN ON LOCAL PG 18.6` |
| **R-3** | Schema migrations pre-seed rows into `public.roles` and `public.system_settings` (`customer_email_live_enabled`), causing duplicate primary key errors during backup insertion. | Execute `TRUNCATE public.system_settings, public.roles CASCADE;` at the start of the data-restore transaction before inserting the 23 tables in topological order, and ensure JSON boolean/object values for `jsonb` columns are cast explicitly as `'...'::jsonb`. | `PROVEN ON LOCAL PG 18.6` |
| **R-4** | Trigger `payment_event_log` (`AFTER INSERT ON public.payments`) automatically inserts `51` `PAYMENT_CREATED` rows into `public.payment_events` and `90` side-effect rows into `public.audit_logs` during parent table restores. | Execute `TRUNCATE public.payment_events;` immediately before inserting `backup.tables.payment_events` (`127` rows) and `TRUNCATE public.audit_logs;` immediately before inserting `backup.tables.audit_logs` (`270` rows) within the restore transaction. | `PROVEN ON LOCAL PG 18.6` |
| **R-5** | Phase 3 listed `180` rows for `audit_logs` and `686` total rows (the post-clone Production count) instead of the actual pre-clone backup baseline. | Use the verified pre-clone backup baseline of **`270` rows in `audit_logs` and `776` total rows across all 23 tables** (`SHA-256: 63cece903e29690c13a9efb08365569d99519dc40aaa800f0a5aa6ceb6e858bf`). | `PROVEN ON LOCAL PG 18.6` |

---

## 2. Verified Backup Inventory & Baseline (`776` Rows Across 23 Tables)

- **Backup File:** [`backups/preview-database-backup-20261107.json`](file:///f:/PROJECT/Lucky%20Draw/backups/preview-database-backup-20261107.json)
- **Captured Timestamp:** `2026-11-07T09:56:04.262Z` (Pre-Clone Preview State)
- **Verified SHA-256:** `63cece903e29690c13a9efb08365569d99519dc40aaa800f0a5aa6ceb6e858bf`

|Topological Order | Table Name (`public.*`) | Verified Row Count | Foreign Key Dependencies & Special Restore Handling |
|---|---|---|---|
| 1 | `roles` | `4` | Pre-truncated via `TRUNCATE public.system_settings, public.roles CASCADE;` (`R-3`) |
| 2 | `profiles` | `6` | Requires seeding 6 stub UUIDs into `auth.users(id, email, created_at)` first |
| 3 | `profile_roles` | `5` | Depends on `profiles`, `roles` |
| 4 | `campaigns` | `1` | Depends on `profiles` |
| 5 | `prizes` | `5` | Depends on `campaigns` |
| 6 | `sellers` | `4` | Depends on `profiles` |
| 7 | `customers` | `52` | Independent |
| 8 | `orders` | `51` | Depends on `campaigns`, `customers`, `sellers`, `profiles` |
| 9 | `order_items` | `46` | Depends on `orders`, `campaigns` |
| 10 | `payments` | `51` | Depends on `orders`, `profiles` (triggers `payment_event_log`) |
| 11 | `payment_events` | `127` | Execute `TRUNCATE public.payment_events;` immediately prior to insert (`R-4`) |
| 12 | `payment_screenshots` | `12` | Depends on `orders`, `payments`, `profiles` |
| 13 | `payment_recovery_tokens` | `2` | Depends on `orders` |
| 14 | `tickets` | `36` | **Two-pass restore (`R-2`):** Insert with `original_ticket_id = NULL, reissued_ticket_id = NULL`, then `UPDATE` self-references |
| 15 | `ticket_deliveries` | `52` | Depends on `orders`, `customers` |
| 16 | `ticket_verifications` | `0` | Depends on `tickets` |
| 17 | `draws` | `0` | Depends on `campaigns`, `prizes`, `profiles` |
| 18 | `draw_results` | `0` | Depends on `draws`, `campaigns`, `prizes`, `tickets`, `orders`, `customers`, `sellers` |
| 19 | `seller_messages` | `12` | Sort with `parent_message_id IS NULL` rows first (`R-2`) |
| 20 | `order_collaboration_notes` | `0` | Depends on `orders`, `profiles` |
| 21 | `system_settings` | `2` | Pre-truncated (`R-3`); format `value` as explicit `::jsonb` literal |
| 22 | `customer_email_outbox` | `38` | Depends on `orders`, `customers`, `sellers`, `profiles` |
| 23 | `audit_logs` | `270` | Execute `TRUNCATE public.audit_logs;` immediately prior to insert (`R-4`) |
| **Total** | **23 Tables** | **`776` Rows** | **100% Verified Parity** |

---

## 3. Step-by-Step Corrected Disposable Local Restore Procedure

> [!IMPORTANT]
> This procedure targets **ONLY** an isolated local disposable PostgreSQL instance (`127.0.0.1:54399`). Never point `PGHOST` or connection strings at Production (`fohpqheglxhfdecadhzw`) or Preview (`jiyuiydzsfydjklosvvq`).

### Step 3.1 — Initialize Disposable Local PostgreSQL Cluster (`127.0.0.1:54399`)

```powershell
$PG_BIN = "C:\Program Files\PostgreSQL\18\bin"
$DATA_DIR = "$env:TEMP\ssfi_pg18_disposable"
$LOG_FILE = "$env:TEMP\ssfi_pg18_disposable.log"

& "$PG_BIN\initdb.exe" -D $DATA_DIR -U postgres -A trust -E UTF8 --no-locale
& "$PG_BIN\pg_ctl.exe" -D $DATA_DIR -l $LOG_FILE -o "-p 54399 -h 127.0.0.1" start -w
& "$PG_BIN\psql.exe" -h 127.0.0.1 -p 54399 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ssfi_restore_test;"
```

### Step 3.2 — Bootstrap Supabase Roles & Schema Stubs (`auth`, `storage`)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN SUPERUSER; END IF;
END $$;

GRANT anon, authenticated, service_role TO postgres;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT ON TABLE auth.users TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO PUBLIC, anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  owner uuid,
  public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner uuid,
  owner_id text,
  version text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb,
  path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED
);
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE storage.buckets, storage.objects TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT string_to_array(name, '/');
$$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO PUBLIC, anon, authenticated, service_role;
```

### Step 3.3 — Replay Baseline Schema + Exact 13 Post-Baseline Migrations (`Fix R-1`)

1. Strip `\restrict` / `\unrestrict` lines from `backups/production-public-schema.sql` and execute against `ssfi_restore_test`.
2. Replay the **13 post-baseline migrations** starting at `202610290003` (do **not** replay `202610290001` or `202610290002`, which are already inside `production-public-schema.sql`):
   1. `supabase/migrations/202610290003_phase7_campaign_auto_scheduler.sql`
   2. `supabase/migrations/202610290004_phase8_ticket_lifecycle_and_delivery.sql`
   3. `supabase/migrations/202610290005_audit_logs_service_role_permission.sql`
   4. `supabase/migrations/202610290006_fix_status_transition_triggers.sql`
   5. `supabase/migrations/202610290007_bidirectional_seller_messages.sql`
   6. `supabase/migrations/202610300001_p0_security_remediation.sql`
   7. `supabase/migrations/202611010001_customer_email_outbox.sql`
   8. `supabase/migrations/202611011000_seller_messages_preserve_on_delete.sql`
   9. `supabase/migrations/202611011100_payment_recovery_tokens.sql`
   10. `supabase/migrations/202611011200_payment_screenshots.sql`
   11. `supabase/migrations/202611020001_seller_qr_and_mandatory_screenshots.sql`
   12. `supabase/migrations/202611020002_protect_all_order_snapshot_fields.sql`
   13. `supabase/migrations/202611070001_customer_contact_overrides_collaboration_and_ticket_immutability.sql`

### Step 3.4 — Restore Relational Data (`776` Rows Across 23 Tables) (`Fixes R-2, R-3, R-4, R-5`)

1. Verify `SHA-256` of `backups/preview-database-backup-20261107.json` equals `63cece903e29690c13a9efb08365569d99519dc40aaa800f0a5aa6ceb6e858bf`.
2. Seed `auth.users` from the 6 rows in `backup.tables.profiles`.
3. Open a single transaction (`BEGIN;`):
   - Execute `TRUNCATE public.system_settings, public.roles CASCADE;` (`Fix R-3`).
   - Insert tables in topological order `1..23`, applying:
     - **Before `payment_events`:** `TRUNCATE public.payment_events;` (`Fix R-4`).
     - **During `tickets` (`Fix R-2`):** Insert all 36 rows with `original_ticket_id = NULL, reissued_ticket_id = NULL`, then execute `UPDATE public.tickets SET original_ticket_id = ..., reissued_ticket_id = ... WHERE id = ...;` for the 4 rows with non-null self-references.
     - **During `seller_messages` (`Fix R-2`):** Sort rows with `parent_message_id IS NULL` first.
     - **Before `audit_logs`:** `TRUNCATE public.audit_logs;` (`Fix R-4`).
   - Restore sequences:
     ```sql
     SELECT pg_catalog.setval('public.ssfi_order_number_sequence', 51, true);
     SELECT pg_catalog.setval('public.ssfi_ticket_number_sequence', 36, true);
     ```
   - `COMMIT;`.

### Step 3.5 — Mandatory Post-Restore Verification Assertions

1. Total rows across all 23 tables = **`776`** (`audit_logs = 270`, `payment_events = 127`, `orders = 51`, `payments = 51`, `tickets = 36`, `customers = 52`).
2. Validated foreign keys (`convalidated = true`) = **`47`** (`unvalidated = 0`).
3. Sequences: `ssfi_order_number_sequence = 51 (is_called = true)`, `ssfi_ticket_number_sequence = 36 (is_called = true)`.
4. Active triggers (`tgenabled = 'O'`) = **`19`**.
5. RLS enabled tables = **`23 / 23`**.

### Step 3.6 — Tear Down Disposable Cluster

```powershell
& "$PG_BIN\pg_ctl.exe" -D $DATA_DIR stop -m immediate
Remove-Item -Recurse -Force $DATA_DIR, $LOG_FILE
```

---

## 4. Storage Binary Limitation

`backups/preview-database-backup-20261107.json` backs up relational rows only, not `storage.objects` binary payloads:
- **5 of 16 overwritten Preview Storage files** can be regenerated byte-for-byte (`67` bytes, `SHA-256: ebf4f635a17d10d6eb46ba680b70142419aa3220f228001a036d311a22ee9d2a`) from local E2E scripts (`1x1` synthetic PNG fixture).
- **11 of 16 overwritten Preview Storage files** (browser-uploaded JPEGs/PNGs) have no binary backup and cannot be restored to their pre-clone image bytes.

