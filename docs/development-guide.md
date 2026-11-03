# SSFI Lucky Draw Management System — Developer Guide & Testing Standards

**Document Version:** 2.0.0
**Target Environment:** Node.js 20+ / 22+ LTS &bull; TypeScript 5 &bull; Next.js 16.4.3
**Package Manager:** `npm` (v10+)

---

## 1. Local Development Setup

### 1.1 Prerequisites
- **Node.js:** `v20.x` or `v22.x` LTS (Node 24 LTS supported).
- **npm:** `v10+`.
- **Supabase Account:** Access to a Supabase project or local Supabase CLI instance.
- **Git:** Version control with clean branch management.

### 1.2 Initial Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/rose1996iv/ssfi-lucky-draw.git
   cd "Lucky Draw"
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure `.env.local`:
   Copy `.env.example` to `.env.local` and populate development credentials:
   ```bash
   cp .env.example .env.local
   ```

---

## 2. Available NPM Scripts

| Script | Command | Purpose |
| :--- | :--- | :--- |
| `npm run dev` | `next dev --turbopack` | Starts local Next.js Turbopack development server on `http://localhost:3000`. |
| `npm run build` | `next build` | Compiles optimized production build using Turbopack with full TypeScript checks. |
| `npm run start` | `next start` | Starts compiled production server locally for previewing release builds. |
| `npm run typecheck` | `tsc --noEmit` | Executes strict TypeScript validation across the entire repository. |
| `npm run lint` | `next lint` | Executes ESLint to enforce code style and Next.js best practices. |
| `npm test` | `node --test tests/*.test.ts` | Runs the complete 23-suite automated test runner (310 assertions). |

---

## 3. Automated Test Suite Architecture

The repository contains **23 automated test suites** covering **310 assertions** executed via the native Node.js test runner (`node --test`). Tests require no external test framework dependencies.

To execute all tests:
```bash
npm test
```

### 3.1 Key Test Suites Overview

| Test File | Focus Area | Key Invariants Verified |
| :--- | :--- | :--- |
| `tests/referral.test.ts` | Referral Code Validation | Validates regex format (`SELLER-XXX`), normalization, and active status. |
| `tests/publicOrder.test.ts` | Public Order Flow | Enforces quota limits, seller verification, and snapshot capture. |
| `tests/sellerPaymentQrAndReview.test.ts` | Seller QR & Review | File signature magic byte checks; advisory review state machine. |
| `tests/paymentScreenshot.test.ts` | Proof Upload Pipeline | Size limits, MIME validation, and private bucket isolation. |
| `tests/paymentSubmission.test.ts` | Payment Form Validation | Mandatory screenshot enforcement, optional UTR and payer name. |
| `tests/campaignScheduler.test.ts` | Campaign IST Scheduling | Auto-transitions (`DRAFT` &rarr; `ACTIVE` &rarr; `CLOSED`) and timezone parity. |
| `tests/campaignSettings.test.ts` | Admin Campaign Controls | Schedule window validation, role protection, and capacity constraints. |
| `tests/roleRouting.test.ts` | Workspace Role Guards | Redirects, role escalation prevention, and session verification. |
| `tests/sellerOrder.test.ts` | Seller Direct Orders | Seller order creation, actor attribution, and initial pending states. |
| `tests/customerTransactionalEmail.test.ts` | Email Delivery Templates | HTML receipt generation, masked recipients, and outbox lifecycle. |
| `tests/paymentRecovery.test.ts` | Disconnected Recovery | One-time token generation, expiration, and hash verification. |
| `tests/deployment.test.ts` | Version Skew & Config | App URL resolution, deployment ID embedding, and proxy safety. |

---

## 4. Mobile Device Emulation Testing (Playwright)

To ensure 100% compatibility with physical mobile devices (Android Chrome and iOS Safari):
1. Install Playwright browser dependencies:
   ```bash
   npx playwright install chromium webkit
   ```
2. Run automated Pixel 7 mobile emulation:
   ```bash
   node scratch/test_android_pixel7.js
   ```
3. Emulation verifies:
   - Zero console errors during client navigation.
   - Zero aborted background RSC requests (`net::ERR_ABORTED`).
   - Clean rendering of the order details form on 412x915 viewport.
   - Resilient error boundary behavior with actionable user notices.

---

## 5. Engineering Standards & Conventions

1. **Server Components by Default:**
   All routes are Server Components unless user interactivity (form state, client-side counters, QR rendering) strictly requires `"use client"`.
2. **On-Demand Dynamic Rendering:**
   Transactional pages reading cookies, headers, or query parameters must specify `export const dynamic = "force-dynamic"`.
3. **Prefetch Safety on Dynamic Links:**
   Inter-route navigation links connecting to dynamic transactional pages must specify `prefetch={false}` to avoid aborted background RSC requests on mobile devices.
4. **Zero Client-Side Secrets:**
   Never import `createSupabaseAdminClient()` into client components. Keep privileged database operations inside `src/server/actions/`.
