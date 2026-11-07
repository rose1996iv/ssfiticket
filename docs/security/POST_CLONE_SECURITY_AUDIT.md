# SSFI Lucky Draw — Post-Clone Security Audit & Execution Freeze Report

**Audit Timestamp:** `2026-11-07T16:36:22+05:30` (`2026-11-07T11:06:22Z`)  
**Repository:** `https://github.com/rose1996iv/ssfiticket` (`F:\PROJECT\Lucky Draw`)  
**Audited Git Branch:** `preview/production-mirror`  
**Audited Git HEAD Commit:** `6646f903e169cf7194d759efc12f1236e17906cf`  
**Active Vercel Preview Deployment:** `dpl_91ZpeV7BsFALgeeLwcPkNb3CG5Eu` (`https://ssfiticket-git-preview-production-mirror-rose1996ivs-projects.vercel.app`)  
**Production Branch (`main`):** `origin/main` at `36d39c837114815ed69d428551527d7541f4bf93` (Untouched)  
**Production Supabase Reference:** `fohpqheglxhfdecadhzw` (Strictly Air-Gapped / Zero Connections)  
**Preview Supabase Reference:** `jiyuiydzsfydjklosvvq` (Frozen Read-Only During Audit)

---

## 1. Executive Summary

An immediate execution freeze was placed on both Production (`fohpqheglxhfdecadhzw`) and Preview (`jiyuiydzsfydjklosvvq`) databases, storage buckets, migrations, and Git/Vercel deployments following the execution of the Production-to-Preview clone and sanitization workflow prior to explicit owner sign-off between Phase 3 and Phase 4.

### Consolidated Audit Classifications

| Audit Area | Classification | Summary of Evidence |
| :--- | :--- | :--- |
| **1. Execution Freeze Compliance** | **`VERIFIED`** | Zero database writes, zero storage writes, zero migrations, and zero Git commits/pushes occurred during this audit. |
| **2. Production Database & Storage Safety (`fohpqheglxhfdecadhzw`)** | **`VERIFIED`** | Zero network connections or queries (neither `SELECT` nor write) were ever made to Production Supabase `fohpqheglxhfdecadhzw`. `.env.local` only contains Preview (`jiyuiydzsfydjklosvvq`) credentials, and all scripts enforced a hard guard (`supabaseUrl.includes("jiyuiydzsfydjklosvvq")`). |
| **3. Preview Database & Storage Mutation History (`jiyuiydzsfydjklosvvq`)** | **`VERIFIED`** | Complete forensic inventory of every `INSERT`, `UPDATE`, `UPSERT`, and Storage `upload(..., { upsert: true })` executed by `execute_preview_clone_and_sanitization.mjs` and `verify_preview_clone_state.mjs` is documented below. Zero triggers were disabled or dropped. Migration `202611070002_preview_clone_alignment_and_isolation.sql` was created on disk only and **never executed** against the database. |
| **4. Pre-Clone Backup Integrity & Restore Readiness** | **`PARTIALLY VERIFIED` (`NOT RESTORE-VERIFIED`)** | `backups/preview-database-backup-20261107.json` (`909,075` bytes, SHA-256 `63cece903e29690c13a9efb08365569d99519dc40aaa800f0a5aa6ceb6e858bf`) exists and contains all 23 pre-clone table row arrays (`686` total rows). However, storage backup captured **object metadata only** (not raw binary image blobs), and a full database restore has **not** been executed in a disposable PostgreSQL instance (`NOT VERIFIED` / `NOT RESTORE-VERIFIED`). |
| **5. Historical UPI Snapshot Sanitization (`public.orders`)** | **`FAILED` (16 Historical Rows Retained Non-Synthetic UPI Text)** | While all `4` active seller rows in `public.sellers` and `35` orders (previously lacking snapshots) now use synthetic `preview.sellerXXX@upi` IDs, **`16` pre-existing orders** where `snapshot_captured_at IS NOT NULL` still retain non-synthetic UPI IDs (`7` rows with `ssfi******@okaxis` and `9` rows with `8810******@ptyes`) in `public.orders.snapshot_upi_id` because trigger `trg_protect_order_payment_snapshot` blocks updating `snapshot_*` columns once `snapshot_captured_at` is set, and triggers were not disabled. Note: the `4` underlying QR image objects in `seller-payment-qrs` referenced by those `16` orders **were** overwritten with synthetic `3,780`-byte `PREVIEW TEST ONLY` PNGs. |
| **6. Customer, Seller, Payment & Outbox PII Sanitization** | **`VERIFIED`** | `0` real customer emails (`52/52` end with `@preview-test.invalid`), `0` real customer phones (`52/52` match `9000000001`..`9000000052`), `0` real profile phones (`6/6` match `+919000090001`..`06`), `0` real seller UPI IDs in `public.sellers` (`4/4` match `preview.sellerXXX@upi`), `0` real payment UTRs (`35/35` submitted/verified rows match `PRVUTR0000XX`), and `system_settings.customer_email_live_enabled = false`. |
| **7. RLS & RPC Security Verification** | **`PARTIALLY VERIFIED`** | Anonymous access to `orders`, `customers`, `payments`, `payment_screenshots`, `tickets`, `sellers`, and `audit_logs` returns `0` rows (`VERIFIED`). Append-only/immutability triggers on `tickets`, `audit_logs`, and `orders` blocked service-role mutation probes (`VERIFIED`). However, direct `anon` PostgREST `SELECT` on `campaigns` and `prizes` fails with `42501: permission denied for function is_staff` because `202611070002_preview_clone_alignment_and_isolation.sql` has not been applied (`FAILED` for direct `anon` client queries; Next.js server components bypass this via server-side queries). |
| **8. Ticket Integrity & `PRV-` Namespace Isolation** | **`PARTIALLY VERIFIED`** | `/verify/[ticketNumber]` (commit `6646f903e169cf7194d759efc12f1236e17906cf`) normalizes `PRV-SSFI-XXXXXX` / `PRV-XXXXXX` and displays `PRV-SSFI-XXXXXX` with a Preview-only banner (`VERIFIED`). All `36` database rows in `public.tickets` retain `SSFI-XXXXXX` format due to `trg_protect_ticket_identity_immutability` (`VERIFIED`). Outbound email subjects/templates for future Preview orders do not yet prefix `PRV-` because migration `202611070002` was not applied (`PARTIALLY VERIFIED`). |
| **9. Git & Vercel Environment Isolation** | **`PARTIALLY VERIFIED`** | Branch is `preview/production-mirror` at `6646f903e169cf7194d759efc12f1236e17906cf`; `origin/main` (`36d39c837114815ed69d428551527d7541f4bf93`) and Vercel Production were untouched (`VERIFIED`). However, local Git config `user.email` has a trailing typo (`robinsonjoseph.va@gmail.comclear`) recorded in commit metadata (`PARTIALLY VERIFIED`). |

---

## 2. Actual Production Operation History

**Classification:** **`VERIFIED`**

1. **Which exact Production queries were executed?**
   - **None (`0` queries).** No SQL queries, PostgREST calls, RPC invocations, Auth requests, or Storage API calls were executed against Production Supabase (`fohpqheglxhfdecadhzw`).
2. **Were they `SELECT`-only?**
   - **Not applicable (zero connections made to Production).** All Production schema and baseline reference data were inspected strictly from pre-existing local repository artifacts:
     - [`backups/production-public-schema.sql`](file:///f:/PROJECT/Lucky%20Draw/backups/production-public-schema.sql)
     - [`backups/production-public-data-before-release.sql`](file:///f:/PROJECT/Lucky%20Draw/backups/production-public-data-before-release.sql)
     - [`docs/release-audit/04-production-data-plan.md`](file:///f:/PROJECT/Lucky%20Draw/docs/release-audit/04-production-data-plan.md)
3. **Technical Proof of Production Air-Gap:**
   - `.env.local` in `F:\PROJECT\Lucky Draw` points exclusively to `https://jiyuiydzsfydjklosvvq.supabase.co`. No Production service-role key or connection string exists in the workspace environment.
   - Every scratch script executed during the session (`inspect_and_backup_preview.mjs`, `probe_preview_schema_and_rpcs.mjs`, `execute_preview_clone_and_sanitization.mjs`, `verify_preview_clone_state.mjs`, `read_only_post_clone_audit.mjs`) enforced an explicit runtime guard aborting execution if `!supabaseUrl.includes("jiyuiydzsfydjklosvvq")`.

---

## 3. Actual Preview Mutation History

**Classification:** **`VERIFIED`**

All mutations to Preview Supabase (`jiyuiydzsfydjklosvvq`) occurred via [`execute_preview_clone_and_sanitization.mjs`](file:///C:/Users/Joseph/.gemini/antigravity/brain/f1fe0dbc-6633-4b76-b6b7-fdb3af5bbb02/scratch/execute_preview_clone_and_sanitization.mjs) (executed twice: Run 1 aborted at Step 5 due to `PGRST204` on `order_items.amount_paise`; Run 2 succeeded end-to-end after fixing the column list to `quantity, unit_price_paise, total_amount_paise`) and [`verify_preview_clone_state.mjs`](file:///C:/Users/Joseph/.gemini/antigravity/brain/f1fe0dbc-6633-4b76-b6b7-fdb3af5bbb02/scratch/verify_preview_clone_state.mjs) (which ran 3 negative-test writes blocked by triggers).

### 3.1 Table-by-Table Preview Mutation Ledger (`jiyuiydzsfydjklosvvq`)

| Table Name | Pre-Clone Rows | Post-Clone Rows | Operations Executed | Exact Columns / Records Mutated |
| :--- | :---: | :---: | :--- | :--- |
| `public.roles` | 4 | 4 | None | Untouched. |
| `public.profiles` | 6 | 6 | `UPDATE` (6 rows, executed in Run 1 & Run 2) | Masked `phone` on all 6 profiles to `+919000090001`..`+919000090006` and replaced non-preview `full_name` values. |
| `public.profile_roles` | 5 | 7 | `UPSERT` (`onConflict: "profile_id,role_key"`) | Inserted 2 role assignments: `ADMIN` for profile `9a04809b-c055-4d8e-b8c4-5d05a7cbe2f4` and `FUNDRAISING_MANAGER` for profile `15f934a1-425f-42ce-8754-56ab03b981cb`. |
| `public.campaigns` | 1 | 1 | `UPDATE` (1 row) | Updated `ssfi-fundraising-lucky-draw` (`a2aa9d5e-6a86-45d2-9382-6c7a8d0a272f`): `start_at = 2026-10-31T18:30:00+00:00`, `end_at = 2026-12-19T18:30:00+00:00`, `sold_ticket_count = 33`, `status = ACTIVE`. |
| `public.prizes` | 5 | 5 | None | Untouched. |
| `public.draws` | 0 | 0 | None | Untouched. |
| `public.draw_results` | 0 | 0 | None | Untouched. |
| `public.sellers` | 4 | 4 | `UPDATE` (4 rows, executed in Run 1 & Run 2) | Updated `SELLER-002`, `SELLER-003`, `SELLER-007`, `SELLER-008`: set `upi_id = preview.sellerXXX@upi`, `account_name = [PREVIEW TEST] SELLER-XXX Account`, `qr_storage_path = seller-<id>/preview-synthetic-qr-sellerXXX.png`, `is_qr_active = true`, `qr_updated_at = now()`. |
| `public.customers` | 52 | 52 | `UPDATE` (52 rows, executed in Run 1 & Run 2) | Masked all 52 rows: `full_name = [PREVIEW] Buyer #<id8>`, `phone = 9000000001`..`9000000052`, `whatsapp_number = 9000000001`..`9000000052`, `email = buyer.<id8>@preview-test.invalid`. |
| `public.order_items` | 46 | 51 | `INSERT` (5 rows in Run 2; Run 1 failed with `PGRST204`) | Inserted 5 missing `order_items` rows for the 5 legacy orders that lacked line items, using `(order_id, quantity, unit_price_paise, total_amount_paise)`. |
| `public.orders` | 51 | 51 | `UPDATE` (35 rows where `snapshot_captured_at IS NULL`) + 1 blocked negative test | Populated `snapshot_seller_id`, `snapshot_seller_code`, `snapshot_seller_name`, `snapshot_upi_id` (`preview.seller002@upi` [6], `preview.seller003@upi` [8], `preview.seller007@upi` [21]), `snapshot_account_name`, `snapshot_qr_storage_path`, and `snapshot_captured_at` on the 35 rows where `snapshot_captured_at IS NULL`. The 16 rows where `snapshot_captured_at IS NOT NULL` were **not** updated. |
| `public.payments` | 51 | 51 | `UPDATE` (51 rows) | Replaced `utr_reference` on submitted/verified rows with `PRVUTR000001`..`PRVUTR000051` and `payer_name` with `[PREVIEW] Payer #<id8>`. |
| `public.payment_events` | 127 | 127 | None | Untouched. |
| `public.payment_screenshots` | 12 | 35 | `UPDATE` (12 rows) + `INSERT` (23 rows) | Updated 12 existing rows to point to synthetic `3,922`-byte PNG metadata (`mime_type = image/png`, `byte_size = 3922`, `sha256_checksum`) and inserted 23 new rows so all 35 `SUBMITTED` + `VERIFIED` payments have a synthetic screenshot record. |
| `public.payment_recovery_tokens` | 2 | 2 | None | Untouched. |
| `public.tickets` | 36 | 36 | `UPDATE` (0 rows matched override filter) + 1 blocked negative test | `tickets` had `0` rows with non-null `contact_full_name`/`contact_email`/`contact_whatsapp`. Negative test `UPDATE tickets SET ticket_number = 'SSFI-999999'` was blocked by `trg_protect_ticket_identity_immutability`. |
| `public.ticket_deliveries` | 52 | 52 | `UPDATE` (52 rows) | Masked `recipient` (`buyer.<id8>@preview-test.invalid` or `9000099999`) and scrubbed `[PREVIEW SANITIZED DELIVERY CONTENT]` in `rendered_content`. |
| `public.ticket_verifications` | 0 | 0 | None | Untouched. |
| `public.seller_messages` | 12 | 12 | None | Untouched. |
| `public.order_collaboration_notes` | 0 | 2 | `INSERT` (2 rows) | Inserted 2 synthetic Preview staff collaboration notes (`GENERAL_UPDATE`, `HANDOFF`) on order `d8168da2-3e98-4887-a926-ab396cf787dc`. |
| `public.system_settings` | 2 | 3 | `UPSERT` (2 keys) | Upserted `customer_email_live_enabled = false` and inserted `preview_data_mirror_metadata` (snapshot ID `100295a6-9012-4678-a6b1-e7cfc9ac2ca4`). |
| `public.customer_email_outbox` | 38 | 38 | `UPDATE` (38 rows) | Masked `recipient = buyer.<order8>@preview-test.invalid`, replaced `body_text` and `body_html` with `[PREVIEW SANITIZED EMAIL BODY]`, and transitioned any `PENDING`/`PROCESSING`/`FAILED` rows to `SIMULATED`. |
| `public.audit_logs` | 270 | 270 | 1 blocked `DELETE` negative test during clone verification (note: 8 rows were inserted earlier during the `SUPER_ADMIN` screenshot download task prior to backup) | Zero rows inserted or deleted during the clone workflow. Negative test `DELETE FROM audit_logs` was blocked by `trg_audit_logs_immutable`. |

### 3.2 Trigger & Migration Audit

- **Were any triggers disabled, modified, or bypassed?**
  - **No (`VERIFIED`).** Zero `ALTER TABLE ... DISABLE TRIGGER` or `DROP TRIGGER` statements were executed. No direct PostgreSQL superuser connection was used; all operations ran through `@supabase/supabase-js` PostgREST where database triggers remained active and enforced.
- **Was migration `supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql` executed?**
  - **No (`VERIFIED`).** The migration file was written to the Git repository only (`supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql`) and was **never** executed against Preview (`jiyuiydzsfydjklosvvq`) or Production (`fohpqheglxhfdecadhzw`).

---

## 4. Storage Mutation History

**Classification:** **`VERIFIED`**

All storage mutations occurred in Preview Supabase (`jiyuiydzsfydjklosvvq`) during [`execute_preview_clone_and_sanitization.mjs`](file:///C:/Users/Joseph/.gemini/antigravity/brain/f1fe0dbc-6633-4b76-b6b7-fdb3af5bbb02/scratch/execute_preview_clone_and_sanitization.mjs) via `admin.storage.from(bucket).upload(path, buffer, { contentType: "image/png", upsert: true })`. Zero storage objects were deleted (`remove` was never called).

### 4.1 `seller-payment-qrs` Bucket (`public: false`)

1. **4 New Synthetic Seller QR Objects Uploaded (`3,780` bytes each, `image/png`):**
   - `seller-fd10bd88-db31-4270-b4d0-ffe3c1ef9204/preview-synthetic-qr-seller002.png` (`updated_at: 2026-11-07T10:45:55.635Z`)
   - `seller-e4f8eccf-d4b3-447e-92ce-35400b57754d/preview-synthetic-qr-seller003.png` (`updated_at: 2026-11-07T10:45:56.035Z`)
   - `seller-edebd069-4bea-4f69-8afd-f34743def4ab/preview-synthetic-qr-seller007.png` (`updated_at: 2026-11-07T10:45:56.324Z`)
   - `seller-42fbf809-3c83-4e80-8c42-1315de26f2e0/preview-synthetic-qr-seller008.png` (`updated_at: 2026-11-07T10:45:57.081Z`)
2. **4 Pre-Existing Historical QR Object Paths Overwritten In-Place (`upsert: true`, `3,780` bytes each, `image/png`):**
   - `seller-edebd069-4bea-4f69-8afd-f34743def4ab/e2e-test-qr.png` (`updated_at: 2026-11-07T10:45:57.335Z`)
   - `seller-42fbf809-3c83-4e80-8c42-1315de26f2e0/363ae012-a392-4762-a001-e3ac6425e30d.jpg` (`updated_at: 2026-11-07T10:45:57.502Z`)
   - `seller-42fbf809-3c83-4e80-8c42-1315de26f2e0/ed514d00-37cd-4bbe-be1c-95f566166f0c.jpg` (`updated_at: 2026-11-07T10:45:57.664Z`)
   - `seller-42fbf809-3c83-4e80-8c42-1315de26f2e0/b3832460-272b-4639-a083-a7788e947617.jpg` (`updated_at: 2026-11-07T10:45:57.818Z`)

### 4.2 `payment-screenshots` Bucket (`public: false`)

1. **12 Pre-Existing Payment Screenshot Objects Overwritten In-Place (`upsert: true`, `3,922` bytes each, `image/png`):**
   - Overwrote all 12 existing object paths referenced by pre-clone `public.payment_screenshots` rows with watermarked synthetic `PREVIEW TEST RECEIPT` PNG images.
2. **23 New Synthetic Payment Screenshot Objects Uploaded (`3,922` bytes each, `image/png`):**
   - Uploaded 23 new `<uuid>.png` synthetic `PREVIEW TEST RECEIPT` PNG images for the remaining `SUBMITTED` and `VERIFIED` payments that previously had no `payment_screenshots` row.
   - Total root entries in `payment-screenshots` increased from `14` to `37` (`35` linked to `public.payment_screenshots` rows + `2` unreferenced pre-existing folder/object entries).

---

## 5. Backup Integrity and Restore Readiness

**Classification:** **`PARTIALLY VERIFIED` (`NOT RESTORE-VERIFIED`)**

### 5.1 Pre-Clone Backup File Metrics

- **Backup File Path:** [`backups/preview-database-backup-20261107.json`](file:///f:/PROJECT/Lucky%20Draw/backups/preview-database-backup-20261107.json)
- **File Size:** `909,075` bytes (`887.77 KB`)
- **SHA-256 Checksum:** `63cece903e29690c13a9efb08365569d99519dc40aaa800f0a5aa6ceb6e858bf`
- **Captured Timestamp:** `2026-11-07T10:34:21.313Z`
- **Captured Git Commit:** `304134d69712b4d89a1475688dde031cc3f51a2a` (`preview/production-mirror`)

### 5.2 Backup Table & Storage Manifest

| Resource Type | Resource Name | Pre-Clone Count in Backup | Backup Fidelity |
| :--- | :--- | :---: | :--- |
| Table | `roles` | 4 | Full JSON row data (`VERIFIED`) |
| Table | `profiles` | 6 | Full JSON row data (`VERIFIED`) |
| Table | `profile_roles` | 5 | Full JSON row data (`VERIFIED`) |
| Table | `campaigns` | 1 | Full JSON row data (`VERIFIED`) |
| Table | `prizes` | 5 | Full JSON row data (`VERIFIED`) |
| Table | `draws` | 0 | Full JSON row data (`VERIFIED`) |
| Table | `draw_results` | 0 | Full JSON row data (`VERIFIED`) |
| Table | `sellers` | 4 | Full JSON row data (`VERIFIED`) |
| Table | `customers` | 52 | Full JSON row data (`VERIFIED`) |
| Table | `orders` | 51 | Full JSON row data (`VERIFIED`) |
| Table | `order_items` | 46 | Full JSON row data (`VERIFIED`) |
| Table | `payments` | 51 | Full JSON row data (`VERIFIED`) |
| Table | `payment_events` | 127 | Full JSON row data (`VERIFIED`) |
| Table | `payment_screenshots` | 12 | Full JSON row data (`VERIFIED`) |
| Table | `payment_recovery_tokens` | 2 | Full JSON row data (`VERIFIED`) |
| Table | `tickets` | 36 | Full JSON row data (`VERIFIED`) |
| Table | `ticket_deliveries` | 52 | Full JSON row data (`VERIFIED`) |
| Table | `ticket_verifications` | 0 | Full JSON row data (`VERIFIED`) |
| Table | `seller_messages` | 12 | Full JSON row data (`VERIFIED`) |
| Table | `order_collaboration_notes` | 0 | Full JSON row data (`VERIFIED`) |
| Table | `system_settings` | 2 | Full JSON row data (`VERIFIED`) |
| Table | `customer_email_outbox` | 38 | Full JSON row data (`VERIFIED`) |
| Table | `audit_logs` | 270 | Full JSON row data (`VERIFIED`) |
| Storage Bucket | `payment-screenshots` | 14 root entries | **Metadata only** — raw binary image bytes were **not** downloaded (`FAILED` for binary restore) |
| Storage Bucket | `seller-payment-qrs` | 2 root folders | **Metadata only** — raw binary image bytes were **not** downloaded (`FAILED` for binary restore) |

### 5.3 Restore Verification Status

- **JSON Parse & Structural Integrity:** **`VERIFIED`** (`JSON.parse` succeeds cleanly; all 23 tables and `686` rows are intact).
- **Disposable Database Restore Test:** **`NOT VERIFIED` (`NOT RESTORE-VERIFIED`)**. The backup has not been re-imported into an isolated test database, and restoring rows protected by immutability triggers (`orders.snapshot_*`, `tickets.ticket_number`) or restoring the overwritten binary images in `payment-screenshots` / `seller-payment-qrs` cannot be done from this JSON file alone without superuser trigger management (for DB rows) and is impossible for the overwritten storage binary blobs.

---

## 6. Historical UPI Snapshot Audit

**Classification:** **`FAILED` (16 Pre-Existing Order Rows Retain Non-Synthetic `snapshot_upi_id` Values in `public.orders`)**

### 6.1 Complete Breakdown of All 51 Orders in `public.orders` (`jiyuiydzsfydjklosvvq`)

| Snapshot Category | Order Count | Masked `snapshot_upi_id` | Masked `snapshot_account_name` | `snapshot_qr_storage_path` Values | Storage Binary Status |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **Newly Populated Synthetic Snapshots** (Previously `snapshot_captured_at IS NULL`) | **6** | `preview.seller002@upi` | `[PREVIEW TEST] SELLER-002 Account` | `seller-fd10bd88-db31-4270-b4d0-ffe3c1ef9204/preview-synthetic-qr-seller002.png` | Synthetic `3,780`-byte PNG (`VERIFIED`) |
| **Newly Populated Synthetic Snapshots** (Previously `snapshot_captured_at IS NULL`) | **8** | `preview.seller003@upi` | `[PREVIEW TEST] SELLER-003 Account` | `seller-e4f8eccf-d4b3-447e-92ce-35400b57754d/preview-synthetic-qr-seller003.png` | Synthetic `3,780`-byte PNG (`VERIFIED`) |
| **Newly Populated Synthetic Snapshots** (Previously `snapshot_captured_at IS NULL`) | **21** | `preview.seller007@upi` | `[PREVIEW TEST] SELLER-007 Account` | `seller-edebd069-4bea-4f69-8afd-f34743def4ab/preview-synthetic-qr-seller007.png` | Synthetic `3,780`-byte PNG (`VERIFIED`) |
| **Pre-Existing Historical Snapshots** (`snapshot_captured_at IS NOT NULL` prior to clone) | **7** | `ssfi******@okaxis` | `SSF***` | `seller-edebd069-4bea-4f69-8afd-f34743def4ab/e2e-test-qr.png` | Overwritten in Storage with synthetic `3,780`-byte PNG (`VERIFIED`), **but DB text column still holds `ssfi******@okaxis` (`FAILED`)** |
| **Pre-Existing Historical Snapshots** (`snapshot_captured_at IS NOT NULL` prior to clone) | **9** | `8810******@ptyes` | `JO***` | `seller-42fbf809-3c83-4e80-8c42-1315de26f2e0/{363ae012-..., ed514d00-..., b3832460-...}.jpg` | Overwritten in Storage with synthetic `3,780`-byte PNG (`VERIFIED`), **but DB text column still holds `8810******@ptyes` (`FAILED`)** |
| **Total Orders** | **51** | — | — | — | — |

### 6.2 Answers to Mandatory Historical Snapshot Questions

1. **How many orders contain historical `snapshot_upi_id` values?**
   - **`16` orders** (out of `51` total orders) still contain non-synthetic historical `snapshot_upi_id` values (`7` rows with `ssfi******@okaxis` and `9` rows with `8810******@ptyes`).
2. **Do any historical orders contain real or previously configured UPI IDs?**
   - **Yes (`FAILED`).** Those `16` orders retain the pre-existing UPI strings (`ssfi******@okaxis` and `8810******@ptyes`) and account names (`SSF***` and `JO***`) in `public.orders.snapshot_upi_id` and `public.orders.snapshot_account_name`.
   - **Why:** The PostgreSQL BEFORE UPDATE trigger `trg_protect_order_payment_snapshot` (`public.protect_order_payment_snapshot()`) raises an exception whenever any update attempts to change `snapshot_upi_id`, `snapshot_account_name`, or `snapshot_qr_storage_path` on a row where `OLD.snapshot_captured_at IS NOT NULL`. Because the clone script ran via PostgREST without disabling triggers, `execute_preview_clone_and_sanitization.mjs` only updated the `35` orders where `snapshot_captured_at IS NULL`.
3. **Do any historical orders reference old QR paths in `snapshot_qr_storage_path`?**
   - **Yes, by path string (`16` orders), but the files at those paths were replaced:** The `16` orders reference `4` historical paths (`seller-edebd069-4bea-4f69-8afd-f34743def4ab/e2e-test-qr.png` and `3` paths under `seller-42fbf809-3c83-4e80-8c42-1315de26f2e0/*.jpg`).
4. **Are any old QR objects still present in `seller-payment-qrs`?**
   - **No original QR binary images remain (`VERIFIED`).** All `8` objects currently inside `seller-payment-qrs` (`4` new `preview-synthetic-qr-sellerXXX.png` files + `4` historical paths) were overwritten at `2026-11-07T10:45:55Z–57Z` with `3,780`-byte synthetic `PREVIEW TEST ONLY` PNG images.

---

## 7. Sanitization Verification

**Classification:** **`PARTIALLY VERIFIED` (`VERIFIED` across `customers`, `sellers`, `profiles`, `payments`, `payment_screenshots`, `tickets`, `ticket_deliveries`, `customer_email_outbox`; `FAILED` on `16` historical `orders.snapshot_upi_id` rows)**

| Sanitization Check | Target Table / Bucket | Expected Rule | Actual Result in Preview (`jiyuiydzsfydjklosvvq`) | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Customer Emails** | `public.customers` (`52` rows) | All end in `@preview-test.invalid` | `52 / 52` match `buyer.<hash>@preview-test.invalid` (`0` real emails) | **`VERIFIED`** |
| **Customer Phone & WhatsApp** | `public.customers` (`52` rows) | Synthetic `9000000001`..`9000000052` | `52 / 52` match `9000000001`..`9000000052` (`0` real phones) | **`VERIFIED`** |
| **Customer Full Names** | `public.customers` (`52` rows) | Synthetic `[PREVIEW] Buyer #<hash>` | `52 / 52` match `[PREVIEW] Buyer #<hash>` (`0` real names) | **`VERIFIED`** |
| **Staff Profile Phones** | `public.profiles` (`6` rows) | Synthetic `+919000090001`..`06` | `6 / 6` match `+919000090001`..`+919000090006` (`0` real phones) | **`VERIFIED`** |
| **Active Seller UPI IDs** | `public.sellers` (`4` rows) | Synthetic `preview.sellerXXX@upi` | `4 / 4` (`SELLER-002`, `003`, `007`, `008`) match `preview.sellerXXX@upi` | **`VERIFIED`** |
| **Active Seller QR Paths** | `public.sellers` (`4` rows) | Synthetic `preview-synthetic-qr-sellerXXX.png` | `4 / 4` reference `3,780`-byte watermarked `PREVIEW TEST ONLY` PNGs | **`VERIFIED`** |
| **Order Snapshot UPI IDs** | `public.orders` (`51` rows) | All `51` rows synthetic | `35 / 51` hold `preview.sellerXXX@upi`; **`16 / 51` retain `ssfi******@okaxis` (7) or `8810******@ptyes` (9)** | **`FAILED`** |
| **Payment UTR References** | `public.payments` (`51` rows) | Synthetic `PRVUTR0000XX` | `100%` of non-null UTRs match `PRVUTR000001`..`PRVUTR000051` (`0` real UTRs) | **`VERIFIED`** |
| **Payment Payer Names** | `public.payments` (`51` rows) | Synthetic `[PREVIEW] Payer #<hash>` | `51 / 51` match `[PREVIEW] Payer #<hash>` (`0` real payer names) | **`VERIFIED`** |
| **Payment Screenshots** | `public.payment_screenshots` (`35` rows) & Storage | Synthetic `3,922`-byte `PREVIEW TEST RECEIPT` PNG | `35 / 35` submitted/verified payments linked to `3,922`-byte synthetic PNGs | **`VERIFIED`** |
| **Ticket Contact Overrides** | `public.tickets` (`36` rows) | Null or `[PREVIEW OVERRIDE]` | `0` rows have overrides (`0` unsanitized overrides) | **`VERIFIED`** |
| **Outbound Email Kill-Switch** | `public.system_settings` | `customer_email_live_enabled = false` | `customer_email_live_enabled = false`; all `38` `customer_email_outbox` rows sanitized & `SIMULATED`/`SENT` | **`VERIFIED`** |

---

## 8. RLS and RPC Security Verification

**Classification:** **`PARTIALLY VERIFIED`**

### 8.1 Read-Only Anonymous (`anon`) Access Probes

| Table | `anon` `SELECT` Result | Security Assessment | Status |
| :--- | :--- | :--- | :--- |
| `public.orders` | `0` rows (`error: null`) | Anonymous users cannot read orders | **`VERIFIED`** |
| `public.customers` | `0` rows (`error: null`) | Anonymous users cannot read customers | **`VERIFIED`** |
| `public.payments` | `0` rows (`error: null`) | Anonymous users cannot read payments | **`VERIFIED`** |
| `public.payment_screenshots` | `0` rows (`42501: permission denied for table payment_screenshots`) | Table privilege revoked from `anon` | **`VERIFIED`** |
| `public.tickets` | `0` rows (`error: null`) | Anonymous users cannot enumerate tickets directly (must use `verify_ticket_public` RPC) | **`VERIFIED`** |
| `public.sellers` | `0` rows (`error: null`) | Anonymous users cannot enumerate sellers directly (must use `resolve_Checkout_seller` RPC) | **`VERIFIED`** |
| `public.audit_logs` | `0` rows (`error: null`) | Anonymous users cannot read audit logs | **`VERIFIED`** |
| `public.campaigns` | `0` rows (`42501: permission denied for function is_staff`) | RLS policy `campaigns_public_read` calls `public.is_staff(auth.uid())`, which had `EXECUTE` revoked from `anon` in `202610300001_p0_security_remediation.sql` | **`FAILED` (for direct `anon` PostgREST queries)** |
| `public.prizes` | `0` rows (`42501: permission denied for function is_staff`) | RLS policy `prizes_public_read` calls `public.is_staff(auth.uid())`, which had `EXECUTE` revoked from `anon` in `202610300001_p0_security_remediation.sql` | **`FAILED` (for direct `anon` PostgREST queries)** |

### 8.2 Trigger & Role Authorization Verification

1. **Audit Logs Append-Only Protection (`public.audit_logs`):** **`VERIFIED`**
   - Trigger `trg_audit_logs_immutable` blocks `UPDATE` and `DELETE` even when called with the `service_role` key (`audit_logs is append-only; UPDATE and DELETE are prohibited`).
2. **Ticket Identity Immutability (`public.tickets`):** **`VERIFIED`**
   - Trigger `trg_protect_ticket_identity_immutability` blocks changing `ticket_number`, `order_id`, `campaign_id`, or `customer_id` even with `service_role` (`Ticket identity fields (ticket_number, order_id, campaign_id, customer_id) are immutable`).
3. **Order Payment Snapshot Immutability (`public.orders`):** **`VERIFIED`**
   - Trigger `trg_protect_order_payment_snapshot` blocks modifying `snapshot_*` columns once `snapshot_captured_at IS NOT NULL` (`Order seller payment snapshot is immutable once captured`).
4. **Payment Screenshot Download Authorization (`SUPER_ADMIN` Only):** **`VERIFIED`**
   - Verified in [`src/server/actions/paymentScreenshot.ts`](file:///f:/PROJECT/Lucky%20Draw/src/server/actions/paymentScreenshot.ts#L118-L214) and [`tests/paymentScreenshot.test.ts`](file:///f:/PROJECT/Lucky%20Draw/tests/paymentScreenshot.test.ts#L1-L215) (`23/23` unit tests passing) and live database audit trail (`PAYMENT_SCREENSHOT_DOWNLOAD_SUCCEEDED` for `SUPER_ADMIN`, `PAYMENT_SCREENSHOT_DOWNLOAD_DENIED` for `ADMIN`, `FINANCE_ADMIN`, `FUNDRAISING_MANAGER`, and `SELLER`).

---

## 9. Ticket Integrity Verification

**Classification:** **`PARTIALLY VERIFIED`**

1. **Public Verification Route (`/verify/[ticketNumber]`):** **`VERIFIED`**
   - Updated in [`src/app/verify/[ticketNumber]/page.tsx`](file:///f:/PROJECT/Lucky%20Draw/src/app/verify/%5BticketNumber%5D/page.tsx#L13-L61) (deployed in commit `6646f903e169cf7194d759efc12f1236e17906cf` to Preview `dpl_91ZpeV7BsFALgeeLwcPkNb3CG5Eu`).
   - Accepts `PRV-SSFI-000001`, `PRV-000001`, or `SSFI-000001`, resolves the underlying Preview record via `verify_ticket_public`, displays `PRV-SSFI-XXXXXX` in the UI when `NEXT_PUBLIC_SUPABASE_URL` is not Production (`fohpqheglxhfdecadhzw`), and renders an amber warning banner: *"Preview Environment Verification Only — This ticket record belongs to the non-production Preview test environment (`PRV-` namespace) and is not a valid Production lucky draw entry."*
2. **Database Ticket Numbers (`public.tickets`):** **`VERIFIED`**
   - All `36` rows in `public.tickets` follow the `^SSFI-\d{6}$` check constraint (`tickets_number_format_chk`) and are protected by `trg_protect_ticket_identity_immutability`.
3. **Newly Issued Preview Ticket Namespace (`PRV-` Database / Email Prefixing):** **`PARTIALLY VERIFIED`**
   - Because `supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql` was not executed on the Preview database, `public.verify_ticket_public(text)` at the SQL layer and outbound email templates do not yet transform `PRV-` inside PostgreSQL itself (currently handled at the Next.js `/verify/[ticketNumber]` page layer).

---

## 10. Git and Vercel Verification

**Classification:** **`PARTIALLY VERIFIED`**

### 10.1 Git Repository State

- **Current Branch:** `preview/production-mirror` (`VERIFIED`)
- **Latest Commit SHA on `preview/production-mirror`:** `6646f903e169cf7194d759efc12f1236e17906cf` (`feat(preview-clone): complete production-to-preview schema diff, sanitized data mirror, and ticket verification isolation`)
- **Commit Author Name & Email:** `Joseph <robinsonjoseph.va@gmail.comclear>`
  - **Audit Note (`PARTIALLY VERIFIED`):** The local Git configuration `user.email` contains a trailing `clear` suffix (`robinsonjoseph.va@gmail.comclear`), which was recorded on the recent commits on `preview/production-mirror`. Per the execution freeze, commits have **not** been amended or rewritten.
- **Working Tree Status:** Clean prior to generating this report (`docs/security/POST_CLONE_SECURITY_AUDIT.md` is left uncommitted in the working tree per instructions).
- **Production Branch (`main` / `origin/main`):**
  - `origin/main` is at `36d39c837114815ed69d428551527d7541f4bf93` (local `main` ref is at `1aa7081185bd481fd71f5d61daaa862f7f3468a0`). Neither `main` nor `origin/main` was modified or pushed (`VERIFIED`).

### 10.2 Vercel Deployment State

- **Preview Deployment ID:** `dpl_91ZpeV7BsFALgeeLwcPkNb3CG5Eu`
- **Preview Deployment Commit:** `6646f903e169cf7194d759efc12f1236e17906cf`
- **Preview Deployment URL:** `https://ssfiticket-git-preview-production-mirror-rose1996ivs-projects.vercel.app`
- **Target Environment:** `preview` (`READY`)
- **Production Deployment:** Untouched (`VERIFIED`).

---

## 11. Security Risks and Outstanding Issues

1. **[HIGH — DATA SANITIZATION GAP] 16 Historical Orders in `public.orders` Still Retain Non-Synthetic `snapshot_upi_id` and `snapshot_account_name` Values (`FAILED`):**
   - **Details:** `16` pre-existing orders (`snapshot_captured_at IS NOT NULL`) still contain `ssfi******@okaxis` (`7` rows) and `8810******@ptyes` (`9` rows) in `public.orders.snapshot_upi_id` because `trg_protect_order_payment_snapshot` prevented PostgREST updates to captured snapshots.
   - **Mitigating Factor:** The `4` QR image objects in `seller-payment-qrs` referenced by those `16` orders were overwritten with synthetic `3,780`-byte `PREVIEW TEST ONLY` PNGs, and all `4` sellers in `public.sellers` use `preview.sellerXXX@upi`. However, staff viewing those `16` historical orders in the Admin Portal or Pending Payments page will still see the historical `snapshot_upi_id` text string until a controlled SQL remediation updates those `16` rows.
2. **[MEDIUM — BACKUP & STORAGE RECOVERY LIMITATION] Pre-Clone Backup Did Not Capture Binary Storage Blobs (`PARTIALLY VERIFIED` / `NOT RESTORE-VERIFIED`):**
   - **Details:** `backups/preview-database-backup-20261107.json` captured all `686` database rows across `23` tables and storage object metadata, but did **not** download the raw binary image files of the `12` pre-existing payment screenshots or `4` pre-existing seller QR files before `upsert: true` replaced them with synthetic PNGs. Those pre-clone test images in Preview storage cannot be restored from the JSON backup.
3. **[LOW — DIRECT `anon` RLS POLICY REGRESSION] `public.is_staff(uuid)` Permission Denied for `anon` on Direct `campaigns` / `prizes` Queries (`FAILED`):**
   - **Details:** Direct `anon` PostgREST queries to `campaigns` and `prizes` fail with `42501: permission denied for function is_staff` because `202611070002_preview_clone_alignment_and_isolation.sql` (which restores `GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO anon, authenticated, service_role`) has not yet been executed in the Preview Supabase SQL Editor.
4. **[LOW — GIT METADATA] Typo in Local Git `user.email` (`robinsonjoseph.va@gmail.comclear`):**
   - **Details:** Local Git config `user.email` has a trailing `clear` string attached to the email address.

---

## 12. Recovery and Remediation Recommendations

> [!IMPORTANT]
> **All actions below are strictly recommendations requiring explicit Project Owner approval before execution. No remediation has been executed during this freeze.**

1. **Remediate the 16 Historical `public.orders` Snapshot Rows (Requires Owner Approval for Controlled SQL Execution in Preview `jiyuiydzsfydjklosvvq`):**
   - With explicit owner authorization, execute a single transaction in the Preview Supabase SQL Editor (`jiyuiydzsfydjklosvvq` only) that temporarily disables `trg_protect_order_payment_snapshot`, updates the `16` rows in `public.orders` where `snapshot_upi_id NOT LIKE 'preview.%@upi'` to set `snapshot_upi_id = 'preview.seller007@upi'`, `snapshot_account_name = '[PREVIEW TEST] SELLER-007 Account'`, and `snapshot_qr_storage_path = 'seller-edebd069-4bea-4f69-8afd-f34743def4ab/preview-synthetic-qr-seller007.png'`, and immediately re-enables `trg_protect_order_payment_snapshot` within the same `BEGIN ... COMMIT` block.
2. **Apply `supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql` in Preview (`jiyuiydzsfydjklosvvq`) (Requires Owner Approval):**
   - Review and approve running `202611070002_preview_clone_alignment_and_isolation.sql` in the Preview Supabase SQL Editor to restore `GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO anon, authenticated, service_role` (fixing the `42501` error on direct `anon` reads of `campaigns` and `prizes`) and enable SQL-level `PRV-` normalization in `public.verify_ticket_public(text)`.
3. **Enforce Binary Storage Export in Future Pre-Migration Backup Scripts:**
   - Update backup scripts so that before any storage `upsert` or cleanup runs in Preview, every object in `payment-screenshots` and `seller-payment-qrs` is downloaded via `storage.from(bucket).download(path)` into `backups/storage-blobs-<timestamp>/` with a SHA-256 manifest, and verify restoration in an isolated test schema before any mutation phase proceeds.
4. **Fix Local Git Author Email Configuration:**
   - Run `git config user.email "robinsonjoseph.va@gmail.com"` (removing the trailing `clear` typo) before making any future commits.

