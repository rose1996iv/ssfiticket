## 1. Feature Description
<!-- Provide a concise description of the changes, user story, or bug fix. Include context on why this change is necessary. -->

- **Type of Change:**
  - [ ] `feat`: New feature or user capability
  - [ ] `fix`: Bug fix
  - [ ] `perf`: Performance enhancement
  - [ ] `refactor`: Internal refactoring with zero UX impact
  - [ ] `chore`: Tooling, dependency, or documentation update
- **Issue Reference:** Closes #

---

## 2. Database Migration & Schema Impact
<!-- Does this change modify the Supabase database schema or RLS policies? -->
- [ ] **No Database Changes:** Pure frontend or application logic change.
- [ ] **Database Migration Required:**
  - Migration file name: `supabase/migrations/<TIMESTAMP>_<NAME>.sql`
  - Target tables / objects:
  - Backward compatibility verified: [ ] Yes [ ] N/A
  - Zero-downtime safe: [ ] Yes
  - Applied and verified against Development/Preview database (`jiyuiydzsfydjklosvvq`): [ ] Yes

---

## 3. Security & Access Control Impact
<!-- How does this PR impact authentication, permissions, and sensitive customer data? -->
- [ ] RLS policies verified and tested for tenant/role isolation.
- [ ] Immutability constraints preserved (e.g. `seller_messages`, `audit_logs`).
- [ ] Customer PII protected (phone, WhatsApp, email) and never leaked to client logs.
- [ ] Critical financial/administrative RPCs restricted to `service_role` or verified staff roles.
- [ ] Zero secret keys or environment variables committed.

---

## 4. Preview Deployment URL
<!-- Paste the automatically generated Vercel Preview URL below. -->
- **Preview URL:** `https://ssfiticket-git-<BRANCH>-rose1996ivs-projects.vercel.app`
- **Preview HTTP Status:** `200 OK` verified on:
  - [ ] `/` (Homepage & Countdown)
  - [ ] `/buy?ref=SELLER-002` (Public checkout)
  - [ ] `/verify` (Ticket search)
  - [ ] `/terms` (Official rules)

---

## 5. QA Verification Checklist
<!-- Confirm that quality gates pass locally before requesting review. -->
- [ ] **Approved Baseline Preserved:** Visual layout, colors, typography, and copy match approved preview.
- [ ] **Automated Tests:** `npm test` passes cleanly.
- [ ] **TypeScript:** `npm run typecheck` returns 0 errors.
- [ ] **Linting:** `npm run lint` returns 0 errors.
- [ ] **Production Build:** `npm run build` succeeds locally.
- [ ] **Mobile Responsiveness:** Tested on 375px, 768px, and 1280px viewports.

---

## 6. Rollback & Contingency Plan
<!-- Describe exactly how to roll back if a regression is detected in production. -->
- **Vercel Rollback:** Instant promotion of previous stable deployment via Vercel Dashboard (RTO < 30s).
- **Database Rollback:**
  - [ ] Non-breaking schema change: Code rollback is sufficient; old columns remain inert.
  - [ ] Reversible migration: Down-migration script available at: `supabase/migrations/down/...`
  - [ ] Pre-release snapshot reference:

