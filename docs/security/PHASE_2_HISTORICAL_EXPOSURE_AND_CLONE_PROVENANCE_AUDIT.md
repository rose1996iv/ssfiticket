# SSFI Lucky Draw — Phase 2: Historical Data Exposure & Clone Provenance Audit

**Audit Timestamp:** `2026-11-07T16:56:00+05:30` (`2026-11-07T11:26:00Z`)  
**Execution Mode:** **STRICT READ-ONLY (Execution Freeze Active)**  
**Repository:** `https://github.com/rose1996iv/ssfiticket` (`F:\PROJECT\Lucky Draw`)  
**Audited Git Branch:** `preview/production-mirror` (`6646f903e169cf7194d759efc12f1236e17906cf`)  
**Production Branch (`main`):** `origin/main` at `36d39c837114815ed69d428551527d7541f4bf93` (Untouched)  
**Production Supabase Reference:** `fohpqheglxhfdecadhzw` (Strictly Air-Gapped / Zero Connections)  
**Preview Supabase Reference:** `jiyuiydzsfydjklosvvq` (Strictly Read-Only During Audit)

---

## Executive Classification Summary

| Audit Domain | Classification | Summary of Verified Evidence |
| :--- | :--- | :--- |
| **1. Historical UPI Exposure (`16` Orders in `public.orders`)** | **`FAILED` (Exposed to Staff on All 16 Orders; Exposed via Order UUID on 4 `PENDING_PAYMENT` Orders)** | `16` historical Preview orders (`ORD-2026-000031`..`ORD-2026-000046`) retain non-synthetic `snapshot_upi_id` values (`7` rows with `ssfi******@okaxis` and `9` rows with `8810******@ptyes`). These values are rendered unmasked to `FUNDRAISING_MANAGER`, `ADMIN`, and `SUPER_ADMIN` in `/admin/payments` and `/admin/payments/[paymentId]`. For the **`4` orders still in `PENDING_PAYMENT` status** (`ORD-2026-000036`, `000041`, `000042`, `000043`), `snapshot_upi_id` and `snapshot_account_name` are also rendered on the unauthenticated UUID-addressed route `/buy/order/[orderId]` and the owning seller's `/seller/orders/[orderId]/payment` page. |
| **2. Cross-Seller & Cross-Customer Isolation** | **`PARTIALLY VERIFIED`** | Direct PostgREST queries by `anon` return `0` rows (`VERIFIED`). Seller Portal routes (`/seller/orders/[orderId]`, `/seller/orders/[orderId]/payment`, `/seller/payments`) enforce `.eq("seller_id", seller.id)`, blocking cross-seller access (`VERIFIED`). However, public route `/buy/order/[orderId]` uses `createSupabaseAdminClient()` (`service_role`) keyed solely by `orderId` (UUIDv4) without customer session or token authentication — meaning any party who possesses one of the `4` pending historical `orderId` UUIDs can view its `snapshot_upi_id` (`FAILED` for strict authentication; mitigated only by 122-bit UUIDv4 entropy). |
| **3. Production Snapshot Provenance** | **`FAILED` (In-Place Preview Sanitization, Not a Current Production Clone)** | **Zero live connections to Production (`fohpqheglxhfdecadhzw`) ever occurred (`VERIFIED`).** The local dump `backups/production-public-data-before-release.sql` (`179` lines, dumped `2026-10-28`) contains only `18` pre-release seed rows (`0` orders, `0` customers, `0` payments, `0` tickets). All `51` orders, `52` customers, `51` payments, `36` tickets, and `270` audit logs in Preview originated from **pre-existing Preview (`jiyuiydzsfydjklosvvq`) activity accumulated between `2026-10-29` and `2026-11-07`**, modified in-place by `execute_preview_clone_and_sanitization.mjs`. Whether Preview matches current live Production (`fohpqheglxhfdecadhzw`) is **`NOT VERIFIED`**. |
| **4. Backup & Restore Readiness** | **`PARTIALLY VERIFIED` (`NOT RESTORE-VERIFIED`)** | `backups/preview-database-backup-20261107.json` (`909,075` bytes) contains all `23` tables (`686` rows), which is sufficient to restore row data into an existing schema. However, it lacks DDL (sequences, indexes, constraints, RLS policies, triggers, RPC definitions) and lacks raw binary blobs for the `12` overwritten `payment-screenshots` and `4` overwritten `seller-payment-qrs` objects (`FAILED` for binary storage recovery). A disposable restore test is feasible locally or in an isolated schema without touching Production or active Preview, but has not been executed (`NOT VERIFIED`). |
| **5. RPC Permission Analysis (`public.is_staff`)** | **`VERIFIED` (Root Cause Identified; Least-Privilege Fix Designed)** | `campaigns_public_read` and `prizes_public_read` apply to all roles (`PUBLIC`, including `anon`) and invoke `public.is_staff(auth.uid())` in their `USING` clause, while `202610300001_p0_security_remediation.sql` revoked `EXECUTE ON FUNCTION public.is_staff(uuid)` from `anon`. The true least-privilege fix is **splitting the RLS policies by role** (`TO anon, authenticated USING (status = 'ACTIVE')` + `TO authenticated USING (public.is_staff(auth.uid()))`) rather than granting `anon` execute rights on `public.is_staff(uuid)`. |

---

## 1. Historical UPI Exposure Matrix

### 1.1 Inventory of the 16 Historical Orders in Preview (`jiyuiydzsfydjklosvvq`)

**Classification:** **`VERIFIED`**

All `16` orders in `public.orders` that retained non-synthetic `snapshot_upi_id` values were captured between `2026-11-02T19:56:43Z` and `2026-11-03T06:38:51Z` (prior to the clone script) and were protected from PostgREST `UPDATE` by trigger `trg_protect_order_payment_snapshot`:

| Order Number | Order Status | Payment Status | Attributed Seller | Masked `snapshot_upi_id` | Masked `snapshot_account_name` | `snapshot_qr_storage_path` (Overwritten with Synthetic PNG) | Active Recovery Token? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| `ORD-2026-000031` | `TICKETS_ISSUED` | `VERIFIED` | `SELLER-007` | `ssfi******@okaxis` | `SSF***` | `seller-edebd069-.../e2e-test-qr.png` | No |
| `ORD-2026-000032` | `TICKETS_ISSUED` | `VERIFIED` | `SELLER-007` | `ssfi******@okaxis` | `SSF***` | `seller-edebd069-.../e2e-test-qr.png` | No |
| `ORD-2026-000033` | `TICKETS_ISSUED` | `VERIFIED` | `SELLER-007` | `ssfi******@okaxis` | `SSF***` | `seller-edebd069-.../e2e-test-qr.png` | No |
| `ORD-2026-000034` | `TICKETS_ISSUED` | `VERIFIED` | `SELLER-007` | `ssfi******@okaxis` | `SSF***` | `seller-edebd069-.../e2e-test-qr.png` | No |
| `ORD-2026-000035` | `TICKETS_ISSUED` | `VERIFIED` | `SELLER-008` | `8810******@ptyes` | `JOS***` | `seller-42fbf809-.../363ae012-a392-4762-a001-e3ac6425e30d.jpg` | No |
| **`ORD-2026-000036`** | **`PENDING_PAYMENT`** | **`PENDING`** | **`SELLER-008`** | **`8810******@ptyes`** | **`JOS***`** | `seller-42fbf809-.../363ae012-a392-4762-a001-e3ac6425e30d.jpg` | No |
| `ORD-2026-000037` | `TICKETS_ISSUED` | `VERIFIED` | `SELLER-008` | `8810******@ptyes` | `JOS***` | `seller-42fbf809-.../363ae012-a392-4762-a001-e3ac6425e30d.jpg` | No |
| `ORD-2026-000038` | `TICKETS_ISSUED` | `VERIFIED` | `SELLER-008` | `8810******@ptyes` | `JOS***` | `seller-42fbf809-.../ed514d00-37cd-4bbe-be1c-95f566166f0c.jpg` | No |
| `ORD-2026-000039` | `TICKETS_ISSUED` | `VERIFIED` | `SELLER-008` | `8810******@ptyes` | `JOS***` | `seller-42fbf809-.../ed514d00-37cd-4bbe-be1c-95f566166f0c.jpg` | No |
| `ORD-2026-000040` | `TICKETS_ISSUED` | `VERIFIED` | `SELLER-008` | `8810******@ptyes` | `JOS***` | `seller-42fbf809-.../b3832460-272b-4639-a083-a7788e947617.jpg` | No |
| **`ORD-2026-000041`** | **`PENDING_PAYMENT`** | **`PENDING`** | **`SELLER-007`** | **`ssfi******@okaxis`** | **`SSF***`** | `seller-edebd069-.../e2e-test-qr.png` | No |
| **`ORD-2026-000042`** | **`PENDING_PAYMENT`** | **`PENDING`** | **`SELLER-007`** | **`ssfi******@okaxis`** | **`SSF***`** | `seller-edebd069-.../e2e-test-qr.png` | No |
| **`ORD-2026-000043`** | **`PENDING_PAYMENT`** | **`PENDING`** | **`SELLER-007`** | **`ssfi******@okaxis`** | **`SSF***`** | `seller-edebd069-.../e2e-test-qr.png` | No |
| `ORD-2026-000044` | `TICKETS_ISSUED` | `VERIFIED` | `SELLER-008` | `8810******@ptyes` | `JOS***` | `seller-42fbf809-.../b3832460-272b-4639-a083-a7788e947617.jpg` | No |
| `ORD-2026-000045` | `PAYMENT_SUBMITTED` | `SUBMITTED` | `SELLER-008` | `8810******@ptyes` | `JOS***` | `seller-42fbf809-.../b3832460-272b-4639-a083-a7788e947617.jpg` | No |
| `ORD-2026-000046` | `TICKETS_ISSUED` | `VERIFIED` | `SELLER-008` | `8810******@ptyes` | `JOS***` | `seller-42fbf809-.../b3832460-272b-4639-a083-a7788e947617.jpg` | No |

### 1.2 Role-Based Exposure Matrix for Historical `snapshot_upi_id` & `snapshot_account_name`

**Classification:** **`VERIFIED`**

| Actor Role | Direct PostgREST (`orders` Table) | Public Order Route (`/buy/order/[orderId]`) | Seller Payment Route (`/seller/orders/[orderId]/payment`) | Admin Payments List (`/admin/payments`) | Admin Payment Detail (`/admin/payments/[paymentId]`) | Admin Exports (`/api/admin/export`) | Overall Exposure Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Anonymous (`anon`)** | **Blocked (`0` rows)** — no `SELECT` grant or `anon` RLS policy on `public.orders`. | **Exposed on `4` `PENDING_PAYMENT` orders if `orderId` UUID is known** (`ORD-2026-000036`, `000041`..`000043`); **Not rendered** on the `12` `PAYMENT_SUBMITTED` / `TICKETS_ISSUED` orders. | **Blocked** — redirected by `requireRole("SELLER")`. | **Blocked** — redirected by `requireAnyRole(...)`. | **Blocked** — redirected by ` AdminLayout` `requireAnyRole(...)`. | **Blocked (`401`/`403`)** — requires staff role. | **Exposed on 4 pending orders if UUID is known (`FAILED`)** |
| **Customer (Unauthenticated / Another Customer)** | **Blocked (`0` rows)** — customers do not authenticate via Supabase Auth in the public checkout flow. | **Exposed on `4` `PENDING_PAYMENT` orders if `orderId` UUID is known** (route uses `service_role` client without session/token verification). | **Blocked** — requires `SELLER` role. | **Blocked** — requires staff role. | **Blocked** — requires staff role. | **Blocked** — requires staff role. | **Cross-customer access possible if another customer's `orderId` UUID is known (`FAILED`)** |
| **Seller (Own Orders: `SELLER-007` / `SELLER-008`)** | **Allowed for own orders only** via RLS policy `orders_access` (`seller_id = current_seller_id()`). | Same as public UUID route. | **Exposed on own `4` `PENDING_PAYMENT` orders** (`SELLER-008`: `ORD-2026-000036`; `SELLER-007`: `ORD-2026-000041`..`000043`). Non-pending orders return `404` (`eq("status", "PENDING_PAYMENT")`). | **Blocked** — requires staff role. | **Blocked** — requires staff role. | **Blocked** — requires staff role. | **Exposed to owning seller on 4 pending orders (`FAILED`)** |
| **Seller (Other Sellers' Orders, e.g. `SELLER-002` / `SELLER-003`)** | **Blocked (`0` rows)** — RLS policy `orders_access` restricts to `seller_id = current_seller_id()`. | Cannot enumerate other sellers' UUIDs; only accessible if UUID is leaked. | **Blocked (`404 Not Found`)** — query enforces `.eq("seller_id", seller.id)`. | **Blocked** — requires staff role. | **Blocked** — requires staff role. | **Blocked** — requires staff role. | **Cross-seller access blocked (`VERIFIED`)** |
| **`FUNDRAISING_MANAGER`** | **Allowed for all `16` orders** via RLS `orders_access` (`is_staff(auth.uid())`). | Accessible if UUID known. | Blocked unless also assigned `SELLER` role. | **Exposed in HTML & RSC payload for all `16` orders** (when matching status filter `SUBMITTED`, `VERIFIED`, `PENDING`, or `ALL`). | **Exposed in HTML & RSC payload for all `16` orders** (`UPI: <snapshot_upi_id> (<snapshot_account_name>)`). | **Not included** (`route.ts` does not select `snapshot_upi_id`). | **Exposed across all 16 historical orders (`FAILED`)** |
| **`ADMIN`** | **Allowed for all `16` orders** via RLS `orders_access` (`is_staff(auth.uid())`). | Accessible if UUID known. | Blocked unless also assigned `SELLER` role. | **Exposed in HTML & RSC payload for all `16` orders.** | **Exposed in HTML & RSC payload for all `16` orders.** | **Not included** (`route.ts` does not select `snapshot_upi_id`). | **Exposed across all 16 historical orders (`FAILED`)** |
| **`SUPER_ADMIN`** | **Allowed for all `16` orders** via RLS `orders_access` (`is_staff(auth.uid())`). | Accessible if UUID known. | Blocked unless also assigned `SELLER` role. | **Exposed in HTML & RSC payload for all `16` orders.** | **Exposed in HTML & RSC payload for all `16` orders.** | **Not included** (`route.ts` does not select `snapshot_upi_id`). | **Exposed across all 16 historical orders (`FAILED`)** |

---

## 2. API and UI Exposure Paths

**Classification:** **`VERIFIED`**

A full-codebase static audit of `src/` confirmed every file that selects, processes, or renders `snapshot_upi_id`, `snapshot_account_name`, or `snapshot_qr_storage_path`:

### 2.1 API Routes (`src/app/api/**`)

1. **[`src/app/api/admin/export/route.ts`](file:///f:/PROJECT/Lucky%20Draw/src/app/api/admin/export/route.ts#L198-L247):**
   - **Selects `snapshot_upi_id`?** **No (`VERIFIED`).** Line 202 selects `orders(order_number, customers(full_name, whatsapp_number, phone, email), sellers:sellers!orders_snapshot_seller_id_fkey(display_name, seller_code), operational_seller:sellers!orders_seller_id_fkey(display_name, seller_code))`. Line 227 selects `id, order_number, quantity, unit_price_paise, total_amount_paise, status, created_at, customers(...), sellers!orders_seller_id_fkey(...)`.
   - **Result:** CSV, Excel, JSON, and PDF admin exports do **not** export `snapshot_upi_id` or `snapshot_account_name`.
2. **[`src/app/api/cron/campaign-schedule/route.ts`](file:///f:/PROJECT/Lucky%20Draw/src/app/api/cron/campaign-schedule/route.ts):**
   - **Selects `snapshot_upi_id`?** **No (`VERIFIED`).** Only invokes campaign schedule evaluation RPC.

### 2.2 Server Components & Pages (`src/app/**/page.tsx`)

1. **[`src/app/admin/payments/page.tsx`](file:///f:/PROJECT/Lucky%20Draw/src/app/admin/payments/page.tsx#L158-L163) (Admin Pending/All Payments Table):**
   - **Query (Line 161):** Selects `orders(id, order_number, quantity, total_amount_paise, seller_id, snapshot_seller_id, snapshot_upi_id, snapshot_account_name, snapshot_qr_storage_path, snapshot_seller_display_name, snapshot_seller_code, ...)`.
   - **HTML Rendering (Lines 513–520):** Renders `<span title={payment.orders.snapshot_upi_id}>{payment.orders.snapshot_upi_id}</span>` directly in the Seller Attribution column for every payment row.
   - **Exposure Scope:** Under default filter `status=SUBMITTED`, `ORD-2026-000045` (`8810******@ptyes`) is immediately rendered. When switched to `status=VERIFIED` (`11` orders), `status=PENDING` (`4` orders), or `status=ALL` (`16` orders), all `16` historical `snapshot_upi_id` values are rendered in server HTML and RSC flight payloads to `SUPER_ADMIN`, `ADMIN`, and `FUNDRAISING_MANAGER`.
2. **[`src/app/admin/payments/[paymentId]/page.tsx`](file:///f:/PROJECT/Lucky%20Draw/src/app/admin/payments/%5BpaymentId%5D/page.tsx#L96-L102) (Admin Payment Verification Detail Page):**
   - **Query (Line 99):** Selects `orders(id, order_number, quantity, snapshot_upi_id, snapshot_account_name, snapshot_qr_storage_path, snapshot_seller_display_name, snapshot_seller_code, ...)`.
   - **HTML Rendering (Lines 247–251):** Renders `UPI: {order.snapshot_upi_id} {order.snapshot_account_name ? `(${order.snapshot_account_name})` : ""}` in the Order Details section.
   - **Exposure Scope:** Accessible to `SUPER_ADMIN`, `ADMIN`, and `FUNDRAISING_MANAGER` for all `16` historical orders' payment records.
3. **[`src/app/buy/order/[orderId]/page.tsx`](file:///f:/PROJECT/Lucky%20Draw/src/app/buy/order/%5BorderId%5D/page.tsx#L66-L136) (Public Customer Order Confirmation & Payment Page):**
   - **Query (Lines 66–72):** Uses `createSupabaseAdminClient()` (`service_role`) to select `snapshot_seller_display_name, snapshot_seller_code, snapshot_qr_storage_path, snapshot_upi_id, snapshot_account_name, snapshot_payment_instructions` for `.eq("id", orderId)`.
   - **Server Computation (Lines 120–136):** Sets `effectiveUpiId = order.snapshot_upi_id` and `effectivePayeeName = order.snapshot_account_name || ...`, builds `upi://pay?pa=<effectiveUpiId>&pn=<effectivePayeeName>...`, and generates a dynamic QR code data URL (`dynamicQrDataUrl`) encoding that UPI URI.
   - **HTML & Client Bundle Prop Rendering (Lines 436–460):** When `isPending || isRejected` is true (`order.status === "PENDING_PAYMENT"` or `payment.status === "FAILED"`), passes `payeeName={effectivePayeeName}`, `upiId={effectiveUpiId}`, `upiIntentUri={upiIntentUri}`, `dynamicQrDataUrl={dynamicQrDataUrl}`, and `staticQrImagePath={sellerQrSignedUrl}` as props to the `"use client"` component [`CustomerPaymentJourney`](file:///f:/PROJECT/Lucky%20Draw/src/components/payment/CustomerPaymentJourney.tsx).
   - **Exposure Scope:**
     - **Exposed in HTML, RSC Flight Payload, and Dynamic QR Data URL for the `4` historical `PENDING_PAYMENT` orders** (`ORD-2026-000036` [`8810******@ptyes`], `ORD-2026-000041` [`ssfi******@okaxis`], `ORD-2026-000042` [`ssfi******@okaxis`], `ORD-2026-000043` [`ssfi******@okaxis`]) to anyone with the `orderId` UUID. Note that `staticQrImagePath` points to the overwritten synthetic `PREVIEW TEST ONLY` PNG in storage, while `dynamicQrDataUrl` is generated on-the-fly by `qrcode` from `snapshot_upi_id` and therefore still encodes the historical UPI ID!
     - **Not rendered in HTML or RSC Flight Payload for the `12` historical `PAYMENT_SUBMITTED` / `TICKETS_ISSUED` orders**, because `isPending || isRejected` is `false` and `effectiveUpiId` / `dynamicQrDataUrl` are not referenced outside lines 436–460.
4. **[`src/app/seller/orders/[orderId]/payment/page.tsx`](file:///f:/PROJECT/Lucky%20Draw/src/app/seller/orders/%5BorderId%5D/payment/page.tsx#L42-L145) (Seller Manual UPI Payment Page):**
   - **Query (Lines 44–62):** Uses `requireRole("SELLER")` and selects `snapshot_upi_id, snapshot_account_name, snapshot_qr_storage_path` filtered by `.eq("id", orderId).eq("seller_id", seller.id).eq("status", "PENDING_PAYMENT")`.
   - **HTML & Client Bundle Prop Rendering (Lines 133–145):** Passes `payeeName={effectivePayeeName}`, `upiId={effectiveUpiId}`, `upiIntentUri={upiIntentUri}`, and `dynamicQrDataUrl={dynamicQrDataUrl}` to the `"use client"` component [`UpiPaymentBox`](file:///f:/PROJECT/Lucky%20Draw/src/components/payment/UpiPaymentBox.tsx).
   - **Exposure Scope:** Exposed only to the authenticated owning seller (`SELLER-008` for `ORD-2026-000036`; `SELLER-007` for `ORD-2026-000041`..`000043`). Cross-seller requests and non-pending orders return `404 Not Found`.
5. **[`src/app/payment/complete/[token]/page.tsx`](file:///f:/PROJECT/Lucky%20Draw/src/app/payment/complete/%5Btoken%5D/page.tsx#L94-L103) (Tokenized Payment Recovery Page):**
   - **Selects `snapshot_upi_id`?** **No (`VERIFIED`).** `lookup_payment_recovery_token` does not return `snapshot_upi_id`, and none of the `16` historical orders have a `payment_recovery_tokens` row (`has_recovery_token: false` on all `16`).
6. **[`src/app/admin/orders/page.tsx`](file:///f:/PROJECT/Lucky%20Draw/src/app/admin/orders/page.tsx) & [`src/app/admin/orders/[orderId]/page.tsx`](file:///f:/PROJECT/Lucky%20Draw/src/app/admin/orders/%5BorderId%5D/page.tsx):**
   - **Selects `snapshot_upi_id`?** **No (`VERIFIED`).** Only selects `snapshot_seller_display_name` and `snapshot_seller_code`.
7. **[`src/app/seller/orders/page.tsx`](file:///f:/PROJECT/Lucky%20Draw/src/app/seller/orders/page.tsx), [`src/app/seller/orders/[orderId]/page.tsx`](file:///f:/PROJECT/Lucky%20Draw/src/app/seller/orders/%5BorderId%5D/page.tsx), & [`src/app/seller/payments/page.tsx`](file:///f:/PROJECT/Lucky%20Draw/src/app/seller/payments/page.tsx):**
   - **Selects `snapshot_upi_id`?** **No (`VERIFIED`).** Enforces `.eq("seller_id", seller.id)` and does not select `snapshot_upi_id`.
8. **Audit Logs & Server Logs (`public.audit_logs` & `src/lib/validation/customerManagement.ts`):**
   - [`src/lib/validation/customerManagement.ts`](file:///f:/PROJECT/Lucky%20Draw/src/lib/validation/customerManagement.ts#L23-L25) lists `snapshot_upi_id` in `IMMUTABLE_ORDER_PAYMENT_FIELDS` (preventing customer contact edit actions from touching it).
   - No server `console.log` statements print `snapshot_upi_id`, and `public.audit_logs` metadata redaction in [`src/lib/audit/center.ts`](file:///f:/PROJECT/Lucky%20Draw/src/lib/audit/center.ts) masks sensitive strings.

---

## 3. Production Snapshot Provenance

**Classification:** **`FAILED` (Claimed Production-to-Preview Clone Was an In-Place Sanitization of Existing Preview Data, Not a Clone from Current Production)**

### 3.1 Five Mandatory Provenance Determinations

1. **Did any live Production (`fohpqheglxhfdecadhzw`) connection occur?**
   - **`VERIFIED: NO.`** Zero network connections, SQL queries, PostgREST calls, or `pg_dump` operations were executed against `fohpqheglxhfdecadhzw`. `.env.local` contains only `https://jiyuiydzsfydjklosvvq.supabase.co` credentials.
2. **Do `backups/production-public-schema.sql` and `backups/production-public-data-before-release.sql` contain a complete database snapshot or only partial pre-release schema/data?**
   - **`VERIFIED: Partial pre-release baseline only (dumped 2026-10-28 via pg_dump 17.11).`**
   - [`backups/production-public-schema.sql`](file:///f:/PROJECT/Lucky%20Draw/backups/production-public-schema.sql) (`1,698` lines, `61,173` bytes) contains only `18` initial tables from October 28, 2026. It lacks the `5` tables added in subsequent migrations (`payment_screenshots`, `payment_recovery_tokens`, `order_collaboration_notes`, `system_settings`, `customer_email_outbox`) and lacks all seller QR / order payment snapshot columns (`sellers.upi_id`, `sellers.qr_storage_path`, `orders.snapshot_*`, `tickets.contact_*`).
   - [`backups/production-public-data-before-release.sql`](file:///f:/PROJECT/Lucky%20Draw/backups/production-public-data-before-release.sql) (`179` lines, `6,707` bytes) was dumped on `2026-10-28` **before release** (`sold_ticket_count = 0`, campaign status `DRAFT`, sequences `ssfi_order_number_sequence` and `ssfi_ticket_number_sequence` both at `1`). It contains only **`20` seed rows across `6` tables** (`roles`: 4, `profiles`: 3, `profile_roles`: 3, `campaigns`: 1, `sellers`: 2 [`SELLER-007`, `SELLER-003`], `prizes`: 5, `seller_messages`: 2) and **`0` rows** in `customers`, `orders`, `order_items`, `payments`, `payment_events`, `tickets`, `ticket_deliveries`, `ticket_verifications`, `draws`, `draw_results`, and `audit_logs`.
3. **Did the 23 Preview tables originate from Production data, previous Preview data, or another source?**
   - **`VERIFIED: Previous Preview (`jiyuiydzsfydjklosvvq`) data + in-place synthetic mutations.`**
   - Comparing [`backups/preview-database-backup-20261107.json`](file:///f:/PROJECT/Lucky%20Draw/backups/preview-database-backup-20261107.json) (captured at `2026-11-07T10:34:21.313Z`, before `execute_preview_clone_and_sanitization.mjs` ran) against the post-script Preview state proves that the `52` customers, `51` orders (`ORD-2026-000001`..`ORD-2026-000051`, created between `2026-10-29T10:11:10Z` and `2026-11-06T21:11:11Z`), `51` payments, `36` tickets (`SSFI-000001`..`SSFI-000036`), `127` payment events, `52` ticket deliveries, `38` email outbox records, and `270` audit logs were **already in Preview (`jiyuiydzsfydjklosvvq`) before the script ran**.
   - Even the campaign UUID (`a2aa9d5e-6a86-45d2-9382-6c7a8d0a272f` in Preview vs `23b265d6-6f48-42ea-be11-836f8762b68b` in `production-public-data-before-release.sql`) and seller UUIDs (`edebd069-...` for `SELLER-007` in Preview vs `199f97e0-...` in `production-public-data-before-release.sql`) differ, confirming Preview was seeded independently on `2026-10-29`.
4. **Can row counts be reconciled with an identifiable source snapshot?**
   - **`VERIFIED: Yes — 100% of current Preview row counts reconcile mathematically with the pre-clone Preview backup (`backups/preview-database-backup-20261107.json`) plus the exact inserts in `execute_preview_clone_and_sanitization.mjs` (see Section 4 table below).`** They do **not** come from `backups/production-public-data-before-release.sql`.
5. **Does the current Preview database represent the intended Production business state?**
   - **`NOT VERIFIED` / `FAILED`.** Because no live connection or current `pg_dump` from Production (`fohpqheglxhfdecadhzw`) was available or executed, it is **unverified** how many orders, customers, sellers, or tickets currently exist in live Production (`fohpqheglxhfdecadhzw`). The previous report (`PRODUCTION_TO_PREVIEW_FULL_CLONE_REPORT.md` and `PRODUCTION_DATABASE_INVENTORY.md`) conflated the pre-existing Preview dataset (`51` orders, `36` tickets) with the Production inventory.

---

## 4. Preview Data Origin Mapping (All 23 Tables)

**Classification:** **`VERIFIED`**

| # | Table Name | Rows in Oct 28 Prod Dump (`production-public-data-before-release.sql`) | Rows in Pre-Clone Preview Backup (`preview-database-backup-20261107.json`) | Rows Added by `execute_preview_clone_and_sanitization.mjs` | Current Preview Rows (`jiyuiydzsfydjklosvvq`) | Verified Data Origin & Mutation Summary |
| :-: | :--- | :---: | :---: | :---: | :---: | :--- |
| 1 | `public.roles` | 4 | 4 | 0 | **4** | Seeded in Preview on `2026-10-29`; untouched by clone script. |
| 2 | `public.profiles` | 3 | 6 | 0 (`6` updated) | **6** | Pre-existing Preview profiles; `phone` & `full_name` sanitized in-place. |
| 3 | `public.profile_roles` | 3 | 5 | +2 | **7** | `5` pre-existing Preview role links + `2` upserted by script (`ADMIN`, `FUNDRAISING_MANAGER`). |
| 4 | `public.campaigns` | 1 (`DRAFT`, 0 sold) | 1 (`ACTIVE`, 33 sold) | 0 (`1` updated) | **1** | Pre-existing Preview campaign (`a2aa9d5e-...`); schedule timestamps & `sold_ticket_count = 33` updated in-place. |
| 5 | `public.prizes` | 5 | 5 | 0 | **5** | Pre-existing Preview prizes; untouched by clone script. |
| 6 | `public.draws` | 0 | 0 | 0 | **0** | Empty in both dumps. |
| 7 | `public.draw_results` | 0 | 0 | 0 | **0** | Empty in both dumps. |
| 8 | `public.sellers` | 2 (`SELLER-007`, `003`) | 4 (`002`, `003`, `007`, `008`) | 0 (`4` updated) | **4** | Pre-existing Preview sellers; updated in-place with synthetic `preview.sellerXXX@upi` and synthetic QR paths. |
| 9 | `public.customers` | 0 | 52 | 0 (`52` updated) | **52** | Pre-existing Preview customers (`2026-10-29`..`2026-11-06`); sanitized in-place (`@preview-test.invalid`, `9000000001`..`52`). |
| 10 | `public.orders` | 0 | 51 | 0 (`35` updated) | **51** | Pre-existing Preview orders (`ORD-2026-000001`..`000051`). `35` rows without snapshots backfilled with synthetic `preview.sellerXXX@upi`; `16` rows with existing snapshots remained unchanged due to `trg_protect_order_payment_snapshot`. |
| 11 | `public.order_items` | 0 | 46 | +5 | **51** | `46` pre-existing Preview rows + `5` missing rows inserted by script for legacy orders. |
| 12 | `public.payments` | 0 | 51 | 0 (`51` updated) | **51** | Pre-existing Preview payments; `utr_reference` (`PRVUTR0000XX`) and `payer_name` sanitized in-place. |
| 13 | `public.payment_events` | 0 | 127 | 0 | **127** | Pre-existing Preview payment event history; untouched by clone script. |
| 14 | `public.payment_screenshots` | *(Table not in Oct 28 dump)* | 12 | +23 (`12` updated) | **35** | `12` pre-existing Preview rows updated + `23` synthetic rows inserted so all `35` `SUBMITTED`/`VERIFIED` payments have synthetic PNGs. |
| 15 | `public.payment_recovery_tokens` | *(Table not in Oct 28 dump)* | 2 | 0 | **2** | Pre-existing Preview recovery tokens (created `2026-11-01`); untouched. |
| 16 | `public.tickets` | 0 | 36 | 0 | **36** | Pre-existing Preview tickets (`SSFI-000001`..`SSFI-000036`); untouched (`0` contact overrides present). |
| 17 | `public.ticket_deliveries` | 0 | 52 | 0 (`52` updated) | **52** | Pre-existing Preview delivery logs; `recipient` and `rendered_content` sanitized in-place. |
| 18 | `public.ticket_verifications` | 0 | 0 | 0 | **0** | Empty. |
| 19 | `public.seller_messages` | 2 | 12 | 0 | **12** | Pre-existing Preview seller messages; untouched. |
| 20 | `public.order_collaboration_notes` | *(Table not in Oct 28 dump)* | 0 | +2 | **2** | `2` synthetic Preview collaboration notes inserted by script on order `d8168da2-...`. |
| 21 | `public.system_settings` | *(Table not in Oct 28 dump)* | 2 | +1 (`1` updated) | **3** | Updated `customer_email_live_enabled = false` + inserted `preview_data_mirror_metadata`. |
| 22 | `public.customer_email_outbox` | *(Table not in Oct 28 dump)* | 38 | 0 (`38` updated) | **38** | Pre-existing Preview outbox rows; `recipient`, `body_text`, and `body_html` sanitized in-place. |
| 23 | `public.audit_logs` | 0 | 270 | 0 | **270** | Pre-existing Preview audit trail (`2026-10-29T09:40:59Z`..`2026-11-07T07:22:59Z`); untouched by clone script. |

---

## 5. Backup and Restore Limitations

**Classification:** **`PARTIALLY VERIFIED` (`NOT RESTORE-VERIFIED`)**

An inspection of [`backups/preview-database-backup-20261107.json`](file:///f:/PROJECT/Lucky%20Draw/backups/preview-database-backup-20261107.json) (`909,075` bytes, SHA-256 `63cece903e29690c13a9efb08365569d99519dc40aaa800f0a5aa6ceb6e858bf`) established the following recovery capabilities and limitations:

| Backup Dimension | Coverage Status | Technical Assessment |
| :--- | :--- | :--- |
| **1. All 23 `public` Tables Represented?** | **`VERIFIED`** | All `23` tables and `100%` of their pre-script rows (`686` total rows, since no table exceeded the `5,000`-row query limit) are serialized as complete JSON objects in `backup.tables.<table_name>`. |
| **2. Binary Storage Objects Recoverable?** | **`FAILED`** | [`inspect_and_backup_preview.mjs`](file:///C:/Users/Joseph/.gemini/antigravity/brain/f1fe0dbc-6633-4b76-b6b7-fdb3af5bbb02/scratch/inspect_and_backup_preview.mjs#L89-L94) called `admin.storage.from(b.name).list("", { limit: 500 })` — it did **not** call `.download(path)`. When `execute_preview_clone_and_sanitization.mjs` subsequently ran `.upload(path, syntheticPngBuffer, { upsert: true })`, the original binary contents of the `12` pre-existing `payment-screenshots` files and `4` pre-existing `seller-payment-qrs` files in Preview storage were permanently overwritten. |
| **3. Is Object Metadata Sufficient to Reconstruct Storage?** | **`PARTIALLY VERIFIED`** | Metadata in `backup.tables.payment_screenshots` (`storage_path`, `mime_type`, `byte_size`, `sha256_checksum`) and `backup.bucketObjects` is sufficient to reconstruct **placeholder/synthetic binary objects** at the exact pre-script storage paths, but **cannot** reconstruct the original photographic image bytes. |
| **4. Sequences, Indexes, Constraints, Policies, Triggers, and RPC Definitions Covered in Backup JSON?** | **`FAILED` (In JSON Backup) / `PARTIALLY VERIFIED` (Via Repo Migrations)** | `preview-database-backup-20261107.json` is a PostgREST data-only JSON export; it contains **zero** DDL (no sequences, indexes, PK/FK/CHECK constraints, RLS policies, triggers, or PL/pgSQL functions). Reconstructing schema objects requires combining [`backups/production-public-schema.sql`](file:///f:/PROJECT/Lucky%20Draw/backups/production-public-schema.sql) with the `12` migration files in [`supabase/migrations/`](file:///f:/PROJECT/Lucky%20Draw/supabase/migrations/). |
| **5. Is a Disposable Restore Test Possible Without Touching Production or Active Preview?** | **`VERIFIED` (Feasible, Not Yet Executed)** | Yes: a disposable restore test can be performed safely against a local Docker PostgreSQL / `supabase start` container or an isolated temporary schema by replaying `backups/production-public-schema.sql` + `supabase/migrations/*.sql` and importing the `686` rows from `backups/preview-database-backup-20261107.json` with `SET session_replication_role = replica;`, without touching `fohpqheglxhfdecadhzw` or `jiyuiydzsfydjklosvvq`. Per the freeze instructions, this restore has **not** been executed. |

---

## 6. RPC Permission Analysis (`campaigns` and `prizes` `public.is_staff(uuid)` Failure)

**Classification:** **`VERIFIED`**

### 6.1 Forensic Root Cause

1. **RLS Policy Definitions ([`backups/production-public-schema.sql`](file:///f:/PROJECT/Lucky%20Draw/backups/production-public-schema.sql#L1331-L1391)):**
   ```sql
   CREATE POLICY "campaigns_public_read" ON "public"."campaigns"
     FOR SELECT USING (
       ("status" = 'ACTIVE'::"public"."campaign_status")
       OR "public"."is_staff"("auth"."uid"())
     );

   CREATE POLICY "prizes_public_read" ON "public"."prizes"
     FOR SELECT USING (
       EXISTS (
         SELECT 1 FROM "public"."campaigns" "c"
         WHERE ("c"."id" = "prizes"."campaign_id")
           AND (("c"."status" = 'ACTIVE'::"public"."campaign_status") OR "public"."is_staff"("auth"."uid"()))
       )
     );
   ```
   Notice that both policies omit `TO <role>`, which defaults to `TO PUBLIC` (applying to `anon`, `authenticated`, and any non-bypassrls role).
2. **Function Security & Grants ([`supabase/migrations/202610300001_p0_security_remediation.sql`](file:///f:/PROJECT/Lucky%20Draw/supabase/migrations/202610300001_p0_security_remediation.sql#L97-L151)):**
   - `public.is_staff(p_user_id uuid)` is defined as:
     - `LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''`
     - Inside the body, it checks `auth.role()` and `auth.uid()`, returning `false` if `auth.uid() IS NULL` (which is always true for `anon`).
   - However, lines 150–151 of `202610300001_p0_security_remediation.sql` executed:
     ```sql
     revoke all on function public.is_staff(uuid) from public, anon;
     grant execute on function public.is_staff(uuid) to authenticated, service_role;
     ```
3. **Why `anon` Queries Fail with `42501: permission denied for function is_staff`:**
   - When an unauthenticated (`anon`) client queries `public.campaigns` or `public.prizes` via PostgREST, PostgreSQL checks execution permissions for all functions referenced in the applicable `SELECT` RLS policy (`campaigns_public_read` / `prizes_public_read`). Because `anon` lacks `EXECUTE` privilege on `public.is_staff(uuid)`, PostgreSQL immediately aborts the query with SQLSTATE `42501: permission denied for function is_staff`.
   - Note also lines 1578 and 1626 of `backups/production-public-schema.sql`: `anon` and `authenticated` also need table-level `SELECT` privilege where direct PostgREST access is intended (currently Next.js public pages `(public)/page.tsx` and `/buy/page.tsx` work only because they query `campaigns` and `prizes` server-side using `createSupabaseAdminClient()`, which uses `service_role` with `BYPASSRLS`).

### 6.2 Least-Privilege Remediation Design (Superior to Granting `anon` Execute on `is_staff`)

**Why `supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql` Should Be Improved Before Any Future Execution:**
- Draft migration `202611070002` proposed `GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO anon, authenticated, service_role;`.
- While safe in practice (because `is_staff` returns `false` when `auth.uid() IS NULL`), granting `anon` `EXECUTE` permission on a `SECURITY DEFINER` staff-check function is **not** strict least privilege — `anon` never needs to call `public.is_staff(uuid)`.
- **True Least-Privilege Solution:** Keep `REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;` intact, and split the RLS policies on `public.campaigns` and `public.prizes` by role so `anon` policies never reference `public.is_staff(uuid)`:
  ```sql
  -- 1. Keep public.is_staff(uuid) restricted to authenticated & service_role ONLY
  REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;

  -- 2. Campaigns: public active read (zero SECURITY DEFINER calls) + authenticated staff read
  DROP POLICY IF EXISTS "campaigns_public_read" ON public.campaigns;
  CREATE POLICY "campaigns_public_read" ON public.campaigns
    FOR SELECT TO anon, authenticated
    USING (status = 'ACTIVE'::public.campaign_status);

  DROP POLICY IF EXISTS "campaigns_staff_read" ON public.campaigns;
  CREATE POLICY "campaigns_staff_read" ON public.campaigns
    FOR SELECT TO authenticated
    USING (public.is_staff(auth.uid()));

  -- 3. Prizes: public active read (zero SECURITY DEFINER calls) + authenticated staff read
  DROP POLICY IF EXISTS "prizes_public_read" ON public.prizes;
  CREATE POLICY "prizes_public_read" ON public.prizes
    FOR SELECT TO anon, authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.campaigns c
        WHERE c.id = prizes.campaign_id
          AND c.status = 'ACTIVE'::public.campaign_status
      )
    );

  DROP POLICY IF EXISTS "prizes_staff_read" ON public.prizes;
  CREATE POLICY "prizes_staff_read" ON public.prizes
    FOR SELECT TO authenticated
    USING (public.is_staff(auth.uid()));
  ```

---

## 7. Consolidated Security Findings

| ID | Severity | Finding Title | Status |
| :--- | :---: | :--- | :--- |
| **F-01** | **HIGH** | **16 Historical Preview Orders Retain Non-Synthetic `snapshot_upi_id` (`ssfi******@okaxis` [7], `8810******@ptyes` [9]) and `snapshot_account_name` Values** — Exposed to `SUPER_ADMIN`, `ADMIN`, and `FUNDRAISING_MANAGER` on `/admin/payments` and `/admin/payments/[paymentId]`, and exposed on `/buy/order/[orderId]` and `/seller/orders/[orderId]/payment` for the `4` historical orders still in `PENDING_PAYMENT` status (`ORD-2026-000036`, `000041`, `000042`, `000043`), including inside dynamically generated UPI QR data URLs. | **`FAILED`** |
| **F-02** | **HIGH** | **Clone Provenance Misclassification** — No live Production (`fohpqheglxhfdecadhzw`) connection or current Production data dump was used. `backups/production-public-data-before-release.sql` is an empty-orders `2026-10-28` pre-release seed dump (`20` rows). All `51` orders, `52` customers, and `36` tickets in Preview (`jiyuiydzsfydjklosvvq`) originated from pre-existing Preview test/staging data (`2026-10-29`..`2026-11-07`) sanitized in-place. Current parity with live Production business data is **`NOT VERIFIED`**. | **`FAILED`** |
| **F-03** | **MEDIUM** | **Public Order Page (`/buy/order/[orderId]`) Relies Solely on UUIDv4 Secrecy Using `service_role` Client** — `src/app/buy/order/[orderId]/page.tsx` queries `public.orders` via `createSupabaseAdminClient()` by `orderId` without requiring a signed session cookie or recovery token. Anyone possessing an `orderId` UUID can view that order's status, masked/synthetic customer contact info, and (if `PENDING_PAYMENT` or `FAILED`) its `snapshot_upi_id`. | **`PARTIALLY VERIFIED`** |
| **F-04** | **MEDIUM** | **Pre-Clone Backup (`backups/preview-database-backup-20261107.json`) Lacks Binary Storage Blobs and DDL** — While all `23` tables (`686` rows) are backed up in JSON, the `12` pre-existing `payment-screenshots` files and `4` pre-existing `seller-payment-qrs` files were overwritten in storage without downloading their binary bytes first, and the backup has not been restore-tested in a disposable database. | **`PARTIALLY VERIFIED` (`NOT RESTORE-VERIFIED`)** |
| **F-05** | **LOW** | **`campaigns_public_read` and `prizes_public_read` RLS Policies Reference `public.is_staff(auth.uid())` for `anon` Callers** — Causes `42501: permission denied for function is_staff` when `anon` queries `campaigns` or `prizes` directly via PostgREST. | **`FAILED`** |
| **F-06** | **INFO** | **Cross-Seller Isolation & Production Air-Gap Verified** — Sellers cannot access other sellers' orders via RLS (`orders_access`) or Seller Portal routes (`.eq("seller_id", seller.id)`), `SUPER_ADMIN`-only screenshot download is enforced and audited, and Production (`fohpqheglxhfdecadhzw` and `origin/main`) remained `100%` untouched. | **`VERIFIED`** |

---

## 8. Recommended Remediation Plan

> [!IMPORTANT]
> **No remediation steps have been executed. Every item below requires explicit Project Owner authorization before execution.**

1. **Remediation R-1 — Sanitize the 16 Historical `public.orders` Snapshot Rows in Preview (`jiyuiydzsfydjklosvvq`):**
   - Execute a single atomic transaction in the Preview Supabase SQL Editor (`jiyuiydzsfydjklosvvq` only) that temporarily disables `trg_protect_order_payment_snapshot`, updates the `16` rows in `public.orders` (`ORD-2026-000031`..`ORD-2026-000046`) so `snapshot_upi_id`, `snapshot_account_name`, and `snapshot_qr_storage_path` match the synthetic Preview values of their attributed seller (`preview.seller007@upi` / `[PREVIEW TEST] SELLER-007 Account` for the `7` `SELLER-007` orders; `preview.seller008@upi` / `[PREVIEW TEST] SELLER-008 Account` for the `9` `SELLER-008` orders), and immediately re-enables `trg_protect_order_payment_snapshot` before `COMMIT`.
2. **Remediation R-2 — Replace `anon` Grant on `public.is_staff(uuid)` with Role-Scoped RLS Policies on `campaigns` and `prizes`:**
   - Update `supabase/migrations/202611070002_preview_clone_alignment_and_isolation.sql` to **remove** `GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO anon` and instead split `campaigns_public_read` / `prizes_public_read` into `TO anon, authenticated USING (status = 'ACTIVE')` and `TO authenticated USING (public.is_staff(auth.uid()))` (as specified in Section 6.2).
3. **Remediation R-3 — Decide Whether True Production-to-Preview Data Sync Is Required:**
   - If the current `51` sanitized Preview orders are sufficient for Preview testing, update `system_settings.preview_data_mirror_metadata` and documentation to accurately label the dataset as `IN_PLACE_SANITIZED_PREVIEW_DATASET` rather than a live Production clone.
   - If an actual clone of current live Production (`fohpqheglxhfdecadhzw`) is required, a read-only `pg_dump` or read-only export must first be taken from `fohpqheglxhfdecadhzw` into an offline staging file, sanitized **offline** before any insert into Preview, and preceded by a full binary + SQL backup of Preview verified in a local disposable Postgres container.

---

## 9. Explicit Approval Requirements

Before lifting the execution freeze or performing any action on Preview (`jiyuiydzsfydjklosvvq`), the Project Owner must explicitly approve each individual gate below:

- [ ] **Approval Gate 1 (Preview Historical Snapshot SQL Sanitization):** Authorize running the atomic `BEGIN ... ALTER TABLE public.orders DISABLE TRIGGER trg_protect_order_payment_snapshot ... UPDATE ... ENABLE TRIGGER ... COMMIT;` block in Preview (`jiyuiydzsfydjklosvvq`) to scrub the `16` historical `snapshot_upi_id` and `snapshot_account_name` rows.
- [ ] **Approval Gate 2 (Least-Privilege RLS Policy Split on `campaigns` and `prizes`):** Authorize updating and applying `202611070002_preview_clone_alignment_and_isolation.sql` in Preview (`jiyuiydzsfydjklosvvq`) using the role-split RLS policies (without granting `anon` execute on `public.is_staff`).
- [ ] **Approval Gate 3 (Provenance & Dataset Acceptance):** Confirm whether to retain the current sanitized `51`-order Preview dataset (with corrected provenance metadata) or schedule a supervised, offline-sanitized export from Production (`fohpqheglxhfdecadhzw`).
- [ ] **Approval Gate 4 (Git Commit & Preview Deployment):** Authorize fixing local `git config user.email` and committing the audit documentation and updated migration file to `preview/production-mirror`.

