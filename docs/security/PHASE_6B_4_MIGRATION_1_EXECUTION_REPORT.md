# SSFI — Phase 6B.4: Migration 1 Execution & Verification Report

**Document ID:** `PHASE_6B_4_MIGRATION_1_EXECUTION_REPORT`  
**Execution Date:** 2026-11-07  
**Git Branch:** `preview/production-mirror`  
**Execution Status:** **`PASS`**  
**Target Environment:** Preview Supabase (`jiyuiydzsfydjklosvvq`) — **`https://jiyuiydzsfydjklosvvq.supabase.co`**  
**Air-Gapped Environment:** Production Supabase (`fohpqheglxhfdecadhzw`) — **STRICTLY AIR-GAPPED & UNTOUCHED**  

---

## 1. Executive Summary

In accordance with explicit owner authorization under **Phase 6B.4**, **Migration 1 (`docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql`) ONLY** was executed against the Preview Supabase database (`jiyuiydzsfydjklosvvq`).

All mandatory pre-execution checks (cryptographic SHA-256 digest validation, branch verification, full SQL text inspection, and active project target binding) passed with 100% precision prior to execution.

Post-migration verification confirmed that the P1 anonymous visitor `42501: permission denied for function is_staff` regression has been completely resolved. Anonymous clients can now query active campaigns and active prizes via PostgREST (HTTP 200 OK) without calling `public.is_staff(uuid)`, while `public.is_staff(uuid)` remains strictly forbidden to `anon` and `PUBLIC`. All 23 database tables remain untouched with exact row-count parity.

> [!IMPORTANT]
> **STRICT EXECUTION SCOPE ADHERENCE:**
> - **Migration 1 ONLY was applied.**
> - **Migration 2 (`202611070002_preview_clone_alignment_and_isolation.sql`) was NOT executed.**
> - **Migration 3 (`PHASE_5_REVISED_SECURITY_MIGRATIONS.sql`) was NOT executed.**
> - **Zero historical order snapshot sanitization (`admin_sanitize_preview_historical_order_snapshots`) was performed.**
> - **Zero triggers were disabled or altered.**
> - **Production Supabase (`fohpqheglxhfdecadhzw`) was NEVER contacted.**
> - **Zero Git commits or pushes were made.**

---

## 2. Mandatory Pre-Execution Checks

| Check # | Verification Item | Target / Invariant | Inspected Value | Status |
|:---:|---|---|---|:---:|
| **1** | **Git Working Branch** | `preview/production-mirror` | `preview/production-mirror` (`git rev-parse --abbrev-ref HEAD`) | **`PASS`** |
| **2** | **Authorized SQL File** | `docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql` | Exists on disk (4,341 bytes) | **`PASS`** |
| **3** | **SHA-256 Digest** | `A6274E2A9FF04ADC2A01C90BC4FF9F5F4E9A53566C084CA88E223ADB9D7F623E` | `A6274E2A9FF04ADC2A01C90BC4FF9F5F4E9A53566C084CA88E223ADB9D7F623E` | **`PASS`** |
| **4** | **Scope Integrity** | RLS policy split on `campaigns` & `prizes`; least-privilege `is_staff` | Verified 100% contained within `BEGIN ... COMMIT` block | **`PASS`** |
| **5** | **Target Project Ref** | `jiyuiydzsfydjklosvvq` | `jiyuiydzsfydjklosvvq` (`NEXT_PUBLIC_SUPABASE_URL`) | **`PASS`** |
| **6** | **Production Air-Gap** | Production (`fohpqheglxhfdecadhzw`) zero contact | Confirmed absent from target configuration | **`PASS`** |
| **7** | **Pre-Existing Error Baseline** | Anonymous `/rest/v1/campaigns` & `/prizes` | HTTP 401 `42501: permission denied for function is_staff` | **`PASS`** |

---

## 3. Migration Execution Log

- **Execution Command:**
  ```powershell
  npx supabase@2.122.0 db query --linked --project-ref jiyuiydzsfydjklosvvq --file "docs/security/PHASE_5_RLS_POLICY_MIGRATION.sql"
  ```
- **Execution Mechanism:** Supabase Management API via Supabase CLI `2.122.0` linked project session.
- **Transactional Scope:** Atomic `BEGIN ... COMMIT`.
- **Exit Code:** `0` (Success).
- **Execution Output:**
  ```json
  {
    "boundary": "4ca7186aeba498604788ee8c8c1042a9",
    "rows": [],
    "warning": "The query results below contain untrusted data from the database."
  }
  ```
- **Database Errors / Warnings:** None.

---

## 4. Post-Migration Read-Only Verification

### 4.1 `public.is_staff(uuid)` Function Privilege Verification

**SQL Query Executed:**
```sql
SELECT 
  has_function_privilege('anon', 'public.is_staff(uuid)', 'execute') as anon_is_staff,
  has_function_privilege('public', 'public.is_staff(uuid)', 'execute') as public_is_staff,
  has_function_privilege('authenticated', 'public.is_staff(uuid)', 'execute') as auth_is_staff,
  has_function_privilege('service_role', 'public.is_staff(uuid)', 'execute') as sr_is_staff;
```

**Result:**
| Role | Expected Privilege | Actual Privilege | Status |
|---|:---:|:---:|:---:|
| `anon` | `false` | `false` | **`PASS`** |
| `public` | `false` | `false` | **`PASS`** |
| `authenticated` | `true` | `true` | **`PASS`** |
| `service_role` | `true` | `true` | **`PASS`** |

---

### 4.2 Table-Level SELECT Privilege Verification

**SQL Query Executed:**
```sql
SELECT 
  has_table_privilege('anon', 'public.campaigns', 'select') as anon_camp_sel,
  has_table_privilege('anon', 'public.prizes', 'select') as anon_prizes_sel,
  has_table_privilege('authenticated', 'public.campaigns', 'select') as auth_camp_sel,
  has_table_privilege('authenticated', 'public.prizes', 'select') as auth_prizes_sel;
```

**Result:**
| Table | Role | Expected Privilege | Actual Privilege | Status |
|---|---|:---:|:---:|:---:|
| `public.campaigns` | `anon` | `true` | `true` | **`PASS`** |
| `public.campaigns` | `authenticated` | `true` | `true` | **`PASS`** |
| `public.prizes` | `anon` | `true` | `true` | **`PASS`** |
| `public.prizes` | `authenticated` | `true` | `true` | **`PASS`** |

---

### 4.3 RLS Policy Inventory on `campaigns` & `prizes`

**SQL Query Executed:**
```sql
SELECT tablename, policyname, roles, cmd, qual 
FROM pg_policies 
WHERE tablename IN ('campaigns', 'prizes') 
ORDER BY tablename, policyname;
```

**Result:**
| Table | Policy Name | Command | Roles | Qual (USING Expression) | Status |
|---|---|:---:|:---:|---|:---:|
| `campaigns` | `campaigns_anon_active_read` | `SELECT` | `{anon}` | `(status = 'ACTIVE'::campaign_status)` | **`VERIFIED`** |
| `campaigns` | `campaigns_authenticated_read` | `SELECT` | `{authenticated}` | `((status = 'ACTIVE'::campaign_status) OR is_staff(auth.uid()))` | **`VERIFIED`** |
| `campaigns` | `campaigns_staff_write` | `ALL` | `{authenticated}` | `is_staff(auth.uid())` | **`VERIFIED`** |
| `prizes` | `prizes_anon_active_read` | `SELECT` | `{anon}` | `(EXISTS (SELECT 1 FROM campaigns c WHERE c.id = prizes.campaign_id AND c.status = 'ACTIVE'::campaign_status))` | **`VERIFIED`** |
| `prizes` | `prizes_authenticated_read` | `SELECT` | `{authenticated}` | `((EXISTS (SELECT 1 FROM campaigns c WHERE c.id = prizes.campaign_id AND c.status = 'ACTIVE'::campaign_status)) OR is_staff(auth.uid()))` | **`VERIFIED`** |
| `prizes` | `prizes_staff_write` | `ALL` | `{authenticated}` | `is_staff(auth.uid())` | **`VERIFIED`** |

**Confirmation of Dropped Policies:**
- `campaigns_public_read`: **Confirmed Removed** (Does not exist).
- `prizes_public_read`: **Confirmed Removed** (Does not exist).

---

### 4.4 Live Anonymous PostgREST API Verification

Direct HTTP queries were executed using the public anonymous publishable key against the Preview endpoint:

| Endpoint | Pre-Migration Response | Post-Migration Response | HTTP Status | Status |
|---|---|---|:---:|:---:|
| `/rest/v1/campaigns?select=*` | `42501: permission denied for function is_staff` | 1 active campaign returned (`ssfi-fundraising-lucky-draw`) | **`200 OK`** | **`PASS`** |
| `/rest/v1/prizes?select=*` | `42501: permission denied for function is_staff` | All 5 active campaign prizes returned | **`200 OK`** | **`PASS`** |

---

### 4.5 Schema Integrity & Table Row-Count Invariant

Row counts across all 23 tables were compared directly against the verified baseline:

| # | Table Name | Pre-Migration Baseline | Post-Migration Actual | Delta | Status |
|:---:|---|:---:|:---:|:---:|:---:|
| 1 | `audit_logs` | 270 | 270 | 0 | **`VERIFIED`** |
| 2 | `campaigns` | 1 | 1 | 0 | **`VERIFIED`** |
| 3 | `customer_email_outbox` | 38 | 38 | 0 | **`VERIFIED`** |
| 4 | `customers` | 52 | 52 | 0 | **`VERIFIED`** |
| 5 | `draw_results` | 0 | 0 | 0 | **`VERIFIED`** |
| 6 | `draws` | 0 | 0 | 0 | **`VERIFIED`** |
| 7 | `order_collaboration_notes` | 2 | 2 | 0 | **`VERIFIED`** |
| 8 | `order_items` | 51 | 51 | 0 | **`VERIFIED`** |
| 9 | `orders` | 51 | 51 | 0 | **`VERIFIED`** |
| 10 | `payment_events` | 127 | 127 | 0 | **`VERIFIED`** |
| 11 | `payment_recovery_tokens` | 2 | 2 | 0 | **`VERIFIED`** |
| 12 | `payment_screenshots` | 35 | 35 | 0 | **`VERIFIED`** |
| 13 | `payments` | 51 | 51 | 0 | **`VERIFIED`** |
| 14 | `prizes` | 5 | 5 | 0 | **`VERIFIED`** |
| 15 | `profile_roles` | 7 | 7 | 0 | **`VERIFIED`** |
| 16 | `profiles` | 6 | 6 | 0 | **`VERIFIED`** |
| 17 | `roles` | 4 | 4 | 0 | **`VERIFIED`** |
| 18 | `seller_messages` | 12 | 12 | 0 | **`VERIFIED`** |
| 19 | `sellers` | 4 | 4 | 0 | **`VERIFIED`** |
| 20 | `system_settings` | 3 | 3 | 0 | **`VERIFIED`** |
| 21 | `ticket_deliveries` | 52 | 52 | 0 | **`VERIFIED`** |
| 22 | `ticket_verifications` | 0 | 0 | 0 | **`VERIFIED`** |
| 23 | `tickets` | 36 | 36 | 0 | **`VERIFIED`** |

**Result:** Zero data rows added, mutated, or deleted. Schema structural integrity is 100% preserved.

---

### 4.6 Verification of Unapplied Migrations (Scope Guard Invariants)

1. **Migration 2 (`supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql`):**
   - Query: `SELECT indexname FROM pg_indexes WHERE indexname = 'orders_snapshot_seller_idx';`
   - Result: `0 rows`.
   - Invariant: **`VERIFIED UNAPPLIED`**.
2. **Migration 3 (`docs/security/PHASE_5_REVISED_SECURITY_MIGRATIONS.sql`):**
   - Query: `SELECT proname FROM pg_proc WHERE proname IN ('issue_customer_order_access_token', 'admin_sanitize_preview_historical_order_snapshots', 'lock_order_payment_snapshot_trigger_unconditional');`
   - Result: `0 rows`.
   - Invariant: **`VERIFIED UNAPPLIED`**.
3. **Application Unit & Integration Regression Test Suite:**
   - Command: `npm test`
   - Result: **`353 tests passed, 0 failures, 0 skipped`** across all 26 test suites.

---

## 5. Rollback Plan (Reference Only)

If rollback is ever required by owner instruction, the following reversible statements restore the previous unified policy definitions:

```sql
BEGIN;

DROP POLICY IF EXISTS campaigns_anon_active_read ON public.campaigns;
DROP POLICY IF EXISTS campaigns_authenticated_read ON public.campaigns;
CREATE POLICY campaigns_public_read
  ON public.campaigns
  FOR SELECT
  USING ((status = 'ACTIVE'::public.campaign_status) OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS prizes_anon_active_read ON public.prizes;
DROP POLICY IF EXISTS prizes_authenticated_read ON public.prizes;
CREATE POLICY prizes_public_read
  ON public.prizes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.campaigns c
      WHERE c.id = prizes.campaign_id
        AND (c.status = 'ACTIVE'::public.campaign_status OR public.is_staff(auth.uid()))
    )
  );

REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;

COMMIT;
```

---

## 6. Phase 6B.4 Verdict & Final Stop

| Requirement | Result |
|---|:---:|
| Pre-execution Checks & SHA-256 match | **`PASS`** |
| Migration 1 Applied Cleanly on Preview Supabase | **`PASS`** |
| `public.is_staff(uuid)` Revoked from Anon/Public | **`PASS`** |
| RLS Policies Segregated (`anon` vs `authenticated`) | **`PASS`** |
| Anonymous PostgREST Queries (`42501` Resolved) | **`PASS`** |
| Table Row Counts Preserved (All 23 Tables) | **`PASS`** |
| Migration 2 & Migration 3 Not Applied | **`PASS`** |
| Production Supabase Completely Untouched | **`PASS`** |
| Automated Test Suite (353/353 Passing) | **`PASS`** |
| **Overall Phase 6B.4 Status** | **`PASS`** |

> [!CAUTION]
> ### FINAL STOP — AWAITING EXPLICIT OWNER APPROVAL
> Phase 6B.4 is officially complete.
> The system has entered a complete execution hold.
> No further database migrations, historical snapshot sanitizations, Git commits, or deployments will be executed without explicit owner instructions.

