# Payment screenshot architecture

Payment screenshots are optional metadata for legacy payments and required only in the secure recovery-link completion experience. They support manual review; they never verify a payment, change a payment status, or issue tickets.

## Storage and access

- Bucket: `payment-screenshots`, private, JPEG/PNG/WebP, maximum 2 MiB.
- Object keys are server-generated UUID filenames. No PII, UTR, or original filename is retained in the key.
- The browser posts the selected file to a Server Action. The server validates the byte signature and MIME type, validates a non-expired recovery token, and uploads with `upsert: false`.
- Metadata is stored in `payment_screenshots`; one row per payment prevents duplicate retries from overwriting proof. If metadata storage fails, only the just-uploaded object is removed.
- Staff preview uses a server-authorized, five-minute signed URL. Signed URLs and object paths are not persisted or exposed to customers.

## Deployment and rollback

Apply `202611011200_payment_screenshots.sql` only after `202611011100_payment_recovery_tokens.sql`, and only after confirming the intended Preview project. Verify that the bucket is private and run the test/typecheck/lint/build gates. No production migration or deployment was run during implementation.

Rollback is application-first: stop rendering the upload field and preview component. Do not delete screenshot rows or storage objects until retention requirements and a backup have been approved.

## Local validation limits

The recovery token is checked for hash match, order match, revocation, and expiration before an upload can resolve a payment. The upload action neither updates payment/order status nor invokes ticket issuance. The existing service-role verification RPC remains the only issuance path.

Object and byte metrics are derived solely from persisted screenshot metadata, so they describe the dedicated screenshot bucket rather than all Supabase Storage. Missing metrics render an explicit unavailable state; failed-upload telemetry is not currently stored. Actual Storage RLS, signed URL behavior, and mobile-browser file selection require Preview validation with a safe test account and non-production objects.
