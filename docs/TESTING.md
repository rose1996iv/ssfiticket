# Testing

## IMPLEMENTED

Phase 1 quality gates are `npm run lint`, `npm run typecheck`, and `npm run build`.

Phase 2 adds database constraints and triggers for unique ticket numbers, bounded sequence allocation, campaign capacity, verified-payment issuance, quantity-bound issuance, role-based RLS, restricted public ticket data, immutable audit/event records, and status transitions. These require a configured Supabase database to execute end-to-end.

## Phase 3 verification

Run `npm run lint`, `npm run typecheck`, and `npm run build` before release. After applying the reviewed Phase 3 migration in a non-production environment, test seller isolation, unauthorized admin access, duplicate UTR rejection, a concurrent verify retry, rejected-payment resubmission, and issuance capacity exhaustion.

## NOT YET IMPLEMENTED

Test runner setup and automated database integration tests. They require a disposable configured Supabase environment and must not create production orders, customers, payments, or tickets.
