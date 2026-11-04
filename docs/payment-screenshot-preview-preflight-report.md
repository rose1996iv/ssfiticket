# Payment Screenshot Preview Preflight Report

**Date:** 2026-11-02 (Asia/Kolkata)  
**Status:** **PREFLIGHT COMPLETE — AWAITING OWNER DASHBOARD CONFIRMATION**

---

## 1. Executive Summary

This preflight report evaluates the local migration dependencies, project identities, and readiness for testing the payment screenshot feature against the Supabase Preview environment (`jiyuiydzsfydjklosvvq`).

All actions conducted were strictly local and read-only. Zero remote operations, database mutations, Storage requests, or credential exposures occurred.

---

## 2. Local Migration Dependency Review

Two sequential migrations in `supabase/migrations/` govern the payment recovery and payment screenshot features:

1. **`202611011100_payment_recovery_tokens.sql`**
   - **Schema Objects:** Creates `public.payment_recovery_tokens` table with RLS enabled, indexes on `token_hash` and `order_id`, and service-role/staff access policies.
   - **RPCs:** Defines `create_payment_recovery_link`, `revoke_payment_recovery_link`, `lookup_payment_recovery_token`, and `submit_payment_details_completion`.
   - **Role in System:** Serves as the authoritative mechanism for generating high-entropy recovery links, looking up token states, and submitting customer payment details.

2. **`202611011200_payment_screenshots.sql`**
   - **Schema Objects:** Creates `public.payment_screenshots` table referencing `public.payments(id)` with strict foreign key constraints, storage path regex validation, MIME type checks, and 2 MiB file size limits.
   - **Storage Configuration:** Inserts/updates `payment-screenshots` private bucket in `storage.buckets` (`public = false`, `file_size_limit = 2097152`, allowed MIME: JPEG, PNG, WebP).
   - **RPCs:** Defines `public.get_payment_screenshot_storage_metrics(p_actor uuid)` guarded by `public.is_staff(p_actor)`.

### Dependency Finding
- **Database Schema Level:** `202611011200_payment_screenshots.sql` directly requires `public.payments`, `public.is_staff(uuid)`, and the `storage.buckets` schema. It does not have a direct foreign key to `payment_recovery_tokens`.
- **Application Workflow Level:** **Hard dependency.** The server action (`src/server/actions/paymentScreenshot.ts`) and frontend component (`src/components/payment/PaymentScreenshotField.tsx`) authenticate and authorize customer screenshot uploads using recovery tokens validated via `lookup_payment_recovery_token` and `payment_recovery_tokens`.
- **Conclusion:** Migration `202611011100_payment_recovery_tokens.sql` **must be applied and active** in the database before `202611011200_payment_screenshots.sql` can be functionally validated.

---

## 3. Project Identity & Environment Separation Evidence

| Property | Candidate Preview Project | Documented Production Project |
| :--- | :--- | :--- |
| **Reference** | `jiyuiydzsfydjklosvvq` | `fohpqheglxhfdecadhzw` |
| **Project URL** | `https://jiyuiydzsfydjklosvvq.supabase.co` | `https://fohpqheglxhfdecadhzw.supabase.co` |
| **Local Documentation** | Explicitly documented as Preview / Dev across 15+ files | Explicitly documented as Production (Protected) |
| **Automated Test Isolation** | Verified in `tests/purchaseAndDeliveryFlow.test.ts:2345` | Verified in `tests/purchaseAndDeliveryFlow.test.ts:2346` |
| **Separation Assertion** | `assert.notEqual(previewRef, prodRef)` passed | `assert.notEqual(previewRef, prodRef)` passed |
| **Local Config (`supabase/config.toml`)** | `project_id = "Lucky_Draw"` (local CLI label only) | `project_id = "Lucky_Draw"` (local CLI label only) |

**Separation Determination:** The candidate reference `jiyuiydzsfydjklosvvq` is strictly distinct from the documented production project reference `fohpqheglxhfdecadhzw`.

---

## 4. Human Dashboard Verification Status

**Current Status:** **PENDING OWNER VERIFICATION**

To safely proceed, the project owner must verify the following items in the [Supabase Dashboard](https://supabase.com/dashboard):

1. **Preview Project Identity:** The candidate Preview project reference in the Dashboard (under Project Settings → General) is confirmed as `jiyuiydzsfydjklosvvq`.
2. **Production Project Identity:** The Production project reference is confirmed as `fohpqheglxhfdecadhzw`.
3. **Data Classification:** Project `jiyuiydzsfydjklosvvq` is non-production and contains only synthetic/test data.
4. **Environment Isolation:** Project `fohpqheglxhfdecadhzw` remains separately controlled with production safeguards.
5. **Existing Migration Status:** Confirm whether migration `202611011100_payment_recovery_tokens.sql` is present in `supabase_migrations.schema_migrations` on `jiyuiydzsfydjklosvvq`.
6. **Storage Readiness:** Verify whether the Storage service is enabled on `jiyuiydzsfydjklosvvq` and ready for the `payment-screenshots` bucket creation.

*Note: In accordance with safety rules, these checkpoints are reported as pending until the project owner provides evidence or confirmation.*

---

## 5. Tooling & Remote Access Preflight

- **Supabase CLI Availability:** Checked system PATH; `supabase` CLI is **NOT installed** on the local system.
- **Remote Access Authorization:** Remote database connection, API querying, and CLI linking are **NOT authorized**.
- **Local Working Tree:** All uncommitted changes in the working tree are preserved untouched.
- **Safety Boundaries:**
  - No secrets were read, printed, or exposed.
  - No migrations were applied.
  - No Storage buckets were created, modified, or deleted.
  - No screenshot files were uploaded.
  - No git commits, tags, pushes, or deployments were performed.

---

## 6. Current Blockers

1. **Pending Owner Dashboard Confirmation:** Written confirmation of items 1–6 above is required before any remote interaction.
2. **Unverified Remote Migration State:** Whether migration `202611011100` exists on the remote database is unconfirmed until the owner checks the SQL Editor or migration table.
3. **No Remote CLI/Connection Configured:** Local workspace intentionally has no active remote link to either project.

---

## 7. Recommended Next Actions

1. **Owner Action:** The project owner logs in to the Supabase Dashboard and verifies the 6 items listed in Section 4.
2. **SQL Preflight Query (for Owner in Preview SQL Editor):**
   ```sql
   -- Run in Preview SQL Editor (jiyuiydzsfydjklosvvq) to check existing recovery migration
   select version, name from supabase_migrations.schema_migrations
   where version in ('202611011100', '202611011200')
   order by version;
   ```
3. **Migration Step (Upon Owner Confirmation):**
   - If `202611011100` is confirmed present on Preview, execute `supabase/migrations/202611011200_payment_screenshots.sql` in the **Preview Dashboard SQL Editor (`jiyuiydzsfydjklosvvq`) only**.
   - NEVER execute `202611011200_payment_screenshots.sql` against Production (`fohpqheglxhfdecadhzw`).
4. **Integration Testing:** Proceed with end-to-end testing of screenshot uploads using test fixtures in the verified Preview environment.

