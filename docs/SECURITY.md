# Security Plan

## IMPLEMENTED

The service-role client is in a `server-only` module and reads only `SUPABASE_SERVICE_ROLE_KEY`. The key has no `NEXT_PUBLIC_` prefix and must never reach browser code, logs, commits, or client bundles. Browser and ordinary server clients use the public anonymous key.

## PLANNED

- RLS is enabled on all application tables, with default denial and policies based on authenticated identity, assigned role, and ownership.
- Server actions and route handlers independently authorize role and resource access; UI visibility is not authorization.
- Roles include customer, seller, and administrator boundaries through `profiles`, `roles`, and `profile_roles`.
- Payment provider callbacks will be signature-checked server-side and reconciled to expected amount, currency, order, and idempotency data. **Frontend payment success messages must never be treated as authoritative payment verification.**
- Tickets are unique, server-generated, immutable once issued, non-reusable, and issued through concurrency-safe database logic with audit records.
- Audit logging records sensitive lifecycle actions without storing unnecessary secrets. Customer data is minimized, protected by ownership/staff policies, and retained only as required.
- Public ticket verification returns only a privacy-safe validity/result view; it must not disclose customer contact data, payment details, or internal audit data.

## IMPLEMENTED

The Phase 2 migration enables RLS on all core tables. Security-definer helpers avoid recursive role policies. Customers are restricted to their records, sellers to assigned records, and staff by database role. The `issue_tickets` RPC is executable only by `service_role`, locks order and campaign rows, requires a matching VERIFIED payment and active campaign, uses a non-cycling 1–1000 sequence, inserts atomically, and writes an audit record. Audit/event tables deny ordinary mutation. Public ticket data has no direct table policy.

## Phase 3 controls

- Email/password sessions are established only through Supabase Auth. Seller and administrator routes redirect unauthenticated users to login and unauthorized users to a safe denial page.
- Seller actions resolve the current seller from the authenticated profile and separately verify every order before a UTR can be submitted. Seller lists are scoped by that seller identifier.
- Verification and rejection actions independently require a staff role on the server. Browser code has no service-role key and cannot set a payment to `VERIFIED`.
- The verification RPC locks the payment and order, requires the submitted state and matching amount, records the staff actor, then calls the existing database `issue_tickets` function in the same transaction. A repeat or concurrent request finds a non-submitted payment and cannot issue tickets again.
- The Phase 3 migration rejects a UTR already attached to a different payment and records payment/order lifecycle audit events. UTRs are references, not proof of payment.

## NOT YET IMPLEMENTED

Public privacy-safe verification RPC/view, payment gateway callbacks, database integration tests against a deployed Supabase project, QR/PDF delivery, WhatsApp integration, and draw execution.
