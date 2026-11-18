import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import {
  generateServerSeed,
  computeCombinedSeed,
  deriveWinningIndex,
} from "../src/lib/draw/randomness.ts";
import {
  sortTicketsCanonically,
  computeCanonicalSnapshotHash,
} from "../src/lib/draw/canonical.ts";
import {
  loadSealingConfig,
  sealDrawSeed,
  unsealDrawSeed,
  type SealedSeedEnvelope,
} from "../src/lib/draw/sealing.ts";

const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";
const INITDB = path.join(PG_BIN, "initdb.exe");
const PG_CTL = path.join(PG_BIN, "pg_ctl.exe");
const PSQL = path.join(PG_BIN, "psql.exe");

const PG_AVAILABLE =
  fs.existsSync(INITDB) && fs.existsSync(PG_CTL) && fs.existsSync(PSQL);

const PORT = "55435";
const DB_NAME = "postgres";

function buildRolePrefix(role?: string): string {
  if (!role) return "";
  const safeRole = role.replace(/'/g, "''");
  return `DO $$ BEGIN PERFORM set_config('request.jwt.claim.role', '${safeRole}', false); END $$;\nSET ROLE ${role};\n`;
}

function runPsql(sql: string, role?: string): { status: number; stdout: string; stderr: string } {
  const fullSql = `${buildRolePrefix(role)}${sql}`;
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

function runPsqlAsync(sql: string, role?: string): Promise<{ status: number; stdout: string; stderr: string }> {
  const fullSql = `${buildRolePrefix(role)}${sql}`;
  return new Promise((resolve) => {
    const child = spawn(
      PSQL,
      ["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      resolve({ status: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.stdin.write(fullSql);
    child.stdin.end();
  });
}

function captureDbState(): Record<string, unknown> {
  const q = (sql: string) => {
    const r = runPsql(sql);
    assert.equal(r.status, 0, `State capture query failed: ${r.stderr}`);
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
          AND p.proname IN ('execute_draw_winner_selection', 'admin_lock_eligibility_snapshot')
      ) t;
    `),
    policies: q(`
      SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.tablename, t.policyname), '[]'::json)
      FROM (
        SELECT
          tablename,
          policyname,
          permissive,
          roles::text AS roles,
          cmd,
          qual,
          with_check
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
            'campaigns', 'draws', 'prizes', 'draw_results',
            'draw_randomness_evidence', 'draw_eligibility_snapshots',
            'draw_snapshot_tickets', 'draw_manual_exclusions', 'draw_approvals'
          )
      ) t;
    `),
    privileges: q(`
      SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.table_name, t.grantee, t.privilege_type), '[]'::json)
      FROM (
        SELECT table_name, grantee, privilege_type
        FROM information_schema.table_privileges
        WHERE table_schema = 'public'
          AND grantee IN ('anon', 'authenticated', 'service_role')
          AND table_name IN (
            'campaigns', 'draws', 'prizes', 'draw_results',
            'draw_randomness_evidence', 'draw_eligibility_snapshots',
            'draw_snapshot_tickets', 'draw_manual_exclusions', 'draw_approvals'
          )
      ) t;
    `),
    snapshotColumns: q(`
      SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.ordinal_position), '[]'::json)
      FROM (
        SELECT column_name, data_type, is_nullable, ordinal_position
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'draw_eligibility_snapshots'
      ) t;
    `),
  };
}

test("R5: Keyring versioned sealing, rotation, and fail-closed unknown kid", async (t) => {
  const keyV1 = "11".repeat(32);
  const keyV2 = "22".repeat(32);
  const ctx = {
    campaignId: "00000000-0000-4000-8000-000000000001",
    drawId: "66666666-6666-4666-8666-666666666601",
    prizeId: "55555555-5555-4555-8555-555555555505",
  };
  const { serverSeed } = generateServerSeed();

  await t.test("seals with activeKid and unseals with same key", () => {
    const cfg1 = loadSealingConfig({
      SSFI_DRAW_SEALING_KEY: keyV1,
      SSFI_DRAW_ACTIVE_KID: "kid-v1",
    });
    const env = sealDrawSeed(serverSeed, ctx, cfg1);
    assert.equal(env.kid, "kid-v1");
    assert.equal(env.version, 1);
    assert.equal(env.alg, "AES-256-GCM");
    assert.equal(unsealDrawSeed(env, ctx, cfg1), serverSeed);
  });

  await t.test("rotates active key to kid-v2 while unsealing kid-v1 via SSFI_DRAW_PREVIOUS_KEYS (JSON & CSV)", () => {
    const cfg1 = loadSealingConfig({
      SSFI_DRAW_SEALING_KEY: keyV1,
      SSFI_DRAW_ACTIVE_KID: "kid-v1",
    });
    const oldEnvelope = sealDrawSeed(serverSeed, ctx, cfg1);

    const cfg2Json = loadSealingConfig({
      SSFI_DRAW_SEALING_KEY: keyV2,
      SSFI_DRAW_ACTIVE_KID: "kid-v2",
      SSFI_DRAW_PREVIOUS_KEYS: JSON.stringify({ "kid-v1": keyV1 }),
    });
    const newEnvelope = sealDrawSeed(serverSeed, ctx, cfg2Json);
    assert.equal(newEnvelope.kid, "kid-v2");
    assert.equal(unsealDrawSeed(oldEnvelope, ctx, cfg2Json), serverSeed);
    assert.equal(unsealDrawSeed(newEnvelope, ctx, cfg2Json), serverSeed);

    const cfg2Csv = loadSealingConfig({
      SSFI_DRAW_SEALING_KEY: keyV2,
      SSFI_DRAW_ACTIVE_KID: "kid-v2",
      SSFI_DRAW_PREVIOUS_KEYS: `kid-v1:${keyV1}`,
    });
    assert.equal(unsealDrawSeed(oldEnvelope, ctx, cfg2Csv), serverSeed);
  });

  await t.test("fails closed on unknown kid, missing kid, or context mismatch", () => {
    const cfg1 = loadSealingConfig({
      SSFI_DRAW_SEALING_KEY: keyV1,
      SSFI_DRAW_ACTIVE_KID: "kid-v1",
    });
    const env = sealDrawSeed(serverSeed, ctx, cfg1);

    const cfgNoPrev = loadSealingConfig({
      SSFI_DRAW_SEALING_KEY: keyV2,
      SSFI_DRAW_ACTIVE_KID: "kid-v2",
    });
    assert.throws(() => unsealDrawSeed(env, ctx, cfgNoPrev), /not configured in keyring|Unknown sealing key id/);

    const missingKidEnv = { ...env, kid: "" } as SealedSeedEnvelope;
    assert.throws(() => unsealDrawSeed(missingKidEnv, ctx, cfg1), /missing a valid key ID/i);

    assert.throws(
      () => unsealDrawSeed(env, { ...ctx, prizeId: "55555555-5555-4555-8555-555555555504" }, cfg1),
      /Unsupported state or unable to authenticate data|authenticate/i
    );
  });
});

test("R3: luckyDraw.ts restricts getDrawOverview and getEligibleTickets to SUPER_ADMIN/ADMIN only", () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/server/actions/luckyDraw.ts"),
    "utf8"
  );
  assert.equal(
    src.includes("FUNDRAISING_MANAGER"),
    false,
    "FUNDRAISING_MANAGER must not be permitted in luckyDraw.ts PII/draw actions"
  );
  assert.equal(
    src.includes("p_seed_commitment: seedCommitment"),
    true,
    "lockEligibilitySnapshot must pass p_seed_commitment to admin_lock_eligibility_snapshot"
  );
  assert.equal(
    src.includes("p_sealed_seed_envelope: sealedEnvelope"),
    true,
    "lockEligibilitySnapshot must pass p_sealed_seed_envelope to admin_lock_eligibility_snapshot"
  );
});

test(
  "Phase B2.6 Disposable PostgreSQL 18 Rollback Equivalence, Sealed Seed Persistence & Concurrency Suite",
  { skip: !PG_AVAILABLE ? "Local PostgreSQL 18 binaries not found" : false },
  async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssfi-pg18-b26-"));
    const dataDir = path.join(tmpDir, "data");
    const logFile = path.join(tmpDir, "pg.log");

    const ADMIN_1 = "11111111-1111-4111-8111-111111111111";
    const ADMIN_2 = "22222222-2222-4222-8222-222222222222";
    const CUST_1 = "77777777-7777-4777-8777-777777777701";
    const CUST_2 = "77777777-7777-4777-8777-777777777702";
    const ORD_1 = "88888888-8888-4888-8888-888888888801";
    const ORD_2 = "88888888-8888-4888-8888-888888888802";
    const TKT_1 = "99999999-9999-4999-8999-999999999901";
    const TKT_2 = "99999999-9999-4999-8999-999999999902";
    const DRAW_1 = "66666666-6666-4666-8666-666666666601";
    const PRIZE_5 = "55555555-5555-4555-8555-555555555505";
    const PRIZE_4 = "55555555-5555-4555-8555-555555555504";

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

    const bootstrapRes = runPsql(`
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
        updated_at timestamptz DEFAULT now(),
        UNIQUE (bucket_id, name)
      );
      ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    `);
    assert.equal(bootstrapRes.status, 0, bootstrapRes.stderr);

    const migDir = path.resolve(process.cwd(), "supabase/migrations");
    const upToB1_1 = fs
      .readdirSync(migDir)
      .filter((f) => f.endsWith(".sql") && f <= "202611140002_phase_b1_1_security_corrections.sql")
      .sort();
    for (const f of upToB1_1) {
      const r = runPsqlFile(path.join(migDir, f));
      assert.equal(r.status, 0, `Migration ${f} failed: ${r.stderr}`);
    }

    const b1_1Baseline = captureDbState();

    await t.test("R1: 202611140003 rollback restores exact B1.1 baseline (functions, policies, privileges)", () => {
      const applyB2 = runPsqlFile(path.join(migDir, "202611140003_phase_b2_public_rls_hardening.sql"));
      assert.equal(applyB2.status, 0, applyB2.stderr);

      const anonDraws = runPsql("SELECT count(*) FROM public.draws;", "anon");
      assert.notEqual(anonDraws.status, 0, "B2 must block anon from reading public.draws");

      const rollbackB2 = runPsqlFile(
        path.resolve(process.cwd(), "supabase/rollback/202611140003_phase_b2_public_rls_rollback.sql")
      );
      assert.equal(rollbackB2.status, 0, rollbackB2.stderr);

      const postRollback = captureDbState();
      assert.deepEqual(
        postRollback,
        b1_1Baseline,
        "202611140003 rollback must restore exact B1.1 baseline state"
      );
    });

    // Re-apply B2 and capture B2 baseline before B2.6
    const reApplyB2 = runPsqlFile(path.join(migDir, "202611140003_phase_b2_public_rls_hardening.sql"));
    assert.equal(reApplyB2.status, 0, reApplyB2.stderr);
    const b2Baseline = captureDbState();

    const applyB2_6 = runPsqlFile(path.join(migDir, "202611140004_phase_b2_6_sealed_seed_persistence.sql"));
    assert.equal(applyB2_6.status, 0, `B2.6 migration failed: ${applyB2_6.stderr}`);

    const canonRes = runPsql(`SELECT id, ticket_price_paise FROM public.campaigns WHERE public_id = 'ssfi-fundraising-lucky-draw';`);
    assert.equal(canonRes.status, 0, canonRes.stderr);
    const [campId, priceStr] = canonRes.stdout.split("|");
    const ticketPrice = Number(priceStr);

    const prizesRes = runPsql(
      `SELECT prize_number || ':' || id FROM public.prizes WHERE campaign_id = '${campId}' ORDER BY prize_number;`
    );
    assert.equal(prizesRes.status, 0, prizesRes.stderr);
    const prizeMap: Record<number, string> = {};
    for (const row of prizesRes.stdout.split(/\r?\n/)) {
      const [num, id] = row.split(":");
      prizeMap[Number(num)] = id;
    }
    const PRIZE_5_ID = prizeMap[5];
    const PRIZE_4_ID = prizeMap[4];
    assert.ok(PRIZE_5_ID && PRIZE_4_ID, "Canonical campaign must have prizes 4 and 5");

    // Seed synthetic fixture
    const seedRes = runPsql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${ADMIN_1}', 'admin1@ssfi.local'),
        ('${ADMIN_2}', 'admin2@ssfi.local');
      INSERT INTO public.profile_roles (profile_id, role_id)
      SELECT '${ADMIN_1}'::uuid, id FROM public.roles WHERE name = 'SUPER_ADMIN'
      UNION ALL
      SELECT '${ADMIN_2}'::uuid, id FROM public.roles WHERE name = 'ADMIN';

      UPDATE public.campaigns SET status = 'ACTIVE' WHERE id = '${campId}';

      INSERT INTO public.draws (id, campaign_id, name, status) VALUES
        ('${DRAW_1}', '${campId}', 'B2.6 Test Draw', 'SCHEDULED');

      INSERT INTO public.customers (id, full_name, email, phone) VALUES
        ('${CUST_1}', 'Fixture Customer 1', 'c1@test.local', '9000000001'),
        ('${CUST_2}', 'Fixture Customer 2', 'c2@test.local', '9000000002');

      INSERT INTO public.orders (id, order_number, campaign_id, customer_id, quantity, unit_price_paise, total_amount_paise, status) VALUES
        ('${ORD_1}', 'ORD-2026-260001', '${campId}', '${CUST_1}', 1, ${ticketPrice}, ${ticketPrice}, 'TICKETS_ISSUED'),
        ('${ORD_2}', 'ORD-2026-260002', '${campId}', '${CUST_2}', 1, ${ticketPrice}, ${ticketPrice}, 'TICKETS_ISSUED');

      INSERT INTO public.payments (order_id, status, amount_paise, submitted_at, verified_at, verified_by) VALUES
        ('${ORD_1}', 'VERIFIED', ${ticketPrice}, now(), now(), '${ADMIN_1}'),
        ('${ORD_2}', 'VERIFIED', ${ticketPrice}, now(), now(), '${ADMIN_1}');

      INSERT INTO public.tickets (id, campaign_id, order_id, customer_id, ticket_number, status) VALUES
        ('${TKT_1}', '${campId}', '${ORD_1}', '${CUST_1}', 'SSFI-000001', 'ISSUED'),
        ('${TKT_2}', '${campId}', '${ORD_2}', '${CUST_2}', 'SSFI-000002', 'ISSUED');
    `);
    assert.equal(seedRes.status, 0, seedRes.stderr);

    const roster = sortTicketsCanonically([
      { id: TKT_1, ticket_number: "SSFI-000001" },
      { id: TKT_2, ticket_number: "SSFI-000002" },
    ]);
    const snapshotHash = computeCanonicalSnapshotHash(roster.map((r) => r.ticket_number));

    const sealingCfg = loadSealingConfig({
      SSFI_DRAW_SEALING_KEY: "aa".repeat(32),
      SSFI_DRAW_ACTIVE_KID: "kid-b26",
    });

    const { serverSeed: seed5, seedCommitment: comm5 } = generateServerSeed();
    const env5 = sealDrawSeed(seed5, { campaignId: campId, drawId: DRAW_1, prizeId: PRIZE_5_ID }, sealingCfg);

    let snap5Id = "";

    await t.test("R2: Snapshot lock persists sealed seed & commitment (no plaintext), and execution enforces commitment match", () => {
      const lock5 = runPsql(`
        SELECT public.admin_lock_eligibility_snapshot(
          '${DRAW_1}'::uuid,
          '${PRIZE_5_ID}'::uuid,
          '${snapshotHash}',
          ARRAY['${TKT_1}'::uuid, '${TKT_2}'::uuid],
          ARRAY['SSFI-000001', 'SSFI-000002'],
          '${ADMIN_1}'::uuid,
          '${comm5}',
          '${JSON.stringify(env5).replace(/'/g, "''")}'::jsonb,
          '${env5.kid}'
        );
      `, "service_role");
      assert.equal(lock5.status, 0, lock5.stderr);
      snap5Id = lock5.stdout;
      assert.ok(snap5Id.length === 36);

      const storedRow = runPsql(`
        SELECT row_to_json(s)::text
        FROM public.draw_eligibility_snapshots s
        WHERE id = '${snap5Id}'::uuid;
      `);
      assert.equal(storedRow.status, 0);
      assert.equal(storedRow.stdout.includes(comm5), true);
      assert.equal(storedRow.stdout.includes("kid-b26"), true);
      assert.equal(storedRow.stdout.includes(seed5), false, "Plaintext serverSeed must never be stored in snapshot row");

      // Mismatched commitment at execution time must fail closed
      const { serverSeed: wrongSeed, seedCommitment: wrongComm } = generateServerSeed();
      const wrongCombined = computeCombinedSeed(wrongSeed, "ent-wrong", snapshotHash, PRIZE_5_ID);
      const wrongIdx = deriveWinningIndex(wrongCombined, 2);
      const execMismatch = runPsql(`
        SELECT public.execute_draw_winner_selection(
          '${DRAW_1}'::uuid,
          '${PRIZE_5_ID}'::uuid,
          '${snap5Id}'::uuid,
          ${wrongIdx},
          '${wrongComm}',
          '${wrongSeed}',
          '${wrongCombined}',
          '${ADMIN_1}'::uuid,
          'ent-wrong'
        );
      `, "service_role");
      assert.notEqual(execMismatch.status, 0);
      assert.match(execMismatch.stderr, /Commitment mismatch/i);

      // Correct pre-committed seed succeeds
      const combined5 = computeCombinedSeed(seed5, "ent-5", snapshotHash, PRIZE_5_ID);
      const idx5 = deriveWinningIndex(combined5, 2);
      const execOk = runPsql(`
        SELECT public.execute_draw_winner_selection(
          '${DRAW_1}'::uuid,
          '${PRIZE_5_ID}'::uuid,
          '${snap5Id}'::uuid,
          ${idx5},
          '${comm5}',
          '${seed5}',
          '${combined5}',
          '${ADMIN_1}'::uuid,
          'ent-5'
        );
      `, "service_role");
      assert.equal(execOk.status, 0, execOk.stderr);
    });

    await t.test("R4: Concurrent admin_lock_eligibility_snapshot calls are atomic & idempotent; hash conflict fails", async () => {
      const winner5 = runPsql(`SELECT ticket_id::text FROM public.draw_results WHERE draw_id = '${DRAW_1}'::uuid AND prize_id = '${PRIZE_5_ID}'::uuid;`).stdout;
      const remainingTicketId = winner5 === TKT_1 ? TKT_2 : TKT_1;
      const remainingTicketNum = winner5 === TKT_1 ? "SSFI-000002" : "SSFI-000001";
      const hash4 = computeCanonicalSnapshotHash([remainingTicketNum]);

      const { serverSeed: seed4, seedCommitment: comm4 } = generateServerSeed();
      const env4 = sealDrawSeed(seed4, { campaignId: campId, drawId: DRAW_1, prizeId: PRIZE_4_ID }, sealingCfg);

      const lockSql4 = `
        SELECT public.admin_lock_eligibility_snapshot(
          '${DRAW_1}'::uuid,
          '${PRIZE_4_ID}'::uuid,
          '${hash4}',
          ARRAY['${remainingTicketId}'::uuid],
          ARRAY['${remainingTicketNum}'],
          '${ADMIN_1}'::uuid,
          '${comm4}',
          '${JSON.stringify(env4).replace(/'/g, "''")}'::jsonb,
          '${env4.kid}'
        );
      `;

      const [r1, r2] = await Promise.all([
        runPsqlAsync(lockSql4, "service_role"),
        runPsqlAsync(lockSql4, "service_role"),
      ]);
      assert.equal(r1.status, 0, `Concurrent lock 1 failed: ${r1.stderr}`);
      assert.equal(r2.status, 0, `Concurrent lock 2 failed: ${r2.stderr}`);
      assert.equal(r1.stdout, r2.stdout, "Concurrent identical lock calls must return same snapshot_id");

      const snapCount = runPsql(`
        SELECT count(*) FROM public.draw_eligibility_snapshots
        WHERE draw_id = '${DRAW_1}'::uuid AND prize_id = '${PRIZE_4_ID}'::uuid;
      `);
      assert.equal(snapCount.stdout, "1");

      // Conflicting snapshot_hash must fail
      const conflictRes = runPsql(`
        SELECT public.admin_lock_eligibility_snapshot(
          '${DRAW_1}'::uuid,
          '${PRIZE_4_ID}'::uuid,
          '${"f".repeat(64)}',
          ARRAY['${remainingTicketId}'::uuid],
          ARRAY['${remainingTicketNum}'],
          '${ADMIN_1}'::uuid,
          '${comm4}',
          '${JSON.stringify(env4).replace(/'/g, "''")}'::jsonb,
          '${env4.kid}'
        );
      `, "service_role");
      assert.notEqual(conflictRes.status, 0);
      assert.match(conflictRes.stderr, /Snapshot conflict/i);

      // Seed reuse across Prize 4 must fail even if matching snapshot commitment
      const snap4Id = r1.stdout;
      const reuseCheck = runPsql(`
        SELECT public.execute_draw_winner_selection(
          '${DRAW_1}'::uuid,
          '${PRIZE_4_ID}'::uuid,
          '${snap4Id}'::uuid,
          0,
          '${comm5}',
          '${seed5}',
          '${computeCombinedSeed(seed5, "ent-reuse", hash4, PRIZE_4_ID)}',
          '${ADMIN_1}'::uuid,
          'ent-reuse'
        );
      `, "service_role");
      assert.notEqual(reuseCheck.status, 0);
      assert.match(reuseCheck.stderr, /Seed reuse violation/i);
    });

    await t.test("R6: 202611140004 rollback restores exact 202611140003 state", () => {
      const rollbackB2_6 = runPsqlFile(
        path.resolve(process.cwd(), "supabase/rollback/202611140004_phase_b2_6_rollback.sql")
      );
      assert.equal(rollbackB2_6.status, 0, rollbackB2_6.stderr);

      const postRollback = captureDbState();
      assert.deepEqual(
        postRollback,
        b2Baseline,
        "202611140004 rollback must restore exact 202611140003 state"
      );
    });
  }
);
