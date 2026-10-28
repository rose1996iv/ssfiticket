# Deployment

## IMPLEMENTED

The project is compatible with local Next.js development, GitHub source control, Vercel builds, and future Supabase configuration. `.env.example` lists required variable names without values, while `.gitignore` excludes local environment files.

## PLANNED

Configure Vercel environment variables per environment; use only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in browser-visible configuration. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. Connect a Supabase project, apply reviewed Phase 2 and Phase 3 migrations in order, and configure production URLs only after deployment review.

## NOT YET IMPLEMENTED

Vercel project linking, Supabase project provisioning, CI, migration deployment, custom domains, and production monitoring.
