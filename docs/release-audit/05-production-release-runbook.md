# SSFI Lucky Draw — Production Release Runbook

**Target Launch Date:** 1 November 2026, 00:00 IST  
**Grand Draw Date:** 19 December 2026  
**Production Domain:** `https://ssfiticket.vercel.app`  
**Production Supabase Reference:** `fohpqheglxhfdecadhzw`  
**Approved Baseline Branch:** `deploy/ssfi-homepage-preview`  

---

## 1. Pre-Flight Release Gate Checklist

Confirm each item prior to executing any commands:

- [ ] **Code Quality Verified:** All 214 automated tests passing (`npm test`).
- [ ] **Type & Lint Checks Clear:** `npm run typecheck` and `npm run lint` return 0 errors.
- [ ] **Production Build Verified:** `npm run build` succeeds locally with all 30 routes optimized.
- [ ] **Verified Production Data:** Confirmed existing Super Admin (`admin@ssfi.org`) and active sellers (`SELLER-007`, `SELLER-003`).
- [ ] **Zero Destruction Principle:** No table drops, truncations, or deletions will be performed.
- [ ] **Pre-Release Snapshot:** On-demand backup exported and saved locally.

---

## 2. Production Database Backup Procedure

Before applying the candidate migration, perform an on-demand snapshot:

### Step 1: Export Complete Production Schema & Data
Run the following from your local terminal using the linked Supabase CLI:
```powershell
$TIMESTAMP = Get-Date -Format "yyyyMMdd-HHmmss"
$BACKUP_DIR = "backups/production-snapshots/$TIMESTAMP"
New-Item -ItemType Directory -Force -Path $BACKUP_DIR

# Dump public schema
npx supabase db dump --linked -f "$BACKUP_DIR/production-schema-$TIMESTAMP.sql"

# Dump operational data records
npx supabase db dump --linked --data-only -f "$BACKUP_DIR/production-data-$TIMESTAMP.sql"
```

> [!NOTE]
> Standard Supabase projects include automated daily backups. Point-in-Time Recovery (PITR) is a Pro tier add-on; therefore, local on-demand dumps via `supabase db dump` are the primary guaranteed recovery mechanism before executing any DDL.

---

## 3. Candidate Migration Execution Procedure

### Connection Method:
Execute the migration directly using the **Supabase Dashboard SQL Editor** at:  
`https://supabase.com/dashboard/project/fohpqheglxhfdecadhzw/sql/new`

*(The Dashboard SQL Editor connects directly to the database cluster over an internal secure session, avoiding local IPv6 routing issues and pooler limitations).*

### Execution Steps:
1. Open [`supabase/release-candidates/production-migration.sql`](file:///F:/PROJECT/Lucky%20Draw/supabase/release-candidates/production-migration.sql).
2. Copy the entire script.
3. Paste into the Supabase SQL Editor.
4. Click **Run** (or press `Ctrl+Enter`).
5. Confirm output returns `Success. No rows returned` with **Zero Errors**.

---

## 4. Post-Migration Parity Verification Queries

Execute these verification queries in the Supabase SQL Editor immediately after running the migration:

### Query 1: Verify Sequence Capacity
```sql
SELECT sequence_name, last_value, max_value, increment_by
FROM information_schema.sequences
WHERE sequence_schema = 'public'
  AND sequence_name = 'ssfi_ticket_number_sequence';
```
- **Expected Result:** `max_value = 999999`.

### Query 2: Verify `seller_messages` Bidirectional Columns
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'seller_messages'
  AND column_name IN ('sender_role', 'parent_message_id')
ORDER BY column_name;
```
- **Expected Result:**
  - `parent_message_id`: `uuid`, nullable (`YES`).
  - `sender_role`: `text`, not null (`NO`), default `'ADMIN'::text`.

### Query 3: Verify Auto-Scheduler & Security Functions
```sql
SELECT routine_name, routine_type, security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'process_scheduled_campaign_transitions',
    'evaluate_campaign_schedules',
    'get_campaign_scheduler_status',
    'create_seller_order',
    'has_role',
    'is_staff',
    'trg_seller_messages_protect_immutable'
  )
ORDER BY routine_name;
```
- **Expected Result:** All 7 routines returned with `security_type = DEFINER`.

### Query 4: Verify Activated Campaign Schedule
```sql
SELECT public_id, name, status, start_at, end_at, total_ticket_limit, sold_ticket_count
FROM public.campaigns
WHERE public_id = 'ssfi-fundraising-lucky-draw';
```
- **Expected Result:** `start_at = '2026-10-31 18:30:00+00'`, `end_at = '2026-12-19 18:30:00+00'`.

### Query 5: Verify Revocation of Dangerous Table Privileges
```sql
SELECT grantee, table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) as privs
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
GROUP BY grantee, table_name
ORDER BY table_name, grantee;
```
- **Expected Result:** Only `SELECT` appears for `anon` and `authenticated`. No `TRUNCATE`, `TRIGGER`, `REFERENCES`, `INSERT`, `UPDATE`, or `DELETE`.

### Query 6: Verify `is_staff` Public RLS Execution Permission
```sql
SELECT grantee, routine_name, privilege_type
FROM information_schema.routine_privileges
WHERE specific_schema = 'public'
  AND routine_name = 'is_staff'
ORDER BY grantee;
```
- **Expected Result:** Rows returned for `anon`, `authenticated`, and `service_role` (EXECUTE).

### Query 7: Verify Seller Messaging Write Policy Deletion
```sql
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'seller_messages'
ORDER BY policyname;
```
- **Expected Result:** Only `seller_messages_seller_read` and `seller_messages_staff_read` for `SELECT`. Zero insert or update policies.

---

## 5. Establishing the Migration History Baseline

Once the candidate migration has executed successfully and verified:
1. Initialize the CLI migration baseline so future feature migrations (`feat/*`) track cleanly:
   ```powershell
   npx supabase migration repair --status applied 202610270001
   npx supabase migration repair --status applied 202610270002
   npx supabase migration repair --status applied 202610280001
   npx supabase migration repair --status applied 202610290001
   npx supabase migration repair --status applied 202610290002
   npx supabase migration repair --status applied 202610290003
   npx supabase migration repair --status applied 202610290004
   npx supabase migration repair --status applied 202610290005
   npx supabase migration repair --status applied 202610290006
   npx supabase migration repair --status applied 202610290007
   npx supabase migration repair --status applied 202610300001
   ```
2. Verify via `npx supabase migration list`: All 11 migrations will now show matching timestamps under `Remote`.

---

## 6. Vercel Production Environment Variables & Deployment

### Required Production Environment Variables:
- `NEXT_PUBLIC_SUPABASE_URL`: `https://fohpqheglxhfdecadhzw.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Production Supabase Anon Key
- `SUPABASE_SERVICE_ROLE_KEY`: Production Supabase Service Role Key
- `NEXT_PUBLIC_APP_URL`: `https://ssfiticket.vercel.app`
- `CRON_SECRET`: High-entropy secret for automated scheduler
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_USER_EMAIL`: Gmail OAuth2 delivery

> [!IMPORTANT]
> In Next.js on Vercel, **environment variable changes take effect ONLY after triggering a new deployment or redeployment**. Updating variables in settings does not modify running serverless functions or static assets automatically.

### Code Deployment Steps:
1. Merge `deploy/ssfi-homepage-preview` into `main`.
2. Vercel triggers the Production build on `main`.
3. Confirm build status is green.
4. Perform live smoke tests on `https://ssfiticket.vercel.app`.
