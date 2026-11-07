# SSFI — Phase 4: SQL Static & Local Runtime Validation Report

**Document ID:** `PHASE_4_SQL_STATIC_VALIDATION`  
**Date:** 2026-11-07  
**Mode:** `VALIDATION ONLY` (Zero Remote Database Writes or Migrations Executed)  
**Production Supabase (`fohpqheglxhfdecadhzw`):** `READ-ONLY / UNTOUCHED`  
**Preview Supabase (`jiyuiydzsfydjklosvvq`):** `READ-ONLY / UNTOUCHED`  
**Reviewed Deliverable:** [`docs/security/PHASE_3_PROPOSED_SECURITY_MIGRATIONS.sql`](file:///f:/PROJECT/Lucky%20Draw/docs/security/PHASE_3_PROPOSED_SECURITY_MIGRATIONS.sql) and working-tree migration [`supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql`](file:///f:/PROJECT/Lucky%20Draw/supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql)

---

## 1. Executive Summary

A comprehensive SQL static analysis and local PostgreSQL 18.3 runtime execution test were conducted on [`docs/security/PHASE_3_PROPOSED_SECURITY_MIGRATIONS.sql`](file:///f:/PROJECT/Lucky%20Draw/docs/security/PHASE_3_PROPOSED_SECURITY_MIGRATIONS.sql) (458 lines) and its interaction with the existing 18 canonical migrations (`202610270001_phase2_core.sql` through `202611070001_customer_contact_overrides_collaboration_and_ticket_immutability.sql`) plus the unapplied working-tree file `202611070002_preview_clone_alignment_and_isolation.sql`.

### Summary of SQL Validation Results

| Validation Dimension | Status | Summary of Findings |
|---|---|---|
| **1. PostgreSQL Syntax & Transaction Safety** | `PASS` | Executed cleanly (`BEGIN ... COMMIT`, `ON_ERROR_STOP=1`) on local PostgreSQL 18.3 with zero syntax or type errors. |
| **2. Function Privileges (`REVOKE` / `GRANT`)** | `PASS (with 1 Blocked Working-Tree File)` | `PHASE_3_PROPOSED_SECURITY_MIGRATIONS.sql` properly revokes `PUBLIC, anon, authenticated` on all 3 new `SECURITY DEFINER` RPCs and explicitly revokes `anon` from `public.is_staff(uuid)`. **However**, working-tree file `supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql` (line 25) grants `EXECUTE` on `public.is_staff(uuid)` to `anon` and is classified **`BLOCKED`**. |
| **3. `SECURITY DEFINER` Safety & `search_path` Hardening** | `PASS` | All four functions in `PHASE_3_PROPOSED_SECURITY_MIGRATIONS.sql` declare `SET search_path = public` and schema-qualify all table and function references (`public.*`, `pg_catalog.*`). |
| **4. RLS Policy Semantics (`campaigns` & `prizes`)** | `PASS` | Splitting `campaigns_public_read` -> `campaigns_anon_active_read` (`TO anon`) + `campaigns_authenticated_read` (`TO authenticated`) and `prizes_public_read` -> `prizes_anon_active_read` (`TO anon`) + `prizes_authenticated_read` (`TO authenticated`) resolves the `42501: permission denied for function is_staff` error for anonymous queries while keeping `public.is_staff(uuid)` uncallable by `anon`. |
| **5. Trigger Interactions (`trg_protect_order_payment_snapshot`)** | `REQUIRES REVISION` | Using `current_setting('ssfi.allow_preview_snapshot_sanitization', true) = 'true'` inside `protect_order_payment_snapshot()` without also checking the 16-order allowlist and preview `system_settings` inside the trigger—and without restoring the unconditional trigger immediately after sanitization—leaves a transaction-local GUC bypass vector (`Finding SEC-05` / `Finding SQL-01`). |
| **6. Sanitization RPC Scope & Assertions** | `REQUIRES REVISION` | `admin_sanitize_preview_historical_order_snapshots` lacks an explicit allowlist of the 16 audited order numbers (`ORD-2026-000031`..`ORD-2026-000046`) and an exact `v_sanitized_count = 16` assertion (`Finding SEC-06` / `Finding SQL-02`). |
| **7. Token Verification RPC Read vs. Write Semantics** | `REQUIRES REVISION` | `verify_order_payment_access` checks `used_at IS NOT NULL` as `TOKEN_ALREADY_USED`, or if `used_at` is never set on payment submission, allows write replay after payment submission (`Finding SEC-04` / `Finding SQL-03`). Must distinguish `READ` vs `WRITE` access. |
| **8. Rollback Script Completeness** | `REQUIRES REVISION` | The commented rollback block in `PHASE_3_PROPOSED_SECURITY_MIGRATIONS.sql` (lines 389–458) drops the new functions and restores the old policies, **but** omits `GRANT EXECUTE ON FUNCTION public.protect_order_payment_snapshot() ...` / `REVOKE ALL ON FUNCTION public.protect_order_payment_snapshot() FROM PUBLIC, anon, authenticated;` and cannot roll back committed data changes from `admin_sanitize_preview_historical_order_snapshots` (`Finding SQL-04`). |

---

## 2. Detailed Function-by-Function Static Analysis

### 2.1 Part 1 — RLS Policy Split on `public.campaigns` and `public.prizes` (Lines 35–107)

- **Objects Modified:**
  - `DROP POLICY IF EXISTS campaigns_public_read ON public.campaigns;`
  - `CREATE POLICY campaigns_anon_active_read ON public.campaigns FOR SELECT TO anon USING (status = 'ACTIVE'::public.campaign_status);`
  - `CREATE POLICY campaigns_authenticated_read ON public.campaigns FOR SELECT TO authenticated USING ((status = 'ACTIVE'::public.campaign_status) OR public.is_staff(auth.uid()));`
  - `DROP POLICY IF EXISTS prizes_public_read ON public.prizes;`
  - `CREATE POLICY prizes_anon_active_read ON public.prizes FOR SELECT TO anon USING (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = prizes.campaign_id AND c.status = 'ACTIVE'::public.campaign_status));`
  - `CREATE POLICY prizes_authenticated_read ON public.prizes FOR SELECT TO authenticated USING ((EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = prizes.campaign_id AND c.status = 'ACTIVE'::public.campaign_status)) OR public.is_staff(auth.uid()));`
  - `REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;`
  - `GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;`
- **Static & Runtime Verification (PostgreSQL 18.3):**
  - **Before Part 1:** `SET LOCAL ROLE anon; SELECT id, status FROM public.campaigns;` fails with `ERROR: permission denied for function is_staff` (`42501`), because PostgreSQL evaluates the `OR public.is_staff(auth.uid())` branch permission check when preparing the `FOR SELECT USING (...)` expression on `PUBLIC` policies.
  - **After Part 1:**
    - `SET LOCAL ROLE anon; SELECT count(*) FROM public.campaigns;` -> returns `1` (`ACTIVE` campaign).
    - `SET LOCAL ROLE anon; SELECT count(*) FROM public.prizes;` -> returns `5` (prizes belonging to `ACTIVE` campaign).
    - `SET LOCAL ROLE anon; SELECT public.is_staff('00000000-0000-0000-0000-000000000000');` -> fails with `ERROR: permission denied for function is_staff` (`postMigAnonIsStaffStillBlocked = true`).
- **Verdict:** **`APPROVED FOR IMPLEMENTATION`**.

---

### 2.2 Part 2 — Customer Order Access Token RPCs (Lines 113–240)

#### A. `public.issue_customer_order_access_token(p_order_id uuid, p_token_hash text, p_expires_in_days integer DEFAULT 7)`
- **Signature & Security Attributes:**
  - `RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`
  - `REVOKE ALL ON FUNCTION public.issue_customer_order_access_token(uuid, text, integer) FROM PUBLIC, anon, authenticated;`
  - `GRANT EXECUTE ON FUNCTION public.issue_customer_order_access_token(uuid, text, integer) TO service_role;`
- **Input Validation:**
  - Rejects `p_order_id IS NULL`.
  - Normalizes `v_clean_hash := lower(trim(coalesce(p_token_hash, '')))` and enforces `length(v_clean_hash) = 64` and regex `^[0-9a-f]{64}$`.
  - Clamps expiration window: `GREATEST(1, LEAST(coalesce(p_expires_in_days, 7), 30))`.
  - Acquires `FOR UPDATE` row lock on `public.orders WHERE id = p_order_id`.
- **Revocation Semantics:**
  - Marks any previously active tokens for `p_order_id` (`WHERE order_id = p_order_id AND revoked = false AND used_at IS NULL`) as `revoked = true` before inserting the new token row.
- **Verdict:** **`APPROVED FOR IMPLEMENTATION`**.

#### B. `public.verify_order_payment_access(p_order_id uuid, p_token_hash text)`
- **Signature & Security Attributes:**
  - `RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`
  - `REVOKE ALL ON FUNCTION public.verify_order_payment_access(uuid, text) FROM PUBLIC, anon, authenticated;`
  - `GRANT EXECUTE ON FUNCTION public.verify_order_payment_access(uuid, text) TO service_role;`
- **Identified Defect (`Finding SQL-03` — `REQUIRES REVISION`):**
  - Lines 214–216 check:
    ```sql
    IF v_token.used_at IS NOT NULL THEN
      RETURN jsonb_build_object('authorized', false, 'code', 'TOKEN_ALREADY_USED');
    END IF;
    ```
  - **Conflict:**
    1. If `submitPublicUpiPayment` sets `used_at = now()`, then when `submitPublicUpiPayment` finishes and `/buy/order/[orderId]` re-renders to show the customer their "Payment Submitted — Pending Verification" confirmation screen, `verify_order_payment_access` will return `TOKEN_ALREADY_USED` and lock the customer out of seeing their own order confirmation page!
    2. Conversely, if `submitPublicUpiPayment` does **not** set `used_at = now()`, then `used_at` is dead code and write operations do not mark token consumption.
  - **Required Revision:** Add parameter `p_access_mode text DEFAULT 'READ'` (`'READ'` vs `'WRITE'`):
    - When `p_access_mode = 'READ'`, allow tokens where `revoked = false AND expires_at > now()` (regardless of `used_at`), so the customer can continue viewing `/buy/order/[orderId]` status after submitting payment.
    - When `p_access_mode = 'WRITE'`, additionally require `v_token.used_at IS NULL AND v_order_status = 'PENDING_PAYMENT'`, and provide a companion statement or mode `'CONSUME_WRITE'` that sets `used_at = now()` atomically when payment submission completes.

---

### 2.3 Part 3 — Controlled Preview Historical Order Snapshot Sanitization (Lines 246–386)

#### A. `public.protect_order_payment_snapshot()` (Lines 249–289)
- **Identified Defect (`Finding SQL-01` — `REQUIRES REVISION`):**
  - Lines 254–257:
    ```sql
    IF current_setting('ssfi.allow_preview_snapshot_sanitization', true) = 'true' THEN
      RETURN NEW;
    END IF;
    ```
  - In PostgreSQL, unreserved custom GUC parameters (`ssfi.*`) do not require superuser privileges to set; any caller or function executing in a session can run `SELECT set_config('ssfi.allow_preview_snapshot_sanitization', 'true', true);`.
  - Furthermore, line 289 does not explicitly `REVOKE ALL ON FUNCTION public.protect_order_payment_snapshot() FROM PUBLIC, anon, authenticated;`.
  - **Required Revision:**
    1. Inside `protect_order_payment_snapshot()`, if the GUC is `'true'`, **also** enforce in the trigger body itself:
       - `EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'preview_data_mirror_metadata' AND value->>'target_project_ref' = 'jiyuiydzsfydjklosvvq')`
       - `OLD.order_number = ANY(ARRAY['ORD-2026-000031','ORD-2026-000032','ORD-2026-000033','ORD-2026-000034','ORD-2026-000035','ORD-2026-000036','ORD-2026-000037','ORD-2026-000038','ORD-2026-000039','ORD-2026-000040','ORD-2026-000041','ORD-2026-000042','ORD-2026-000043','ORD-2026-000044','ORD-2026-000045','ORD-2026-000046'])`
       - `NEW.snapshot_upi_id LIKE 'preview.%@upi'`
       - Only `snapshot_upi_id`, `snapshot_payee_name`, `snapshot_qr_url`, and `updated_at` may change (`OLD.snapshot_seller_id IS NOT DISTINCT FROM NEW.snapshot_seller_id`, `OLD.snapshot_seller_code IS NOT DISTINCT FROM NEW.snapshot_seller_code`, `OLD.snapshot_seller_name IS NOT DISTINCT FROM NEW.snapshot_seller_name`, `OLD.snapshot_captured_at IS NOT DISTINCT FROM NEW.snapshot_captured_at`).
    2. Immediately after executing `admin_sanitize_preview_historical_order_snapshots` once in Preview, restore `public.protect_order_payment_snapshot()` to its unconditional form (with zero GUC check) and drop `admin_sanitize_preview_historical_order_snapshots`.

#### B. `public.admin_sanitize_preview_historical_order_snapshots(p_actor_user_id uuid, p_reason text)` (Lines 297–384)
- **Identified Defect (`Finding SQL-02` — `REQUIRES REVISION`):**
  - Lines 338–341 filter dynamically:
    ```sql
    WHERE o.snapshot_captured_at IS NOT NULL
      AND o.snapshot_upi_id IS NOT NULL
      AND o.snapshot_upi_id NOT LIKE 'preview.%@upi'
    ```
  - **Required Revision:**
    - Constrain the loop explicitly to `AND o.order_number = ANY(ARRAY['ORD-2026-000031', ..., 'ORD-2026-000046'])`.
    - Add a post-loop assertion:
      ```sql
      IF v_sanitized_count NOT IN (0, 16) THEN
        RAISE EXCEPTION 'ABORT: Expected 16 (or 0 if already sanitized) historical orders to be updated, but updated %.', v_sanitized_count;
      END IF;
      ```

---

## 3. Compatibility with Existing Migration Chain (`202610270001` .. `202611070002`)

| Migration File | Compatibility with Phase 3 SQL | Notes |
|---|---|---|
| `202610270001_phase2_core.sql` .. `202611020002_protect_all_order_snapshot_fields.sql` (17 files) | `COMPATIBLE` | Defines base tables, `payment_recovery_tokens`, `payment_screenshots`, and `protect_order_payment_snapshot()`. |
| `202611070001_customer_contact_overrides_collaboration_and_ticket_immutability.sql` | `COMPATIBLE` | Applied in Preview. Defines `trg_protect_audit_logs_append_only` and `trg_protect_ticket_identity_immutability`, both of which coexist cleanly with `PHASE_3_PROPOSED_SECURITY_MIGRATIONS.sql` (verified on local PostgreSQL 18.3). |
| `202611070002_preview_clone_alignment_and_isolation.sql` *(untracked working-tree file)* | `CONFLICT / BLOCKED` | **Line 25 executes `GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO anon, authenticated, service_role;`**, which directly conflicts with Phase 3 Part 1 (`REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;`). Must be deleted or have line 25 replaced by Part 1 of `PHASE_3_PROPOSED_SECURITY_MIGRATIONS.sql`. |

