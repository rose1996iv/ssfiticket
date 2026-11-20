# SSFI Lucky Draw — Phase 2A: Backend API Audit for Flutter Android

**Date:** 2026-11-20  
**Repository:** `F:\PROJECT\Lucky Draw`  
**Branch:** `preview/production-mirror` (`f15d6a45d2ea1ef150aa85f65d7242940a5dbe8d`)  
**Scope:** Strictly READ-ONLY source, migration, and architecture audit (Preview ref `jiyuiydzsfydjklosvvq`; Production `fohpqheglxhfdecadhzw` untouched)  
**Final Verdict:** **`CONDITIONAL PASS`**

---

## 1. Executive Summary

The SSFI Lucky Draw backend (Next.js App Router + Supabase PostgreSQL/Auth/Storage/Realtime) has a **strong security core** at the database layer: Row Level Security (RLS) is enabled on all **28 tables**, role enumeration is blocked in `public.has_role` and `public.is_staff` (`202610300001`), First Prize dual authorization is enforced via immutable `initiator_role_at_request` triggers and `SECURITY DEFINER` RPCs (`202611200001`), and all critical state-changing RPCs (`verify_payment_and_issue`, `issue_tickets`, `execute_draw_winner_selection`, etc.) are restricted to `service_role` only.

However, the backend is **not yet ready for direct Flutter Android consumption** without a targeted **Phase 2B** implementation because:
1. **No Mobile REST/JSON API Layer:** Only **4 HTTP API routes** exist under `src/app/api/`. Virtually all application business logic lives in **18 Next.js Server Actions** (`src/server/actions/*.ts`), which Flutter cannot call directly.
2. **Cookie-Only Authentication:** `src/lib/auth/server.ts` and `src/lib/supabase/server.ts` authenticate strictly via Next.js `cookies()`, with no `Authorization: Bearer <jwt>` support.
3. **No Authenticated `CUSTOMER` Role Yet:** `public.roles` currently permits only `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`, and `SELLER`. Customers currently use anonymous checkout + 64-character order access tokens (`payment_recovery_tokens`).
4. **High-Severity Security Gaps Must Be Closed Before Mobile Exposure:**
   - Unauthenticated `service_role` access in `src/server/actions/whatsappDelivery.ts` (**CRITICAL**).
   - Direct-table write RLS (`FOR ALL` / `UPDATE`) granted to `authenticated` staff on `system_settings`, `campaigns`, `prizes`, `profiles`, `draws`, `draw_results`, `draw_eligibility_snapshots`, `draw_snapshot_tickets`, `draw_manual_exclusions`, and `draw_randomness_evidence` (**HIGH**) — a mobile JWT could bypass Next.js Server Actions via PostgREST.
   - Latent column bug (`user_id` vs `profile_id`) in `src/lib/security/orderAccessToken.ts:380` breaking seller order authorization (**HIGH**).
   - Realtime publication (`supabase_realtime`) is not codified in SQL migrations (**MEDIUM**).

---

## 2. Existing Backend Architecture

| Layer | Current Implementation | Flutter Compatibility |
|---|---|---|
| **Runtime & Framework** | Next.js App Router (`next.config.ts`, `bodySizeLimit: 4mb`), deployed on Vercel (`ssfiticket`). No `src/middleware.ts` or `src/proxy.ts`. | HTTP Route Handlers (`/api/mobile/v1/*`) are ideal; Server Actions are **not** callable by Flutter. |
| **Database & Auth** | Supabase PostgreSQL (28 tables, 26 migrations, 72 functions/versions, RLS enabled on all 28 tables) + Supabase Auth (`auth.users` → `public.profiles` via `handle_new_user` trigger). | Flutter `supabase_flutter` SDK works natively for Auth, Storage signed URLs, and Realtime. |
| **Application Logic** | 18 Next.js Server Action modules (`src/server/actions/*.ts`) invoking `createSupabaseAdminClient()` (`service_role`) after `requireRole` / `requireAnyRole` checks. | Must extract shared service functions (`src/server/services/*`) callable by both Server Actions and `/api/mobile/v1/*` Route Handlers. |
| **HTTP API Routes** | 4 routes (`/api/admin/export`, `/api/cron/campaign-schedule`, `/api/order-access/exchange`, `/api/tickets/[ticketNumber]/qr`). | Only `/api/tickets/[ticketNumber]/qr` is directly reusable by Flutter as-is. |
| **Rate Limiting** | `src/lib/security/rateLimit.ts` (Upstash Redis REST pipeline with in-memory fallback), currently applied **only** to order access token verification (`10/IP`, `30/order` per 15 min). | Must be generalized into a reusable mobile API rate limiter (fail-closed in production when Redis is configured). |
| **Email & Delivery** | `customer_email_outbox` + Google Apps Script HMAC provider (Phase 1 hardened) + manual WhatsApp Click-to-Chat (`wa.me`). | Mobile can query delivery status via `/api/mobile/v1/email-status` and open `wa.me` intents natively. |

---

## 3. Existing API Route Inventory

| Method | Endpoint | Auth Requirement | Required Role | Request Params | Response Structure | Error Handling | Rate Limiting | Data Exposure / Reuse Assessment |
|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/admin/export` (`src/app/api/admin/export/route.ts`) | Cookie session (`getCurrentUser()`) | Staff (`is_staff`: `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`) + `ENABLE_DETAILED_AUDIT_EXPORT` flag | Query: `resource` (`dashboard\|payments\|orders\|tickets\|customers\|sellers`), `format` (`xlsx\|csv\|pdf\|json`), optional `status` | Binary file attachment (`xlsx`, `csv`, `pdf`, `json`) with `Cache-Control: no-store`; capped at 5,000–10,000 rows | `401`, `403`, `400`, `500` (**Note:** `500` returns raw `details: errorObj?.message`) | **None** | **Risk:** No rate limit; exports bulk customer PII; raw DB error message returned on `500`. **Flutter Reuse:** Reusable only after adding Bearer JWT support + rate limiting. |
| `GET`, `POST` | `/api/cron/campaign-schedule` (`src/app/api/cron/campaign-schedule/route.ts`) | `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret` (mandatory in `NODE_ENV=production`) | System / Cron only | None | JSON `{ success, processedAt, transitionCount, transitions }` | `401`, `500` (returns `details: error.message`) | **None** | **Flutter Reuse:** **Do NOT expose to Flutter** (internal infrastructure cron). |
| `GET` | `/api/order-access/exchange` (`src/app/api/order-access/exchange/route.ts`) | 64-char hex order access token | Public / Customer token holder | Query: `orderId` (UUID), `token` (64-hex) | `303` redirect to `/buy/order/<orderId>` setting `HttpOnly; Secure; SameSite=Lax` cookie (`ssfi_order_access_<orderId>`, 7d) | `303` redirect with `?error=...`; sets `Referrer-Policy: no-referrer`, `no-store`, `noindex` | **Yes** (`checkOrderAccessRateLimit`: 10/IP, 30/order / 15m) | **Flutter Reuse:** **Not suitable for Flutter** (browser cookie redirect flow). Flutter should pass order token via header (`X-Order-Access-Token`) or authenticated Customer JWT. |
| `GET` | `/api/tickets/[ticketNumber]/qr` (`src/app/api/tickets/[ticketNumber]/qr/route.ts`) | Public (none) | Public / All roles | Path: `ticketNumber` (`/^[A-Z0-9-]{4,32}$/`) | `image/png` (`Cache-Control: public, max-age=86400, immutable`, `X-Content-Type-Options: nosniff`) | `400`, `500` (sanitized JSON) | **None** (CDN-cacheable) | **Zero PII / zero UUIDs / zero DB lookup.** **Flutter Reuse:** **Directly reusable as-is** (or Flutter can render QR locally using `qr_flutter` from `/verify/<ticketNumber>`). |

---

## 4. Authentication & RBAC Assessment

### 4.1 Authentication Lifecycle (`src/server/actions/auth.ts`, `src/lib/auth/server.ts`)
- **Login:** Uses `supabase.auth.signInWithPassword({ email, password })`. For `SELLER` users, verifies `sellers.is_active` and calls `supabase.auth.signOut()` if deactivated (`auth.ts:56-71`).
- **Logout:** Calls `supabase.auth.signOut()` (`auth.ts:79-83`). Does not explicitly pass `{ scope: 'global' }` vs `{ scope: 'local' }` for multi-device revocation.
- **Password Recovery:** **Not implemented** in the web app (`src/app/` has only `login/page.tsx` and `unauthorized/page.tsx`; zero calls to `resetPasswordForEmail` or `updateUser`).
- **Session Refresh:** Handled implicitly on web via `@supabase/ssr` cookie store; **no `src/middleware.ts`** currently refreshes sessions on navigation.
- **Expired & Revoked Sessions:**
  - `getCurrentUser()` calls `supabase.auth.getUser()` (server-verified against Supabase Auth, **not** trusting unverified local JWT claims — good practice).
  - Deactivated sellers are banned via `admin.auth.admin.updateUserById(seller.profile_id, ...)` in `src/server/actions/seller.ts:358,454`, which revokes refresh tokens, **but** already-issued access JWTs remain valid until expiry (default 1 hour) unless the backend also checks `profiles.is_active` / `sellers.is_active` on every mobile API request.
- **Flutter Token Handling Requirements:**
  1. Authenticate directly via `supabase_flutter` (`Supabase.instance.client.auth.signInWithPassword` / OTP / PKCE deep-link for password reset).
  2. Persist session refresh token **exclusively** in hardware-backed `flutter_secure_storage` (Android Keystore / EncryptedSharedPreferences; disable Android Auto Backup `android:allowBackup="false"`).
  3. Send `Authorization: Bearer <access_token>` to `/api/mobile/v1/*`.
  4. Next.js mobile auth helper (`requireMobileAuth(request)`) must validate the Bearer JWT via `supabase.auth.getUser(token)` (never `jwt.decode` alone), then verify `profiles.is_active = true` and query authoritative DB roles via `public.has_role`.
  5. On `401`, Dio interceptor performs a single serialized `supabase.auth.refreshSession()` retry; on refresh failure, clears secure storage and navigates to `/login`.

### 4.2 Authoritative RBAC Model
Authoritative roles live in **`public.roles`** and **`public.profile_roles`** (never trusting `user_metadata` or `app_metadata`):
- Seeded roles (`202610270001_phase2_core.sql:14,87`): `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`, `SELLER`.
- **`CUSTOMER` role:** **Does not exist yet** in `public.roles` (`CHECK` constraint blocks inserting `'CUSTOMER'` without a migration). `public.customers.profile_id` (`uuid unique references public.profiles(id)`) and `public.owns_customer(p_customer_id)` already exist in the schema (`202610270001_phase2_core.sql:22,42`), providing a clean additive path for authenticated Flutter Customers!

### 4.3 Role Enforcement Matrix (Server Actions & DB RPCs)

| Operation | `SUPER_ADMIN` | `ADMIN` | `SELLER` | `CUSTOMER` | Enforcement Layer |
|---|---|---|---|---|---|
| Permanently delete seller (`permanentlyDeleteSeller`) | Allowed | Blocked | Blocked | Blocked | Server Action (`requireRole("SUPER_ADMIN")`) |
| Initiate 1st Prize Approval (`requestFirstPrizeApproval`) | Allowed | Blocked | Blocked | Blocked | Server Action + DB RPC (`admin_request_first_prize_approval`) + Trigger (`protect_draw_approvals_initiator_role`) |
| Approve/Reject 1st Prize (`recordFirstPrizeApproval`) | Allowed (if `≠ initiator`) | Allowed (if `≠ initiator`) | Blocked | Blocked | Server Action + DB RPC (`admin_record_first_prize_approval`, enforces `initiator_id <> approver_id`) |
| Execute 1st Prize Draw (`executePrizeDraw`) | Allowed (with dual auth) | Allowed (with dual auth) | Blocked | Blocked | Server Action + DB RPC (`execute_draw_winner_selection`, verifies `initiator_role_at_request = 'SUPER_ADMIN'` & independent active `ADMIN`/`SUPER_ADMIN` approver) |
| Execute Prizes 5→2, Lock Snapshot, Exclusions | Allowed | Allowed | Blocked | Blocked | Server Action (`requireAnyRole(["SUPER_ADMIN", "ADMIN"])`) + DB RPC (`is_staff`) |
| Customer Master Contact / Single Ticket Override | Allowed (audited) | Allowed (audited) | Blocked | Blocked | Server Action (`requireAnyRole(["SUPER_ADMIN", "ADMIN"])`) |
| Email Settings / Live Gate / Retry / Test | Allowed | Allowed | Blocked | Blocked | Server Action (`requireAnyRole(["SUPER_ADMIN", "ADMIN"])`) — **Gap:** `system_settings` RLS allows `FUNDRAISING_MANAGER` direct `UPDATE` |
| Campaign Schedule / Status | Allowed | Allowed | Blocked | Blocked | Server Action (`requireAnyRole(["SUPER_ADMIN", "ADMIN"])`) — **Gap:** `campaigns` RLS allows `FUNDRAISING_MANAGER` direct write |
| Verify / Reject Payment & Issue Tickets | Allowed | Allowed | Blocked (advisory review only) | Blocked | Server Action + DB RPC (`verify_payment_and_issue`, `reject_payment`, `service_role` only) |
| Void / Reissue Ticket | Allowed | Allowed | Blocked | Blocked | Server Action + DB RPC (`admin_void_ticket`, `admin_reissue_ticket`, `service_role` only) |
| Seller Direct Sale / Payment QR / Seller Review | Blocked | Blocked | Allowed (active seller) | Blocked | Server Action (`requireRole("SELLER")`) |
| Public Order Creation / UPI Submission | Public | Public | Public | Public | Server Action (`publicOrder.ts`) + order access token (`payment_recovery_tokens`) |
| WhatsApp Delivery Prep & Confirmation (`whatsappDelivery.ts`) | **UNAUTH BUG** | **UNAUTH BUG** | **UNAUTH BUG** | **UNAUTH BUG** | **CRITICAL GAP:** No `requireAuth` / role / ownership check before `createSupabaseAdminClient()` reads PII & mutates `ticket_deliveries`! |

---

## 5. Supabase RLS & RPC Security Assessment

### 5.1 Strengths
- **100% RLS Coverage:** All 28 tables in `public` have `ENABLE ROW LEVEL SECURITY`.
- **Anti-Enumeration on `has_role` & `is_staff` (`202610300001`):** `SECURITY DEFINER`, `SET search_path = ''`, returns `false` unless caller is `service_role`, checking their own `auth.uid()`, or an authenticated `SUPER_ADMIN`/`ADMIN`.
- **Service-Role-Only Critical RPCs:** `verify_payment_and_issue`, `reject_payment`, `issue_tickets`, `create_seller_order`, `submit_manual_upi`, `admin_void_ticket`, `admin_reissue_ticket`, `admin_lock_eligibility_snapshot`, `admin_request_first_prize_approval`, `admin_record_first_prize_approval`, `execute_draw_winner_selection`, `admin_stamp_winner_notification`, and campaign scheduler RPCs all revoke `EXECUTE` from `PUBLIC`, `anon`, and `authenticated`, granting only to `service_role`.
- **Public Draw Hardening (`202611140003`):** Direct `anon` `SELECT` on `draws`, `draw_results`, and `draw_randomness_evidence` was revoked; public spectators use `get_public_draw_winners(text)` (`TICKET_NUMBER_ONLY`, `EXECUTED` draws only, zero PII, zero internal UUIDs).
- **Draw Approvals Hardening (`202611200001`):** `public.draw_approvals` revoked `INSERT, UPDATE, DELETE` from `authenticated`, allowing `SELECT`-only for staff and forcing all mutations through `SECURITY DEFINER` RPCs + `protect_draw_approvals_initiator_role` trigger.
- **Immutability Triggers:** Enforced on `tickets` (no delete, immutable identity/lineage), `seller_messages` (only `read_at`/`archived_at` mutable), `orders` (payment destination snapshot immutable), `audit_logs` & `payment_events` (revoked `INSERT, UPDATE, DELETE` from `anon, authenticated`).

### 5.2 Cross-Role / Direct PostgREST Leakage & Over-Permission Risks
If Flutter uses the Supabase client directly with an authenticated JWT, the following existing RLS policies are **too permissive**:
1. **Direct Write Access to Operational & Draw Tables for `is_staff` (`HIGH`):**
   - `public.draws`, `public.draw_results`, `public.draw_manual_exclusions`, `public.draw_eligibility_snapshots`, `public.draw_snapshot_tickets`, `public.draw_randomness_evidence` still have `FOR ALL TO authenticated USING (public.is_staff(auth.uid()))` and `GRANT INSERT, UPDATE, DELETE TO authenticated` (`202610270001:80`, `202611080001`). A compromised or malicious `ADMIN` or `FUNDRAISING_MANAGER` JWT could call PostgREST directly to bypass `execute_draw_winner_selection` or `admin_lock_eligibility_snapshot`!
   - `public.system_settings` grants `UPDATE` to `authenticated` for `is_staff` (`202611010001:75-89`), allowing `FUNDRAISING_MANAGER` to toggle `customer_email_live_enabled` directly via PostgREST.
   - `public.campaigns`, `public.prizes`, and `public.profiles` grant `FOR ALL TO authenticated` for `is_staff` (`202610270001:76-79`), bypassing `SUPER_ADMIN`/`ADMIN`-only checks in `campaign.ts` and profile integrity rules.
2. **Seller `verifyOrderAccess` Column Bug (`HIGH`):**
   - `src/lib/security/orderAccessToken.ts:380` queries `sellers.eq("user_id", user.id)` instead of `sellers.eq("profile_id", user.id)`.
3. **Unauthenticated WhatsApp Server Actions (`CRITICAL`):**
   - `src/server/actions/whatsappDelivery.ts:15,119,199` uses `service_role` without checking `requireAuth` or verifying staff/seller ownership, exposing customer name, phone, WhatsApp number, email, and ticket numbers for any known `orderId` UUID and allowing unauthenticated status forgery in `ticket_deliveries`.
4. **Customer Data Isolation for Future `CUSTOMER` Role (`MEDIUM`):**
   - `customers_access`, `orders_access`, `payments_access`, and `tickets_access` already scope authenticated customer reads via `public.owns_customer(customer_id)` (`customers.profile_id = auth.uid()`). Once `CUSTOMER` accounts are linked to `customers.profile_id`, cross-customer isolation is enforced at the RLS layer — **provided** `customers.profile_id` linking is strictly server-verified (e.g., via verified email/phone OTP match, never self-assigned by client).

---

## 6. Realtime Readiness

### 6.1 Current State
- **Public Draw Spectators (`PublicDrawWinnersSection.tsx` + `src/lib/draw/realtimeBroadcast.ts`):** **Production-grade.** Emits a strictly validated, PII-free, UUID-free `draw_executed` broadcast on `ssfi-public-winners-<campaignPublicId>` **only** after confirmed PostgreSQL commit; clients then refetch certified winners via `get_public_draw_winners`.
- **Admin Draw Dashboard (`LuckyDrawDashboard.tsx:115-139`):** Subscribes to `postgres_changes` on `draw_results`, `draw_eligibility_snapshots`, and `draw_approvals` filtered by `campaign_id`, with reconnect catch-up (`hadDisconnectRef` + online/visibility refresh).
- **Critical Gap:** **Zero `ALTER PUBLICATION supabase_realtime` statements exist in `supabase/migrations/*.sql`.** Publication membership is currently unmanaged/manual, and none of `orders`, `payments`, `tickets`, `customer_email_outbox`, `sellers`, or `seller_messages` are codified for Realtime.

### 6.2 Secure Flutter Realtime Subscription Plan

| Event Domain | Recommended Mechanism | Channel / Topic & Authorization | Payload Rule (Zero PII Leakage) |
|---|---|---|---|
| **Draw Progress (Public & Customer)** | Supabase Realtime **Broadcast** (already built) | `ssfi-public-winners-<campaignPublicId>` (public) | Minimal `{ event_version, campaign_public_id, prize_number, draw_completed, occurred_at }` → client refetches `get_public_draw_winners` |
| **Draw Progress (Admin/Super Admin)** | Supabase Realtime **Private Broadcast** or RLS-backed `postgres_changes` | `ssfi-admin-draw-<campaignId>` (staff JWT verified) | Signal-only `{ entity, id, action, occurred_at }` → client refetches `/api/mobile/v1/dashboard` or draw overview |
| **New Orders & Payment Status Changes** | **Signal-Only Broadcast** emitted post-commit from backend (or RLS-scoped `postgres_changes` on `orders`/`payments`) | Staff: `private:staff:orders`; Seller: `private:seller:<sellerId>:orders`; Customer: `private:customer:<profileId>:orders` | Emit `{ order_id, status, updated_at }` only; never broadcast UTR, phone, or email in Realtime frames |
| **Ticket Issuance & Email Delivery Status** | **Signal-Only Broadcast** emitted after `issue_tickets` / outbox status transition | Staff: `private:staff:email-status`; Seller/Customer: own order channel | Emit `{ order_id, event_type, status, updated_at }` → client fetches `/api/mobile/v1/tickets` or `/api/mobile/v1/email-status` |
| **Member / Seller Changes** | **Signal-Only Broadcast** on `private:staff:members` | Staff only (`SUPER_ADMIN` / `ADMIN`) | Emit `{ entity: 'seller'|'member', id, action }` → refetch paginated list |

**Reconnection & Backgrounding (Android):**
- Listen to Flutter `AppLifecycleState.resumed` and `connectivity_plus` reconnect events.
- On `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`, or resume from background, call `supabase.realtime.setAuth(currentAccessToken)` after refreshing any expired JWT, re-subscribe, and execute a REST catch-up query (`updated_after` cursor) so no events are missed while the Android app was Doze-suspended.
- Use **Firebase Cloud Messaging (FCM)** data/notification pushes for background/terminated app alerts (payment verified, tickets issued, new seller message, 1st Prize approval requested), never relying on persistent WebSockets in background.

---

## 7. Proposed Mobile API Contract (`/api/mobile/v1/`)

All routes below are **proposed for Phase 2B** (none exist today).

### 7.1 Global Conventions
- **Base Path:** `/api/mobile/v1`
- **Authentication:** `Authorization: Bearer <supabase_access_token>` (validated server-side via `supabase.auth.getUser(jwt)` + active profile check). Optional `X-Order-Access-Token` header for anonymous customer order lookup if needed.
- **Content-Type:** `application/json; charset=utf-8` (except multipart screenshot/QR uploads).
- **Idempotency:** Mutating `POST` endpoints accept `Idempotency-Key` header (UUIDv4).
- **Pagination (Cursor-based preferred for mobile):** Query `?cursor=<opaque_base64>&limit=20` (default `20`, max `50`). Response envelope:
  ```json
  {
    "data": [...],
    "pagination": { "nextCursor": "opaque_or_null", "hasMore": true, "limit": 20 }
  }
  ```
- **Standard Error Envelope (Sanitized — never expose raw PostgreSQL/stack details):**
  ```json
  {
    "error": {
      "code": "FORBIDDEN | UNAUTHORIZED | VALIDATION_ERROR | NOT_FOUND | CONFLICT | RATE_LIMITED | INTERNAL_ERROR",
      "message": "Human-readable safe message",
      "details": [{ "field": "quantity", "issue": "Must be between 1 and 100" }],
      "requestId": "req_..."
    }
  }
  ```

### 7.2 Endpoint Specifications

| Endpoint | Method(s) | Permitted Roles | Request Schema | Response Schema | Pagination & Validation | Error Codes |
|---|---|---|---|---|---|---|
| `/api/mobile/v1/me` | `GET`, `PATCH` | `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`, `SELLER`, `CUSTOMER` | `PATCH`: `{ fullName?, phone?, fcmToken?, devicePlatform? }` | `{ user: { id, email, fullName, phone, isActive }, roles: string[], sellerProfile?: { id, sellerCode, displayName, isActive, isQrActive }, capabilities: { canRequestFirstPrize, canApproveFirstPrize, canDeleteSeller, canVerifyPayments, canManageEmailSettings } }` | Zod strict schema; never allows role or `isActive` self-mutation | `401`, `403` (deactivated), `422` |
| `/api/mobile/v1/dashboard` | `GET` | All authenticated roles (role-scoped payload) | Query: `?campaignPublicId=ssfi-fundraising-lucky-draw` | **Staff:** campaign quota, verified revenue, pending payments count, active sellers, email outbox health, draw progress.<br>**Seller:** own sales count, pending reviews, issued tickets, QR activation status, unread messages.<br>**Customer:** active campaign status, own order/ticket summary, public draw winners. | Non-paginated aggregate; validated `campaignPublicId` slug | `401`, `403`, `404` |
| `/api/mobile/v1/orders` | `GET`, `POST` | `GET`: All roles (Staff=all, Seller=own `seller_id`, Customer=own `customer_id`).<br>`POST`: `SELLER` (direct sale), `CUSTOMER` (self-order) | `GET`: `?status=&sellerId=&search=&cursor=&limit=`<br>`POST`: `{ campaignPublicId, quantity (1..100), customerName, whatsappNumber (E.164 7-15 digits), email, sellerCode? }` | `GET`: Paginated `OrderSummary[]`<br>`POST` (`201`): `{ order: { id, orderNumber, status, quantity, totalAmountPaise, paymentQrSignedUrl? } }` | Cursor pagination (`max 50`); Zod validation + E.164 phone + active campaign window check | `400`, `401`, `403`, `409` (quota/closed), `422`, `429` |
| `/api/mobile/v1/orders/:orderId` | `GET` | Staff (all), Seller (owning `seller_id`), Customer (owning `customer_id`) | Path: `orderId` (UUID) | Detailed order, payment status, screenshot signed URL (short-lived 5m), issued tickets, collaboration notes (Staff/Seller only) | UUID validation | `401`, `403`, `404` |
| `/api/mobile/v1/tickets` | `GET` | All roles (Staff=all, Seller=own orders, Customer=own tickets) | Query: `?status=ISSUED\|VOID\|REFUNDED&orderId=&search=&cursor=&limit=` | Paginated `TicketDto[]`: `{ id, ticketNumber, status, issuedAt, orderNumber, verificationUrl, qrImageUrl }` | Cursor pagination (`max 50`); strict enum validation | `401`, `403`, `422` |
| `/api/mobile/v1/tickets/:ticketId/void` & `/reissue` | `POST` | `SUPER_ADMIN`, `ADMIN` | `{ reason: string (min 5, max 300) }` | `{ ticket, replacementTicket?, auditEventId }` | Delegates to `admin_void_ticket` / `admin_reissue_ticket` RPCs | `401`, `403`, `404`, `409`, `422` |
| `/api/mobile/v1/email-status` | `GET`, `POST` (`/:jobId/retry`) | `GET`: `SUPER_ADMIN`, `ADMIN` (full outbox); `SELLER` (own orders' delivery status summary only — no body/errors).<br>`POST retry`: `SUPER_ADMIN`, `ADMIN` | `GET`: `?status=&orderId=&eventType=&cursor=&limit=`<br>`POST`: `{}` (idempotent) | `GET`: Paginated `{ id, orderId, eventType, recipientMasked, status, attemptCount, maxAttempts, sentAt, provider, updatedAt }`<br>`POST`: `{ jobId, status }` | Cursor pagination (`max 50`); enforces Preview allowlist unconditionally | `401`, `403`, `404`, `409`, `429` |
| `/api/mobile/v1/members` | `GET`, `PATCH` (`/:customerId`) | `SUPER_ADMIN`, `ADMIN` (read & audited contact override); `SELLER` (read own customers only) | `GET`: `?search=&cursor=&limit=`<br>`PATCH`: `{ fullName?, phone?, whatsappNumber?, email?, reason }` | Paginated `MemberDto[]` with ticket count & order count (no raw secrets/tokens) | Cursor pagination (`max 50`); `PATCH` requires mandatory audit `reason` | `401`, `403`, `404`, `422` |
| `/api/mobile/v1/sellers` | `GET`, `POST`, `PATCH` (`/:sellerId`), `DELETE` (`/:sellerId`) | `GET`: `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`.<br>`POST`/`PATCH`: `SUPER_ADMIN`, `ADMIN`.<br>`DELETE` (permanent): **`SUPER_ADMIN` ONLY** | `GET`: `?isActive=&qrActive=&search=&cursor=&limit=`<br>`POST`: `{ fullName, email, phone, displayName }`<br>`PATCH`: `{ isActive?, isQrActive?, reason }` | Paginated `SellerDto[]`: `{ id, sellerCode, displayName, isActive, isQrActive, upiId, salesCount, verifiedRevenuePaise }` | Cursor pagination (`max 50`); enforces `SUPER_ADMIN` check for `DELETE` | `401`, `403`, `404`, `409`, `422` |
| `/api/mobile/v1/payments` | `GET`, `POST` (`/:orderId/submit`, `/:paymentId/verify`, `/:paymentId/reject`, `/:paymentId/seller-review`) | `GET`: Staff (all), Seller (own), Customer (own).<br>`submit`: `CUSTOMER`/`SELLER`.<br>`seller-review`: `SELLER` (own).<br>`verify`/`reject`: `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER` | `GET`: `?status=PENDING\|SUBMITTED\|VERIFIED\|FAILED&cursor=&limit=`<br>`submit`: `{ utrReference?, payerName?, screenshotPath }`<br>`verify`: `{}`<br>`reject`: `{ reason }` | `GET`: Paginated `PaymentDto[]`<br>`verify`: `{ paymentStatus, orderStatus, ticketsIssued[] }` (triggers transactional email outbox) | Cursor pagination (`max 50`); `verify`/`reject` delegate exclusively to `verify_payment_and_issue` / `reject_payment` RPCs | `400`, `401`, `403`, `404`, `409`, `422`, `429` |
| `/api/mobile/v1/notifications` | `GET`, `POST` (`/register-device`), `PATCH` (`/:id/read`) | All authenticated roles (scoped strictly to `auth.uid()`) | `GET`: `?unreadOnly=&cursor=&limit=`<br>`POST`: `{ fcmToken, deviceId, platform: 'android' }` | Paginated `NotificationDto[]`: `{ id, type, title, body, entityType, entityId, readAt, createdAt }` | Cursor pagination (`max 50`); device tokens stored hashed/scoped per `profile_id` | `401`, `403`, `404`, `422` |

---

## 8. Flutter Integration Architecture

### 8.1 Recommended Stack & Layering
- **State Management:** **Riverpod (`flutter_riverpod` + `riverpod_annotation`)** — strict separation of `authStateProvider`, `currentUserRoleProvider`, feature `AsyncNotifier`s, and automatic cache invalidation on logout/role switch.
- **Navigation & RBAC Guards:** **GoRouter** — declarative route trees (`/super-admin/*`, `/admin/*`, `/seller/*`, `/customer/*`, `/public/*`) with `redirect` guards driven by `authStateProvider` + server-fetched `/api/mobile/v1/me` capabilities (UX routing only; backend always re-enforces authorization).
- **HTTP Networking:** **Dio** — configured with:
  - `AuthInterceptor`: injects `Authorization: Bearer <accessToken>` from Supabase session; serializes 401 refresh retries via a single `Completer` lock to prevent refresh-token storms.
  - `IdempotencyInterceptor`: attaches `Idempotency-Key` (UUIDv4) on mutating `POST` requests.
  - `ErrorMappingInterceptor`: maps standard API error envelopes to typed Dart `AppFailure` sealed classes.
  - Certificate pinning (optional for Production release) + TLS 1.2+ only (`android:usesCleartextTraffic="false"`).
- **Authentication & Token Storage:** **Supabase Auth (`supabase_flutter`)** with custom `LocalStorage` adapter backed by **`flutter_secure_storage`** (Android Keystore + `EncryptedSharedPreferences`), plus `android:allowBackup="false"` in `AndroidManifest.xml`.
- **Realtime:** **Supabase Realtime (`supabase_flutter`)** subscribing only to signal-only channels (public `ssfi-public-winners-<campaignPublicId>` + role-scoped private channels), triggering Riverpod `ref.invalidate(...)` on event arrival and lifecycle resume.
- **Push Notifications:** **Firebase Cloud Messaging (`firebase_messaging`)** — registers device token via `POST /api/mobile/v1/notifications/register-device` on login and revokes on logout; deep-links taps via GoRouter (e.g., `/orders/:id`, `/tickets`).

### 8.2 Backend Boundary: Next.js API vs Direct Supabase Client

| Operation Category | Use Next.js `/api/mobile/v1/*` | Use Supabase Client Directly (Under RLS) | Rationale |
|---|---|---|---|
| **Login, Token Refresh, Logout, Password Reset** | No (except `/me` profile/role bootstrap) | **Yes** (`supabase_flutter` Auth) | Native PKCE, refresh rotation, and Auth lifecycle handled securely by Supabase Auth. |
| **Order Creation, Payment Submission, Verify/Reject, Ticket Void/Reissue** | **Yes (Mandatory)** | **No** | Requires `service_role` RPCs, rate limiting, audit logging, and outbox email triggering. |
| **Lucky Draw (Snapshot Lock, 1st Prize Dual Auth, Draw Execution)** | **Yes (Mandatory)** | **No** | Requires sealed-seed cryptography, dual-auth enforcement, and post-commit Realtime broadcast. |
| **Seller Account Provisioning, Activation, Deletion, QR Activation** | **Yes (Mandatory)** | **No** | Requires Supabase Auth Admin API (`updateUserById`), `SUPER_ADMIN` checks, and audit logs. |
| **Email Outbox Retries & Settings** | **Yes (Mandatory)** | **No** | Requires HMAC Apps Script dispatch, Preview allowlist guard, and `ADMIN`/`SUPER_ADMIN` checks. |
| **Public Draw Winners Read** | Optional | **Yes** (`rpc('get_public_draw_winners')`) | Hardened `SECURITY DEFINER` public DTO RPC returning `TICKET_NUMBER_ONLY` with zero PII. |
| **Realtime Subscriptions** | N/A (emits broadcasts) | **Yes** (`supabase_flutter` Realtime) | Signal-only broadcasts / RLS-scoped subscriptions; never carry PII in Realtime frames. |
| **Payment Screenshots & Seller QRs** | **Yes** (request short-lived signed URL / upload validation) | **No** (no public bucket reads) | Private storage buckets; server validates magic bytes and enforces role/order ownership before signing URLs. |

---

## 9. Security Risks & Severity Matrix

| ID | Severity | Finding | Location | Required Remediation (Phase 2B) |
|---|---|---|---|---|
| **RISK-2A-01** | **CRITICAL** | Unauthenticated `service_role` reads of customer PII and writes to `ticket_deliveries` / `audit_logs` in WhatsApp Server Actions | `src/server/actions/whatsappDelivery.ts:15,119,199` | Require authenticated staff (`is_staff`) or owning active `SELLER` (verifying `order.seller_id`) before reading/mutating. |
| **RISK-2A-02** | **HIGH** | Direct-table write RLS (`FOR ALL` / `UPDATE`) for `authenticated` `is_staff` on `system_settings`, `campaigns`, `prizes`, `profiles`, `draws`, `draw_results`, `draw_manual_exclusions`, `draw_eligibility_snapshots`, `draw_snapshot_tickets`, `draw_randomness_evidence` | `202610270001:76-80`, `202611010001:75-89`, `202611080001` | Mirror Phase 10B (`draw_approvals`) hardening: revoke `INSERT, UPDATE, DELETE` from `authenticated` on sensitive operational/draw tables and route all writes through `service_role` RPCs / Next.js API. |
| **RISK-2A-03** | **HIGH** | Latent column mismatch (`sellers.eq("user_id", user.id)` instead of `profile_id`) breaks seller authorization in `verifyOrderAccess` | `src/lib/security/orderAccessToken.ts:380` | Change `.eq("user_id", user.id)` to `.eq("profile_id", user.id)` and add unit test coverage. |
| **RISK-2A-04** | **HIGH** | Cookie-only auth (`getCurrentUser`, `createSupabaseServerClient`); no Bearer JWT auth helper or `/api/mobile/v1/*` routes | `src/lib/auth/server.ts`, `src/lib/supabase/server.ts` | Build `src/lib/auth/mobile.ts` validating `Authorization: Bearer <jwt>` via `supabase.auth.getUser(jwt)` + `profiles.is_active` + `has_role`. |
| **RISK-2A-05** | **MEDIUM** | `supabase_realtime` publication membership is unmanaged in migrations; no private broadcast channels for orders/payments/tickets/email | `supabase/migrations/*`, `LuckyDrawDashboard.tsx:115-139` | Codify Realtime publication and/or private signal-only broadcast helpers in Phase 2B. |
| **RISK-2A-06** | **MEDIUM** | No rate limiting on `/api/admin/export` or future mobile endpoints; raw DB error messages leaked in 500 responses (`export/route.ts:352`, `cron/route.ts:57`) | `src/app/api/admin/export/route.ts:352`, `src/lib/security/rateLimit.ts` | Generalize Upstash rate limiter for mobile auth/write/export endpoints; sanitize 500 error bodies. |
| **RISK-2A-07** | **LOW** | No `CUSTOMER` role in `public.roles`, no password recovery flow, no `device_push_tokens` table for FCM | `202610270001:14,87`, `src/app/login/page.tsx` | Additive migration adding `'CUSTOMER'` to `public.roles`, `device_push_tokens` table (RLS self-only), and password recovery deep-link support. |

---

## 10. Phase 2B Implementation Roadmap

1. **Step 1 — Security Pre-Requisites (Preview Migration + Code Fix):**
   - Fix `RISK-2A-01` (`whatsappDelivery.ts` auth/ownership guard) and `RISK-2A-03` (`orderAccessToken.ts` `profile_id` fix).
   - Apply additive Preview migration tightening direct-table `authenticated` write grants (`RISK-2A-02`), adding `CUSTOMER` role to `public.roles`, creating `public.device_push_tokens` (RLS `profile_id = auth.uid()`), and codifying Realtime publication.
2. **Step 2 — Shared Service Layer & Mobile Auth Core:**
   - Implement `src/lib/auth/mobile.ts` (Bearer JWT verification via `getUser(jwt)`, `profiles.is_active` / `sellers.is_active` check, `has_role` RBAC helpers, standard error envelope, and generalized rate limiter).
   - Extract domain services from `src/server/actions/*` into `src/server/services/*` so web Server Actions and `/api/mobile/v1/*` share identical validation and business rules.
3. **Step 3 — Implement `/api/mobile/v1/*` Endpoints:**
   - Sprint A: `/me`, `/dashboard`, `/orders`, `/orders/:id`, `/tickets`, `/payments`.
   - Sprint B: `/email-status`, `/members`, `/sellers`, `/notifications`, plus draw endpoints (preserving Phase 10B First Prize dual authorization).
4. **Step 4 — Realtime Signal Broadcasts & FCM Integration:**
   - Emit post-commit signal-only broadcasts for order/payment/ticket/email transitions and integrate FCM push dispatch for background Android alerts.
5. **Step 5 — Automated Security & Contract Verification:**
   - Unit + integration test suite covering cross-role 403s (`CUSTOMER` → `SELLER`/`ADMIN`/`SUPER_ADMIN`), deactivated-user JWT rejection, pagination bounds, rate limiting, PII-free error envelopes, and First Prize dual-auth parity.

---

## 11. Audit Metadata, Verification & Boundary Confirmation

- **Exact Inspected Files:**
  - API Routes: `src/app/api/admin/export/route.ts`, `src/app/api/cron/campaign-schedule/route.ts`, `src/app/api/order-access/exchange/route.ts`, `src/app/api/tickets/[ticketNumber]/qr/route.ts`
  - Auth, Security & Supabase: `src/lib/auth/server.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase/config.ts`, `src/lib/supabase/admin.ts`, `src/lib/security/rateLimit.ts`, `src/lib/security/orderAccessToken.ts`, `src/lib/draw/realtimeBroadcast.ts`, `next.config.ts`
  - Server Actions & UI: `src/server/actions/auth.ts`, `src/server/actions/whatsappDelivery.ts`, `src/server/actions/sellerPaymentSettings.ts`, automated guard inventory across all 18 files in `src/server/actions/*.ts`, `src/components/admin/draw/LuckyDrawDashboard.tsx`, `src/components/home/PublicDrawWinnersSection.tsx`
  - SQL Migrations: Automated full-inventory scan of all 26 files in `supabase/migrations/*.sql`, with direct line-level inspection of `202610270001_phase2_core.sql`, `202610300001_p0_security_remediation.sql`, `202611010001_customer_email_outbox.sql`, `202611080001_phase9c_lucky_draw_foundation.sql`, `202611140003_phase_b2_public_rls_hardening.sql`, and `202611200001_phase_10b_initiator_role_and_approval_hardening.sql`
- **Tests Executed:** None executed during Phase 2A (read-only audit; baseline from Phase 1 commit `f15d6a4` is `433 / 433` tests passing and `0` typecheck errors).
- **Blockers:** No blockers to completing the audit; Phase 2B implementation is gated on resolving `RISK-2A-01` through `RISK-2A-04` before any Flutter client connects to Preview.
- **Strict Safety Boundary Confirmation:** Confirmed — **zero** project source files, environment variables, databases (Preview or Production), Auth accounts, roles, tickets, payments, emails, Git history, or deployments were modified. Only this audit report (`reports/phase-2a-api-audit/PHASE_2A_BACKEND_API_AUDIT.md`) was created.
