# SSFI — Phase 6B.6: Migration 3 Preflight & Readiness Audit Report

**Document ID:** `PHASE_6B_6_MIGRATION_3_PREFLIGHT_REPORT`  
**Date:** 2026-11-07  
**Branch:** `preview/production-mirror`  
**Execution Mode:** **`PREFLIGHT AUDIT ONLY` (Zero Persistent Database Writes, Zero Migrations Applied, Zero Git Commits)**  
**Target Environment:** Preview Supabase (`jiyuiydzsfydjklosvvq`) — **`https://jiyuiydzsfydjklosvvq.supabase.co`**  
**Air-Gapped Environment:** Production Supabase (`fohpqheglxhfdecadhzw`) — **STRICTLY AIR-GAPPED & UNTOUCHED**  
**Readiness Status:** **`PASS — FULLY VERIFIED & READY FOR OWNER APPROVAL`**  

---

## 1. Executive Summary

As requested by the project owner, an exhaustive preflight verification of **Migration 3 (`docs/security/PHASE_5_REVISED_SECURITY_MIGRATIONS.sql`)** was conducted prior to any execution.

The preflight audit verified:
1. **Target Air-Gap & Project Identity:** Confirmed target is exclusively Preview Supabase (`jiyuiydzsfydjklosvvq`). Production Supabase (`fohpqheglxhfdecadhzw`) is completely air-gapped and guarded.
2. **Cryptographic Checksum:** `docs/security/PHASE_5_REVISED_SECURITY_MIGRATIONS.sql` SHA-256 digest is `BA739B6AFDA965663851F8955DBF824CFE2A028D87544400F595F8B218AA2EF9` (exact 100% match with Phase 5 approved hash).
3. **Database Schema Dependencies:** Table `public.payment_recovery_tokens`, `public.system_settings`, `public.orders`, `public.sellers`, and function `public.has_role(uuid, text)` were inspected and verified on the remote Preview database.
4. **Historical 16-Order Dataset Status:** All 16 allowlisted orders (`ORD-2026-000031`..`ORD-2026-000046`) exist in `public.orders`, and their respective sellers (`SELLER-007`, `SELLER-008`) possess synthetic UPI IDs (`preview.seller007@upi`, `preview.seller008@upi`).
5. **Live Transactional Dry Run (`BEGIN ... ROLLBACK`):** A transactional syntax and catalog dry run was executed against Preview Supabase (`jiyuiydzsfydjklosvvq`). PostgreSQL parsed, compiled, and validated all DDL statements with **Exit Code 0 and zero errors**, rolling back cleanly without mutating the database.
6. **Application Test Suite:** All 353 unit and integration tests passed cleanly (0 failures, 26 suites).

> [!IMPORTANT]
> **NO MUTATIONS WERE APPLIED TO PREVIEW OR PRODUCTION:**
> Migration 3 has **NOT** been applied. The database remains in its verified Phase 6B.5 post-Migration 2 state.

---

## 2. Pre-Execution Identity & Cryptographic Verification

| Verification Item | Target / Invariant | Inspected Value | Status |
|:---:|---|---|:---:|
| **Git Working Branch** | `preview/production-mirror` | `preview/production-mirror` (`git rev-parse --abbrev-ref HEAD`) | **`PASS`** |
| **Candidate File Path** | `docs/security/PHASE_5_REVISED_SECURITY_MIGRATIONS.sql` | Exists on disk (23,265 bytes, 624 lines) | **`PASS`** |
| **SHA-256 Checksum** | `BA739B6AFDA965663851F8955DBF824CFE2A028D87544400F595F8B218AA2EF9` | `BA739B6AFDA965663851F8955DBF824CFE2A028D87544400F595F8B218AA2EF9` | **`PASS`** |
| **Active Target URL** | `https://jiyuiydzsfydjklosvvq.supabase.co` | `NEXT_PUBLIC_SUPABASE_URL=jiyuiydzsfydjklosvvq` | **`PASS`** |
| **Production Air-Gap** | Production (`fohpqheglxhfdecadhzw`) completely untouched | Zero references in active environment | **`PASS`** |

---

## 3. Deep Architectural & Code Review of Migration 3

### 3.1 Part 1A: `public.issue_customer_order_access_token`
- **Signature:** `(p_order_id uuid, p_token_hash text, p_expires_in_days integer DEFAULT 7) RETURNS jsonb`
- **Security Mode:** `SECURITY DEFINER SET search_path = public`
- **Authorization Guard:** `IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION ... (42501)`
- **Cryptographic Validation:** Enforces `p_token_hash` is exactly 64 lowercase hexadecimal characters (`^[0-9a-f]{64}$`).
- **Expiration Clamp:** Bounds expiration between 1 and 30 days (`GREATEST(1, LEAST(coalesce(p_expires_in_days, 7), 30))`).
- **Concurrency & State:** Row-locks order (`FOR UPDATE`); rejects inactive orders (`CANCELLED`, `REFUNDED`, `VOID`).
- **Revocation:** Atomically revokes all prior active tokens for that order (`revoked_at = now()`).
- **Audit Logging:** Inserts audit event `ORDER_ACCESS_TOKEN_ISSUED` into `public.audit_logs` storing `token_id` only (raw token and hash are never logged).
- **Grants:** `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role;`

### 3.2 Part 1B: `public.verify_order_payment_access`
- **Signature:** `(p_order_id uuid, p_token_hash text, p_access_mode text DEFAULT 'READ') RETURNS jsonb`
- **Security Mode:** `SECURITY DEFINER SET search_path = public`
- **Authorization Guard:** `IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION ... (42501)`
- **Mode Segregation:**
  - `READ`: Permits read-only access to customer payment page/receipt for active tokens (including after write is consumed).
  - `WRITE`: Verifies valid token and order is `PENDING_PAYMENT` for screenshot uploads.
  - `CONSUME_WRITE`: Sets `used_at = now()` upon UTR submission, consuming single-use write capability while preserving future read access.
- **Grants:** `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role;`

### 3.3 Part 2A: `public.protect_order_payment_snapshot()`
- **Type:** `BEFORE UPDATE` trigger function on `public.orders`.
- **In-Trigger Verification:**
  - Evaluates GUC flags `ssfi.allow_preview_snapshot_sanitization = 'true'` and `ssfi.sanitization_caller = 'admin_sanitize_preview_historical_order_snapshots'`.
  - Verifies Preview target ref from `public.system_settings` (`value->>'target_project_ref' = 'jiyuiydzsfydjklosvvq'`).
  - Blocks Production (`app.settings.project_ref = 'fohpqheglxhfdecadhzw'`).
  - Enforces explicit 16-order allowlist (`ORD-2026-000031`..`ORD-2026-000046`).
  - Enforces synthetic UPI pattern (`^preview\.[a-z0-9_]+@upi$`).
  - Enforces immutability of `id`, `order_number`, `customer_id`, `seller_id`, `campaign_id`, and `snapshot_seller_id`.
- **Zero Trigger Disabling:** The trigger remains enabled at all times.

### 3.4 Part 2B: `public.admin_sanitize_preview_historical_order_snapshots`
- **Signature:** `(p_actor_user_id uuid, p_reason text) RETURNS jsonb`
- **Security Mode:** `SECURITY DEFINER SET search_path = public`
- **Authorization Guard:** Enforces `auth.role() = 'service_role'` AND caller profile is `SUPER_ADMIN` via `public.has_role(p_actor_user_id, 'SUPER_ADMIN')`.
- **Reason Requirement:** 10–500 characters.
- **Transactional GUC Scope:** Sets `ssfi.allow_preview_snapshot_sanitization` locally (`is_local = true`) and immediately clears it after the update loop.
- **Strict Count Assertion:** Enforces `v_sanitized_count IN (0, 16)` and `v_already_synthetic_count = 16`. Aborts if anything unexpected is encountered.
- **Redacted Audit Trail:** Writes `PREVIEW_HISTORICAL_SNAPSHOT_SANITIZED` into `public.audit_logs` without leaking previous real UPI credentials.
- **Execution Notice:** Defining the function in Migration 3 does **not** execute it. Execution requires explicit owner invocation.

### 3.5 Part 2C: `public.lock_order_payment_snapshot_trigger_unconditional()`
- **Purpose:** Post-sanitization lock helper that restores `protect_order_payment_snapshot()` to an unconditional immutable body with zero GUC logic.
- **Grants:** `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role;`

---

## 4. Remote Database Prerequisites Audit (Preview Supabase)

All required catalog objects on `jiyuiydzsfydjklosvvq` were inspected:

| # | Checked Catalog Object | Target State / Invariant | Inspected Actual State | Status |
|:---:|---|---|---|:---:|
| 1 | `public.payment_recovery_tokens` | Table exists with `order_id`, `token_hash`, `expires_at`, `revoked_at`, `used_at` | Confirmed columns and data types match 100% | **`PASS`** |
| 2 | `public.system_settings` | Key `preview_data_mirror_metadata` exists with `target_project_ref` | `target_project_ref: "jiyuiydzsfydjklosvvq"` present | **`PASS`** |
| 3 | 16 Historical Orders | Orders `ORD-2026-000031` through `ORD-2026-000046` exist | Exactly 16 orders exist with `snapshot_captured_at` set | **`PASS`** |
| 4 | Linked Sellers for 16 Orders | Sellers have valid synthetic UPI IDs (`preview.sellerXXX@upi`) | `SELLER-007` (`preview.seller007@upi`), `SELLER-008` (`preview.seller008@upi`) | **`PASS`** |
| 5 | `public.has_role(uuid, text)` | Function exists and is `SECURITY DEFINER` | Confirmed `SECURITY DEFINER` | **`PASS`** |
| 6 | `SUPER_ADMIN` Profile | Active `SUPER_ADMIN` profile exists in Preview | Profile `72054ec1-13a8-4b02-8d4e-d2b78f2df978` holds `SUPER_ADMIN` | **`PASS`** |
| 7 | Snapshot Trigger | `trg_protect_order_payment_snapshot` exists as `BEFORE UPDATE` on `orders` | Confirmed attached to `public.orders` | **`PASS`** |

---

## 5. Live Transactional Dry Run (`BEGIN ... ROLLBACK`)

To prove 100% catalog and syntax compatibility without mutating the Preview database, Migration 3 was executed within an explicit `BEGIN ... ROLLBACK` transaction:

- **Command:**
  ```powershell
  npx supabase@2.122.0 db query --linked --project-ref jiyuiydzsfydjklosvvq --file "<temp_dry_run_with_rollback>.sql"
  ```
- **Exit Code:** `0` (Success)
- **Output:**
  ```json
  {
    "boundary": "ea1155da96e0410f6b104332eaf93d31",
    "rows": []
  }
  ```
- **Verification Post-Dry-Run:**
  - Query for functions `issue_customer_order_access_token`, `verify_order_payment_access`, `admin_sanitize_preview_historical_order_snapshots`: returned `0 rows` (**Confirmed rolled back**).
  - All 23 public tables row counts: **Zero changes across all 23 tables**.

---

## 6. Public Table Row-Count Baseline

| Table Name | Row Count | Table Name | Row Count |
|---|:---:|---|:---:|
| `audit_logs` | 270 | `payments` | 51 |
| `campaigns` | 1 | `prizes` | 5 |
| `customer_email_outbox` | 38 | `profile_roles` | 7 |
| `customers` | 52 | `profiles` | 6 |
| `draw_results` | 0 | `roles` | 4 |
| `draws` | 0 | `seller_messages` | 12 |
| `order_collaboration_notes` | 2 | `sellers` | 4 |
| `order_items` | 51 | `system_settings` | 3 |
| `orders` | 51 | `ticket_deliveries` | 52 |
| `payment_events` | 127 | `ticket_verifications` | 0 |
| `payment_recovery_tokens` | 2 | `tickets` | 36 |
| `payment_screenshots` | 35 | **Total Verified Tables** | **23** |

---

## 7. Migration 3 Preflight Verdict & Recommendation

| Check Category | Result |
|---|:---:|
| SHA-256 Digest Match | **`PASS`** |
| Target & Project Identity Binding | **`PASS`** |
| Production Air-Gap Isolation | **`PASS`** |
| Schema & Catalog Dependency Audit | **`PASS`** |
| 16-Order Dataset Compatibility | **`PASS`** |
| Live Transactional Dry Run (`ROLLBACK`) | **`PASS`** |
| Zero Side-Effects Verification | **`PASS`** |
| Application Test Suite (353/353 PASS) | **`PASS`** |
| **Migration 3 Preflight Status** | **`PASS — FULLY READY FOR EXECUTION`** |

> [!CAUTION]
> ### STOP — AWAITING EXPLICIT OWNER AUTHORIZATION
> The preflight audit for Migration 3 is complete and fully verified.
> Zero mutations have been executed.
> Awaiting the project owner's explicit command before applying Migration 3 to Preview Supabase (`jiyuiydzsfydjklosvvq`).

