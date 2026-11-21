# SSFI Lucky Draw — Phase 3.3A Mobile Business Operations Implementation Report

**Date:** 2026-11-21  
**Repository:** `F:\PROJECT\Lucky Draw`  
**Flutter Project:** `F:\PROJECT\Lucky Draw\mobile`  
**Branch:** `preview/production-mirror`  
**HEAD Commit (Unchanged):** `642304442ce0a10a851a8dc2bcaba010d9a57d81`  
**Scope:** Local source-code and disposable testing implementation only (zero Preview/Production database mutations, zero Auth/role changes, zero Git commits/pushes, zero Vercel deployments).

---

## 1. Architecture & Contract Reuse Summary

Phase 3.3A extends the Phase 2/3.1 Mobile API v1 (`src/lib/auth/mobile.ts` + `mobile/lib/`) to support full **Seller Operations** and **Admin Operations** without duplicating business rules or bypassing server-side security:

1. **Authoritative Mobile Authentication & RBAC (`src/lib/auth/mobile.ts` & `src/lib/mobile/operations.ts`):**
   - Every `/api/mobile/v1/seller/*` and `/api/mobile/v1/admin/*` endpoint enforces pre-auth IP rate limiting and post-auth per-user rate limiting (`checkScopedRateLimit`), verifies the `Authorization: Bearer <jwt>` token via `authenticateMobileRequest`, enforces `profiles.is_active === true` fail-closed, and verifies authoritative database roles via `requireMobileRoles` (`public.has_role` and `sellers.is_active === true`).
2. **Existing PostgreSQL RPC & Validation Contract Reuse:**
   - **Order Creation (`POST /api/mobile/v1/seller/orders`):** Reuses `whatsappSchema` and `emailSchema` (`src/lib/validation/contact.ts`), `isFeatureEnabled("ENABLE_MAINTENANCE_MODE")`, active personal seller QR verification (`is_qr_active && qr_storage_path && upi_id`), `process_scheduled_campaign_transitions()`, 1,000-ticket campaign capacity guard, and the authoritative SQL RPC `public.create_seller_order(p_seller_id, p_name, p_whatsapp, p_email, p_quantity, p_actor)`, followed by immutable order payment destination snapshot capture (`snapshot_seller_id`, `snapshot_upi_id`, `snapshot_qr_storage_path`, etc.) and `buildUpiPaymentUri`.
   - **Manual UPI Payment Submission (`POST /api/mobile/v1/seller/orders/[orderId]/payment`):** Reuses strict seller ownership verification (`orders.seller_id = seller.id`), `PENDING_PAYMENT` state check, mandatory payment screenshot verification (`payment_screenshots`), and the authoritative SQL RPC `public.submit_manual_upi(p_order_id, p_utr, p_payer_name)`.
   - **Admin Payment Verification & Ticket Issuance (`POST /api/mobile/v1/admin/payments/[paymentId]/decision`):** Reuses the authoritative SQL RPC `public.verify_payment_and_issue(p_payment_id, p_actor)` — which atomically locks the payment, order, and active campaign (`FOR UPDATE`), verifies `amount_paise === total_amount_paise`, enforces the 1,000-ticket campaign cap, and invokes `public.issue_tickets(v_order.id)` to allocate sequential non-cycling `SSFI-XXXXXX` tickets and write `PAYMENT_VERIFIED` and `TICKET_ISSUED` audit logs — and `public.reject_payment(p_payment_id, p_actor, p_reason)`.

---

## 2. Implemented Workstreams

### Workstream 2 — Seller Operations (`mobile/lib/features/seller/` & `/api/mobile/v1/seller/*`)
- **Seller Dashboard & Operational Summary (`GET /api/mobile/v1/seller/dashboard`):**
  - Displays seller attribution (`displayName`, `sellerCode`), personal payment QR active status & UPI ID, campaign schedule/status & remaining ticket capacity (`sold / 1000`), KPI tiles (`Tickets Issued`, `Verified Collection ₹`, `Pending Verification`, `Awaiting Payment`), unread notices count, and recent own-orders.
- **Seller-Scoped Customer Lookup (`GET /api/mobile/v1/seller/customers?q=...`):**
  - Searches customers strictly within the authenticated seller's own orders (`orders.seller_id = seller.id`, matching the `seller_owns_customer` RLS boundary) and provides 1-tap auto-fill into the new order form.
- **Order Creation with Ticket Quantity (`POST /api/mobile/v1/seller/orders`):**
  - Form with customer full name, WhatsApp number, email address, quantity stepper (`1..remainingCapacity`, capped at `1,000`) and quick presets (`1, 5, 10, 20`), live INR total calculation, and inline client/server validation.
- **Manual UPI Payment Instructions & UTR Submission (`POST /api/mobile/v1/seller/orders/[orderId]/payment`):**
  - Displays seller-owned UPI Payee Name, UPI VPA, generated `upi://pay` intent URI, mandatory payment screenshot status notice, Payer Name field, and UTR / Reference input (`>= 6` chars when provided) with duplicate-submission rejection.
- **Own-Order History & Payment Status (`GET /api/mobile/v1/seller/orders` & `/seller/orders/[orderId]`):**
  - Filterable by `ALL`, `PENDING_PAYMENT`, `PAYMENT_SUBMITTED`, `TICKETS_ISSUED` + search query (`order_number`, customer, UTR), displaying payment status, rejection reasons, and issued `SSFI-XXXXXX` ticket numbers.

### Workstream 3 & 4 — Admin Operations & Ticket Issuance (`mobile/lib/features/admin/` & `/api/mobile/v1/admin/*`)
- **Collection Summary (`GET /api/mobile/v1/admin/summary`):**
  - Displays `Verified Collection ₹`, `Tickets Issued (sold / 1000)` with remaining capacity, `Pending Verification` count, `Active Sellers` count, and campaign status badge.
- **Pending Payment Queue & Order/Payment Detail (`GET /api/mobile/v1/admin/payments` & `/admin/payments/[paymentId]`):**
  - Filterable by `SUBMITTED` (default), `VERIFIED`, `FAILED`, `ALL` + search query across order number, UTR, customer, and seller code.
  - Detail review panel displays customer contact details, attributed/snapshot seller & UPI ID, UTR reference, payer name, screenshot proof status (`Uploaded` / `Missing`), seller advisory review badge/note, and issued tickets.
- **Verify / Reject Payment & `issue_tickets()` Workflow (`POST /api/mobile/v1/admin/payments/[paymentId]/decision`):**
  - **Verify Payment & Issue Tickets:** Calls `verify_payment_and_issue` → `issue_tickets()`, returning and displaying the newly allocated sequential `SSFI-XXXXXX` ticket numbers.
  - **Reject Payment:** Validates a mandatory rejection reason (`3..500` chars) and calls `reject_payment`, returning the order to `PENDING_PAYMENT`.
- **Seller / Customer / Order Directory Lookup (`GET /api/mobile/v1/admin/lookup`):**
  - Staff search across sellers (`sellerCode`, `displayName`, active/QR status), customers (`fullName`, `phone`, `whatsappNumber`, `email`), and orders (`orderNumber`, `status`, `quantity`, `totalAmountInr`, `customerName`, `sellerCode`).

---

## 3. Changed & Added File Inventory

### Backend (Next.js / TypeScript)
- `src/lib/mobile/operations.ts` *(Added — reusable, dependency-injected Seller & Admin Mobile API v1 handlers)*
- `src/app/api/mobile/v1/seller/dashboard/route.ts` *(Added — `GET /api/mobile/v1/seller/dashboard`)*
- `src/app/api/mobile/v1/seller/customers/route.ts` *(Added — `GET /api/mobile/v1/seller/customers`)*
- `src/app/api/mobile/v1/seller/orders/route.ts` *(Added — `GET` & `POST /api/mobile/v1/seller/orders`)*
- `src/app/api/mobile/v1/seller/orders/[orderId]/route.ts` *(Added — `GET /api/mobile/v1/seller/orders/[orderId]`)*
- `src/app/api/mobile/v1/seller/orders/[orderId]/payment/route.ts` *(Added — `POST /api/mobile/v1/seller/orders/[orderId]/payment`)*
- `src/app/api/mobile/v1/admin/summary/route.ts` *(Added — `GET /api/mobile/v1/admin/summary`)*
- `src/app/api/mobile/v1/admin/payments/route.ts` *(Added — `GET /api/mobile/v1/admin/payments`)*
- `src/app/api/mobile/v1/admin/payments/[paymentId]/route.ts` *(Added — `GET /api/mobile/v1/admin/payments/[paymentId]`)*
- `src/app/api/mobile/v1/admin/payments/[paymentId]/decision/route.ts` *(Added — `POST /api/mobile/v1/admin/payments/[paymentId]/decision`)*
- `src/app/api/mobile/v1/admin/lookup/route.ts` *(Added — `GET /api/mobile/v1/admin/lookup`)*
- `tests/phase3_3MobileOperations.test.ts` *(Added — 12 backend unit, RBAC, ownership-isolation, capacity, and `issue_tickets()` contract tests)*

### Mobile (Flutter / Dart)
- `mobile/lib/core/errors/app_failure.dart` *(Updated — added `ValidationFailure` and `NotFoundFailure`)*
- `mobile/lib/core/network/dio_client.dart` *(Updated — mapped HTTP `400`/`404`/`409`/`422` to typed `ValidationFailure` / `NotFoundFailure`)*
- `mobile/lib/features/auth/presentation/auth_controller.dart` *(Updated — exposed shared `mobileDioProvider` with safe Supabase client lookup)*
- `mobile/lib/features/seller/domain/seller_models.dart` *(Added)*
- `mobile/lib/features/seller/domain/seller_operations_repository.dart` *(Added)*
- `mobile/lib/features/seller/data/seller_operations_remote_datasource.dart` *(Added)*
- `mobile/lib/features/seller/data/seller_operations_repository_impl.dart` *(Added)*
- `mobile/lib/features/seller/presentation/seller_operations_controller.dart` *(Added)*
- `mobile/lib/features/seller/presentation/seller_dashboard_screen.dart` *(Updated — full Seller Operations workspace)*
- `mobile/lib/features/admin/domain/admin_models.dart` *(Added)*
- `mobile/lib/features/admin/domain/admin_operations_repository.dart` *(Added)*
- `mobile/lib/features/admin/data/admin_operations_remote_datasource.dart` *(Added)*
- `mobile/lib/features/admin/data/admin_operations_repository_impl.dart` *(Added)*
- `mobile/lib/features/admin/presentation/admin_operations_controller.dart` *(Added)*
- `mobile/lib/features/admin/presentation/admin_dashboard_screen.dart` *(Updated — full Admin Operations workspace)*
- `mobile/test/features/seller/seller_operations_test.dart` *(Added — unit, controller & widget tests for Seller Operations)*
- `mobile/test/features/admin/admin_operations_test.dart` *(Added — unit, controller & widget tests for Admin Operations & ticket issuance)*

---

## 4. Automated Verification & Regression Results

| Command | Working Directory | Result | Details |
| --- | --- | --- | --- |
| `flutter analyze` | `F:\PROJECT\Lucky Draw\mobile` | **PASS** | `No issues found!` |
| `flutter test` | `F:\PROJECT\Lucky Draw\mobile` | **PASS** | **`29 / 29 All tests passed!`** (21 foundation tests + 8 new Seller/Admin operations unit & widget tests) |
| `npm run typecheck` | `F:\PROJECT\Lucky Draw` | **PASS** | `tsc --noEmit` (`0` errors) |
| `node --test tests/phase3_3MobileOperations.test.ts` | `F:\PROJECT\Lucky Draw` | **PASS** | **`12 / 12 pass`, `0 fail`** |
| `npm test` | `F:\PROJECT\Lucky Draw` | **PASS** | **`433 / 433 pass`, `0 fail`** |

---

## 5. Strict Scope & Safety Confirmation

- Zero Preview or Production database mutations.
- Zero Supabase Auth account or role changes.
- Zero Git commits, pushes, merges, or branch switches.
- Zero Vercel deployments or environment configuration changes.
- Zero real ticket issuances, payment verifications, draw executions, or notifications.
- All pre-existing uncommitted workspace changes preserved.
