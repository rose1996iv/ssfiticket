# SSFI Fundraising Ticket System

Foundation repository for the Senthang Students Fellowship India (SSFI) Fundraising Lucky Draw.

## Status

**Phase 3 is implemented locally:** Supabase email/password access, protected seller/admin workspaces, manual-UPI submission, server-authorized payment review, ticket issuance, operational views, and audit events are included. The separate Phase 3 migration has not been applied by this app.

## Local development

1. Copy `.env.example` to a local `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
2. Run `npm install`.
3. Run `npm run dev`.

Quality commands: `npm run lint`, `npm run typecheck`, and `npm run build`.

## Routes

`/` is the public landing page. `/seller` and `/admin` require an authenticated role. The public verification route remains outside Phase 3.

See [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) for delivery scope and the `docs/` directory for the intended Phase 2+ architecture.

Apply reviewed migrations with the Supabase CLI or Dashboard SQL workflow. Phase 3 requires `202610270002_phase3_operations.sql` after Phase 2; it is intentionally separate for review and has not been applied automatically.
