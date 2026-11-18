import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  generateServerSeed,
  computeCombinedSeed,
  deriveWinningIndex,
  resolveClientEntropy,
  verifySeedCommitment,
} from "../src/lib/draw/randomness.ts";
import {
  sortTicketsCanonically,
  computeCanonicalSnapshotHash,
  verifyDrawEvidence,
} from "../src/lib/draw/canonical.ts";
import {
  loadSealingConfig,
  sealDrawSeed,
  unsealDrawSeed,
} from "../src/lib/draw/sealing.ts";

const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";
const INITDB = path.join(PG_BIN, "initdb.exe");
const PG_CTL = path.join(PG_BIN, "pg_ctl.exe");
const PSQL = path.join(PG_BIN, "psql.exe");
const PG_AVAILABLE =
  fs.existsSync(INITDB) && fs.existsSync(PG_CTL) && fs.existsSync(PSQL);

const PORT = "55434";
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

test("R1 & R3: Independent Per-Prize Randomness & No Math.random() Fallback", async (t) => {
  await t.test("luckyDraw.ts removes seed reuse and Math.random() fallback", () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/server/actions/luckyDraw.ts"),
      "utf8"
    );
    assert.equal(src.includes("draw.seed_commitment && draw.seed_revealed"), false);
    assert.equal(src.includes("Math.random"), false);
    assert.equal(src.includes("sealDrawSeed"), true);
    assert.equal(src.includes("resolveClientEntropy"), true);
  });

  await t.test("5 prizes generate 5 distinct CSPRNG seeds and commitments with reproducible verification", () => {
    const seeds = new Set<string>();
    const commits = new Set<string>();
    const roster = ["SSFI-200001", "SSFI-200002", "SSFI-200003", "SSFI-200004", "SSFI-200005", "SSFI-200006"];
    const snapHash = computeCanonicalSnapshotHash(roster);

    for (let p = 5; p >= 1; p--) {
      const { serverSeed, seedCommitment } = generateServerSeed();
      assert.equal(seeds.has(serverSeed), false);
      assert.equal(commits.has(seedCommitment), false);
      seeds.add(serverSeed);
      commits.add(seedCommitment);

      assert.equal(verifySeedCommitment(serverSeed, seedCommitment), true);
      assert.equal(verifySeedCommitment(serverSeed, "f".repeat(64)), false);

      const clientEntropy = resolveClientEntropy();
      assert.match(clientEntropy, /^[0-9a-f]{32}$/);

      const prizeId = `55555555-5555-4555-8555-55555555550${p}`;
      const combined = computeCombinedSeed(serverSeed, clientEntropy, snapHash, prizeId);
      const idx = deriveWinningIndex(combined, roster.length);

      const ev = verifyDrawEvidence({
        serverSeedCommitment: seedCommitment,
        serverSeedRevealed: serverSeed,
        clientEntropy,
        combinedSeed: combined,
        snapshotHash: snapHash,
        prizeId,
        totalCandidates: roster.length,
        selectedIndex: idx,
        winningTicketNumber: roster[idx],
        rosterTicketNumbers: roster,
      });
      assert.equal(ev.isValid, true);
    }
    assert.equal(seeds.size, 5);
    assert.equal(commits.size, 5);
  });

  await t.test("resolveClientEntropy rejects empty/whitespace/oversized inputs", () => {
    assert.throws(() => resolveClientEntropy(""), /non-empty/);
    assert.throws(() => resolveClientEntropy("   "), /non-empty/);
    assert.throws(() => resolveClientEntropy("x".repeat(501)), /500/);
    assert.equal(resolveClientEntropy("  operator-abc  "), "operator-abc");
  });
});

test("R2: AES-256-GCM Seed Sealing & Context-Bound AAD", async (t) => {
  const testKeyHex = crypto.randomBytes(32).toString("hex");
  const testKeyBase64 = crypto.randomBytes(32).toString("base64");
  const wrongKeyHex = crypto.randomBytes(32).toString("hex");
  const context = {
    campaignId: "3a125e93-6b55-4e0d-89d6-ac8ae9d1e277",
    drawId: "66666666-6666-4666-8666-666666666601",
    prizeId: "55555555-5555-4555-8555-555555555505",
  };

  await t.test("Successful seal/unseal with hex and base64 keys + unique nonces", () => {
    const cfgHex = loadSealingConfig({ SSFI_DRAW_SEALING_KEY: testKeyHex, SSFI_DRAW_ACTIVE_KID: "k-v1" });
    const cfgB64 = loadSealingConfig({ SSFI_DRAW_SEALING_KEY: testKeyBase64, SSFI_DRAW_ACTIVE_KID: "k-b64" });
    const { serverSeed } = generateServerSeed();

    const env1 = sealDrawSeed(serverSeed, context, cfgHex);
    const env2 = sealDrawSeed(serverSeed, context, cfgHex);
    assert.notEqual(env1.iv, env2.iv, "Each seal must use a unique CSPRNG IV");
    assert.equal(unsealDrawSeed(env1, context, cfgHex), serverSeed);

    const envB64 = sealDrawSeed(serverSeed, context, cfgB64);
    assert.equal(unsealDrawSeed(envB64, context, cfgB64), serverSeed);
  });

  await t.test("Rejects missing, malformed, or wrong keys", () => {
    assert.throws(() => loadSealingConfig({}), /not configured/);
    assert.throws(() => loadSealingConfig({ SSFI_DRAW_SEALING_KEY: testKeyHex }), /SSFI_DRAW_ACTIVE_KID/);
    assert.throws(
      () => loadSealingConfig({ SSFI_DRAW_SEALING_KEY: "short", SSFI_DRAW_ACTIVE_KID: "k1" }),
      /32-byte/
    );

    const cfg1 = loadSealingConfig({ SSFI_DRAW_SEALING_KEY: testKeyHex, SSFI_DRAW_ACTIVE_KID: "k1" });
    const cfgWrong = loadSealingConfig({ SSFI_DRAW_SEALING_KEY: wrongKeyHex, SSFI_DRAW_ACTIVE_KID: "k1" });
    const { serverSeed } = generateServerSeed();
    const env = sealDrawSeed(serverSeed, context, cfg1);
    assert.throws(() => unsealDrawSeed(env, context, cfgWrong));
  });

  await t.test("Rejects modified ciphertext, modified auth tag, modified AAD context, and unsupported version/kid", () => {
    const cfg = loadSealingConfig({ SSFI_DRAW_SEALING_KEY: testKeyHex, SSFI_DRAW_ACTIVE_KID: "k1" });
    const { serverSeed } = generateServerSeed();
    const env = sealDrawSeed(serverSeed, context, cfg);

    // Modified ciphertext
    const badCt = {
      ...env,
      ciphertext: (env.ciphertext[0] === "0" ? "1" : "0") + env.ciphertext.slice(1),
    };
    assert.throws(() => unsealDrawSeed(badCt, context, cfg));

    // Modified tag
    const badTag = {
      ...env,
      tag: (env.tag[0] === "0" ? "1" : "0") + env.tag.slice(1),
    };
    assert.throws(() => unsealDrawSeed(badTag, context, cfg));

    // Modified AAD context (different prizeId / drawId / campaignId)
    assert.throws(() =>
      unsealDrawSeed(env, { ...context, prizeId: "55555555-5555-4555-8555-555555555504" }, cfg)
    );
    assert.throws(() =>
      unsealDrawSeed(env, { ...context, drawId: "66666666-6666-4666-8666-666666666699" }, cfg)
    );

    // Unsupported version & mismatched kid
    assert.throws(() => unsealDrawSeed({ ...env, version: 2 as unknown as 1 }, context, cfg), /Unsupported/);
    assert.throws(() => unsealDrawSeed({ ...env, kid: "k-other" }, context, cfg), /kid/);
  });
});

test(
  "R4 & Full 5-Prize Draw Workflow in Disposable PostgreSQL 18",
  { skip: !PG_AVAILABLE ? "Local PostgreSQL 18 binaries not found" : false },
  async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssfi-pg18-b2r-"));
    const dataDir = path.join(tmpDir, "data");
    const logFile = path.join(tmpDir, "pg.log");

    const ADMIN_1 = "11111111-1111-4111-8111-111111111111";
    const ADMIN_2 = "22222222-2222-4222-8222-222222222222";
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

    assert.equal(
      spawnSync(INITDB, ["-D", dataDir, "-U", "postgres", "--auth=trust", "--encoding=UTF8"], { encoding: "utf8" })
        .status,
      0
    );
    assert.equal(
      spawnSync(PG_CTL, ["-D", dataDir, "-l", logFile, "-o", `-p ${PORT} -h 127.0.0.1`, "-w", "start"], {
        stdio: "ignore",
        timeout: 30000,
      }).status,
      0
    );

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
        id text PRIMARY KEY, name text NOT NULL UNIQUE, owner uuid, public boolean DEFAULT false,
        file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS storage.objects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id),
        name text, owner uuid, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
        UNIQUE (bucket_id, name)
      );
      ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    `);
    assert.equal(bootstrapRes.status, 0, bootstrapRes.stderr);

    const migDir = path.resolve(process.cwd(), "supabase/migrations");
    const preB1Files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql") && f < "202611140000").sort();
    for (const f of preB1Files) {
      const r = runPsqlFile(path.join(migDir, f));
      assert.equal(r.status, 0, `Pre-B1 ${f} failed: ${r.stderr}`);
    }
    assert.equal(runPsqlFile(path.join(migDir, "202611140002_phase_b1_1_security_corrections.sql")).status, 0);
    assert.equal(runPsqlFile(path.join(migDir, "202611140003_phase_b2_public_rls_hardening.sql")).status, 0);

    const [CAMP_CANON, priceStr] = runPsql(
      `SELECT id, ticket_price_paise FROM public.campaigns WHERE public_id = 'ssfi-fundraising-lucky-draw';`
    ).stdout.split("|");
    const ticketPrice = Number(priceStr);

    const prizeMap: Record<number, string> = {};
    for (const row of runPsql(
      `SELECT prize_number || ':' || id FROM public.prizes WHERE campaign_id = '${CAMP_CANON}' ORDER BY prize_number;`
    ).stdout.split(/\r?\n/)) {
      const [num, id] = row.split(":");
      prizeMap[Number(num)] = id;
    }

    // Seed 2 admins + 6 paid tickets
    const ticketRows: { id: string; num: string }[] = [];
    let seedSql = `
      INSERT INTO auth.users (id, email) VALUES ('${ADMIN_1}', 'a1@test.local'), ('${ADMIN_2}', 'a2@test.local');
      INSERT INTO public.profile_roles (profile_id, role_id)
      SELECT '${ADMIN_1}'::uuid, id FROM public.roles WHERE name = 'SUPER_ADMIN'
      UNION ALL
      SELECT '${ADMIN_2}'::uuid, id FROM public.roles WHERE name = 'ADMIN';
      UPDATE public.campaigns SET status = 'ACTIVE' WHERE id = '${CAMP_CANON}';
      INSERT INTO public.draws (id, campaign_id, name, status) VALUES ('${DRAW_1}', '${CAMP_CANON}', 'B2 Full 5-Prize Draw', 'SCHEDULED');
    `;
    for (let i = 1; i <= 6; i++) {
      const custId = `77777777-7777-4777-8777-77777777770${i}`;
      const ordId = `88888888-8888-4888-8888-88888888880${i}`;
      const tktId = `99999999-9999-4999-8999-99999999990${i}`;
      const tktNum = `SSFI-20000${i}`;
      ticketRows.push({ id: tktId, num: tktNum });
      seedSql += `
        INSERT INTO public.customers (id, full_name, email, phone) VALUES ('${custId}', 'Cust ${i}', 'c${i}@test.local', '900000000${i}');
        INSERT INTO public.orders (id, order_number, campaign_id, customer_id, quantity, unit_price_paise, total_amount_paise, status)
        VALUES ('${ordId}', 'ORD-2026-20000${i}', '${CAMP_CANON}', '${custId}', 1, ${ticketPrice}, ${ticketPrice}, 'TICKETS_ISSUED');
        INSERT INTO public.payments (order_id, status, amount_paise, submitted_at, verified_at, verified_by)
        VALUES ('${ordId}', 'VERIFIED', ${ticketPrice}, now(), now(), '${ADMIN_1}');
        INSERT INTO public.tickets (id, campaign_id, order_id, customer_id, ticket_number, status)
        VALUES ('${tktId}', '${CAMP_CANON}', '${ordId}', '${custId}', '${tktNum}', 'ISSUED');
      `;
    }
    assert.equal(runPsql(seedSql).status, 0);

    const sealingCfg = loadSealingConfig({
      SSFI_DRAW_SEALING_KEY: crypto.randomBytes(32).toString("hex"),
      SSFI_DRAW_ACTIVE_KID: "b2-test-k1",
    });

    await t.test("Executes all 5 prizes (5 -> 4 -> 3 -> 2 -> 1) with independent sealed seeds & dual approval", () => {
      let remaining = [...ticketRows];
      const usedSeeds = new Set<string>();

      for (let pNum = 5; pNum >= 1; pNum--) {
        const prizeId = prizeMap[pNum];
        const sorted = sortTicketsCanonically(remaining.map((r) => ({ id: r.id, ticket_number: r.num })));
        const snapHash = computeCanonicalSnapshotHash(sorted.map((s) => s.ticket_number));

        const lockRes = runPsql(
          `SELECT public.admin_lock_eligibility_snapshot('${DRAW_1}', '${prizeId}', '${snapHash}', ARRAY[${sorted
            .map((s) => `'${s.id}'`)
            .join(",")}]::uuid[], ARRAY[${sorted.map((s) => `'${s.ticket_number}'`).join(",")}], '${ADMIN_1}');`,
          "service_role"
        );
        assert.equal(lockRes.status, 0, lockRes.stderr);
        const snapId = lockRes.stdout;

        if (pNum === 1) {
          const reqApp = runPsql(
            `SELECT public.admin_request_first_prize_approval('${DRAW_1}', '${prizeId}', '${snapId}', '${ADMIN_1}');`,
            "service_role"
          );
          assert.equal(reqApp.status, 0, reqApp.stderr);
          const recApp = runPsql(
            `SELECT public.admin_record_first_prize_approval('${reqApp.stdout}', 'APPROVED', 'Verified', '${ADMIN_2}');`,
            "service_role"
          );
          assert.equal(recApp.status, 0, recApp.stderr);
        }

        const { serverSeed, seedCommitment } = generateServerSeed();
        assert.equal(usedSeeds.has(serverSeed), false);
        usedSeeds.add(serverSeed);

        const ctx = { campaignId: CAMP_CANON, drawId: DRAW_1, prizeId };
        const envelope = sealDrawSeed(serverSeed, ctx, sealingCfg);
        const unsealed = unsealDrawSeed(envelope, ctx, sealingCfg);
        const clientEntropy = resolveClientEntropy();
        const combined = computeCombinedSeed(unsealed, clientEntropy, snapHash, prizeId);
        const winIdx = deriveWinningIndex(combined, sorted.length);

        const execRes = runPsql(
          `SELECT public.execute_draw_winner_selection('${DRAW_1}', '${prizeId}', '${snapId}', ${winIdx}, '${seedCommitment}', '${unsealed}', '${combined}', '${ADMIN_1}', '${clientEntropy}');`,
          "service_role"
        );
        assert.equal(execRes.status, 0, execRes.stderr);

        const winningTicketId = sorted[winIdx].id;
        remaining = remaining.filter((r) => r.id !== winningTicketId);
      }

      assert.equal(usedSeeds.size, 5);
      assert.equal(remaining.length, 1);
    });

    await t.test("R4: anon direct SELECT on executed draws/draw_results/evidence is blocked; get_public_draw_winners returns TICKET_NUMBER_ONLY", () => {
      assert.notEqual(runPsql(`SELECT * FROM public.draws;`, "anon").status, 0);
      assert.notEqual(runPsql(`SELECT * FROM public.draw_results;`, "anon").status, 0);
      assert.notEqual(runPsql(`SELECT * FROM public.draw_randomness_evidence;`, "anon").status, 0);

      for (const role of ["anon", "authenticated", "service_role"]) {
        const pubRes = runPsql(
          `SELECT prize_number || '|' || ticket_number FROM public.get_public_draw_winners('ssfi-fundraising-lucky-draw');`,
          role
        );
        assert.equal(pubRes.status, 0, `Role ${role} failed: ${pubRes.stderr}`);
        const rows = pubRes.stdout.split(/\r?\n/);
        assert.equal(rows.length, 5);
        for (const row of rows) {
          assert.match(row, /^[1-5]\|SSFI-20000[1-6]$/);
        }
      }

      // Verify SECURITY DEFINER + empty search_path on get_public_draw_winners
      const spRes = runPsql(`
        SELECT prosecdef::text || ':' || coalesce(array_to_string(proconfig, ','), 'NONE')
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'get_public_draw_winners';
      `);
      assert.match(spRes.stdout, /^true:.*search_path=""|search_path=$/i);
    });
  }
);
