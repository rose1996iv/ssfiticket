# Phase C — Preview Storage Assessment

**Date:** 2026-11-02  
**Verification Method:** `npx supabase db query --linked` (Management API, read-only)  
**Target Project:** `jiyuiydzsfydjklosvvq` (`ssfi-lucky-draw-dev`)

---

## 1. Storage Bucket Status

### Query

```sql
SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY name;
```

### Result

**0 rows returned — no storage buckets exist on the Preview project.**

---

## 2. Required Bucket

| Property | Expected Value |
|----------|---------------|
| Bucket ID | `payment-screenshots` |
| Bucket Name | `payment-screenshots` |
| Public | `false` (private) |
| File Size Limit | `2097152` (2 MiB) |
| Allowed MIME Types | `{image/jpeg, image/png, image/webp}` |

---

## 3. Storage RLS Policies

### Query

```sql
SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'storage';
```

### Result

**0 rows — no storage policies exist.**

This is correct for the SSFI Lucky Draw architecture. The design deliberately creates **zero client-side storage policies**. With Storage RLS enabled and no policies granting access, the bucket is completely inaccessible to `anon` and `authenticated` clients.

The application performs all storage operations server-side:
1. **Upload:** Server action `paymentScreenshot.ts` → `createSupabaseAdminClient()` → `storage.from('payment-screenshots').upload()`
2. **Signed URLs:** Admin server action → `createSupabaseAdminClient()` → `storage.from('payment-screenshots').createSignedUrl()`
3. **Authorization:** Recovery token validation via `lookup_payment_recovery_token` (server-side service_role RPC)

---

## 4. Dependency Chain

```
Migration 202611011200_payment_screenshots.sql
  ├── Creates: public.payment_screenshots TABLE
  ├── Creates: storage.buckets INSERT (payment-screenshots)
  ├── Creates: public.get_payment_screenshot_storage_metrics() FUNCTION
  ├── Grants: SELECT, INSERT, UPDATE, DELETE → service_role on payment_screenshots
  └── Revokes: ALL from public, anon, authenticated on payment_screenshots
```

---

## 5. Readiness Assessment

| Component | Status | Action Required |
|-----------|--------|----------------|
| `payment_screenshots` table | ❌ MISSING | Apply migration `202611011200` |
| `payment-screenshots` bucket | ❌ MISSING | Created by migration `202611011200` |
| Storage client policies | ✅ CORRECTLY ABSENT | None needed (zero-client design) |
| `get_payment_screenshot_storage_metrics` RPC | ❌ MISSING | Created by migration `202611011200` |
| Server-side upload path | ✅ Ready in source | `src/server/actions/paymentScreenshot.ts` |
| Server-side signed URL path | ✅ Ready in source | Admin component calls admin client |

---

## 6. Phase D Action

Apply the complete `supabase/migrations/202611011200_payment_screenshots.sql` file in the Preview Dashboard SQL Editor.

**Pre-application checklist:**
- [ ] Confirm Dashboard URL contains `jiyuiydzsfydjklosvvq`
- [ ] Confirm NOT on Production project (`fohpqheglxhfdecadhzw`)
- [ ] Read the full migration file content before pasting
- [ ] Verify the `ON CONFLICT` clause will handle any future re-runs safely

**Post-application verification queries:**
```sql
-- Verify table
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'payment_screenshots';

-- Verify bucket
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE name = 'payment-screenshots';

-- Verify function
SELECT proname FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND proname = 'get_payment_screenshot_storage_metrics';

-- Verify zero client storage policies (should return 0 rows)
SELECT * FROM pg_policies WHERE schemaname = 'storage';
```

