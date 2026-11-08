# SSFI Lucky Draw — Phase 8C.1: RSK-02 Seller Payment Snapshot Email Remediation Report

> **Status:** REMEDIATED & VERIFIED  
> **Target Environment:** Preview (`preview/production-mirror`)  
> **Preview Supabase Ref:** `jiyuiydzsfydjklosvvq`  
> **Production Supabase Ref:** `fohpqheglxhfdecadhzw` (Air-Gapped — Zero Contact)  
> **Date:** 2026-11-08  
> **Classification:** REMEDIATION & VERIFICATION REPORT (Local Artifact Only)  

---

## 1. Executive Summary

During the Phase 8C Production Readiness Audit, **RSK-02** was identified as a release blocker:
> `enqueueOrderCreatedNotification` in `src/lib/delivery/outbox.ts` hardcoded the central SSFI UPI fallback (`6909251270@ptaxis`, `HLAWN THA DAWT`) instead of reading the order's immutable seller payment snapshot fields (`snapshot_upi_id`, `snapshot_account_name`, `snapshot_payment_instructions`). Customers purchasing tickets via personal seller QRs received confirmation emails instructing payment to the central SSFI account rather than the assigned seller.

In **Phase 8C.1**, this blocker was comprehensively resolved:
1. **Outbox Query & Binding Remediated:** `enqueueOrderCreatedNotification` in `src/lib/delivery/outbox.ts` now queries `snapshot_upi_id`, `snapshot_account_name`, `snapshot_payment_instructions`, `snapshot_seller_display_name`, and `snapshot_seller_code` directly from `public.orders`.
2. **Template Decoupling & Central Fallback Elimination:** `renderEmailOrderCreatedMessage` in `src/lib/delivery/templates.ts` was updated to render seller snapshot UPI details directly and completely eliminated the hardcoded fallback to `"6909251270@ptaxis"`.
3. **Safe Missing-Data Handling:** If an order lacks snapshot data, the email renders a safe notice directing the customer to their authenticated order tracking page to view the active QR code, preventing misleading or incorrect payment routing.
4. **Zero Cross-Seller Leakage:** Strict separation ensures Seller A's payment details are never exposed to Seller B's orders, and historical snapshots remain immune to subsequent seller profile updates.
5. **Comprehensive Automated Verification:** 5 new regression tests were added to `tests/customerTransactionalEmail.test.ts`. All 364 test suite assertions, `npx tsc --noEmit`, `npm run lint`, and `npm run build` passed with zero errors or warnings.

---

## 2. Root Cause Analysis

In Phase 6, the SSFI Lucky Draw architecture transitioned from a central organization payment model to a **decentralized, seller-attributed payment model**, where every seller maintains a personal UPI QR code, and each order captures an immutable snapshot of those details upon creation (`snapshot_upi_id`, `snapshot_account_name`, `snapshot_payment_instructions`, `snapshot_qr_storage_path`).

While the customer checkout UI (`/buy/order/[orderId]`) and the Admin payment verification flow (`/admin/payments/[paymentId]`) were successfully updated to use the seller snapshot, the asynchronous email outbox helper `enqueueOrderCreatedNotification` in `src/lib/delivery/outbox.ts` was left reading:
```typescript
    paymentInstructions: {
      upiId: process.env.NEXT_PUBLIC_SSFI_UPI_ID || "6909251270@ptaxis",
      accountName: process.env.NEXT_PUBLIC_SSFI_UPI_DISPLAY_NAME || "HLAWN THA DAWT",
      instructions: "Transfer exact amount to the official SSFI account and submit your 12-digit UTR on your order page.",
    },
```
Additionally, `renderEmailOrderCreatedMessage` in `src/lib/delivery/templates.ts` contained hardcoded default fallbacks to `"6909251270@ptaxis"`.

---

## 3. Detailed Technical Remediation

### 3.1 `src/lib/delivery/outbox.ts`

**Database Select Query:**
Extended the Supabase query on `public.orders` to include all five payment destination snapshot columns:
```typescript
  const { data: order, error } = await admin
    .from("orders")
    .select(`
      id,
      order_number,
      total_amount_paise,
      created_at,
      status,
      snapshot_upi_id,
      snapshot_account_name,
      snapshot_payment_instructions,
      snapshot_seller_display_name,
      snapshot_seller_code,
      campaigns(name),
      customers(id, full_name, email, phone, whatsapp_number),
      sellers!orders_seller_id_fkey(display_name, seller_code),
      order_items(quantity)
    `)
    .eq("id", orderId)
    .maybeSingle();
```

**Snapshot Derivation & Attribution:**
Extracted snapshot fields and bound them without falling back to global or central values:
```typescript
  // RSK-02 Fix: Strictly derive seller payment details from the immutable order payment snapshot.
  // NEVER use hardcoded central UPI or fall back to global/legacy UPI values.
  const rawUpiId = order.snapshot_upi_id?.trim();
  const rawAccountName = order.snapshot_account_name?.trim();
  const rawInstructions = order.snapshot_payment_instructions?.trim();

  const hasSnapshotUpi = Boolean(rawUpiId && rawUpiId.length > 0);
  const paymentInstructions = hasSnapshotUpi
    ? {
        upiId: rawUpiId!,
        accountName:
          rawAccountName ||
          order.snapshot_seller_display_name?.trim() ||
          seller?.display_name?.trim() ||
          "Assigned Seller",
        instructions:
          rawInstructions ||
          "Transfer exact amount to the assigned seller account and submit your 12-digit UTR on your order page.",
      }
    : undefined;

  const sellerDisplayName = order.snapshot_seller_display_name?.trim() || seller?.display_name?.trim();
  const sellerCode = order.snapshot_seller_code?.trim() || seller?.seller_code?.trim();
  const sellerAttribution = sellerDisplayName
    ? `${sellerDisplayName}${sellerCode ? ` (${sellerCode})` : ""}`
    : null;
```

**Transactional Outbox Metadata:**
Included `snapshot_upi_id` and `snapshot_seller_code` in the queued email job metadata for auditability.

---

### 3.2 `src/lib/delivery/templates.ts`

**Elimination of Central Defaults:**
Removed `"6909251270@ptaxis"` and `"HLAWN THA DAWT"` default fallbacks.
```typescript
  const rawUpiId = payload.paymentInstructions?.upiId?.trim();
  const hasUpiDetails = Boolean(rawUpiId && rawUpiId.length > 0);
  const upiId = hasUpiDetails ? escapeHtml(rawUpiId!) : null;
  const upiName = hasUpiDetails
    ? escapeHtml(payload.paymentInstructions?.accountName?.trim() || "Assigned Seller")
    : null;
  const customInstructions = payload.paymentInstructions?.instructions?.trim()
    ? escapeHtml(payload.paymentInstructions.instructions.trim())
    : null;
```

**Safe Missing-Snapshot Degradation:**
- **When snapshot UPI is present:** Renders plain text and HTML tables displaying the assigned seller's `UPI ID`, `Beneficiary Name`, and custom instructions.
- **When snapshot UPI is missing:** Renders clean guidance instructing the customer:
  > *"Payment instructions could not be loaded automatically. Please open your secure order tracking page to view payment details and submit your payment proof."*  
  Zero bogus or central UPI IDs are emitted.

---

## 4. Verification Evidence

### 4.1 Automated Test Suite Execution

Executed full test suite via `npm test`:
```
ℹ tests 364
ℹ suites 5
ℹ pass 364
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6178.7303
```

### 4.2 Specific RSK-02 Test Cases Added

Five new end-to-end regression tests were added to `tests/customerTransactionalEmail.test.ts`:

1. **`RSK-02: Seller A order email uses Seller A's snapshot UPI and instructions`**
   - Asserts that Order A with `snapshot_upi_id = "sellerA@okaxis"` renders `sellerA@okaxis`, `Seller A Official Store`, and custom instructions in both plain text and HTML.
   - Asserts zero presence of `6909251270@ptaxis` or `HLAWN THA DAWT`.
2. **`RSK-02: Seller B order email uses Seller B's snapshot UPI and instructions`**
   - Asserts that Order B with `snapshot_upi_id = "sellerB@oksbi"` renders `sellerB@oksbi` and `Seller B Enterprises`.
   - Asserts zero presence of Seller A's UPI or central UPI.
3. **`RSK-02: Seller QR updates do not mutate existing order snapshot email details`**
   - Simulates a historical order created with `seller.original@ybl`.
   - Simulates seller later updating their profile to `seller.mutated@icici`.
   - Asserts the historical order email remains strictly bound to `seller.original@ybl`.
4. **`RSK-02: Missing snapshot UPI data fails safely without leaking central UPI or misleading instructions`**
   - Simulates an order with `paymentInstructions = undefined`.
   - Explicitly sets `process.env.NEXT_PUBLIC_SSFI_UPI_ID = "6909251270@ptaxis"`.
   - Asserts that neither plain text nor HTML contains `6909251270@ptaxis` or `HLAWN THA DAWT`.
   - Asserts that the email safely directs the customer to their authenticated order access URL.
5. **`RSK-02: Cross-seller payment information cannot leak across orders`**
   - Renders concurrent Order A (`exclusiveA@bank`) and Order B (`exclusiveB@bank`).
   - Asserts mutual exclusion: zero cross-seller credential leakage.

### 4.3 Static Analysis & Build Verification

- **TypeScript Typecheck:** `npx tsc --noEmit` exited with code `0` (zero type errors).
- **ESLint:** `npm run lint` exited with code `0` (zero lint warnings/errors).
- **Next.js Production Build:** `npm run build` completed successfully in 5.3s:
  - All 25 routes compiled and optimized.
  - Zero dynamic route or server action build errors.

### 4.4 Preview Supabase Synthetic Record Inspection

Read-only inspection of synthetic orders in Preview Supabase (`jiyuiydzsfydjklosvvq`):
```
Checking Preview project ref: jiyuiydzsfydjklosvvq
Retrieved 3 sample orders with snapshot_upi_id:
{
  order_number: 'ORD-2026-931749',
  seller_code: 'SELLER-007',
  display_name: 'Dehradun',
  upi_id: 'preview.seller007@upi',
  account_name: '[PREVIEW TEST] SELLER-007 Account'
}
```
Evaluation of `renderEmailOrderCreatedMessage` against `ORD-2026-931749`:
```
Subject: [SSFI Lucky Draw] Order Received — ORD-2026-931749
Seller Attribution: Dehradun (SELLER-007)
Payment UPI in text: true (preview.seller007@upi)
Payment UPI in HTML: true (preview.seller007@upi)
Central UPI in text: false
Central UPI in HTML: false
```

---

## 5. Security & Isolation Matrix

| Security Property | Requirement | Status | Verification Method |
| :--- | :--- | :---: | :--- |
| **No Central Fallback** | Never fall back to central UPI ID in customer emails | **PASS** | Automated tests asserting absence of `6909251270@ptaxis` |
| **Snapshot Immutability** | Seller profile updates must not change existing order emails | **PASS** | Automated test with mutated seller profile |
| **No Cross-Seller Leakage** | Seller A details must never appear in Seller B's emails | **PASS** | Automated test with distinct synthetic sellers |
| **Safe Degradation** | Missing snapshot data must not produce misleading instructions | **PASS** | Automated test asserting safe guidance pointing to order URL |
| **Idempotency** | Duplicate notifications must not produce duplicate emails | **PASS** | `ORDER_CREATED:${orderId}` key preserved in Outbox |
| **Preview Safety Gates** | Real customer emails must not be sent in non-production | **PASS** | `checkGmailPreviewGate` & `ALLOWED_TEST_EMAIL` preserved |

---

## 6. Files Changed

| File Path | Nature of Change | Lines Changed |
| :--- | :--- | :---: |
| [`src/lib/delivery/outbox.ts`](file:///f:/PROJECT/Lucky%20Draw/src/lib/delivery/outbox.ts) | Added snapshot columns to `orders` select; bound snapshot UPI, account name, and instructions. | +36 / -6 |
| [`src/lib/delivery/templates.ts`](file:///f:/PROJECT/Lucky%20Draw/src/lib/delivery/templates.ts) | Removed central UPI fallback; added safe missing-data degradation for plain text and HTML. | +54 / -15 |
| [`tests/customerTransactionalEmail.test.ts`](file:///f:/PROJECT/Lucky%20Draw/tests/customerTransactionalEmail.test.ts) | Added 5 comprehensive regression tests for RSK-02. | +225 / -0 |
| [`docs/security/PHASE_8C_PRODUCTION_READINESS_AUDIT_REPORT.md`](file:///f:/PROJECT/Lucky%20Draw/docs/security/PHASE_8C_PRODUCTION_READINESS_AUDIT_REPORT.md) | Updated Risk Register & Pre-Production Action Items: RSK-02 marked RESOLVED. | +13 / -11 |

---

## 7. Strict Operational Safety Confirmation

The engineer certifies under strict operational boundaries:
- [x] **Preview branch only:** All work performed exclusively on `preview/production-mirror`.
- [x] **Production untouched:** Zero queries, mutations, or migrations executed against Production Supabase `fohpqheglxhfdecadhzw`.
- [x] **No database migrations:** No schema alterations or migrations executed on either Preview or Production.
- [x] **No real customer emails:** Zero live customer emails dispatched; all verifications used synthetic in-memory payloads.
- [x] **No Git commit or push:** All changes remain unstaged in the local working directory.
- [x] **No Vercel deployment:** No CLI deployment, promotion, or alias change performed.
- [x] **Zero secret exposure:** No environment variable values, credentials, or HMAC keys printed or logged.

