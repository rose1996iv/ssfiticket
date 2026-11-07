# SSFI — Phase 6C.1: Historical Order Sanitization Preflight Report

**Document ID:** `PHASE_6C_1_HISTORICAL_SANITIZATION_PREFLIGHT`  
**Date:** 2026-11-07  
**Branch:** `preview/production-mirror`  
**Execution Mode:** **`STRICTLY READ-ONLY AUDIT ONLY` (Zero Database Mutations, Zero Migrations Applied, Zero Git Commits)**  
**Target Environment:** Preview Supabase (`jiyuiydzsfydjklosvvq`) — **`https://jiyuiydzsfydjklosvvq.supabase.co`**  
**Air-Gapped Environment:** Production Supabase (`fohpqheglxhfdecadhzw`) — **STRICTLY AIR-GAPPED & UNTOUCHED**  
**Preflight Status:** **`PASS — FULLY VERIFIED & READY FOR OWNER AUTHORIZATION`**  

---

## 1. Executive Summary

As required by **Phase 6C.1**, a strictly read-only preflight assessment has been performed on the Preview Supabase database (`jiyuiydzsfydjklosvvq`) regarding the sanitization of historical order payment snapshots.

### Core Discoveries:
1. **The 16 Historical Orders Identified:** Orders `ORD-2026-000031` through `ORD-2026-000046` are confirmed to be the exact 16 orders retaining pre-clone non-synthetic UPI strings (`7` rows with `ssf***dun@okaxis` assigned to `SELLER-007`, and `9` rows with `881***357@ptyes` assigned to `SELLER-008`). All 16 orders require sanitization.
2. **Sanitization Function Verified:** `public.admin_sanitize_preview_historical_order_snapshots(uuid, text)` is deployed on Preview Supabase with all 10 security invariants active: `SUPER_ADMIN` check, strict 16-order allowlist, regex enforcement (`^preview\.[a-z0-9_]+@upi$`), Preview project binding, and count assertions (`sanitized_count IN (0, 16)` and `already_synthetic = 16`).
3. **Trigger Compatibility Verified:** Trigger `trg_protect_order_payment_snapshot` is active and enabled (`tgenabled = 'O'`). The trigger validates the caller and environment internally, permitting sanitization without ever being disabled.
4. **Zero Collateral Mutation:** The sanitization logic modifies only snapshot payment destination text (`snapshot_upi_id`, `snapshot_account_name`, `snapshot_qr_storage_path`, `snapshot_payment_instructions`). Customer identity, payment records, UTRs, tickets, and order statuses cannot be modified.
5. **Neither Function Was Invoked:** Zero historical records have been modified.

> [!IMPORTANT]
> **SAFETY RE-ASSERTION:**
> - Neither `admin_sanitize_preview_historical_order_snapshots` nor `lock_order_payment_snapshot_trigger_unconditional` was invoked.
> - Preview database remains 100% read-only.
> - Production Supabase (`fohpqheglxhfdecadhzw`) remains completely air-gapped.

---

## 2. Order-by-Order Allowlist Audit Matrix (16 Historical Orders)

The following empirical matrix was extracted directly from `public.orders` and `public.sellers` on Preview Supabase (`jiyuiydzsfydjklosvvq`). Customer PII is strictly excluded.

| # | Order Number | Order ID | Seller Code | Seller UUID | Current Snapshot UPI (Redacted) | Expected Synthetic UPI | Order Status | Payment Status | Tickets | Requires Sanitization? |
|:---:|---|---|---|---|---|---|:---:|:---:|:---:|:---:|
| 1 | `ORD-2026-000031` | `84889a96-8b35-4f55-a7c4-c19d3d4a7b91` | `SELLER-007` | `edebd069-4bea-4f69-8afd-f34743def4ab` | `ssf***dun@okaxis` | `preview.seller007@upi` | `TICKETS_ISSUED` | `VERIFIED` | 1 | **YES** |
| 2 | `ORD-2026-000032` | `99d5d428-c55e-4ab1-8c0f-1d80158a42b1` | `SELLER-007` | `edebd069-4bea-4f69-8afd-f34743def4ab` | `ssf***dun@okaxis` | `preview.seller007@upi` | `TICKETS_ISSUED` | `VERIFIED` | 1 | **YES** |
| 3 | `ORD-2026-000033` | `5fa6ab1d-96fc-4f83-bca5-8393f6d6fd7f` | `SELLER-007` | `edebd069-4bea-4f69-8afd-f34743def4ab` | `ssf***dun@okaxis` | `preview.seller007@upi` | `TICKETS_ISSUED` | `VERIFIED` | 1 | **YES** |
| 4 | `ORD-2026-000034` | `2b7dbb54-b54e-466e-8a3f-f393e252667d` | `SELLER-007` | `edebd069-4bea-4f69-8afd-f34743def4ab` | `ssf***dun@okaxis` | `preview.seller007@upi` | `TICKETS_ISSUED` | `VERIFIED` | 1 | **YES** |
| 5 | `ORD-2026-000035` | `71b3b3ab-8e0b-417d-8fdf-e79b79ced0f1` | `SELLER-008` | `42fbf809-3c83-4e80-8c42-1315de26f2e0` | `881***357@ptyes` | `preview.seller008@upi` | `TICKETS_ISSUED` | `VERIFIED` | 1 | **YES** |
| 6 | `ORD-2026-000036` | `f2f88ef7-42c9-4aa7-bcfe-bebee50c7f07` | `SELLER-008` | `42fbf809-3c83-4e80-8c42-1315de26f2e0` | `881***357@ptyes` | `preview.seller008@upi` | `PENDING_PAYMENT` | `PENDING` | 0 | **YES** |
| 7 | `ORD-2026-000037` | `f6c2e806-1d34-46ab-87c7-52b68f66b7e0` | `SELLER-008` | `42fbf809-3c83-4e80-8c42-1315de26f2e0` | `881***357@ptyes` | `preview.seller008@upi` | `TICKETS_ISSUED` | `VERIFIED` | 1 | **YES** |
| 8 | `ORD-2026-000038` | `37c45211-4836-4456-8283-1bba471f48c2` | `SELLER-008` | `42fbf809-3c83-4e80-8c42-1315de26f2e0` | `881***357@ptyes` | `preview.seller008@upi` | `TICKETS_ISSUED` | `VERIFIED` | 1 | **YES** |
| 9 | `ORD-2026-000039` | `56a6e24a-d055-4134-a4db-f6a9dec64e3a` | `SELLER-008` | `42fbf809-3c83-4e80-8c42-1315de26f2e0` | `881***357@ptyes` | `preview.seller008@upi` | `TICKETS_ISSUED` | `VERIFIED` | 1 | **YES** |
| 10 | `ORD-2026-000040` | `c6a08027-338c-44ae-b93f-d884eb075245` | `SELLER-008` | `42fbf809-3c83-4e80-8c42-1315de26f2e0` | `881***357@ptyes` | `preview.seller008@upi` | `TICKETS_ISSUED` | `VERIFIED` | 1 | **YES** |
| 11 | `ORD-2026-000041` | `9c8765ff-d1c9-4dd1-b892-1a1fe678da10` | `SELLER-007` | `edebd069-4bea-4f69-8afd-f34743def4ab` | `ssf***dun@okaxis` | `preview.seller007@upi` | `PENDING_PAYMENT` | `PENDING` | 0 | **YES** |
| 12 | `ORD-2026-000042` | `97104a68-72dc-4a88-84a0-c0322379ddcf` | `SELLER-007` | `edebd069-4bea-4f69-8afd-f34743def4ab` | `ssf***dun@okaxis` | `preview.seller007@upi` | `PENDING_PAYMENT` | `PENDING` | 0 | **YES** |
| 13 | `ORD-2026-000043` | `ac3d7c40-80d8-44d4-b037-43b40d215c1e` | `SELLER-007` | `edebd069-4bea-4f69-8afd-f34743def4ab` | `ssf***dun@okaxis` | `preview.seller007@upi` | `PENDING_PAYMENT` | `PENDING` | 0 | **YES** |
| 14 | `ORD-2026-000044` | `c3648536-03a6-499a-bccc-f36d4d5daefb` | `SELLER-008` | `42fbf809-3c83-4e80-8c42-1315de26f2e0` | `881***357@ptyes` | `preview.seller008@upi` | `TICKETS_ISSUED` | `VERIFIED` | 1 | **YES** |
| 15 | `ORD-2026-000045` | `2803eb72-0d83-4715-9dcc-4338fabe724d` | `SELLER-008` | `42fbf809-3c83-4e80-8c42-1315de26f2e0` | `881***357@ptyes` | `preview.seller008@upi` | `PAYMENT_SUBMITTED` | `SUBMITTED` | 0 | **YES** |
| 16 | `ORD-2026-000046` | `d8168da2-3e98-4887-a926-ab396cf787dc` | `SELLER-008` | `42fbf809-3c83-4e80-8c42-1315de26f2e0` | `881***357@ptyes` | `preview.seller008@upi` | `TICKETS_ISSUED` | `VERIFIED` | 1 | **YES** |

### Order Matrix Summary:
- **Total Orders in Allowlist:** 16 (100% accounted for).
- **Orders Assigned to `SELLER-007`:** 7 (`ORD-2026-000031`..`000034`, `000041`..`000043`).
- **Orders Assigned to `SELLER-008`:** 9 (`ORD-2026-000035`..`000040`, `000044`..`000046`).
- **Target Synthetic UPIs Available:** Both `preview.seller007@upi` and `preview.seller008@upi` exist on `public.sellers`.

---

## 3. Deployed Sanitization Function Review

The actual function definition of `public.admin_sanitize_preview_historical_order_snapshots` on Preview Supabase was reviewed against all 10 criteria:

| # | Inspection Criterion | Implementation in Deployed Function | Verification Result |
|:---:|---|---|:---:|
| **1** | **SUPER_ADMIN Authorization** | `IF p_actor_user_id IS NULL OR NOT public.has_role(p_actor_user_id, 'SUPER_ADMIN') THEN RAISE EXCEPTION ... (42501)` | **`VERIFIED`** |
| **2** | **Service-Role Execution Only** | `IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION ... (42501)` | **`VERIFIED`** |
| **3** | **Production Exclusion Guard** | `IF coalesce(current_setting('app.settings.project_ref', true), '') = 'fohpqheglxhfdecadhzw' THEN RAISE EXCEPTION ...` | **`VERIFIED`** |
| **4** | **Preview Target Ref Binding** | Checks `public.system_settings.preview_data_mirror_metadata->>'target_project_ref' = 'jiyuiydzsfydjklosvvq'` | **`VERIFIED`** |
| **5** | **Exact 16-Order Allowlist** | Coded array `v_allowed_orders` and pre-check `SELECT count(*) INTO v_total_allowlist_present ... IF v_total_allowlist_present <> 16 THEN RAISE EXCEPTION` | **`VERIFIED`** |
| **6** | **Synthetic UPI Regex Validation** | Rejects any seller whose UPI does not match `^preview\.[a-z0-9_]+@upi$` | **`VERIFIED`** |
| **7** | **Strict Count Assertions** | `IF v_sanitized_count NOT IN (0, 16) OR v_already_synthetic_count <> 16 THEN RAISE EXCEPTION ...` | **`VERIFIED`** |
| **8** | **Redacted Audit Log Creation** | Inserts `PREVIEW_HISTORICAL_SNAPSHOT_SANITIZED` into `public.audit_logs` storing `redacted_previous: true` without leaking previous real UPI string | **`VERIFIED`** |
| **9** | **No Trigger Disabling** | Does NOT call `ALTER TABLE ... DISABLE TRIGGER`. Triggers remain enabled throughout execution. | **`VERIFIED`** |
| **10** | **Idempotent Re-Run Safety** | On re-run, loop queries 0 unsanitized rows, asserts `v_already_synthetic_count = 16`, and returns `{ success: true, already_sanitized: true }` without errors | **`VERIFIED`** |

---

## 4. Trigger Compatibility Review

The trigger function `public.protect_order_payment_snapshot()` attached to `public.orders` (`BEFORE UPDATE`) was inspected:

```sql
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_protect_order_payment_snapshot';
-- Result: tgname: trg_protect_order_payment_snapshot, tgenabled: 'O' (Enabled)
```

### In-Trigger Multi-Factor Exception Logic:
The trigger permits mutation of snapshot columns (`snapshot_upi_id`, `snapshot_account_name`, `snapshot_qr_storage_path`, `snapshot_payment_instructions`) **only** when all six conditions are satisfied simultaneously:
1. `current_setting('ssfi.allow_preview_snapshot_sanitization', true) = 'true'`
2. `current_setting('ssfi.sanitization_caller', true) = 'admin_sanitize_preview_historical_order_snapshots'`
3. Project is not Production (`coalesce(current_setting('app.settings.project_ref', true), '') <> 'fohpqheglxhfdecadhzw'`)
4. Target project in `system_settings` is Preview (`v_preview_target_ref = 'jiyuiydzsfydjklosvvq'`)
5. Order number is in the 16-order allowlist (`OLD.order_number = ANY(v_allowed_orders)`)
6. New UPI matches synthetic pattern (`NEW.snapshot_upi_id ~ '^preview\.[a-z0-9_]+@upi$'`)

### Identity Columns Protected by Trigger Even During Exception:
Even if all exception conditions pass, the trigger **strictly blocks** any modification to:
- `id`
- `order_number`
- `customer_id`
- `seller_id`
- `campaign_id`
- `snapshot_seller_id`
- `snapshot_seller_code`
- `snapshot_seller_display_name`
- `snapshot_captured_at`

If any of these fields differ between `OLD` and `NEW`, the trigger raises exception `P0001: Order payment snapshot fields are immutable once captured`.

---

## 5. Business Data Integrity Safeguards

An impact analysis confirms that executing `admin_sanitize_preview_historical_order_snapshots` cannot alter any core business entities:

| Data Entity | Impact Assessment | Protection Mechanism |
|---|---|---|
| **Customer Identity & Contact** | **Zero Impact** | Customer data resides in `public.customers`. `orders.customer_id` is locked by the trigger. |
| **Payment Amount (`amount_paise`)** | **Zero Impact** | Resides in `public.payments` and `public.orders(total_amount_paise)`. Neither is in the update statement. |
| **Payment Status (`status`)** | **Zero Impact** | Resides in `public.payments(status)`. Untouched. |
| **Payer Name & UTR** | **Zero Impact** | Resides in `public.payments(payer_name, utr)`. Untouched. |
| **Screenshot Storage Path** | **Zero Impact** | Resides in `public.payments(screenshot_storage_path)` and `public.payment_screenshots`. Untouched. |
| **Ticket Records & Numbers** | **Zero Impact** | Resides in `public.tickets`. Protected by separate immutability trigger `trg_protect_ticket_identity_immutability`. |
| **Seller Ownership** | **Zero Impact** | `orders.seller_id` and `snapshot_seller_id` are asserted identical by the trigger. |
| **Order Status** | **Zero Impact** | `orders.status` is untouched (11 `TICKETS_ISSUED`, 4 `PENDING_PAYMENT`, 1 `PAYMENT_SUBMITTED` remain unchanged). |

---

## 6. Execution Prerequisites & Rollback Considerations

### Execution Prerequisites:
1. **Authorized Actor:** Must supply the UUID of an active `SUPER_ADMIN` profile.
   - Verified active `SUPER_ADMIN` profile in Preview: `72054ec1-13a8-4b02-8d4e-d2b78f2df978`
2. **Audit Reason:** Must supply an audit explanation string between 10 and 500 characters (e.g. `'SSFI Phase 6C: Post-clone historical order snapshot sanitization to synthetic UPI IDs'`).
3. **Execution Context:** Must be called via `service_role` client or Supabase SQL API with service-role credentials.

### Rollback Limitations & Architectural Direction:
- **Reversibility Consideration:** Once the 16 historical Preview order snapshots are sanitized to synthetic UPI IDs (`preview.seller007@upi`, `preview.seller008@upi`), the previous real UPI IDs (`ssf***dun@okaxis`, `881***357@ptyes`) **cannot and should not be restored**.
- **Security Policy:** A non-production Preview environment must never contain live payment destinations. Sanitization permanently eliminates historical PII exposure in Preview.
- **Backup Safety:** If forensic inspection is ever required, the pre-clone backup snapshot `backups/preview-database-backup-20261107.json` is safely archived on disk.

---

## 7. Preflight Verdict & Final Stop

| Preflight Item | Result |
|---|:---:|
| 16 Historical Orders Verified & Located | **`PASS`** |
| Seller Synthetic UPI Availability Confirmed | **`PASS`** |
| Sanitization Function 10 Safety Invariants Verified | **`PASS`** |
| Trigger Multi-Factor Exception Verified | **`PASS`** |
| Business Data Immutability Guaranteed | **`PASS`** |
| Zero Database Mutations Executed | **`PASS`** |
| Production Air-Gap Maintained | **`PASS`** |
| **Historical Sanitization Preflight Verdict** | **`PASS — FULLY READY FOR EXECUTION`** |

> [!CAUTION]
> ### FINAL STOP — AWAITING EXPLICIT OWNER AUTHORIZATION
> This preflight audit is strictly READ-ONLY.
> Neither `admin_sanitize_preview_historical_order_snapshots` nor `lock_order_payment_snapshot_trigger_unconditional` has been executed.
> Awaiting explicit owner authorization before executing historical order snapshot sanitization.

