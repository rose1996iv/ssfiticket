# Phase C — Preview Migration Status

**Date:** 2026-11-02  
**Verification Method:** `npx supabase db query --linked` + `npx supabase migration list`  
**Target Project:** `jiyuiydzsfydjklosvvq` (`ssfi-lucky-draw-dev`)

---

## 1. Migration Tracking Infrastructure

### `supabase_migrations.schema_migrations` Table

**Status: DOES NOT EXIST**

```
ERROR: 42P01: relation "supabase_migrations.schema_migrations" does not exist
```

All schema objects on the remote Preview were applied directly via the Supabase Dashboard SQL Editor, not through the Supabase CLI migration runner. The CLI's `migration list` command therefore reports all 15 local migrations as having `remote: ""` (no remote tracking record).

### Implications

1. `npx supabase db push` **cannot safely execute** — it cannot determine which migrations have been applied
2. Future migration application must be done manually via Dashboard SQL Editor, OR the migration history must be seeded first
3. `npx supabase db diff --linked` can still compare live schema against a shadow database built from local migrations

---

## 2. Migration Application Status (Inferred from Schema Inspection)

| # | Version | Name | Remote Status | Evidence |
|---|---------|------|---------------|----------|
| 1 | `202610270001` | `phase2_core` | ✅ APPLIED | Core tables, ENUMs present |
| 2 | `202610270002` | `phase3_operations` | ✅ APPLIED | Operations tables present |
| 3 | `202610280001` | `phase4_seller_referrals` | ✅ APPLIED | Sellers table present |
| 4 | `202610290001` | `phase5_campaign_schedule` | ✅ APPLIED | Campaign scheduling present |
| 5 | `202610290002` | `phase6_seller_messages` | ✅ APPLIED | seller_messages table present |
| 6 | `202610290003` | `phase7_campaign_auto_scheduler` | ✅ APPLIED | Auto-scheduler RPCs present |
| 7 | `202610290004` | `phase8_ticket_lifecycle_and_delivery` | ✅ APPLIED | Delivery tables & ENUMs present |
| 8 | `202610290005` | `audit_logs_service_role_permission` | ✅ APPLIED | Audit logs + permissions present |
| 9 | `202610290006` | `fix_status_transition_triggers` | ✅ APPLIED | Status guard triggers present |
| 10 | `202610290007` | `bidirectional_seller_messages` | ✅ APPLIED | `sender_role`, `parent_message_id`, immutability trigger |
| 11 | `202610300001` | `p0_security_remediation` | ⚠️ PARTIALLY APPLIED | Grants hardened ✅, sequences fixed ✅, `search_path` mixed ⚠️ |
| 12 | `202611010001` | `customer_email_outbox` | ✅ APPLIED | Table + 7 indexes + RLS present |
| 13 | `202611011000` | `seller_messages_preserve_on_delete` | ✅ APPLIED | FK `ON DELETE SET NULL` confirmed |
| 14 | `202611011100` | `payment_recovery_tokens` | ✅ APPLIED | Table + 4 RPCs + RLS present |
| 15 | `202611011200` | `payment_screenshots` | ❌ NOT APPLIED | Table absent, bucket absent, function absent |

---

## 3. `search_path` Drift Detail

The P0 security remediation (`202610300001`) was designed to harden all SECURITY DEFINER functions to `SET search_path = ''`. However, the remote Preview shows a mixed state:

### Functions with hardened `search_path=''` (8)

| Function | Status |
|----------|--------|
| `create_seller_order` | ✅ Hardened |
| `has_role` | ✅ Hardened |
| `is_staff` | ✅ Hardened |
| `reject_payment` | ✅ Hardened |
| `trg_seller_messages_populate_snapshot` | ✅ Hardened |
| `trg_seller_messages_protect_immutable` | ✅ Hardened |
| `validate_status_transition` | ✅ Hardened |
| `verify_payment_and_issue` | ✅ Hardened |

### Functions with `search_path=public` (18)

| Function | Risk | Note |
|----------|------|------|
| `admin_reissue_ticket` | Low | EXECUTE restricted to service_role |
| `admin_void_ticket` | Low | EXECUTE restricted to service_role |
| `create_payment_recovery_link` | Low | EXECUTE restricted to service_role |
| `current_seller_id` | Medium | EXECUTE granted to authenticated |
| `evaluate_campaign_schedules` | Low | EXECUTE restricted to service_role |
| `get_active_seller_by_code` | Medium | EXECUTE granted to public |
| `get_campaign_scheduler_status` | Low | EXECUTE restricted to service_role |
| `handle_new_user` | Low | Trigger function — auth.users trigger only |
| `issue_tickets` | Low | EXECUTE restricted to service_role |
| `lookup_payment_recovery_token` | Low | EXECUTE restricted to service_role |
| `owns_customer` | Medium | EXECUTE granted to authenticated; used in RLS |
| `process_scheduled_campaign_transitions` | Low | EXECUTE restricted to service_role |
| `record_payment_event` | Low | Trigger function — invoked by engine |
| `revoke_payment_recovery_link` | Low | EXECUTE restricted to service_role |
| `seller_owns_customer` | Medium | EXECUTE granted to authenticated; used in RLS |
| `submit_manual_upi` | Low | EXECUTE restricted to service_role |
| `submit_payment_details_completion` | Low | EXECUTE restricted to service_role |

### Recommended Remediation

Apply the following SQL in Preview Dashboard SQL Editor to complete the P0 hardening:

```sql
-- Phase D remediation script (DO NOT EXECUTE YET — requires Phase D approval)
-- This is a documentation reference only.

ALTER FUNCTION public.admin_reissue_ticket(uuid, uuid, text) SET search_path = '';
ALTER FUNCTION public.admin_void_ticket(uuid, uuid, text) SET search_path = '';
ALTER FUNCTION public.create_payment_recovery_link(uuid, text, uuid, integer) SET search_path = '';
ALTER FUNCTION public.current_seller_id() SET search_path = '';
ALTER FUNCTION public.evaluate_campaign_schedules() SET search_path = '';
ALTER FUNCTION public.get_active_seller_by_code(text) SET search_path = '';
ALTER FUNCTION public.get_campaign_scheduler_status() SET search_path = '';
ALTER FUNCTION public.handle_new_user() SET search_path = '';
ALTER FUNCTION public.issue_tickets(uuid) SET search_path = '';
ALTER FUNCTION public.lookup_payment_recovery_token(text) SET search_path = '';
ALTER FUNCTION public.owns_customer(uuid) SET search_path = '';
ALTER FUNCTION public.process_scheduled_campaign_transitions() SET search_path = '';
ALTER FUNCTION public.record_payment_event() SET search_path = '';
ALTER FUNCTION public.revoke_payment_recovery_link(uuid, uuid) SET search_path = '';
ALTER FUNCTION public.seller_owns_customer(uuid) SET search_path = '';
ALTER FUNCTION public.submit_manual_upi(uuid, text, text) SET search_path = '';
ALTER FUNCTION public.submit_payment_details_completion(uuid, text, text, text, text, text) SET search_path = '';
```

> **WARNING:** These functions reference `public.` schema objects in their bodies. Setting `search_path = ''` requires that ALL table and function references within their bodies are fully schema-qualified (e.g., `public.orders` not just `orders`). The migration file `202610300001` was designed with fully-qualified references. If the Dashboard-applied version used unqualified references, setting `search_path = ''` would break them. **Verify function bodies before applying.**

---

## 4. Recommended Phase D Migration Actions

1. **Apply migration `202611011200_payment_screenshots.sql`** via Dashboard SQL Editor on Preview
2. **Remediate `search_path`** after verifying function body qualification
3. **Optionally seed migration history** to enable future CLI-managed migrations:
   ```sql
   CREATE SCHEMA IF NOT EXISTS supabase_migrations;
   CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
     version text PRIMARY KEY,
     statements text[],
     name text
   );
   INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
   ('202610270001', 'phase2_core'),
   ('202610270002', 'phase3_operations'),
   ('202610280001', 'phase4_seller_referrals'),
   ('202610290001', 'phase5_campaign_schedule'),
   ('202610290002', 'phase6_seller_messages'),
   ('202610290003', 'phase7_campaign_auto_scheduler'),
   ('202610290004', 'phase8_ticket_lifecycle_and_delivery'),
   ('202610290005', 'audit_logs_service_role_permission'),
   ('202610290006', 'fix_status_transition_triggers'),
   ('202610290007', 'bidirectional_seller_messages'),
   ('202610300001', 'p0_security_remediation'),
   ('202611010001', 'customer_email_outbox'),
   ('202611011000', 'seller_messages_preserve_on_delete'),
   ('202611011100', 'payment_recovery_tokens'),
   ('202611011200', 'payment_screenshots');
   ```
   > **Note:** Only seed `202611011200` AFTER applying that migration.

