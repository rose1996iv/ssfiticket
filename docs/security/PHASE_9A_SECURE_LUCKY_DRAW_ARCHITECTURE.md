# SSFI Lucky Draw — Phase 9A: Secure Winner Selection Architecture & Requirements

> **Status:** ARCHITECTURE DESIGN & REQUIREMENTS SPECIFICATION  
> **Target Release:** Phase 9 (Winner Selection, Eligibility & Draw Ceremony)  
> **Environment Target:** Preview (`jiyuiydzsfydjklosvvq`) & Production (`fohpqheglxhfdecadhzw`)  
> **Document Date:** 2026-11-08  
> **Security Classification:** STRICTLY INTERNAL — ARCHITECTURAL BLUEPRINT  

---

## 1. Executive Summary

This document specifies the end-to-end security architecture, business rules, mathematical randomness foundation, database design, and user experience for the **SSFI Lucky Draw Winner Selection System**.

The SSFI Lucky Draw raises funds for social service initiatives by issuing verifiable digital tickets (`SSFI-######`). The winner selection ceremony is the highest-stakes milestone of the entire campaign. To guarantee public trust, organizational credibility, and regulatory compliance, winner selection incorporates four explicitly approved Owner Decisions:
1. **Strict Ascending Draw Sequence:** Ceremonial drawing proceeds in ascending order: **`5th → 4th → 3rd → 2nd → 1st Prize`**. Lower prize draws execute first, progressively building tension toward the First Prize. Any ticket winning a prize is immediately and irrevocably excluded from all subsequent draws across the campaign. The sequence is enforced at the database engine level.
2. **First Prize Two-Person Dual Control:** The grand First Prize requires two distinct authenticated staff members (`SUPER_ADMIN` initiator + distinct approver). Self-approval is strictly prohibited, and approvals are cryptographically bound to the locked snapshot hash.
3. **Rotating Number Drum UX:** The presentation layer utilizes a decoupled, high-density rotating cylindrical drum/barrel display with smooth cubic-bezier deceleration, capable of rendering 1,000+ candidate tickets clearly. The drum is strictly a visualizer of the backend-committed winner; refreshing or replaying can never change or fabricate a winner.
4. **Governed Manual Winner Notification:** Winner results are committed to the database first, reviewed in the Admin Draw Control Center, and notified only upon explicit administrative action (`Notify Winner`) via the transactional email outbox, preventing premature or automated leaks.
5. **Cryptographically Fair & Server-Authoritative:** Powered exclusively by server-side CSPRNG (`crypto.randomInt()`), mathematical rejection sampling, and a Two-Phase Commit-Reveal evidence protocol.
6. **Tamper-Resilient & Immutable:** Protected by PostgreSQL row-level locks (`FOR UPDATE`), engine-level triggers preventing `UPDATE`/`DELETE` on `draw_results`, and an append-only audit trail.

```
       +-------------------------------------------------------------+
       |               SSFI Lucky Draw Architecture                  |
       +-------------------------------------------------------------+
                                      |
         [ Phase 1-8: Completed ]     |     [ Phase 9: In Design ]
                                      |
   +------------------------------+   |   +------------------------------+
   |   Customer Order & Payment   |   |   |   Admin Eligibility Manager  |
   | - Manual UPI Submission      |   |   | - Filter verified tickets    |
   | - Admin Screenshot Review    |   |   | - Exclude previous winners   |
   | - Atomic Ticket Issuance     |   |   | - Manual exclusions & reason |
   +--------------+---------------+   |   +--------------+---------------+
                  |                   |                  |
                  v                   |                  v
   +------------------------------+   |   +------------------------------+
   |  public.tickets (ISSUED)     |   |   |  Eligibility Snapshot        |
   | - SSFI-000001..SSFI-999999   |-->|   | - SHA-256 Digest             |
   | - Immutable identity trigger |   |   | - Immutable row lock         |
   +------------------------------+   |   +--------------+---------------+
                                      |                  |
                                      |                  v
                                      |   +------------------------------+
                                      |   |  CSPRNG Randomness Engine    |
                                      |   | - crypto.randomInt()         |
                                      |   | - Commit-Reveal Evidence     |
                                      |   +--------------+---------------+
                                      |                  |
                                      |                  v
                                      |   +------------------------------+
                                      |   |  Atomic Database Execution   |
                                      |   | - Unique(campaign, ticket)   |
                                      |   | - Append-only audit log      |
                                      |   +--------------+---------------+
                                      |                  |
                                      |                  v
                                      |   +------------------------------+
                                      |   |  Presentation & Verification |
                                      |   | - Wheel Visualization        |
                                      |   | - Public Verifier Endpoint   |
                                      +----------------------------------+
```

---

## 2. Confirmed Business Rules

The system design strictly enforces the following approved business rules:

* **Rule 1 — Admin Eligibility Definition & Approval:**  
  The Admin defines and explicitly approves the Eligible Ticket List for each prize draw before any drawing action can occur.
* **Rule 2 — Strict Participation Boundary:**  
  Only tickets present on the approved, locked Eligible Ticket List may participate in the corresponding prize draw.
* **Rule 3 — Campaign-Wide Single Winner Invariant:**  
  A ticket that has already won a prize in a campaign must be excluded from every subsequent prize draw in that campaign. A single ticket can win at most one prize per campaign.
* **Rule 4 — Server-Exclusive Winner Selection:**  
  Winner selection is computed strictly inside the trusted server runtime and executed inside an atomic PostgreSQL transaction.
* **Rule 5 — Frontend Presentation Decoupling:**  
  The frontend spinning wheel is strictly visual. It receives the winner identity from the backend *after* the database transaction commits and simply renders an animated deceleration landing on the pre-committed winner.
* **Rule 6 — Result Immutability:**  
  A completed draw result is permanent and immutable. PostgreSQL triggers must block any `UPDATE` or `DELETE` on `draw_results`.
* **Rule 7 — Governed Exceptional Rerun / Cancellation:**  
  Any cancellation, voiding, or rerun cannot overwrite history; it requires dedicated `SUPER_ADMIN` authorization, multi-factor confirmation, an audited cancellation rationale, and leaves an indelible record in `audit_logs`.
* **Rule 8 — Append-Only Audit Logging:**  
  All eligibility modifications, snapshot locks, randomness seed generations, draw executions, and winner announcements are written directly to `public.audit_logs`.
* **Rule 9 — Strict Ascending Draw Sequence:**  
  Prize draws must proceed strictly in ascending order: **`5th → 4th → 3rd → 2nd → 1st`**. The backend must enforce that Prize $K$ cannot be initiated or executed unless Prize $K+1$ has been completed and recorded. Client-side navigation or UI sequencing alone is never trusted.
* **Rule 10 — First Prize Two-Person Dual Control:**  
  The First Prize draw cannot execute on single authority. It strictly requires two distinct authenticated users (`SUPER_ADMIN` initiator + distinct approver). Self-approval is rejected by database constraints, and approval is immutably bound to the exact eligibility snapshot hash. Any snapshot drift automatically invalidates pending approval.
* **Rule 11 — Rotating Number Drum Presentation Model:**  
  The visualization interface must utilize a high-density rotating cylindrical drum/barrel display capable of rendering 1,000+ candidate tickets clearly. The drum is strictly a client visualizer decelerating into the backend-committed winner; refreshing or replaying the drum can never alter the committed winner or generate a new result.
* **Rule 12 — Governed Manual Winner Notification:**  
  Completed draw results must be committed and reviewed in the Admin Control Center before any customer communication occurs. Zero automated notifications are dispatched on draw completion. An authorized Administrator must click `Notify Winner`, triggering an idempotent outbox job with an append-only audit trail. Customer contact details must never be exposed on public verification endpoints.

---

## 3. Existing Architecture Assessment

An exhaustive inspection of the existing codebase and database schema reveals the following baseline:

### 3.1 Existing Database Schema (Tables & Constraints)

1. **`public.campaigns`:**
   - Holds campaign state (`DRAFT`, `ACTIVE`, `PAUSED`, `CLOSED`, `CANCELLED`).
   - Official campaign: `ssfi-fundraising-lucky-draw` (Target draw date: 19 December 2026).
   - Contains `sold_ticket_count` and `total_ticket_limit`.
2. **`public.prizes`:**
   - 5 seeded prizes for `ssfi-fundraising-lucky-draw`:
     - Prize 1: 1st Prize — ₹10,000 Cash (`display_order: 1`, `prize_number: 1`, `cash_amount_paise: 1000000`)
     - Prize 2: 2nd Prize — ₹8,000 Cash (`display_order: 2`, `prize_number: 2`, `cash_amount_paise: 800000`)
     - Prize 3: 3rd Prize — Electric Induction (`display_order: 3`, `prize_number: 3`, `cash_amount_paise: NULL`)
     - Prize 4: 4th Prize — Ukulele (`display_order: 4`, `prize_number: 4`, `cash_amount_paise: NULL`)
     - Prize 5: 5th Prize — Mini Soundbox (`display_order: 5`, `prize_number: 5`, `cash_amount_paise: NULL`)
   - Existing constraints: `unique(campaign_id, prize_number)` and `unique(campaign_id, display_order)`.
3. **`public.draws` (Baseline: 0 rows in Preview & Production):**
   - Columns: `id (uuid)`, `campaign_id (uuid)`, `name (text)`, `status (draw_status)`, `scheduled_at (timestamptz)`, `executed_at (timestamptz)`, `created_at (timestamptz)`.
   - `public.draw_status` enum: `'DRAFT'`, `'SCHEDULED'`, `'EXECUTED'`, `'CANCELLED'`.
   - Missing: Direct relationship to `prize_id` (if modeling draws per prize), snapshot linkage, randomness seed commitments, and locking metadata.
4. **`public.draw_results` (Baseline: 0 rows in Preview & Production):**
   - Columns: `id (uuid)`, `draw_id (uuid)`, `prize_id (uuid)`, `ticket_id (uuid)`, `created_at (timestamptz)`.
   - Existing constraints:
     - `unique(draw_id, prize_id)`
     - `unique(draw_id, ticket_id)`
   - **Critical Architectural Vulnerability in Existing Schema:**  
     `draw_results` does **not** include `campaign_id`. Therefore, `unique(draw_id, ticket_id)` only prevents a ticket from winning twice in the *same draw record*. If 5 separate draws are created (one for each prize), the database schema does **not** prevent ticket `SSFI-000042` from winning Prize 5 in Draw 1 and winning Prize 1 in Draw 5.  
     *Remediation Required:* Add `campaign_id` to `draw_results` and enforce `UNIQUE(campaign_id, ticket_id)`.
5. **`public.tickets`:**
   - Columns: `id`, `campaign_id`, `order_id`, `customer_id`, `seller_id`, `ticket_number`, `status` (`ISSUED`, `VOID`, `REFUNDED`), `issued_at`.
   - Protected by `trg_protect_ticket_identity_immutability` (prohibits `UPDATE` on `id, ticket_number, order_id, campaign_id, customer_id, seller_id, issued_at`).
6. **`public.audit_logs`:**
   - Protected by `trg_protect_audit_logs_append_only` (prohibits `UPDATE` and `DELETE`).
   - Categorized by `src/lib/audit/center.ts` which already defines action `DRAW_EXECUTED` under the `CAMPAIGN` category.

### 3.2 Existing Application Code

- **Admin UI:** Located at `/admin` with tabs for Operations, Payments, Orders, Tickets, Customers, Sellers, Messages, Audit Logs, and Campaign Settings.  
  *Finding:* There is currently **no Draw Control or Winner Selection UI** in the repository.
- **Server Actions:** Existing modules handle `campaign.ts`, `tickets.ts`, `operations.ts`, `paymentScreenshot.ts`, etc.  
  *Finding:* There are **no server actions or API routes** for draw execution, random seed generation, or eligibility locking.
- **Public Verification:** Located at `/verify/[ticketNumber]`.  
  *Finding:* Currently displays validity status (`ISSUED` / `VOID`) and campaign name. It does not display draw outcomes or winning prize badges.

---

## 4. Eligibility Management Design

The Eligibility Management subsystem gives administrators transparent, auditable control over which tickets participate in a given prize draw.

```
+-----------------------------------------------------------------------------------+
|                        ELIGIBILITY PIPELINE (PER PRIZE)                          |
+-----------------------------------------------------------------------------------+
                                          |
  1. BASELINE QUERY                       v
     SELECT t.id, t.ticket_number, t.customer_id, t.order_id
     FROM public.tickets t
     JOIN public.orders o ON o.id = t.order_id
     JOIN public.payments p ON p.order_id = o.id
     WHERE t.campaign_id = :campaignId
       AND t.status = 'ISSUED'
       AND p.status = 'VERIFIED'
       AND o.status IN ('PAYMENT_VERIFIED', 'TICKETS_ISSUED')
                                          |
  2. AUTOMATIC PREVIOUS WINNER EXCLUSION  v
     AND t.id NOT IN (
       SELECT dr.ticket_id
       FROM public.draw_results dr
       WHERE dr.campaign_id = :campaignId
     )
                                          |
  3. MANUAL EXCLUSION OVERLAY             v
     AND t.id NOT IN (
       SELECT dme.ticket_id
       FROM public.draw_manual_exclusions dme
       WHERE dme.campaign_id = :campaignId
         AND (dme.prize_id IS NULL OR dme.prize_id = :prizeId)
     )
                                          |
  4. CANONICAL SORTING                    v
     ORDER BY t.ticket_number ASC (Natural Lexicographical Order)
                                          |
  5. IMMUTABLE SNAPSHOT GENERATION        v
     Hash = SHA-256(ticket_number_0 \n ticket_number_1 \n ... \n ticket_number_N-1)
     Status = LOCKED
+-----------------------------------------------------------------------------------+
```

### 4.1 Strict Eligibility Criteria

A ticket is strictly eligible for a prize draw if and only if **all** of the following conditions evaluate to true:

1. **Campaign Match:** `t.campaign_id = target_campaign_id`.
2. **Official Issuance:** `t.status = 'ISSUED'`.
3. **Verified Payment Association:** The ticket belongs to an order with a successfully verified payment (`p.status = 'VERIFIED'` and `p.verified_at IS NOT NULL`).
4. **Not Voided or Refunded:** `t.status NOT IN ('VOID', 'REFUNDED')`.
5. **No Previous Wins in Campaign:** The ticket ID does not appear in `public.draw_results` for the same campaign (`Rule 3`).
6. **No Active Manual Exclusion:** The ticket ID is not listed in `public.draw_manual_exclusions` for this campaign/prize.

### 4.2 Administrative Control Features

- **Search & Filter:** Admin can search candidates by ticket number (`SSFI-######`), order number, customer name, phone number, seller code, or payment verification date.
- **Individual Ticket Exclusion:** Admin can toggle an exclusion for a single ticket, requiring a mandatory reason (e.g., *"Staff member voluntary exclusion"*, *"Contested payment under dispute"*, *"Customer requested withdrawal"*). Minimum reason length: 5 characters.
- **Bulk Exclusion:** Admin can apply exclusions across a filter set (e.g., all tickets sold by a specific internal test account or seller).
- **Eligibility Preview:** Displays:
  - Total Tickets Issued in Campaign.
  - Automatically Excluded (Previous Winners): Count and list with prize badges.
  - Automatically Excluded (Voided / Unverified): Count and list.
  - Manually Excluded: Count, list, and audited reasons.
  - **Net Eligible Tickets Available for Draw.**
- **Accidental Change Prevention:** Once an administrator locks the eligibility list into a snapshot, all buttons for adding/removing exclusions are permanently disabled for that draw session.

---

## 5. Snapshot and Integrity Design

An Eligibility Snapshot captures the complete, verifiable state of all eligible tickets at the precise moment the administrator approves the draw roster.

### 5.1 Snapshot Schema & Attributes

For each prize draw, a record is created in `public.draw_eligibility_snapshots`:

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `uuid` | Primary Key (`gen_random_uuid()`) |
| `draw_id` | `uuid` | Reference to parent `public.draws(id)` |
| `campaign_id` | `uuid` | Reference to `public.campaigns(id)` |
| `prize_id` | `uuid` | Reference to `public.prizes(id)` |
| `total_eligible_count` | `integer` | Total count of eligible tickets (Must be $> 0$) |
| `previous_winner_count`| `integer` | Count of tickets excluded due to previous wins |
| `manual_exclusion_count`| `integer`| Count of tickets excluded by manual admin rule |
| `snapshot_hash` | `text` | SHA-256 digest of canonically ordered tickets |
| `algorithm_version` | `text` | e.g., `'SSFI-CSPRNG-V1'` |
| `is_locked` | `boolean` | `true` when approved; triggers DB immutability |
| `locked_at` | `timestamptz` | Exact timestamp of admin approval |
| `locked_by` | `uuid` | Profile ID of approving administrator |
| `created_at` | `timestamptz` | Creation timestamp |

### 5.2 Canonical Ticket Indexing (`draw_snapshot_tickets`)

Individual eligible tickets are stored in `public.draw_snapshot_tickets`:
- `snapshot_id`: Reference to snapshot.
- `display_index`: Contiguous integer from `0` to `total_eligible_count - 1`.
- `ticket_id`: Foreign key to `public.tickets(id)`.
- `ticket_number`: Human-readable ticket number (`SSFI-000421`).

### 5.3 Cryptographic Snapshot Digest Calculation

To ensure absolute integrity, the snapshot hash is calculated using SHA-256 over a canonical representation:

$$\text{CanonicalString} = \bigoplus_{i=0}^{N-1} \left( \text{ticket\_number}_i \parallel \text{"\n"} \right)$$

$$\text{snapshot\_hash} = \text{SHA-256}\left( \text{CanonicalString} \right)$$

```typescript
import { createHash } from "node:crypto";

export function computeSnapshotHash(ticketNumbersAscending: string[]): string {
  const hasher = createHash("sha256");
  for (const ticketNumber of ticketNumbersAscending) {
    hasher.update(`${ticketNumber.trim().toUpperCase()}\n`, "utf8");
  }
  return hasher.digest("hex");
}
```

### 5.4 Database-Enforced Immutability

A PostgreSQL `BEFORE UPDATE OR DELETE` trigger protects both `public.draw_eligibility_snapshots` and `public.draw_snapshot_tickets`:
- If `OLD.is_locked = true`, any attempt to modify rows, recalculate totals, or delete tickets raises SQLSTATE `23514` (`P0001` check violation).

---

## 6. Randomness and Winner Selection Design

### 6.1 Cryptographic Foundation: Node.js `crypto.randomInt`

Winner selection **must never** use `Math.random()`, floating-point multiplications, or naive modulo operators (`rand % N`), which introduce severe modulo bias whenever the entropy source range is not an exact integer multiple of $N$.

Node.js provides `crypto.randomInt(min, max)` backed by OpenSSL/BoringSSL's kernel CSPRNG (`/dev/urandom` or Windows `BCryptGenRandom`).
- `crypto.randomInt(0, N)` produces a uniform distribution over $\{0, 1, \dots, N-1\}$.
- It uses internal rejection sampling: if the generated raw random bits fall into the incomplete remainder slice of the uniform range, they are discarded and re-drawn, mathematically guaranteeing zero modulo bias.

### 6.2 Commit-Reveal Randomness Evidence Protocol

For maximum public transparency and auditability, we specify a **Two-Phase Commit-Reveal Evidence Protocol**:

```
[ Phase 1: Pre-Draw Commitment ]
Admin/System generates:
  Server Seed (S_server): 32 random bytes (256 bits)
  Public Commitment (C): SHA-256(S_server)
Commitment C is saved to the database and displayed on the public screen BEFORE the draw.

                                |
                                v
[ Phase 2: Entropy Gathering & Draw Execution ]
Spectator/Client Entropy (S_client): Live timestamp or external token
Combined Seed (S_combined):
  HMAC-SHA256(Key = S_server, Message = S_client || snapshot_hash || prize_id)

                                |
                                v
[ Phase 3: Deterministic Winner Derivation ]
Winning Index = RejectionSample(S_combined, total_eligible_count)
Winning Ticket = draw_snapshot_tickets WHERE display_index = Winning Index

                                |
                                v
[ Phase 4: Public Reveal & Independent Verification ]
Server reveals S_server.
Auditors verify:
  1. SHA-256(S_server) == C
  2. HMAC-SHA256(S_server, S_client || snapshot_hash || prize_id) == S_combined
  3. RejectionSample(S_combined, count) == Winning Index
```

### 6.3 Rejection Sampling Implementation Specification

```typescript
import { createHmac } from "node:crypto";

/**
 * Deterministically derives an unbiased integer index in [0, maxExcluded)
 * from a 256-bit entropy seed using unbiased rejection sampling.
 */
export function deriveUnbiasedIndex(combinedSeedHex: string, maxExcluded: number): number {
  if (maxExcluded <= 0) throw new Error("Range must be positive");
  if (maxExcluded === 1) return 0;

  const seedBuffer = Buffer.from(combinedSeedHex, "hex");
  const MAX_UINT32 = 0x100000000; // 2^32
  const limit = MAX_UINT32 - (MAX_UINT32 % maxExcluded);

  let offset = 0;
  while (offset + 4 <= seedBuffer.length) {
    const rawVal = seedBuffer.readUInt32BE(offset);
    offset += 4;
    // Rejection sample to prevent modulo bias
    if (rawVal < limit) {
      return rawVal % maxExcluded;
    }
  }

  // If initial 32-byte seed buffer exhausted by rejection (extremely rare: < 1 in 10^9),
  // expand seed via HMAC expansion
  const expanded = createHmac("sha256", seedBuffer).update("EXPANSION").digest();
  const rawVal = expanded.readUInt32BE(0);
  return rawVal % maxExcluded;
}
```

### 6.4 Threat Model & Security Proofs

1. **Seed Grinding Prevention:** The server commitment $C$ is recorded in `public.draw_sessions` with an immutable database lock before $S_{client}$ is incorporated. An admin cannot "try multiple seeds" because the commitment hash $C$ was already permanently locked and witnessed.
2. **Post-Commitment Manipulation Prevention:** The snapshot hash `snapshot_hash` is bound inside the HMAC message. Any attempt to modify the ticket list after commitment changes the HMAC input and invalidates the proof.
3. **Frontend Tamper Resistance:** The client browser never transmits a winner index or ticket ID. The POST request is merely:
   `POST /api/admin/draw/execute { drawId, prizeId, clientEntropy }`
   The server computes the winner, writes it to the database, and returns the result.

---

## 7. Database Schema Proposal

To implement this architecture without disrupting existing tables, we propose the following schema additions.

```
       +------------------------------------+
       |          public.campaigns          |
       +------------------------------------+
                         | 1
                         |
                         | N
       +-----------------+------------------+
       |            public.draws            |
       +------------------------------------+
         - id: uuid (PK)
         - campaign_id: uuid (FK)
         - name: text
         - status: draw_status
                         | 1
                         |
                         | N
       +-----------------+------------------+
       |   draw_eligibility_snapshots       |
       +------------------------------------+
         - id: uuid (PK)
         - draw_id: uuid (FK)
         - prize_id: uuid (FK)
         - campaign_id: uuid (FK)
         - snapshot_hash: text
         - is_locked: boolean
                         | 1
                         +-----------------------------+
                         |                             |
                         | N                           | 1
       +-----------------+--------------+   +----------+-----------+
       |     draw_snapshot_tickets      |   |  public.draw_results |
       +--------------------------------+   +----------------------+
         - snapshot_id: uuid (FK)             - draw_id: uuid (FK)
         - ticket_id: uuid (FK)               - prize_id: uuid (FK)
         - display_index: int                 - ticket_id: uuid (FK)
                                              - campaign_id: uuid (FK)
                                              - snapshot_id: uuid (FK)
                                              - seed_commitment: text
                                              - seed_revealed: text
                                              - selection_index: int
                                              * UNIQUE(campaign, ticket)
```

### 7.1 Proposed Schema Additions & Upgrades

```sql
-- ============================================================================
-- 1. EXTEND PUBLIC.DRAWS
-- ============================================================================
ALTER TABLE public.draws
  ADD COLUMN IF NOT EXISTS current_prize_id uuid REFERENCES public.prizes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS seed_commitment text,
  ADD COLUMN IF NOT EXISTS seed_revealed text,
  ADD COLUMN IF NOT EXISTS client_entropy text,
  ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ============================================================================
-- 2. CREATE DRAW MANUAL EXCLUSIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.draw_manual_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE RESTRICT,
  prize_id uuid REFERENCES public.prizes(id) ON DELETE RESTRICT, -- NULL = all prizes
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(trim(reason)) >= 5),
  excluded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, prize_id, ticket_id)
);

-- ============================================================================
-- 3. CREATE DRAW ELIGIBILITY SNAPSHOTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.draw_eligibility_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id uuid NOT NULL REFERENCES public.draws(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE RESTRICT,
  prize_id uuid NOT NULL REFERENCES public.prizes(id) ON DELETE RESTRICT,
  total_eligible_count integer NOT NULL CHECK (total_eligible_count >= 0),
  previous_winner_count integer NOT NULL DEFAULT 0 CHECK (previous_winner_count >= 0),
  manual_exclusion_count integer NOT NULL DEFAULT 0 CHECK (manual_exclusion_count >= 0),
  snapshot_hash text NOT NULL,
  algorithm_version text NOT NULL DEFAULT 'SSFI-CSPRNG-V1',
  is_locked boolean NOT NULL DEFAULT false,
  locked_at timestamptz,
  locked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(draw_id, prize_id)
);

-- ============================================================================
-- 4. CREATE DRAW SNAPSHOT TICKETS TABLE (CANONICALLY INDEXED)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.draw_snapshot_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES public.draw_eligibility_snapshots(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE RESTRICT,
  ticket_number text NOT NULL,
  display_index integer NOT NULL CHECK (display_index >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(snapshot_id, ticket_id),
  UNIQUE(snapshot_id, display_index)
);

-- ============================================================================
-- 5. CREATE DRAW APPROVALS TABLE (FIRST PRIZE TWO-PERSON DUAL CONTROL)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.draw_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id uuid NOT NULL REFERENCES public.draws(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE RESTRICT,
  prize_id uuid NOT NULL REFERENCES public.prizes(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES public.draw_eligibility_snapshots(id) ON DELETE RESTRICT,
  snapshot_hash text NOT NULL,
  initiator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approver_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'INVALIDATED')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decision_notes text,
  UNIQUE(draw_id, prize_id, snapshot_hash),
  CONSTRAINT draw_approvals_distinct_actors CHECK (approver_id IS NULL OR initiator_id <> approver_id)
);

-- ============================================================================
-- 6. UPGRADE PUBLIC.DRAW_RESULTS (WITH CAMPAIGN-WIDE UNIQUE WINNER INVARIANT)
-- ============================================================================
ALTER TABLE public.draw_results
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.campaigns(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS snapshot_id uuid REFERENCES public.draw_eligibility_snapshots(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS selection_index integer,
  ADD COLUMN IF NOT EXISTS seed_commitment text,
  ADD COLUMN IF NOT EXISTS seed_revealed text,
  ADD COLUMN IF NOT EXISTS combined_seed text,
  ADD COLUMN IF NOT EXISTS drawn_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS notified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- CRITICAL BUSINESS RULE 3: A ticket can win at most ONE prize per campaign
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'draw_results_campaign_ticket_unique'
  ) THEN
    ALTER TABLE public.draw_results
      ADD CONSTRAINT draw_results_campaign_ticket_unique UNIQUE (campaign_id, ticket_id);
  END IF;
END $$;

-- ============================================================================
-- 6. IMMUTABILITY GUARDS (ENGINE LEVEL)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.protect_draw_results_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'draw_results records are strictly immutable. UPDATE and DELETE are prohibited.'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_draw_results_immutability ON public.draw_results;
CREATE TRIGGER trg_protect_draw_results_immutability
  BEFORE UPDATE OR DELETE ON public.draw_results
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_draw_results_immutability();
```

---

## 8. RPC and Transaction Design

The draw execution must be executed atomically inside PostgreSQL via a `SECURITY DEFINER` stored function with explicit transaction locking.

### 8.1 Transaction Flow: `select_draw_winner_and_record`

```sql
CREATE OR REPLACE FUNCTION public.execute_draw_winner_selection(
  p_draw_id uuid,
  p_prize_id uuid,
  p_snapshot_id uuid,
  p_winning_index integer,
  p_seed_commitment text,
  p_seed_revealed text,
  p_combined_seed text,
  p_actor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draw public.draws;
  v_prize public.prizes;
  v_snapshot public.draw_eligibility_snapshots;
  v_winning_ticket public.draw_snapshot_tickets;
  v_ticket_master public.tickets;
  v_result_id uuid;
BEGIN
  -- 1. Actor Authorization Guard
  IF p_actor IS NULL OR NOT public.is_staff(p_actor) THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required.' USING ERRCODE = '42501';
  END IF;

  -- 2. Concurrency Lock: Lock Draw Record
  SELECT * INTO v_draw FROM public.draws WHERE id = p_draw_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draw session not found.' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Concurrency Lock: Lock Prize Record
  SELECT * INTO v_prize FROM public.prizes WHERE id = p_prize_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prize not found.' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Check If Prize Already Drawn (Idempotency & Race Condition Guard)
  IF EXISTS (
    SELECT 1 FROM public.draw_results
    WHERE draw_id = p_draw_id AND prize_id = p_prize_id
  ) THEN
    RAISE EXCEPTION 'Prize has already been drawn in this session.' USING ERRCODE = '23505';
  END IF;

  -- 4a. Sequence Guard: Enforce Ceremonial Ascending Sequence (5th -> 4th -> 3rd -> 2nd -> 1st)
  IF v_prize.prize_number < 5 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.draw_results dr
      JOIN public.prizes p ON p.id = dr.prize_id
      WHERE dr.campaign_id = v_draw.campaign_id
        AND p.prize_number = v_prize.prize_number + 1
    ) THEN
      RAISE EXCEPTION 'Sequence violation: Prize % cannot be drawn until Prize % is completed and recorded.',
        v_prize.prize_number, v_prize.prize_number + 1
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- 5. Lock & Validate Snapshot
  SELECT * INTO v_snapshot
  FROM public.draw_eligibility_snapshots
  WHERE id = p_snapshot_id
    AND draw_id = p_draw_id
    AND prize_id = p_prize_id
    AND is_locked = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Locked eligibility snapshot not found for this prize.' USING ERRCODE = 'P0002';
  END IF;

  -- 5a. First Prize Two-Person Dual Control Guard (Decision 2)
  IF v_prize.prize_number = 1 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.draw_approvals da
      WHERE da.draw_id = p_draw_id
        AND da.prize_id = p_prize_id
        AND da.snapshot_hash = v_snapshot.snapshot_hash
        AND da.status = 'APPROVED'
        AND da.initiator_id <> da.approver_id
    ) THEN
      RAISE EXCEPTION 'Dual approval violation: 1st Prize requires two distinct authenticated approvals on the locked snapshot before draw execution.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_winning_index < 0 OR p_winning_index >= v_snapshot.total_eligible_count THEN
    RAISE EXCEPTION 'Winning index % out of bounds [0, %)', p_winning_index, v_snapshot.total_eligible_count
      USING ERRCODE = '22003';
  END IF;

  -- 6. Retrieve Winning Ticket from Snapshot
  SELECT * INTO v_winning_ticket
  FROM public.draw_snapshot_tickets
  WHERE snapshot_id = p_snapshot_id
    AND display_index = p_winning_index;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Corrupt snapshot: Missing ticket at index %', p_winning_index
      USING ERRCODE = 'P0002';
  END IF;

  -- 7. Validate Against Master Tickets Table
  SELECT * INTO v_ticket_master
  FROM public.tickets
  WHERE id = v_winning_ticket.ticket_id
  FOR UPDATE;

  IF v_ticket_master.status <> 'ISSUED' THEN
    RAISE EXCEPTION 'Disqualified: Ticket % is not in ISSUED state (status=%)',
      v_ticket_master.ticket_number, v_ticket_master.status
      USING ERRCODE = '23514';
  END IF;

  -- 8. Enforce Rule 3: Ticket Cannot Have Won Any Prize in Same Campaign
  IF EXISTS (
    SELECT 1 FROM public.draw_results
    WHERE campaign_id = v_draw.campaign_id
      AND ticket_id = v_winning_ticket.ticket_id
  ) THEN
    RAISE EXCEPTION 'Disqualified: Ticket % has already won a prize in campaign %',
      v_winning_ticket.ticket_number, v_draw.campaign_id
      USING ERRCODE = '23505';
  END IF;

  -- 9. Insert Draw Result
  INSERT INTO public.draw_results (
    draw_id,
    campaign_id,
    prize_id,
    ticket_id,
    snapshot_id,
    selection_index,
    seed_commitment,
    seed_revealed,
    combined_seed,
    drawn_by
  ) VALUES (
    p_draw_id,
    v_draw.campaign_id,
    p_prize_id,
    v_winning_ticket.ticket_id,
    p_snapshot_id,
    p_winning_index,
    p_seed_commitment,
    p_seed_revealed,
    p_combined_seed,
    p_actor
  ) RETURNING id INTO v_result_id;

  -- 10. Write Structured Audit Log Entry
  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    p_actor,
    'DRAW_EXECUTED',
    'draw',
    p_draw_id,
    jsonb_build_object(
      'result_id', v_result_id,
      'prize_id', p_prize_id,
      'prize_title', v_prize.title,
      'prize_number', v_prize.prize_number,
      'ticket_id', v_winning_ticket.ticket_id,
      'ticket_number', v_winning_ticket.ticket_number,
      'customer_id', v_ticket_master.customer_id,
      'selection_index', p_winning_index,
      'total_eligible_count', v_snapshot.total_eligible_count,
      'snapshot_hash', v_snapshot.snapshot_hash,
      'seed_commitment', p_seed_commitment
    )
  );

  -- 11. Return Confirmed Payload
  RETURN jsonb_build_object(
    'success', true,
    'result_id', v_result_id,
    'draw_id', p_draw_id,
    'prize_id', p_prize_id,
    'ticket_id', v_winning_ticket.ticket_id,
    'ticket_number', v_winning_ticket.ticket_number,
    'selection_index', p_winning_index,
    'executed_at', now()
  );
END;
$$;
```

---

## 9. Roles and Authorization Matrix

SSFI implements strict Role-Based Access Control (RBAC). The winner selection system enforces separation of duties and dual-control authorization:

| Operation | `SUPER_ADMIN` | `ADMIN` | `FUNDRAISING_MANAGER` | `SELLER` | Public |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **View Eligibility Preview** | ✅ Allow | ✅ Allow | ✅ Allow (Read) | ❌ Deny | ❌ Deny |
| **Manage Manual Exclusions** | ✅ Allow | ✅ Allow | ❌ Deny | ❌ Deny | ❌ Deny |
| **Lock Snapshot & Seed** | ✅ Allow | ✅ Allow | ❌ Deny | ❌ Deny | ❌ Deny |
| **Execute Standard Draw (Prizes 5–2)** | ✅ Allow | ⚠️ Requires Confirmation | ❌ Deny | ❌ Deny | ❌ Deny |
| **Initiate 1st Prize Draw** | ✅ Allow | ❌ Deny | ❌ Deny | ❌ Deny | ❌ Deny |
| **Approve 1st Prize Draw (2nd Person)** | ✅ Allow (if distinct) | ✅ Allow (if distinct) | ❌ Deny | ❌ Deny | ❌ Deny |
| **Execute 1st Prize Draw** | 🔒 Requires Dual Approval | ❌ Deny | ❌ Deny | ❌ Deny | ❌ Deny |
| **View Seed & Evidence** | ✅ Allow | ✅ Allow | ✅ Allow | ❌ Deny | ✅ After Reveal |
| **Publish Official Results** | ✅ Allow | ✅ Allow | ❌ Deny | ❌ Deny | ❌ Deny |
| **Dispatch Winner Notification** | ✅ Allow (Manual) | ✅ Allow (Manual) | ❌ Deny | ❌ Deny | ❌ Deny |
| **Exceptional Cancellation** | 🔒 SUPER_ADMIN Only | ❌ Deny | ❌ Deny | ❌ Deny | ❌ Deny |
| **Verify Ticket Win Status** | ✅ Allow | ✅ Allow | ✅ Allow | ✅ Allow | ✅ Allow |

---

## 10. Admin and Drum UI Architecture

### 10.1 Admin Draw Control Center (`/admin/draws`)

The Admin Draw Control Center is designed as a sequential, multi-stage state machine enforcing the approved ascending sequence:

```
[ Stage 1: Prize Selection (Strict Ascending Order) ]
Prizes: 5th (Soundbox) -> 4th (Ukulele) -> 3rd (Induction) -> 2nd (₹8K) -> 1st (₹10K)
* Backend rejects out-of-order execution (Prize K requires Prize K+1 recorded).
                                   |
                                   v
[ Stage 2: Eligibility Review & Manual Exclusions ]
Summary: 842 Total Issued | Previous Winners Excluded | Manually Excluded | Net Eligible
Action: Review roster table, search tickets, approve audited exclusions.
                                   |
                                   v
[ Stage 3: Snapshot & Seed Commitment ]
Action: Click "Lock Roster & Commit Seed"
Display: SHA-256 Snapshot Hash & Server Seed Commitment published on screen.
                                   |
                                   v
[ Stage 3b: First Prize Two-Person Dual Control (1st Prize Only) ]
Action: SUPER_ADMIN initiates -> Distinct Admin/SUPER_ADMIN reviews snapshot & approves.
Guard: System blocks execution until two distinct valid approvals are recorded in DB.
                                   |
                                   v
[ Stage 4: Ceremony & Live Rotating Number Drum ]
Display: Projector-ready 3D cylindrical rotating drum showing candidate numbers.
Action: Click "Start Drum" -> POST /api/admin/draw/execute
Backend selects winner via CSPRNG -> Drum decelerates smoothly (8–10s) -> Lands on winner.
                                   |
                                   v
[ Stage 5: Winner Review & Governed Manual Notification ]
Display: Winner Details Card (Ticket #, Winner Name, Phone, Email, Attributed Seller).
Action: Admin reviews verification details -> Clicks "Notify Winner".
Outbox enqueues transactional email/WhatsApp job with unique idempotency key.
```

### 10.2 Rotating Number Drum UX Architecture

1. **High-Density Cylindrical Barrel Display:**
   With 500–1,000+ eligible tickets, traditional pie-wheel slices become illegible slivers. The approved **Rotating Number Drum** displays a dynamic cylindrical 3D barrel showing 20–30 visible ticket cards centered around a focal cursor line.
2. **Decoupled Server Authority:**
   The client makes an API call to `/api/admin/draw/execute` immediately upon pressing "Start Drum". The server computes the winner via CSPRNG and returns `{ ticket_number: "SSFI-000421", selection_index: 318 }` within 200–400ms. The drum animation initiates its spinning acceleration, cycles candidate numbers, and applies an 8.5-second cubic-bezier deceleration curve (`cubic-bezier(0.15, 0.9, 0.25, 1.0)`) to lock squarely on `SSFI-000421`.
3. **Refresh & Replay Safety:**
   The frontend possesses **zero authority** to select a winner. If an operator refreshes (`F5`), reloads, or disconnects during the animation, the backend has already committed the result to `public.draw_results`. On remounting, the page detects that the prize draw is complete, displays the confirmed winner card, and provides an optional *"Replay Drum Animation"* button. Replaying the animation always lands on the identical pre-committed winner; it can never trigger a re-draw.

### 10.3 Manual Winner Notification Architecture

1. **No Automated Delivery on Draw Commit:**
   In compliance with Decision 4, the draw execution transaction commits the winner but does **not** automatically dispatch external emails or messages. This prevents premature disclosures, unverified notifications, or embarrassing leaks if a technical error occurred.
2. **Review & Dispatch Flow:**
   - The Admin Draw Control Center displays the winner profile (customer name, phone, email, order reference, seller attribution).
   - An authorized Administrator verifies the winner contact details and clicks `Notify Winner`.
   - The action invokes `adminNotifyWinnerAction(resultId)`.
   - The server creates an outbox job in `public.customer_email_outbox` with `eventType = 'WINNER_ANNOUNCED'` and deterministic idempotency key `WINNER_ANNOUNCED:${draw_result_id}`.
   - An append-only audit log entry (`WINNER_NOTIFICATION_REQUESTED`) is recorded.
   - Subsequent clicks detect the existing outbox job, preventing duplicate emails.

### 10.4 Public Winner Verification

The existing public verification endpoint `/verify/[ticketNumber]` will be enhanced:
- If the ticket won a prize, it prominently displays a **Gold Winner Badge**:
  - Prize Title (e.g., `1st Prize — ₹10,000 Cash`).
  - Draw Execution Date (`19 December 2026, 18:30 IST`).
  - Cryptographic Verification Digest (Snapshot Hash + Seed Commitment).
  - Direct link to the public draw audit log.
- Customer personal PII (email, phone, address) is **strictly withheld** from the public verification page to ensure privacy compliance.

---

## 11. Threat Model & Mitigations

| Threat Vector | Severity | Attack Scenario | Mitigation in Design |
| :--- | :---: | :--- | :--- |
| **T-01: Client Tampering** | **CRITICAL** | Attacker modifies JavaScript to send their ticket ID as the winner. | **Zero Client Authority:** Server rejects any client-submitted ticket; winner is selected server-side via CSPRNG inside PostgreSQL transaction. |
| **T-02: Modulo Bias** | **HIGH** | Using `Math.random() * N` or `% N` skews probability toward lower indices. | **Node.js `crypto.randomInt`:** Employs kernel CSPRNG and mathematical rejection sampling to eliminate modulo bias. |
| **T-03: Seed Grinding** | **HIGH** | Corrupt admin clicks "Spin", sees undesirable winner, refreshes and spins again. | **Single-Shot Row Locks & Unique Constraints:** `unique(draw_id, prize_id)` rejects second attempt. Seed commitment is pre-locked in DB. |
| **T-04: Duplicate Wins** | **CRITICAL** | Same ticket wins 5th Prize and later wins 1st Prize. | **DB Constraint `UNIQUE(campaign_id, ticket_id)`:** Hard PostgreSQL engine check blocks duplicate wins; snapshot query automatically filters previous winners. |
| **T-05: Post-Draw DB Tampering**| **CRITICAL** | Malicious DB admin runs `UPDATE draw_results SET ticket_id = ...`. | **Trigger `trg_protect_draw_results_immutability`:** Blocks all `UPDATE` and `DELETE` on `draw_results`. |
| **T-06: Sneak-In Tickets** | **MEDIUM** | Admin adds a friend's ticket after seeing favorable odds. | **SHA-256 Snapshot Digest:** Roster is locked with an immutable SHA-256 hash before seed reveal. Any ticket addition invalidates the hash. |
| **T-07: Concurrent Double Spin**| **HIGH** | Two admins hit "Spin" simultaneously on two laptops. | **PostgreSQL `FOR UPDATE` Row Lock:** First transaction locks the prize row; second transaction encounters `23505 Unique Violation` and halts. |
| **T-08: Sequence Bypass** | **HIGH** | Admin attempts to draw Prize 1 before Prize 5 is complete. | **PostgreSQL Sequence Guard:** RPC checks that Prize $K+1$ exists in `draw_results` before allowing Prize $K$ to proceed. |
| **T-09: Self-Approval Evasion** | **CRITICAL** | Rogue SUPER_ADMIN attempts to initiate and approve their own 1st Prize draw. | **CHECK Constraint `initiator_id <> approver_id`:** Database engine rejects approval transactions where initiator and approver match. |
| **T-10: Premature Winner Leak** | **MEDIUM** | Automated system sends email to winner before admin reviews accuracy. | **Manual Outbox Dispatch:** Draw execution never enqueues emails; notification requires explicit admin review and authorization. |

---

## 12. Failure and Recovery Strategy

| Failure Scenario | Detection | Immediate System Action | Recovery Procedure |
| :--- | :--- | :--- | :--- |
| **Zero Eligible Tickets** | Pre-flight validation | Snapshot creation blocked with error: `ERR_ZERO_ELIGIBLE_TICKETS`. | Admin must inspect campaign payment approvals. |
| **Concurrent Execution** | PostgreSQL lock contention | Second transaction aborts with `23505 Unique Violation`. | Second caller receives clean `409 Conflict: Prize already drawn`. |
| **Network Loss During Spin** | Client fetch failure | Database transaction has already committed atomically. | Upon reconnect, UI fetches current state; renders completed winner. |
| **Server Crash Mid-Draw** | Transaction rollback | PostgreSQL rolls back incomplete transaction; no partial winner saved. | Snapshot remains locked; admin restarts draw sequence safely. |
| **Disqualified Ticket Selected**| DB trigger check | If ticket was voided between snapshot and draw, RPC aborts. | Admin must re-generate snapshot with voided ticket excluded. |
| **Exceptional Rerun Authorized**| Manual intervention | `SUPER_ADMIN` invokes `admin_cancel_draw_prize_with_audit`. | Original result marked `VOIDED`; reason logged to append-only audit log; new draw session created. Original result row is never deleted. |

---

## 13. Testing Strategy

The verification suite for Phase 9 must rigorously validate both statistical sanity and cryptographic guarantees:

### 13.1 Statistical Sanity Testing vs. Cryptographic Guarantees

> [!IMPORTANT]
> A Chi-Square ($\chi^2$) test confirms that an implementation produces uniform distribution over a sample set, but **cannot prove** cryptographic unpredictability. Cryptographic unpredictability is guaranteed by using the OS kernel CSPRNG (`crypto.randomInt` via BoringSSL). Both tiers of testing are required.

1. **Uniform Distribution Sanity Test ($\chi^2$ Goodness-of-Fit):**
   - Run 100,000 simulated draws over 1,000 eligible tickets.
   - Expected frequency per ticket: $\mu = 100$.
   - Calculate Chi-Square statistic: $\chi^2 = \sum \frac{(O_i - E_i)^2}{E_i}$.
   - Pass Criteria: $\chi^2$ must fall within the 99% confidence interval for 999 degrees of freedom ($888.7 < \chi^2 < 1118.9$).
2. **Modulo Bias Absence Test:**
   - Test power-of-two vs. non-power-of-two ranges (e.g., $N = 3, 7, 1000$).
   - Verify that no index has a statistically detectable excess frequency.
3. **Previous Winner Exclusion Test:**
   - Execute draw for Prize 5 $\rightarrow$ Winner: Ticket A.
   - Generate snapshot for Prize 4 $\rightarrow$ Assert Ticket A is omitted.
   - Attempt to force Ticket A into Prize 4 execution $\rightarrow$ Assert PostgreSQL `draw_results_campaign_ticket_unique` constraint aborts transaction.
4. **Snapshot Tampering Test:**
   - Lock snapshot $\rightarrow$ Attempt direct `UPDATE` or `DELETE` on `draw_snapshot_tickets` $\rightarrow$ Assert trigger raises error `23514`.
5. **Concurrent Double-Spin Test:**
   - Fire 10 simultaneous HTTP `POST` requests to execute the same prize draw.
   - Exactly 1 request must succeed with HTTP 200.
   - Exactly 9 requests must fail with HTTP 409 / constraint violation.
   - Assert `draw_results` contains exactly 1 winner record.
6. **Frontend Decoupling Test:**
   - Intercept API payload; attempt to inject `{ winning_ticket_id: "..." }`.
   - Assert server ignores client payload and returns backend-computed winner.
7. **Ascending Sequence Enforcement Test:**
   - Attempt to execute draw for Prize 1 or Prize 4 before Prize 5 is recorded $\rightarrow$ Assert PostgreSQL raises `23514 Sequence Violation`.
   - Complete Prize 5 $\rightarrow$ Assert Prize 4 now executes successfully.
8. **First Prize Two-Person Dual Control Test:**
   - Initiate Prize 1 by User A (`SUPER_ADMIN`).
   - Attempt approval by User A $\rightarrow$ Assert DB check constraint `initiator_id <> approver_id` strictly blocks self-approval.
   - Attempt execution with status `PENDING` $\rightarrow$ Assert transaction raises `42501 Dual approval required`.
   - Record approval by distinct User B (`ADMIN` / `SUPER_ADMIN`) $\rightarrow$ Assert Prize 1 executes successfully.
9. **Rotating Number Drum Replay Safety Test:**
   - Mount Drum UI after draw completion $\rightarrow$ Assert UI displays pre-committed winner.
   - Trigger "Replay Drum Animation" $\rightarrow$ Assert animation decelerates and stops squarely on the identical winner ticket without re-executing backend draw.
10. **Manual Winner Notification Idempotency Test:**
    - Execute draw $\rightarrow$ Verify zero outbox jobs created automatically.
    - Click `Notify Winner` $\rightarrow$ Assert single job created in `customer_email_outbox` with key `WINNER_ANNOUNCED:${result_id}`.
    - Repeat click $\rightarrow$ Assert existing outbox job detected and duplicate send prevented.

---

## 14. Implementation Roadmap for Phases 9B–9E

| Phase | Scope | Key Deliverables |
| :--- | :--- | :--- |
| **Phase 9B** | **Database Schema & Backend Integrity** | DDL migration package: `draw_manual_exclusions`, `draw_eligibility_snapshots`, `draw_snapshot_tickets`, `draw_approvals`, upgrades to `draws` and `draw_results`, `UNIQUE(campaign_id, ticket_id)`, sequence enforcement checks, dual-approval engine, and immutability triggers. |
| **Phase 9C** | **Eligibility Engine & Snapshot Action** | Server actions for eligibility preview, search/filter, manual exclusion management, canonical hash generation, atomic snapshot locking, and First Prize approval request/decision actions. |
| **Phase 9D** | **Secure CSPRNG Engine & Notification** | `crypto.randomInt()` CSPRNG service, Commit-Reveal protocol, `execute_draw_winner_selection` PostgreSQL stored procedure, and manual `adminNotifyWinnerAction` with Outbox integration. |
| **Phase 9E** | **Admin Control Center & Drum UX** | `/admin/draws` dashboard, multi-stage ceremony stepper (`5th → 1st`), 3D Rotating Number Drum visualizer, First Prize dual-approval review dialog, and enhanced public verification at `/verify/[ticketNumber]`. |

---

## 15. Approved Owner Decisions & Operational Directives

The following four foundational design decisions were submitted to the Owner and are **APPROVED AND FINALIZED**:

1. **Draw Sequence Ordering:**  
   **APPROVED:** Strict ascending ceremonial order **`5th → 4th → 3rd → 2nd → 1st`**. Enforced in database transactions (`execute_draw_winner_selection`). Prize $K$ cannot proceed unless Prize $K+1$ is completed and committed.
2. **First Prize Two-Person Dual Control:**  
   **APPROVED:** Initiated by `SUPER_ADMIN`, approved by a distinct authenticated user. Prohibits self-approval via database CHECK constraint (`initiator_id <> approver_id`). Cryptographically bound to the locked snapshot hash.
3. **Rotating Number Drum UX:**  
   **APPROVED:** Replaced pie-wheel with a high-density 3D Rotating Number Drum/barrel display. Decoupled animation decelerates smoothly to the backend-committed winner. Fully replay-safe and refresh-safe.
4. **Governed Manual Winner Notification:**  
   **APPROVED:** Zero automated notifications on draw completion. Winner details are reviewed by Admin, followed by an explicit `Notify Winner` action utilizing the existing transactional email outbox with idempotent deduplication.

### Approved Operational Policy Decision (Official Sign-off)

* **Decision 2 Implementation Detail — Second Approver Role Scope:**
  - **Policy A (OFFICIALLY APPROVED BY OWNER):**
    - **Initiator:** Must possess `SUPER_ADMIN` role.
    - **Approver:** Must be a distinct authenticated user possessing either `SUPER_ADMIN` or `ADMIN` role (`approver_id <> initiator_id`).
    - **Self-Approval Prohibition:** Initiator cannot approve their own request under any circumstance.
    - **Cryptographic Binding:** The approval record is strictly bound to the exact campaign ID, prize ID, draw session ID, and locked eligibility snapshot hash (`snapshot_hash`). Any change to the snapshot immediately invalidates any pending approval.
    - **Current Roster Compatibility:** Fully compatible with the existing staff roster (1 `SUPER_ADMIN`, 1 `ADMIN`); zero account promotions or privilege escalations required.
    - **Enforcement Layers:** Dual-enforced via database CHECK constraint `(approver_id IS NULL OR initiator_id <> approver_id)` AND PostgreSQL Security Definer RPC authorization check validating active roles via `public.has_role()`.

---

*Report prepared and updated for SSFI Lucky Draw Architectural Governance.*  
*File location: `docs/security/PHASE_9A_SECURE_LUCKY_DRAW_ARCHITECTURE.md` (Local documentation artifact only).*

