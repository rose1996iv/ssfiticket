# SSFI Lucky Draw — Database Schema Parity & Difference Matrix (Phase B)

**Document Reference:** `docs/preview/phase-b-schema-difference-matrix.md`  
**Version:** 1.0.0  
**Date:** 2 November 2026  
**Auditor Roles:** Principal Software Architect, Senior PostgreSQL Engineer, Supabase Security Engineer  
**Workspace:** `F:\PROJECT\Lucky Draw`  
**Primary Source SQL Files:**
- Historical Production Schema: [`backups/production-public-schema.sql`](file:///F:/PROJECT/Lucky%20Draw/backups/production-public-schema.sql) (61,173 bytes, 1,698 lines)
- Historical Preview Schema: [`backups/preview-public-schema.sql`](file:///F:/PROJECT/Lucky%20Draw/backups/preview-public-schema.sql) (77,105 bytes, 2,253 lines)
- Migration Source Directory: [`supabase/migrations/`](file:///F:/PROJECT/Lucky%20Draw/supabase/migrations/) (15 files)

---

## 1. Executive Summary Across 12 Semantic Areas

| # | Semantic Area | Production Dump (`fohpqheglxhfdecadhzw`) | Preview Dump (`jiyuiydzsfydjklosvvq`) | Migration & Source State | Parity Status |
|---|---|---|---|---|---|
| **1** | **Tables (Count & Set)** | 18 tables | 18 tables | 22 tables (4 added in migrations 12–15) | **EXTENDED BY FEATURE BRANCH** |
| **2** | **Columns** | `seller_messages` lacks `sender_role` & `parent_message_id` | `seller_messages` complete | Migrations 13 & 15 add snapshot & screenshot columns | **MISMATCH ON DUMPS; RESOLVED IN MIGRATIONS** |
| **3** | **Sequences** | `ssfi_ticket_number_sequence` `MAXVALUE 1000` | `MAXVALUE 999999` | `202610300001` sets `MAXVALUE 999999` | **CRITICAL CAPACITY DIVERGENCE** |
| **4** | **Custom ENUMs** | 8 ENUMs | 8 ENUMs | Identical | **100% PARITY** |
| **5** | **Primary & Foreign Keys** | Missing `parent_message_id_fkey` | Defined | Migration 13 updates FK to `ON DELETE SET NULL` | **RESOLVED IN LATEST MIGRATION** |
| **6** | **Check Constraints** | Missing `sender_role_check` | Active | Checked in migration sequence | **RESOLVED IN PREVIEW/MIGRATIONS** |
| **7** | **Indexes** | 17 indexes (missing parent & role indexes) | 19 indexes | 25 indexes total across 22 tables | **RESOLVED IN MIGRATIONS** |
| **8** | **Function Signatures** | `create_seller_order` accepts 5 args | Accepts 6 args (`p_actor`) | Source passes 6 args (`operations.ts:141`) | **CRITICAL RUNTIME BREAK IN PROD DUMP** |
| **9** | **Function Search Paths** | `search_path = 'public'` (18 functions) | `search_path = ''` (22 functions) | Hardened in `202610300001` | **P0 SECURITY DRIFT** |
| **10** | **Triggers** | 11 triggers | 12 triggers | 15 triggers across 22 tables | **RESOLVED IN MIGRATIONS** |
| **11** | **Table Grants** | `TRUNCATE, TRIGGER, MAINTAIN` to `anon` | Least privilege (`SELECT` only) | Hardened in `202610300001` | **CRITICAL P0 SECURITY VULNERABILITY** |
| **12** | **Storage Buckets** | None in dump | None in dump | `payment-screenshots` (Migration 15) | **FEATURE BRANCH EXTENSION** |

---

## 2. Granular Discrepancy Breakdown

### 2.1 Ticket Sequence Cap (`ssfi_ticket_number_sequence`)
- **Historical Production Value:**
  ```sql
  CREATE SEQUENCE IF NOT EXISTS "public"."ssfi_ticket_number_sequence"
      START WITH 1 INCREMENT BY 1 NO MINVALUE MAXVALUE 1000 CACHE 1;
  ```
  *(Source: `backups/production-public-schema.sql:850`)*
- **Preview Dump Value:**
  ```sql
  CREATE SEQUENCE IF NOT EXISTS "public"."ssfi_ticket_number_sequence"
      START WITH 1 INCREMENT BY 1 NO MINVALUE MAXVALUE 999999 CACHE 1;
  ```
  *(Source: `backups/preview-public-schema.sql:1317`)*
- **Migration Evidence:** [`supabase/migrations/202610300001_p0_security_remediation.sql:214`](file:///F:/PROJECT/Lucky%20Draw/supabase/migrations/202610300001_p0_security_remediation.sql#L214) explicitly executes:
  ```sql
  ALTER SEQUENCE public.ssfi_ticket_number_sequence MAXVALUE 999999;
  ```
- **Application Dependency:** [`src/server/actions/tickets.ts`](file:///F:/PROJECT/Lucky%20Draw/src/server/actions/tickets.ts) formats ticket codes as 6-digit zero-padded numbers (`TICK-2026-000042`).
- **Security & Reliability Impact:** A cap at 1,000 causes all ticket purchases past 1,000 to hard-abort with PostgreSQL error `55000 (sequence reached maximum value)`.
- **Classification:** **INTENTIONAL UPGRADE**. `MAXVALUE 999999` is the authoritative specification.

---

### 2.2 `create_seller_order` Function Signature
- **Historical Production Value:** Accepts 5 arguments:
  ```sql
  CREATE FUNCTION public.create_seller_order(
      p_seller_id uuid, p_name text, p_whatsapp text, p_email text, p_quantity integer
  ) RETURNS uuid
  ```
  *(Source: `backups/production-public-schema.sql:269`)*
- **Preview Dump Value:** Accepts 6 arguments:
  ```sql
  CREATE FUNCTION public.create_seller_order(
      p_seller_id uuid, p_name text, p_whatsapp text, p_email text, p_quantity integer,
      p_actor uuid DEFAULT NULL::uuid
  ) RETURNS uuid
  ```
  *(Source: `backups/preview-public-schema.sql:334`)*
- **Application Dependency:** [`src/server/actions/operations.ts:141-148`](file:///F:/PROJECT/Lucky%20Draw/src/server/actions/operations.ts#L141-L148) passes:
  ```typescript
  const { data: orderId, error } = await supabase.rpc("create_seller_order", {
    p_seller_id: seller.id,
    p_name: validated.fullName,
    p_whatsapp: validated.whatsapp,
    p_email: validated.email,
    p_quantity: validated.quantity,
    p_actor: actorId,
  });
  ```
- **Security & Reliability Impact:** Executing seller sales against historical Production throws PostgreSQL error `42883 (function does not exist)`.
- **Classification:** **INTENTIONAL BUG FIX**. The 6-parameter signature is the authoritative specification.

---

### 2.3 `seller_messages` Schema Divergence
- **Historical Production Value:** Lacks `sender_role` and `parent_message_id`.
- **Preview Dump Value:** Includes both columns:
  - `sender_role text NOT NULL DEFAULT 'ADMIN'::text CHECK (sender_role IN ('ADMIN', 'SELLER'))`
  - `parent_message_id uuid REFERENCES public.seller_messages(id) ON DELETE RESTRICT`
- **Migration Evolution:**
  - `202610290007_bidirectional_seller_messages.sql`: Added bidirectional threading.
  - `202611011000_seller_messages_preserve_on_delete.sql`: Added `recipient_seller_code` and `recipient_display_name` snapshots and relaxed foreign key to `ON DELETE SET NULL`.
- **Application Dependency:** [`src/server/actions/messages.ts`](file:///F:/PROJECT/Lucky%20Draw/src/server/actions/messages.ts) and [`src/lib/messaging/threading.ts`](file:///F:/PROJECT/Lucky%20Draw/src/lib/messaging/threading.ts).
- **Classification:** **INTENTIONAL UPGRADE**.

---

### 2.4 Table Privileges & Grants (P0 Security Risk)
- **Historical Production Value:**
  ```sql
  GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE ON ALL TABLES IN SCHEMA public TO anon;
  GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
  ```
  *(Source: `backups/production-public-schema.sql:1536-1540`)*
- **Preview Dump & Hardened Migration Value:**
  ```sql
  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role, postgres;
  ```
  *(Source: `backups/preview-public-schema.sql:2115-2120`, `202610300001_p0_security_remediation.sql:20-40`)*
- **Security Impact:** Granting `TRUNCATE` or `TRIGGER` to untrusted roles is a severe vulnerability.
- **Classification:** **CRITICAL INTENTIONAL SECURITY REMEDIATION**.

---

### 2.5 Table Extension Inventory (Feature Branch Additions)

The following tables exist in the current application feature branch but do not exist in either historical schema dump:

| Table Name | Defined In Migration | Purpose | Application Caller |
|---|---|---|---|
| `public.system_settings` | `202611010001` | System feature flags & operational gates | `src/lib/config/featureFlags.ts` |
| `public.customer_email_outbox`| `202611010001` | Idempotent transactional customer email queue | `src/lib/delivery/outbox.ts` |
| `public.payment_recovery_tokens`| `202611011100` | Secure SHA-256 tokens for out-of-band payment details submission | `src/server/actions/paymentRecovery.ts` |
| `public.payment_screenshots` | `202611011200` | Metadata for private payment proof uploads | `src/server/actions/paymentScreenshot.ts` |

---

## 3. Parity Resolution Strategy for Preview Replication

To establish an authoritative replica in Preview:
1. **Never copy the raw Production dump:** The historical Production dump contains severe security vulnerabilities and functional defects.
2. **Apply the full migration sequence:** Executing migrations `202610270001` through `202611011200` establishes the complete, 22-table, P0-hardened schema required by the current application codebase.

