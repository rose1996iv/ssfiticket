# SSFI Lucky Draw — Phase 3.3 Physical-Device Four-Role UAT Checklist (Redmi Note 9S)

**Target Device:** Redmi Note 9S (`ecc57eef`, Android 12 / API 31, `android-arm64`)  
**Package:** `org.ssfi.ssfi_lucky_draw_mobile` (`1.0.0+1`)  
**Preview Supabase Project:** `jiyuiydzsfydjklosvvq`  

> **Note:** Phase 3.2 physical-device UAT already verified APK installation, `app.png` launcher icons, cold launch, Android Keystore session restoration, logout persistence, and authoritative `/api/mobile/v1/me` workspace routing for `SUPER_ADMIN`, `ADMIN`, and `SELLER`. Do not repeat those baseline checks unnecessarily. Execute the workflow checks below once the Phase 3.3 `/api/mobile/v1/*` routes are deployed to Preview Vercel.

---

## Pre-Requisite Before Live Device Workflow Execution

- [ ] Authorize and deploy the Phase 3.3 `/api/mobile/v1/*` route handlers to Preview Vercel.
- [ ] Install the updated Phase 3.3 debug APK (`mobile/build/app/outputs/flutter-apk/app-debug.apk`) onto Redmi Note 9S (`adb -s ecc57eef install -r mobile/build/app/outputs/flutter-apk/app-debug.apk`).

---

## 1. `SUPER_ADMIN` Workflow Checklist (`senthangstudents@gmail.com`)

- [ ] **SA-01 (System Governance & Reports):** Open **System Governance** tab → verify live campaign status, verified collection (`₹`), tickets issued (`sold / 1000`), pending payments count, and active/total sellers count match Preview database state.
- [ ] **SA-02 (Users & Seller Lifecycle):** Open **Users & Seller Lifecycle** tab → verify seller directory (`SELLER-001`..`SELLER-007`) and user role badges (`SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`, `SELLER`) render without exposing tokens or secrets.
- [ ] **SA-03 (First Prize Dual Authorization — Policy A):** Open **1st Prize Dual Auth** tab → verify prize title (`1st Prize — ₹10,000 Cash`), draw status, eligible ticket count, and locked snapshot hash status. Confirm Policy A four-eyes notice prevents self-approval if initiated by the same account.
- [ ] **SA-04 (Audit Logs & Screenshot Access):** Open **Audit & Screenshot Access** tab → verify recent audit log events load cleanly and verify `SUPER_ADMIN`-only signed screenshot URL generation for a valid payment UUID with a screenshot on file.

---

## 2. `ADMIN` Workflow Checklist (`admin@ssfi.org`)

- [ ] **AD-01 (Collection Summary):** Open **Collection Summary** tab → verify `Verified Collection ₹`, `Tickets Issued (sold / 1000)`, `Pending Verification`, and `Active Sellers` KPI cards load.
- [ ] **AD-02 (Pending Payment Queue & Detail):** Open **Pending Payments & Issuance** tab → filter by `SUBMITTED`, `VERIFIED`, `FAILED`, `ALL` and tap **Review** / **Details** on a payment item to inspect order number, customer details, attributed seller, UTR reference, screenshot status, and seller advisory review status.
- [ ] **AD-03 (Directory Lookup):** Open **Seller / Customer / Order Lookup** tab → search `SELLER-007` (or an existing order number) and confirm matching records appear.
- [ ] **AD-04 (Payment Verification / Rejection — Synthetic Test Order Only):** Only when testing with an authorized synthetic Preview order in `SUBMITTED` status, verify that **Verify Payment & Issue Tickets** calls `issue_tickets()` and returns sequential `SSFI-XXXXXX` ticket numbers, or **Reject Payment** enforces a `>= 3` char reason.

---

## 3. `SELLER` Workflow Checklist (`seller1@ssfi.org` — `SELLER-007`)

- [ ] **SE-01 (Operational Overview & QR Status):** Open **Operational Overview** tab → confirm `SELLER-007` badge, personal payment QR status (`ACTIVE` / `INACTIVE`), campaign remaining capacity, and seller-scoped KPI tiles (`Tickets Issued`, `Verified Collection`, `Pending Verification`, `Awaiting Payment`).
- [ ] **SE-02 (Seller-Scoped Customer Lookup):** Open **New Manual Sale** tab → search an existing customer from `SELLER-007`'s own orders → tap **Use Details** and confirm name, WhatsApp, and email auto-fill into the order form (and confirm customers belonging only to other sellers do not appear).
- [ ] **SE-03 (Order Creation, Mandatory Screenshot Upload & UTR Submission):** Verify inline validation for invalid phone/email and quantity presets (`1, 5, 10, 20`); verify that selecting a `PENDING_PAYMENT` order displays seller-owned UPI Payee Name, UPI VPA, and `upi://pay` intent string, allows uploading a JPEG/PNG/WebP payment screenshot (`<= 2 MB`) to private storage (`Step 1`), and submits the UTR reference (`Step 2`) transitioning the order to `PAYMENT_SUBMITTED`.
- [ ] **SE-04 (Own Orders & Issued Ticket History):** Open **My Orders & Payments** tab → filter across `ALL`, `PENDING_PAYMENT`, `PAYMENT_SUBMITTED`, `TICKETS_ISSUED` and confirm only `SELLER-007`'s own orders and issued `SSFI-XXXXXX` tickets are displayed.

---

## 4. `CUSTOMER` Workflow Checklist *(Requires Separate Preview Customer Link Authorization)*

- [ ] **CU-00 (Pre-Requisite):** Obtain explicit user authorization to link a synthetic Preview `public.customers` row (`profile_id = <preview_test_user_id>`) in `jiyuiydzsfydjklosvvq`.
- [ ] **CU-01 (Customer Supporter Overview & Empty/Populated States):** Sign in with the linked synthetic customer account → confirm routing to **SSFI • Customer** (*Customer Supporter Workspace*) and verify supporter profile header, issued ticket history (or clear empty state), and certified public winners list (ticket numbers only).
- [ ] **CU-02 (Order History & Payment Status):** Open **My Orders & Payment Status** tab → confirm only the customer's own orders, payment statuses, UTR references, and issued tickets are visible.
- [ ] **CU-03 (Ticket Verification):** Open **Verify Ticket Number** tab → enter a valid `SSFI-XXXXXX` ticket number (and an invalid/non-existent number) → confirm accurate verification status (`Valid & Eligible for Draw` vs `Pending or Not Found`) with zero customer PII exposed.
