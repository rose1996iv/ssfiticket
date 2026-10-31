# SSFI Lucky Draw — Production Migration Candidate Review (v2)

**Reviewed input:** `production-migration(1).sql` (1,387 lines)  
**Reviewed output:** `production-migration-reviewed-v2.sql`  
**Scope:** Static review and deterministic corrections only. No remote database was modified.

## Decision

**Do not execute the uploaded candidate as-is.** It contains at least two execution blockers and additional privilege/policy issues. A corrected review copy is provided, but this is not a database-server execution test and is not yet a final production approval.

## Critical issues found and corrected in the review copy

1. **Campaign row-count assertion was detached from its UPDATE.**  
   In the uploaded file, `UPDATE public.campaigns` ran before a separate `DO` block. `GET DIAGNOSTICS ... ROW_COUNT` inside that new block does not read the affected-row count from the external statement; it reads the most recent SQL command executed within that PL/pgSQL block. The code could therefore see zero and raise an exception, rolling back the full transaction.  
   **Correction:** moved the UPDATE and `GET DIAGNOSTICS` into the same `DO` block.

2. **Schema-qualified `COALESCE` and `TRIM` were used as if they were ordinary functions.**  
   PostgreSQL documents `COALESCE` as a special conditional expression rather than an ordinary function; `TRIM` is SQL syntax, while `btrim` is the callable string function. `pg_catalog.coalesce(...)` and `pg_catalog.trim(...)` are therefore unsafe/invalid calls.  
   **Correction:** changed `pg_catalog.coalesce(...)` to `COALESCE(...)` and `pg_catalog.trim(...)` to `pg_catalog.btrim(...)`; qualified seller columns with alias `s`.

3. **The actual pre-existing seller-message write-policy names were not removed.**  
   The previously supplied live policy inventory showed `seller_messages_seller_update` and `seller_messages_staff_insert`. The uploaded candidate dropped different names (`seller_messages_seller_insert`, `seller_messages_staff_update`).  
   **Correction:** added drops for the two actual existing policy names as well.

4. **Sequence privileges did not revoke all privileges from `authenticated`.**  
   The uploaded file revoked sequence privileges from `PUBLIC` and `anon`, but not `authenticated`; a prior `UPDATE`/`setval` grant could remain.  
   **Correction:** included `authenticated` in the sequence `REVOKE ALL`, then explicitly granted only `USAGE` and `SELECT`.

5. **The future function default privilege revoke was schema-scoped only.**  
   PostgreSQL states that a schema-specific default-privilege REVOKE cannot cancel the global default `PUBLIC EXECUTE` on newly created functions.  
   **Correction:** added `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`.

6. **Future tables were given default `SELECT` to `authenticated`.**  
   That can expose a newly created table if a future migration forgets to enable RLS.  
   **Correction:** removed the automatic default client `SELECT`. Future table migrations must explicitly enable RLS and grant the minimum needed access.

## Static checks on the corrected review copy

- No `pg_catalog.coalesce` remains.
- No `pg_catalog.trim` remains.
- `pg_catalog.btrim` is used for trimming.
- The global `PUBLIC EXECUTE` default revoke is present for objects created by `postgres`.
- The known existing seller-message write policies are dropped.
- `authenticated` is included in existing-sequence `REVOKE ALL`.
- No default `SELECT ON TABLES TO authenticated` remains.
- The campaign UPDATE and row-count check occur in the same `DO` block.
- No `DROP TABLE` or `TRUNCATE TABLE` statements were added.
- One outer `BEGIN` and one `COMMIT` remain.

These are static text/structure checks only. They do **not** prove that every statement executes successfully against the current Supabase PostgreSQL database.

## Remaining pre-execution gates

1. Run the corrected candidate against the **Preview/Development database only**, inside a single transaction that ends with `ROLLBACK`, to test PostgreSQL execution and object compatibility. Do not run this against Production.
2. Inspect the Next.js server actions/API routes for `p_actor` handling. Since financial/admin RPCs use the service-role client, the server must derive actor IDs from a verified Supabase session, never from untrusted request fields. Also verify buyer/order authorization for `submit_manual_upi`.
3. Confirm the campaign closing timestamp. The script uses `2026-12-19 18:30:00 UTC`, which is **20 December 2026, 00:00 IST**. The project report says the draw date is 19 December 2026; the intended sales cutoff must be explicit before applying.
4. After Preview transaction testing, take/confirm a fresh Production backup and review the exact final SQL before authorization.

## Relevant PostgreSQL references

- Conditional expressions (`COALESCE` is not an ordinary function): https://www.postgresql.org/docs/current/functions-conditional.html
- String functions (`btrim`): https://www.postgresql.org/docs/current/functions-string.html
- PL/pgSQL `GET DIAGNOSTICS` / `ROW_COUNT`: https://www.postgresql.org/docs/current/plpgsql-statements.html
- `ALTER DEFAULT PRIVILEGES` global vs schema-specific behavior: https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html
- Supabase default privileges guidance: https://supabase.com/kb/troubleshooting/cant-change-the-default-privileges-of-supabase_admin-in-the-public-schema
