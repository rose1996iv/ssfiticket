# SSFI Lucky Draw — Production Remediation Report

**Date**: 31 October 2026  
**Auditor & Remediation Lead**: Senior Full-Stack Engineer & Release Manager  
**Branch**: `deploy/ssfi-homepage-preview`  
**Base Commit**: `626d0e8`  

---

## Remediation Overview

This report documents all code-level remediations executed during the Production Readiness Audit to ensure strict fail-closed security, database enum compatibility, template elegance, and navigation completeness.

---

### Remediation 1: Production Fail-Closed Mock Payment Gate

- **Risk Level**: **HIGH (P1)**
- **Problem Identified**: `isMockPaymentMode()` evaluated `process.env.NEXT_PUBLIC_MOCK_PAYMENTS === "true"` before checking the environment. If `NEXT_PUBLIC_MOCK_PAYMENTS="true"` was inadvertently set in Vercel Production environment variables, the system would have enabled mock payment submission on the production domain.
- **Affected Files**:
  1. `src/lib/config/payment.ts`
  2. `src/server/actions/publicOrder.ts`
  3. `src/server/actions/operations.ts`
- **Remediation Details**:
  - In `src/lib/config/payment.ts`, added an absolute fail-closed check at the top of `isMockPaymentMode()`:
    ```typescript
    if (
      process.env.VERCEL_ENV === "production" ||
      process.env.NEXT_PUBLIC_VERCEL_ENV === "production"
    ) {
      return false;
    }
    ```
  - In `src/server/actions/publicOrder.ts` and `src/server/actions/operations.ts`, added explicit `!isProd` guards around test UTR parsing:
    ```typescript
    const isProd =
      process.env.VERCEL_ENV === "production" ||
      process.env.NEXT_PUBLIC_VERCEL_ENV === "production";
    if (manualUpiConfig.isMock && !isProd) {
      // test reference logic
    }
    ```
- **Verification**: Verified in `tests/productionReadiness.test.ts` that when `VERCEL_ENV="production"`, `isMockPaymentMode()` returns `false` even if `NEXT_PUBLIC_MOCK_PAYMENTS="true"`.

---

### Remediation 2: Production Customer Email Delivery Fail-Closed Hardening

- **Risk Level**: **MEDIUM (P2)**
- **Problem Identified**:
  - In `src/lib/delivery/service.ts`, `isSimulated` was computed as `isDev || !hasLiveEmail`. In Production without live credentials, `isSimulated` would have been set to `true`, causing ticket deliveries to be logged as `TICKET_DELIVERY_SIMULATED`.
  - In `src/lib/delivery/templates.ts`, the `simulationBanner` did not check the deployment environment, allowing the `"Development Mode Notice"` to potentially render in production customer emails.
- **Affected Files**:
  1. `src/lib/delivery/service.ts`
  2. `src/lib/delivery/templates.ts`
- **Remediation Details**:
  - In `src/lib/delivery/service.ts`, decoupled `isProduction` from `isDev`:
    ```typescript
    const isProduction =
      process.env.VERCEL_ENV === "production" ||
      process.env.NEXT_PUBLIC_VERCEL_ENV === "production";
    const isDev = !isProduction && (process.env.NODE_ENV !== "production" || isVercelPreview);
    ...
    isSimulated: !isProduction && (isDev || !hasLiveEmail),
    ```
  - In `src/lib/delivery/templates.ts`, suppressed `simulationBanner` in Production:
    ```typescript
    const isProduction =
      process.env.VERCEL_ENV === "production" ||
      process.env.NEXT_PUBLIC_VERCEL_ENV === "production";

    const simulationBanner =
      !isProduction && payload.isSimulated
        ? `...`
        : ``;
    ```
- **Verification**: Tested in `tests/productionReadiness.test.ts` that `renderEmailTicketMessage` omits the banner whenever `VERCEL_ENV="production"`.

---

### Remediation 3: WhatsApp Action Status & PostgreSQL Enum Compatibility

- **Risk Level**: **MEDIUM (P2)**
- **Problem Identified**:
  - `recordWhatsAppOpenedAction` and `recordWhatsAppManuallySentAction` previously attempted to update `ticket_deliveries.status` to `"WHATSAPP_LINK_OPENED"` and `"MANUALLY_SENT"`.
  - The PostgreSQL column `status` on `ticket_deliveries` is strictly typed as enum `public.delivery_status` (`'PENDING'`, `'SENT'`, `'DELIVERED'`, `'FAILED'`, `'SIMULATED'`).
  - Attempting to set unlisted enum values causes PostgreSQL error `22P02: invalid input value for enum delivery_status`.
  - In addition, manual Click-to-Chat (`wa.me`) confirmation must not claim automated delivery (`DELIVERED` is reserved for automated webhooks); it must use supported enum `SENT` with `metadata.manual_send_confirmed = true`.
- **Affected Files**:
  1. `src/server/actions/whatsappDelivery.ts`
  2. `src/lib/delivery/types.ts`
  3. `src/components/delivery/WhatsAppTicketDeliveryButton.tsx`
  4. `src/components/admin/OrderDeliveryCard.tsx`
- **Remediation Details**:
  - In `src/server/actions/whatsappDelivery.ts`:
    - Enforced order status guard: only orders in `TICKETS_ISSUED` status can have WhatsApp deliveries recorded or confirmed.
    - `recordWhatsAppOpenedAction`: Updates `last_attempt_at`, preserves existing manual confirmation if chat is re-opened, and stores `metadata.whatsapp_action = "WHATSAPP_LINK_OPENED"`.
    - `recordWhatsAppManuallySentAction`: Checks if `metadata.manual_send_confirmed` is already true and returns `{ success: true, alreadyConfirmed: true }` idempotently. Transitions status to valid enum `SENT` (never writing `DELIVERED`), sets `metadata.manual_send_confirmed = true`, and sets `metadata.whatsapp_action = "MANUALLY_CONFIRMED"`.
  - In `src/lib/delivery/types.ts`:
    - Updated `formatDeliveryStatusLabel` to map:
      - `channel === "WHATSAPP"` with `PENDING` -> `"Click-to-Chat Prepared"`.
      - `metadata.whatsapp_action === "WHATSAPP_LINK_OPENED"` -> `"WhatsApp Link Opened"`.
      - `metadata.manual_send_confirmed === true` or `whatsapp_action === "MANUALLY_CONFIRMED"` -> `"Manually Confirmed Sent"`.
      - `channel === "EMAIL"` with `SENT` -> `"API Accepted"` (never claiming guaranteed inbox delivery).
  - In `src/components/delivery/WhatsAppTicketDeliveryButton.tsx`:
    - Updated button labels to `"Open WhatsApp Chat (Free)"` and secondary confirmation button to `"Confirm Manually Sent"`.
    - Updated badge label to `"Manually Confirmed Sent"`.
  - In `src/components/admin/OrderDeliveryCard.tsx`:
    - Updated card header to `"Ticket Distribution & Delivery — {orderNumber}"`.
    - Labeled WhatsApp as `wa.me Manual Chat` with note: `Manual Click-to-Chat transmission without automated delivery receipts.`
    - Labeled Email as `Gmail API` with status `"API Accepted"`.
- **Verification**: Verified in `tests/productionReadiness.test.ts` with comprehensive unit tests for link opened, manual confirmation, duplicate confirmation idempotency, invalid status transitions, and enum compatibility.

---

### Remediation 4: Creation of Dedicated `/verify` Public Index Portal

- **Risk Level**: **LOW (P3 / UX Enhancement)**
- **Problem Identified**: Navigating directly to `https://ssfiticket.vercel.app/verify` resulted in an HTTP 404 because only dynamic parameter route `src/app/verify/[ticketNumber]/page.tsx` existed.
- **Affected File Created**:
  - `src/app/verify/page.tsx`
- **Remediation Details**:
  - Built an interactive search portal in `src/app/verify/page.tsx` featuring:
    - Official SSFI logo and branding.
    - Autocapitalized ticket number input (e.g. `SSFI-000001`).
    - Server action redirect to `/verify/[ticketNumber]`.
    - Notice informing users of real-time database verification.
    - Return to homepage link.
- **Verification**: Verified Next.js route registration during Turbopack build and tested HTTP 200 on live preview deployment.

---

### Remediation 5: Production Readiness Test Suite

- **Affected File Created**:
  - `tests/productionReadiness.test.ts`
- **Registered In**:
  - `package.json` (`npm test`)
- **Tests Implemented**:
  1. `Area 1: isMockPaymentMode fail-closed guard in Production`
  2. `Area 1: Official UPI credentials and support details are production-accurate`
  3. `Area 3: Email delivery templates suppress simulation banner in Production`
  4. `Area 4: WhatsApp confirmation template formatting and links`
  5. `Area 4: formatDeliveryStatusLabel accurately formats labels across channels and actions`
  6. `Area 4: WhatsApp Click-to-Chat semantics and valid enum usage`
  7. `Area 4: WhatsApp transition state machine validation`
- **Verification**: All tests pass, bringing the full test suite total to **210 passed tests**.

---

### Remediation 6: Campaign Schedule Status Synchronization

- **Risk Level**: **MEDIUM (P2)**
- **Problem Identified**:
  - In `src/lib/date/timezone.ts`, `evaluateCampaignSchedule` checked `campaign.status === "ACTIVE"` before evaluating timestamps. If campaign had status `"UPCOMING"` or `"LIVE"`, it fell through to default `"CLOSED"`.
  - In `src/app/buy/page.tsx`, `src/app/seller/page.tsx`, and `src/app/seller/orders/new/page.tsx`, the raw `campaign?.status` (which was `"ACTIVE"` in the DB) was passed to `<CampaignCountdown>`, causing the server-rendered view to render `ACTIVE` even while the evaluated schedule was `UPCOMING` prior to 1 November 2026.
- **Affected Files**:
  1. `src/lib/date/timezone.ts`
  2. `src/app/buy/page.tsx`
  3. `src/app/seller/page.tsx`
  4. `src/app/seller/orders/new/page.tsx`
- **Remediation Details**:
  - In `src/lib/date/timezone.ts`: Updated `evaluateCampaignSchedule` to accept `status === "ACTIVE" || status === "UPCOMING" || status === "LIVE"`.
  - In `buy/page.tsx`, `seller/page.tsx`, and `seller/orders/new/page.tsx`: Replaced raw `campaign?.status` props passed to `<CampaignCountdown>` with evaluated `schedule.scheduleStatus` (`"UPCOMING"`).
- **Verification**: Verified that Countdown renders cleanly in `UPCOMING` state, counting down to 1 November 2026 00:00 IST across all views.

---

### Remediation 7: Database Preflight IPv6 Root Cause Resolution & Migration Preflight Standards

- **Risk Level**: **HIGH (P1 Operational / Migration Safety)**
- **Problem Identified**:
  - Earlier attempts to execute `supabase migration list --linked` or `supabase db push --dry-run` failed with:
    `DbConfigIpv6Error: IPv6 is not supported on your current network`
  - Root Cause: Supabase CLI direct database connections attempt to resolve direct PostgreSQL port 5432 over IPv6. On local development workstations without native IPv6 routing, the connection is refused. In contrast, the HTTPS PostgREST / Admin API client operates seamlessly over IPv4.
  - Earlier reports mistakenly suggested using the pooler port 6543 (which is the Transaction Pooler, intended for short-lived client traffic, and does not support session-level features or multi-statement DDL migrations) and assumed which migrations were pending.
- **Remediation Details**:
  - Clarified database connection standards based on official Supabase documentation:
    1. **Direct Connection**: Preferred for database migrations and administration when direct IPv6/IPv4 connectivity is available.
    2. **Session Pooler (Port 5432)**: Uses Port 5432, supports IPv4, preserves session state and prepared statements, and is compatible with schema migrations and administrative commands.
    3. **Transaction Pooler (Port 6543)**: Intended for short-lived client queries; does NOT support session-level features or multi-statement DDL migrations.
    4. **Connection String Guidance**: Never guess or construct pooler hosts based on project region. The owner must copy the exact Session Pooler connection string (Port 5432) from the Supabase Dashboard.
  - Documented that because CLI commands failed due to IPv6 routing, **remote migration history is NOT verified**, and the **exact set of pending Production migrations is NOT established**. The owner must perform a read-only audit using the Session Pooler before executing any migrations.
- **Verification**: Formally documented in `PRODUCTION_MIGRATION_PREFLIGHT.md`.

---

### Remediation 8: Ticket Allocation Atomicity, Sequence Monotonicity & Rollback Audit

- **Risk Level**: **CRITICAL (P0 Data Integrity)**
- **Problem Identified**: Requirement to mathematically prove ticket issuance integrity, concurrent order protection, rollback behavior, and gap handling.
- **Audit & Architectural Distinctions**:
  - In `supabase/migrations/202610270001_phase2_core.sql` and `202610300001_p0_security_remediation.sql`:
    1. **Atomic Ticket Issuance**: All database mutations (verifying payment, decrementing campaign capacity, creating ticket rows, and updating order status) execute inside a single PostgreSQL function (`verify_payment_and_issue`) within an atomic ACID transaction (`BEGIN ... COMMIT`).
    2. **Duplicate Ticket Prevention**: Absolute duplicate prevention is strictly enforced by unique database constraints: `PRIMARY KEY (id)`, `UNIQUE(ticket_number)`, and `UNIQUE(order_id, ticket_number)`.
    3. **Capacity Enforcement**: Campaign capacity is strictly enforced under row-level lock (`SELECT * FROM campaigns WHERE id = ... FOR UPDATE`), preventing overselling.
    4. **Sequence Monotonicity**: Sequence values minted via `nextval('ssfi_ticket_number_sequence')` are strictly monotonically increasing.
    5. **Gapless Numbering (Not Guaranteed by PostgreSQL Sequences)**: Standard PostgreSQL sequence values consumed by `nextval()` are **never rolled back or reclaimed** when a transaction aborts. Therefore, a standard PostgreSQL sequence **cannot guarantee gapless ticket numbering**. If an error, timeout, or constraint violation causes a transaction to abort after `nextval()` is called, that sequence number is permanently skipped.
    6. **Architectural Path for Gapless Numbering**: If strict gapless numbering is a confirmed business requirement, an architectural redesign using a transactional counter table/row (e.g., `campaign_counters` row locked with `SELECT current_counter FROM campaign_counters WHERE campaign_id = ... FOR UPDATE` in a serializable transaction) is required. **This architectural change is NOT implemented in the current release to avoid heavy lock contention, and must NOT be applied without explicit owner approval.** The current implementation maintains atomic issuance, capacity limits, and duplicate prevention.
- **Verification**: Verified against PostgreSQL system catalog behaviors and transaction isolation mechanics.

---

## Test & Build Verification Summary

| Verification Step | Command | Result |
|---|---|---|
| Automated Tests | `npm test` | **210 / 210 PASS** (2.02s across 16 test suites) |
| TypeScript Compiler | `npm run typecheck` | **0 errors** (`tsc --noEmit` exit code 0) |
| ESLint Code Quality | `npm run lint` | **0 warnings / 0 errors** (exit code 0) |
| Next.js Production Build | `npm run build` | **30 routes compiled cleanly** (Turbopack, 1336ms) |

All remediations are strictly confined to `deploy/ssfi-homepage-preview`. Production Supabase (`fohpqheglxhfdecadhzw`) and the `main` branch remain completely untouched.

