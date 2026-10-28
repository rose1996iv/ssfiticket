# Project Status

- Phase 0 — **COMPLETE** (requirements and scope approval)
- Phase 1 — **COMPLETE** (scaffold and foundation)
- Phase 2 — **COMPLETE** (core database, RLS, auth helpers, ticket model)
- Phase 3 — **IMPLEMENTED LOCALLY, PENDING MIGRATION REVIEW/APPLICATION**.

## Implemented

- Project scaffold with Next.js App Router, TypeScript, Tailwind, ESLint, and npm
- Basic responsive SSFI landing page
- Environment configuration template
- Supabase browser/server/admin client foundation
- Architecture, security, database, ticket, payment, deployment, and testing documentation
- Placeholder routes for verification, seller, and admin paths
- Supabase schema migration, seed campaign/prizes, roles, RLS, and issuance function
- Server-side Supabase Auth and role-check helpers
- Email/password login and logout with protected seller and admin layouts
- Seller dashboard, seller-scoped order list, customer/order creation, manual-UPI instructions, and UTR submission
- Admin payment review with server-side role authorization, verify/reject workflows, operational dashboard, and order/ticket/customer/seller views
- Separate Phase 3 migration with order creation, UTR submission, verification/rejection, audit events, and use of the existing `issue_tickets` function
- Retry-safe payment/order row locking and one-time ticket issuance; duplicate UTR references are rejected

## Not implemented

- Payment gateway
- QR verification
- Draw system

## Deployment note

`supabase/migrations/202610270002_phase3_operations.sql` is a reviewed-separately deployment artifact. This repository does not apply it automatically and no production database changes were made during Phase 3 implementation.
