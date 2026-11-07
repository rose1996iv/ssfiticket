# SSFI Lucky Draw — Phase 8B Final Screenshot Download Filename & Preview Deployment Report

**Report Generation Date:** 2026-11-08T01:13:00+05:30  
**Target Environment:** Preview Supabase (`jiyuiydzsfydjklosvvq`) & Vercel Preview  
**Target Git Branch:** `preview/production-mirror`  
**GitHub Repository:** `rose1996iv/ssfiticket`  
**Vercel Project:** `ssfiticket` (`rose1996ivs-projects`)  
**Production Supabase Ref:** `fohpqheglxhfdecadhzw` (STRICTLY AIR-GAPPED; UNTOUCHED)  
**Status:** **VERIFIED PASS (100%)**

---

## 1. Executive Summary & Approved Specification

This operation finalized the Admin Payment Screenshot Download Filename enhancement to conform strictly with the project owner's approved specification:

### Filename Specification: `{ORDER_NUMBER}.{ORIGINAL_EXTENSION}`

#### Concrete Examples:
- `ORD-2026-000042.png`
- `ORD-2026-000043.jpg`
- `ORD-2026-000044.jpeg`
- `ORD-2026-000045.webp`

#### Architectural & Security Invariants:
1. **PII Elimination:** Customer names never appear in the download filename or download audit logs.
2. **Suffix Removal:** The `Payment-Proof` suffix has been completely removed.
3. **Extension Preservation:** The original file extension (`png`, `jpg`, `jpeg`, `webp`) is preserved from the storage object path and validated MIME type.
4. **Storage Object Immutability:** The underlying Supabase Storage object key (UUID-based, e.g. `56d2776f-3a6f-49c5-a1ca-ff6468866751.png`) is completely unchanged. Only the `Content-Disposition` response header parameter is altered.
5. **RFC 6266 / RFC 5987 Compliance:** Generates standards-compliant download headers with ASCII fallback and UTF-8 encoding.
6. **Strict Role Authorization:** Only `SUPER_ADMIN` can download screenshots. `ADMIN` and `FUNDRAISING_MANAGER` remain view-only. `SELLER`, `CUSTOMER`, and `ANONYMOUS` users are denied download and view access.

---

## 2. Modified Codebase Files

| File | Purpose & Changes |
| :--- | :--- |
| `src/lib/payment/screenshotDownload.ts` | Updated `buildSafeScreenshotDownloadFilename` to produce `{ORDER_NUMBER}.{ORIGINAL_EXTENSION}` with `Screenshot.{ext}` fallback. Sanitizes order numbers, strips path traversal and control characters, and preserves extensions. Emits RFC 6266 headers. |
| `src/server/actions/paymentScreenshot.ts` | Streamlined `lookupPaymentAndScreenshot` to query `orders(id, order_number)` without requesting customer PII. Passes order number to the download execution flow. |
| `src/components/admin/AdminPaymentScreenshot.tsx` | Updated fallback filenames in `AdminPaymentScreenshotDownloadButton` and `AdminPaymentScreenshot` from legacy formats to `Screenshot.jpg`. |
| `tests/paymentScreenshot.test.ts` | Added unit and integration tests covering the approved format, extension preservation across all 4 formats, PII exclusion, fallback handling, path traversal protection, and role authorization. |

---

## 3. Automated Quality Gate & Test Results

All quality gates were executed locally and passed with zero errors prior to commit:

| Gate / Command | Outcome | Details |
| :--- | :---: | :--- |
| `npm test` | **PASS** | 359 tests passed across 26 test suites (0 failed). |
| `npx tsc --noEmit` | **PASS** | 0 TypeScript errors. |
| `npm run lint` | **PASS** | 0 ESLint warnings, 0 errors. |
| `npm run build` | **PASS** | Compiled Next.js 16.4.3 production bundle in 13.6s (25 static and dynamic routes). |

---

## 4. Git Operations & Commit Verification

- **Branch:** `preview/production-mirror`
- **Commit SHA:** `de9b0d10d19277d33d9fc2df0503025ae58f007b`
- **Commit Message:** `fix(admin): use order number for payment screenshot downloads`
- **Destination Remote:** `origin preview/production-mirror` (`https://github.com/rose1996iv/ssfiticket.git`)
- **Push Confirmation:** Successfully pushed `04ccf83..de9b0d1 -> preview/production-mirror`.
- **Branches Prohibited:** `main` and production release branches were not touched.

---

## 5. Vercel Preview Deployment Verification

- **Vercel Project:** `ssfiticket`
- **Vercel Team:** `rose1996ivs-projects`
- **Preview Deployment URL:** `https://ssfiticket-git-preview-production-mirror-rose1996ivs-projects.vercel.app`
- **Deployment ID (`data-dpl-id`):** `Gk8dpskfKhufZAKvYT72nfRezdQA`
- **Edge Node:** `bom1::iad1`
- **HTTP Status:** `200 OK`

### Route Smoke Test Matrix:
| Route | Type | HTTP Status | Verdict |
| :--- | :--- | :---: | :---: |
| `/` (Homepage) | Public | **200 OK** | PASS |
| `/buy` | Public Referral Purchase | **200 OK** | PASS |
| `/verify` | Public Ticket Verification | **200 OK** | PASS |
| `/login` | Staff / Seller Auth | **200 OK** | PASS |
| `/terms` | Campaign Rules | **200 OK** | PASS |
| `/admin` | Protected Administrative Area | **307 Redirect** (`/login`) | PASS |
| `/admin/orders` | Protected Order Index | **307 Redirect** (`/login`) | PASS |
| `/seller` | Protected Seller Portal | **307 Redirect** (`/login`) | PASS |
| `/seller/payments` | Protected Seller Payments | **307 Redirect** (`/login`) | PASS |

---

## 6. Live Payment Screenshot Download Verification

Live verification executed against Preview Supabase (`jiyuiydzsfydjklosvvq`):

1. **Database Query:** Retained test screenshot record for payment `0a2b8481-36bb-42ac-af88-dba8b8a17953` (`ORD-2026-000042`).
2. **Generated Download Filename:** `ORD-2026-000042.png`
3. **Content-Disposition Header:**
   ```http
   attachment; filename="ORD-2026-000042.png"; filename*=UTF-8''ORD-2026-000042.png
   ```
4. **Signed URL Generation:** Generated 60-second TTL signed URL against private bucket `payment-screenshots`.
5. **HTTP Binary Fetch:**
   - Status: `200 OK`
   - Content-Type: `image/png`
   - Bytes Received: `3473` bytes (exact match with database `file_size_bytes`).
   - Magic Bytes Header: `89 50 4E 47 0D 0A 1A 0A` (Valid PNG).
6. **Storage Path Immutability:** Storage object path `56d2776f-3a6f-49c5-a1ca-ff6468866751.png` confirmed completely unmodified.

---

## 7. Role Authorization Verification

| Actor Role | Download Permission | View Permission | Enforcement Status |
| :--- | :---: | :---: | :---: |
| `SUPER_ADMIN` | **ALLOWED** | **ALLOWED** | Verified PASS |
| `ADMIN` | **DENIED** | **ALLOWED** | Verified PASS |
| `FUNDRAISING_MANAGER` | **DENIED** | **ALLOWED** | Verified PASS |
| `SELLER` | **DENIED** | **DENIED** | Verified PASS |
| `CUSTOMER` | **DENIED** | **DENIED** | Verified PASS |
| `ANONYMOUS` | **DENIED** | **DENIED** | Verified PASS |

---

## 8. Safety & Compliance Confirmation

- [x] **Production Supabase Air-Gap:** Project `fohpqheglxhfdecadhzw` was never contacted, queried, or modified.
- [x] **Zero Production Migrations:** No database schemas or records were modified in Production.
- [x] **No Customer PII Exposure:** Customer names and PII are excluded from download filenames, signed URLs, and audit logs.
- [x] **No Production Deployment:** `vercel --prod` was never executed. `main` was not modified or pushed.
- [x] **Secret Hygiene:** Zero tokens, passwords, or private service role keys were committed or exposed.
