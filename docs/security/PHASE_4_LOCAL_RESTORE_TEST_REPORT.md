# SSFI — Phase 4: Local Disposable PostgreSQL Restore Test Report

**Document ID:** `PHASE_4_LOCAL_RESTORE_TEST_REPORT`  
**Date:** 2026-11-07  
**Mode:** `VALIDATION ONLY` (Executed on Isolated Local Disposable PostgreSQL 18.6 Cluster `127.0.0.1:54399`)  
**Production Supabase (`fohpqheglxhfdecadhzw`):** `READ-ONLY / UNTOUCHED`  
**Preview Supabase (`jiyuiydzsfydjklosvvq`):** `READ-ONLY / UNTOUCHED`  
**Reviewed Deliverable:** [`docs/security/PHASE_3_BACKUP_RESTORE_TEST_PLAN.md`](file:///f:/PROJECT/Lucky%20Draw/docs/security/PHASE_3_BACKUP_RESTORE_TEST_PLAN.md)

---

## 1. Executive Summary

An end-to-end local disposable database restore test was executed on `127.0.0.1:54399` using native **PostgreSQL 18.6 (`PostgreSQL 18.6 on x86_64-windows, compiled by msvc-19.44.35229, 64-bit`)**, replaying the schema baseline, incremental migrations, and the pre-clone Preview relational backup [`backups/preview-database-backup-20261107.json`](file:///f:/PROJECT/Lucky%20Draw/backups/preview-database-backup-20261107.json) (`SHA-256: 63cece903e29690c13a9efb08365569d99519dc40aaa800f0a5aa6ceb6e858bf`).

Executing the actual restore on a disposable PostgreSQL 18.6 instance **exposed five (5) concrete defects** in [`PHASE_3_BACKUP_RESTORE_TEST_PLAN.md`](file:///f:/PROJECT/Lucky%20Draw/docs/security/PHASE_3_BACKUP_RESTORE_TEST_PLAN.md) that would have caused the unedited Phase 3 restore script to fail mid-execution or produce inflated row counts:

1. **Defect R-1 (`REQUIRES REVISION` — Migration Replay Overlap in Step 2.2):**  
   `backups/production-public-schema.sql` already includes migrations `202610270001` through `202610290002`. Replaying `202610290001` and `202610290002` on top of `production-public-schema.sql` with `ON_ERROR_STOP=1` aborts at `202610290002_phase6_seller_messages.sql:29` with `ERROR: policy "seller_messages_staff_read" for table "seller_messages" already exists`. Incremental replay on top of `production-public-schema.sql` must start at `202610290003_phase7_campaign_auto_scheduler.sql` (13 migrations through `202611070001`).
2. **Defect R-2 (`REQUIRES REVISION` — Mutual Self-Referential Foreign Key Cycle in `public.tickets`):**  
   `public.tickets` contains voided/reissued ticket pairs (`846a768d-9b7a-4572-88bb-c4cd08954194` <-> reissued ticket) where `original_ticket_id` and `reissued_ticket_id` reference each other via `NOT DEFERRABLE` foreign keys (`tickets_original_ticket_id_fkey` and `tickets_reissued_ticket_id_fkey`). Naive single-pass `INSERT INTO public.tickets` fails with `ERROR: insert or update on table "tickets" violates foreign key constraint "tickets_original_ticket_id_fkey"`. A two-pass restore (`INSERT` with `original_ticket_id = NULL, reissued_ticket_id = NULL`, followed by `UPDATE public.tickets SET original_ticket_id = ..., reissued_ticket_id = ...`) is required and was proven to succeed with `trg_protect_ticket_identity_immutability` active.
3. **Defect R-3 (`REQUIRES REVISION` — Pre-Seeded Rows in `public.roles` and `public.system_settings`):**  
   Migrations `202610270001_phase2_core.sql` and `202611010001_customer_email_outbox.sql` pre-seed rows in `public.roles` and `public.system_settings` (`key = 'customer_email_live_enabled'`). Naive `INSERT` from the backup JSON fails at `system_settings` with `ERROR: duplicate key value violates unique constraint "system_settings_pkey"`. The restore script must execute `TRUNCATE public.system_settings, public.roles CASCADE;` at the start of the data-restore transaction.
4. **Defect R-4 (`REQUIRES REVISION` — Trigger Side-Effect Duplication in `public.payment_events`):**  
   When `INSERT INTO public.payments` runs with trigger `payment_event_log` active, the trigger automatically inserts `51` new `PAYMENT_CREATED` rows into `public.payment_events`. When `backup.tables.payment_events` (`127` rows) is subsequently inserted, `public.payment_events` ends up with `178` rows (`127 + 51`) instead of `127`. Executing `TRUNCATE public.payment_events;` immediately before inserting `backup.tables.payment_events` (and `TRUNCATE public.audit_logs;` before inserting `backup.tables.audit_logs`) restores exact 1:1 row parity.
5. **Defect R-5 (`REQUIRES REVISION` — Incorrect Expected Row Count `686` vs `776` in Phase 3 Plan):**  
   `PHASE_3_BACKUP_RESTORE_TEST_PLAN.md` stated that `backups/preview-database-backup-20261107.json` contained `180` `audit_logs` rows and `686` total rows (which was the post-clone Production row count). In reality, `backups/preview-database-backup-20261107.json` contains **`270` `audit_logs` rows and `776` total rows across the 23 tables**.

With Fixes `R-1` through `R-5` applied in `scratch/run_phase4_local_disposable_restore.mjs`, **all 23 tables (`776` rows), 47 foreign keys, 2 custom sequences, 68 functions, 19 triggers, 35 RLS policies, 69 indexes, and 280 constraints restored 100% cleanly**, and the disposable PostgreSQL 18.6 cluster was torn down and deleted upon completion.

---

## 2. Disposable Local PostgreSQL Environment Specification

| Parameter | Verified Value |
|---|---|
| Host / Bind Address | `127.0.0.1:54399` (strictly local loopback) |
| Engine Version | `PostgreSQL 18.6 on x86_64-windows, compiled by msvc-19.44.35229, 64-bit` |
| Disposable Cluster Path | `C:\Users\Joseph\.gemini\antigravity\brain\f1fe0dbc-6633-4b76-b6b7-fdb3af5bbb02\scratch\pg18_disposable_data` |
| Disposable Database Name | `ssfi_restore_test` |
| Backup File Verified | `F:\PROJECT\Lucky Draw\backups\preview-database-backup-20261107.json` |
| Backup SHA-256 Checksum | `63cece903e29690c13a9efb08365569d99519dc40aaa800f0a5aa6ceb6e858bf` (`VERIFIED = true`) |
| Remote Supabase Connections | `NONE` (`0` connections to `fohpqheglxhfdecadhzw` or `jiyuiydzsfydjklosvvq`) |
| Post-Test Teardown Status | `COMPLETED` (`pg_ctl stop -m immediate` + `pg18_disposable_data` directory removed) |

---

## 3. Schema Replay & Migration Verification Results

| Step # | SQL Artifact / Migration File | Execution Status |
|---|---|---|
| 1 | `bootstrap_supabase_stubs` (`anon`, `authenticated`, `service_role`, `auth.users`, `auth.uid()`, `auth.role()`, `storage.buckets`, `storage.objects`) | `SUCCESS` |
| 2 | `backups/production-public-schema.sql` (stripped `\restrict` / `\unrestrict` psql meta-commands) | `SUCCESS` |
| 3 | `supabase/migrations/202610290003_phase7_campaign_auto_scheduler.sql` | `SUCCESS` |
| 4 | `supabase/migrations/202610290004_phase8_ticket_lifecycle_and_delivery.sql` | `SUCCESS` |
| 5 | `supabase/migrations/202610290005_audit_logs_service_role_permission.sql` | `SUCCESS` |
| 6 | `supabase/migrations/202610290006_fix_status_transition_triggers.sql` | `SUCCESS` |
| 7 | `supabase/migrations/202610290007_bidirectional_seller_messages.sql` | `SUCCESS` |
| 8 | `supabase/migrations/202610300001_p0_security_remediation.sql` | `SUCCESS` |
| 9 | `supabase/migrations/202611010001_customer_email_outbox.sql` | `SUCCESS` |
| 10 | `supabase/migrations/202611011000_seller_messages_preserve_on_delete.sql` | `SUCCESS` |
| 11 | `supabase/migrations/202611011100_payment_recovery_tokens.sql` | `SUCCESS` |
| 12 | `supabase/migrations/202611011200_payment_screenshots.sql` | `SUCCESS` |
| 13 | `supabase/migrations/202611020001_seller_qr_and_mandatory_screenshots.sql` | `SUCCESS` |
| 14 | `supabase/migrations/202611020002_protect_all_order_snapshot_fields.sql` | `SUCCESS` |
| 15 | `supabase/migrations/202611070001_customer_contact_overrides_collaboration_and_ticket_immutability.sql` | `SUCCESS` |

---

## 4. Restored Relational Data & Catalog Integrity Verification

### 4.1 Table-by-Table Row Count Verification (All 23 Tables)

| # | Table Name (`public.*`) | Backup JSON Row Count | Restored Local PG 18.6 Row Count | Parity Status |
|---|---|---|---|---|
| 1 | `roles` | `4` | `4` | `EXACT MATCH` |
| 2 | `profiles` | `6` | `6` | `EXACT MATCH` |
| 3 | `profile_roles` | `5` | `5` | `EXACT MATCH` |
| 4 | `campaigns` | `1` | `1` | `EXACT MATCH` |
| 5 | `prizes` | `5` | `5` | `EXACT MATCH` |
| 6 | `sellers` | `4` | `4` | `EXACT MATCH` |
| 7 | `customers` | `52` | `52` | `EXACT MATCH` |
| 8 | `orders` | `51` | `51` | `EXACT MATCH` |
| 9 | `order_items` | `46` | `46` | `EXACT MATCH` |
| 10 | `payments` | `51` | `51` | `EXACT MATCH` |
| 11 | `payment_events` | `127` | `127` | `EXACT MATCH` |
| 12 | `payment_screenshots` | `12` | `12` | `EXACT MATCH` |
| 13 | `payment_recovery_tokens` | `2` | `2` | `EXACT MATCH` |
| 14 | `tickets` | `36` | `36` | `EXACT MATCH` |
| 15 | `ticket_deliveries` | `52` | `52` | `EXACT MATCH` |
| 16 | `ticket_verifications` | `0` | `0` | `EXACT MATCH` |
| 17 | `draws` | `0` | `0` | `EXACT MATCH` |
| 18 | `draw_results` | `0` | `0` | `EXACT MATCH` |
| 19 | `seller_messages` | `12` | `12` | `EXACT MATCH` |
| 20 | `order_collaboration_notes` | `0` | `0` | `EXACT MATCH` |
| 21 | `system_settings` | `2` | `2` | `EXACT MATCH` |
| 22 | `customer_email_outbox` | `38` | `38` | `EXACT MATCH` |
| 23 | `audit_logs` | `270` | `270` | `EXACT MATCH` |
| **Total** | **23 Tables** | **`776` Rows** | **`776` Rows** | **`100% EXACT MATCH`** |

### 4.2 Database Catalog & Constraint Verification

| Catalog Dimension | Verified Result on Restored Local PostgreSQL 18.6 | Status |
|---|---|---|
| **Validated Foreign Keys (`convalidated = true`)** | `47` validated foreign keys (`0` unvalidated) | `PASS` |
| **Sequence `ssfi_order_number_sequence`** | `last_value = 51`, `is_called = true` (next order: `ORD-2026-000052`) | `PASS` |
| **Sequence `ssfi_ticket_number_sequence`** | `last_value = 36`, `is_called = true` | `PASS` |
| **Public Schema Functions (`pg_proc`)** | `68` functions pre-Phase 3 (`70` functions after Phase 3 SQL) | `PASS` |
| **Active Non-Internal Triggers (`tgenabled = 'O'`)** | `19` triggers across `public` tables (all enabled `'O'`) | `PASS` |
| **RLS-Enabled Tables (`relrowsecurity = true`)** | `23 / 23` tables (`100%`) | `PASS` |
| **Active RLS Policies (`pg_policies`)** | `35` policies pre-Phase 3 (`37` policies after Phase 3 split) | `PASS` |
| **Public Schema Indexes (`pg_indexes`)** | `69` indexes | `PASS` |
| **Public Schema Constraints (`pg_constraint`)** | `280` constraints (`PRIMARY KEY`, `FOREIGN KEY`, `UNIQUE`, `CHECK`, `NOT NULL`) | `PASS` |

---

## 5. Runtime Verification of `PHASE_3_PROPOSED_SECURITY_MIGRATIONS.sql` on Local Restored DB

After restoring all 23 tables (`776` rows), `docs/security/PHASE_3_PROPOSED_SECURITY_MIGRATIONS.sql` was executed against the local disposable database:

| Test Case | Local PostgreSQL 18.6 Runtime Result | Verdict |
|---|---|---|
| **1. Pre-Migration `anon` `42501` Reproduction** | `SET LOCAL ROLE anon; SELECT id, status FROM public.campaigns;` threw `ERROR: permission denied for function is_staff`. | `REPRODUCED` |
| **2. Post-Migration `anon` Read on `campaigns` & `prizes`** | `SET LOCAL ROLE anon; SELECT count(*) FROM public.campaigns;` -> `1`; `SELECT count(*) FROM public.prizes;` -> `5`. | `PASS` |
| **3. Post-Migration `anon` Call to `public.is_staff(uuid)`** | `SET LOCAL ROLE anon; SELECT public.is_staff('00000000-0000-0000-0000-000000000000');` -> threw `ERROR: permission denied for function is_staff`. | `PASS` |
| **4. `issue_customer_order_access_token` Execution** | Issued 7-day token for `ORD-2026-000041` (`9c8765ff-d1c9-4dd1-b892-1a1fe678da10`), returning `token_id = f3f569af-f05f-46be-a454-b6312c8caac7`. | `PASS` |
| **5. `verify_order_payment_access` (Valid Order + Hash)** | Returned `{"authorized": true, "code": "AUTHORIZED", "order_status": "PENDING_PAYMENT"}`. | `PASS` |
| **6. `verify_order_payment_access` (Cross-Order Isolation)** | Presenting `ORD-2026-000041`'s token hash for `ORD-2026-000042` returned `{"authorized": false, "code": "UNAUTHORIZED"}`. | `PASS` |
| **7. `admin_sanitize_preview_historical_order_snapshots` Execution** | Updated `sanitized_orders_count = 16`, left `remainingNonPreviewSnapshots = 0`, and inserted `16` `PREVIEW_HISTORICAL_SNAPSHOT_SANITIZED` rows into `public.audit_logs`. | `PASS` |
| **8. Post-Sanitization Direct Snapshot Tamper Attempt** | Direct `UPDATE public.orders SET snapshot_upi_id = 'tampered@upi' WHERE id = '9c8765ff-...'` was blocked by `trg_protect_order_payment_snapshot` (`directOrderSnapshotTamperBlocked = true`). | `PASS` |

---

## 6. Storage Binary Limitation Disclosure

While relational metadata (`public.orders`, `public.payment_screenshots`, `public.sellers`) is **100% restorable** from `backups/preview-database-backup-20261107.json`, the JSON backup does **not** contain raw binary blobs from `storage.objects`:
- **5 of 16 overwritten Preview Storage files** can be recreated byte-for-byte (`67`-byte `1x1` synthetic PNG test fixture, `SHA-256: ebf4f635a17d10d6eb46ba680b70142419aa3220f228001a036d311a22ee9d2a`) from the local E2E test scripts (`scratch/preview_acceptance_e2e.js` and `scratch/test_live_submission_preview.js`).
- **11 of 16 overwritten Preview Storage files** (`3` `SELLER-008` JPEG QR uploads + `8` browser-uploaded payment screenshots) have **no binary backup** in the repository, local workspace, or `backups/preview-database-backup-20261107.json` and **cannot be restored to their original pre-clone binary bytes**.

