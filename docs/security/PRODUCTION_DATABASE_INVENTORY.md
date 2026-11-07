# SSFI Lucky Draw — Complete Production Database Inventory (Phase 1)

- **Document ID:** `SSFI-DB-INV-PROD-2026-11-07`
- **Production Supabase Project Reference:** `fohpqheglxhfdecadhzw`
- **Production Git Branch:** `main`
- **Safety & Provenance Notice:**
  - Production (`fohpqheglxhfdecadhzw`) was **never modified, mutated, or connected to via write credentials**.
  - Every entry in this inventory explicitly distinguishes between:
    - **`VERIFIED_PROD_DUMP`**: Directly verified from the authoritative Production `pg_dump` artifacts ([`backups/production-public-schema.sql`](file:///F:/PROJECT/Lucky%20Draw/backups/production-public-schema.sql), 1,698 lines; [`backups/production-public-data-before-release.sql`](file:///F:/PROJECT/Lucky%20Draw/backups/production-public-data-before-release.sql), 179 lines) and the read-only Management API audit recorded in [`docs/release-audit/04-production-data-plan.md`](file:///F:/PROJECT/Lucky%20Draw/docs/release-audit/04-production-data-plan.md).
    - **`LOCAL_MIGRATION_TARGET`**: Defined in local repository migrations (`supabase/migrations/202610290003` through `202611070001`) after the Production baseline dump was captured.

---

## 1. Database Objects Inventory

### 1.1 Schemas & PostgreSQL Extensions (`VERIFIED_PROD_DUMP`)

| Object Type | Name | Schema / Location | Provenance | Notes |
|---|---|---|---|---|
| **Schema** | `public` | Database root | `VERIFIED_PROD_DUMP` | Primary application schema (`standard public schema`). |
| **Schema** | `auth`, `storage`, `extensions`, `vault`, `graphql` | Supabase managed | `VERIFIED_PROD_DUMP` | Managed Supabase platform schemas. |
| **Extension** | `pgcrypto` | `extensions` | `VERIFIED_PROD_DUMP` | Cryptographic hashing & `gen_random_uuid()`. |
| **Extension** | `uuid-ossp` | `extensions` | `VERIFIED_PROD_DUMP` | UUID generation routines. |
| **Extension** | `pg_stat_statements` | `extensions` | `VERIFIED_PROD_DUMP` | Query execution statistics. |
| **Extension** | `pg_graphql` | `graphql` | `VERIFIED_PROD_DUMP` | PostgREST / GraphQL introspection. |
| **Extension** | `supabase_vault` | `vault` | `VERIFIED_PROD_DUMP` | Encrypted secret storage. |

---

### 1.2 Custom ENUM Types (8 ENUMs — `VERIFIED_PROD_DUMP` Lines 26–111)

| # | Enum Type | Allowed Labels | Provenance |
|---|---|---|---|
| 1 | `public.campaign_status` | `'DRAFT'`, `'ACTIVE'`, `'PAUSED'`, `'CLOSED'`, `'COMPLETED'`, `'CANCELLED'` | `VERIFIED_PROD_DUMP` (L26–33) |
| 2 | `public.delivery_channel` | `'EMAIL'`, `'WHATSAPP'` | `VERIFIED_PROD_DUMP` (L40–43) |
| 3 | `public.delivery_status` | `'PENDING'`, `'SENT'`, `'FAILED'`, `'SKIPPED'` | `VERIFIED_PROD_DUMP` (L50–55) |
| 4 | `public.draw_status` | `'PENDING'`, `'COMPLETED'`, `'CANCELLED'` | `VERIFIED_PROD_DUMP` (L62–66) |
| 5 | `public.order_status` | `'PENDING_PAYMENT'`, `'PAYMENT_SUBMITTED'`, `'PAYMENT_VERIFIED'`, `'TICKETS_ISSUED'`, `'CANCELLED'`, `'EXPIRED'`, `'FAILED'` | `VERIFIED_PROD_DUMP` (L73–81) |
| 6 | `public.payment_method` | `'MANUAL_UPI'`, `'RAZORPAY'` | `VERIFIED_PROD_DUMP` (L88–91) |
| 7 | `public.payment_status` | `'PENDING'`, `'SUBMITTED'`, `'VERIFIED'`, `'FAILED'`, `'REFUNDED'` | `VERIFIED_PROD_DUMP` (L98–104) |
| 8 | `public.ticket_status` | `'ISSUED'`, `'VOID'` | `VERIFIED_PROD_DUMP` (L111–114) |

---

### 1.3 Sequences (2 Sequences — `VERIFIED_PROD_DUMP`)

| Sequence Name | Data Type | Start / Increment | Min / Max Value | Current Value in Prod Dump | Provenance & Critical Note |
|---|---|---|---|---|---|
| `public.ssfi_order_number_sequence` | `bigint` | `START 1 INCREMENT 1` | `1` / `9223372036854775807` | `1` (`is_called = false`) | `VERIFIED_PROD_DUMP` (L839–845). Formats `ORD-YYYY-XXXXXX`. |
| `public.ssfi_ticket_number_sequence` | `bigint` | `START 1 INCREMENT 1` | `1` / **`1000`** | `1` (`is_called = false`) | `VERIFIED_PROD_DUMP` (L850–856). **Critical Divergence:** Capped at `MAXVALUE 1000` in Production baseline dump; upgraded to `MAXVALUE 999999` in migration `202610300001`. |

---

### 1.4 Tables, Columns, Data Types, Defaults, PKs, FKs, Unique & Check Constraints

#### Part A — 18 Tables Present in Production Baseline (`VERIFIED_PROD_DUMP`)

| # | Table | Columns (Name : Type [Default / Nullable]) | Primary Key | Foreign Keys | Unique & Check Constraints |
|---|---|---|---|---|---|
| 1 | `public.roles` | `id:uuid [gen_random_uuid(), NOT NULL]`, `name:text [NOT NULL]` | `roles_pkey (id)` | None | `roles_name_key UNIQUE (name)`, `roles_name_check CHECK (name IN ('SUPER_ADMIN','ADMIN','FUNDRAISING_MANAGER','SELLER'))` |
| 2 | `public.profiles` | `id:uuid [NOT NULL]`, `full_name:text`, `phone:text`, `email:text`, `is_active:boolean [true, NOT NULL]`, `created_at:timestamptz [now()]`, `updated_at:timestamptz [now()]` | `profiles_pkey (id)` | `profiles_id_fkey -> auth.users(id) ON DELETE CASCADE` | None |
| 3 | `public.profile_roles` | `profile_id:uuid [NOT NULL]`, `role_id:uuid [NOT NULL]`, `created_at:timestamptz [now()]` | `profile_roles_pkey (profile_id, role_id)` | `profile_id -> profiles(id) ON DELETE CASCADE`, `role_id -> roles(id) ON DELETE RESTRICT` | Composite PK enforces uniqueness |
| 4 | `public.campaigns` | `id:uuid [gen_random_uuid()]`, `public_id:text [NOT NULL]`, `name:text [NOT NULL]`, `description:text`, `ticket_price_paise:integer [10000, NOT NULL]`, `currency:text ['INR', NOT NULL]`, `total_ticket_limit:integer [1000, NOT NULL]`, `sold_ticket_count:integer [0, NOT NULL]`, `status:campaign_status ['DRAFT', NOT NULL]`, `start_at:timestamptz`, `end_at:timestamptz`, `created_at:timestamptz [now()]`, `updated_at:timestamptz [now()]` | `campaigns_pkey (id)` | None | `campaigns_public_id_key UNIQUE (public_id)`, `campaigns_currency_check CHECK (currency = 'INR')`, `campaigns_schedule_window_check CHECK (start_at IS NULL OR end_at IS NULL OR end_at > start_at)`, `campaigns_ticket_counts_check CHECK (sold_ticket_count >= 0 AND sold_ticket_count <= total_ticket_limit)`, `campaigns_ticket_price_paise_check CHECK (ticket_price_paise > 0)`, `campaigns_total_ticket_limit_check CHECK (total_ticket_limit > 0)` |
| 5 | `public.prizes` | `id:uuid [gen_random_uuid()]`, `campaign_id:uuid [NOT NULL]`, `prize_number:integer [NOT NULL]`, `title:text [NOT NULL]`, `description:text`, `cash_amount_paise:integer`, `display_order:integer [NOT NULL]`, `created_at:timestamptz [now()]` | `prizes_pkey (id)` | `campaign_id -> campaigns(id) ON DELETE CASCADE` | `prizes_campaign_id_prize_number_key UNIQUE (campaign_id, prize_number)`, `prizes_cash_amount_paise_check CHECK (cash_amount_paise IS NULL OR cash_amount_paise >= 0)`, `prizes_prize_number_check CHECK (prize_number > 0)` |
| 6 | `public.draws` | `id:uuid [gen_random_uuid()]`, `campaign_id:uuid [NOT NULL]`, `name:text [NOT NULL]`, `status:draw_status ['PENDING', NOT NULL]`, `scheduled_at:timestamptz`, `executed_at:timestamptz`, `created_at:timestamptz [now()]` | `draws_pkey (id)` | `campaign_id -> campaigns(id) ON DELETE RESTRICT` | None |
| 7 | `public.draw_results` | `id:uuid [gen_random_uuid()]`, `draw_id:uuid [NOT NULL]`, `prize_id:uuid [NOT NULL]`, `ticket_id:uuid [NOT NULL]`, `created_at:timestamptz [now()]` | `draw_results_pkey (id)` | `draw_id -> draws(id) ON DELETE RESTRICT`, `prize_id -> prizes(id) ON DELETE RESTRICT`, `ticket_id -> tickets(id) ON DELETE RESTRICT` | `draw_results_draw_id_prize_id_key UNIQUE (draw_id, prize_id)`, `draw_results_draw_id_ticket_id_key UNIQUE (draw_id, ticket_id)` |
| 8 | `public.sellers` | `id:uuid [gen_random_uuid()]`, `profile_id:uuid [NOT NULL]`, `seller_code:text [NOT NULL]`, `display_name:text [NOT NULL]`, `is_active:boolean [true, NOT NULL]`, `created_at:timestamptz [now()]`, `updated_at:timestamptz [now()]` | `sellers_pkey (id)` | `profile_id -> profiles(id) ON DELETE RESTRICT` | `sellers_profile_id_key UNIQUE (profile_id)`, `sellers_seller_code_key UNIQUE (seller_code)` *(Note: QR/UPI columns added in migration `202611020001`)* |
| 9 | `public.customers` | `id:uuid [gen_random_uuid()]`, `profile_id:uuid`, `full_name:text [NOT NULL]`, `phone:text [NOT NULL]`, `whatsapp_number:text`, `email:text`, `created_at:timestamptz [now()]`, `updated_at:timestamptz [now()]` | `customers_pkey (id)` | `profile_id -> profiles(id) ON DELETE SET NULL` | `customers_profile_id_key UNIQUE (profile_id)` |
| 10 | `public.orders` | `id:uuid [gen_random_uuid()]`, `order_number:text [NOT NULL]`, `campaign_id:uuid [NOT NULL]`, `customer_id:uuid [NOT NULL]`, `seller_id:uuid`, `quantity:integer [NOT NULL]`, `unit_price_paise:integer [NOT NULL]`, `total_amount_paise:integer [NOT NULL]`, `status:order_status ['PENDING_PAYMENT', NOT NULL]`, `created_at:timestamptz [now()]`, `updated_at:timestamptz [now()]` | `orders_pkey (id)` | `campaign_id -> campaigns(id) ON DELETE RESTRICT`, `customer_id -> customers(id) ON DELETE RESTRICT`, `seller_id -> sellers(id) ON DELETE SET NULL` | `orders_order_number_key UNIQUE (order_number)`, `orders_quantity_check CHECK (quantity > 0 AND quantity <= 50)`, `orders_total_check CHECK (total_amount_paise = quantity * unit_price_paise)` *(Note: 8 `snapshot_*` columns added in `202611020001`)* |
| 11 | `public.order_items` | `id:uuid [gen_random_uuid()]`, `order_id:uuid [NOT NULL]`, `quantity:integer [NOT NULL]`, `unit_price_paise:integer [NOT NULL]`, `total_amount_paise:integer [NOT NULL]`, `created_at:timestamptz [now()]` | `order_items_pkey (id)` | `order_id -> orders(id) ON DELETE RESTRICT` | `order_items_quantity_check CHECK (quantity > 0)`, `order_items_unit_price_paise_check CHECK (unit_price_paise > 0)` |
| 12 | `public.payments` | `id:uuid [gen_random_uuid()]`, `order_id:uuid [NOT NULL]`, `payment_method:payment_method [NOT NULL]`, `status:payment_status ['PENDING', NOT NULL]`, `amount_paise:integer [NOT NULL]`, `currency:text ['INR', NOT NULL]`, `utr_reference:text`, `payer_name:text`, `submitted_at:timestamptz`, `verified_at:timestamptz`, `verified_by:uuid`, `rejection_reason:text`, `created_at:timestamptz [now()]`, `updated_at:timestamptz [now()]` | `payments_pkey (id)` | `order_id -> orders(id) ON DELETE RESTRICT`, `verified_by -> profiles(id) ON DELETE RESTRICT` | `payments_utr_reference_key UNIQUE (utr_reference)`, `payments_amount_paise_check CHECK (amount_paise > 0)` *(Note: 4 `seller_review_*` columns added in `202611020001`)* |
| 13 | `public.payment_events` | `id:uuid [gen_random_uuid()]`, `payment_id:uuid [NOT NULL]`, `event_type:text [NOT NULL]`, `actor_user_id:uuid`, `metadata:jsonb ['{}']`, `created_at:timestamptz [now()]` | `payment_events_pkey (id)` | `payment_id -> payments(id) ON DELETE RESTRICT`, `actor_user_id -> profiles(id) ON DELETE SET NULL` | None |
| 14 | `public.tickets` | `id:uuid [gen_random_uuid()]`, `campaign_id:uuid [NOT NULL]`, `order_id:uuid [NOT NULL]`, `order_item_id:uuid [NOT NULL]`, `customer_id:uuid [NOT NULL]`, `seller_id:uuid`, `ticket_number:text [NOT NULL]`, `status:ticket_status ['ISSUED', NOT NULL]`, `issued_at:timestamptz [now()]`, `created_at:timestamptz [now()]`, `updated_at:timestamptz [now()]`, `voided_at:timestamptz`, `void_reason:text`, `voided_by:uuid`, `original_ticket_id:uuid`, `reissued_ticket_id:uuid`, `admin_notes:text` | `tickets_pkey (id)` | `campaign_id -> campaigns(id)`, `order_id -> orders(id)`, `order_item_id -> order_items(id)`, `customer_id -> customers(id)`, `seller_id -> sellers(id)`, `voided_by -> profiles(id)`, `original_ticket_id -> tickets(id)`, `reissued_ticket_id -> tickets(id)` | `tickets_ticket_number_key UNIQUE (ticket_number)`, `tickets_order_item_id_key UNIQUE (order_item_id)` *(Note: 6 `contact_*` override columns added in `202611070001`)* |
| 15 | `public.ticket_deliveries` | `id:uuid [gen_random_uuid()]`, `order_id:uuid [NOT NULL]`, `customer_id:uuid [NOT NULL]`, `channel:delivery_channel [NOT NULL]`, `recipient:text [NOT NULL]`, `status:delivery_status ['PENDING', NOT NULL]`, `provider:text ['mock', NOT NULL]`, `provider_message_id:text`, `subject:text`, `rendered_content:text`, `attempt_count:integer [0]`, `last_attempt_at:timestamptz`, `sent_at:timestamptz`, `error_message:text`, `metadata:jsonb ['{}']`, `created_at:timestamptz [now()]`, `updated_at:timestamptz [now()]` | `ticket_deliveries_pkey (id)` | `order_id -> orders(id) ON DELETE RESTRICT`, `customer_id -> customers(id) ON DELETE RESTRICT` | `ticket_deliveries_order_id_channel_key UNIQUE (order_id, channel)` |
| 16 | `public.ticket_verifications` | `id:uuid [gen_random_uuid()]`, `ticket_id:uuid [NOT NULL]`, `verified_at:timestamptz [now()]`, `verification_source:text ['PUBLIC_QR']`, `ip_hash:text`, `user_agent:text`, `created_at:timestamptz [now()]` | `ticket_verifications_pkey (id)` | `ticket_id -> tickets(id) ON DELETE RESTRICT` | None |
| 17 | `public.seller_messages` | `id:uuid [gen_random_uuid()]`, `recipient_seller_id:uuid [NOT NULL]`, `sender_profile_id:uuid [NOT NULL]`, `subject:text [NOT NULL]`, `body:text [NOT NULL]`, `created_at:timestamptz [now()]`, `read_at:timestamptz`, `archived_at:timestamptz` | `seller_messages_pkey (id)` | `recipient_seller_id -> sellers(id) ON DELETE CASCADE`, `sender_profile_id -> profiles(id) ON DELETE RESTRICT` | `seller_messages_subject_check`, `seller_messages_body_check` *(Note: `sender_role`, `parent_message_id`, `recipient_seller_code`, `recipient_display_name` added in migrations `202610290007` & `202611011000`)* |
| 18 | `public.audit_logs` | `id:uuid [gen_random_uuid()]`, `actor_user_id:uuid`, `action:text [NOT NULL]`, `entity_type:text [NOT NULL]`, `entity_id:uuid`, `metadata:jsonb ['{}']`, `created_at:timestamptz [now()]` | `audit_logs_pkey (id)` | `actor_user_id -> profiles(id) ON DELETE SET NULL` | None |

#### Part B — 5 Additional Feature Tables Defined in Local Migrations (`LOCAL_MIGRATION_TARGET`)
1. `public.system_settings` (`202611010001_customer_email_outbox.sql`)
2. `public.customer_email_outbox` (`202611010001_customer_email_outbox.sql`)
3. `public.payment_recovery_tokens` (`202611011100_payment_recovery_tokens.sql`)
4. `public.payment_screenshots` (`202611011200_payment_screenshots.sql`)
5. `public.order_collaboration_notes` (`202611070001_customer_contact_overrides_collaboration_and_ticket_immutability.sql`)

---

### 1.5 Indexes (`VERIFIED_PROD_DUMP` Lines 1192–1239)

Production baseline dump defines **17 custom indexes** (in addition to primary key and unique constraint indexes):
1. `audit_logs_actor_idx` ON `public.audit_logs (actor_user_id, created_at DESC)`
2. `customers_email_idx` ON `public.customers (email)`
3. `customers_phone_idx` ON `public.customers (phone)`
4. `orders_campaign_status_idx` ON `public.orders (campaign_id, status)`
5. `orders_customer_idx` ON `public.orders (customer_id)`
6. `orders_seller_idx` ON `public.orders (seller_id)`
7. `payment_events_payment_idx` ON `public.payment_events (payment_id, created_at DESC)`
8. `payments_order_idx` ON `public.payments (order_id)`
9. `payments_status_idx` ON `public.payments (status)`
10. `seller_messages_recipient_created_idx` ON `public.seller_messages (recipient_seller_id, created_at DESC)`
11. `seller_messages_recipient_unread_idx` ON `public.seller_messages (recipient_seller_id) WHERE (read_at IS NULL)`
12. `seller_messages_sender_created_idx` ON `public.seller_messages (sender_profile_id, created_at DESC)`
13. `ticket_deliveries_customer_idx` ON `public.ticket_deliveries (customer_id)`
14. `ticket_deliveries_order_idx` ON `public.ticket_deliveries (order_id)`
15. `ticket_deliveries_status_idx` ON `public.ticket_deliveries (status)`
16. `tickets_campaign_status_idx` ON `public.tickets (campaign_id, status)`
17. `tickets_customer_idx` ON `public.tickets (customer_id)`
18. `tickets_order_idx` ON `public.tickets (order_id)`
19. `tickets_original_ticket_idx` ON `public.tickets (original_ticket_id)`
20. `tickets_reissued_ticket_idx` ON `public.tickets (reissued_ticket_id)`
21. `tickets_seller_idx` ON `public.tickets (seller_id)`

---

### 1.6 Views & Materialized Views (`VERIFIED_PROD_DUMP`)
- **Views:** `0` in `public` schema.
- **Materialized Views:** `0` in `public` schema.

---

### 1.7 Functions & RPC Signatures (`VERIFIED_PROD_DUMP` Lines 116–640)

Production baseline dump contains **18 functions**:

| # | Function Signature in Production Dump | Security Mode | `search_path` in Prod Dump | Provenance & Notes |
|---|---|---|---|---|
| 1 | `admin_reissue_ticket(p_ticket_id uuid, p_actor uuid, p_reason text)` | `DEFINER` | `'public'` | `VERIFIED_PROD_DUMP` (L116) |
| 2 | `admin_void_ticket(p_ticket_id uuid, p_actor uuid, p_reason text)` | `DEFINER` | `'public'` | `VERIFIED_PROD_DUMP` (L199) |
| 3 | `create_seller_order(p_seller_id uuid, p_name text, p_whatsapp text, p_email text, p_quantity integer)` | `DEFINER` | `'public'` | `VERIFIED_PROD_DUMP` (L269) — **5-arg legacy signature** (upgraded to 6-arg with `p_actor` in `202610300001`). |
| 4 | `current_seller_id()` | `DEFINER` | `'public'` | `VERIFIED_PROD_DUMP` (L358) |
| 5 | `get_active_seller_by_code(p_code text)` | `DEFINER` | `'public'` | `VERIFIED_PROD_DUMP` (L369) |
| 6 | `handle_new_user()` | `DEFINER` | `'public'` | `VERIFIED_PROD_DUMP` (L382) |
| 7 | `has_role(p_user_id uuid, p_role text)` | `DEFINER` | `'public'` | `VERIFIED_PROD_DUMP` (L392) |
| 8 | `is_staff(p_user_id uuid)` | `DEFINER` | `'public'` | `VERIFIED_PROD_DUMP` (L424) |
| 9 | `issue_tickets(p_order_id uuid)` | `DEFINER` | `'public'` | `VERIFIED_PROD_DUMP` (L437) — formats `'SSFI-' \|\| lpad(nextval('public.ssfi_ticket_number_sequence')::text, 6, '0')`. |
| 10 | `owns_customer(p_customer_id uuid)` | `DEFINER` | `'public'` | `VERIFIED_PROD_DUMP` (L497) |
| 11 | `record_payment_event()` | `DEFINER` | `'public'` | `VERIFIED_PROD_DUMP` (L508) |
| 12 | `reject_payment(p_payment_id uuid, p_actor uuid, p_reason text)` | `DEFINER` | `'public'` | `VERIFIED_PROD_DUMP` (L522) |
| 13 | `rls_auto_enable()` | `DEFINER` | `'pg_catalog'` | `VERIFIED_PROD_DUMP` (L545) |
| 14 | `seller_owns_customer(p_customer_id uuid)` | `DEFINER` | `'public'` | `VERIFIED_PROD_DUMP` (L555) |
| 15 | `set_updated_at()` | `INVOKER` | default | `VERIFIED_PROD_DUMP` (L560) |
| 16 | `submit_manual_upi(p_order_id uuid, p_utr text, p_payer_name text)` | `DEFINER` | `'public'` | `VERIFIED_PROD_DUMP` (L566) |
| 17 | `validate_status_transition()` | `INVOKER` | default | `VERIFIED_PROD_DUMP` (L605) |
| 18 | `verify_payment_and_issue(p_payment_id uuid, p_actor uuid)` | `DEFINER` | `'public'` | `VERIFIED_PROD_DUMP` (L622) |

---

### 1.8 Triggers (`VERIFIED_PROD_DUMP` Lines 1245–1311)

Production baseline dump defines **11 triggers**:
1. `campaigns_updated` (`BEFORE UPDATE ON public.campaigns` -> `set_updated_at()`)
2. `customers_updated` (`BEFORE UPDATE ON public.customers` -> `set_updated_at()`)
3. `order_status_guard` (`BEFORE UPDATE ON public.orders` -> `validate_status_transition()`)
4. `orders_updated` (`BEFORE UPDATE ON public.orders` -> `set_updated_at()`)
5. `payment_event_log` (`AFTER UPDATE ON public.payments` -> `record_payment_event()`)
6. `payment_status_guard` (`BEFORE UPDATE ON public.payments` -> `validate_status_transition()`)
7. `payments_updated` (`BEFORE UPDATE ON public.payments` -> `set_updated_at()`)
8. `profiles_updated` (`BEFORE UPDATE ON public.profiles` -> `set_updated_at()`)
9. `sellers_updated` (`BEFORE UPDATE ON public.sellers` -> `set_updated_at()`)
10. `ticket_deliveries_updated` (`BEFORE UPDATE ON public.ticket_deliveries` -> `set_updated_at()`)
11. `tickets_updated` (`BEFORE UPDATE ON public.tickets` -> `set_updated_at()`)

---

## 2. Security Inventory (`VERIFIED_PROD_DUMP` Lines 1315–1695)

### 2.1 Row Level Security (RLS) State & Policies
- **RLS State:** Enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) on all 18 tables in Production dump.
- **Policies in Production Dump (26 policies):**
  - `audit_logs`: `audit_staff_read` (`SELECT TO authenticated USING (public.is_staff(auth.uid()))`)
  - `campaigns`: `campaigns_public_read` (`SELECT USING ((status = 'ACTIVE') OR public.is_staff(auth.uid()))`), `campaigns_staff_write` (`ALL TO authenticated USING/WITH CHECK (public.is_staff(auth.uid()))`)
  - `customers`: `customers_access` (`SELECT TO authenticated USING (owns_customer(id) OR seller_owns_customer(id) OR is_staff(auth.uid()))`)
  - `draws`: `draws_staff_access` (`ALL TO authenticated USING/WITH CHECK (public.is_staff(auth.uid()))`)
  - `draw_results`: `results_staff_access` (`ALL TO authenticated USING/WITH CHECK (public.is_staff(auth.uid()))`)
  - `order_items`: `order_items_access` (`SELECT TO authenticated USING (order_id IN (SELECT id FROM orders))`)
  - `orders`: `orders_access` (`SELECT TO authenticated USING (owns_customer(customer_id) OR seller_id = current_seller_id() OR is_staff(auth.uid()))`)
  - `payment_events`: `payment_events_staff_read` (`SELECT TO authenticated USING (public.is_staff(auth.uid()))`)
  - `payments`: `payments_access` (`SELECT TO authenticated USING (order_id IN (SELECT id FROM orders))`)
  - `prizes`: `prizes_public_read` (`SELECT USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = prizes.campaign_id AND (c.status = 'ACTIVE' OR is_staff(auth.uid()))))`), `prizes_staff_write` (`ALL TO authenticated`)
  - `profile_roles`: `profile_roles_staff_read` (`SELECT TO authenticated`)
  - `profiles`: `profiles_own_select` (`SELECT TO authenticated USING (id = auth.uid() OR is_staff(auth.uid()))`), `profiles_staff_write` (`ALL TO authenticated`)
  - `roles`: `roles_staff_read` (`SELECT TO authenticated`)
  - `seller_messages`: `seller_messages_seller_read`, `seller_messages_seller_update`, `seller_messages_staff_insert`, `seller_messages_staff_read`, `seller_messages_staff_update`
  - `sellers`: `sellers_access` (`SELECT TO authenticated USING (profile_id = auth.uid() OR is_staff(auth.uid()))`)
  - `ticket_deliveries`: `ticket_deliveries_customer_read`, `ticket_deliveries_seller_read`, `ticket_deliveries_staff_read`
  - `ticket_verifications`: `verification_staff_read` (`SELECT TO authenticated`)
  - `tickets`: `tickets_access` (`SELECT TO authenticated USING (order_id IN (SELECT id FROM orders))`)

### 2.2 Grants & Permissions (`VERIFIED_PROD_DUMP` Lines 1500–1695)
- **Database Roles:** `postgres`, `anon`, `authenticated`, `service_role`.
- **Historical Production Grant Finding:** Lines 1536–1540 of `production-public-schema.sql` granted `SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE` on public tables to `anon` and `authenticated`. Migration `202610300001_p0_security_remediation.sql` remediated this in Preview to least-privilege `SELECT` only (with `service_role` performing server-side writes).

---

## 3. Business Configuration & Data Inventory in Production (`VERIFIED_PROD_DUMP` & `04-production-data-plan.md`)

| Category | Verified Production Value (`backups/production-public-data-before-release.sql`) | Provenance |
|---|---|---|
| **Campaign Record** | `id = 23b265d6-6f48-42ea-be11-836f8762b68b`<br/>`public_id = 'ssfi-fundraising-lucky-draw'`<br/>`name = 'SSFI Fundraising Lucky Draw'`<br/>`description = 'Fundraising lucky draw for Senthang Students Fellowship India.'` | `VERIFIED_PROD_DUMP` (L44–45) |
| **Ticket Pricing** | `ticket_price_paise = 10000` (₹100.00 INR) | `VERIFIED_PROD_DUMP` (L45) |
| **Ticket Capacity** | `total_ticket_limit = 1000` | `VERIFIED_PROD_DUMP` (L45) |
| **Campaign Schedule** | `start_at = '2026-10-31 18:30:00+00'` (1 Nov 2026 00:00 IST)<br/>`end_at = '2026-12-19 18:30:00+00'` (20 Dec 2026 00:00 IST) | `VERIFIED_PROD_DUMP` & `04-production-data-plan.md` |
| **Prize Configuration (5 Prizes)** | 1. `1st Prize — ₹10,000 Cash` (`cash_amount_paise = 1000000`)<br/>2. `2nd Prize — ₹8,000 Cash` (`cash_amount_paise = 800000`)<br/>3. `3rd Prize — Electric Induction` (`NULL`)<br/>4. `4th Prize — Ukulele` (`NULL`)<br/>5. `5th Prize — Mini Soundbox` (`NULL`) | `VERIFIED_PROD_DUMP` (L85–90) |
| **Roles (4 Roles)** | `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`, `SELLER` | `VERIFIED_PROD_DUMP` (L121–125) |
| **Seller Configuration** | 1. `SELLER-007` (`display_name = 'Dehradun'`, `is_active = true`)<br/>2. `SELLER-003` (`display_name = 'Delhi'`, `is_active = true`) | `VERIFIED_PROD_DUMP` (L64–66) |
| **Orders / Payments / Tickets** | `0` rows in pre-release Production dump; active workflow tested with 51 orders / 51 payments / 36 tickets in Preview mirror | `VERIFIED_PROD_DUMP` (L49–110) |

---

## 4. Storage Configuration

| Bucket Name | Visibility | File Type Restrictions | Max File Size | Storage Policies | Provenance |
|---|---|---|---|---|---|
| `payment-screenshots` | **Private (`public = false`)** | `image/jpeg`, `image/png`, `image/webp` | `2,097,152` bytes (2 MB) | Zero client policies (`service_role` only; 60s signed URL download for `SUPER_ADMIN`, 300s view for authorized roles) | `LOCAL_MIGRATION_TARGET` (`202611011200`) |
| `seller-payment-qrs` | **Private (`public = false`)** | `image/jpeg`, `image/png`, `image/webp` | `2,097,152` bytes (2 MB) | Zero client policies (`service_role` only; signed URL rendering) | `LOCAL_MIGRATION_TARGET` (`202611020001`) |
