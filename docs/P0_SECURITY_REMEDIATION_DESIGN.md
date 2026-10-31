# SSFI Lucky Draw — P0 Security Remediation Design
## Architecture & Implementation Specification

**Document Version:** 1.1.0  
**Status:** VALIDATED ON PREVIEW  
**Location:** `docs/P0_SECURITY_REMEDIATION_DESIGN.md`  
**Working Branch:** `deploy/ssfi-homepage-preview`  
**Preview Reference:** `jiyuiydzsfydjklosvvq`  
**Production Reference:** `fohpqheglxhfdecadhzw` (Protected)  

---

## 1. Executive Summary & Confirmed Vulnerability Inventory

An exhaustive static and dynamic security audit of the Supabase PostgreSQL database schema, migrations, permission grants, and Next.js server actions revealed four critical security issues and permission drifts in the SSFI Lucky Draw system.

All four findings stem from two overlapping root causes:
1. **Trusting Caller-Supplied Identity in Privileged Functions:** Functions marked `SECURITY DEFINER` accepting actor UUIDs without asserting `auth.uid() = p_actor` or verifying that the executing database session is `service_role`.
2. **Blanket Permissions Drift in Helper Scripts:** `supabase/grant_permissions.sql` contained broad grants (`grant select, insert, update on all tables ... to authenticated;` and `grant execute on all routines ... to authenticated;`) which inadvertently re-granted full execution and mutation rights over functions and tables intended to be locked down by earlier migrations.

### Vulnerability Classification Matrix

| Finding | Component | Current State | Root Cause | Impact | Classification |
|---|---|---|---|---|---|
| **P0-1** | `public.verify_payment_and_issue(p_payment_id, p_actor)` | `SECURITY DEFINER`, `EXECUTE` granted to `authenticated` & `service_role`. Checks `is_staff(p_actor)`. | Does not check `p_actor = auth.uid()` or session role. | Any authenticated user knowing a staff member's UUID can execute this RPC via PostgREST/Supabase client, verifying arbitrary payments and issuing tickets. | **VERIFIED** |
| **P0-2** | `public.issue_tickets(p_order_id)` | `SECURITY DEFINER`, `EXECUTE` granted to `authenticated` & `service_role`. | Independent invocation not restricted to `service_role` or internal caller. | Although protected by payment status checks (`VERIFIED`), direct invocation bypasses staff verification and audit logging in `verify_payment_and_issue`. | **VERIFIED** |
| **P0-3** | `public.seller_messages` | Table-wide `INSERT` and `UPDATE` granted to `authenticated`. | Blanket grants in `grant_permissions.sql` and permissive RLS policies. | Malicious authenticated seller or customer could mutate message text, backdate timestamps, alter `sender_profile_id`, forge admin messages, or alter parent message references. | **VERIFIED** |
| **P0-4a** | `public.create_seller_order(...)` | `SECURITY DEFINER`, `EXECUTE` granted to `authenticated`. | Blanket grants in `grant_permissions.sql`. | Allows direct creation of seller-attributed orders without passing through Next.js server validation or inventory safety checks. | **VERIFIED** |
| **P0-4b** | `public.process_scheduled_campaign_transitions()` | `SECURITY DEFINER`, `EXECUTE` granted to `authenticated`. | Blanket routine grants. | Any authenticated user could trigger campaign status state machine transitions out-of-band. | **VERIFIED** |
| **P0-4c** | `public.is_staff(p_user_id)` | Accepts arbitrary `p_user_id`, readable by `authenticated`. | Lack of caller bounding. | Allows an authenticated user to brute-force or enumerate all staff/admin user UUIDs in the database. | **VERIFIED** |

---

## 2. Complete Application Caller Paths & Verification Trace

```
========================================================================================
APPLICATION INVOCATION TOPOLOGY
========================================================================================

Browser / Client-Side
       │
       │ (1) HTTPS Server Action POST (Cookie Session)
       ▼
Next.js Server Actions (Node.js runtime)
  ├── src/server/actions/operations.ts  ───> requireAnyRole(...) + requireAuth(...)
  ├── src/server/actions/publicOrder.ts ───> rateLimit() + schema validation
  ├── src/server/actions/messages.ts    ───> requireStaffRole(...) / requireSellerRole(...)
  └── /api/cron/campaign-schedule       ───> Bearer CRON_SECRET verification
       │
       │ (2) createSupabaseAdminClient() with SUPABASE_SERVICE_ROLE_KEY
       ▼
Supabase PostgreSQL Database
  └── Executes with session role: "service_role" (auth.role() = 'service_role')
```

### Trace Details by Function

#### 1. `public.verify_payment_and_issue(p_payment_id uuid, p_actor uuid) returns setof public.tickets`
- **Application Callers:**
  - `src/server/actions/operations.ts` (`verifyPayment` at line ~279):
    ```typescript
    await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);
    const user = await requireAuth();
    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc("verify_payment_and_issue", {
      p_payment_id: paymentId.data,
      p_actor: user.id,
    });
    ```
- **Browser/Client Callers:** **ZERO**. There is no direct `supabase.rpc("verify_payment_and_issue")` in any client component or page.
- **Architectural Consequence:** Revoking `EXECUTE` from `public`, `anon`, and `authenticated` will cause **zero breakage** to the Next.js application, because `createSupabaseAdminClient()` connects with the `service_role` key.

#### 2. `public.issue_tickets(p_order_id uuid) returns setof public.tickets`
- **Application Callers:** **ZERO**.
  - `issue_tickets` is called exclusively *internally* inside `public.verify_payment_and_issue`:
    ```sql
    return query select * from public.issue_tickets(v_order.id);
    ```
- **Architectural Consequence:** `issue_tickets` does not need to be exposed to `authenticated` or `anon`. Since `verify_payment_and_issue` is `SECURITY DEFINER` (owned by `postgres`), it can execute `issue_tickets` even when `issue_tickets` is strictly restricted to `service_role` and `postgres`.

#### 3. `public.seller_messages`
- **Application Callers in `src/server/actions/messages.ts`:**
  - `sendAdminSellerMessage`: Uses `createSupabaseAdminClient()` (`service_role`).
  - `sendSellerToAdminMessage`: Uses `createSupabaseAdminClient()` (`service_role`).
  - `replyAdminToSellerMessage`: Uses `createSupabaseAdminClient()` (`service_role`).
  - `markSellerMessageAsRead`: Uses `createSupabaseAdminClient()` (`service_role`).
  - `markAdminMessageAsRead`: Uses `createSupabaseAdminClient()` (`service_role`).
- **Application Readers in UI:**
  - `src/app/admin/sellers/[id]/messages/page.tsx`: Uses `createSupabaseAdminClient()`.
  - `src/app/seller/messages/page.tsx`: Uses `createSupabaseAdminClient()`.
  - `src/app/seller/layout.tsx`: Uses `createSupabaseAdminClient()`.
- **Browser/Client Callers:** **ZERO**. All operations flow through server actions using the admin client (`service_role`).
- **Architectural Consequence:** Restricting table-level `INSERT` and `UPDATE` on `public.seller_messages` has **zero negative impact** on application messaging functionality.

#### 4. `public.create_seller_order(uuid, text, text, text, integer)`
- **Application Callers:**
  - `src/server/actions/operations.ts` (`createSale` at line 135): Uses `currentSellerId()` (server session) and `createSupabaseAdminClient()`.
  - `src/server/actions/publicOrder.ts` (`createPublicCustomerOrder` at line 152): Uses validated seller referral lookup and `createSupabaseAdminClient()`.
- **Browser/Client Callers:** **ZERO**.

#### 5. `public.process_scheduled_campaign_transitions()`
- **Application Callers:**
  - `src/app/api/cron/campaign-schedule/route.ts`: Authenticated with `CRON_SECRET`, uses `createSupabaseAdminClient()`.
  - `src/server/actions/campaign.ts`: Uses `createSupabaseAdminClient()`.
  - `src/server/actions/operations.ts`: Uses `createSupabaseAdminClient()`.
  - `src/server/actions/publicOrder.ts`: Uses `createSupabaseAdminClient()`.
- **Database Callers:** Internal call inside `create_seller_order`, and pg_cron scheduler.
- **Browser/Client Callers:** **ZERO**.

---

## 3. Detailed Remediation Implementation

See `supabase/migrations/202610300001_p0_security_remediation.sql` and `supabase/grant_permissions.sql` for complete SQL scripts and rollback procedures.

