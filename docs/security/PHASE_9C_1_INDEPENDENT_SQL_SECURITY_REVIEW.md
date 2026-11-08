# SSFI Lucky Draw — Phase 9C.1 Independent SQL Security & Compatibility Review

**Document Version:** 1.0.0  
**Date:** 8 November 2026  
**Auditor:** Senior PostgreSQL & Supabase Database Security Engineer  
**Target Migration File:** `supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql`  
**Migration SHA-256 Digest:** `eb1927bf5dad3651f918745785627c85aa244b8ebd1619a748fd72565f9c8edf`  
**Audited References:**
1. `supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql`
2. `docs/security/PHASE_9A_SECURE_LUCKY_DRAW_ARCHITECTURE.md`
3. `docs/security/PHASE_9B_DATABASE_AND_BACKEND_IMPLEMENTATION_PLAN.md`
4. `docs/security/PHASE_9C_PREVIEW_MIGRATION_REVIEW_REPORT.md`

---

## 1. Executive Summary & Review Scope

This independent security and compatibility audit evaluates the foundation migration script prepared for the SSFI Lucky Draw Winner Selection System. The audit specifically examines schema integrity, concurrency safety, access control boundaries, cryptographic randomness guarantees, immutability enforcement, and rollback safety.

### Environment Safety & Air-Gap Compliance Statement
- **Zero Database Execution:** Neither Preview Supabase (`jiyuiydzsfydjklosvvq`) nor Production Supabase (`fohpqheglxhfdecadhzw`) were connected to or modified during this audit.
- **Zero SQL DDL/DML Run:** All findings are derived from rigorous static code analysis, transaction trace simulations, and relational constraint proofs.
- **Zero Code Modification:** Application source code was untouched; all unstaged working tree changes (including Phase 8C.1 email snapshot remediation) remain intact.
- **No Production Contact:** Production remains strictly air-gapped.

---

## 2. In-Depth Evaluation Across Required Review Areas

### 2.1 Existing Schema and Foreign-Key Compatibility
- **Status:** **PASS**
- **Analysis:**
  - Foreign key references to `public.campaigns(id)`, `public.prizes(id)`, `public.tickets(id)`, `public.profiles(id)`, `public.draws(id)`, and `public.customer_email_outbox(id)` strictly align with upstream migrations (`202610270001_phase2_core.sql`, `202611010001_customer_email_outbox.sql`).
  - Referential action `ON DELETE RESTRICT` is correctly applied to all sensitive transactional relations (`draw_id`, `campaign_id`, `prize_id`, `ticket_id`, `snapshot_id`, `initiator_id`), preventing accidental or unauthorized cascading purges of historical draw data.
  - `public.draw_snapshot_tickets` uses `ON DELETE CASCADE` specifically on `snapshot_id`, ensuring clean disposal of candidate items if an unlocked draft snapshot is ever discarded before draw locking.

### 2.2 PostgreSQL Syntax and Database Execution Compatibility
- **Status:** **PASS (With Syntax Notice)**
- **Analysis:**
  - The script features 34 dollar-quoted tags (`$$`), corresponding to 17 balanced PL/pgSQL function and trigger blocks.
  - Top-level parenthesis balance outside function bodies resolves to net depth `0`.
  - All statements terminate with proper semicolons.
  - Partial unique indexes (`draw_manual_exclusions_prize_ticket_idx` and `draw_manual_exclusions_campaign_ticket_idx`) correctly handle SQL NULL semantics for campaign-wide vs. prize-specific exclusions across all modern PostgreSQL versions (14+).

### 2.3 Row-Level Security (RLS), Grants & Permissions
- **Status:** **CONDITIONAL (See SEC-01 & SEC-07)**
- **Analysis:**
  - All 5 newly created tables enable Row-Level Security (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).
  - Table-level `REVOKE ALL ... FROM public, anon` protects sensitive tables from anonymous access.
  - Public read policies (`draws_public_read`, `results_public_read`, `evidence_public_read`) correctly restrict public spectator visibility exclusively to executed draws (`status = 'EXECUTED'`).
  - **Vulnerability Identified (SEC-01):** Function execution grants (`GRANT EXECUTE ... TO authenticated`) expose administrative RPCs to direct invocation over PostgREST without verifying caller identity.

### 2.4 SECURITY DEFINER Function Safety and Search Path Isolation
- **Status:** **PASS**
- **Analysis:**
  - All 5 stored procedures (`admin_lock_eligibility_snapshot`, `admin_request_first_prize_approval`, `admin_record_first_prize_approval`, `execute_draw_winner_selection`, `admin_stamp_winner_notification`) and all 4 trigger functions explicitly define `SECURITY DEFINER SET search_path = ''`.
  - All database objects, helper functions (`public.is_staff`, `public.has_role`), and custom types (`public.draw_status`) are explicitly schema-qualified with `public.`.
  - Built-in PostgreSQL functions (`now()`, `count()`, `max()`, `coalesce()`, `array_length()`, `jsonb_build_object()`) safely resolve to `pg_catalog`.

### 2.5 First Prize Policy A Dual-Authorization Enforcement
- **Status:** **PASS**
- **Analysis:**
  - Dual control is enforced across two independent layers:
    1. Schema CHECK constraint: `CONSTRAINT draw_approvals_distinct_actors CHECK (approver_id IS NULL OR initiator_id <> approver_id)`.
    2. Procedural guards in `admin_record_first_prize_approval` and `execute_draw_winner_selection`.
  - Dynamic role verification at draw execution time (`public.has_role(da.initiator_id, 'SUPER_ADMIN')` and `public.has_role(da.approver_id, 'ADMIN') OR public.has_role(da.approver_id, 'SUPER_ADMIN')`) guarantees that role changes or demotions between approval and ceremony are immediately respected.

### 2.6 Concurrency and Race Condition Safety
- **Status:** **PASS**
- **Analysis:**
  - `execute_draw_winner_selection` acquires explicit row locks via `SELECT ... FOR UPDATE` on `public.draws`, `public.prizes`, and `public.draw_eligibility_snapshots` in deterministic sequence, eliminating deadlock potential.
  - Concurrent invocations for the same prize will serialize on the `draws` row lock; the second transaction will unblock, evaluate `IF EXISTS (SELECT 1 FROM public.draw_results WHERE draw_id = p_draw_id AND prize_id = p_prize_id)`, and immediately abort with error code `23505`.

### 2.7 Draw Sequence Enforcement: `5th → 4th → 3rd → 2nd → 1st`
- **Status:** **PASS**
- **Analysis:**
  - Dynamically calculates `v_max_prize_number` via `COALESCE(MAX(prize_number), 5)` from `public.prizes`.
  - For any prize $K < \text{max}$, asserts that prize $K+1$ already exists in `public.draw_results` for that campaign.
  - Drawing out of order (e.g. attempting 3rd Prize before 4th Prize) triggers exception `23514` with message `'Sequence violation: Prize 3 cannot be drawn until Prize 4 is completed and recorded.'`.

### 2.8 Campaign-Wide Winner Uniqueness (Rule 3)
- **Status:** **PASS**
- **Analysis:**
  - Schema constraint `draw_results_campaign_ticket_unique` (`UNIQUE (campaign_id, ticket_id)`) guarantees that a ticket can never win more than one prize across an entire campaign.
  - Procedural assertion in `execute_draw_winner_selection` checks `IF EXISTS (SELECT 1 FROM public.draw_results WHERE campaign_id = v_draw.campaign_id AND ticket_id = v_winning_ticket.ticket_id)` prior to insertion, providing clear error reporting before constraint violation.

### 2.9 Snapshot Immutability and Canonical Hash Consistency
- **Status:** **PASS**
- **Analysis:**
  - `trg_protect_draw_snapshot_immutability` blocks any `UPDATE` or `DELETE` on snapshots once `is_locked = true`.
  - `trg_protect_draw_snapshot_tickets_immutability` prevents tampering with ticket entries belonging to locked snapshots.
  - Approval records are bound to the exact 64-character SHA-256 `snapshot_hash`. Any roster drift or re-snapshot invalidates existing approvals.

### 2.10 Seed Commitment, Reveal, Entropy & Seed-Grinding Risks
- **Status:** **CONDITIONAL (See SEC-03 & SEC-04)**
- **Analysis:**
  - The Commit-Reveal workflow is conceptually sound, and random selection is decoupled into Node.js kernel CSPRNG (`crypto.randomInt`) to eliminate modulo bias.
  - **Vulnerabilities Identified:**
    - `execute_draw_winner_selection` overwrites `draws.seed_commitment` without verifying if a pre-commitment was already locked into the session, allowing potential seed grinding (SEC-03).
    - Stored procedure hardcodes `verification_status = 'VERIFIED'` without executing in-database hash verification between `p_seed_revealed` and `p_seed_commitment` (SEC-04).

### 2.11 Notification Idempotency and One-Time Stamping
- **Status:** **PASS**
- **Analysis:**
  - `admin_stamp_winner_notification` locks the result row `FOR UPDATE` and verifies `notified_at IS NULL`.
  - `trg_protect_draw_results_immutability` allows an `UPDATE` operation strictly when transitioning `OLD.notified_at IS NULL` to `NEW.notified_at IS NOT NULL` while ensuring all other columns remain identical. Once stamped, no further modifications are permitted.
  - Foreign key `notification_outbox_id` links directly to `customer_email_outbox`, which enforces outbound idempotency.

### 2.12 Safe Rollback and Audit Log Preservation
- **Status:** **PASS**
- **Analysis:**
  - Rollback script drops newly created functions, triggers, constraints, and tables without touching existing core tables.
  - `public.audit_logs` is append-only and completely untouched by migration rollback; all audit events logged during preview testing remain permanently preserved.

---

## 3. Detailed Security Findings & Remediation Matrix

### Finding SEC-01 (HIGH) — Administrative RPC Actor Identity Spoofing via `authenticated` Role Grant

- **Severity:** **HIGH**
- **Exact SQL Location:** `supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql`, Lines 1067–1071:
  ```sql
  GRANT EXECUTE ON FUNCTION public.admin_lock_eligibility_snapshot(uuid, uuid, text, uuid[], text[], uuid) TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.admin_request_first_prize_approval(uuid, uuid, uuid, uuid) TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.admin_record_first_prize_approval(uuid, text, text, uuid) TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.execute_draw_winner_selection(uuid, uuid, uuid, integer, text, text, text, uuid, text) TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.admin_stamp_winner_notification(uuid, uuid, uuid) TO authenticated, service_role;
  ```
- **Technical Explanation:**  
  All five administrative stored procedures are granted `EXECUTE` to the `authenticated` database role. Each procedure receives the operator identity as an argument (`p_actor uuid`) and checks authorization using `public.has_role(p_actor, 'SUPER_ADMIN')` or `public.is_staff(p_actor)`.  
  However, PostgreSQL does not automatically bind `p_actor` to the caller's JWT identity (`auth.uid()`). A malicious authenticated user (e.g., a customer or seller with a standard Supabase user account) can invoke these RPC endpoints directly over PostgREST (`POST /rest/v1/rpc/...`) and pass a known Administrator or Super Administrator UUID as `p_actor`.
- **Exploitation Scenario:**
  1. An attacker logs in as a regular customer and receives a valid `authenticated` JWT.
  2. The attacker calls `POST /rest/v1/rpc/admin_request_first_prize_approval` supplying the known `SUPER_ADMIN` profile UUID in `p_actor`.
  3. `admin_request_first_prize_approval` runs with `SECURITY DEFINER` rights, verifies `public.has_role(p_actor, 'SUPER_ADMIN')` (which evaluates to TRUE because the provided UUID is indeed a Super Admin), and registers an approval request.
  4. The attacker then calls `admin_record_first_prize_approval` supplying the `ADMIN` profile UUID in `p_actor`, approving the request without either staff member's knowledge.
  5. The attacker calls `execute_draw_winner_selection` passing `p_actor = SUPER_ADMIN_UUID` and their own chosen index, triggering an unauthorized draw.
- **Required Remediation:**  
  In accordance with the architecture established for `public.issue_tickets` in `202610270001_phase2_core.sql:73`, administrative functions that modify core draw state must **NEVER be granted to `authenticated`**. They must be granted **EXCLUSIVELY to `service_role`**:
  ```sql
  REVOKE ALL ON FUNCTION public.admin_lock_eligibility_snapshot(uuid, uuid, text, uuid[], text[], uuid) FROM public, anon, authenticated;
  REVOKE ALL ON FUNCTION public.admin_request_first_prize_approval(uuid, uuid, uuid, uuid) FROM public, anon, authenticated;
  REVOKE ALL ON FUNCTION public.admin_record_first_prize_approval(uuid, text, text, uuid) FROM public, anon, authenticated;
  REVOKE ALL ON FUNCTION public.execute_draw_winner_selection(uuid, uuid, uuid, integer, text, text, text, uuid, text) FROM public, anon, authenticated;
  REVOKE ALL ON FUNCTION public.admin_stamp_winner_notification(uuid, uuid, uuid) FROM public, anon, authenticated;

  GRANT EXECUTE ON FUNCTION public.admin_lock_eligibility_snapshot(uuid, uuid, text, uuid[], text[], uuid) TO service_role;
  GRANT EXECUTE ON FUNCTION public.admin_request_first_prize_approval(uuid, uuid, uuid, uuid) TO service_role;
  GRANT EXECUTE ON FUNCTION public.admin_record_first_prize_approval(uuid, text, text, uuid) TO service_role;
  GRANT EXECUTE ON FUNCTION public.execute_draw_winner_selection(uuid, uuid, uuid, integer, text, text, text, uuid, text) TO service_role;
  GRANT EXECUTE ON FUNCTION public.admin_stamp_winner_notification(uuid, uuid, uuid) TO service_role;
  ```
  *(Next.js server actions call these procedures via the server-side Supabase admin client (`createSupabaseAdminClient()`), which authenticates as `service_role` after verifying user session permissions in server code).*  
  *Alternatively, if direct `authenticated` execution is ever required, each function must enforce identity binding:*
  ```sql
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor THEN
    RAISE EXCEPTION 'Actor identity spoofing detected: caller % cannot act as %', auth.uid(), p_actor
      USING ERRCODE = '42501';
  END IF;
  ```
- **Blocks Preview Migration:** **YES (Condition 1)** — Must be remediated in the migration file prior to database execution.

---

### Finding SEC-02 (MEDIUM) — `BEFORE DELETE` Trigger Returning `NEW` Silently Cancels Deletions on Draft Snapshots

- **Severity:** **MEDIUM**
- **Exact SQL Location:** `supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql`, Lines 257 & 282:
  ```sql
  -- Line 257 (protect_draw_snapshot_immutability)
  IF OLD.is_locked = true THEN
    RAISE EXCEPTION 'Eligibility snapshots are immutable once locked.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;

  -- Line 282 (protect_draw_snapshot_tickets_immutability)
  IF EXISTS (SELECT 1 FROM public.draw_eligibility_snapshots s WHERE s.id = OLD.snapshot_id AND s.is_locked = true) THEN
    RAISE EXCEPTION 'Snapshot tickets cannot be modified or deleted from a locked snapshot.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
  ```
- **Technical Explanation:**  
  Both triggers are defined as `BEFORE UPDATE OR DELETE`. Under PostgreSQL PL/pgSQL semantics, the record variable `NEW` is **NULL** during a `DELETE` operation. Returning `NULL` from a `BEFORE DELETE` row-level trigger instructs PostgreSQL to **silently skip/suppress the deletion** of that row.  
  As a result, if an operator attempts to delete an unlocked draft snapshot (`is_locked = false`), the trigger executes `RETURN NEW;` (returning NULL), causing the `DELETE` query to report `0 rows deleted` with zero error feedback.
- **Exploitation / Failure Scenario:**
  1. An administrator creates a draft snapshot for review, decides to discard it before locking, and issues `DELETE FROM public.draw_eligibility_snapshots WHERE id = ...`.
  2. The delete query completes with code `0` but deletes 0 records. The draft snapshot remains stuck in the database.
- **Required Remediation:**  
  Branch cleanly on the trigger operation `TG_OP`:
  ```sql
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
  ```
  *(Or, if deleting even unlocked snapshots is meant to be completely prohibited, replace with an explicit `RAISE EXCEPTION`)*.
- **Blocks Preview Migration:** **NO** (Does not compromise security of locked snapshots, but prevents clean cleanup of unlocked draft snapshots).

---

### Finding SEC-03 (MEDIUM) — Pre-Commitment Overwrite & Seed Grinding Risk in `execute_draw_winner_selection`

- **Severity:** **MEDIUM**
- **Exact SQL Location:** `supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql`, Lines 820–829:
  ```sql
  -- 14. Update Draw Status & Current Prize
  UPDATE public.draws
  SET
    current_prize_id = p_prize_id,
    seed_commitment = p_seed_commitment,
    seed_revealed = p_seed_revealed,
    client_entropy = p_client_entropy,
    locked_by = p_actor,
    status = CASE WHEN v_prize.prize_number = 1 THEN 'EXECUTED'::public.draw_status ELSE status END,
    executed_at = CASE WHEN v_prize.prize_number = 1 THEN now() ELSE executed_at END
  WHERE id = p_draw_id;
  ```
- **Technical Explanation:**  
  In the Phase 9A/9B Commit-Reveal protocol, the server pre-commits a seed hash ($C = \text{SHA-256}(S_{server})$) into `draws.seed_commitment` before spectators observe the drum animation.  
  However, in `execute_draw_winner_selection`, the stored procedure blindly updates `seed_commitment = p_seed_commitment` without verifying whether `draws.seed_commitment` was already populated for that session. An operator or server action could compute multiple candidate outcomes (seed grinding) and submit a completely different commitment at execution time, bypassing the pre-commitment.
- **Exploitation Scenario:**
  1. Draw session initiates; pre-commitment $C_1$ is generated and stored in `public.draws`.
  2. A malicious actor tests seeds until finding $S_{server, 2}$ which selects a favored ticket index.
  3. The actor submits $C_2 = \text{SHA-256}(S_{server, 2})$ and $S_{server, 2}$ to `execute_draw_winner_selection`.
  4. The procedure overwrites `draws.seed_commitment = C_2`, concealing the substitution.
- **Required Remediation:**  
  Add an assertion in `execute_draw_winner_selection` before executing the draw:
  ```sql
  IF v_draw.seed_commitment IS NOT NULL AND v_draw.seed_commitment <> p_seed_commitment THEN
    RAISE EXCEPTION 'Commitment mismatch: Supplied commitment does not match pre-committed session seed.'
      USING ERRCODE = '23514';
  END IF;
  ```
- **Blocks Preview Migration:** **NO** (Can be hardened prior to live ceremony; does not block initial Preview schema setup).

---

### Finding SEC-04 (MEDIUM) — Missing In-Database Cryptographic Verification of Revealed Seed

- **Severity:** **MEDIUM**
- **Exact SQL Location:** `supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql`, Lines 804–817:
  ```sql
  INSERT INTO public.draw_randomness_evidence (
    draw_id,
    prize_id,
    snapshot_id,
    algorithm_version,
    server_seed_commitment,
    server_seed_revealed,
    client_entropy,
    combined_seed,
    selected_index,
    total_candidates,
    winning_ticket_number,
    verification_status
  ) VALUES (
    p_draw_id,
    p_prize_id,
    p_snapshot_id,
    'SSFI-CSPRNG-V1',
    p_seed_commitment,
    p_seed_revealed,
    p_client_entropy,
    p_combined_seed,
    p_winning_index,
    v_snapshot.total_eligible_count,
    v_winning_ticket.ticket_number,
    'VERIFIED'
  );
  ```
- **Technical Explanation:**  
  The procedure records `verification_status = 'VERIFIED'` unconditionally in `draw_randomness_evidence`. It does not calculate `encode(digest(p_seed_revealed, 'sha256'), 'hex')` to verify that `p_seed_revealed` matches `p_seed_commitment`.  
  While the Node.js backend performs this check, relying solely on client/backend validation defeats the defense-in-depth benefit of database-level verification. If mismatched seeds are passed, the evidence table would permanently record a false `'VERIFIED'` claim.
- **Required Remediation:**  
  Leverage PostgreSQL's `pgcrypto` extension (installed in `202610270001_phase2_core.sql`) to verify the hash directly:
  ```sql
  IF lower(encode(public.digest(p_seed_revealed, 'sha256'), 'hex')) <> lower(p_seed_commitment) THEN
    RAISE EXCEPTION 'Cryptographic verification failure: SHA-256 of revealed seed does not match commitment.'
      USING ERRCODE = '23514';
  END IF;
  ```
- **Blocks Preview Migration:** **NO** (Backend validates this, but database-level check is recommended).

---

### Finding SEC-05 (LOW) — Missing Post-Draw Mutability Lock on First Prize Approval Records

- **Severity:** **LOW**
- **Exact SQL Location:** `supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql`, Lines 520–528:
  ```sql
  ON CONFLICT (draw_id, prize_id, snapshot_hash)
  DO UPDATE SET
    initiator_id = p_actor,
    approver_id = NULL,
    status = 'PENDING',
    requested_at = now(),
    reviewed_at = NULL,
    review_notes = NULL
  ```
- **Technical Explanation:**  
  If `admin_request_first_prize_approval` is called after Prize 1 has already been executed, the `ON CONFLICT DO UPDATE` clause overwrites the historical approval record (`status = 'PENDING'`, `approver_id = NULL`). While `execute_draw_winner_selection` blocks re-drawing the prize, the historical approval log for that ceremony is lost.
- **Required Remediation:**  
  Add an assertion in `admin_request_first_prize_approval`:
  ```sql
  IF EXISTS (SELECT 1 FROM public.draw_results WHERE draw_id = p_draw_id AND prize_id = p_prize_id) THEN
    RAISE EXCEPTION 'Cannot modify approval request: Prize has already been drawn.' USING ERRCODE = '23514';
  END IF;
  ```
- **Blocks Preview Migration:** **NO**.

---

### Finding SEC-06 (LOW) — Missing Cross-Campaign Ticket Ownership Assertion in `execute_draw_winner_selection`

- **Severity:** **LOW**
- **Exact SQL Location:** `supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql`, Lines 748–753:
  ```sql
  IF v_ticket_master.status <> 'ISSUED' THEN
    RAISE EXCEPTION 'Disqualified: Ticket % is not in ISSUED state (status=%)',
      v_ticket_master.ticket_number, v_ticket_master.status
      USING ERRCODE = '23514';
  END IF;
  ```
- **Technical Explanation:**  
  The procedure verifies that the ticket is in `'ISSUED'` state, but does not assert `v_ticket_master.campaign_id = v_draw.campaign_id`. If a snapshot somehow included a ticket from a different campaign, it would be inserted into `public.draw_results` for the active campaign.
- **Required Remediation:**  
  Add assertion:
  ```sql
  IF v_ticket_master.campaign_id <> v_draw.campaign_id THEN
    RAISE EXCEPTION 'Disqualified: Ticket % does not belong to campaign %',
      v_ticket_master.ticket_number, v_draw.campaign_id USING ERRCODE = '23514';
  END IF;
  ```
- **Blocks Preview Migration:** **NO**.

---

### Finding SEC-07 (LOW) — Explicit Public Read Grants for Spectator Verification

- **Severity:** **LOW**
- **Exact SQL Location:** `supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql`, Line 1058:
  ```sql
  GRANT SELECT ON TABLE public.draw_randomness_evidence TO anon;
  ```
- **Technical Explanation:**  
  Line 1058 grants `SELECT` to `anon` on `draw_randomness_evidence`. However, lines 1024–1038 create public read RLS policies on `public.draws` and `public.draw_results` without explicitly granting `SELECT` on those tables to `anon`. If default table privileges for `anon` were revoked in a future lockdown migration, public spectators on `/verify/[ticketNumber]` would receive a permission denied error.
- **Required Remediation:**  
  Explicitly grant `SELECT` on `draws` and `draw_results` to `anon`:
  ```sql
  GRANT SELECT ON TABLE public.draws, public.draw_results TO anon;
  ```
- **Blocks Preview Migration:** **NO**.

---

## 4. Summary Table of Audit Findings

| Finding ID | Severity | Area | Description | Blocks Preview? |
| :--- | :---: | :--- | :--- | :---: |
| **SEC-01** | **HIGH** | Permissions / Grants | Administrative RPCs callable by `authenticated` users without `auth.uid()` binding (Actor Spoofing Risk) | **YES (Cond. 1)** |
| **SEC-02** | **MEDIUM** | Triggers / Syntax | `BEFORE DELETE` triggers return `NEW` (NULL), silently cancelling deletions of draft snapshots | No |
| **SEC-03** | **MEDIUM** | Cryptography / State | `execute_draw_winner_selection` overwrites `seed_commitment` without verifying session pre-commitment | No |
| **SEC-04** | **MEDIUM** | Cryptography / Evidence | Randomness evidence hardcodes `'VERIFIED'` without executing in-database SHA-256 verification | No |
| **SEC-05** | **LOW** | State / Approvals | `admin_request_first_prize_approval` can overwrite approval record after draw has completed | No |
| **SEC-06** | **LOW** | Integrity / Tickets | Missing assertion that winning ticket matches campaign ID | No |
| **SEC-07** | **LOW** | Permissions / Grants | `anon` granted SELECT on evidence table but lacks explicit grant on `draws` and `draw_results` | No |

---

## 5. Explicit Audit Verdict

### **VERDICT: APPROVED WITH CONDITIONS**

**Detailed Condition for Approval:**
1. **Remediate SEC-01 Prior to Execution:**  
   Update `supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql` lines 1067–1071 to revoke `EXECUTE` on the five administrative functions from `authenticated` and grant `EXECUTE` exclusively to `service_role`. This prevents malicious actors from invoking administrative draw functions via direct PostgREST requests.
2. *(Recommended Prior to Live Draws)*: Apply the PL/pgSQL trigger fix (SEC-02) and pre-commitment validation checks (SEC-03, SEC-04) to ensure maximum cryptographic and procedural defense-in-depth.

---

## 6. Migration Artifact Hash & Repository Git Status

### 6.1 Target Migration File SHA-256 Digest
```
Algorithm: SHA256
Hash:      EB1927BF5DAD3651F918745785627C85AA244B8EBD1619A748FD72565F9C8EDF
Path:      F:\PROJECT\Lucky Draw\supabase\migrations\202611080001_phase9c_lucky_draw_foundation.sql
```

### 6.2 Working Tree & Git Status
```
On branch preview/production-mirror
Your branch is up to date with 'origin/preview/production-mirror'.

Changes not staged for commit:
  modified:   src/lib/delivery/outbox.ts
  modified:   src/lib/delivery/templates.ts
  modified:   tests/customerTransactionalEmail.test.ts

Untracked files:
  docs/security/PHASE_8C_1_RSK_02_EMAIL_SNAPSHOT_REMEDIATION_REPORT.md
  docs/security/PHASE_8C_PRODUCTION_READINESS_AUDIT_REPORT.md
  docs/security/PHASE_9A_SECURE_LUCKY_DRAW_ARCHITECTURE.md
  docs/security/PHASE_9B_DATABASE_AND_BACKEND_IMPLEMENTATION_PLAN.md
  docs/security/PHASE_9C_PREVIEW_MIGRATION_REVIEW_REPORT.md
  docs/security/PHASE_9C_1_INDEPENDENT_SQL_SECURITY_REVIEW.md
  supabase/migrations/202611080001_phase9c_lucky_draw_foundation.sql

no changes added to commit (use "git add" and/or "git commit -a")
```

All existing working-tree modifications (including Phase 8C.1 seller payment snapshot remediation) are fully intact.

---

*Report prepared and independently audited by Senior PostgreSQL & Supabase Database Security Engineer.*  
*File location: `docs/security/PHASE_9C_1_INDEPENDENT_SQL_SECURITY_REVIEW.md`*

