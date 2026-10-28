# Architecture

## IMPLEMENTED

The app uses Next.js App Router, TypeScript, Tailwind CSS, and npm. Supabase utilities separate browser, request-scoped server, and privileged server-only clients. Phase 3 uses server actions for login, seller order/payment submission, and staff payment decisions; privileged database RPCs are never imported into browser code.

## PLANNED

```text
Public Client
      |
      v
Next.js App Router
      +---- Server Actions
      +---- Route Handlers
      |
      v
Application Services
      |
      v
Supabase PostgreSQL
      +---- RLS
      +---- Database Functions
      +---- Audit Logging
      +---- Ticket Integrity
```

Phase 3 payment flow: Seller creates order -> manual UPI payment -> UTR submission -> staff review -> atomic verification and existing database ticket issuance. Live payment gateways remain disabled.

`src/lib/supabase` owns infrastructure clients; future domain services belong in `src/server/services`, server mutations in `src/server/actions`, shared UI in `src/components`, and domain contracts in `src/types`.
