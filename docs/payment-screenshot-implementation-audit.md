# Payment screenshot implementation audit

Audit date: 2026-11-01. This document reflects the repository only; no remote Supabase project was contacted.

## Existing design

- `payments` is the authoritative payment record (`order_id`, UTR, payer name, status, submission and verification fields). `orders` owns the customer/campaign relationship; `tickets` belongs to orders.
- The lifecycle is `PENDING` → `SUBMITTED` → `VERIFIED` or `FAILED`. `verify_payment_and_issue` is service-role-only and is the sole existing verification/issuance path.
- Customers may complete payment details through a high-entropy, hashed `payment_recovery_tokens` link. Staff is authorized by `profiles`/`roles`/`profile_roles` and `requireAnyRole`.
- The app uses Next.js Server Actions and a server-only Supabase service-role client. No existing Storage bucket or screenshot feature was found. Admin payment review is at `/admin/payments/[paymentId]`.

## Additive implementation plan and files

`202611011200_payment_screenshots.sql` adds a nullable-by-relationship `payment_screenshots` table: old payment records need no update and have no screenshot row. It also creates the private `payment-screenshots` bucket and a staff-only metrics RPC. `payment_id` is unique: one immutable screenshot per payment.

The customer upload action validates a recovery token, payment eligibility, MIME type, signature, and 2 MB limit. It generates a UUID-based object name, writes storage first, records metadata second, and removes only the newly-created object if metadata persistence fails. The browser never receives storage credentials or a storage path.

The existing payment-details form adds a required screenshot field when rendered from the authenticated recovery-link route. The existing direct legacy order route remains backward compatible for existing orders. Admin review obtains a five-minute signed URL only after the existing staff-role check. Monitoring aggregates metadata; it never scans or downloads objects.

## Risks and unresolved deployment work

- No Supabase target/credentials were available, so this migration was not applied and bucket/RLS state could not be verified remotely.
- The legacy public `/buy/order/[orderId]` page is an existing bearer-style flow. Screenshots are intentionally available only from the recovery-token flow, not from a raw order ID.
- The code does not record failed-upload telemetry, so the dashboard correctly reports that count as unavailable.
- Before Preview deployment, confirm `payment_recovery_tokens` migration `202611011100` is applied first, then apply this migration to Preview only and verify the bucket remains private.

## Local review results — 2026-11-01

The local migration was reviewed, not executed. It is additive: it creates only `payment_screenshots`, an index, a metrics function, and the dedicated bucket. It does not alter payment/order/ticket columns, enums, existing migrations, or the verification and issuance RPCs. Its dependencies are present locally: `public.payments`, `public.is_staff`, `storage.buckets`, and the preceding recovery-token migration. Preview schema parity remains unverified.

Local tests cover JPEG/PNG/WebP signatures plus unsupported, empty, oversized, and spoofed images. The wider upload/storage workflow needs a non-production Supabase integration environment for end-to-end validation. `npm test` passed with 288 tests; typecheck, lint, build, and `git diff --check` also passed. No remote service was contacted.
