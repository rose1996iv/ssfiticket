# SSFI Lucky Draw — Phase 3.3A API Contract & Feature Gap Report

**Date:** 2026-11-21  
**Repository:** `F:\PROJECT\Lucky Draw`  
**Branch:** `preview/production-mirror` (`642304442ce0a10a851a8dc2bcaba010d9a57d81`)  

---

## 1. Existing Contracts Reused Without Modification

| Workflow | Existing Backend / Database Contract Reused | Location |
| --- | --- | --- |
| Mobile Bearer JWT Authentication & Authoritative RBAC | `authenticateMobileRequest`, `requireMobileRoles`, `public.has_role`, `sellers.is_active` | `src/lib/auth/mobile.ts` |
| Distributed Rate Limiting | `checkScopedRateLimit`, `getClientIpFromHeaders` | `src/lib/security/rateLimit.ts` |
| Customer Contact Validation | `whatsappSchema`, `emailSchema` | `src/lib/validation/contact.ts` |
| Campaign Schedule & Window Evaluation | `evaluateCampaignSchedule`, `formatIstDateTime`, `process_scheduled_campaign_transitions()` | `src/lib/date/timezone.ts`, `supabase/migrations/202610290003_phase7_campaign_auto_scheduler.sql` |
| Seller Manual Order Creation & Immutable Payment Snapshot | `public.create_seller_order(p_seller_id, p_name, p_whatsapp, p_email, p_quantity, p_actor)` + `trg_protect_order_payment_snapshot` | `supabase/migrations/202610300001_p0_security_remediation.sql`, `202611020001_seller_qr_and_mandatory_screenshots.sql` |
| Manual UPI URI Generation | `buildUpiPaymentUri`, `manualUpiConfig` | `src/lib/payment/upi.ts`, `src/lib/config/payment.ts` |
| Manual UPI Reference (UTR) Submission | `public.submit_manual_upi(p_order_id, p_utr, p_payer_name)` | `supabase/migrations/202611020001_seller_qr_and_mandatory_screenshots.sql` |
| Payment Verification & Atomic Ticket Issuance | `public.verify_payment_and_issue(p_payment_id, p_actor)` → `public.issue_tickets(p_order_id)` (`1,000` cap, sequential `SSFI-XXXXXX`, audit logs) | `supabase/migrations/202610300001_p0_security_remediation.sql`, `202610270001_phase2_core.sql` |
| Payment Rejection | `public.reject_payment(p_payment_id, p_actor, p_reason)` | `supabase/migrations/202610300001_p0_security_remediation.sql` |

---

## 2. Mobile API Bridge Added in Local Source (`src/app/api/mobile/v1/*`)

Because the web application originally exposed Seller and Admin operations through cookie-authenticated Next.js Server Actions (`src/server/actions/operations.ts`) that end with `redirect()`, and Phase 2A (`202611200002_phase_2b2_direct_write_rls_hardening.sql`) revoked direct table writes from `anon` and `authenticated` roles, Phase 3.3A adds JSON Route Handlers under `src/app/api/mobile/v1/` backed by `src/lib/mobile/operations.ts`:

- `GET /api/mobile/v1/seller/dashboard`
- `GET /api/mobile/v1/seller/customers?q=<query>`
- `GET /api/mobile/v1/seller/orders?status=<status>&q=<query>`
- `POST /api/mobile/v1/seller/orders`
- `GET /api/mobile/v1/seller/orders/[orderId]`
- `POST /api/mobile/v1/seller/orders/[orderId]/payment`
- `GET /api/mobile/v1/admin/summary`
- `GET /api/mobile/v1/admin/payments?status=<status>&q=<query>&sellerId=<id>`
- `GET /api/mobile/v1/admin/payments/[paymentId]`
- `POST /api/mobile/v1/admin/payments/[paymentId]/decision`
- `GET /api/mobile/v1/admin/lookup?q=<query>&type=<ALL|SELLERS|CUSTOMERS|ORDERS>`

---

## 3. Documented Dependencies, Constraints & Feature Gaps (Not Bypassed)

Per the Phase 3.3A rule (*"If a required backend API, migration, or permission is missing, document the exact dependency instead of bypassing security or modifying Preview"*), the following dependencies and constraints are preserved and documented:

1. **Preview Vercel Deployment Dependency for New `/api/mobile/v1/seller/*` & `/api/mobile/v1/admin/*` Routes:**
   - The currently deployed Preview Vercel release (`dpl_AMa4yHpkrJXgXYquNwDCcp4pKuxt` at commit `642304442ce0a10a851a8dc2bcaba010d9a57d81`) contains `GET /api/mobile/v1/me` only.
   - Because Phase 3.3A strictly forbids Git commits/pushes and Vercel deployments, the new `/api/mobile/v1/seller/*` and `/api/mobile/v1/admin/*` endpoints are verified locally via `node --test tests/phase3_3MobileOperations.test.ts` (`12/12 PASS`), `npm run typecheck` (`PASS`), and `flutter test` (`29/29 PASS`), and must be deployed to Preview Vercel in a future authorized release step before a physical device pointing at Preview Vercel can call them live.

2. **Mandatory Payment Screenshot Contract (`public.submit_manual_upi`):**
   - Both `src/server/actions/operations.ts` (`submitManualUpi`) and the PostgreSQL RPC `public.submit_manual_upi` (`202611020001_seller_qr_and_mandatory_screenshots.sql` line 259) strictly require a row in `public.payment_screenshots` for the order's payment before `submit_manual_upi` transitions the payment to `SUBMITTED`.
   - Phase 3.3A **preserves** this database and server-side check (`SCREENSHOT_REQUIRED`) rather than weakening or bypassing it. In the Flutter Seller order detail sheet, `order.payment.hasScreenshot` is surfaced clearly to the seller, and a dedicated multipart screenshot upload endpoint (`POST /api/mobile/v1/seller/orders/[orderId]/screenshot` wrapping `validatePaymentScreenshot` + `payment-screenshots` bucket upload) is recommended for Phase 3.3B alongside mobile image-picker integration.

3. **Mandatory Active Personal Seller Payment QR Contract (`createSale` / `handleMobileSellerOrdersPost`):**
   - Sellers must have an active personal payment QR (`sellers.is_qr_active === true`, `qr_storage_path IS NOT NULL`, `upi_id IS NOT NULL`) to create new manual orders. If a seller's QR is not active, `POST /api/mobile/v1/seller/orders` returns a clear `400 BAD_REQUEST` message instructing the seller to activate their payment QR.

4. **Transactional Email / WhatsApp Outbox Dispatch on Mobile Mutations:**
   - Because Phase 3.3A strictly prohibits sending real emails, WhatsApp messages, or FCM notifications during implementation and testing, `handleMobileSellerOrdersPost` and `handleMobileAdminPaymentDecisionPost` perform only the core database RPCs (`create_seller_order`, `verify_payment_and_issue` → `issue_tickets`, `reject_payment`) without triggering external notification providers. Connecting outbox enqueueing (`enqueueOrderCreatedNotification`, `enqueuePaymentApprovedNotification`, `enqueueTicketsIssuedNotification`) behind a preview-safe flag is recommended for Phase 3.3B.

---

## 4. Recommended Next Steps (Phase 3.3B)

1. **Multipart Payment Screenshot Upload & Viewing for Mobile:** Add `POST /api/mobile/v1/seller/orders/[orderId]/screenshot` (reusing `validatePaymentScreenshot` from `src/lib/payment/screenshot.ts`) and `SUPER_ADMIN`-only signed screenshot viewing (`executeDownloadPaymentScreenshot` from `src/lib/payment/screenshotDownload.ts`) in the Flutter app.
2. **Seller Advisory Payment Review Endpoint:** Expose `submitSellerPaymentReview` (`RECOMMENDED_APPROVAL`, `RECOMMENDED_REJECTION`, `FLAGGED_DISCREPANCY`) under `/api/mobile/v1/seller/orders/[orderId]/review`.
3. **Authorized Preview Deployment & On-Device UAT:** Once authorized by the user, deploy the Phase 3.3A `/api/mobile/v1/seller/*` and `/api/mobile/v1/admin/*` routes to Preview Vercel and rebuild/install the debug APK on the Redmi Note 9S (`ecc57eef`) for end-to-end physical-device operational testing.
