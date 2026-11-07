# SSFI — Phase 6B.1: Migration Preflight & Backup Readiness Report

**Document ID:** `PHASE_6B_1_MIGRATION_PREFLIGHT_REPORT`  
**Date:** 2026-11-07  
**Branch:** `preview/production-mirror`  
**Execution Mode:** `PREFLIGHT & READINESS AUDIT ONLY` (Zero Database Writes, Zero Migrations Applied, Zero Git Commits)  
**Target Database:** Preview Supabase (`jiyuiydzsfydjklosvvq`) — **FROZEN / UNTOUCHED**  
**Air-Gapped Database:** Production Supabase (`fohpqheglxhfdecadhzw`) — **UNTOUCHED / AIR-GAPPED**  

---

## 1. Step 1 — Project & Target Identity Verification

| Verification Item | Target / Invariant | Inspected Value | Status |
|---|---|---|:---:|
| **Git Working Branch** | `preview/production-mirror` | `preview/production-mirror` (`git status`) | `VERIFIED` |
| **Git Working Tree State** | Clean except Phase 6A local changes | Uncommitted local files isolated on preview branch | `VERIFIED` |
| **Production Branch (`main`)** | Completely untouched | Zero modifications or checkouts on `main` | `VERIFIED` |
| **Active Supabase Target URL** | `https://jiyuiydzsfydjklosvvq.supabase.co` | `NEXT_PUBLIC_SUPABASE_URL=jiyuiydzsfydjklosvvq` | `VERIFIED` |
| **Production Air-Gap Guard** | Production (`fohpqheglxhfdecadhzw`) NOT target | Confirmed zero references to Production in active config | `VERIFIED` |

> [!IMPORTANT]
> **TARGET POSITIVELY VERIFIED:** The active target is confirmed to be Preview Supabase (`jiyuiydzsfydjklosvvq`). Production Supabase (`fohpqheglxhfdecadhzw`) is air-gapped and will never be contacted.

---

## 2. Step 2 — Migration Files Review & Cryptographic Hashes

All three migration candidate files have been inspected for syntax, transaction boundaries, security modes, and privilege grants.

### 2.1 SHA-256 Checksums

| File Path | SHA-256 Digest | Size (Bytes) |
|---|---|:---:|
| `docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql` | `A6274E2A9FF04ADC2A01C90BC4FF9F5F4E9A53566C084CA88E223ADB9D7F623E` | 3,923 |
| `supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql` | `F38E38CDD89EBA9F62898A4D8739FD8942EFF202886A777DFB5C2B9ECEEA4597` | 2,752 |
| `docs/security/PHASE_5_REVISED_SECURITY_MIGRATIONS.sql` | `BA739B6AFDA965663851F8955DBF824CFE2A028D87544400F595F8B218AA2EF9` | 21,791 |

---

### 2.2 Deep Code & Security Review by File

#### File 1: `docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql`
- **SHA-256:** `A6274E2A9FF04ADC2A01C90BC4FF9F5F4E9A53566C084CA88E223ADB9D7F623E`
- **Purpose:** Resolves the P1 `42501` permission error for anonymous visitors reading campaigns/prizes by splitting RLS policies into `anon` and `authenticated` roles, while strictly keeping `public.is_staff(uuid)` revoked from `PUBLIC` and `anon`.
- **Transaction Boundaries:** Wrapped in `BEGIN ... COMMIT`.
- **Security Mode:** `SECURITY DEFINER` on `is_staff(uuid)`.
- **Privilege Grants:**
  - `REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;`
  - `GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;`
  - `GRANT SELECT ON TABLE public.campaigns TO anon, authenticated, service_role;`
  - `GRANT SELECT ON TABLE public.prizes TO anon, authenticated, service_role;`
- **RLS Policies:**
  - `campaigns_anon_active_read`: `FOR SELECT TO anon USING (status = 'ACTIVE'::public.campaign_status)` (Never calls `is_staff`).
  - `campaigns_authenticated_read`: `FOR SELECT TO authenticated USING ((status = 'ACTIVE'::public.campaign_status) OR public.is_staff(auth.uid()))`.
  - `prizes_anon_active_read`: `FOR SELECT TO anon USING (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = prizes.campaign_id AND c.status = 'ACTIVE'::public.campaign_status))`.
  - `prizes_authenticated_read`: `FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = prizes.campaign_id AND c.status = 'ACTIVE'::public.campaign_status) OR public.is_staff(auth.uid()))`.
- **Dependencies:** `public.campaigns`, `public.prizes`, `public.is_staff(uuid)`.
- **Irreversible Operations:** None. Fully reversible via the included rollback block.
- **Risk Level:** **LOW**. Zero data rows modified.

#### File 2: `supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql`
- **SHA-256:** `F38E38CDD89EBA9F62898A4D8739FD8942EFF202886A777DFB5C2B9ECEEA4597`
- **Purpose:** Performance indexing, excess trigger privilege revocation, and storage bucket lockdown.
- **Transaction Boundaries:** Wrapped in `BEGIN ... COMMIT`.
- **Privilege Revocations:**
  - `REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;`
  - `REVOKE ALL ON FUNCTION public.trg_seller_messages_populate_snapshot() FROM public, anon, authenticated;`
- **Indexes Created (`IF NOT EXISTS`):**
  - `orders_snapshot_seller_idx` on `public.orders(snapshot_seller_id)`
  - `orders_created_at_desc_idx` on `public.orders(created_at DESC)`
  - `payments_submitted_at_idx` on `public.payments(submitted_at DESC NULLS LAST)`
  - `payments_seller_review_status_idx` on `public.payments(seller_review_status)`
  - `audit_logs_action_created_idx` on `public.audit_logs(action, created_at DESC)`
- **Storage Buckets Hardened:** Enforces `public = false`, 2MB size limit, and MIME whitelist on `payment-screenshots` and `seller-payment-qrs`.
- **Dependencies:** `public.orders`, `public.payments`, `public.audit_logs`, `storage.buckets`.
- **Irreversible Operations:** None.
- **Risk Level:** **LOW**. Purely additive indexes and least-privilege revocations.

#### File 3: `docs/security/PHASE_5_REVISED_SECURITY_MIGRATIONS.sql`
- **SHA-256:** `BA739B6AFDA965663851F8955DBF824CFE2A028D87544400F595F8B218AA2EF9`
- **Purpose:** Customer order access token architecture (`P0-1`), hardened trigger immutability (`SEC-05`), controlled historical snapshot sanitization (`SEC-06`), and post-execution unconditional trigger lockdown.
- **Transaction Boundaries:** Wrapped in `BEGIN ... COMMIT`.
- **Functions Defined:**
  1. `public.issue_customer_order_access_token(p_order_id uuid, p_token_hash text, p_expires_in_days integer DEFAULT 7)`: `SECURITY DEFINER SET search_path = public`. Service-role only.
  2. `public.verify_order_payment_access(p_order_id uuid, p_token_hash text, p_access_mode text DEFAULT 'READ')`: `SECURITY DEFINER SET search_path = public`. Service-role only. Explicit 3-mode verification (`READ`, `WRITE`, `CONSUME_WRITE`).
  3. `public.protect_order_payment_snapshot()`: Trigger function on `public.orders`. Enforces that snapshot fields cannot be modified once captured. Features in-trigger verification for allowlisted orders (`ORD-2026-000031`..`000046`) matching `^preview\.[a-z0-9_]+@upi$` under explicit caller context.
  4. `public.admin_sanitize_preview_historical_order_snapshots(p_actor_user_id uuid, p_reason text)`: `SECURITY DEFINER SET search_path = public`. Restricted to `SUPER_ADMIN`. Explicit allowlist of 16 orders, count assertion (`v_sanitized_count IN (0, 16)` and `v_already_synthetic_count = 16`).
  5. `public.lock_order_payment_snapshot_trigger_unconditional()`: `SECURITY DEFINER SET search_path = public`. Service-role only. Restores trigger to unconditional zero-GUC body.
- **Irreversible Operations:** None in the DDL migration itself (DDL defines the functions; sanitization data mutation is invoked separately).
- **Risk Level:** **MEDIUM** (DDL modifies trigger function and RPCs; verified locally on PostgreSQL 18.6).

---

## 3. Step 3 — Backup Readiness Verification

### 3.1 Comprehensive Backup Assessment Across All 4 Database & Storage Layers

| Layer | Available Artifact / Location | Completeness Assessment | Recoverability Evaluation |
|---|---|---|---|
| **1. Database Schema** | `backups/production-public-schema.sql` + 19 migration files in `supabase/migrations/` | **Partial** — Full DDL definitions exist across SQL files, but no standalone point-in-time `pg_dump` of Preview DDL exists locally. | High — Schema can be reconstructed via migrations, but lacks point-in-time catalog state. |
| **2. Database Rows** | [`backups/preview-database-backup-20261107.json`](file:///f:/PROJECT/Lucky%20Draw/backups/preview-database-backup-20261107.json)<br>(776 rows across 23 tables, 909 KB) | **Partial JSON Representation** — Captured at `2026-11-07T09:56:04Z`. Contains raw table rows. | **NOT A ONE-CLICK RESTORE BACKUP**. Restoring from JSON requires multi-pass handling for circular foreign keys (`tickets`), auth stub injection, and trigger truncation (`R-1`..`R-5`). |
| **3. Storage Metadata** | Database table `storage.buckets` | **Partial** — Bucket configuration exists; individual object metadata rows in `storage.objects` are not backed up locally. | Low — Cannot reconstruct historical object upload timestamps or owner links without Supabase Cloud metadata. |
| **4. Storage Binary Files** | Remote Supabase Cloud S3 storage buckets (`payment-screenshots`, `seller-payment-qrs`) | **NONE LOCALLY** — Physical binary image files (payment screenshots and seller QR images) are hosted in Supabase Cloud. Zero binary files are stored in the git repository or JSON backup. | Dependent on Supabase Cloud storage availability. |

> [!CAUTION]
> **BACKUP DEFICIT NOTICE:** The existing `backups/preview-database-backup-20261107.json` file is a table data snapshot, **not a complete, recoverable disaster recovery backup**. It contains zero binary storage files and zero `storage.objects` metadata.  
> However, because Phase 6B migrations (Steps 1, 2, and 3) are **strictly additive DDL** that modify zero table rows and drop zero tables, the risk of data loss from applying the schema migrations is extremely low.  
> The only data-modifying operation is Step 4 (sanitizing 16 historical orders), which is gated under explicit separate approval.

---

## 4. Step 4 — Ordered Migration Execution Plan

The execution plan separates non-destructive DDL migrations from data mutations:

```mermaid
flowchart TD
    subgraph Phase 6B-A: Schema DDL Migrations
        M1["Step 1: Execute PHASE_5_RLS_POLICY_MIGRATION.sql<br>(Split Campaigns & Prizes RLS)"] --> M2["Step 2: Execute 202611070002 Migration<br>(Pagination Indexes & Storage Bucket Hardening)"]
        M2 --> M3["Step 3: Execute PHASE_5_REVISED_SECURITY_MIGRATIONS.sql<br>(Token RPCs & Hardened Trigger Function)"]
    end

    subgraph Phase 6B-B: Verification Gate
        M3 --> V1{"Verify Schema & RPCs<br>on Preview Supabase"}
    end

    subgraph Phase 6B-C: Controlled Data Mutation (Separate Approval)
        V1 -->|Approved| M4["Step 4: Execute Historical Order Sanitization RPC<br>(admin_sanitize_preview_historical_order_snapshots)"]
        M4 --> M5["Step 5: Execute Permanent Trigger Lockdown<br>(lock_order_payment_snapshot_trigger_unconditional)"]
    end
```

---

### Migration 1: Split RLS Policies (Campaigns & Prizes)

- **File:** `docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql`
- **SHA-256:** `A6274E2A9FF04ADC2A01C90BC4FF9F5F4E9A53566C084CA88E223ADB9D7F623E`
- **Purpose:** Resolves the P1 `42501: permission denied for function is_staff` error for anonymous visitors without granting `anon` execute permissions on `is_staff`.
- **Target Database:** Preview Supabase (`jiyuiydzsfydjklosvvq`)
- **Operations:**
  - Revokes `is_staff` from `PUBLIC, anon`; grants to `authenticated, service_role`.
  - Splits `public.campaigns` into `campaigns_anon_active_read` and `campaigns_authenticated_read`.
  - Splits `public.prizes` into `prizes_anon_active_read` and `prizes_authenticated_read`.
- **Dependencies:** `public.campaigns`, `public.prizes`, `public.is_staff`.
- **Risk Level:** **LOW**
- **Expected Changes:** 2 policies dropped, 4 policies created, permissions updated. Zero table rows modified.
- **Rollback:** Fully scripted in rollback block.
- **Verification Query:**
  ```sql
  SELECT schemaname, tablename, policyname, roles, cmd
  FROM pg_policies
  WHERE tablename IN ('campaigns', 'prizes')
  ORDER BY tablename, policyname;
  ```

---

### Migration 2: Preview Alignment & Performance Indexes

- **File:** `supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql`
- **SHA-256:** `F38E38CDD89EBA9F62898A4D8739FD8942EFF202886A777DFB5C2B9ECEEA4597`
- **Purpose:** Installs server-side pagination indexes, revokes excess client grants on internal trigger, and enforces private storage bucket attributes.
- **Target Database:** Preview Supabase (`jiyuiydzsfydjklosvvq`)
- **Operations:**
  - Creates 5 B-tree indexes (`orders_snapshot_seller_idx`, `orders_created_at_desc_idx`, `payments_submitted_at_idx`, `payments_seller_review_status_idx`, `audit_logs_action_created_idx`).
  - Revokes client execute on `public.trg_seller_messages_populate_snapshot()`.
  - Upserts `storage.buckets` configuration (`public = false`, 2MB limit).
- **Dependencies:** `public.orders`, `public.payments`, `public.audit_logs`, `storage.buckets`.
- **Risk Level:** **LOW**
- **Expected Changes:** 5 indexes created, 1 function permission revoked, 2 bucket rows updated. Zero table rows modified.
- **Rollback:** Drop indexes via `DROP INDEX IF EXISTS ...`.
- **Verification Query:**
  ```sql
  SELECT indexname, tablename
  FROM pg_indexes
  WHERE indexname IN (
    'orders_snapshot_seller_idx',
    'orders_created_at_desc_idx',
    'payments_submitted_at_idx',
    'payments_seller_review_status_idx',
    'audit_logs_action_created_idx'
  );
  ```

---

### Migration 3: Customer Order Access Token Architecture & Trigger Hardening

- **File:** `docs/security/PHASE_5_REVISED_SECURITY_MIGRATIONS.sql`
- **SHA-256:** `BA739B6AFDA965663851F8955DBF824CFE2A028D87544400F595F8B218AA2EF9`
- **Purpose:** Installs `issue_customer_order_access_token` and 3-mode `verify_order_payment_access`, hardens `protect_order_payment_snapshot()` trigger function, and defines the sanitization and lockdown RPCs.
- **Target Database:** Preview Supabase (`jiyuiydzsfydjklosvvq`)
- **Operations:**
  - Drops obsolete signatures `verify_order_payment_access(uuid, text)` and `(uuid, text, text)`.
  - Creates `public.issue_customer_order_access_token(uuid, text, integer)` (`service_role` only).
  - Creates `public.verify_order_payment_access(uuid, text, text)` (`service_role` only).
  - Updates `public.protect_order_payment_snapshot()` trigger function in place.
  - Creates `public.admin_sanitize_preview_historical_order_snapshots(uuid, text)` (`SUPER_ADMIN` only).
  - Creates `public.lock_order_payment_snapshot_trigger_unconditional()` (`service_role` only).
- **Dependencies:** `public.orders`, `public.payment_recovery_tokens`, `public.audit_logs`, `public.system_settings`.
- **Risk Level:** **MEDIUM**
- **Expected Changes:** 4 RPCs created/updated, 1 trigger function updated. Zero table rows modified during DDL.
- **Rollback:** Fully scripted in rollback block.
- **Verification Query:**
  ```sql
  SELECT proname, prosecdef, proargnames
  FROM pg_proc
  WHERE proname IN (
    'issue_customer_order_access_token',
    'verify_order_payment_access',
    'protect_order_payment_snapshot',
    'admin_sanitize_preview_historical_order_snapshots',
    'lock_order_payment_snapshot_trigger_unconditional'
  );
  ```

---

### Migration 4 (Controlled Data Mutation — Withheld for Separate Step): Historical Order Snapshot Sanitization

- **Execution Command:**
  ```sql
  SELECT public.admin_sanitize_preview_historical_order_snapshots(
    '<super_admin_uuid>',
    'Authorized Phase 6B sanitization of 16 historical orders to synthetic Preview format'
  );
  ```
- **Withheld Status:** **WITHHELD FROM INITIAL DDL RUN**. Must be executed ONLY after Migrations 1, 2, and 3 have been applied and verified.
- **Purpose:** Updates `snapshot_upi_id` on the 16 allowlisted historical orders (`ORD-2026-000031`..`ORD-2026-000046`) from historical UPIs to synthetic Preview format (`preview.seller_XXX@upi`).
- **Safety Assertions Inside RPC:**
  - Validates `SUPER_ADMIN` role of caller.
  - Validates Preview environment identity (`target_project_ref = 'jiyuiydzsfydjklosvvq'`).
  - Asserts exact allowlist presence (`v_total_allowlist_present = 16`).
  - Asserts sanitization count (`v_sanitized_count IN (0, 16)` and `v_already_synthetic_count = 16`).
  - Creates transactional audit log entries with `redacted_previous: true`.
- **Risk Level:** **MEDIUM** (Modifies 16 historical rows).
- **Verification Query:**
  ```sql
  SELECT order_number, snapshot_upi_id, snapshot_seller_code
  FROM public.orders
  WHERE order_number BETWEEN 'ORD-2026-000031' AND 'ORD-2026-000046'
  ORDER BY order_number;
  ```

---

### Migration 5 (Controlled Trigger Lockdown — Follows Step 4):

- **Execution Command:**
  ```sql
  SELECT public.lock_order_payment_snapshot_trigger_unconditional();
  ```
- **Purpose:** Permanently restores `public.protect_order_payment_snapshot()` to its unconditional body (zero GUC branches), locking out any future snapshot mutations forever.
- **Risk Level:** **LOW**.
- **Verification Query:**
  ```sql
  SELECT prosrc FROM pg_proc WHERE proname = 'protect_order_payment_snapshot';
  ```

---

## 5. Step 5 — Execution Hold Notice

> [!IMPORTANT]
> **STOP FOR EXPLICIT OWNER APPROVAL**  
> In compliance with strict project safety rules:
> - **ZERO database migrations have been executed.**
> - **ZERO database records have been modified.**
> - **Preview Supabase (`jiyuiydzsfydjklosvvq`) remains completely untouched.**
> - **Production Supabase (`fohpqheglxhfdecadhzw`) remains completely untouched and air-gapped.**
>
> Phase 6B execution is paused. Please review the plan above and provide explicit approval for each migration step:
> 1. Approval of target environment: Preview Supabase (`jiyuiydzsfydjklosvvq`).
> 2. Approval of Migration 1: `PHASE_5_RLS_POLICY_MIGRATION.sql` (`SHA-256: A6274E2A9FF04ADC...`).
> 3. Approval of Migration 2: `202611070002_preview_clone_alignment_and_isolation.sql` (`SHA-256: F38E38CDD89EBA9F...`).
> 4. Approval of Migration 3: `PHASE_5_REVISED_SECURITY_MIGRATIONS.sql` (`SHA-256: BA739B6AFDA96566...`).
> 5. Approval of separate subsequent execution of Step 4 (sanitization of 16 orders) and Step 5 (trigger lockdown).

