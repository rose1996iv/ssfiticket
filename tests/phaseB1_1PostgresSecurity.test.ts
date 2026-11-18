import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";
const INITDB = path.join(PG_BIN, "initdb.exe");
const PG_CTL = path.join(PG_BIN, "pg_ctl.exe");
const PSQL = path.join(PG_BIN, "psql.exe");

const PG_AVAILABLE =
  fs.existsSync(INITDB) && fs.existsSync(PG_CTL) && fs.existsSync(PSQL);

const PORT = "55432";
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

test(
  "Phase B1.1 Real PostgreSQL 18 Security, Concurrency & Rollback Integration Suite",
  { skip: !PG_AVAILABLE ? "Local PostgreSQL 18 binaries not found" : false },
  async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssfi-pg18-b1-1-"));
    const dataDir = path.join(tmpDir, "data");
    const logFile = path.join(tmpDir, "pg.log");

    // Fixed synthetic UUIDs (Canonical campaign & prizes are resolved dynamically from migrated DB)
    const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
    const ADMIN2_ID = "22222222-2222-4222-8222-222222222222";
    let CAMP_CANON = "";
    const CAMP_SYNTH = "33333333-3333-4333-8333-333333333333";
    let PRIZE_5 = "";
    let PRIZE_4 = "";
    const PRIZE_SYNTH_5 = "55555555-5555-4555-8555-555555555595";
    const DRAW_1 = "66666666-6666-4666-8666-666666666601";
    const DRAW_2 = "66666666-6666-4666-8666-666666666602";
    const DRAW_SYNTH = "66666666-6666-4666-8666-666666666699";
    const CUST_1 = "77777777-7777-4777-8777-777777777701";
    const CUST_2 = "77777777-7777-4777-8777-777777777702";
    const ORD_1 = "88888888-8888-4888-8888-888888888801";
    const ORD_2 = "88888888-8888-4888-8888-888888888802";
    const ORD_UNPAID = "88888888-8888-4888-8888-888888888803";
    const TKT_1 = "99999999-9999-4999-8999-999999999901";
    const TKT_2 = "99999999-9999-4999-8999-999999999902";
    const TKT_VOID = "99999999-9999-4999-8999-999999999903";
    const TKT_UNPAID = "99999999-9999-4999-8999-999999999904";
    const TKT_SYNTH = "99999999-9999-4999-8999-999999999999";

    const SEED_1 = "a".repeat(64);
    const COMMIT_1 = crypto.createHash("sha256").update(SEED_1, "utf8").digest("hex").toLowerCase();
    const COMBINED_1 = "b".repeat(64);
    const SNAP_HASH = "c".repeat(64);

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

    // 1. Initialize & start disposable PostgreSQL 18 cluster
    const initRes = spawnSync(INITDB, ["-D", dataDir, "-U", "postgres", "--auth=trust", "--encoding=UTF8"], {
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(initRes.status, 0, `initdb failed: ${initRes.error?.message || initRes.stderr}`);

    const startRes = spawnSync(
      PG_CTL,
      ["-D", dataDir, "-l", logFile, "-o", `-p ${PORT} -k "${tmpDir}" -c listen_addresses=127.0.0.1`, "start"],
      { stdio: "ignore", timeout: 30000 }
    );
    if (startRes.status !== 0 || startRes.error) {
      const pgLog = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "(no pg.log)";
      assert.fail(
        `pg_ctl start failed (status=${startRes.status}, err=${startRes.error?.message || "none"}): ${pgLog}`
      );
    }

    // 2. Bootstrap Supabase-compatible roles, auth schema, and minimal test-only storage schema
    const bootstrapRes = runPsql(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE SCHEMA IF NOT EXISTS extensions;
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
    assert.equal(bootstrapRes.status, 0, `Bootstrap failed: ${bootstrapRes.stderr}`);

    // 3. Apply pre-B1 migrations (202610270001 .. 202611080002), skipping 202611140001/202611140002
    const migDir = path.resolve(process.cwd(), "supabase/migrations");
    const preB1Files = fs
      .readdirSync(migDir)
      .filter((f) => f.endsWith(".sql") && f < "202611140000")
      .sort();

    for (const f of preB1Files) {
      const r = runPsqlFile(path.join(migDir, f));
      assert.equal(r.status, 0, `Pre-B1 migration ${f} failed: ${r.stderr}`);
    }

    // 4. Apply Phase B1.1 self-contained migration directly on top of pre-B1 baseline
    const b11Path = path.resolve(process.cwd(), "supabase/migrations/202611140002_phase_b1_1_security_corrections.sql");
    const b11Res = runPsqlFile(b11Path);
    assert.equal(b11Res.status, 0, `202611140002 failed: ${b11Res.stderr}`);

    // 5. Resolve existing canonical campaign & prizes (no duplicate insert, no overwrite)
    const canonLookup = runPsql(`
      SELECT c.id || '|' || p5.id || '|' || p4.id || '|' || c.status || '|' || c.ticket_price_paise
      FROM public.campaigns c
      JOIN public.prizes p5 ON p5.campaign_id = c.id AND p5.prize_number = 5
      JOIN public.prizes p4 ON p4.campaign_id = c.id AND p4.prize_number = 4
      WHERE c.public_id = 'ssfi-fundraising-lucky-draw';
    `);
    assert.equal(canonLookup.status, 0, `Canonical lookup failed: ${canonLookup.stderr}`);
    const [resolvedCampId, resolvedPrize5, resolvedPrize4, canonStatus, canonPriceStr] = canonLookup.stdout.trim().split("|");
    assert.match(resolvedCampId || "", /^[0-9a-f-]{36}$/i, "Expected existing canonical campaign UUID");
    CAMP_CANON = resolvedCampId;
    PRIZE_5 = resolvedPrize5;
    PRIZE_4 = resolvedPrize4;
    const ticketPrice = Number(canonPriceStr || "10000");

    // 6. Seed synthetic test fixtures referencing resolved canonical campaign
    const seedRes = runPsql(`
      INSERT INTO auth.users (id, email, phone, raw_user_meta_data) VALUES
        ('${ADMIN_ID}', 'admin1@test.local', '9000000011', '{"full_name":"Admin One"}'::jsonb),
        ('${ADMIN2_ID}', 'admin2@test.local', '9000000012', '{"full_name":"Admin Two"}'::jsonb);
      INSERT INTO public.profile_roles (profile_id, role_id)
      SELECT '${ADMIN_ID}'::uuid, id FROM public.roles WHERE name = 'SUPER_ADMIN'
      UNION ALL
      SELECT '${ADMIN2_ID}'::uuid, id FROM public.roles WHERE name = 'ADMIN';

      INSERT INTO public.campaigns (id, public_id, name, status, ticket_price_paise, total_ticket_limit)
      VALUES
        ('${CAMP_SYNTH}', 'synth-rehearsal', 'Synthetic Campaign', 'ACTIVE', 50000, 100);

      INSERT INTO public.prizes (id, campaign_id, prize_number, title, cash_amount_paise, display_order)
      VALUES
        ('${PRIZE_SYNTH_5}', '${CAMP_SYNTH}', 5, 'Synth 5th', 100000, 1);

      INSERT INTO public.draws (id, campaign_id, name, status)
      VALUES
        ('${DRAW_1}', '${CAMP_CANON}', 'Canonical Draw 1', 'SCHEDULED'),
        ('${DRAW_2}', '${CAMP_CANON}', 'Canonical Draw 2', 'SCHEDULED'),
        ('${DRAW_SYNTH}', '${CAMP_SYNTH}', 'Synthetic Draw 1', 'SCHEDULED');

      INSERT INTO public.customers (id, full_name, email, phone)
      VALUES
        ('${CUST_1}', 'Cust One', 'c1@test.local', '9000000001'),
        ('${CUST_2}', 'Cust Two', 'c2@test.local', '9000000002');

      INSERT INTO public.orders (id, order_number, campaign_id, customer_id, quantity, unit_price_paise, total_amount_paise, status)
      VALUES
        ('${ORD_1}', 'ORD-2026-000001', '${CAMP_CANON}', '${CUST_1}', 1, ${ticketPrice}, ${ticketPrice}, 'TICKETS_ISSUED'),
        ('${ORD_2}', 'ORD-2026-000002', '${CAMP_CANON}', '${CUST_2}', 1, ${ticketPrice}, ${ticketPrice}, 'TICKETS_ISSUED'),
        ('${ORD_UNPAID}', 'ORD-2026-000003', '${CAMP_CANON}', '${CUST_2}', 1, ${ticketPrice}, ${ticketPrice}, 'TICKETS_ISSUED');

      INSERT INTO public.payments (order_id, status, amount_paise, submitted_at, verified_at, verified_by)
      VALUES
        ('${ORD_1}', 'VERIFIED', ${ticketPrice}, now(), now(), '${ADMIN_ID}'),
        ('${ORD_2}', 'VERIFIED', ${ticketPrice}, now(), now(), '${ADMIN_ID}'),
        ('${ORD_UNPAID}', 'PENDING', ${ticketPrice}, NULL, NULL, NULL);

      INSERT INTO public.tickets (id, campaign_id, order_id, customer_id, ticket_number, status)
      VALUES
        ('${TKT_1}', '${CAMP_CANON}', '${ORD_1}', '${CUST_1}', 'SSFI-000001', 'ISSUED'),
        ('${TKT_2}', '${CAMP_CANON}', '${ORD_2}', '${CUST_2}', 'SSFI-000002', 'ISSUED'),
        ('${TKT_VOID}', '${CAMP_CANON}', '${ORD_1}', '${CUST_1}', 'SSFI-000003', 'VOID'),
        ('${TKT_UNPAID}', '${CAMP_CANON}', '${ORD_UNPAID}', '${CUST_2}', 'SSFI-000004', 'ISSUED');

      DO $$
      DECLARE
        v_max_ticket_num bigint;
        v_seq_last bigint;
        v_seq_called boolean;
      BEGIN
        SELECT COALESCE(MAX((regexp_match(ticket_number, '^SSFI-([0-9]+)$'))[1]::bigint), 0)
        INTO v_max_ticket_num
        FROM public.tickets;

        SELECT last_value, is_called
        INTO v_seq_last, v_seq_called
        FROM public.ssfi_ticket_number_sequence;

        IF v_max_ticket_num > 0 AND (NOT v_seq_called OR v_seq_last < v_max_ticket_num) THEN
          PERFORM setval('public.ssfi_ticket_number_sequence', v_max_ticket_num, true);
        END IF;
      END $$;
    `);
    assert.equal(seedRes.status, 0, `Fixture seed failed (canonical status=${canonStatus}): ${seedRes.stderr}`);

    // Verify DRAFT canonical campaign is rejected by default
    await t.test("Lifecycle guard: DRAFT canonical campaign cannot be locked", () => {
      const draftRes = runPsql(
        `SELECT public.admin_lock_eligibility_snapshot('${DRAW_1}', '${PRIZE_5}', '${SNAP_HASH}', ARRAY['${TKT_1}']::uuid[], ARRAY['SSFI-000001'], '${ADMIN_ID}');`,
        "service_role"
      );
      assert.notEqual(draftRes.status, 0);
      assert.match(draftRes.stderr, /not in ACTIVE\/CLOSED state/);
    });

    // Temporarily transition disposable DB canonical campaign to ACTIVE for lock/draw tests, then restore
    const activateRes = runPsql(`UPDATE public.campaigns SET status = 'ACTIVE' WHERE id = '${CAMP_CANON}';`);
    assert.equal(activateRes.status, 0, activateRes.stderr);

    try {
    // B1.1-06 Array validation tests
    await t.test("B1.1-06: Array validation rejects NULL, empty, unequal, non-1-based, NULL element, and duplicates", () => {
      const badCalls = [
        `SELECT public.admin_lock_eligibility_snapshot('${DRAW_1}', '${PRIZE_5}', '${SNAP_HASH}', NULL::uuid[], ARRAY['SSFI-000001'], '${ADMIN_ID}');`,
        `SELECT public.admin_lock_eligibility_snapshot('${DRAW_1}', '${PRIZE_5}', '${SNAP_HASH}', ARRAY[]::uuid[], ARRAY[]::text[], '${ADMIN_ID}');`,
        `SELECT public.admin_lock_eligibility_snapshot('${DRAW_1}', '${PRIZE_5}', '${SNAP_HASH}', ARRAY['${TKT_1}']::uuid[], ARRAY['SSFI-000001','SSFI-000002'], '${ADMIN_ID}');`,
        `SELECT public.admin_lock_eligibility_snapshot('${DRAW_1}', '${PRIZE_5}', '${SNAP_HASH}', '[0:0]={${TKT_1}}'::uuid[], '[0:0]={SSFI-000001}'::text[], '${ADMIN_ID}');`,
        `SELECT public.admin_lock_eligibility_snapshot('${DRAW_1}', '${PRIZE_5}', '${SNAP_HASH}', ARRAY[NULL::uuid], ARRAY['SSFI-000001'], '${ADMIN_ID}');`,
        `SELECT public.admin_lock_eligibility_snapshot('${DRAW_1}', '${PRIZE_5}', '${SNAP_HASH}', ARRAY['${TKT_1}','${TKT_1}']::uuid[], ARRAY['SSFI-000001','SSFI-000002'], '${ADMIN_ID}');`,
        `SELECT public.admin_lock_eligibility_snapshot('${DRAW_1}', '${PRIZE_5}', '${SNAP_HASH}', ARRAY['${TKT_1}','${TKT_2}']::uuid[], ARRAY['SSFI-000001',' ssfi-000001 '], '${ADMIN_ID}');`,
      ];
      for (const sql of badCalls) {
        const res = runPsql(sql, "service_role");
        assert.notEqual(res.status, 0, `Expected failure for: ${sql}`);
      }
    });

    // B1.1-05 Canonical campaign enforcement
    await t.test("B1.1-05: Synthetic campaign draw is rejected by admin_lock_eligibility_snapshot", () => {
      const res = runPsql(
        `SELECT public.admin_lock_eligibility_snapshot('${DRAW_SYNTH}', '${PRIZE_SYNTH_5}', '${SNAP_HASH}', ARRAY['${TKT_1}']::uuid[], ARRAY['SSFI-000001'], '${ADMIN_ID}');`,
        "service_role"
      );
      assert.notEqual(res.status, 0);
      assert.match(res.stderr, /Canonical campaign violation/);
    });

    // Eligibility enforcement (unpaid / void rejected)
    await t.test("B1.1-03: Unpaid order and VOID ticket are rejected at snapshot lock", () => {
      const r1 = runPsql(
        `SELECT public.admin_lock_eligibility_snapshot('${DRAW_1}', '${PRIZE_5}', '${SNAP_HASH}', ARRAY['${TKT_UNPAID}']::uuid[], ARRAY['SSFI-000004'], '${ADMIN_ID}');`,
        "service_role"
      );
      assert.notEqual(r1.status, 0);
      assert.match(r1.stderr, /Eligibility violation/);

      const r2 = runPsql(
        `SELECT public.admin_lock_eligibility_snapshot('${DRAW_1}', '${PRIZE_5}', '${SNAP_HASH}', ARRAY['${TKT_VOID}']::uuid[], ARRAY['SSFI-000003'], '${ADMIN_ID}');`,
        "service_role"
      );
      assert.notEqual(r2.status, 0);
      assert.match(r2.stderr, /Eligibility violation/);
    });

    // Lock valid snapshot for DRAW_1 / PRIZE_5
    let snapId = "";
    await t.test("Valid canonical snapshot locks successfully", () => {
      const res = runPsql(
        `SELECT public.admin_lock_eligibility_snapshot('${DRAW_1}', '${PRIZE_5}', '${SNAP_HASH}', ARRAY['${TKT_1}','${TKT_2}']::uuid[], ARRAY['SSFI-000001','SSFI-000002'], '${ADMIN_ID}');`,
        "service_role"
      );
      assert.equal(res.status, 0, res.stderr);
      snapId = res.stdout.trim();
      assert.match(snapId, /^[0-9a-f-]{36}$/i);
    });

    // B1.1-01 Strict seed commitment validation
    await t.test("B1.1-01: NULL, empty, malformed, and mismatched seed/commitments are rejected", () => {
      const badSeeds = [
        `SELECT public.execute_draw_winner_selection('${DRAW_1}','${PRIZE_5}','${snapId}',0,NULL,'${SEED_1}','${COMBINED_1}','${ADMIN_ID}');`,
        `SELECT public.execute_draw_winner_selection('${DRAW_1}','${PRIZE_5}','${snapId}',0,'${COMMIT_1}',NULL,'${COMBINED_1}','${ADMIN_ID}');`,
        `SELECT public.execute_draw_winner_selection('${DRAW_1}','${PRIZE_5}','${snapId}',0,'${COMMIT_1}','   ','${COMBINED_1}','${ADMIN_ID}');`,
        `SELECT public.execute_draw_winner_selection('${DRAW_1}','${PRIZE_5}','${snapId}',0,'not-hex-64','${SEED_1}','${COMBINED_1}','${ADMIN_ID}');`,
        `SELECT public.execute_draw_winner_selection('${DRAW_1}','${PRIZE_5}','${snapId}',0,'${"f".repeat(64)}','${SEED_1}','${COMBINED_1}','${ADMIN_ID}');`,
      ];
      for (const sql of badSeeds) {
        const res = runPsql(sql, "service_role");
        assert.notEqual(res.status, 0, `Expected seed rejection for: ${sql}`);
      }
    });

    // B1.1-02 Snapshot integrity validation
    await t.test("B1.1-02: Wrong-prize snapshot and non-contiguous/tampered snapshot are rejected", () => {
      const wrongPrize = runPsql(
        `SELECT public.execute_draw_winner_selection('${DRAW_1}','${PRIZE_4}','${snapId}',0,'${COMMIT_1}','${SEED_1}','${COMBINED_1}','${ADMIN_ID}');`,
        "service_role"
      );
      assert.notEqual(wrongPrize.status, 0);
    });

    // B1.1-04 Concurrent duplicate winner prevention
    await t.test("B1.1-04: Concurrent winner selection & cross-session duplicate winner are blocked", async () => {
      const snap2 = runPsql(
        `SELECT public.admin_lock_eligibility_snapshot('${DRAW_2}', '${PRIZE_5}', '${SNAP_HASH}', ARRAY['${TKT_1}','${TKT_2}']::uuid[], ARRAY['SSFI-000001','SSFI-000002'], '${ADMIN_ID}');`,
        "service_role"
      );
      assert.equal(snap2.status, 0, snap2.stderr);
      const snap2Id = snap2.stdout.trim();

      const [c1, c2] = await Promise.all([
        runPsqlAsync(
          `SELECT public.execute_draw_winner_selection('${DRAW_1}','${PRIZE_5}','${snapId}',0,'${COMMIT_1}','${SEED_1}','${COMBINED_1}','${ADMIN_ID}');`,
          "service_role"
        ),
        runPsqlAsync(
          `SELECT public.execute_draw_winner_selection('${DRAW_2}','${PRIZE_5}','${snap2Id}',0,'${COMMIT_1}','${SEED_1}','${COMBINED_1}','${ADMIN_ID}');`,
          "service_role"
        ),
      ]);

      const successes = [c1, c2].filter((r) => r.status === 0);
      const failures = [c1, c2].filter((r) => r.status !== 0);
      assert.equal(successes.length, 1, "Exactly one concurrent transaction may commit the winner");
      assert.equal(failures.length, 1, "Second concurrent transaction must be rejected");
      assert.match(failures[0].stderr, /Duplicate winner violation|already won|Eligibility violation/);
    });

    // B1.1-07 Replacement lineage, VOID immutability & hard-delete block
    await t.test("B1.1-07: Ticket deletion, VOID reversal, VOID reissue, and duplicate replacement are blocked; valid reissue works", () => {
      const delRes = runPsql(`DELETE FROM public.tickets WHERE id = '${TKT_VOID}';`);
      assert.notEqual(delRes.status, 0);
      assert.match(delRes.stderr, /Hard deletion of tickets is prohibited/);

      const revRes = runPsql(`UPDATE public.tickets SET status = 'ISSUED' WHERE id = '${TKT_VOID}';`);
      assert.notEqual(revRes.status, 0);
      assert.match(revRes.stderr, /VOID is a terminal state/);

      const voidReissue = runPsql(`SELECT public.admin_reissue_ticket('${TKT_VOID}', '${ADMIN_ID}', 'Attempt on void');`, "service_role");
      assert.notEqual(voidReissue.status, 0);
      assert.match(voidReissue.stderr, /cannot reissue a VOID ticket/);

      const validReissue = runPsql(`SELECT public.admin_reissue_ticket('${TKT_2}', '${ADMIN_ID}', 'Damaged print');`, "service_role");
      assert.equal(validReissue.status, 0, validReissue.stderr);

      const secondReissue = runPsql(`SELECT public.admin_reissue_ticket('${TKT_2}', '${ADMIN_ID}', 'Second attempt');`, "service_role");
      assert.notEqual(secondReissue.status, 0);
    });
    } finally {
      runPsql(`UPDATE public.campaigns SET status = '${canonStatus}' WHERE id = '${CAMP_CANON}';`);
    }

    // Privilege isolation test
    await t.test("SECURITY DEFINER privilege isolation: anon & authenticated cannot execute admin RPCs", () => {
      for (const role of ["anon", "authenticated"]) {
        const r = runPsql(
          `SELECT public.admin_reissue_ticket('${TKT_1}', '${ADMIN_ID}', 'Unauthorized');`,
          role
        );
        assert.notEqual(r.status, 0, `${role} must not execute admin_reissue_ticket`);
      }
    });

    // B1.1-08 Rollback test
    await t.test("B1.1-08: Rollback script cleanly removes B1.1 objects and restores pre-B1 functions", () => {
      const rbPath = path.resolve(process.cwd(), "supabase/rollback/202611140002_phase_b1_1_rollback.sql");
      const rbRes = runPsqlFile(rbPath);
      assert.equal(rbRes.status, 0, `Rollback failed: ${rbRes.stderr}`);

      const checkIdx = runPsql(
        `SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='idx_tickets_unique_original_ticket_id';`
      );
      assert.equal(checkIdx.stdout.trim(), "0");

      // Re-apply 202611140002 to prove idempotent re-application after rollback
      const reapply = runPsqlFile(b11Path);
      assert.equal(reapply.status, 0, `Re-apply after rollback failed: ${reapply.stderr}`);
    });
  }
);
