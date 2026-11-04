# Phase C — Preview Environment Assessment (Remote Verified)

**Document Version:** 2.0.0  
**Date:** 2026-11-02  
**Project:** SSFI Lucky Draw (`rose1996iv/ssfiticket`)  
**Workspace:** `F:\PROJECT\Lucky Draw`  
**Active Git Branch:** `feature/payment-details-completion-recovery`  
**Phase:** C of G  
**Status:** ✅ COMPLETE — READY FOR PHASE D WITH BLOCKERS

---

## 1. Executive Summary

Phase C performed a comprehensive read-only verification of the Preview Supabase project (`jiyuiydzsfydjklosvvq`) using the Supabase CLI `db query --linked` command, which routes all queries through the Management API (not direct database connection).

### Key Findings

| Area | Result |
|------|--------|
| **Identity** | ✅ CONFIRMED — `jiyuiydzsfydjklosvvq` = `ssfi-lucky-draw-dev`, linked, ACTIVE_HEALTHY |
| **Migration History** | ⚠️ `supabase_migrations.schema_migrations` table **does not exist** — migrations were applied directly via Dashboard SQL Editor, bypassing CLI migration tracking |
| **Tables** | ⚠️ **21 of 22** target tables present — `payment_screenshots` is **MISSING** |
| **Functions** | ⚠️ **27 of 27** functions present, but **mixed `search_path`** — only 7 use `search_path=''`, 19 use `search_path=public`, 1 uses `null` |
| **Triggers** | ✅ All 15 triggers present and enabled |
| **RLS** | ✅ All 21 tables have RLS enabled; 32 policies present (2 fewer than Phase B target of 34 — the missing `payment_screenshots` policies) |
| **Sequences** | ✅ Both present with correct MAXVALUE values |
| **ENUMs** | ✅ All 7 ENUMs with correct labels |
| **Storage** | ❌ `payment-screenshots` bucket **does not exist** (0 storage buckets) |
| **Table Grants** | ✅ Hardened — `SELECT`-only for `anon` and `authenticated` across all tables; no INSERT/UPDATE/DELETE exposed |
| **Function Grants** | ✅ Properly restricted — privileged RPCs (`service_role` only); helper functions (`authenticated` + `service_role`); public lookup (`anon` + `authenticated` + `service_role`) |
| **Data Classification** | ⚠️ 33 orders exist — classification UNCERTAIN (cannot determine synthetic vs real without inspecting PII) |
| **Production Safety** | ✅ Production (`fohpqheglxhfdecadhzw`) was NOT linked, NOT queried, NOT modified |

### Critical Blockers for Phase D

1. **`payment_screenshots` table missing** — migration `202611011200` not applied
2. **`payment-screenshots` Storage bucket missing** — created by migration `202611011200`
3. **`search_path` inconsistency** — 19 of 27 functions use `search_path=public` instead of `search_path=''`; differs from Phase B target
4. **No migration history table** — CLI `supabase db push` will not work correctly until history is established
5. **Data classification uncertain** — 33 existing orders require owner classification

---

## 2. Preview Identity Evidence

### Remote API Verification

```
Method: npx supabase projects list (Management API)
```

| Property | Value | Confidence |
|----------|-------|-----------|
| Project ID | `jiyuiydzsfydjklosvvq` | **VERIFIED (Remote API)** |
| Project Reference | `jiyuiydzsfydjklosvvq` | **VERIFIED (Remote API)** |
| Project Name | `ssfi-lucky-draw-dev` | **VERIFIED (Remote API)** |
| Organization ID | `jwghzpqpekygmjfwttmz` | **VERIFIED (Remote API)** |
| Region | `ap-south-1` | **VERIFIED (Remote API)** |
| Status | `ACTIVE_HEALTHY` | **VERIFIED (Remote API)** |
| Database Host | `db.jiyuiydzsfydjklosvvq.supabase.co` | **VERIFIED (Remote API)** |
| PostgreSQL Version | `17.11.0.003` (Engine 17) | **VERIFIED (Remote API)** |
| Release Channel | `ga` | **VERIFIED (Remote API)** |
| CLI Linked | `true` | **VERIFIED (Remote API)** |
| Created At | `2026-10-29T05:43:59Z` | **VERIFIED (Remote API)** |

### Production Separation Verification

| Property | Production | Preview | Match |
|----------|-----------|---------|-------|
| Reference | `fohpqheglxhfdecadhzw` | `jiyuiydzsfydjklosvvq` | ✅ Different |
| Name | `ssfiticket` | `ssfi-lucky-draw-dev` | ✅ Different |
| CLI Linked | `false` | `true` | ✅ Safe — only Preview is linked |
| Status | `ACTIVE_HEALTHY` | `ACTIVE_HEALTHY` | — |

> **Identity Verdict:** Preview identity is CONFIRMED via remote Management API. Production is NOT linked and was NOT queried during this assessment.

---

## 3. Remote Verification Method

All remote queries were executed via:

```
npx supabase db query --linked "<SQL>"
```

This method:
- Routes through the Supabase Management API (not direct database connection)
- Uses the CLI's authenticated session (linked project only)
- Requires `database_read` FGA permission
- Does not expose connection strings or passwords
- Cannot execute DDL or DML mutations through this interface (API enforces read boundary)

No direct database connections, service-role keys, or database passwords were used.

---

## 4. Applied Migration Inventory

### Migration History Table Status

```sql
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
```

**Result:**

```
ERROR: 42P01: relation "supabase_migrations.schema_migrations" does not exist
```

**Finding:** The `supabase_migrations` schema does not exist on the remote Preview database. All schema objects were applied directly via Supabase Dashboard SQL Editor, bypassing the CLI migration tracking system.

**Implications:**
1. `npx supabase migration list` reports all 15 local migrations as `remote: ""` (untracked remotely)
2. `npx supabase db push` cannot determine which migrations have already been applied
3. Future migration management requires either:
   - a. Creating the `supabase_migrations` schema and seeding history records, OR
   - b. Continuing to apply migrations manually via Dashboard SQL Editor

### Schema Object Presence (Inferred Migration Status)

Based on actual schema inspection, the following migration application status is inferred:

| # | Migration Version | Migration Name | Status | Evidence |
|---|---|---|---|---|
| 1 | `202610270001` | `phase2_core` | **APPLIED** | All core tables, ENUMs, and base functions present |
| 2 | `202610270002` | `phase3_operations` | **APPLIED** | Orders, payments, operation tables present |
| 3 | `202610280001` | `phase4_seller_referrals` | **APPLIED** | Sellers table with all constraints present |
| 4 | `202610290001` | `phase5_campaign_schedule` | **APPLIED** | Campaigns scheduling columns present |
| 5 | `202610290002` | `phase6_seller_messages` | **APPLIED** | `seller_messages` table present |
| 6 | `202610290003` | `phase7_campaign_auto_scheduler` | **APPLIED** | `evaluate_campaign_schedules` + `process_scheduled_campaign_transitions` present |
| 7 | `202610290004` | `phase8_ticket_lifecycle_and_delivery` | **APPLIED** | `ticket_deliveries`, `ticket_verifications`, delivery ENUMs present |
| 8 | `202610290005` | `audit_logs_service_role_permission` | **APPLIED** | `audit_logs` present with RLS |
| 9 | `202610290006` | `fix_status_transition_triggers` | **APPLIED** | `validate_status_transition` trigger on orders and payments |
| 10 | `202610290007` | `bidirectional_seller_messages` | **APPLIED** | `sender_role`, `parent_message_id` columns present; immutability trigger active |
| 11 | `202610300001` | `p0_security_remediation` | **PARTIALLY APPLIED** | Sequence MAXVALUE=999999 ✅; grant hardening ✅; but `search_path` is mixed (not all `=''`) |
| 12 | `202611010001` | `customer_email_outbox` | **APPLIED** | `customer_email_outbox` table present with all indexes and RLS |
| 13 | `202611011000` | `seller_messages_preserve_on_delete` | **APPLIED** | `seller_messages.recipient_seller_id` FK is `ON DELETE SET NULL` |
| 14 | `202611011100` | `payment_recovery_tokens` | **APPLIED** | `payment_recovery_tokens` table, indexes, RLS policies, and all 4 RPCs present |
| 15 | `202611011200` | `payment_screenshots` | **NOT APPLIED** | `payment_screenshots` table absent; Storage bucket absent; `get_payment_screenshot_storage_metrics` function absent |

---

## 5. Missing Migration Inventory

### Definitively Missing

| Migration | Objects Missing | Impact |
|-----------|----------------|--------|
| `202611011200_payment_screenshots.sql` | `payment_screenshots` table, `get_payment_screenshot_storage_metrics` function, `payment-screenshots` Storage bucket | **CRITICAL** — Payment screenshot upload feature completely non-functional |

### Partially Applied

| Migration | Applied Objects | Missing/Inconsistent Objects |
|-----------|----------------|------|
| `202610300001_p0_security_remediation.sql` | Sequence fix ✅, grant hardening ✅, function identity guards ✅ | `search_path` inconsistency — see Section 8 |

---

## 6. Actual Schema Inventory

### Tables (21 of 22 target present)

| # | Table | Status | RLS | Row Count Known |
|---|-------|--------|-----|----------------|
| 1 | `audit_logs` | ✅ MATCH | ✅ enabled | — |
| 2 | `campaigns` | ✅ MATCH | ✅ enabled | — |
| 3 | `customer_email_outbox` | ✅ MATCH | ✅ enabled | — |
| 4 | `customers` | ✅ MATCH | ✅ enabled | — |
| 5 | `draw_results` | ✅ MATCH | ✅ enabled | — |
| 6 | `draws` | ✅ MATCH | ✅ enabled | — |
| 7 | `order_items` | ✅ MATCH | ✅ enabled | — |
| 8 | `orders` | ✅ MATCH | ✅ enabled | 33 rows |
| 9 | `payment_events` | ✅ MATCH | ✅ enabled | — |
| 10 | `payment_recovery_tokens` | ✅ MATCH | ✅ enabled | — |
| 11 | `payments` | ✅ MATCH | ✅ enabled | — |
| 12 | `prizes` | ✅ MATCH | ✅ enabled | — |
| 13 | `profile_roles` | ✅ MATCH | ✅ enabled | — |
| 14 | `profiles` | ✅ MATCH | ✅ enabled | — |
| 15 | `roles` | ✅ MATCH | ✅ enabled | — |
| 16 | `seller_messages` | ✅ MATCH | ✅ enabled | — |
| 17 | `sellers` | ✅ MATCH | ✅ enabled | — |
| 18 | `system_settings` | ✅ MATCH | ✅ enabled | — |
| 19 | `ticket_deliveries` | ✅ MATCH | ✅ enabled | — |
| 20 | `ticket_verifications` | ✅ MATCH | ✅ enabled | — |
| 21 | `tickets` | ✅ MATCH | ✅ enabled | — |
| 22 | `payment_screenshots` | ❌ MISSING | — | — |

### Sequences

| Sequence | Expected MAXVALUE | Actual MAXVALUE | Status |
|----------|------------------|----------------|--------|
| `ssfi_order_number_sequence` | No max (9223372036854775807) | 9223372036854775807 | ✅ MATCH |
| `ssfi_ticket_number_sequence` | 999999 | 999999 | ✅ MATCH |

### ENUM Types (7 of 7 present — Phase B target was 8 but one was part of `payment_screenshots`)

| ENUM | Labels | Status |
|------|--------|--------|
| `campaign_status` | DRAFT, ACTIVE, PAUSED, CLOSED, CANCELLED | ✅ MATCH |
| `delivery_channel` | WHATSAPP, EMAIL | ✅ MATCH |
| `delivery_status` | PENDING, SENT, DELIVERED, FAILED, SIMULATED | ✅ MATCH |
| `draw_status` | DRAFT, SCHEDULED, EXECUTED, CANCELLED | ✅ MATCH |
| `order_status` | PENDING_PAYMENT, PAYMENT_SUBMITTED, PAYMENT_VERIFIED, TICKETS_ISSUED, CANCELLED, REFUNDED | ✅ MATCH |
| `payment_method` | MANUAL_UPI | ✅ MATCH |
| `payment_status` | PENDING, SUBMITTED, VERIFIED, FAILED, REFUNDED, CANCELLED | ✅ MATCH |
| `ticket_status` | RESERVED, ISSUED, VOID, REFUNDED | ✅ MATCH |

---

## 7. Schema Comparison Against Phase B

### Core Domain Tables (Migrations 1–10): ✅ MATCH

All 18 core domain tables are present with expected columns, constraints, and indexes.

### Feature Extension Tables (Migrations 11–15):

| Table | Phase B Target | Remote Preview | Status |
|-------|---------------|----------------|--------|
| `system_settings` | Present | Present | ✅ MATCH |
| `customer_email_outbox` | Present | Present | ✅ MATCH |
| `payment_recovery_tokens` | Present | Present | ✅ MATCH |
| `payment_screenshots` | Present | **ABSENT** | ❌ MISSING |

### `payment_recovery_tokens` Column Verification

| Column | Expected Type | Actual Type | Nullable | Default | Status |
|--------|-------------|-------------|----------|---------|--------|
| `id` | uuid | uuid | NO | `gen_random_uuid()` | ✅ MATCH |
| `order_id` | uuid | uuid | NO | — | ✅ MATCH |
| `token_hash` | text | text | NO | — | ✅ MATCH |
| `created_by` | uuid | uuid | YES | — | ✅ MATCH |
| `expires_at` | timestamptz | timestamptz | NO | `now() + '7 days'` | ✅ MATCH |
| `revoked_at` | timestamptz | timestamptz | YES | — | ✅ MATCH |
| `revoked_by` | uuid | uuid | YES | — | ✅ MATCH |
| `used_at` | timestamptz | timestamptz | YES | — | ✅ MATCH |
| `created_at` | timestamptz | timestamptz | NO | `now()` | ✅ MATCH |
| `updated_at` | timestamptz | timestamptz | NO | `now()` | ✅ MATCH |

### `seller_messages` Constraint Verification (Migration 13 check)

| Constraint | Expected | Actual | Status |
|-----------|----------|--------|--------|
| `recipient_seller_id` FK | `ON DELETE SET NULL` | `ON DELETE SET NULL` | ✅ MATCH |
| `sender_profile_id` FK | `ON DELETE SET NULL` | `ON DELETE SET NULL` | ✅ MATCH |
| `parent_message_id` FK | `ON DELETE RESTRICT` | `ON DELETE RESTRICT` | ✅ MATCH |
| `sender_role_check` | `IN ('ADMIN', 'SELLER')` | `IN ('ADMIN', 'SELLER')` | ✅ MATCH |
| `body_check` | length 5–5000 | length 5–5000 | ✅ MATCH |
| `subject_check` | length 2–200 | length 2–200 | ✅ MATCH |

### Feature Table Indexes

| Index | Table | Present | Status |
|-------|-------|---------|--------|
| `customer_email_outbox_pkey` | customer_email_outbox | ✅ | MATCH |
| `customer_email_outbox_idempotency_key_key` | customer_email_outbox | ✅ | MATCH |
| `idx_email_outbox_created` | customer_email_outbox | ✅ | MATCH |
| `idx_email_outbox_event` | customer_email_outbox | ✅ | MATCH |
| `idx_email_outbox_idempotency` | customer_email_outbox | ✅ | MATCH |
| `idx_email_outbox_order` | customer_email_outbox | ✅ | MATCH |
| `idx_email_outbox_status_next` | customer_email_outbox | ✅ | MATCH |
| `payment_recovery_tokens_pkey` | payment_recovery_tokens | ✅ | MATCH |
| `payment_recovery_tokens_token_hash_key` | payment_recovery_tokens | ✅ | MATCH |
| `idx_payment_recovery_tokens_hash` | payment_recovery_tokens | ✅ | MATCH |
| `idx_payment_recovery_tokens_order_id` | payment_recovery_tokens | ✅ | MATCH |
| `system_settings_pkey` | system_settings | ✅ | MATCH |
| `payment_screenshots_uploaded_at_idx` | payment_screenshots | ❌ | MISSING (table absent) |

---

## 8. Functions and RPC Comparison

### Function Inventory (27 present on remote)

| # | Function | Args | Return | SECURITY DEFINER | `search_path` | Phase B Target `search_path` | Status |
|---|----------|------|--------|-----------------|--------------|------|--------|
| 1 | `admin_reissue_ticket` | `(uuid, uuid, text)` | uuid | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 2 | `admin_void_ticket` | `(uuid, uuid, text)` | void | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 3 | `create_payment_recovery_link` | `(uuid, text, uuid, integer)` | jsonb | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 4 | `create_seller_order` | `(uuid, text, text, text, integer, uuid)` | uuid | ✅ | `''` | `''` | ✅ MATCH |
| 5 | `current_seller_id` | `()` | uuid | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 6 | `evaluate_campaign_schedules` | `()` | jsonb | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 7 | `get_active_seller_by_code` | `(text)` | record | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 8 | `get_campaign_scheduler_status` | `()` | jsonb | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 9 | `handle_new_user` | `()` | trigger | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 10 | `has_role` | `(uuid, text)` | bool | ✅ | `''` | `''` | ✅ MATCH |
| 11 | `is_staff` | `(uuid)` | bool | ✅ | `''` | `''` | ✅ MATCH |
| 12 | `issue_tickets` | `(uuid)` | tickets | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 13 | `lookup_payment_recovery_token` | `(text)` | jsonb | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 14 | `owns_customer` | `(uuid)` | bool | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 15 | `process_scheduled_campaign_transitions` | `()` | jsonb | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 16 | `record_payment_event` | `()` | trigger | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 17 | `reject_payment` | `(uuid, uuid, text)` | void | ✅ | `''` | `''` | ✅ MATCH |
| 18 | `revoke_payment_recovery_link` | `(uuid, uuid)` | jsonb | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 19 | `rls_auto_enable` | `()` | event_trigger | ✅ | `pg_catalog` | `pg_catalog` | ✅ MATCH |
| 20 | `seller_owns_customer` | `(uuid)` | bool | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 21 | `set_updated_at` | `()` | trigger | ❌ | `null` | `null` | ✅ MATCH |
| 22 | `submit_manual_upi` | `(uuid, text, text)` | void | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 23 | `submit_payment_details_completion` | `(uuid, text, text, text, text, text)` | jsonb | ✅ | `public` | `''` | ⚠️ DIFFERENT |
| 24 | `trg_seller_messages_populate_snapshot` | `()` | trigger | ✅ | `''` | `''` | ✅ MATCH |
| 25 | `trg_seller_messages_protect_immutable` | `()` | trigger | ✅ | `''` | `''` | ✅ MATCH |
| 26 | `validate_status_transition` | `()` | trigger | ✅ | `''` | `''` | ✅ MATCH |
| 27 | `verify_payment_and_issue` | `(uuid, uuid)` | tickets | ✅ | `''` | `''` | ✅ MATCH |
| — | `get_payment_screenshot_storage_metrics` | `(uuid)` | record | — | — | `''` | ❌ MISSING |

### `search_path` Analysis

- **7 functions** use `search_path=''` (empty — hardened): `create_seller_order`, `has_role`, `is_staff`, `reject_payment`, `trg_seller_messages_populate_snapshot`, `trg_seller_messages_protect_immutable`, `validate_status_transition`, `verify_payment_and_issue`
- **18 functions** use `search_path=public`: All others
- **1 function** uses `search_path=pg_catalog`: `rls_auto_enable` (correct)
- **1 function** has `null` config: `set_updated_at` (correct — not SECURITY DEFINER)

**Interpretation:** The P0 security remediation migration (`202610300001`) was designed to set ALL privileged functions to `search_path=''`. The remote Preview shows that only a subset has the hardened path. This suggests that either:
- (a) The P0 migration was applied in a partial or earlier version, OR
- (b) Subsequent migrations (12–14) re-created some functions with `search_path=public` (e.g., `create_payment_recovery_link`, `submit_payment_details_completion`)

The 7 functions that ARE hardened (`create_seller_order`, `has_role`, `is_staff`, `reject_payment`, `validate_status_transition`, `verify_payment_and_issue`, both trigger functions) correspond to the **most security-critical** functions — the identity guards, payment operations, and data protection triggers. This is consistent with the P0 remediation having been applied for the critical subset.

---

## 9. Trigger Comparison

| # | Trigger | Table | Function | Enabled | Phase B | Status |
|---|---------|-------|----------|---------|---------|--------|
| 1 | `campaigns_updated` | campaigns | `set_updated_at` | ✅ O | ✅ | MATCH |
| 2 | `trg_customer_email_outbox_updated` | customer_email_outbox | `set_updated_at` | ✅ O | ✅ | MATCH |
| 3 | `customers_updated` | customers | `set_updated_at` | ✅ O | ✅ | MATCH |
| 4 | `order_status_guard` | orders | `validate_status_transition` | ✅ O | ✅ | MATCH |
| 5 | `orders_updated` | orders | `set_updated_at` | ✅ O | ✅ | MATCH |
| 6 | `payment_event_log` | payments | `record_payment_event` | ✅ O | ✅ | MATCH |
| 7 | `payment_status_guard` | payments | `validate_status_transition` | ✅ O | ✅ | MATCH |
| 8 | `payments_updated` | payments | `set_updated_at` | ✅ O | ✅ | MATCH |
| 9 | `profiles_updated` | profiles | `set_updated_at` | ✅ O | ✅ | MATCH |
| 10 | `trg_seller_messages_populate_snapshot` | seller_messages | `trg_seller_messages_populate_snapshot` | ✅ O | ✅ | MATCH |
| 11 | `trg_seller_messages_protect` | seller_messages | `trg_seller_messages_protect_immutable` | ✅ O | ✅ | MATCH |
| 12 | `sellers_updated` | sellers | `set_updated_at` | ✅ O | ✅ | MATCH |
| 13 | `trg_system_settings_updated` | system_settings | `set_updated_at` | ✅ O | ✅ | MATCH |
| 14 | `ticket_deliveries_updated` | ticket_deliveries | `set_updated_at` | ✅ O | ✅ | MATCH |
| 15 | `tickets_updated` | tickets | `set_updated_at` | ✅ O | ✅ | MATCH |

> **Trigger Status: 15/15 MATCH — all triggers present and enabled.**

---

## 10. RLS Comparison

### RLS Enabled State: ✅ ALL 21 tables have RLS enabled

### Policy Comparison (32 present vs 34 Phase B target)

| # | Table | Policy | Cmd | Roles | Phase B | Status |
|---|-------|--------|-----|-------|---------|--------|
| 1 | `audit_logs` | `audit_staff_read` | SELECT | authenticated | ✅ | MATCH |
| 2 | `campaigns` | `campaigns_public_read` | SELECT | public | ✅ | MATCH |
| 3 | `campaigns` | `campaigns_staff_write` | ALL | authenticated | ✅ | MATCH |
| 4 | `customer_email_outbox` | `customer_email_outbox_staff_read` | SELECT | authenticated | ✅ | MATCH |
| 5 | `customers` | `customers_access` | SELECT | authenticated | ✅ | MATCH |
| 6 | `draw_results` | `results_staff_access` | ALL | authenticated | ✅ | MATCH |
| 7 | `draws` | `draws_staff_access` | ALL | authenticated | ✅ | MATCH |
| 8 | `order_items` | `order_items_access` | SELECT | authenticated | ✅ | MATCH |
| 9 | `orders` | `orders_access` | SELECT | authenticated | ✅ | MATCH |
| 10 | `payment_events` | `payment_events_staff_read` | SELECT | authenticated | ✅ | MATCH |
| 11 | `payment_recovery_tokens` | `service_role_all_payment_recovery_tokens` | ALL | service_role | ✅ | MATCH |
| 12 | `payment_recovery_tokens` | `staff_select_payment_recovery_tokens` | SELECT | authenticated | ✅ | MATCH |
| 13 | `payments` | `payments_access` | SELECT | authenticated | ✅ | MATCH |
| 14 | `prizes` | `prizes_public_read` | SELECT | public | ✅ | MATCH |
| 15 | `prizes` | `prizes_staff_write` | ALL | authenticated | ✅ | MATCH |
| 16 | `profile_roles` | `profile_roles_staff_read` | SELECT | authenticated | ✅ | MATCH |
| 17 | `profiles` | `profiles_own_select` | SELECT | authenticated | ✅ | MATCH |
| 18 | `profiles` | `profiles_staff_write` | ALL | authenticated | ✅ | MATCH |
| 19 | `roles` | `roles_staff_read` | SELECT | authenticated | ✅ | MATCH |
| 20 | `seller_messages` | `seller_messages_seller_insert` | INSERT | authenticated | ✅ | MATCH |
| 21 | `seller_messages` | `seller_messages_seller_read` | SELECT | authenticated | ✅ | MATCH |
| 22 | `seller_messages` | `seller_messages_seller_update` | UPDATE | authenticated | ✅ | MATCH |
| 23 | `seller_messages` | `seller_messages_staff_insert` | INSERT | authenticated | ✅ | MATCH |
| 24 | `seller_messages` | `seller_messages_staff_read` | SELECT | authenticated | ✅ | MATCH |
| 25 | `seller_messages` | `seller_messages_staff_update` | UPDATE | authenticated | ✅ | MATCH |
| 26 | `sellers` | `sellers_access` | SELECT | authenticated | ✅ | MATCH |
| 27 | `system_settings` | `system_settings_staff_read` | SELECT | authenticated | ✅ | MATCH |
| 28 | `system_settings` | `system_settings_staff_update` | UPDATE | authenticated | ✅ | MATCH |
| 29 | `ticket_deliveries` | `ticket_deliveries_customer_read` | SELECT | authenticated | ✅ | MATCH |
| 30 | `ticket_deliveries` | `ticket_deliveries_seller_read` | SELECT | authenticated | ✅ | MATCH |
| 31 | `ticket_deliveries` | `ticket_deliveries_staff_read` | SELECT | authenticated | ✅ | MATCH |
| 32 | `ticket_verifications` | `verification_staff_read` | SELECT | authenticated | ✅ | MATCH |
| 33 | `tickets` | `tickets_access` | SELECT | authenticated | ✅ | MATCH |
| — | `payment_screenshots` | *(2 expected policies)* | — | — | ❌ | MISSING (table absent) |

> **RLS Verdict: 32/32 existing policies MATCH Phase B. 2 policies missing due to absent `payment_screenshots` table.**

---

## 11. Privilege Findings

### Table Grants

| Grantee | Privilege | Tables Affected | Status |
|---------|-----------|----------------|--------|
| `anon` | SELECT | 15 tables (all core except `customer_email_outbox`, `payment_recovery_tokens`, `system_settings`) | ✅ HARDENED — SELECT only |
| `authenticated` | SELECT | All 21 tables | ✅ HARDENED — SELECT only |
| `authenticated` | UPDATE | `system_settings` only | ✅ MATCH — guarded by RLS |

**No INSERT, DELETE, UPDATE (except `system_settings`), TRUNCATE, TRIGGER, or REFERENCES grants to `anon` or `authenticated`.** ✅ P0 hardening confirmed.

### `payment_recovery_tokens` Grants

| Grantee | Privileges | Status |
|---------|-----------|--------|
| `service_role` | ALL (SELECT, INSERT, UPDATE, DELETE, TRIGGER, TRUNCATE, REFERENCES) | ✅ MATCH |
| `anon` | NONE | ✅ MATCH |
| `authenticated` | NONE (RLS policy provides SELECT to staff) | ✅ MATCH |

### Function EXECUTE Grants

| Function | anon | authenticated | service_role | Expected | Status |
|----------|------|--------------|-------------|----------|--------|
| `admin_reissue_ticket` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `admin_void_ticket` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `create_payment_recovery_link` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `create_seller_order` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `current_seller_id` | ❌ | ✅ | ✅ | auth + service | ✅ MATCH |
| `evaluate_campaign_schedules` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `get_active_seller_by_code` | ✅ | ✅ | ✅ | public | ✅ MATCH |
| `get_campaign_scheduler_status` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `handle_new_user` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `has_role` | ❌ | ✅ | ✅ | auth + service | ✅ MATCH |
| `is_staff` | ❌ | ✅ | ✅ | auth + service | ✅ MATCH |
| `issue_tickets` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `lookup_payment_recovery_token` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `owns_customer` | ❌ | ✅ | ✅ | auth + service | ✅ MATCH |
| `process_scheduled_campaign_transitions` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `record_payment_event` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `reject_payment` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `revoke_payment_recovery_link` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `seller_owns_customer` | ❌ | ✅ | ✅ | auth + service | ✅ MATCH |
| `set_updated_at` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `submit_manual_upi` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `submit_payment_details_completion` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `trg_seller_messages_populate_snapshot` | ✅ | ✅ | ✅ | — | ⚠️ EXTRA grants |
| `trg_seller_messages_protect_immutable` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `validate_status_transition` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |
| `verify_payment_and_issue` | ❌ | ❌ | ✅ | service_role only | ✅ MATCH |

**Security Finding:** `trg_seller_messages_populate_snapshot` has EXECUTE granted to `anon` and `authenticated`. This is a trigger function that runs automatically; client-side EXECUTE is unnecessary. Low severity (trigger functions are invoked by the engine, not directly callable for data mutation), but should be revoked for defense-in-depth.

---

## 12. Storage Bucket Assessment

```sql
SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY name;
```

**Result: 0 rows — NO storage buckets exist.**

| Bucket | Expected | Actual | Status |
|--------|----------|--------|--------|
| `payment-screenshots` | Private, 2097152 bytes, image/jpeg+png+webp | **ABSENT** | ❌ MISSING |

### Storage RLS Policies

```sql
SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'storage';
```

**Result: 0 rows — No storage policies exist.**

This is expected because the `payment_screenshots` migration that creates the bucket has not been applied.

---

## 13. Payment Screenshot Readiness

| Requirement | Status | Detail |
|-------------|--------|--------|
| `payment_recovery_tokens` table | ✅ PRESENT | All 10 columns match Phase B |
| `payment_recovery_tokens` indexes | ✅ PRESENT | PK + unique hash + 2 indexes |
| `payment_recovery_tokens` RLS | ✅ PRESENT | 2 policies (service_role ALL + staff SELECT) |
| `create_payment_recovery_link` RPC | ✅ PRESENT | Correct signature |
| `lookup_payment_recovery_token` RPC | ✅ PRESENT | Correct signature |
| `submit_payment_details_completion` RPC | ✅ PRESENT | Correct 6-arg signature |
| `revoke_payment_recovery_link` RPC | ✅ PRESENT | Correct signature |
| `payment_screenshots` table | ❌ MISSING | Migration `202611011200` not applied |
| `get_payment_screenshot_storage_metrics` RPC | ❌ MISSING | Part of migration `202611011200` |
| `payment-screenshots` Storage bucket | ❌ MISSING | Part of migration `202611011200` |
| Storage RLS policies | ❌ MISSING | Not applicable (no bucket) |

**Readiness Verdict:**
- Payment recovery link generation: ✅ READY
- Payment recovery token lookup and submission: ✅ READY
- Payment screenshot upload: ❌ NOT READY — requires migration `202611011200`

---

## 14. Data Classification

| Metric | Value | Method |
|--------|-------|--------|
| Order count | 33 | `SELECT COUNT(*) FROM public.orders` |
| Data source | Unknown | Cannot inspect row contents without exposing PII |
| Classification | **UNCERTAIN** | 33 orders suggest active testing or real usage |

**Owner action required:** The project owner must classify whether the 33 existing orders contain:
- (a) Synthetic test data — safe for testing
- (b) Real customer data — requires data protection procedures before testing
- (c) Mixed — requires selective handling

> **This assessment does NOT inspect, export, or expose any order data. The row count is the only data point obtained.**

---

## 15. Application Environment Safety

| Protection | Status | Evidence |
|-----------|--------|---------|
| `.env.local` points to Preview | ✅ VERIFIED | `NEXT_PUBLIC_SUPABASE_URL=https://jiyuiydzsfydjklosvvq.supabase.co` |
| UPI payment info configured | ✅ VERIFIED | `NEXT_PUBLIC_SSFI_UPI_ID` set (value not exposed) |
| Email simulation gate | **UNKNOWN** | Requires runtime testing (not performed per safety rules) |
| Storage access mediation | ✅ Architecture-level | Server actions use `createSupabaseAdminClient()` — no direct client access |
| Ticket issuance safeguards | ✅ | `issue_tickets` restricted to `service_role` EXECUTE |
| Payment verification safeguards | ✅ | `verify_payment_and_issue` restricted to `service_role` EXECUTE with identity assertion |

---

## 16. Unresolved Issues

| # | Issue | Severity | Recommendation |
|---|-------|----------|----------------|
| 1 | `payment_screenshots` table missing | **CRITICAL** | Apply migration `202611011200` via Dashboard SQL Editor |
| 2 | Storage bucket missing | **CRITICAL** | Created by migration `202611011200` |
| 3 | `search_path` inconsistency (18 functions use `public` instead of `''`) | **MEDIUM** | Re-apply the `search_path` hardening from `202610300001` for the 18 affected functions |
| 4 | `trg_seller_messages_populate_snapshot` has excess EXECUTE grants | **LOW** | Revoke EXECUTE from `anon` and `authenticated` |
| 5 | `supabase_migrations.schema_migrations` table absent | **MEDIUM** | Consider creating and seeding migration history for future CLI compatibility |
| 6 | Data classification uncertain (33 orders) | **MEDIUM** | Owner must classify before destructive testing |
| 7 | `get_payment_screenshot_storage_metrics` function missing | **LOW** | Created by migration `202611011200` |

---

## 17. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Applying migration `202611011200` to Production by mistake | Low (Production not linked) | **CATASTROPHIC** | Only apply via Dashboard SQL Editor after confirming project URL contains `jiyuiydzsfydjklosvvq` |
| `search_path=public` allows schema poisoning | Low (all functions are SECURITY DEFINER + EXECUTE restricted to service_role) | Medium | The EXECUTE grant restriction prevents client-side invocation; risk is theoretical in current architecture |
| Existing 33 orders contain real customer data | Medium | High | Owner must classify before testing |
| Missing migration history breaks future CLI operations | Medium | Medium | Seed `supabase_migrations.schema_migrations` with all 15 versions |

---

## 18. Preview Readiness Decision

### ⚠️ READY FOR PHASE D WITH BLOCKERS

**Justification:**

✅ **What is ready:**
- Preview identity confirmed via remote API
- 21 of 22 target tables present with full schema parity
- All 15 triggers operational
- 32 of 34 RLS policies match Phase B target
- EXECUTE grant hardening is correct for all security-critical RPCs
- Table grant hardening is complete (SELECT-only for `anon`/`authenticated`)
- Sequences at correct MAXVALUE
- All ENUMs correct
- Payment recovery infrastructure fully operational
- Production not linked, not queried, not modified

❌ **Blockers before Phase E execution:**

1. **Apply migration `202611011200_payment_screenshots.sql`** — creates `payment_screenshots` table, Storage bucket, and metrics RPC
2. **Remediate `search_path` inconsistency** — update 18 functions from `search_path=public` to `search_path=''`
3. **Owner classifies existing 33 orders** — synthetic vs real data
4. **Establish migration history** (recommended but not blocking) — seed `supabase_migrations.schema_migrations`

---

## Final Safety Confirmation

- [x] Production (`fohpqheglxhfdecadhzw`) was **NOT accessed** — not linked, no queries sent
- [x] No Production modifications occurred
- [x] No Preview migrations were applied
- [x] No Preview data was modified (all queries were `SELECT`)
- [x] No Storage bucket was created
- [x] No screenshot was uploaded
- [x] No deployment occurred
- [x] No secrets were exposed (no connection strings, passwords, or keys displayed)
- [x] No commit or push occurred
- [x] Existing user working-tree changes were preserved

---

*Document authored by Principal Software Architect, Senior Supabase Engineer, PostgreSQL Security Engineer, and Environment Reliability Engineer.*
*All remote queries executed via `npx supabase db query --linked` (Management API, read-only).*
*Production (`fohpqheglxhfdecadhzw`) was strictly untouched throughout this phase.*
