# SSFI Lucky Draw — Production Readiness Audit Report

**Date of Audit**: 31 October 2026  
**Auditor**: Senior Full-Stack Engineer, Software Architect, QA & Production Release Manager  
**Branch**: `deploy/ssfi-homepage-preview`  
**Target Repository**: `rose1996iv/ssfiticket`  
**Target Production Launch**: 1 November 2026, 00:00 IST  
**Draw Ceremony Date**: 19 December 2026  

---

## Executive Summary

The SSFI Lucky Draw fundraising platform has undergone an exhaustive, full-stack **Production Readiness Audit** across all 8 core operational areas. The audit inspected source code, database migration definitions, security access controls, delivery mechanisms, background schedules, and environment configurations.

### Key Audit Findings & Remediations Applied:
1. **Mock Payment Fail-Closed Enforcement**: Hardened `isMockPaymentMode()` in `src/lib/config/payment.ts` and server actions (`publicOrder.ts`, `operations.ts`) so that if `VERCEL_ENV === "production"`, mock payments and test references are strictly and unconditionally forbidden, even in the event of accidental environment misconfiguration.
2. **Customer Email Delivery Fail-Closed Hardening**: Enforced that in Production (`VERCEL_ENV === "production"`), customer email delivery operates exclusively in live mode via the Google OAuth 2.0 Gmail REST API. The simulation fallback banner is strictly suppressed in Production.
3. **WhatsApp Dispatch Database Integrity**: Corrected WhatsApp Click-to-Chat status tracking so that manual confirmation transitions `ticket_deliveries.status` to `DELIVERED` (a valid PostgreSQL enum value in `public.delivery_status`), eliminating enum syntax exceptions while preserving full audit metadata.
4. **Public Verification Route Completeness**: Created `src/app/verify/page.tsx` as an interactive public search portal, eliminating 404 responses when visitors navigate directly to `/verify`.
5. **Zero Disruption to Approved UI/UX**: The approved burgundy (`#7c1619`) and gold (`#d6a23b`) visual design, countdown components, marketing copy, and customer forms remain 100% intact.
6. **Automated Test Suite**: 208 of 208 unit and integration tests passing (`node --test`), TypeScript check passed cleanly, and Next.js Turbopack build succeeds across all 30 routes.

---

## Area 1: Payment Processing

### 1.1 Official UPI Account Verification
- **Payee Name**: `HLAWN THA DAWT` (Official verified payee)
- **UPI ID**: `6909251270@ptaxis`
- **Currency**: `INR` (₹)
- **Support Email**: `Senthangstudents@gmail.com`
- **Official QR Image Asset**: `/upi_qr.jpeg` (persisted in `public/upi_qr.jpeg`, scannable and layout-tested)

### 1.2 Mock / Simulation Inventory & Isolation
| Component / File | Identified Behavior | Preview/Dev Behavior | Production Behavior | Isolation Mechanism |
|---|---|---|---|---|
| `src/lib/config/payment.ts` | `isMockPaymentMode()` | Returns `true` by default or via `NEXT_PUBLIC_MOCK_PAYMENTS=true` | Returns `false` unconditionally | `VERCEL_ENV === "production"` fail-closed check |
| `src/server/actions/publicOrder.ts` | UTR validation bypass (`TEST...`, `MOCK...`) | Permits simulated UTR references for testing | Strict rejection; all references sent to database | `!isProd && manualUpiConfig.isMock` guard |
| `src/server/actions/operations.ts` | Seller UTR validation bypass | Permits simulated UTR references for testing | Strict rejection; all references sent to database | `!isProd && manualUpiConfig.isMock` guard |
| `src/components/payment/PublicUpiPaymentForm.tsx` | Mock fill helper buttons | Renders test helper buttons | Hidden; real UPI instructions only | `manualUpiConfig.isMock === false` |
| `src/components/seller/SellerOrderPaymentForm.tsx` | Mock fill helper buttons | Renders test helper buttons | Hidden; real UPI instructions only | `manualUpiConfig.isMock === false` |

### 1.3 Real Production Payment Lifecycle
1. **Public Order Creation**: Customer selects ticket quantity (1–100), provides Name, compulsory WhatsApp (7–15 digits ITU-T E.164), and compulsory RFC-compliant Email. Order created via RPC `create_seller_order` with initial status `PENDING_PAYMENT`.
2. **UPI Transfer**: Customer scans `/upi_qr.jpeg` or transfers to `6909251270@ptaxis` via their banking app.
3. **UTR Submission**: Customer inputs 12-digit bank UTR reference. Server action `submitPublicUpiPayment` executes RPC `submit_manual_upi`, transitioning order to `PAYMENT_SUBMITTED` and creating payment record with status `SUBMITTED`.
4. **Staff Manual Review**: Authorized staff (`SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`) review incoming bank statements against submitted UTR references in `/admin/payments`.
5. **Atomic Verification**: Staff clicks "Verify Payment", triggering RPC `verify_payment_and_issue` with verified actor ID.

---

## Area 2: Ticket Issuance & Database Integrity

### 2.1 Atomic Ticket Number Assignment
- **Sequence**: Database sequence `ssfi_ticket_number_sequence` with `maxvalue 999999`.
- **Formatting**: 6-digit padded string formatted as `SSFI-000001` through `SSFI-999999`.
- **Atomicity**: Executed inside `verify_payment_and_issue` PostgreSQL function within a single transaction. Tickets are generated using `generate_series`, guaranteeing zero gaps and zero duplicates.
- **Capacity Decrement**: Campaign `sold_ticket_count` is atomically incremented by ticket quantity; orders exceeding remaining capacity are rejected.

### 2.2 Security & Access Controls (RLS)
- **Least Privilege Grants**:
  - Direct `INSERT`, `UPDATE`, `DELETE` on `orders`, `payments`, `tickets`, `ticket_deliveries`, `audit_logs` are revoked from `anon` and `authenticated`.
  - Sensitive state transitions restricted exclusively to `service_role` via audited security-definer routines (`verify_payment_and_issue`, `reject_payment`, `issue_tickets`, `create_seller_order`, `submit_manual_upi`).
- **Audit Logging**: Every state change (order creation, UTR submission, verification, rejection, ticket voiding, delivery dispatch) writes immutable audit records to `public.audit_logs`.

---

## Area 3: Customer Email Delivery

### 3.1 Gmail REST API Provider Architecture
- **Protocol**: Direct HTTPS requests to `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`.
- **Authentication**: Google OAuth 2.0 refresh token exchange targeting `https://oauth2.googleapis.com/token`.
- **Sender Identity**: Senthang Students Fellowship India (`Senthangstudents@gmail.com`).
- **MIME Formatting**: RFC 2822 multipart/alternative (plain-text and rich HTML) encoded with RFC 4648 Base64URL without padding.

### 3.2 Environment Isolation & Safety Gates
| Environment | Configuration Required | Real Email Behavior | Failsafe / Fallback |
|---|---|---|---|
| **Vercel Preview** | `GMAIL_PREVIEW_REAL_SEND_ENABLED=true` + `GMAIL_PREVIEW_ALLOWED_RECIPIENT=<staff_email>` | Transmits ONLY to configured allowlist recipient | Safely simulated dry-run if recipient does not match |
| **Vercel Production** | `GMAIL_API_CLIENT_ID`, `GMAIL_API_CLIENT_SECRET`, `GMAIL_API_REFRESH_TOKEN` | Transmits live confirmation email to real customer | Returns `FAILED` status without breaking ticket issuance |

### 3.3 Email Template Specifications
- **Subject**: `[SSFI Lucky Draw] Official Ticket Confirmation — Order <order_number>`
- **Confirmed Draw Date**: **19 December 2026**
- **Support Email**: `Senthangstudents@gmail.com`
- **Multi-Ticket Formatting**: Dedicated card per ticket displaying ticket number and clickable direct online verification link (`https://ssfiticket.vercel.app/verify/<ticket_number>`).
- **Zero Simulation Banner in Production**: Hardened `renderEmailTicketMessage` ensures `simulationBanner` is strictly empty in Production.

---

## Area 4: WhatsApp Ticket Distribution

### 4.1 Solution Architecture
- **100% Free wa.me Click-to-Chat**: Generates a standard universal WhatsApp deep link: `https://wa.me/<e164_phone>?text=<encoded_message>`.
- **Zero Third-Party API Costs**: No WhatsApp Business Cloud API fees or per-conversation template charges.
- **Manual Staff / Seller Dispatch**: Available directly in Admin Order view (`/admin/orders/[orderId]`), Seller Workspace (`/seller/orders/[orderId]`), and Customer Confirmation view (`/buy/order/[orderId]`).

### 4.2 Message Format & Content
- **Header**: `*SSFI LUCKY DRAW — TICKET CONFIRMATION*`
- **Draw Date**: `*Confirmed Draw Date:* 19 December 2026`
- **Ticket Audit Links**: Lists every allocated ticket with direct verification URL: `• *SSFI-000001*: https://ssfiticket.vercel.app/verify/SSFI-000001`
- **Official Channels**: Links to official SSFI YouTube (`@SenthangStudentsSSFI`) and Facebook (`senthangstudents`).

### 4.3 Database Status Synchronization
- **PostgreSQL Enum Compatibility**: Database column `ticket_deliveries.status` utilizes `public.delivery_status` (`'PENDING'`, `'SENT'`, `'DELIVERED'`, `'FAILED'`, `'SIMULATED'`).
- **Status Updates**:
  - Clicking "Send via WhatsApp" records audit log `WHATSAPP_LINK_OPENED` and updates metadata.
  - Clicking "Mark as Sent" records audit log `TICKET_DELIVERY_MANUALLY_SENT` and updates `ticket_deliveries.status` to `DELIVERED` with `metadata.whatsapp_action = "MANUALLY_SENT"`.

---

## Area 5: QR Code Verification

### 5.1 Verification Engine & Routing
- **Public Index Route**: `/verify` (`src/app/verify/page.tsx`) provides an interactive ticket lookup form.
- **Ticket Verification Route**: `/verify/[ticketNumber]` (`src/app/verify/[ticketNumber]/page.tsx`) queries the database and renders real-time validity status.
- **Customer Privacy Protection**: Verification view displays ticket validity, campaign name, and issuance date. Customer PII (name, phone, email) is strictly excluded from public display.

### 5.2 Dynamic QR Generation
- Generates high-contrast scannable QR code (`dark: "#7c1619"`, `light: "#ffffff"`) encoding the exact verification URL.
- Environment-aware URL generator ensures QR codes generated in Production point to `https://ssfiticket.vercel.app/verify/<ticketNumber>`.

---

## Area 6: Admin & Seller Operations

### 6.1 Role-Based Access Control (RBAC)
- Supported roles: `SUPER_ADMIN`, `ADMIN`, `FUNDRAISING_MANAGER`, `SELLER`, `CUSTOMER`.
- Enforced on server actions and page layouts via `requireRole` and `requireAnyRole`.
- Role enumeration defense: `public.has_role()` and `public.is_staff()` enforce caller isolation and reject unauthenticated enumeration.

### 6.2 Seller Operations & Messaging Immutability
- Active seller validation enforced on all referral orders.
- Seller messaging protected by database before-update trigger: subject, body, sender, recipient, and parent IDs are strictly immutable. Only `read_at` and `archived_at` may be updated by the recipient.

### 6.3 Secure Data Exports
- Automated exports for Orders, Payments, and Tickets support CSV, Excel (XLSX), and PDF formats.
- **Formula Injection Defense**: `sanitizeForSpreadsheet()` prefixes cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` with a single quote.
- **RFC 4180 Compliance**: UTF-8 BOM (`\uFEFF`) included in all CSV files for Excel compatibility.

---

## Area 7: Campaign Schedule & Automation

### 7.1 Official Timeline
- **Ticket Sales Opening**: **1 November 2026, 00:00 IST**
- **Grand Draw Ceremony**: **19 December 2026**

### 7.2 Automation Architecture (Vercel Hobby Plan Compatibility)
- **Pre-Flight On-Demand Synchronization**: Order creation RPCs (`create_seller_order`) and server actions (`publicOrder.ts`, `operations.ts`) invoke `process_scheduled_campaign_transitions()` prior to order creation. Transitions occur dynamically upon visitor requests, independent of external cron reliability.
- **Cron API Endpoint**: `/api/cron/campaign-schedule` supports automated triggers from Vercel Cron or GitHub Actions. Protected in Production by `CRON_SECRET` authorization header.

---

## Area 8: Environment Configuration Matrix

| Environment Variable | Description | Preview Configuration (`jiyuiydzsfydjklosvvq`) | Production Configuration (`fohpqheglxhfdecadhzw`) | Client/Server Scope |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://jiyuiydzsfydjklosvvq.supabase.co` | `https://fohpqheglxhfdecadhzw.supabase.co` | Public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Anon Key | Preview Anon Key | Production Anon Key | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key | Preview Service Role Key | Production Service Role Key | Server-Only Secret |
| `NEXT_PUBLIC_APP_URL` | Canonical Application Domain | Preview deployment URL or auto-detected | `https://ssfiticket.vercel.app` | Public |
| `NEXT_PUBLIC_SSFI_UPI_ID` | Official UPI ID | `6909251270@ptaxis` | `6909251270@ptaxis` | Public |
| `NEXT_PUBLIC_SSFI_UPI_DISPLAY_NAME` | Official Payee Name | `HLAWN THA DAWT` | `HLAWN THA DAWT` | Public |
| `NEXT_PUBLIC_SSFI_UPI_QR_PATH` | Static QR asset path | `/upi_qr.jpeg` | `/upi_qr.jpeg` | Public |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Official Support Email | `Senthangstudents@gmail.com` | `Senthangstudents@gmail.com` | Public |
| `NEXT_PUBLIC_MOCK_PAYMENTS` | Mock payment mode toggle | `"true"` | `"false"` (or unset; code enforces fail-closed) | Public |
| `GMAIL_API_CLIENT_ID` | Google OAuth Client ID | Preview OAuth Client ID | Production OAuth Client ID | Server-Only Secret |
| `GMAIL_API_CLIENT_SECRET` | Google OAuth Client Secret | Preview OAuth Client Secret | Production OAuth Client Secret | Server-Only Secret |
| `GMAIL_API_REFRESH_TOKEN` | Google OAuth Refresh Token | Preview OAuth Refresh Token | Production OAuth Refresh Token (`Senthangstudents@gmail.com`) | Server-Only Secret |
| `GMAIL_PREVIEW_REAL_SEND_ENABLED` | Preview real sending gate | `"true"` | Not applicable in production | Server-Only Secret |
| `GMAIL_PREVIEW_ALLOWED_RECIPIENT` | Preview recipient allowlist | Verified staff email address | Not applicable in production | Server-Only Secret |
| `CRON_SECRET` | Cron endpoint authentication | Test secret string | Production cryptographically secure secret | Server-Only Secret |

---

## Conclusion & Readiness Verdict

| Audit Domain | Pre-Audit Status | Post-Remediation Status | Verdict |
|---|---|---|---|
| 1. Payment Processing | Operational (Mock active in preview) | Hardened fail-closed in production | **READY** |
| 2. Ticket Issuance & DB Integrity | Atomic & Verified | Verified (0 gaps, 0 duplicates) | **READY** |
| 3. Customer Email Delivery | Gmail API implemented | Fail-closed in prod, multi-ticket polish | **READY** |
| 4. WhatsApp Distribution | wa.me click-to-chat active | Enum compatibility hardened | **READY** |
| 5. QR Code Verification | Individual ticket route only | Added `/verify` public portal | **READY** |
| 6. Admin & Seller Operations | Full RBAC & CSV sanitization | Verified & passing tests | **READY** |
| 7. Campaign Schedule & Cron | Aligned to 1 Nov 2026 | On-demand + cron redundancy | **READY** |
| 8. Environment Configuration | Dual project separation | Fully documented & verified | **READY** |

**OVERALL READINESS STATUS: PRODUCTION RELEASE CANDIDATE READY FOR OWNER SIGN-OFF**
