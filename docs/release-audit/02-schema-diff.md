# SSFI Lucky Draw — Database Schema Parity Analysis (Semantic Diff)

**Production Supabase Reference:** `fohpqheglxhfdecadhzw` (Size: 61,173 bytes, 1,698 lines)  
**Preview Supabase Reference:** `jiyuiydzsfydjklosvvq` (Size: 77,105 bytes, 2,253 lines)  
**Primary Source SQL Files:**
- Production Schema: [`backups/production-public-schema.sql`](file:///F:/PROJECT/Lucky%20Draw/backups/production-public-schema.sql)
- Approved Preview Schema: [`backups/preview-public-schema.sql`](file:///F:/PROJECT/Lucky%20Draw/backups/preview-public-schema.sql)

---

## 1. Executive Parity Summary Across 12 Semantic Areas

| # | Semantic Area | Production (`fohpqheglxhfdecadhzw`) | Preview (`jiyuiydzsfydjklosvvq`) | Line References (Prod vs Prev) | Parity Status |
|---|---|---|---|---|---|
| **1** | **Tables & Columns** | 18 tables; `seller_messages` lacks `sender_role` & `parent_message_id` | 18 tables complete | Prod: L807–817<br/>Prev: L1247–1258 | **MISMATCH (seller_messages)** |
| **2** | **Types & Defaults** | `provider` default `'mock'`; missing `sender_role` default `'ADMIN'` | All defaults configured | Prod: L868 (`ticket_deliveries`)<br/>Prev: L1335 | **PARITY on delivery; MISMATCH on messages** |
| **3** | **Primary & Foreign Keys** | Missing `seller_messages_parent_message_id_fkey` | All PKs and FKs defined | Prod: Missing FK<br/>Prev: L1476 | **MISMATCH** |
| **4** | **Unique & Check Constraints** | Missing `seller_messages_sender_role_check` | All check constraints active | Prod: Missing check<br/>Prev: L1472 | **MISMATCH** |
| **5** | **Indexes** | 17 indexes (missing parent & role indexes on `seller_messages`) | 19 indexes | Prod: Missing 2 indexes<br/>Prev: L1580, L1584 | **MISMATCH** |
| **6** | **Sequences** | `ssfi_ticket_number_sequence` `MAXVALUE 1000` | `MAXVALUE 999999` | Prod: L850<br/>Prev: L1317 | **CRITICAL BLOCKER** |
| **7** | **Enums (8 Types)** | 8 enums identically defined | 8 enums identically defined | Prod: L26–111<br/>Prev: L26–111 | **100% PARITY** |
| **8** | **Functions & Signatures** | 18 functions; `create_seller_order` has 5 args; missing 4 functions | 22 functions; `create_seller_order` has 6 args | Prod: L269<br/>Prev: L334 | **CRITICAL BLOCKER** |
| **9** | **Function Bodies & Security** | Functions run with `search_path = 'public'`, no caller authorization guards | Functions run with `search_path = ''`, strict caller guards | Prod: L392, L424, L577<br/>Prev: L486, L534, L973 | **CRITICAL (P0 Security)** |
| **10** | **Triggers** | 11 triggers; missing `trg_seller_messages_protect` | 12 triggers | Prod: Missing trigger<br/>Prev: L1636 | **MISMATCH** |
| **11** | **Views** | Zero views in `public` | Zero views in `public` | N/A | **100% PARITY** |
| **12** | **RLS & Privileges** | Dangerous `TRUNCATE, TRIGGER, MAINTAIN` to `anon`; auto-grant defaults | Least-privilege `SELECT`; `service_role ALL` | Prod: L1536–1540, L1689–1691<br/>Prev: L2115–2120, L2245 | **CRITICAL (P0 Security)** |

---

## 2. Exhaustive Semantic Comparison

### 2.1. Tables and Columns (18 Tables)
Both environments define the following 18 tables in `public`:
`audit_logs`, `campaigns`, `customers`, `draw_results`, `draws`, `order_items`, `orders`, `payment_events`, `payments`, `prizes`, `profile_roles`, `profiles`, `roles`, `seller_messages`, `sellers`, `ticket_deliveries`, `ticket_verifications`, `tickets`.

#### Table Column Mismatch: `public.seller_messages`
- **Production (`backups/production-public-schema.sql` lines 807–817):**
  ```sql
  CREATE TABLE IF NOT EXISTS "public"."seller_messages" (
      "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
      "recipient_seller_id" "uuid" NOT NULL,
      "sender_profile_id" "uuid" NOT NULL,
      "subject" "text" NOT NULL,
      "body" "text" NOT NULL,
      "read_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
  );
  ```
- **Preview (`backups/preview-public-schema.sql` lines 1247–1258):**
  ```sql
  CREATE TABLE IF NOT EXISTS "public"."seller_messages" (
      "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
      "recipient_seller_id" "uuid" NOT NULL,
      "sender_profile_id" "uuid" NOT NULL,
      "subject" "text" NOT NULL,
      "body" "text" NOT NULL,
      "read_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
      "parent_message_id" "uuid",
      "sender_role" "text" DEFAULT 'ADMIN'::"text" NOT NULL
  );
  ```
- **Missing Columns in Production:**
  1. `parent_message_id`: `uuid`, nullable. Used for bidirectional threading.
  2. `sender_role`: `text`, NOT NULL, default `'ADMIN'::text`. Used for role differentiation (`ADMIN` vs `SELLER`).

#### Verified Parity: `public.sellers`
- **Columns in both Prod (L824) and Prev (L1291):**
  `id` (uuid), `profile_id` (uuid), `seller_code` (text), `display_name` (text), `is_active` (boolean), `created_at` (timestamptz), `updated_at` (timestamptz).
  *(Note: There is NO `full_name` or `phone` column on `sellers`; seller full names and phone numbers are stored in `public.profiles`).*

#### Verified Parity: `public.ticket_deliveries`
- **Columns in both Prod (L861–879) and Prev (L1328–1346):**
  Identical 17 columns: `id`, `order_id`, `customer_id`, `channel`, `recipient`, `status`, `provider`, `provider_message_id`, `subject`, `rendered_content`, `attempt_count`, `last_attempt_at`, `sent_at`, `error_message`, `metadata`, `created_at`, `updated_at`.
- In both dumps, `provider` has: `"provider" "text" DEFAULT 'mock'::"text" NOT NULL`.

---

### 2.2. Sequences

#### Sequence: `public.ssfi_ticket_number_sequence`
- **Production (`backups/production-public-schema.sql` line 850):**
  ```sql
  CREATE SEQUENCE IF NOT EXISTS "public"."ssfi_ticket_number_sequence"
      START WITH 1 INCREMENT BY 1 NO MINVALUE MAXVALUE 1000 CACHE 1;
  ```
- **Preview (`backups/preview-public-schema.sql` line 1317):**
  ```sql
  CREATE SEQUENCE IF NOT EXISTS "public"."ssfi_ticket_number_sequence"
      START WITH 1 INCREMENT BY 1 NO MINVALUE MAXVALUE 999999 CACHE 1;
  ```
- **Impact:** Production is capped at 1,000 tickets. Issuing ticket 1,001 will result in PostgreSQL error `55000 (sequence reached maximum value)`.

---

### 2.3. Functions & Routine Signatures

#### Missing Functions in Production:
1. `process_scheduled_campaign_transitions()` -> `jsonb` (Prev: L812–865)
2. `evaluate_campaign_schedules()` -> `jsonb` (Prev: L348–353)
3. `get_campaign_scheduler_status()` -> `jsonb` (Prev: L380–435)
4. `trg_seller_messages_protect_immutable()` -> `trigger` (Prev: L936–957)

#### Signature Mismatch: `create_seller_order`
- **Production (L269):** Accepts 5 parameters: `(p_seller_id uuid, p_name text, p_whatsapp text, p_email text, p_quantity integer)`.
- **Preview (L334):** Accepts 6 parameters: `(p_seller_id uuid, p_name text, p_whatsapp text, p_email text, p_quantity integer, p_actor uuid DEFAULT NULL::uuid)`.
- **Impact:** Application server action [`src/server/actions/operations.ts`](file:///F:/PROJECT/Lucky%20Draw/src/server/actions/operations.ts#L141-L148) passes 6 arguments (`p_actor: userId`), throwing error `42883` on Production.

#### Security Definer & `search_path` Hardening:
- `has_role`: Production (L392) uses `SET search_path TO 'public'` without caller authorization. Preview (L486) uses `SET search_path TO ''` and restricts checks to `service_role`, self (`auth.uid() = p_user_id`), or staff.
- `is_staff`: Production (L424) uses `SET search_path TO 'public'`. Preview (L534) uses `SET search_path TO ''` and prevents staff enumeration.
- `verify_payment_and_issue`: Production (L577) lacks impersonation guards. Preview (L973) enforces caller identity matching `p_actor`.
- `validate_status_transition`: Production (L567) compares raw enums without `::text` casting. Preview (L959) uses `old.status::text <> new.status::text` to prevent enum comparison operator resolution bugs.

---

### 2.4. Triggers
- **Production (11 triggers):** `campaigns_updated`, `customers_updated`, `order_status_guard`, `orders_updated`, `payment_event_log`, `payment_status_guard`, `payments_updated`, `profiles_updated`, `sellers_updated`, `ticket_deliveries_updated`, `tickets_updated`.
- **Preview (12 triggers):** Contains all 11 above plus `trg_seller_messages_protect` (L1636):
  ```sql
  CREATE OR REPLACE TRIGGER "trg_seller_messages_protect"
      BEFORE UPDATE ON "public"."seller_messages"
      FOR EACH ROW
      EXECUTE FUNCTION "public"."trg_seller_messages_protect_immutable"();
  ```

---

### 2.5. Permissions, Grants & Default Privileges
- **Table Permissions in Production (L1536–1540):**
  Production grants `REFERENCES, TRIGGER, TRUNCATE, MAINTAIN` on **all public tables** to `anon` and `authenticated`.
- **Table Permissions in Preview (L2115–2120):**
  Only `SELECT` is granted to `anon` and `authenticated` (strictly governed by RLS). Full privileges are reserved strictly for `service_role` and `postgres`. Direct mutations on `seller_messages` are explicitly revoked from `anon` and `authenticated`; all messaging inserts and updates are executed server-side via `createSupabaseAdminClient()` (`service_role`).
- **Function Permissions & Public RLS Dependency:**
  Public RLS policies `campaigns_public_read` and `prizes_public_read` invoke `public.is_staff(auth.uid())`. When an unauthenticated visitor queries campaigns, PostgreSQL evaluates `is_staff`. If `is_staff(uuid)` is not granted to `anon`, Postgres throws `42501 permission denied for function is_staff`. Thus, `is_staff` is explicitly granted to `anon, authenticated, service_role`, with an internal guard returning `false` immediately whenever `p_user_id` or `auth.uid()` is null.
- **Default Privileges in Production (L1689–1691):**
  Production configures default privileges (`pg_default_acl`) to auto-grant `REFERENCES, TRIGGER, TRUNCATE, MAINTAIN` (`Dxtm`) to `anon` and `authenticated` on all future tables created by `postgres`.
- **Default Privileges in Preview & Hardened Candidate:**
  Configured with zero auto-grants on mutations to `anon` or `authenticated`. Tables default to `SELECT` for `authenticated` (RLS enforced) and `ALL` for `service_role`/`postgres`. Routines default to zero execute privileges for client roles.
