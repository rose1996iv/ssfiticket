# Payment Screenshot Preview Environment Verification

Date: 2026-11-01 (Asia/Kolkata)
Scope: read-only local configuration review. No remote Supabase request was made because the Preview target could not be positively identified.

## Project identity

| Item | Result | Classification |
| --- | --- | --- |
| Local Supabase `project_id` | `Lucky_Draw` | Verified local configuration only; this is the Supabase CLI local project label, not a hosted project reference. |
| Hosted Preview project ID | Not verified | Unknown. |
| Hosted project name | Not verified | Unknown. |
| Environment designation | Not verified | Unknown. |
| Read-only remote access | Not verified | Unknown. |

Verification method: inspected `supabase/config.toml`, migration files, and the names (not values) of local environment variables. The Supabase CLI is not installed, no cloud project is linked in the repository configuration, and no expected Preview project reference was supplied. A URL or project name alone would not prove an environment is Preview, so no remote query was attempted.

**Migration status: BLOCKED.** Do not apply `202611011200_payment_screenshots.sql` until an authorized operator supplies and independently confirms the intended Preview project reference and read-only access path.

## Local migration and dependency review

Local migration history contains `202611011100_payment_recovery_tokens.sql` followed by `202611011200_payment_screenshots.sql`.

The screenshot migration is additive locally. It creates:

- `public.payment_screenshots`, keyed to an existing `public.payments.id` without changing payment/order/ticket columns or status enums;
- an uploaded-at index;
- private `storage.buckets` configuration for `payment-screenshots` (JPEG/PNG/WebP, 2 MiB); and
- `public.get_payment_screenshot_storage_metrics(uuid)`.

Verified local dependencies are `public.payments`, `public.is_staff(uuid)`, Supabase `storage.buckets`, and the recovery-token migration. The migration has no `DROP`, `DELETE`, `TRUNCATE`, payment status update, ticket issuance, or client Storage-object policy. Existing records remain valid because screenshots are optional related rows, not mandatory new fields.

## Preview schema, Storage, and RLS status

The following are **unknown** because no verified Preview project was available:

- whether `payments`, `is_staff`, recovery-token objects, and required migrations exist in Preview;
- whether the screenshot migration is already applied;
- actual bucket existence/visibility/MIME/size configuration;
- actual Storage object policies and database RLS policies; and
- whether an existing bucket/policy would conflict with this migration.

Local code uses service-role access only on the server, validates a recovery token against its order/expiry/revocation state, creates opaque UUID object names with `upsert: false`, and generates a five-minute admin signed URL after existing staff-role authorization. These are local-code facts, not verification of remotely deployed behavior.

## Safe Preview integration plan (after identity confirmation)

1. Confirm the exact Preview project reference through an authorized dashboard/API/CLI session and record the non-secret project identity and environment designation.
2. Read migration history, schema metadata, `payment_screenshots` presence, bucket metadata, and RLS/policies without selecting customer data or screenshot objects.
3. Compare the required local dependencies and determine whether `202611011200` is pending, already applied, or conflicts.
4. In a dedicated synthetic Preview test order only, validate the private bucket is inaccessible to anon/authenticated clients and accepts server-authorized JPEG/PNG/WebP under 2 MiB.
5. Validate unsupported MIME, signature spoofing, empty files, and oversized files are rejected; validate recovery-token expiry/order mismatch and cross-customer attempts are rejected.
6. Force safe test-only storage/metadata failure scenarios to verify cleanup removes only the new object; verify retry does not replace an existing proof.
7. Verify staff-only preview produces a URL that expires after five minutes and non-staff cannot obtain it.
8. Verify metadata metrics against known synthetic objects and confirm upload does not change payment/order state or invoke ticket issuance.
9. Test desktop, iOS Safari, and Android Chrome file selection/retry behavior. Do not treat browser emulation as physical-device validation.

## Remaining blockers

- Authorized confirmation of the designated Preview project ID and environment designation.
- A read-only credential/session or approved operator-mediated query path for schema, migration-history, bucket, and policy inspection.
- Confirmation that Preview—not Production—would be targeted before any future mutation or integration test.

## Operations performed

No migration, database query, storage listing, bucket change, object upload, deployment, environment change, commit, push, or credential output occurred during this verification.
