# SSFI Lucky Draw — Production Readiness Audit: Executive Findings

**Target Launch Date:** 1 November 2026, 00:00 IST  
**Draw Date:** 19 December 2026  
**Target Environments:**
- **Preview / Development Supabase:** `jiyuiydzsfydjklosvvq` (`https://jiyuiydzsfydjklosvvq.supabase.co`)
- **Production Supabase:** `fohpqheglxhfdecadhzw` (`https://fohpqheglxhfdecadhzw.supabase.co`)
- **Production Web Application:** `https://ssfiticket.vercel.app`
- **Preview Web Application:** `https://ssfiticket-git-deploy-ssfi-homepage-051907-rose1996ivs-projects.vercel.app`
- **Active Git Branch:** `deploy/ssfi-homepage-preview`
- **Auditor Role:** Senior Supabase Architect, DevOps Engineer, Security Auditor & Release Manager

---

## 1. Executive Summary

An exhaustive, evidence-based pre-release audit was conducted by inspecting the local repository, application codebase (`src/`), chronological database migration scripts (`supabase/migrations/`), and actual PostgreSQL schema dumps from both the approved Preview database (`backups/preview-public-schema.sql`) and the live Production database (`backups/production-public-schema.sql`).

### High-Level Verdict: **CONDITIONAL RELEASE GATE BLOCKER**
The Next.js application codebase, user-facing UI, checkout flow, countdown timers, and visual design on branch `deploy/ssfi-homepage-preview` are **100% verified, stable, and release-ready**. All 203 automated tests pass, TypeScript compiles with zero errors, ESLint passes, and preview deployments return HTTP 200 across all core routes (`/`, `/verify`, `/buy?ref=SELLER-002`, `/terms`).

**However, the Production Supabase Database (`fohpqheglxhfdecadhzw`) is currently OUT OF SYNC with the approved Preview schema.** Deploying the application code to Production in its current database state would result in immediate runtime failures, security vulnerabilities, and transactional blockers during ticket sales:
1. **Critical Ticket Sequence Cap at 1,000 Tickets:** The Production sequence `ssfi_ticket_number_sequence` retains `MAXVALUE 1000` (from initial Phase 2 schema), whereas Preview allows `MAXVALUE 999999`. Ticket issuance will hard-crash once 1,000 tickets are sold.
2. **Breaking RPC Signature Mismatch (`create_seller_order`):** The Next.js server actions (`src/server/actions/operations.ts`) invoke `create_seller_order` with 6 parameters (including `p_actor uuid`), but Production only has a legacy 5-parameter routine. All seller-initiated sales will immediately fail with PostgreSQL error `42883 (function does not exist)`.
3. **Missing Bidirectional Messaging Columns (`seller_messages`):** Production is missing `sender_role` and `parent_message_id`. Any attempt by administrators or sellers to query or send messages (`src/server/actions/messages.ts`) will fail with PostgreSQL error `42703 (column does not exist)`.
4. **Missing Campaign Auto-Scheduler RPCs:** Production lacks `process_scheduled_campaign_transitions()`, causing Vercel cron jobs (`/api/cron/campaign-schedule`) and scheduled transition checks in public checkout to fail.
5. **Severe Security Privilege Drift (P0 Security Risk):** Production currently grants `REFERENCES, TRIGGER, TRUNCATE, MAINTAIN` on **all public tables** to the untrusted `anon` and `authenticated` roles, and has default privileges configured to auto-grant these permissions on future tables. Furthermore, `has_role` and `is_staff` in Production lack caller identity guards and execute with `search_path = 'public'`, exposing the database to role enumeration and search path hijacking.

---

## 2. Environment & Infrastructure Topology

| Dimension | Development / Preview | Production | Release Requirement |
|---|---|---|---|
| **Supabase Project Ref** | `jiyuiydzsfydjklosvvq` | `fohpqheglxhfdecadhzw` | **Strict Separation:** Never point preview to prod or vice versa. |
| **Vercel Environment** | Preview / Development | Production | Production must use production Supabase keys and domain. |
| **Domain** | `ssfiticket-*-rose1996ivs-projects.vercel.app` | `https://ssfiticket.vercel.app` | Production apex domain. |
| **Database Tables** | 18 tables (RLS enforced) | 18 tables (RLS enforced) | Schemas must match 100%. |
| **Sequences** | Order seq + Ticket seq (`MAXVALUE 999999`) | Order seq + Ticket seq (`MAXVALUE 1000`) | Upgrade Production sequence to `MAXVALUE 999999`. |
| **Routines / Functions** | 22 functions (`search_path = ''`) | 18 functions (`search_path = 'public'`) | Apply missing functions and security hardening. |
| **Triggers** | 12 triggers | 11 triggers | Install `trg_seller_messages_protect`. |
| **RLS Policies** | 28 policies | 26 policies | Install 2 missing `seller_messages` policies. |
| **Table Grants** | Hardened least-privilege (P0 security) | Dangerous `TRUNCATE, TRIGGER, MAINTAIN` to `anon` | Revoke dangerous grants; grant `service_role` ALL. |
| **Default Privileges** | Zero auto-grants to `anon`/`authenticated` | Auto-grants `TRUNCATE, MAINTAIN` to `anon` | Revoke default table privileges. |
| **Migration Table** | `supabase_migrations.schema_migrations` | Not initialized / missing | Initialize or run preflight migration candidate. |

---

## 3. Core Risk Matrix

| Risk ID | Category | Severity | Description | Impact if Unmitigated |
|---|---|---|---|---|
| **RSK-01** | Capacity | **P0 - Critical Blocker** | `ssfi_ticket_number_sequence` capped at `MAXVALUE 1000`. | Ticket sales crash after 1,000 tickets are issued (`currval` reaches maxvalue). |
| **RSK-02** | Functionality | **P0 - Critical Blocker** | `create_seller_order` parameter mismatch (5 vs 6 args). | Sellers cannot record any ticket sales; runtime exception on `p_actor`. |
| **RSK-03** | Functionality | **P0 - Critical Blocker** | Missing columns `sender_role` & `parent_message_id` on `seller_messages`. | Admin & seller messaging pages crash with missing column errors. |
| **RSK-04** | Security | **P0 - Critical Vulnerability** | Dangerous table privileges (`TRUNCATE`, `TRIGGER`, `MAINTAIN`) granted to `anon` & `authenticated`. | Untrusted users could exploit API endpoints or table locks if RLS is ever modified or bypassed. |
| **RSK-05** | Security | **P1 - High Vulnerability** | `has_role` and `is_staff` lack caller identity guards; run with `search_path = 'public'`. | Untrusted users can enumerate staff roles; functions vulnerable to search path shadowing. |
| **RSK-06** | Automation | **P1 - High Functional** | Missing `process_scheduled_campaign_transitions()` function. | Campaign fails to transition automatically from `DRAFT` to `ACTIVE` on 1 Nov 2026. |
| **RSK-07** | Data Integrity | **P1 - High Integrity** | Missing `trg_seller_messages_protect_immutable` trigger. | Audit trail for seller/admin communications can be altered post-insertion. |
| **RSK-08** | Data Validation | **P2 - Moderate Quality** | Missing database-level regex checks for customer WhatsApp and email in Production `create_seller_order`. | Invalid customer phone/email could be written by manual SQL or direct RPC. |

---

## 4. Gapless Sequence & Concurrency Assessment

A critical operational requirement for lucky draw systems is ticket numbering integrity.
- **PostgreSQL Sequences vs Gapless Guarantees:** Standard PostgreSQL sequences (`nextval`) allocate values atomically and monotonically outside the transaction boundary. If an order transaction rolls back (e.g. payment failure), that sequence number is consumed and not reclaimed. Therefore, **sequences guarantee uniqueness, strict monotonic ordering, and atomic high-throughput issuance, but cannot guarantee zero gaps upon transactional aborts**.
- **Architecture in SSFI Lucky Draw:**
  1. `nextval('public.ssfi_ticket_number_sequence')` is called **only inside `issue_tickets(p_order_id)`**, which executes **after payment verification has succeeded** (`VERIFIED` status).
  2. Because ticket generation occurs exclusively inside the post-payment verification transaction under row locks (`select * from orders where id=p_order_id for update`), aborts are virtually eliminated, resulting in a continuous, gapless sequence under normal operations.
  3. Capacity is protected by `v_campaign.sold_ticket_count + v_order.quantity <= v_campaign.total_ticket_limit`.
  4. Ticket format is strictly validated via CHECK constraint: `CHECK (ticket_number ~ '^SSFI-[0-9]{6}$')`.

---

## 5. Recommended Path to Production Release

To achieve a 100% safe, verified production launch on November 1, 2026:

1. **Step 1: Strict Scope & Code Freeze Maintenance:** Maintain branch `deploy/ssfi-homepage-preview` without UI or workflow changes.
2. **Step 2: Pre-Migration Production Database Backup:** Perform a full schema and data snapshot of Production (`fohpqheglxhfdecadhzw`) via Supabase CLI or Dashboard.
3. **Step 3: Apply Consolidated Production Migration SQL:** Execute the proposed `supabase/release-candidates/production-migration.sql` in the Production Supabase SQL Editor.
   - Updates `ssfi_ticket_number_sequence` to `MAXVALUE 999999`.
   - Adds `sender_role` and `parent_message_id` to `seller_messages`.
   - Replaces `create_seller_order` with the hardened 6-argument signature.
   - Installs `process_scheduled_campaign_transitions()`, `evaluate_campaign_schedules()`, and `get_campaign_scheduler_status()`.
   - Hardens `has_role`, `is_staff`, `verify_payment_and_issue`, and `reject_payment` with `search_path = ''` and caller authorization checks.
   - Revokes dangerous table privileges from `anon` and `authenticated`.
   - Grants execute permissions exclusively to `service_role`.
   - Sets secure default privileges.
4. **Step 4: Post-Migration Schema Verification:** Run the verification queries in `docs/release-audit/05-production-release-runbook.md` to confirm 100% parity with Preview.
5. **Step 5: Production Data Pre-Seeding:** Ensure the active campaign (`ssfi-fundraising-lucky-draw`), default sellers, and super admin accounts are provisioned and verified.
6. **Step 6: Vercel Production Environment Variables Verification:** Confirm all production keys (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `GMAIL_*`) point to Production resources.
7. **Step 7: Production Release & Smoke Test:** Merge `deploy/ssfi-homepage-preview` into `main`, verify Vercel production deployment, and perform end-to-end smoke verification.

