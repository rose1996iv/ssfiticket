import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  generateServerSeed,
  computeCombinedSeed,
  deriveWinningIndex,
} from "../src/lib/draw/randomness.ts";
import {
  sortTicketsCanonically,
  computeCanonicalSnapshotHash,
} from "../src/lib/draw/canonical.ts";
import { loadSealingConfig, sealDrawSeed } from "../src/lib/draw/sealing.ts";

const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";
const INITDB = path.join(PG_BIN, "initdb.exe");
const PG_CTL = path.join(PG_BIN, "pg_ctl.exe");
const PSQL = path.join(PG_BIN, "psql.exe");

const PG_AVAILABLE =
  fs.existsSync(INITDB) && fs.existsSync(PG_CTL) && fs.existsSync(PSQL);

const PORT = "55436";
const DB_NAME = "postgres";

function buildSessionPrefix(role?: string, userId?: string, extraClaims?: Record<string, unknown>): string {
  if (!role) return "";
  const safeRole = role.replace(/'/g, "''");
  const lines: string[] = [
    `DO $$ BEGIN PERFORM set_config('request.jwt.claim.role', '${safeRole}', false);`,
  ];
  if (userId) {
    lines.push(`PERFORM set_config('request.jwt.claim.sub', '${userId}', false);`);
  }
  if (extraClaims) {
    const claimsJson = JSON.stringify({ sub: userId, role: safeRole, ...extraClaims }).replace(/'/g, "''");
    lines.push(`PERFORM set_config('request.jwt.claims', '${claimsJson}', false);`);
  }
  lines.push(`END $$;`, `SET ROLE ${role};`);
  return lines.join("\n") + "\n";
}

function runPsql(
  sql: string,
  opts?: { role?: string; userId?: string; extraClaims?: Record<string, unknown> }
): { status: number; stdout: string; stderr: string } {
  const fullSql = `${buildSessionPrefix(opts?.role, opts?.userId, opts?.extraClaims)}${sql}`;
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

function capturePre10bState(): Record<string, unknown> {
  const q = (sql: string) => {
    const r = runPsql(sql);
    assert.equal(r.status, 0, `State capture failed: ${r.stderr}`);
    return r.stdout ? JSON.parse(r.stdout) : null;
  };

  return {
    functions: q(`
      SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.proname, t.identity_args), '[]'::json)
      FROM (
        SELECT
          p.proname,
          pg_get_function_identity_arguments(p.oid) AS identity_args,
          p.prosecdef,
          p.proconfig,
          coalesce(array_to_string(p.proacl, ','), '') AS proacl,
          pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'admin_request_first_prize_approval',
            'admin_record_first_prize_approval',
            'execute_draw_winner_selection',
            'protect_draw_approvals_initiator_role'
          )
      ) t;
    `),
    policies: q(`
      SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.policyname), '[]'::json)
      FROM (
        SELECT policyname, permissive, roles::text AS roles, cmd, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'draw_approvals'
      ) t;
    `),
    privileges: q(`
      SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.grantee, t.privilege_type), '[]'::json)
      FROM (
        SELECT grantee, privilege_type
        FROM information_schema.table_privileges
        WHERE table_schema = 'public'
          AND table_name = 'draw_approvals'
          AND grantee IN ('anon', 'authenticated', 'service_role')
      ) t;
    `),
    triggers: q(`
      SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.tgname), '[]'::json)
      FROM (
        SELECT tgname, pg_get_triggerdef(oid) AS trigger_def
        FROM pg_trigger
        WHERE tgrelid = 'public.draw_approvals'::regclass AND NOT tgisinternal
      ) t;
    `),
    columns: q(`
      SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.ordinal_position), '[]'::json)
      FROM (
        SELECT column_name, data_type, is_nullable, ordinal_position
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'draw_approvals'
      ) t;
    `),
  };
}

test(
  "Phase 10B — Option B Initiator Role Snapshot, RBAC Hardening & Rollback Equivalence (Local PG18)",
  { skip: !PG_AVAILABLE ? "Local PostgreSQL 18 binaries not found" : false },
  async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssfi-pg18-10b-"));
    const dataDir = path.join(tmpDir, "data");
    const logFile = path.join(tmpDir, "pg.log");

    // Exact UUIDs mirroring Preview entities (synthetic local cluster only)
    const OLD_SUPERADMIN_ID = "72054ec1-13a8-4b02-8d4e-d2b78f2df978"; // admin@ssfi.org -> demoted to ADMIN
    const NEW_SUPERADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"; // superadmin@ssfi.org -> SUPER_ADMIN
    const OTHER_SUPERADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"; // second SUPER_ADMIN
    const MANAGER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"; // FUNDRAISING_MANAGER
    const SELLER_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1"; // SELLER (non-staff)
    const PENDING_APPROVAL_ID = "924790fc-4348-4aad-ab46-da140eb5eec1";
    const UNVERIFIED_APPROVAL_ID = "924790fc-4348-4aad-ab46-da140eb5eec2";
    const POSTHOC_APPROVAL_ID = "924790fc-4348-4aad-ab46-da140eb5eec3";
    const HASHMISMATCH_AUDIT_ID = "924790fc-4348-4aad-ab46-da140eb5eec4";

    const DRAW_1 = "23fd0866-8e44-444f-ba8e-636f075c7087";
    const DRAW_2 = "23fd0866-8e44-444f-ba8e-636f075c7088";
    const DRAW_3 = "23fd0866-8e44-444f-ba8e-636f075c7089";
    const DRAW_4 = "23fd0866-8e44-444f-ba8e-636f075c708a";
    const DRAW_5 = "23fd0866-8e44-444f-ba8e-636f075c708b";
    const DRAW_6 = "23fd0866-8e44-444f-ba8e-636f075c708c";

    const sealCfg = loadSealingConfig({
      SSFI_DRAW_SEALING_KEY: "42".repeat(32),
      SSFI_DRAW_ACTIVE_KID: "kid-10b-test",
    });

    t.after(() => {
      try {
        if (fs.existsSync(dataDir)) {
          const fastStop = spawnSync(PG_CTL, ["-D", dataDir, "-m", "fast", "stop"], {
            stdio: "ignore",
            timeout: 15000,
          });
          if (fastStop.status !== 0) {
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

    const initRes = spawnSync(INITDB, ["-D", dataDir, "-U", "postgres", "--auth=trust", "--encoding=UTF8"], {
      encoding: "utf8",
    });
    assert.equal(initRes.status, 0, initRes.stderr);

    const startRes = spawnSync(
      PG_CTL,
      ["-D", dataDir, "-l", logFile, "-o", `-p ${PORT} -h 127.0.0.1`, "-w", "start"],
      { stdio: "ignore", timeout: 30000 }
    );
    assert.equal(startRes.status, 0, "pg_ctl start failed");

    // Bootstrap Supabase-compatible schemas & roles
    const boot = runPsql(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE SCHEMA IF NOT EXISTS storage;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
      END $$;
      GRANT USAGE ON SCHEMA public, storage TO anon, authenticated, service_role;
      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY,
        email text,
        phone text,
        raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(
          coalesce(
            current_setting('request.jwt.claim.sub', true),
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
          ),
          ''
        )::uuid;
      $$;
      CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
        SELECT coalesce(
          nullif(current_setting('request.jwt.claim.role', true), ''),
          nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), ''),
          CASE WHEN current_user IN ('anon', 'authenticated', 'service_role') THEN current_user ELSE NULL END
        );
      $$;
      CREATE TABLE IF NOT EXISTS storage.buckets (
        id text PRIMARY KEY,
        name text NOT NULL UNIQUE,
        owner uuid,
        public boolean DEFAULT false,
        file_size_limit bigint,
        allowed_mime_types text[],
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS storage.objects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id text REFERENCES storage.buckets(id),
        name text,
        owner uuid,
        metadata jsonb,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
    `);
    assert.equal(boot.status, 0, boot.stderr);

    // Apply all migrations up through 202611140004 (pre-10B baseline)
    const migrationsDir = path.resolve(process.cwd(), "supabase", "migrations");
    const pre10bMigrations = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql") && f <= "202611140004_phase_b2_6_sealed_seed_persistence.sql")
      .sort();

    for (const file of pre10bMigrations) {
      const r = runPsqlFile(path.join(migrationsDir, file));
      assert.equal(r.status, 0, `Migration ${file} failed: ${r.stderr}`);
    }

    // Capture exact pre-10B baseline schema/functions/policies/privileges/triggers
    const baselineState = capturePre10bState();

    // Resolve seeded canonical campaign and its 5 prizes
    const canonRes = runPsql(
      `SELECT id, ticket_price_paise FROM public.campaigns WHERE public_id = 'ssfi-fundraising-lucky-draw';`
    );
    assert.equal(canonRes.status, 0, canonRes.stderr);
    const [CAMPAIGN_ID, priceStr] = canonRes.stdout.split("|");
    const ticketPrice = Number(priceStr);
    const prizesRes = runPsql(
      `SELECT prize_number || ':' || id FROM public.prizes WHERE campaign_id = '${CAMPAIGN_ID}' ORDER BY prize_number;`
    );
    assert.equal(prizesRes.status, 0, prizesRes.stderr);
    const prizeMap: Record<number, string> = {};
    for (const row of prizesRes.stdout.split(/\r?\n/)) {
      const [num, id] = row.split(":");
      prizeMap[Number(num)] = id;
    }
    const PRIZE_1 = prizeMap[1];
    const PRIZE_2 = prizeMap[2];
    const PRIZE_3 = prizeMap[3];
    const PRIZE_4 = prizeMap[4];
    const PRIZE_5 = prizeMap[5];
    assert.ok(PRIZE_1 && PRIZE_2 && PRIZE_3 && PRIZE_4 && PRIZE_5, "All 5 canonical prizes must exist");

    // Seed users, roles, canonical draws, 7 paid tickets, and pre-existing pending request
    const ticketIds = [1, 2, 3, 4, 5, 6, 7].map((i) => `99999999-9999-4999-8999-99999999990${i}`);
    const ticketNums = [1, 2, 3, 4, 5, 6, 7].map((i) => `SSFI-00000${i}`);

    const seedRes = runPsql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${OLD_SUPERADMIN_ID}', 'admin@ssfi.org'),
        ('${NEW_SUPERADMIN_ID}', 'superadmin@ssfi.org'),
        ('${OTHER_SUPERADMIN_ID}', 'superadmin2@ssfi.org'),
        ('${MANAGER_ID}', 'manager@ssfi.org'),
        ('${SELLER_ID}', 'seller@ssfi.org');

      INSERT INTO public.profiles (id, full_name, email) VALUES
        ('${OLD_SUPERADMIN_ID}', 'Admin', 'admin@ssfi.org'),
        ('${NEW_SUPERADMIN_ID}', 'Super Admin', 'superadmin@ssfi.org'),
        ('${OTHER_SUPERADMIN_ID}', 'Super Admin 2', 'superadmin2@ssfi.org'),
        ('${MANAGER_ID}', 'Manager', 'manager@ssfi.org'),
        ('${SELLER_ID}', 'Seller', 'seller@ssfi.org')
      ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

      -- Initially admin@ssfi.org is SUPER_ADMIN since 2026-10-29 (before 2026-11-19 request)
      -- OTHER_SUPERADMIN_ID is granted SUPER_ADMIN AFTER 2026-11-19 to test temporal backfill guard
      INSERT INTO public.profile_roles (profile_id, role_id, created_at)
      SELECT '${OLD_SUPERADMIN_ID}'::uuid, id, '2026-10-29T08:25:07+00:00'::timestamptz FROM public.roles WHERE name = 'SUPER_ADMIN'
      UNION ALL
      SELECT '${OTHER_SUPERADMIN_ID}'::uuid, id, '2026-11-20T00:00:00+00:00'::timestamptz FROM public.roles WHERE name = 'SUPER_ADMIN'
      UNION ALL
      SELECT '${MANAGER_ID}'::uuid, id, '2026-10-29T08:25:07+00:00'::timestamptz FROM public.roles WHERE name = 'FUNDRAISING_MANAGER'
      UNION ALL
      SELECT '${SELLER_ID}'::uuid, id, '2026-10-29T08:25:07+00:00'::timestamptz FROM public.roles WHERE name = 'SELLER';

      UPDATE public.campaigns SET status = 'ACTIVE' WHERE id = '${CAMPAIGN_ID}';

      INSERT INTO public.draws (id, campaign_id, name, status) VALUES
        ('${DRAW_1}', '${CAMPAIGN_ID}', 'Canonical Draw 1', 'SCHEDULED'),
        ('${DRAW_2}', '${CAMPAIGN_ID}', 'Fresh Draw 2', 'SCHEDULED'),
        ('${DRAW_3}', '${CAMPAIGN_ID}', 'Fresh Draw 3', 'SCHEDULED'),
        ('${DRAW_4}', '${CAMPAIGN_ID}', 'Unverified Backfill Draw 4', 'SCHEDULED'),
        ('${DRAW_5}', '${CAMPAIGN_ID}', 'Posthoc Backfill Draw 5', 'SCHEDULED'),
        ('${DRAW_6}', '${CAMPAIGN_ID}', 'HashMismatch Backfill Draw 6', 'SCHEDULED');

      INSERT INTO public.customers (id, full_name, email, phone) VALUES
        ('77777777-7777-4777-8777-777777777701', 'Test Buyer', 'buyer@example.com', '9876543210');

      INSERT INTO public.orders (id, order_number, campaign_id, customer_id, quantity, unit_price_paise, total_amount_paise, status) VALUES
        ('88888888-8888-4888-8888-888888888801', 'ORD-2026-100001', '${CAMPAIGN_ID}', '77777777-7777-4777-8777-777777777701', 7, ${ticketPrice}, ${ticketPrice * 7}, 'TICKETS_ISSUED');

      INSERT INTO public.payments (order_id, status, amount_paise, submitted_at, verified_at, verified_by) VALUES
        ('88888888-8888-4888-8888-888888888801', 'VERIFIED', ${ticketPrice * 7}, now(), now(), '${OLD_SUPERADMIN_ID}');

      INSERT INTO public.tickets (id, campaign_id, order_id, customer_id, ticket_number, status) VALUES
        ('${ticketIds[0]}', '${CAMPAIGN_ID}', '88888888-8888-4888-8888-888888888801', '77777777-7777-4777-8777-777777777701', '${ticketNums[0]}', 'ISSUED'),
        ('${ticketIds[1]}', '${CAMPAIGN_ID}', '88888888-8888-4888-8888-888888888801', '77777777-7777-4777-8777-777777777701', '${ticketNums[1]}', 'ISSUED'),
        ('${ticketIds[2]}', '${CAMPAIGN_ID}', '88888888-8888-4888-8888-888888888801', '77777777-7777-4777-8777-777777777701', '${ticketNums[2]}', 'ISSUED'),
        ('${ticketIds[3]}', '${CAMPAIGN_ID}', '88888888-8888-4888-8888-888888888801', '77777777-7777-4777-8777-777777777701', '${ticketNums[3]}', 'ISSUED'),
        ('${ticketIds[4]}', '${CAMPAIGN_ID}', '88888888-8888-4888-8888-888888888801', '77777777-7777-4777-8777-777777777701', '${ticketNums[4]}', 'ISSUED'),
        ('${ticketIds[5]}', '${CAMPAIGN_ID}', '88888888-8888-4888-8888-888888888801', '77777777-7777-4777-8777-777777777701', '${ticketNums[5]}', 'ISSUED'),
        ('${ticketIds[6]}', '${CAMPAIGN_ID}', '88888888-8888-4888-8888-888888888801', '77777777-7777-4777-8777-777777777701', '${ticketNums[6]}', 'ISSUED');
    `);
    assert.equal(seedRes.status, 0, seedRes.stderr);

    // Helper to lock snapshot and execute a prize
    const lockSnapshot = (drawId: string, prizeId: string, eligible: Array<{ id: string; ticket_number: string }>) => {
      const sorted = sortTicketsCanonically(eligible);
      const snapHash = computeCanonicalSnapshotHash(sorted.map((x) => x.ticket_number));
      const { serverSeed, seedCommitment } = generateServerSeed();
      const env = sealDrawSeed(serverSeed, { campaignId: CAMPAIGN_ID, drawId, prizeId }, sealCfg);
      const idArr = `ARRAY[${sorted.map((x) => `'${x.id}'::uuid`).join(",")}]`;
      const numArr = `ARRAY[${sorted.map((x) => `'${x.ticket_number}'`).join(",")}]`;
      const envJson = JSON.stringify(env).replace(/'/g, "''");
      const r = runPsql(
        `SELECT public.admin_lock_eligibility_snapshot('${drawId}', '${prizeId}', '${snapHash}', ${idArr}, ${numArr}, '${OLD_SUPERADMIN_ID}', '${seedCommitment}', '${envJson}'::jsonb, '${env.kid}');`,
        { role: "service_role" }
      );
      assert.equal(r.status, 0, `lockSnapshot failed: ${r.stderr}`);
      return { snapshotId: r.stdout, snapHash, serverSeed, seedCommitment, sorted };
    };

    // Execute Prizes 5, 4, 3, 2 on DRAW_1 so DRAW_1 is ready for 1st Prize (exact Preview state!)
    const allTickets = ticketIds.map((id, idx) => ({ id, ticket_number: ticketNums[idx] }));
    const wonIds = new Set<string>();
    for (const prizeId of [PRIZE_5, PRIZE_4, PRIZE_3, PRIZE_2]) {
      const pool = allTickets.filter((x) => !wonIds.has(x.id));
      const snap = lockSnapshot(DRAW_1, prizeId, pool);
      const entropy = "aa".repeat(32);
      const combined = computeCombinedSeed(snap.serverSeed, entropy, snap.snapHash, prizeId);
      const idx = deriveWinningIndex(combined, pool.length);
      const exec = runPsql(
        `SELECT public.execute_draw_winner_selection('${DRAW_1}', '${prizeId}', '${snap.snapshotId}', ${idx}, '${snap.seedCommitment}', '${snap.serverSeed}', '${combined}', '${OLD_SUPERADMIN_ID}', '${entropy}');`,
        { role: "service_role" }
      );
      assert.equal(exec.status, 0, `Draw execution for ${prizeId} failed: ${exec.stderr}`);
      wonIds.add(snap.sorted[idx].id);
    }

    // Lock 1st Prize snapshot on DRAW_1 and insert the exact mirror of pending request 924790fc-...
    const remainingPool = allTickets.filter((x) => !wonIds.has(x.id));
    const snap1 = lockSnapshot(DRAW_1, PRIZE_1, remainingPool);
    const originalRequestedAt = "2026-11-19T18:59:26.843454+00:00";

    const seedPending = runPsql(`
      INSERT INTO public.draw_approvals (
        id, draw_id, campaign_id, prize_id, snapshot_id, snapshot_hash,
        initiator_id, approver_id, status, requested_at
      ) VALUES (
        '${PENDING_APPROVAL_ID}', '${DRAW_1}', '${CAMPAIGN_ID}', '${PRIZE_1}', '${snap1.snapshotId}', '${snap1.snapHash}',
        '${OLD_SUPERADMIN_ID}', NULL, 'PENDING', '${originalRequestedAt}'
      );
      INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata, created_at)
      VALUES (
        '${OLD_SUPERADMIN_ID}', 'APPROVAL_REQUESTED', 'draw_approval', '${PENDING_APPROVAL_ID}',
        jsonb_build_object('draw_id', '${DRAW_1}', 'prize_id', '${PRIZE_1}', 'snapshot_hash', '${snap1.snapHash}'),
        '${originalRequestedAt}'
      );
      -- Unverified row 1 (DRAW_4): no audit_logs evidence at all -> MUST remain NULL
      INSERT INTO public.draw_approvals (
        id, draw_id, campaign_id, prize_id, snapshot_id, snapshot_hash,
        initiator_id, approver_id, status, requested_at
      ) VALUES (
        '${UNVERIFIED_APPROVAL_ID}', '${DRAW_4}', '${CAMPAIGN_ID}', '${PRIZE_1}', '${snap1.snapshotId}', '${snap1.snapHash}',
        '${OLD_SUPERADMIN_ID}', NULL, 'PENDING', '${originalRequestedAt}'
      );
      -- Unverified row 2 (DRAW_5): initiator promoted to SUPER_ADMIN AFTER requested_at (2026-11-20 > 2026-11-19) -> MUST remain NULL
      INSERT INTO public.draw_approvals (
        id, draw_id, campaign_id, prize_id, snapshot_id, snapshot_hash,
        initiator_id, approver_id, status, requested_at
      ) VALUES (
        '${POSTHOC_APPROVAL_ID}', '${DRAW_5}', '${CAMPAIGN_ID}', '${PRIZE_1}', '${snap1.snapshotId}', '${snap1.snapHash}',
        '${OTHER_SUPERADMIN_ID}', NULL, 'PENDING', '${originalRequestedAt}'
      );
      INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata, created_at)
      VALUES (
        '${OTHER_SUPERADMIN_ID}', 'APPROVAL_REQUESTED', 'draw_approval', '${POSTHOC_APPROVAL_ID}',
        jsonb_build_object('draw_id', '${DRAW_5}', 'prize_id', '${PRIZE_1}', 'snapshot_hash', '${snap1.snapHash}'),
        '${originalRequestedAt}'
      );
      -- Unverified row 3 (DRAW_6): audit_logs metadata snapshot_hash mismatches draw_approvals.snapshot_hash -> MUST remain NULL
      INSERT INTO public.draw_approvals (
        id, draw_id, campaign_id, prize_id, snapshot_id, snapshot_hash,
        initiator_id, approver_id, status, requested_at
      ) VALUES (
        '${HASHMISMATCH_AUDIT_ID}', '${DRAW_6}', '${CAMPAIGN_ID}', '${PRIZE_1}', '${snap1.snapshotId}', '${snap1.snapHash}',
        '${OLD_SUPERADMIN_ID}', NULL, 'PENDING', '${originalRequestedAt}'
      );
      INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata, created_at)
      VALUES (
        '${OLD_SUPERADMIN_ID}', 'APPROVAL_REQUESTED', 'draw_approval', '${HASHMISMATCH_AUDIT_ID}',
        jsonb_build_object('draw_id', '${DRAW_6}', 'prize_id', '${PRIZE_1}', 'snapshot_hash', '${"e".repeat(64)}'),
        '${originalRequestedAt}'
      );
    `);
    assert.equal(seedPending.status, 0, seedPending.stderr);

    // Apply Phase 10B migration BEFORE demoting admin@ssfi.org
    const migPath = path.join(migrationsDir, "202611200001_phase_10b_initiator_role_and_approval_hardening.sql");
    const migRes = runPsqlFile(migPath);
    assert.equal(migRes.status, 0, `Phase 10B migration failed: ${migRes.stderr}`);

    // =========================================================================
    // TEST 1: Existing pending request remains intact, backfill requires temporal + hash-matched audit evidence, & trigger ACL locked
    // =========================================================================
    await t.test("1. Existing pending request 924790fc-... remains intact, backfill enforces temporal & hash-matched evidence, and trigger ACL is revoked", () => {
      const row = JSON.parse(
        runPsql(`
          SELECT row_to_json(da) FROM public.draw_approvals da WHERE da.id = '${PENDING_APPROVAL_ID}';
        `).stdout
      );
      assert.equal(row.id, PENDING_APPROVAL_ID);
      assert.equal(row.initiator_id, OLD_SUPERADMIN_ID);
      assert.equal(row.status, "PENDING");
      assert.equal(row.snapshot_hash, snap1.snapHash);
      assert.equal(row.initiator_role_at_request, "SUPER_ADMIN");
      assert.equal(new Date(row.requested_at).toISOString(), new Date(originalRequestedAt).toISOString());

      // All 3 negative backfill cases MUST remain NULL (never guess)
      for (const [label, id] of [
        ["no-audit-log", UNVERIFIED_APPROVAL_ID],
        ["post-hoc-promotion", POSTHOC_APPROVAL_ID],
        ["mismatched-audit-hash", HASHMISMATCH_AUDIT_ID],
      ]) {
        const val = runPsql(
          `SELECT coalesce(initiator_role_at_request, 'NULL') FROM public.draw_approvals WHERE id = '${id}';`
        ).stdout;
        assert.equal(val, "NULL", `Negative backfill case (${label}) must remain NULL`);
      }

      // REV-10B-03: Verify protect_draw_approvals_initiator_role() has PUBLIC/anon/authenticated EXECUTE revoked
      const triggerAcl = runPsql(`
        SELECT has_function_privilege('public', 'public.protect_draw_approvals_initiator_role()', 'EXECUTE')::text
            || '|' || has_function_privilege('anon', 'public.protect_draw_approvals_initiator_role()', 'EXECUTE')::text
            || '|' || has_function_privilege('authenticated', 'public.protect_draw_approvals_initiator_role()', 'EXECUTE')::text;
      `).stdout;
      assert.equal(triggerAcl, "false|false|false", `Trigger function EXECUTE must be revoked from public/anon/authenticated, got ${triggerAcl}`);
    });

    // Provision superadmin@ssfi.org as SUPER_ADMIN, then demote admin@ssfi.org to ADMIN
    const roleMig = runPsql(`
      INSERT INTO public.profile_roles (profile_id, role_id)
      SELECT '${NEW_SUPERADMIN_ID}', id FROM public.roles WHERE name = 'SUPER_ADMIN';

      INSERT INTO public.profile_roles (profile_id, role_id)
      SELECT '${OLD_SUPERADMIN_ID}', id FROM public.roles WHERE name = 'ADMIN'
      ON CONFLICT DO NOTHING;

      DELETE FROM public.profile_roles
      WHERE profile_id = '${OLD_SUPERADMIN_ID}'
        AND role_id = (SELECT id FROM public.roles WHERE name = 'SUPER_ADMIN');
    `);
    assert.equal(roleMig.status, 0, roleMig.stderr);

    // =========================================================================
    // TEST 2: Duplicate request behavior is safe while PENDING
    // =========================================================================
    await t.test("2. Duplicate request by another SUPER_ADMIN is blocked (23505) without overwriting PENDING request", () => {
      const dupOther = runPsql(
        `SELECT public.admin_request_first_prize_approval('${DRAW_1}', '${PRIZE_1}', '${snap1.snapshotId}', '${NEW_SUPERADMIN_ID}');`,
        { role: "service_role" }
      );
      assert.notEqual(dupOther.status, 0, "Different SUPER_ADMIN must not overwrite existing PENDING request");
      assert.match(dupOther.stderr, /Duplicate request blocked/i);

      // Verify original row untouched
      const initiator = runPsql(`SELECT initiator_id FROM public.draw_approvals WHERE id = '${PENDING_APPROVAL_ID}';`).stdout;
      assert.equal(initiator, OLD_SUPERADMIN_ID);
    });

    // =========================================================================
    // TEST 3: Self-approval, Non-staff approval, Client role escalation, and Direct Table Mutations are rejected
    // =========================================================================
    await t.test("3. Self-approval, non-staff approval, client role escalation, and direct mutations are rejected", () => {
      // 3a. Self-approval by admin@ssfi.org (original initiator) rejected
      const selfApp = runPsql(
        `SELECT public.admin_record_first_prize_approval('${PENDING_APPROVAL_ID}', 'APPROVED', 'self', '${OLD_SUPERADMIN_ID}');`,
        { role: "service_role" }
      );
      assert.notEqual(selfApp.status, 0);
      assert.match(selfApp.stderr, /Four-eyes violation/i);

      // 3b. Non-staff (SELLER) approval rejected
      const sellerApp = runPsql(
        `SELECT public.admin_record_first_prize_approval('${PENDING_APPROVAL_ID}', 'APPROVED', 'seller', '${SELLER_ID}');`,
        { role: "service_role" }
      );
      assert.notEqual(sellerApp.status, 0);
      assert.match(sellerApp.stderr, /ADMIN or SUPER_ADMIN role required/i);

      // 3c. Demoted ADMIN cannot initiate 1st Prize request even with spoofed JWT claims
      const spoofedInit = runPsql(
        `SELECT public.admin_request_first_prize_approval('${DRAW_1}', '${PRIZE_1}', '${snap1.snapshotId}', '${OLD_SUPERADMIN_ID}');`,
        { role: "service_role", userId: OLD_SUPERADMIN_ID, extraClaims: { app_metadata: { role: "SUPER_ADMIN" } } }
      );
      assert.notEqual(spoofedInit.status, 0);
      assert.match(spoofedInit.stderr, /Only SUPER_ADMIN can initiate/i);

      // 3d. Authenticated user cannot self-escalate via profile_roles
      const escalate = runPsql(
        `INSERT INTO public.profile_roles (profile_id, role_id) SELECT '${OLD_SUPERADMIN_ID}', id FROM public.roles WHERE name = 'SUPER_ADMIN';`,
        { role: "authenticated", userId: OLD_SUPERADMIN_ID }
      );
      assert.notEqual(escalate.status, 0, "Authenticated user must never insert into profile_roles");

      // 3e. Direct authenticated table mutations on draw_approvals are strictly rejected, while SELECT works for staff
      const staffSelect = runPsql(`SELECT count(*) FROM public.draw_approvals;`, {
        role: "authenticated",
        userId: NEW_SUPERADMIN_ID,
      });
      assert.equal(staffSelect.status, 0, `Staff SELECT should succeed: ${staffSelect.stderr}`);

      const directInsertAuth = runPsql(
        `INSERT INTO public.draw_approvals (draw_id, campaign_id, prize_id, snapshot_id, snapshot_hash, initiator_id, initiator_role_at_request, status)
         VALUES ('${DRAW_2}', '${CAMPAIGN_ID}', '${PRIZE_1}', '${snap1.snapshotId}', '${"1".repeat(64)}', '${NEW_SUPERADMIN_ID}', 'SUPER_ADMIN', 'PENDING');`,
        { role: "authenticated", userId: NEW_SUPERADMIN_ID }
      );
      assert.notEqual(directInsertAuth.status, 0, "Direct authenticated INSERT on draw_approvals must be rejected");

      const directUpdateSuper = runPsql(
        `UPDATE public.draw_approvals SET status = 'APPROVED', approver_id = '${NEW_SUPERADMIN_ID}' WHERE id = '${PENDING_APPROVAL_ID}';`,
        { role: "authenticated", userId: NEW_SUPERADMIN_ID }
      );
      assert.notEqual(directUpdateSuper.status, 0, "Direct authenticated UPDATE on draw_approvals must be rejected");

      const directUpdateMgr = runPsql(
        `UPDATE public.draw_approvals SET status = 'APPROVED' WHERE id = '${PENDING_APPROVAL_ID}';`,
        { role: "authenticated", userId: MANAGER_ID }
      );
      assert.notEqual(directUpdateMgr.status, 0, "Direct FUNDRAISING_MANAGER UPDATE on draw_approvals must be rejected");

      const directDelete = runPsql(
        `DELETE FROM public.draw_approvals WHERE id = '${PENDING_APPROVAL_ID}';`,
        { role: "authenticated", userId: NEW_SUPERADMIN_ID }
      );
      assert.notEqual(directDelete.status, 0, "Direct authenticated DELETE on draw_approvals must be rejected");

      // 3f. Anonymous direct access (SELECT/INSERT/UPDATE/DELETE) on draw_approvals is completely rejected
      const anonSelect = runPsql(`SELECT count(*) FROM public.draw_approvals;`, { role: "anon" });
      assert.notEqual(anonSelect.status, 0, "anon SELECT on draw_approvals must be rejected");
      const anonInsert = runPsql(
        `INSERT INTO public.draw_approvals (draw_id, campaign_id, prize_id, snapshot_id, snapshot_hash, initiator_id, initiator_role_at_request, status)
         VALUES ('${DRAW_2}', '${CAMPAIGN_ID}', '${PRIZE_1}', '${snap1.snapshotId}', '${"2".repeat(64)}', '${NEW_SUPERADMIN_ID}', 'SUPER_ADMIN', 'PENDING');`,
        { role: "anon" }
      );
      assert.notEqual(anonInsert.status, 0, "anon INSERT on draw_approvals must be rejected");
      const anonUpdate = runPsql(
        `UPDATE public.draw_approvals SET status = 'APPROVED' WHERE id = '${PENDING_APPROVAL_ID}';`,
        { role: "anon" }
      );
      assert.notEqual(anonUpdate.status, 0, "anon UPDATE on draw_approvals must be rejected");
      const anonDelete = runPsql(
        `DELETE FROM public.draw_approvals WHERE id = '${PENDING_APPROVAL_ID}';`,
        { role: "anon" }
      );
      assert.notEqual(anonDelete.status, 0, "anon DELETE on draw_approvals must be rejected");

      // 3g. Trigger adversarial tests even as service_role (no bypass for privileged callers)
      // - Modify recorded initiator_role_at_request -> rejected
      const tamperRole = runPsql(
        `UPDATE public.draw_approvals SET initiator_role_at_request = NULL WHERE id = '${PENDING_APPROVAL_ID}';`,
        { role: "service_role" }
      );
      assert.notEqual(tamperRole.status, 0, "Trigger must block modifying initiator_role_at_request");
      assert.match(tamperRole.stderr, /Immutable field violation/i);

      // - REV-10B-01: Promote NULL -> SUPER_ADMIN on unverified PENDING row -> rejected
      const promoteNull = runPsql(
        `UPDATE public.draw_approvals SET initiator_role_at_request = 'SUPER_ADMIN' WHERE id = '${UNVERIFIED_APPROVAL_ID}';`,
        { role: "service_role" }
      );
      assert.notEqual(promoteNull.status, 0, "Trigger must block NULL -> SUPER_ADMIN promotion on PENDING row");
      assert.match(promoteNull.stderr, /Unauthorized promotion/i);

      // - Forged INSERT with NULL initiator_role_at_request -> rejected
      const forgedNullInsert = runPsql(
        `INSERT INTO public.draw_approvals (draw_id, campaign_id, prize_id, snapshot_id, snapshot_hash, initiator_id, initiator_role_at_request, status)
         VALUES ('${DRAW_2}', '${CAMPAIGN_ID}', '${PRIZE_1}', '${snap1.snapshotId}', '${"3".repeat(64)}', '${NEW_SUPERADMIN_ID}', NULL, 'PENDING');`,
        { role: "service_role" }
      );
      assert.notEqual(forgedNullInsert.status, 0, "Trigger must reject INSERT with NULL initiator_role_at_request");
      assert.match(forgedNullInsert.stderr, /Policy A violation/i);

      // - Forged INSERT with SUPER_ADMIN role for non-SUPER_ADMIN initiator (demoted ADMIN) -> rejected
      const forgedNonSuperInsert = runPsql(
        `INSERT INTO public.draw_approvals (draw_id, campaign_id, prize_id, snapshot_id, snapshot_hash, initiator_id, initiator_role_at_request, status)
         VALUES ('${DRAW_2}', '${CAMPAIGN_ID}', '${PRIZE_1}', '${snap1.snapshotId}', '${"4".repeat(64)}', '${OLD_SUPERADMIN_ID}', 'SUPER_ADMIN', 'PENDING');`,
        { role: "service_role" }
      );
      assert.notEqual(forgedNonSuperInsert.status, 0, "Trigger must reject forged SUPER_ADMIN INSERT for demoted ADMIN");
      assert.match(forgedNonSuperInsert.stderr, /does not hold authoritative SUPER_ADMIN role/i);

      // - Initiator replacement on PENDING row -> rejected
      const replaceInitiatorPending = runPsql(
        `UPDATE public.draw_approvals SET initiator_id = '${NEW_SUPERADMIN_ID}' WHERE id = '${PENDING_APPROVAL_ID}';`,
        { role: "service_role" }
      );
      assert.notEqual(replaceInitiatorPending.status, 0, "Trigger must block initiator replacement on PENDING row");
      assert.match(replaceInitiatorPending.stderr, /initiator_id cannot be overwritten/i);

      // - REV-10B-01: DELETE on PENDING approval record -> rejected even as service_role
      const deletePending = runPsql(
        `DELETE FROM public.draw_approvals WHERE id = '${PENDING_APPROVAL_ID}';`,
        { role: "service_role" }
      );
      assert.notEqual(deletePending.status, 0, "Trigger must block deleting PENDING approval record");
      assert.match(deletePending.stderr, /Protected record violation/i);
    });

    // =========================================================================
    // TEST 4: Historical initiator role validated — new SUPER_ADMIN approves preserved pending request & 1st Prize executes
    // =========================================================================
    await t.test("4. New SUPER_ADMIN independently approves preserved request 924790fc-... and 1st Prize draw succeeds after initiator demotion", () => {
      // Approve using superadmin@ssfi.org (independent SUPER_ADMIN)
      const approve = runPsql(
        `SELECT public.admin_record_first_prize_approval('${PENDING_APPROVAL_ID}', 'APPROVED', 'Verified independently by new SUPER_ADMIN', '${NEW_SUPERADMIN_ID}');`,
        { role: "service_role" }
      );
      assert.equal(approve.status, 0, `Approval by new SUPER_ADMIN failed: ${approve.stderr}`);

      // REV-10B-01: Verify APPROVED record also rejects DELETE and initiator_id replacement even as service_role
      const deleteApproved = runPsql(
        `DELETE FROM public.draw_approvals WHERE id = '${PENDING_APPROVAL_ID}';`,
        { role: "service_role" }
      );
      assert.notEqual(deleteApproved.status, 0, "Trigger must block deleting APPROVED approval record");
      assert.match(deleteApproved.stderr, /Protected record violation/i);

      const replaceInitiatorApproved = runPsql(
        `UPDATE public.draw_approvals SET initiator_id = '${NEW_SUPERADMIN_ID}' WHERE id = '${PENDING_APPROVAL_ID}';`,
        { role: "service_role" }
      );
      assert.notEqual(replaceInitiatorApproved.status, 0, "Trigger must block initiator replacement on APPROVED record");
      assert.match(replaceInitiatorApproved.stderr, /initiator_id cannot be overwritten/i);

      // Execute 1st Prize draw on DRAW_1 (admin@ssfi.org is now ADMIN, NOT SUPER_ADMIN!)
      const entropy = "bb".repeat(32);
      const combined = computeCombinedSeed(snap1.serverSeed, entropy, snap1.snapHash, PRIZE_1);
      const idx = deriveWinningIndex(combined, remainingPool.length);

      const exec1 = runPsql(
        `SELECT public.execute_draw_winner_selection('${DRAW_1}', '${PRIZE_1}', '${snap1.snapshotId}', ${idx}, '${snap1.seedCommitment}', '${snap1.serverSeed}', '${combined}', '${OLD_SUPERADMIN_ID}', '${entropy}');`,
        { role: "service_role" }
      );
      assert.equal(exec1.status, 0, `1st Prize draw execution must succeed with historical SUPER_ADMIN initiator: ${exec1.stderr}`);
      wonIds.add(snap1.sorted[idx].id);
    });

    // =========================================================================
    // TEST 5: Fresh request (strict idempotency), ADMIN approval, TRUE same-draw snapshot mismatch, & revoked approver rejection
    // =========================================================================
    await t.test("5. New SUPER_ADMIN initiates fresh request (strict idempotency), ADMIN approves, true same-draw snapshot mismatch & revoked approver are rejected", () => {
      // Create a fresh 1st Prize snapshot on DRAW_2 using remaining non-winner tickets
      const freshPool = allTickets.filter((x) => !wonIds.has(x.id));
      const snap2 = lockSnapshot(DRAW_2, PRIZE_1, freshPool);
      const init1 = runPsql(
        `SELECT public.admin_request_first_prize_approval('${DRAW_2}', '${PRIZE_1}', '${snap2.snapshotId}', '${NEW_SUPERADMIN_ID}');`,
        { role: "service_role" }
      );
      assert.equal(init1.status, 0, init1.stderr);
      const approvalId2 = init1.stdout;

      // Verify initiator_role_at_request = 'SUPER_ADMIN' and capture requested_at + audit count
      const beforeDup = JSON.parse(
        runPsql(`
          SELECT json_build_object(
            'role', da.initiator_role_at_request,
            'requested_at', da.requested_at,
            'audit_count', (SELECT count(*) FROM public.audit_logs WHERE entity_type = 'draw_approval' AND entity_id = da.id AND action = 'APPROVAL_REQUESTED')
          ) FROM public.draw_approvals da WHERE da.id = '${approvalId2}';
        `).stdout
      );
      assert.equal(beforeDup.role, "SUPER_ADMIN");
      assert.equal(beforeDup.audit_count, 1);

      // Idempotent duplicate by same initiator returns same ID AND preserves requested_at & audit row count
      const init1Dup = runPsql(
        `SELECT public.admin_request_first_prize_approval('${DRAW_2}', '${PRIZE_1}', '${snap2.snapshotId}', '${NEW_SUPERADMIN_ID}');`,
        { role: "service_role" }
      );
      assert.equal(init1Dup.status, 0, init1Dup.stderr);
      assert.equal(init1Dup.stdout, approvalId2);

      const afterDup = JSON.parse(
        runPsql(`
          SELECT json_build_object(
            'requested_at', da.requested_at,
            'audit_count', (SELECT count(*) FROM public.audit_logs WHERE entity_type = 'draw_approval' AND entity_id = da.id AND action = 'APPROVAL_REQUESTED')
          ) FROM public.draw_approvals da WHERE da.id = '${approvalId2}';
        `).stdout
      );
      assert.equal(afterDup.requested_at, beforeDup.requested_at, "Idempotent duplicate must preserve exact requested_at");
      assert.equal(afterDup.audit_count, 1, "Idempotent duplicate must not append extra audit_logs rows");

      // Demoted ADMIN (admin@ssfi.org) independently approves DRAW_2
      const adminApprove = runPsql(
        `SELECT public.admin_record_first_prize_approval('${approvalId2}', 'APPROVED', 'Approved by ADMIN', '${OLD_SUPERADMIN_ID}');`,
        { role: "service_role" }
      );
      assert.equal(adminApprove.status, 0, adminApprove.stderr);

      // REV-10B-05: TRUE same-draw snapshot mismatch test!
      // DRAW_2 + PRIZE_1 ALREADY has an APPROVED approval (approvalId2) bound to snap2.snapHash.
      // Temporarily point approvalId2.snapshot_hash to a different hash (simulating a snapshot change after approval)
      // and verify DRAW_2 + PRIZE_1 execution against snap2 is REJECTED specifically due to snapshot_hash mismatch.
      const changedHash = "f".repeat(64);
      const mutateHash = runPsql(
        `UPDATE public.draw_approvals SET snapshot_hash = '${changedHash}' WHERE id = '${approvalId2}';`
      );
      assert.equal(mutateHash.status, 0, mutateHash.stderr);

      const entropy2 = "cc".repeat(32);
      const combined2Valid = computeCombinedSeed(snap2.serverSeed, entropy2, snap2.snapHash, PRIZE_1);
      const execMismatch = runPsql(
        `SELECT public.execute_draw_winner_selection('${DRAW_2}', '${PRIZE_1}', '${snap2.snapshotId}', 0, '${snap2.seedCommitment}', '${snap2.serverSeed}', '${combined2Valid}', '${NEW_SUPERADMIN_ID}', '${entropy2}');`,
        { role: "service_role" }
      );
      assert.notEqual(execMismatch.status, 0, "Execution on same draw/prize with mismatched approval snapshot_hash must be rejected");
      assert.match(execMismatch.stderr, /Dual approval violation/i);

      // Restore exact approved snapshot_hash on approvalId2
      const restoreHash = runPsql(
        `UPDATE public.draw_approvals SET snapshot_hash = '${snap2.snapHash}' WHERE id = '${approvalId2}';`
      );
      assert.equal(restoreHash.status, 0, restoreHash.stderr);

      // REV-10B-06: Revoked approver test!
      // Strip ADMIN role from OLD_SUPERADMIN_ID (the approver of approvalId2) -> execution MUST be rejected
      const stripApprover = runPsql(
        `DELETE FROM public.profile_roles WHERE profile_id = '${OLD_SUPERADMIN_ID}';`
      );
      assert.equal(stripApprover.status, 0, stripApprover.stderr);

      const execRevokedApprover = runPsql(
        `SELECT public.execute_draw_winner_selection('${DRAW_2}', '${PRIZE_1}', '${snap2.snapshotId}', 0, '${snap2.seedCommitment}', '${snap2.serverSeed}', '${combined2Valid}', '${NEW_SUPERADMIN_ID}', '${entropy2}');`,
        { role: "service_role" }
      );
      assert.notEqual(execRevokedApprover.status, 0, "Execution must be rejected when approver no longer holds active ADMIN/SUPER_ADMIN role");
      assert.match(execRevokedApprover.stderr, /Dual approval violation/i);

      // Restore ADMIN role to OLD_SUPERADMIN_ID and verify DRAW_2 execution now SUCCEEDS (proving zero false positives!)
      const restoreApprover = runPsql(
        `INSERT INTO public.profile_roles (profile_id, role_id) SELECT '${OLD_SUPERADMIN_ID}'::uuid, id FROM public.roles WHERE name = 'ADMIN';`
      );
      assert.equal(restoreApprover.status, 0, restoreApprover.stderr);

      const execDraw2Valid = runPsql(
        `SELECT public.execute_draw_winner_selection('${DRAW_2}', '${PRIZE_1}', '${snap2.snapshotId}', 0, '${snap2.seedCommitment}', '${snap2.serverSeed}', '${combined2Valid}', '${NEW_SUPERADMIN_ID}', '${entropy2}');`,
        { role: "service_role" }
      );
      assert.equal(execDraw2Valid.status, 0, `DRAW_2 execution must succeed once snapshot hash and active approver role match: ${execDraw2Valid.stderr}`);
      wonIds.add(snap2.sorted[0].id);

      // Re-initiation after REJECTED works cleanly and second SUPER_ADMIN can approve on DRAW_3
      const subsetPool = allTickets.filter((x) => !wonIds.has(x.id));
      const snap3 = lockSnapshot(DRAW_3, PRIZE_1, subsetPool);
      const init3 = runPsql(
        `SELECT public.admin_request_first_prize_approval('${DRAW_3}', '${PRIZE_1}', '${snap3.snapshotId}', '${NEW_SUPERADMIN_ID}');`,
        { role: "service_role" }
      );
      assert.equal(init3.status, 0, init3.stderr);
      const rej3 = runPsql(
        `SELECT public.admin_record_first_prize_approval('${init3.stdout}', 'REJECTED', 'Needs re-review', '${OLD_SUPERADMIN_ID}');`,
        { role: "service_role" }
      );
      assert.equal(rej3.status, 0, rej3.stderr);
      const reinit3 = runPsql(
        `SELECT public.admin_request_first_prize_approval('${DRAW_3}', '${PRIZE_1}', '${snap3.snapshotId}', '${NEW_SUPERADMIN_ID}');`,
        { role: "service_role" }
      );
      assert.equal(reinit3.status, 0, reinit3.stderr);
      const super2Approve = runPsql(
        `SELECT public.admin_record_first_prize_approval('${reinit3.stdout}', 'APPROVED', 'Approved by 2nd SUPER_ADMIN', '${OTHER_SUPERADMIN_ID}');`,
        { role: "service_role" }
      );
      assert.equal(super2Approve.status, 0, super2Approve.stderr);
    });

    // =========================================================================
    // TEST 6: Rollback restores exact pre-10B functions, RLS policy, privileges, triggers, and columns
    // =========================================================================
    await t.test("6. Rollback script restores exact pre-10B schema, functions, RLS policy, and privileges", () => {
      const rollbackPath = path.resolve(
        process.cwd(),
        "supabase",
        "rollback",
        "202611200001_phase_10b_rollback.sql"
      );
      const rbRes = runPsqlFile(rollbackPath);
      assert.equal(rbRes.status, 0, `Rollback failed: ${rbRes.stderr}`);

      const postRollbackState = capturePre10bState();
      assert.deepEqual(
        postRollbackState,
        baselineState,
        "Post-rollback state must exactly match pre-10B baseline across functions, RLS policies, grants, triggers, and columns"
      );

      // Verify original pending request row & audit log still exist after rollback
      const rowStillExists = runPsql(
        `SELECT count(*) FROM public.draw_approvals WHERE id = '${PENDING_APPROVAL_ID}';`
      ).stdout;
      assert.equal(rowStillExists, "1");
      const auditStillExists = runPsql(
        `SELECT count(*) FROM public.audit_logs WHERE entity_id = '${PENDING_APPROVAL_ID}' AND action = 'APPROVAL_REQUESTED';`
      ).stdout;
      assert.equal(auditStillExists, "1");
    });
  }
);
