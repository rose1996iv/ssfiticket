import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";
const INITDB = path.join(PG_BIN, "initdb.exe");
const PG_CTL = path.join(PG_BIN, "pg_ctl.exe");
const PSQL = path.join(PG_BIN, "psql.exe");

const PG_AVAILABLE =
  fs.existsSync(INITDB) && fs.existsSync(PG_CTL) && fs.existsSync(PSQL);

const PORT = "55438";
const DB_NAME = "postgres";

function buildSessionPrefix(role?: string, userId?: string): string {
  if (!role) return "";
  const safeRole = role.replace(/'/g, "''");
  const lines = [
    `DO $$ BEGIN PERFORM set_config('request.jwt.claim.role', '${safeRole}', false);`,
  ];
  if (userId) {
    lines.push(`PERFORM set_config('request.jwt.claim.sub', '${userId}', false);`);
  }
  lines.push(`END $$;`, `SET ROLE ${role};`);
  return lines.join("\n") + "\n";
}

function runPsql(
  sql: string,
  opts?: { role?: string; userId?: string }
): { status: number; stdout: string; stderr: string } {
  const fullSql = `${buildSessionPrefix(opts?.role, opts?.userId)}${sql}`;
  const res = spawnSync(
    PSQL,
    ["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
    { input: fullSql, encoding: "utf8" }
  );
  return {
    status: res.status ?? 1,
    stdout: (res.stdout || "").trim(),
    stderr: (res.stderr || "").trim(),
  };
}

function runPsqlFile(filePath: string): { status: number; stdout: string; stderr: string } {
  const res = spawnSync(
    PSQL,
    ["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-f", filePath],
    { encoding: "utf8" }
  );
  return {
    status: res.status ?? 1,
    stdout: (res.stdout || "").trim(),
    stderr: (res.stderr || "").trim(),
  };
}

test(
  "Phase 2B Disposable PostgreSQL 18 RLS, Privilege, Canonical FK & Realtime Publication Suite",
  { skip: !PG_AVAILABLE ? "Local PostgreSQL 18 binaries not found" : false },
  async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssfi-pg18-phase2b-"));
    const dataDir = path.join(tmpDir, "data");
    const logFile = path.join(tmpDir, "pg.log");

    const SUPER_ID = "11111111-1111-4111-8111-111111111101";
    const ADMIN_ID = "11111111-1111-4111-8111-111111111102";
    const MANAGER_ID = "11111111-1111-4111-8111-111111111105";
    const SELLER_USER_ID = "11111111-1111-4111-8111-111111111103";
    const CUSTOMER_USER_ID = "11111111-1111-4111-8111-111111111104";

    t.after(() => {
      try {
        if (fs.existsSync(dataDir)) {
          const stop = spawnSync(PG_CTL, ["-D", dataDir, "-m", "fast", "stop"], {
            stdio: "ignore",
            timeout: 15000,
          });
          if (stop.status !== 0) {
            spawnSync(PG_CTL, ["-D", dataDir, "-m", "immediate", "stop"], {
              stdio: "ignore",
              timeout: 10000,
            });
          }
        }
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    // 1. Initialize & start isolated disposable cluster
    const init = spawnSync(INITDB, ["-D", dataDir, "-U", "postgres", "-A", "trust", "--encoding=UTF8", "--no-locale"], {
      encoding: "utf8",
    });
    assert.equal(init.status, 0, `initdb failed: ${init.stderr}`);

    const start = spawnSync(
      PG_CTL,
      ["-D", dataDir, "-l", logFile, "-o", `-p ${PORT} -h 127.0.0.1 -k ""`, "start"],
      { stdio: "ignore", timeout: 30000 }
    );
    assert.equal(start.status, 0, "pg_ctl start failed (check pg.log)");

    // 2. Bootstrap Supabase-compatible auth schema & roles
    const bootstrap = runPsql(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY,
        email text,
        phone text,
        raw_user_meta_data jsonb DEFAULT '{}'::jsonb
      );
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.role', true), '');
      $$;
      CREATE SCHEMA IF NOT EXISTS storage;
      CREATE TABLE storage.buckets (
        id text PRIMARY KEY,
        name text NOT NULL,
        public boolean DEFAULT false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      CREATE TABLE storage.objects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id text REFERENCES storage.buckets(id),
        name text,
        owner uuid
      );
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
      END $$;
      GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
    `);
    assert.equal(bootstrap.status, 0, `Bootstrap failed: ${bootstrap.stderr}`);

    // 3. Apply ALL migrations in chronological order (including Phase 2B.2 & 2B.5)
    const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of migrationFiles) {
      const res = runPsqlFile(path.join(migrationsDir, file));
      assert.equal(res.status, 0, `Migration ${file} failed:\n${res.stderr}`);
    }

    // 4. Seed synthetic test identities across all 4 roles
    const seed = runPsql(`
      INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
        ('${SUPER_ID}', 'super-test@example.com', '{"full_name":"Synthetic Super Admin"}'),
        ('${ADMIN_ID}', 'admin-test@example.com', '{"full_name":"Synthetic Admin"}'),
        ('${MANAGER_ID}', 'manager-test@example.com', '{"full_name":"Synthetic Manager"}'),
        ('${SELLER_USER_ID}', 'seller-test@example.com', '{"full_name":"Synthetic Seller"}'),
        ('${CUSTOMER_USER_ID}', 'customer-test@example.com', '{"full_name":"Synthetic Customer"}');

      INSERT INTO public.profile_roles (profile_id, role_id)
      SELECT '${SUPER_ID}', id FROM public.roles WHERE name = 'SUPER_ADMIN';
      INSERT INTO public.profile_roles (profile_id, role_id)
      SELECT '${ADMIN_ID}', id FROM public.roles WHERE name = 'ADMIN';
      INSERT INTO public.profile_roles (profile_id, role_id)
      SELECT '${MANAGER_ID}', id FROM public.roles WHERE name = 'FUNDRAISING_MANAGER';
      INSERT INTO public.profile_roles (profile_id, role_id)
      SELECT '${SELLER_USER_ID}', id FROM public.roles WHERE name = 'SELLER';

      INSERT INTO public.sellers (profile_id, seller_code, display_name, is_active)
      VALUES ('${SELLER_USER_ID}', 'SELLER-901', 'Synthetic Seller', true);

      INSERT INTO public.customers (profile_id, full_name, phone, email)
      VALUES ('${CUSTOMER_USER_ID}', 'Synthetic Customer', '9000000001', 'customer-test@example.com');

      UPDATE public.campaigns SET status = 'ACTIVE' WHERE public_id = 'ssfi-fundraising-lucky-draw';
    `);
    assert.equal(seed.status, 0, `Seed failed: ${seed.stderr}`);

    // 5. Phase 2B.2 — Direct Write RLS & Privilege Hardening Tests
    await t.test("Phase 2B.2: Denies direct writes on all 10 hardened tables for anon, CUSTOMER, SELLER, ADMIN, and SUPER_ADMIN", () => {
      const actors: Array<{ label: string; role: string; userId?: string }> = [
        { label: "anon", role: "anon" },
        { label: "CUSTOMER", role: "authenticated", userId: CUSTOMER_USER_ID },
        { label: "SELLER", role: "authenticated", userId: SELLER_USER_ID },
        { label: "FUNDRAISING_MANAGER", role: "authenticated", userId: MANAGER_ID },
        { label: "ADMIN", role: "authenticated", userId: ADMIN_ID },
        { label: "SUPER_ADMIN", role: "authenticated", userId: SUPER_ID },
      ];

      const writeProbes: Array<{ table: string; sql: string }> = [
        { table: "system_settings", sql: `UPDATE public.system_settings SET value = 'true'::jsonb WHERE key = 'customer_email_live_enabled';` },
        { table: "campaigns", sql: `UPDATE public.campaigns SET name = 'Tampered' WHERE public_id = 'ssfi-fundraising-lucky-draw';` },
        { table: "prizes", sql: `UPDATE public.prizes SET title = 'Tampered' WHERE prize_number = 1;` },
        { table: "profiles", sql: `UPDATE public.profiles SET full_name = 'Tampered' WHERE id = '${CUSTOMER_USER_ID}';` },
        { table: "draws", sql: `INSERT INTO public.draws (campaign_id, name) SELECT id, 'Rogue Draw' FROM public.campaigns LIMIT 1;` },
        { table: "draw_results", sql: `DELETE FROM public.draw_results;` },
        { table: "draw_manual_exclusions", sql: `DELETE FROM public.draw_manual_exclusions;` },
        { table: "draw_eligibility_snapshots", sql: `DELETE FROM public.draw_eligibility_snapshots;` },
        { table: "draw_snapshot_tickets", sql: `DELETE FROM public.draw_snapshot_tickets;` },
        { table: "draw_randomness_evidence", sql: `DELETE FROM public.draw_randomness_evidence;` },
      ];

      for (const actor of actors) {
        for (const probe of writeProbes) {
          const r = runPsql(probe.sql, { role: actor.role, userId: actor.userId });
          assert.notEqual(
            r.status,
            0,
            `SECURITY VIOLATION: ${actor.label} succeeded in direct write to public.${probe.table}`
          );
        }
      }
    });

    await t.test("Phase 2B.2: Preserves legitimate service_role writes, public ACTIVE reads, staff SELECTs, and anon draw revocation", () => {
      // Public (anon) can still read ACTIVE campaigns & prizes + get_public_draw_winners()
      const anonCampaign = runPsql(`SELECT count(*) FROM public.campaigns WHERE public_id = 'ssfi-fundraising-lucky-draw';`, { role: "anon" });
      assert.equal(anonCampaign.status, 0, anonCampaign.stderr);
      assert.equal(anonCampaign.stdout, "1");

      const anonPrizes = runPsql(`SELECT count(*) FROM public.prizes;`, { role: "anon" });
      assert.equal(anonPrizes.status, 0, anonPrizes.stderr);
      assert.equal(Number(anonPrizes.stdout) >= 5, true);

      const anonPublicWinners = runPsql(`SELECT count(*) FROM public.get_public_draw_winners('ssfi-fundraising-lucky-draw');`, { role: "anon" });
      assert.equal(anonPublicWinners.status, 0, anonPublicWinners.stderr);

      // Anon direct SELECT on draws / draw_results / draw_randomness_evidence remains DENIED (Phase B2 R4)
      for (const restricted of ["draws", "draw_results", "draw_randomness_evidence"]) {
        const denied = runPsql(`SELECT count(*) FROM public.${restricted};`, { role: "anon" });
        assert.notEqual(denied.status, 0, `anon direct SELECT on ${restricted} must remain denied`);
      }

      // Authenticated staff (ADMIN and FUNDRAISING_MANAGER) can still SELECT operational & draw tables
      for (const staffUser of [ADMIN_ID, MANAGER_ID]) {
        for (const staffTable of ["system_settings", "draws", "draw_results", "draw_approvals", "draw_eligibility_snapshots"]) {
          const allowed = runPsql(`SELECT count(*) FROM public.${staffTable};`, { role: "authenticated", userId: staffUser });
          assert.equal(allowed.status, 0, `Staff SELECT on ${staffTable} failed: ${allowed.stderr}`);
        }
      }

      // REV-2C-08: Verify dormant write policies on public.seller_messages are dropped
      const dormantPolicies = runPsql(`
        SELECT count(*)
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'seller_messages'
          AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');
      `);
      assert.equal(dormantPolicies.status, 0, dormantPolicies.stderr);
      assert.equal(dormantPolicies.stdout, "0", "Dormant write policies on seller_messages must be dropped");

      // service_role can perform authoritative server-side writes
      const svcWrite = runPsql(
        `UPDATE public.system_settings SET description = 'Verified by service_role' WHERE key = 'customer_email_live_enabled';`,
        { role: "service_role" }
      );
      assert.equal(svcWrite.status, 0, `service_role write failed: ${svcWrite.stderr}`);
    });

    // 6. Phase 2B.3 — Canonical Seller/Profile Schema Verification
    await t.test("Phase 2B.3: Confirms public.sellers uses canonical profile_id FK to public.profiles(id) and has no user_id column", () => {
      const cols = runPsql(`
        SELECT string_agg(column_name, ',' ORDER BY column_name)
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'sellers';
      `);
      assert.equal(cols.status, 0);
      assert.ok(cols.stdout.split(",").includes("profile_id"));
      assert.ok(!cols.stdout.split(",").includes("user_id"));
    });

    // 7. Phase 2B.5 — Realtime Publication Membership & Idempotency
    await t.test("Phase 2B.5: Codifies exact supabase_realtime publication tables, excludes sensitive tables, and is idempotent", () => {
      const getPubTables = () => {
        const r = runPsql(`
          SELECT coalesce(string_agg(tablename, ',' ORDER BY tablename), '')
          FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND schemaname = 'public';
        `);
        assert.equal(r.status, 0, r.stderr);
        return r.stdout ? r.stdout.split(",") : [];
      };

      const tablesBefore = getPubTables();
      assert.deepEqual(tablesBefore, ["draw_approvals", "draw_eligibility_snapshots", "draw_results"]);

      const forbiddenSensitive = [
        "customers",
        "payments",
        "payment_recovery_tokens",
        "audit_logs",
        "system_settings",
        "customer_email_outbox",
        "profiles",
        "profile_roles",
      ];
      for (const s of forbiddenSensitive) {
        assert.ok(!tablesBefore.includes(s), `Sensitive table ${s} must NOT be in supabase_realtime`);
      }

      // Re-run migration to prove strict idempotency
      const rerun = runPsqlFile(
        path.resolve(process.cwd(), "supabase/migrations/202611200003_phase_2b5_realtime_publication.sql")
      );
      assert.equal(rerun.status, 0, `Idempotent re-run failed: ${rerun.stderr}`);
      assert.deepEqual(getPubTables(), tablesBefore);
    });
  }
);
