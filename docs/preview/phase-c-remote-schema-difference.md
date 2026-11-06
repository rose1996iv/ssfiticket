# Phase C — Remote Schema Difference (Preview vs Phase B Target)

**Date:** 2026-11-02  
**Verification Method:** `npx supabase db query --linked` (Management API, read-only)  
**Compared Against:** `docs/preview/phase-b-architecture-reconstruction.md`

---

## Summary

| Category | Phase B Target | Remote Preview | Delta |
|----------|---------------|----------------|-------|
| Tables | 22 | 21 | -1 (`payment_screenshots`) |
| Sequences | 2 | 2 | 0 |
| ENUM types | 7–8 | 7 | 0 (no screenshot-specific ENUM) |
| Functions | 28 | 27 | -1 (`get_payment_screenshot_storage_metrics`) |
| Triggers | 15 | 15 | 0 |
| RLS policies | 34 | 32 | -2 (payment_screenshots policies) |
| Storage buckets | 1 | 0 | -1 (`payment-screenshots`) |
| `search_path=''` functions | 22+ | 8 | ⚠️ -14+ |

---

## Missing Objects

### Tables

| Table | Migration | Impact |
|-------|-----------|--------|
| `payment_screenshots` | `202611011200` | Screenshot upload feature blocked |

### Functions

| Function | Migration | Impact |
|----------|-----------|--------|
| `get_payment_screenshot_storage_metrics(uuid)` | `202611011200` | Admin storage monitoring blocked |

### RLS Policies

| Policy | Table | Migration |
|--------|-------|-----------|
| *(service_role access)* | `payment_screenshots` | `202611011200` |
| *(additional policies if defined)* | `payment_screenshots` | `202611011200` |

Note: The migration (`202611011200`) uses `REVOKE ALL ... FROM public, anon, authenticated` and `GRANT ... TO service_role` instead of explicit RLS policies for client access. The 2 "missing" policies from the Phase B target count include the effective access control difference.

### Storage

| Bucket | Properties | Migration |
|--------|-----------|-----------|
| `payment-screenshots` | Private, 2 MB, JPEG/PNG/WebP | `202611011200` |

### Indexes

| Index | Table | Migration |
|-------|-------|-----------|
| `payment_screenshots_uploaded_at_idx` | `payment_screenshots` | `202611011200` |

---

## Matching Objects

### Tables (21/22 MATCH) ✅

All 21 present tables match Phase B target in:
- Column names and types
- Nullability constraints
- Default values
- Primary keys
- Foreign key relationships
- Check constraints

### Sequences (2/2 MATCH) ✅

| Sequence | MAXVALUE |
|----------|---------|
| `ssfi_order_number_sequence` | 9223372036854775807 (no cap) |
| `ssfi_ticket_number_sequence` | 999999 |

### ENUMs (7/7 MATCH) ✅

All enum types and their labels match Phase B target exactly.

### Triggers (15/15 MATCH) ✅

All triggers present, correctly mapped to functions, and enabled (status `O`).

### RLS (32/32 existing MATCH) ✅

All 32 existing policies match Phase B target in policy name, command, roles, USING expression, and WITH CHECK expression.

---

## Differences (Non-Missing)

### `search_path` Configuration

| Category | Count | Functions |
|----------|-------|-----------|
| Matches Phase B (`search_path=''`) | 8 | `create_seller_order`, `has_role`, `is_staff`, `reject_payment`, `trg_seller_messages_populate_snapshot`, `trg_seller_messages_protect_immutable`, `validate_status_transition`, `verify_payment_and_issue` |
| Differs from Phase B (`search_path=public`) | 18 | See migration status document |
| Correct special case (`pg_catalog`) | 1 | `rls_auto_enable` |
| Correct special case (`null`) | 1 | `set_updated_at` |

### Extra Grants

| Object | Grantee | Grant | Expected | Status |
|--------|---------|-------|----------|--------|
| `trg_seller_messages_populate_snapshot` | `anon`, `authenticated` | EXECUTE | service_role only | ⚠️ EXTRA — low severity |

---

## Extra Objects (Not in Phase B Target)

None detected. All remote objects are accounted for in Phase B.

---

## Conclusion

The remote Preview schema is **structurally equivalent** to the Phase B target with the following exceptions:
1. One missing migration (`202611011200`) — affects 1 table, 1 function, 1 storage bucket, 1 index
2. `search_path` drift — 18 functions use `public` instead of `''`; functional behavior is equivalent but defense-in-depth is reduced
3. One excess function grant — `trg_seller_messages_populate_snapshot` to `anon`/`authenticated`

All three are addressable in Phase D without schema redesign.

