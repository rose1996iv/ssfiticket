# Phase D — Preview Replication Strategy & Implementation Plan

**Document Version:** 1.0.0  
**Date:** 2026-11-02  
**Project:** SSFI Lucky Draw (`rose1996iv/ssfiticket`)  
**Workspace:** `F:\PROJECT\Lucky Draw`  
**Active Git Branch:** `feature/payment-details-completion-recovery`  
**Phase:** D of G  
**Status:** DRAFT PLAN FOR OWNER REVIEW & APPROVAL  

---

## 1. Executive Summary & Objective

Phase C established the exact baseline of the Supabase Preview environment (`jiyuiydzsfydjklosvvq`):
- **21 of 22 target tables exist** with complete schema alignment.
- **Migration `202611011200_payment_screenshots.sql` is missing** (`payment_screenshots` table, storage bucket, and metrics RPC absent).
- **18 functions have `search_path=public`** instead of hardened `search_path=''`.
- **`supabase_migrations.schema_migrations` table is missing** on Preview.
- **33 existing orders exist** on Preview requiring synthetic isolation.
- **Production (`fohpqheglxhfdecadhzw`) is completely untouched and isolated.**

The objective of **Phase D** is to provide an exact, safe, and reproducible replication roadmap:
1. **Schema Completion:** Define the exact SQL payload to apply migration `202611011200` to Preview.
2. **Security Hardening:** Remediate `search_path` drift across the 18 functions safely.
3. **Migration History Baseline:** Seed `supabase_migrations.schema_migrations` so CLI/migrations remain consistent.
4. **Data Isolation & Synthetic Fixtures:** Provide an idempotent, synthetic test dataset (Admin, Seller, Customer, Campaign, Order, Recovery Link, and Payment Screenshot) using `@example.invalid` domains and mock UPI references, leaving existing data unmodified and never copying Production PII.
5. **Phase E Execution Gates:** Establish strict verification checkpoints before executing any change.

---

## 2. Target Environment Topology & Boundaries

```
[ Local Workspace: F:\PROJECT\Lucky Draw ]
   │
   ├─► [ Target: Preview Supabase (jiyuiydzsfydjklosvvq) ]
   │      - Project: ssfi-lucky-draw-dev (ap-south-1)
   │      - Database Host: db.jiyuiydzsfydjklosvvq.supabase.co
   │      - Status: ACTIVE_HEALTHY
   │      - Changes Permitted: Only via Phase E Owner Execution
   │
   └─x [ Protected: Production Supabase (fohpqheglxhfdecadhzw) ]
          - Project: ssfiticket
          - Status: STRICTLY AIR-GAPPED & UNTOUCHED
```

---

## 3. Step-by-Step Remediation & Replication Strategy

### Step 1: Schema Completion (`202611011200_payment_screenshots.sql`)
Apply the unapplied migration `202611011200_payment_screenshots.sql` to Preview.
- **Creates:** `public.payment_screenshots` table (id, payment_id, storage_path, content_type, file_size_bytes, uploaded_at, created_at)
- **Constraints:** Foreign key to `public.payments(id)` ON DELETE RESTRICT; unique constraints; regex validation for UUID filename `.jpg|.png|.webp`; max 2 MiB size check.
- **Storage:** Idempotent insert into `storage.buckets` (`id = 'payment-screenshots'`, `public = false`, 2 MiB, allowed MIME types).
- **Security:** RLS enabled; revoked from public/anon/authenticated; granted to `service_role`.
- **RPC:** `public.get_payment_screenshot_storage_metrics(p_actor uuid)` with `SECURITY DEFINER` and `SET search_path = ''`.

### Step 2: Function `search_path` Hardening
In Phase C, 18 routines were found with `search_path=public`. In accordance with P0 security hardening, update all non-trigger SECURITY DEFINER functions to `SET search_path = ''` after ensuring all internal references qualify the `public.` schema:
- `admin_reissue_ticket`
- `admin_void_ticket`
- `create_payment_recovery_link`
- `current_seller_id`
- `evaluate_campaign_schedules`
- `get_active_seller_by_code`
- `get_campaign_scheduler_status`
- `handle_new_user`
- `issue_tickets`
- `lookup_payment_recovery_token`
- `owns_customer`
- `process_scheduled_campaign_transitions`
- `record_payment_event`
- `revoke_payment_recovery_link`
- `seller_owns_customer`
- `submit_manual_upi`
- `submit_payment_details_completion`
- Revoke unnecessary EXECUTE from `anon` and `authenticated` on `trg_seller_messages_populate_snapshot`.

### Step 3: Migration History Table Baseline
Create and seed `supabase_migrations.schema_migrations` on Preview with all 15 migrations (`202610270001` through `202611011200`). This aligns `npx supabase migration list` with reality and prevents future accidental double-application.

### Step 4: Synthetic Data Seeding Strategy
To test end-to-end purchasing, payment recovery, screenshot uploads, and admin verification without touching or exposing real customer records:
1. **Never copy Production PII.**
2. Use dedicated test accounts:
   - Super Admin: `preview-admin@example.invalid`
   - Test Seller: `preview-seller@example.invalid` (Seller Code: `TEST-SELLER-001`)
   - Test Customer: `preview-customer@example.invalid` (Phone: `+919999999999`)
3. Synthetic Campaign: Ensure an `ACTIVE` test campaign exists with sufficient ticket allocation.
4. Synthetic Order Lifecycle:
   - Order 1: `PENDING_PAYMENT` (for checkout testing)
   - Order 2: `PAYMENT_SUBMITTED` with active recovery token (for recovery & screenshot testing)
   - Order 3: `PAYMENT_VERIFIED` / `TICKETS_ISSUED` (for ticket verification testing)

---

## 4. Phase D SQL Artifacts (Prepared for Phase E Execution)

The following scripts have been drafted and staged under `docs/preview/scripts/`:

### Artifact 1: Schema Completion & Migration Tracking
Path: [`docs/preview/scripts/01_apply_missing_migration_and_tracking.sql`](file:///F:/PROJECT/Lucky%20Draw/docs/preview/scripts/01_apply_missing_migration_and_tracking.sql)
- Contains the full content of `202611011200_payment_screenshots.sql`
- Contains DDL for `supabase_migrations.schema_migrations` and initial insert of all 15 versions.

### Artifact 2: P0 `search_path` Hardening & Privilege Cleanup
Path: [`docs/preview/scripts/02_harden_search_paths_and_grants.sql`](file:///F:/PROJECT/Lucky%20Draw/docs/preview/scripts/02_harden_search_paths_and_grants.sql)
- Updates `SET search_path = ''` on the 17 identified functions.
- Revokes execute on `trg_seller_messages_populate_snapshot` from `anon` and `authenticated`.

### Artifact 3: Idempotent Synthetic Seed Fixtures
Path: [`docs/preview/scripts/03_synthetic_preview_seed.sql`](file:///F:/PROJECT/Lucky%20Draw/docs/preview/scripts/03_synthetic_preview_seed.sql)
- Creates synthetic test profiles, roles, active campaign, seller, customer, and sample orders with tokens for manual testing.
- Uses strict `ON CONFLICT DO NOTHING` guards to protect existing Preview data.

---

## 5. Phase E Execution Protocol & Safety Gates

Execution of Phase E requires explicit user sign-off and must follow this sequence:
1. **Safety Gate 1:** Verify the active Supabase project reference is `jiyuiydzsfydjklosvvq` via CLI `--linked`.
2. **Safety Gate 2:** Confirm `fohpqheglxhfdecadhzw` is NOT linked and has 0 operations directed towards it.
3. **Execution Mode:** Either executed via CLI `npx supabase db query --linked -f <script>` or directly pasted into the Preview Dashboard SQL Editor by the project owner.
4. **Verification Queries:** Run post-execution schema queries to confirm `payment_screenshots` table exists, storage bucket is present, and RLS policies match 34 total.

---

## 6. Phase D Sign-Off Decision

- [x] Target architecture fully mapped from Phase B.
- [x] Baseline and differences verified from Phase C.
- [x] Scripts drafted with zero modifications to existing codebase or production.
- [ ] **Awaiting User Review & Approval to proceed to Phase E (Execution).**

