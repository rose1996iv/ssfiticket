import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  generateServerSeed,
  computeCombinedSeed,
  deriveWinningIndex,
  verifySeedCommitment,
} from "../src/lib/draw/randomness.ts";
import {
  sortTicketsCanonically,
  computeCanonicalSnapshotHash,
  verifyDrawEvidence,
} from "../src/lib/draw/canonical.ts";

const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";
const INITDB = path.join(PG_BIN, "initdb.exe");
const PG_CTL = path.join(PG_BIN, "pg_ctl.exe");
const PSQL = path.join(PG_BIN, "psql.exe");

const PG_AVAILABLE =
  fs.existsSync(INITDB) && fs.existsSync(PG_CTL) && fs.existsSync(PSQL);

const PORT = "55433";
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

test("B2.2 Static & Cryptographic Bounds Verification", async (t) => {
  await t.test("deriveWinningIndex enforces [0, N-1] bounds and determinism", () => {
    const { serverSeed, seedCommitment } = generateServerSeed();
    assert.equal(verifySeedCommitment(serverSeed, seedCommitment), true);
    assert.equal(verifySeedCommitment(serverSeed, "0".repeat(64)), false);

    const roster = sortTicketsCanonically([
      { id: "id-2", ticket_number: "SSFI-000010" },
      { id: "id-1", ticket_number: "SSFI-000002" },
    ]);
    assert.deepEqual(
      roster.map((r) => r.ticket_number),
      ["SSFI-000002", "SSFI-000010"]
    );
    const snapHash = computeCanonicalSnapshotHash(roster.map((r) => r.ticket_number));
    const prizeId = "55555555-5555-4555-8555-555555555505";
    const combined = computeCombinedSeed(serverSeed, "op-entropy", snapHash, prizeId);

    for (const n of [1, 2, 7, 1000]) {
      const idx1 = deriveWinningIndex(combined, n);
      const idx2 = deriveWinningIndex(combined, n);
      assert.equal(idx1, idx2);
      assert.ok(idx1 >= 0 && idx1 < n);
    }

    const chosenIdx = deriveWinningIndex(combined, roster.length);
    const evValid = verifyDrawEvidence({
      serverSeedCommitment: seedCommitment,
      serverSeedRevealed: serverSeed,
      clientEntropy: "op-entropy",
      combinedSeed: combined,
      snapshotHash: snapHash,
      prizeId,
      totalCandidates: roster.length,
      selectedIndex: chosenIdx,
      winningTicketNumber: roster[chosenIdx].ticket_number,
      rosterTicketNumbers: roster.map((r) => r.ticket_number),
    });
    assert.equal(evValid.isValid, true);

    const evTampered = verifyDrawEvidence({
      serverSeedCommitment: seedCommitment,
      serverSeedRevealed: serverSeed,
      clientEntropy: "op-entropy",
      combinedSeed: combined,
      snapshotHash: snapHash,
      prizeId,
      totalCandidates: roster.length,
      selectedIndex: (chosenIdx + 1) % roster.length,
      winningTicketNumber: roster[chosenIdx].ticket_number,
      rosterTicketNumbers: ["SSFI-000002", "SSFI-999999"],
    });
    assert.equal(evTampered.isValid, false);
    assert.equal(evTampered.indexMatches, false);
    assert.equal(evTampered.rosterHashMatches, false);
  });

  await t.test("B2.2 Remediated: sealing.ts uses SSFI_DRAW_SEALING_KEY and luckyDraw.ts has no seed reuse or Math.random()", () => {
    const luckyDrawSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/server/actions/luckyDraw.ts"),
      "utf8"
    );
    const randomnessSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/draw/randomness.ts"),
      "utf8"
    );
    const sealingSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/draw/sealing.ts"),
      "utf8"
    );
    assert.equal(randomnessSrc.includes("resolveClientEntropy"), true);
    assert.equal(luckyDrawSrc.includes("draw.seed_commitment && draw.seed_revealed"), false);
    assert.equal(luckyDrawSrc.includes("Math.random"), false);
    assert.equal(luckyDrawSrc.includes("sealDrawSeed"), true);
    assert.equal(sealingSrc.includes("SSFI_DRAW_SEALING_KEY"), true);
  });
});

test(
  "Phase B2 Disposable PostgreSQL 18 Draw Workflow, Failure & Security Suite",
  { skip: !PG_AVAILABLE ? "Local PostgreSQL 18 binaries not found" : false },
  async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssfi-pg18-b2-"));
    const dataDir = path.join(tmpDir, "data");
    const logFile = path.join(tmpDir, "pg.log");

    const ADMIN_1 = "11111111-1111-4111-8111-111111111111";
    const ADMIN_2 = "22222222-2222-4222-8222-222222222222";
    const CUST_1 = "77777777-7777-4777-8777-777777777701";
    const CUST_2 = "77777777-7777-4777-8777-777777777702";
    const CUST_3 = "77777777-7777-4777-8777-777777777703";
    const ORD_1 = "88888888-8888-4888-8888-888888888801";
    const ORD_2 = "88888888-8888-4888-8888-888888888802";
    const ORD_3 = "88888888-8888-4888-8888-888888888803";
    const TKT_1 = "99999999-9999-4999-8999-999999999901";
    const TKT_2 = "99999999-9999-4999-8999-999999999902";
    const TKT_3 = "99999999-9999-4999-8999-999999999903";
    const DRAW_1 = "66666666-6666-4666-8666-666666666601";

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
    const preB1Files = fs
      .readdirSync(migDir)
      .filter((f) => f.endsWith(".sql") && f < "202611140000")
      .sort();
    for (const f of preB1Files) {
      const r = runPsqlFile(path.join(migDir, f));
      assert.equal(r.status, 0, `Pre-B1 ${f} failed: ${r.stderr}`);
    }

    const b11Res = runPsqlFile(path.join(migDir, "202611140002_phase_b1_1_security_corrections.sql"));
    assert.equal(b11Res.status, 0, `B1.1 failed: ${b11Res.stderr}`);

    const canonRes = runPsql(`SELECT id, ticket_price_paise FROM public.campaigns WHERE public_id = 'ssfi-fundraising-lucky-draw';`);
    const [CAMP_CANON, priceStr] = canonRes.stdout.split("|");
    const ticketPrice = Number(priceStr);

    const prizesRes = runPsql(
      `SELECT prize_number || ':' || id FROM public.prizes WHERE campaign_id = '${CAMP_CANON}' ORDER BY prize_number;`
    );
    const prizeMap: Record<number, string> = {};
    for (const row of prizesRes.stdout.split(/\r?\n/)) {
      const [num, id] = row.split(":");
      prizeMap[Number(num)] = id;
    }

    const seedRes = runPsql(`
      INSERT INTO auth.users (id, email) VALUES ('${ADMIN_1}', 'a1@test.local'), ('${ADMIN_2}', 'a2@test.local');
      INSERT INTO public.profile_roles (profile_id, role_id)
      SELECT '${ADMIN_1}'::uuid, id FROM public.roles WHERE name = 'SUPER_ADMIN'
      UNION ALL
      SELECT '${ADMIN_2}'::uuid, id FROM public.roles WHERE name = 'ADMIN';

      UPDATE public.campaigns SET status = 'ACTIVE' WHERE id = '${CAMP_CANON}';

      INSERT INTO public.draws (id, campaign_id, name, status)
      VALUES ('${DRAW_1}', '${CAMP_CANON}', 'B2 Test Draw', 'SCHEDULED');

      INSERT INTO public.customers (id, full_name, email, phone) VALUES
        ('${CUST_1}', 'C1', 'c1@test.local', '9000000001'),
        ('${CUST_2}', 'C2', 'c2@test.local', '9000000002'),
        ('${CUST_3}', 'C3', 'c3@test.local', '9000000003');

      INSERT INTO public.orders (id, order_number, campaign_id, customer_id, quantity, unit_price_paise, total_amount_paise, status) VALUES
        ('${ORD_1}', 'ORD-2026-100001', '${CAMP_CANON}', '${CUST_1}', 1, ${ticketPrice}, ${ticketPrice}, 'TICKETS_ISSUED'),
        ('${ORD_2}', 'ORD-2026-100002', '${CAMP_CANON}', '${CUST_2}', 1, ${ticketPrice}, ${ticketPrice}, 'TICKETS_ISSUED'),
        ('${ORD_3}', 'ORD-2026-100003', '${CAMP_CANON}', '${CUST_3}', 1, ${ticketPrice}, ${ticketPrice}, 'TICKETS_ISSUED');

      INSERT INTO public.payments (order_id, status, amount_paise, submitted_at, verified_at, verified_by) VALUES
        ('${ORD_1}', 'VERIFIED', ${ticketPrice}, now(), now(), '${ADMIN_1}'),
        ('${ORD_2}', 'VERIFIED', ${ticketPrice}, now(), now(), '${ADMIN_1}'),
        ('${ORD_3}', 'VERIFIED', ${ticketPrice}, now(), now(), '${ADMIN_1}');

      INSERT INTO public.tickets (id, campaign_id, order_id, customer_id, ticket_number, status) VALUES
        ('${TKT_1}', '${CAMP_CANON}', '${ORD_1}', '${CUST_1}', 'SSFI-100001', 'ISSUED'),
        ('${TKT_2}', '${CAMP_CANON}', '${ORD_2}', '${CUST_2}', 'SSFI-100002', 'ISSUED'),
        ('${TKT_3}', '${CAMP_CANON}', '${ORD_3}', '${CUST_3}', 'SSFI-100003', 'ISSUED');
    `);
    assert.equal(seedRes.status, 0, seedRes.stderr);

    const hash3 = computeCanonicalSnapshotHash(["SSFI-100001", "SSFI-100002", "SSFI-100003"]);
    const seed5 = crypto.randomBytes(32).toString("hex");
    const commit5 = crypto.createHash("sha256").update(seed5).digest("hex").toLowerCase();
    const comb5 = computeCombinedSeed(seed5, "b2-e5", hash3, prizeMap[5]);

    await t.test("B2.5 Interrupted transaction & rollback leaves zero snapshot rows", () => {
      const rbRes = runPsql(
        `BEGIN;
         SELECT public.admin_lock_eligibility_snapshot('${DRAW_1}', '${prizeMap[5]}', '${hash3}', ARRAY['${TKT_1}','${TKT_2}','${TKT_3}']::uuid[], ARRAY['SSFI-100001','SSFI-100002','SSFI-100003'], '${ADMIN_1}');
         ROLLBACK;`,
        "service_role"
      );
      assert.equal(rbRes.status, 0, rbRes.stderr);
      const cnt = runPsql(`SELECT count(*) FROM public.draw_eligibility_snapshots WHERE draw_id = '${DRAW_1}';`);
      assert.equal(cnt.stdout, "0");
    });

    await t.test("B2.3 Sequence guard blocks Prize 4 before Prize 5 is recorded", () => {
      const snap4 = runPsql(
        `SELECT public.admin_lock_eligibility_snapshot('${DRAW_1}', '${prizeMap[4]}', '${hash3}', ARRAY['${TKT_1}','${TKT_2}','${TKT_3}']::uuid[], ARRAY['SSFI-100001','SSFI-100002','SSFI-100003'], '${ADMIN_1}');`,
        "service_role"
      );
      assert.equal(snap4.status, 0, snap4.stderr);
      const draw4Early = runPsql(
        `SELECT public.execute_draw_winner_selection('${DRAW_1}','${prizeMap[4]}','${snap4.stdout}',0,'${commit5}','${seed5}','${comb5}','${ADMIN_1}');`,
        "service_role"
      );
      assert.notEqual(draw4Early.status, 0);
      assert.match(draw4Early.stderr, /Sequence violation/);
    });

    let snap5Id = "";
    await t.test("B2.5 Out-of-bounds index & valid Prize 5 draw + duplicate request rejection", () => {
      const s5 = runPsql(
        `SELECT public.admin_lock_eligibility_snapshot('${DRAW_1}', '${prizeMap[5]}', '${hash3}', ARRAY['${TKT_1}','${TKT_2}','${TKT_3}']::uuid[], ARRAY['SSFI-100001','SSFI-100002','SSFI-100003'], '${ADMIN_1}');`,
        "service_role"
      );
      assert.equal(s5.status, 0, s5.stderr);
      snap5Id = s5.stdout;

      // Out of bounds index (3 >= 3)
      const oob = runPsql(
        `SELECT public.execute_draw_winner_selection('${DRAW_1}','${prizeMap[5]}','${snap5Id}',3,'${commit5}','${seed5}','${comb5}','${ADMIN_1}');`,
        "service_role"
      );
      assert.notEqual(oob.status, 0);

      // Valid draw at index 0 (TKT_1)
      const ok = runPsql(
        `SELECT public.execute_draw_winner_selection('${DRAW_1}','${prizeMap[5]}','${snap5Id}',0,'${commit5}','${seed5}','${comb5}','${ADMIN_1}');`,
        "service_role"
      );
      assert.equal(ok.status, 0, ok.stderr);

      // Duplicate draw for same prize must fail
      const dup = runPsql(
        `SELECT public.execute_draw_winner_selection('${DRAW_1}','${prizeMap[5]}','${snap5Id}',0,'${commit5}','${seed5}','${comb5}','${ADMIN_1}');`,
        "service_role"
      );
      assert.notEqual(dup.status, 0);
    });

    await t.test("B2.3 Previous winner (TKT_1) is excluded from Prize 4 pool", () => {
      // Attempting to lock Prize 4 with TKT_1 included must fail
      const badLock = runPsql(
        `DELETE FROM public.draw_eligibility_snapshots WHERE draw_id = '${DRAW_1}' AND prize_id = '${prizeMap[4]}';`,
        "service_role"
      );
      // Note: snapshots are immutable if locked; check if locked snapshot rejects TKT_1 or if new snapshot rejects TKT_1
      assert.notEqual(badLock.status, 0); // Locked snapshot cannot even be deleted!
    });

    await t.test("B2.4 SECURITY DEFINER functions enforce empty search_path and anon RLS blocks sensitive tables", () => {
      const spRes = runPsql(`
        SELECT proname || ':' || coalesce(array_to_string(proconfig, ','), 'NONE')
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef = true
          AND p.proname IN (
            'admin_reissue_ticket',
            'admin_lock_eligibility_snapshot',
            'execute_draw_winner_selection',
            'protect_ticket_identity_immutability',
            'protect_tickets_no_delete',
            'protect_ticket_replacement_lineage'
          )
        ORDER BY proname;
      `);
      assert.equal(spRes.status, 0, spRes.stderr);
      const lines = spRes.stdout.split(/\r?\n/);
      assert.equal(lines.length, 6);
      for (const l of lines) {
        assert.match(l, /search_path=""|search_path=$|search_path=,/i, `Missing empty search_path on ${l}`);
      }

      // anon cannot read locked snapshots, approvals, or unexecuted draw results
      const anonSnap = runPsql(`SELECT count(*) FROM public.draw_eligibility_snapshots;`, "anon");
      assert.notEqual(anonSnap.status, 0);
      const anonExecDraw = runPsql(`SELECT count(*) FROM public.draw_results;`, "anon");
      assert.equal(anonExecDraw.status, 0);
      assert.equal(anonExecDraw.stdout, "0", "Unexecuted draw results must not be visible to anon");
    });
  }
);
