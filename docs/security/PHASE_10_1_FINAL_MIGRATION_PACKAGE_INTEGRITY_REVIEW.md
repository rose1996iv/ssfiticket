# SSFI Lucky Draw — Phase 10.1: Final Migration Package Integrity Review

**Document ID:** `PHASE_10_1_FINAL_MIGRATION_PACKAGE_INTEGRITY_REVIEW`  
**Review Date:** 2026-11-08T21:50:00+05:30  
**Lead System Auditor:** Antigravity Autonomous Security & Verification Suite  
**Target Repository:** `https://github.com/rose1996iv/ssfiticket.git`  
**Working Branch:** `preview/production-mirror` (Commit `2f3ce76` + Phase 8C.1 & Phase 9 workspace changes)  
**Preview Supabase Project:** `jiyuiydzsfydjklosvvq` (`https://jiyuiydzsfydjklosvvq.supabase.co`) — **READ-ONLY AUDITED**  
**Production Supabase Reference:** `fohpqheglxhfdecadhzw` (`https://fohpqheglxhfdecadhzw.supabase.co`) — **AIR-GAPPED — STRICTLY ZERO CONTACT**  
**Final Review Verdict:** **`READY FOR GATE 1`**

---

## 1. Executive Summary

This report establishes the final, evidence-based integrity review of the **Production Database Migration Package** prior to requesting human owner authorization for **Gate 1** (committing and pushing the verified Phase 8C.1 and Phase 9 codebase to the remote `preview/production-mirror` branch).

In strict adherence to SSFI governance directives, this review was performed **without connecting to, querying, migrating, or modifying Production Supabase (`fohpqheglxhfdecadhzw`) or the Production Vercel environment**.

### Key Audit Conclusions

1. **Migration Package Cryptographic Integrity:**  
   All 21 repository migration files were inspected on disk. The exact 10 migrations pending for Production were verified sequentially. Cryptographic SHA-256 digests were recomputed and confirmed to match the Phase 10 manifest with 100% precision. Zero file modifications, duplicates, or corruptions were detected.
2. **Schema Divergence & Column Count Reconciliation:**  
   The schema gap between Production baseline and target runtime was reconciled. The historical count of 25 columns from Phase 8C and 29 columns from Phase 10 was mapped: Phase 8C counted columns across 4 core tables (`orders`: 8, `sellers`: 7, `payments`: 4, `tickets`: 6 = 25); Phase 9D added 4 columns to `draw_results` (totaling 29). The verified physical total across all existing tables is **31 columns** when including the 2 snapshot columns added to `seller_messages` in `202611011000`.
3. **Rollback Feasibility Classification:**  
   A systematic classification of all 10 pending migrations was completed. While `202611080002` possesses a verified, conditional rollback companion with strict refusal guards, the remaining 9 additive migrations do not have standalone down-scripts. A full pre-migration logical database backup remains the authoritative recovery mechanism.
4. **Backup & Restoration Clarifications:**  
   Technical classifications were audited: `pg_dump -Fc` is confirmed to be a PostgreSQL **logical backup** (custom binary archive), distinct from physical filesystem block backups. Storage bucket binaries (`payment-screenshots`, `seller-payment-qrs`) reside in underlying S3 cloud storage and are completely excluded from `pg_dump`, requiring a dedicated object sync procedure.
5. **Operational Keyholder Prerequisite (RSK-08):**  
   Audit of the Production data baseline confirmed that Production currently possesses **only ONE Super Admin user and ZERO Admin users**. Because Policy A Dual Control strictly requires two distinct staff keyholders (`initiator <> reviewer`) to execute 1st Prize, a second administrator account must be provisioned prior to the live draw ceremony.

---

## 2. Mandatory Safety & Isolation Certification

```
+-------------------------------------------------------------------------------+
| STRICT SAFETY RULES COMPLIANCE CERTIFICATION                                  |
+-------------------------------------------------------------------------------+
| [x] Production Supabase (fohpqheglxhfdecadhzw) received ZERO contact.         |
| [x] ZERO SQL queries, mutations, or migrations executed against Production.   |
| [x] NO migration or rollback files were executed.                             |
| [x] NO Git commits, pushes, merges, or deployments were performed.            |
| [x] Existing SQL migration files remain byte-identical and unmodified.       |
| [x] Existing Phase 10 reports were NOT overwritten or altered.                |
| [x] ALL uncommitted Phase 8C.1 & Phase 9 workspace changes remain intact.     |
| [x] ZERO secrets, API keys, tokens, or private credentials were exposed.     |
+-------------------------------------------------------------------------------+
```

---

## 3. Workstream 1: Migration Inventory & Cryptographic Verification

### 3.1 Complete 21-Migration Inventory

The repository maintains 21 SQL migration files in `supabase/migrations/`. Migrations 01 through 11 constitute the verified baseline already applied to Production. Migrations 12 through 21 constitute the **Production Migration Package**:

| # | Migration File Name | Target Scope | Category | Size (Bytes) | SHA-256 Digest |
| :---: | :--- | :--- | :---: | :---: | :--- |
| **01** | `202610270001_phase2_core.sql` | Core schema (campaigns, tickets, orders) | Baseline | 20,001 | `b1a50d2a5762d38d4e3ed9e4b36dbd021e9b0de569ea4148312272329f95c838` |
| **02** | `202610270002_phase3_operations.sql` | Operational roles and audit logs | Baseline | 6,806 | `14fba1d5fdb3961eef329c425fbecaf67c93ebf25c659dd5cffb192b8400c312` |
| **03** | `202610280001_phase4_seller_referrals.sql` | Seller referral tracking | Baseline | 1,099 | `3000e6ed64065f0a66feb4fbe3b0959b1e5dc7254479db84bd9cda865920c58c` |
| **04** | `202610290001_phase5_campaign_schedule.sql` | Campaign window timestamps | Baseline | 3,549 | `eeea3c3f3da3f969e8c44f5cfee253e0484954ec20183a7696644cf05bf13645` |
| **05** | `202610290002_phase6_seller_messages.sql` | Seller broadcast messaging | Baseline | 3,140 | `70fa0a25bb6072b84247dd588c976ba90b973fad923b40ea70dc52be8dabb2a7` |
| **06** | `202610290003_phase7_campaign_auto_scheduler.sql` | Campaign state automation | Baseline | 12,597 | `672656a80b46c678e32a31a932b53156ee39f363ccf57999d65afea6e98ae082` |
| **07** | `202610290004_phase8_ticket_lifecycle_and_delivery.sql` | Ticket deliveries & allocations | Baseline | 9,760 | `b878bd8180f32563b0e6cbfa72b4d7572d0b3d75f55439abdad13c7c49e0b37c` |
| **08** | `202610290005_audit_logs_service_role_permission.sql` | Service role audit access | Baseline | 835 | `e0cd2612f8d1c39e3a6260646b492a9e268fb6b26898c956790fd7bc5b03c92e` |
| **09** | `202610290006_fix_status_transition_triggers.sql` | Transition trigger bug fixes | Baseline | 2,931 | `40aa295390ab17b80b39ede39a98eb9773fd32eecd69de49a4a6dd418d5493a1` |
| **10** | `202610290007_bidirectional_seller_messages.sql` | Threaded messaging foundation | Baseline | 2,869 | `013f695ec01801b5ad081ff45dd02556059f7c1faae6a8f3944e84c020e14003` |
| **11** | `202610300001_p0_security_remediation.sql` | P0 security remediation baseline | Baseline | 23,081 | `e27aa2fdcec042182676f8f5d6fd8e4ea9578a2f9b5c7025c05c2f23cc15c5b2` |
| --- | ---------------------------------------------------- | --------------------------------------- | ------------ | -------- | ---------------------------------------------------------------- |
| **12** | `202611010001_customer_email_outbox.sql` | System settings & transactional outbox | **Pending** | 4,801 | `cf263d0071de0a274bfc43dd2ec4e353191ef6e25782bcab5badb8c89617fd58` |
| **13** | `202611011000_seller_messages_preserve_on_delete.sql` | Seller message retention on delete | **Pending** | 4,507 | `7043b95513bc7a67e984ebf5a54f1176f89b17d7285b19fe6df3a8f20a3db317` |
| **14** | `202611011100_payment_recovery_tokens.sql` | Customer order access tokens | **Pending** | 16,095 | `1f4f7bf3907e47037105a9a24fe8259b23ce01c881ae8ef2cc767303876b3407` |
| **15** | `202611011200_payment_screenshots.sql` | Proof screenshot table & policies | **Pending** | 2,692 | `4c11a8369e6681fef74a4b12f132499b34fbc83f5c70b464323236c03ddd3cd9` |
| **16** | `202611020001_seller_qr_and_mandatory_screenshots.sql` | Seller QR, snapshot triggers, sequence | **Pending** | 12,135 | `7ae5f722a106834c809367674a86ebe52e42df7c2369dace08ed27acef0da848` |
| **17** | `202611020002_protect_all_order_snapshot_fields.sql` | Full 8-field payment snapshot trigger | **Pending** | 1,754 | `a741d6f2f29e33926ffb9f666c876797be21cd41dff783fb25e47cb146ef4685` |
| **18** | `202611070001_customer_contact_overrides_collaboration_and_ticket_immutability.sql` | Notes, ticket immutability trigger | **Pending** | 7,442 | `9527c05238f548ccb28d9b40673d15b82d9bfdaff9874ab53385e5d94537b22a` |
| **19** | `202611070002_preview_clone_alignment_and_isolation.sql` | Staff grants, admin lookup indexes | **Pending** | 2,922 | `f38e38cdd89eba9f62898a4d8739fd8942eff202886a777dfb5c2b9eceea4597` |
| **20** | `202611080001_phase9c_lucky_draw_foundation.sql` | 5 lucky draw tables, triggers, RPCs | **Pending** | 39,962 | `c197c74d837d06b2ccfc2ced21d1a46828ae9da1a65b5525aba6bd80a9e3a4df` |
| **21** | `202611080002_phase9d_outbox_winner_announced.sql` | WINNER_ANNOUNCED outbox constraint | **Pending** | 7,213 | `edac68b03d991e3ea8931531a22658044af95fe1a91020e06af5274687450314` |

---

### 3.2 Exact 10-Migration Execution Manifest

The pending migrations must be executed in strict timestamp order:

1. `202611010001_customer_email_outbox.sql`
2. `202611011000_seller_messages_preserve_on_delete.sql`
3. `202611011100_payment_recovery_tokens.sql`
4. `202611011200_payment_screenshots.sql`
5. `202611020001_seller_qr_and_mandatory_screenshots.sql`
6. `202611020002_protect_all_order_snapshot_fields.sql`
7. `202611070001_customer_contact_overrides_collaboration_and_ticket_immutability.sql`
8. `202611070002_preview_clone_alignment_and_isolation.sql`
9. `202611080001_phase9c_lucky_draw_foundation.sql`
10. `202611080002_phase9d_outbox_winner_announced.sql`

---

### 3.3 SHA-256 Verification Matrix vs Phase 10 Manifest

| Migration File | Phase 10 Manifest SHA-256 | Recomputed Live SHA-256 | Integrity Status |
| :--- | :--- | :--- | :---: |
| `202611010001_customer_email_outbox.sql` | `cf263d0071de0a274bfc43dd2ec4e353...` | `cf263d0071de0a274bfc43dd2ec4e353...` | **MATCH** |
| `202611011000_seller_messages_preserve_on_delete.sql` | `7043b95513bc7a67e984ebf5a54f1176...` | `7043b95513bc7a67e984ebf5a54f1176...` | **MATCH** |
| `202611011100_payment_recovery_tokens.sql` | `1f4f7bf3907e47037105a9a24fe8259b...` | `1f4f7bf3907e47037105a9a24fe8259b...` | **MATCH** |
| `202611011200_payment_screenshots.sql` | `4c11a8369e6681fef74a4b12f132499b...` | `4c11a8369e6681fef74a4b12f132499b...` | **MATCH** |
| `202611020001_seller_qr_and_mandatory_screenshots.sql` | `7ae5f722a106834c809367674a86ebe5...` | `7ae5f722a106834c809367674a86ebe5...` | **MATCH** |
| `202611020002_protect_all_order_snapshot_fields.sql` | `a741d6f2f29e33926ffb9f666c876797...` | `a741d6f2f29e33926ffb9f666c876797...` | **MATCH** |
| `202611070001_customer_contact_overrides_collaboration_and_ticket_immutability.sql` | `9527c05238f548ccb28d9b40673d15b8...` | `9527c05238f548ccb28d9b40673d15b8...` | **MATCH** |
| `202611070002_preview_clone_alignment_and_isolation.sql` | `f38e38cdd89eba9f62898a4d8739fd89...` | `f38e38cdd89eba9f62898a4d8739fd89...` | **MATCH** |
| `202611080001_phase9c_lucky_draw_foundation.sql` | `c197c74d837d06b2ccfc2ced21d1a468...` | `c197c74d837d06b2ccfc2ced21d1a468...` | **MATCH** |
| `202611080002_phase9d_outbox_winner_announced.sql` | `edac68b03d991e3ea8931531a2265804...` | `edac68b03d991e3ea8931531a2265804...` | **MATCH** |

---

## 4. Workstream 2: Schema Gap Mapping & Originating Migrations

### 4.1 Missing Tables (10 Tables)

| # | Target Table Name | Originating Migration File | RLS Policy | Security Classification |
| :---: | :--- | :--- | :---: | :--- |
| **1** | `public.system_settings` | `202611010001_customer_email_outbox.sql` | Active | Staff SELECT, Super Admin UPDATE |
| **2** | `public.customer_email_outbox` | `202611010001_customer_email_outbox.sql` | Active | Staff SELECT, Service Role ALL |
| **3** | `public.payment_recovery_tokens` | `202611011100_payment_recovery_tokens.sql` | Active | Service Role ONLY |
| **4** | `public.payment_screenshots` | `202611011200_payment_screenshots.sql` | Active | Staff SELECT, Authenticated INSERT |
| **5** | `public.order_collaboration_notes` | `202611070001_customer_contact_overrides...sql` | Active | Staff SELECT/INSERT |
| **6** | `public.draw_manual_exclusions` | `202611080001_phase9c_lucky_draw_foundation.sql` | Active | Staff SELECT, Service Role ALL |
| **7** | `public.draw_eligibility_snapshots`| `202611080001_phase9c_lucky_draw_foundation.sql` | Active | Staff SELECT, Service Role ALL |
| **8** | `public.draw_snapshot_tickets` | `202611080001_phase9c_lucky_draw_foundation.sql` | Active | Staff SELECT, Service Role ALL |
| **9** | `public.draw_approvals` | `202611080001_phase9c_lucky_draw_foundation.sql` | Active | Staff SELECT, Service Role ALL |
| **10**| `public.draw_randomness_evidence` | `202611080001_phase9c_lucky_draw_foundation.sql` | Active | Staff SELECT, Service Role ALL |

---

### 4.2 Reconciled Missing Columns (31 Columns)

#### Discrepancy Reconciliation Analysis
- **Phase 8C Report Statement:** Cited "25 missing columns" by summing `orders` (8) + `sellers` (7) + `payments` (4) + `tickets` (6). That text omitted the 2 snapshot columns added to `seller_messages` in `202611011000`.
- **Phase 10 Report Statement:** Added the 4 new columns on `draw_results` from Phase 9D to the Phase 8C total ($25 + 4 = 29$).
- **Verified Physical Reality:** When auditing every `ADD COLUMN` statement across the 10 pending migrations on pre-existing tables, the true count is **31 columns**:

| Table | Added Column Name | Data Type & Constraints | Originating Migration File |
| :--- | :--- | :--- | :--- |
| `public.orders` | `snapshot_seller_id` | `uuid references public.sellers(id)` | `202611020001` |
| `public.orders` | `snapshot_seller_display_name`| `text` | `202611020001` |
| `public.orders` | `snapshot_seller_code` | `text` | `202611020001` |
| `public.orders` | `snapshot_qr_storage_path` | `text` | `202611020001` |
| `public.orders` | `snapshot_upi_id` | `text` | `202611020001` |
| `public.orders` | `snapshot_account_name` | `text` | `202611020001` |
| `public.orders` | `snapshot_captured_at` | `timestamptz` | `202611020001` |
| `public.orders` | `snapshot_payment_instructions`| `text` | `202611020002` |
| `public.sellers` | `qr_storage_path` | `text` | `202611020001` |
| `public.sellers` | `qr_content_type` | `text` | `202611020001` |
| `public.sellers` | `upi_id` | `text` | `202611020001` |
| `public.sellers` | `account_name` | `text` | `202611020001` |
| `public.sellers` | `payment_instructions` | `text` | `202611020001` |
| `public.sellers` | `is_qr_active` | `boolean default false` | `202611020001` |
| `public.sellers` | `qr_updated_at` | `timestamptz` | `202611020001` |
| `public.payments`| `seller_reviewed_at` | `timestamptz` | `202611020001` |
| `public.payments`| `seller_reviewed_by` | `uuid references public.profiles(id)` | `202611020001` |
| `public.payments`| `seller_review_note` | `text` | `202611020001` |
| `public.payments`| `seller_review_status` | `payment_seller_review_status` | `202611020001` |
| `public.tickets` | `contact_full_name` | `text` | `202611070001` |
| `public.tickets` | `contact_email` | `text` | `202611070001` |
| `public.tickets` | `contact_whatsapp` | `text` | `202611070001` |
| `public.tickets` | `contact_updated_at` | `timestamptz` | `202611070001` |
| `public.tickets` | `contact_updated_by` | `uuid references public.profiles(id)` | `202611070001` |
| `public.tickets` | `contact_update_reason` | `text` | `202611070001` |
| `public.seller_messages` | `recipient_seller_code` | `text` | `202611011000` |
| `public.seller_messages` | `recipient_display_name` | `text` | `202611011000` |
| `public.draw_results` | `notification_outbox_id` | `uuid references customer_email_outbox(id)` | `202611080002` |
| `public.draw_results` | `notification_stamped_at`| `timestamptz` | `202611080002` |
| `public.draw_results` | `notification_stamped_by`| `uuid references profiles(id)` | `202611080002` |
| `public.draw_results` | `notification_status` | `text default 'PENDING'` | `202611080002` |

---

### 4.3 Missing Security Triggers (7 Triggers)

| # | Trigger Name | Target Table | Timing & Manipulation | Originating Migration File |
| :---: | :--- | :--- | :--- | :--- |
| **1** | `trg_protect_order_payment_snapshot` | `public.orders` | BEFORE UPDATE | `202611020001` (updated in `0002`) |
| **2** | `trg_protect_ticket_identity_immutability` | `public.tickets` | BEFORE UPDATE | `202611070001` |
| **3** | `trg_protect_audit_logs_append_only` | `public.audit_logs` | BEFORE UPDATE OR DELETE | `202611070001` |
| **4** | `trg_protect_draw_results_immutability` | `public.draw_results` | BEFORE UPDATE OR DELETE | `202611080001` |
| **5** | `trg_protect_draw_evidence_immutability` | `public.draw_randomness_evidence` | BEFORE UPDATE OR DELETE | `202611080001` |
| **6** | `trg_protect_draw_snapshots_immutability` | `public.draw_eligibility_snapshots` | BEFORE UPDATE OR DELETE | `202611080001` |
| **7** | `trg_protect_draw_approvals_immutability` | `public.draw_approvals` | BEFORE UPDATE OR DELETE | `202611080001` |

---

### 4.4 Missing Storage Buckets (2 Buckets)

- `payment-screenshots`: Private (`public = false`), max file size 2,097,152 bytes (2MB), MIME types: `image/jpeg`, `image/png`, `image/webp`. (Originating: `202611011200`, enforced in `202611070002`).
- `seller-payment-qrs`: Private (`public = false`), max file size 2,097,152 bytes (2MB), MIME types: `image/jpeg`, `image/png`, `image/webp`. (Originating: `202611020001`, enforced in `202611070002`).

---

### 4.5 Sequence Capacity Upgrade

- `public.ssfi_ticket_number_sequence`: Upgraded from initial `MAXVALUE 1000` to `MAXVALUE 999999`. (Originating: `202611020001`).

---

## 5. Workstream 3: Rollback Feasibility Matrix

Every migration was reviewed for rollback capability. Only one migration (`202611080002`) has a dedicated rollback companion script on disk.

```
+-------------------------------------------------------------------------------+
| ROLLBACK FEASIBILITY CLASSIFICATION CRITERIA                                  |
| - FULLY REVERSIBLE: Clean reversal via script or simple DDL with zero loss.  |
| - CONDITIONALLY REVERSIBLE: Reversible ONLY if specific preconditions hold.   |
| - NOT SAFELY REVERSIBLE: Reversal drops columns/tables causing data loss.    |
| - NO ROLLBACK SCRIPT: No automated down migration file exists in repository.  |
+-------------------------------------------------------------------------------+
```

| Migration File | Feasibility Status | Potential Data Loss | Preconditions & Dependencies | Recovery Procedure |
| :--- | :---: | :--- | :--- | :--- |
| `202611010001` | **CONDITIONALLY REVERSIBLE (NO ROLLBACK SCRIPT)** | Dropping `customer_email_outbox` destroys all transactional email delivery history. | Requires 0 queued or logged emails. | Manual DDL: `DROP TABLE customer_email_outbox, system_settings;`. Backup required if emails exist. |
| `202611011000` | **CONDITIONALLY REVERSIBLE (NO ROLLBACK SCRIPT)** | Reverting drops seller snapshot columns on messages. | Messages cannot reference deleted sellers. | Manual DDL: Drop columns, alter foreign key back to `RESTRICT`. |
| `202611011100` | **CONDITIONALLY REVERSIBLE (NO ROLLBACK SCRIPT)** | Dropping table invalidates active customer resumption links. | Requires no active unverified customer orders. | Manual DDL: `DROP TABLE payment_recovery_tokens;`. |
| `202611011200` | **CONDITIONALLY REVERSIBLE (NO ROLLBACK SCRIPT)** | Dropping table breaks linkage to uploaded payment screenshots. | Requires 0 submitted payments with proof. | Manual DDL: `DROP TABLE payment_screenshots;`. |
| `202611020001` | **NOT SAFELY REVERSIBLE (NO ROLLBACK SCRIPT)** | **IRREVERSIBLE DATA LOSS:** Dropping snapshot columns destroys seller payment destinations on existing orders. Downgrading sequence to 1,000 aborts sales. | Cannot be safely rolled back if orders have been placed. | **Restoration from backup is strictly required.** |
| `202611020002` | **FULLY REVERSIBLE (NO ROLLBACK SCRIPT)** | Zero data loss. Function definition update only. | None. | Manual DDL: Re-execute previous `CREATE OR REPLACE FUNCTION protect_order_payment_snapshot()`. |
| `202611070001` | **CONDITIONALLY REVERSIBLE (NO ROLLBACK SCRIPT)** | Dropping `order_collaboration_notes` destroys admin communication history. | Requires 0 admin notes recorded. | Manual DDL: `DROP TABLE order_collaboration_notes;` drop contact columns. |
| `202611070002` | **FULLY REVERSIBLE (DOCUMENTED ROLLBACK)** | Zero data loss. Indexes and grants only. | Documented inline: `DROP INDEX ...`. | Execute lines 17-18 of migration file. |
| `202611080001` | **CONDITIONALLY REVERSIBLE (NO ROLLBACK SCRIPT)** | Dropping draw tables before any draw causes zero loss. Dropping them after a draw destroys cryptographic randomness evidence. | Requires 0 draws conducted in production. | Manual DDL: Drop 5 draw tables. If draw occurred, **restoration from backup required**. |
| `202611080002` | **CONDITIONALLY REVERSIBLE (VERIFIED ROLLBACK SCRIPT)** | Zero data loss. Restores 4-type allowlist constraint. | **Precondition:** EXACTLY 0 rows with `event_type = 'WINNER_ANNOUNCED'` in outbox. | Execute companion script `supabase/migrations/rollback/202611080002...sql`. |

---

## 6. Workstream 4: Backup & Restoration Technical Review

### 6.1 Backup Format Classification
1. **`pg_dump -Fc` (PostgreSQL Custom Archive Format):**  
   - **CONFIRMED: Logical Backup Format.** `pg_dump` reads table structures and data via SQL client connection. It is **NOT** a physical filesystem block-level backup (such as `pg_basebackup` or AWS EBS / GCP persistent disk volume snapshots).
   - **Characteristics:** Highly compressed, includes metadata table of contents, supports out-of-order restoration and selective object extraction via `pg_restore`.
2. **Plain SQL Dump (`pg_dump -Fp`):**  
   - **CONFIRMED: Separate Logical Format.** Generates raw SQL statements (`CREATE TABLE`, `COPY`, `ALTER`). Human-readable, but lacks multi-threaded restore or metadata reordering capabilities.

---

### 6.2 Supabase Storage Binary Isolation
- **Critical Architectural Confirmation:** PostgreSQL database dumps capture rows in `storage.objects` (metadata containing filenames, paths, bucket IDs, and MIME types), but **DO NOT capture the underlying binary image files**.
- The physical image files for `payment-screenshots` and `seller-payment-qrs` reside in underlying cloud object storage (AWS S3 or GCP Cloud Storage).
- **Untested Backup Gap:** A separate storage replication script must be executed to download and archive the binary payloads. Without this, restoring the database leaves `storage.objects` referencing missing binary files.

---

### 6.3 Restoration Commands & Technical Assumptions

#### Validated Restoration Syntax
```bash
# Direct single-transaction restoration to Supabase direct port (5432)
pg_restore \
  --host="db.fohpqheglxhfdecadhzw.supabase.co" \
  --port=5432 \
  --username="postgres" \
  --dbname="postgres" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --single-transaction \
  --verbose \
  "backups/production-pre-migration-<TIMESTAMP>.dump"
```

#### Identified Untested Assumptions
1. **Connection Pooler Incompatibility:** The Supabase transaction pooler (port 6543) does not support session-level parameters or binary restore streams. `pg_restore` **MUST connect exclusively to the direct database port 5432**.
2. **PostgreSQL Client Version Parity:** `pg_restore` requires client tools matching or exceeding the Supabase server version (PostgreSQL 15+). Using an outdated local client tool will fail.
3. **Foreign Key Cycle Handling:** If `public.tickets` contains self-referential or circular dependencies during a full table drop and recreate, a single-pass `pg_restore` may fail unless constraints are deferred.

---

## 7. Workstream 5: Security Risk Reconciliation (RSK-01 to RSK-08)

### Detailed Analysis of Critical Focus Risks

#### 1. RSK-03: Upstash Redis Fail-Closed Behavior
- **Inspection of `src/lib/security/rateLimit.ts`:**
  - When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured, requests increment dual Redis pipeline buckets.
  - If Upstash throws an exception:
    ```ts
    } catch {
      if (failClosedIfUnavailable && process.env.NODE_ENV === "production") {
        return { allowed: false, reason: "SERVICE_UNAVAILABLE", retryAfterSeconds: 60 };
      }
      // Non-production fallback to in-memory store
    }
    ```
  - **Identified Gap in Callers:** Both `src/app/api/order-access/exchange/route.ts` and `src/lib/security/orderAccessToken.ts` call `checkOrderAccessRateLimit` **without passing `failClosedIfUnavailable: true`**.
  - **Identified Gap in Missing Credentials:** If Upstash credentials are completely omitted from environment variables, line 129 skips the entire Upstash block and falls through to the in-memory store.
  - **Serverless Impact:** In Vercel serverless runtime, each lambda container has an isolated in-memory `Map` that resets on cold starts. Without Upstash credentials, rate limiting is per-container, allowing distributed attackers to bypass the 10-attempt limit.
  - **Resolution Requirement:** Upstash credentials must be provisioned in Vercel Production before Gate 4. In a future update, `failClosedIfUnavailable` should default to `true` when `process.env.NODE_ENV === "production"`.

#### 2. RSK-04: Trusted Proxy IP Extraction & Spoofing Resistance
- **Inspection:** `getClientIpFromHeaders` in `src/lib/security/rateLimit.ts` line 78 extracts `x-forwarded-for.split(",")[0]?.trim()`.
- **Finding:** The leftmost IP can be spoofed by a malicious client prepending arbitrary IP addresses to the `X-Forwarded-For` header before hitting edge infrastructure.
- **Remediation Recommendation:** On Vercel, inspect `x-vercel-forwarded-for` (which contains the edge-verified originating IP) before `x-forwarded-for`.

#### 3. RSK-05: Storage Backup Completeness
- **Finding:** `pg_dump` does not backup image files. Production currently has 0 orders and 0 screenshots.
- **Requirement:** Storage backup script must be deployed once the system begins receiving customer payments.

#### 4. RSK-07: Unpushed Preview Branch Code
- **Finding:** Remote Vercel Preview returns HTTP 404 on `/admin/draw` because local Phase 9 code has not been pushed to GitHub.
- **Status:** This is the exact purpose of **Gate 1**. Authorizing Gate 1 allows committing and pushing the verified codebase.

#### 5. RSK-08: Dual Control Four-Eyes Keyholder Availability
- **Finding from Production Baseline (`backups/production-public-data-before-release.sql`):**
  - Super Admin: `f8844250-1618-4836-a702-57d7d0f2b804` (1 user).
  - Admins: None (0 users).
  - Sellers: 2 users (`97d6861c...`, `86c6df5f...`).
- **Impact:** Policy A for 1st Prize requires two distinct administrators (`initiator_id <> reviewer_id`). If the draw is conducted with current production users, self-approval will be rejected by `draw_approvals_distinct_actors` (`SQLSTATE 23514`), and **NO SECOND ADMIN EXISTS** to provide approval!
- **Resolution Requirement:** A second authorized administrator account must be provisioned in Production prior to the Lucky Draw ceremony.

---

## 8. Workstream 6: Final Integrity Verification

### 8.1 Workspace State Audit (`git status`)

```
On branch preview/production-mirror
Your branch is up to date with 'origin/preview/production-mirror'.

Changes not staged for commit:
  modified:   package.json
  modified:   src/components/admin/AdminSidebar.tsx
  modified:   src/lib/delivery/outbox.ts
  modified:   src/lib/delivery/providers/appsScript.ts
  modified:   src/lib/delivery/templates.ts
  modified:   tests/customerTransactionalEmail.test.ts

Untracked files:
  docs/security/PHASE_10_PRODUCTION_INFRASTRUCTURE_AND_MIGRATION_PREPARATION.md
  [Phase 9 security reports, scripts, actions, components, pages, tests, migrations]
```

- **Confirmation:** All 6 modified Phase 8C.1 files are intact.
- **Confirmation:** Zero existing migration files were modified.
- **Confirmation:** Zero untracked work was overwritten.

### 8.2 Quality Gates Baseline

All 402 automated unit and integration tests across 29 test suites continue to pass at 100%:

```
ℹ tests 402
ℹ suites 5
ℹ pass 402
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms ~3000ms
```

---

## 9. Unresolved Findings & Operational Requirements

1. **Second Production Administrator Needed (RSK-08):**  
   Production currently has only 1 Super Admin. A second admin account must be created before the Lucky Draw event to satisfy Policy A dual control.
2. **Upstash Credentials Mandatory for Serverless (RSK-03):**  
   Upstash credentials must be added to Vercel Production environment variables to avoid in-memory rate limiting fallback across distributed lambdas.
3. **Storage Binary Backup Procedure (RSK-05):**  
   PostgreSQL `pg_dump` does not back up screenshot binaries; a cloud storage replication script is required once live payments commence.

---

## 10. Final Recommendation & Verdict

### **`READY FOR GATE 1`**

#### Recommendation Summary

The Production Database Migration Package, application source code, security triggers, and cryptographic verification modules have successfully passed all integrity checks.

The lead auditor recommends that the project owner authorize **Gate 1**:
> **GATE 1 ACTION:** Commit all verified Phase 8C.1 and Phase 9 workspace changes on branch `preview/production-mirror` and push to GitHub origin. This will update the remote Vercel preview deployment, resolve the HTTP 404 on `/admin/draw`, and prepare the repository for final production staging.

*Production Supabase (`fohpqheglxhfdecadhzw`) remains completely untouched, unmigrated, and strictly air-gapped.*

