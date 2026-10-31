# SSFI Lucky Draw — Migration Parity & Impact Matrix

This matrix provides the definitive, chronological audit of all 11 local migrations in `supabase/migrations/` evaluated against the live Production schema dump [`backups/production-public-schema.sql`](file:///F:/PROJECT/Lucky%20Draw/backups/production-public-schema.sql).

---

## 1. Decision Table

| Migration Version & Name | Actual Production State | Action | Risk Level |
|---|---|---|---|
| `202610270001_phase2_core.sql` | **ALREADY_PRESENT** | Baseline as applied (sequence maxvalue patched by Phase 8/Candidate) | Low |
| `202610270002_phase3_operations.sql` | **ALREADY_PRESENT** | Baseline as applied (RPC signatures patched by Candidate) | Low |
| `202610280001_phase4_seller_referrals.sql` | **ALREADY_PRESENT** | Baseline as applied | None |
| `202610290001_phase5_campaign_schedule.sql` | **ALREADY_PRESENT** | Baseline as applied (Superseded by P0 remediation) | None |
| `202610290002_phase6_seller_messages.sql` | **ALREADY_PRESENT** | Baseline as applied (Base table present; columns added by Phase 10) | Low |
| `202610290003_phase7_campaign_auto_scheduler.sql` | **NOT_PRESENT** | **MUST EXECUTE** via candidate SQL | **High (P1)** |
| `202610290004_phase8_ticket_lifecycle_and_delivery.sql` | **PARTIALLY_PRESENT** | **MUST EXECUTE SEQUENCE UPGRADE** (`MAXVALUE 999999`) | **Critical (P0)** |
| `202610290005_audit_logs_service_role_permission.sql` | **PARTIALLY_PRESENT** | **MUST EXECUTE RE-GRANT** to `service_role` | **Medium** |
| `202610290006_fix_status_transition_triggers.sql` | **NOT_PRESENT** | **MUST EXECUTE** via candidate SQL | **High (P1)** |
| `202610290007_bidirectional_seller_messages.sql` | **NOT_PRESENT** | **MUST EXECUTE** via candidate SQL | **Critical (P0)** |
| `202610300001_p0_security_remediation.sql` | **NOT_PRESENT** | **MUST EXECUTE** via candidate SQL | **Critical (P0)** |

---

## 2. Migration-by-Migration Audit & Line Reference Proof

### Migration 01: `202610270001_phase2_core.sql`
- **Classification:** `ALREADY_PRESENT`
- **Verification Evidence in `backups/production-public-schema.sql`:**
  - Enums (6): `campaign_status` (L26), `draw_status` (L59), `order_status` (L70), `payment_method` (L83), `payment_status` (L91), `ticket_status` (L104).
  - Core Tables (16): `roles` (L797), `profiles` (L783), `profile_roles` (L773), `campaigns` (L610), `prizes` (L755), `draws` (L663), `draw_results` (L651), `customers` (L636), `sellers` (L824), `orders` (L693), `order_items` (L677), `payments` (L730), `payment_events` (L715), `tickets` (L413), `ticket_verifications` (L885), `audit_logs` (L596).
  - Sequences: `ssfi_order_number_sequence` (L839), `ssfi_ticket_number_sequence` (L850, `MAXVALUE 1000`).
  - Core Functions: `handle_new_user` (L382), `set_updated_at` (L541), `record_payment_event` (L472), `rls_auto_enable` (L498), `has_role` (L392), `is_staff` (L424), `owns_customer` (L452), `seller_owns_customer` (L527), `current_seller_id` (L351).
  - Triggers: `campaigns_updated` (L1117), `customers_updated` (L1121), `orders_updated` (L1129), `payments_updated` (L1141), `profiles_updated` (L1145), `sellers_updated` (L1149), `tickets_updated` (L1157), `payment_event_log` (L1133).
- **Execution Safety:** Safe to baseline as applied. Do not re-run DDL.

---

### Migration 02: `202610270002_phase3_operations.sql`
- **Classification:** `ALREADY_PRESENT`
- **Verification Evidence in `backups/production-public-schema.sql`:**
  - Unique Index: `payments_manual_upi_utr_unique` on `payments(utr_reference)` (L1093).
  - Index: `payments_utr_idx` on `payments(utr_reference)` (L1101).
  - Functions: `issue_tickets` (L438), `submit_manual_upi` (L549), `create_seller_order` (L269), `verify_payment_and_issue` (L577), `reject_payment` (L481).
  - Triggers: `order_status_guard` (L1125), `payment_status_guard` (L1137).
  - Trigger Function: `validate_status_transition` (L567).
- **Execution Safety:** Safe to baseline as applied. Updated signatures will be replaced cleanly by candidate SQL.

---

### Migration 03: `202610280001_phase4_seller_referrals.sql`
- **Classification:** `ALREADY_PRESENT`
- **Verification Evidence in `backups/production-public-schema.sql`:**
  - Function: `get_active_seller_by_code(text)` defined with `SECURITY DEFINER` (L363–376).
  - Grants: `GRANT ALL ON FUNCTION get_active_seller_by_code TO anon, authenticated, service_role` (L1520–1522).
- **Execution Safety:** 100% applied in Production.

---

### Migration 04: `202610290001_phase5_campaign_schedule.sql`
- **Classification:** `ALREADY_PRESENT`
- **Verification Evidence in `backups/production-public-schema.sql`:**
  - Function `create_seller_order` in Production (L269–346) contains the schedule window enforcement:
    `if v_campaign.start_at is not null and now() < v_campaign.start_at then raise exception 'campaign ticket sales have not opened yet';`
    `if v_campaign.end_at is not null and now() >= v_campaign.end_at then raise exception 'campaign ticket sales have ended';`
- **Execution Safety:** Safe to baseline as applied. Will be replaced by migration 11's 6-parameter version.

---

### Migration 05: `202610290002_phase6_seller_messages.sql`
- **Classification:** `ALREADY_PRESENT`
- **Verification Evidence in `backups/production-public-schema.sql`:**
  - Table: `seller_messages` defined (L807–817).
  - Policies: `seller_messages_seller_read` (L1431), `seller_messages_seller_update` (L1437), `seller_messages_staff_insert` (L1445), `seller_messages_staff_read` (L1449).
  - Indexes: `idx_seller_messages_recipient` (L1045), `idx_seller_messages_sender` (L1049).
- **Execution Safety:** Safe to baseline as applied. Additional bidirectional columns will be added non-destructively.

---

### Migration 06: `202610290003_phase7_campaign_auto_scheduler.sql`
- **Classification:** `NOT_PRESENT`
- **Verification Evidence in `backups/production-public-schema.sql`:**
  - `process_scheduled_campaign_transitions`: **NOT FOUND in Production.**
  - `evaluate_campaign_schedules`: **NOT FOUND in Production.**
  - `get_campaign_scheduler_status`: **NOT FOUND in Production.**
- **Risk if Not Applied:** Vercel cron `/api/cron/campaign-schedule` returns HTTP 500 error; orders fail to trigger scheduled transitions.
- **Action:** Must be deployed via candidate SQL.

---

### Migration 07: `202610290004_phase8_ticket_lifecycle_and_delivery.sql`
- **Classification:** `PARTIALLY_PRESENT`
- **Verification Evidence in `backups/production-public-schema.sql`:**
  - **Present:**
    - Enums `delivery_channel` (L38) and `delivery_status` (L47).
    - Table `ticket_deliveries` (L861–879) with `provider DEFAULT 'mock'::text` (L868).
    - Table `tickets` soft-voiding columns: `voided_at` (L425), `void_reason` (L426), `voided_by` (L427), `original_ticket_id` (L428), `reissued_ticket_id` (L429), `admin_notes` (L430).
    - Functions `admin_void_ticket` (L210) and `admin_reissue_ticket` (L115).
  - **Missing:**
    - Sequence maxvalue upgrade: `ssfi_ticket_number_sequence` was NOT altered and remains `MAXVALUE 1000` (L850).
- **Risk if Not Applied:** Hard failure after 1,000 tickets sold.
- **Action:** Execute sequence maxvalue update in candidate SQL.

---

### Migration 08: `202610290005_audit_logs_service_role_permission.sql`
- **Classification:** `PARTIALLY_PRESENT`
- **Verification Evidence in `backups/production-public-schema.sql`:**
  - In Production (L1574), `service_role` has `REFERENCES, TRIGGER, TRUNCATE, MAINTAIN` on `audit_logs`, but lacks `SELECT, INSERT, UPDATE, DELETE`.
- **Action:** Grant full operational privileges (`ALL`) to `service_role`.

---

### Migration 09: `202610290006_fix_status_transition_triggers.sql`
- **Classification:** `NOT_PRESENT`
- **Verification Evidence in `backups/production-public-schema.sql`:**
  - Production `validate_status_transition` (L567) lacks `::text` casting and is not `SECURITY DEFINER`.
- **Risk if Not Applied:** Order and payment status updates may fail due to enum comparison operator resolution bugs.
- **Action:** Replace trigger function with cast-safe version via candidate SQL.

---

### Migration 10: `202610290007_bidirectional_seller_messages.sql`
- **Classification:** `NOT_PRESENT`
- **Verification Evidence in `backups/production-public-schema.sql`:**
  - `seller_messages.parent_message_id`: **NOT FOUND in Production.**
  - `seller_messages.sender_role`: **NOT FOUND in Production.**
  - `idx_seller_messages_parent`: **NOT FOUND in Production.**
  - `idx_seller_messages_role`: **NOT FOUND in Production.**
  - Policy `seller_messages_seller_insert`: **NOT FOUND in Production.**
- **Risk if Not Applied:** Admin and Seller messaging pages crash with missing column errors.
- **Action:** Add columns, constraints, and indexes via candidate SQL. In accordance with architectural audit, client write policies (`seller_messages_seller_insert`, `seller_messages_staff_update`) are dropped in favor of server-side execution via `createSupabaseAdminClient()` (`service_role`), while `SELECT` is retained for `authenticated` and direct mutations are revoked.

---

### Migration 11: `202610300001_p0_security_remediation.sql`
- **Classification:** `NOT_PRESENT`
- **Verification Evidence in `backups/production-public-schema.sql`:**
  - `has_role` and `is_staff` role enumeration defense: **NOT FOUND in Production.**
  - 6-parameter `create_seller_order` with mandatory email & regex contact checks: **NOT FOUND in Production.** (Production retains 5-argument version at L269).
  - Immutability trigger `trg_seller_messages_protect`: **NOT FOUND in Production.**
  - Revocation of `TRUNCATE, TRIGGER, MAINTAIN` from `anon`: **NOT FOUND in Production.** (Production grants them at L1536–1540).
- **Risk if Not Applied:** Critical security vulnerabilities, seller order creation crashes due to missing `p_actor` parameter.
- **Action:** Deploy hardened routines, triggers, and least-privilege grants via candidate SQL. Note: `is_staff(uuid)` is explicitly granted to `anon` to prevent 42501 permission errors on anonymous campaign/prize queries, with an internal guard immediately returning `false` for unauthenticated callers.
