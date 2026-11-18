import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
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
import {
  loadSealingConfig,
  sealDrawSeed,
  unsealDrawSeed,
  type SealedSeedEnvelope,
} from "../src/lib/draw/sealing.ts";

const PSQL = "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
const PREVIEW_REF = "jiyuiydzsfydjklosvvq";
const EXPECTED_PGHOST = `db.${PREVIEW_REF}.supabase.co`;
const SYNTH_UAT_CAMPAIGN_PUBLIC_ID = "synth-uat-1794143277348";

interface PreviewDbConn {
  PGHOST: string;
  PGPORT: string;
  PGUSER: string;
  PGPASSWORD: string;
  PGDATABASE: string;
}

function getPreviewDbConnection(): PreviewDbConn {
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const res = spawnSync(
    npxCmd,
    ["supabase", "db", "dump", `--remote=${PREVIEW_REF}`, "--dry-run"],
    { encoding: "utf8", shell: true }
  );
  const out = `${res.stdout || ""}\n${res.stderr || ""}`;
  const host = out.match(/export PGHOST="([^"]+)"/)?.[1];
  const port = out.match(/export PGPORT="([^"]+)"/)?.[1];
  const user = out.match(/export PGUSER="([^"]+)"/)?.[1];
  const pass = out.match(/export PGPASSWORD="([^"]+)"/)?.[1];
  const db = out.match(/export PGDATABASE="([^"]+)"/)?.[1];

  if (!host || host !== EXPECTED_PGHOST || !port || !user || !pass || !db) {
    throw new Error(`Failed to resolve Preview DB connection for ${EXPECTED_PGHOST}`);
  }
  return { PGHOST: host, PGPORT: port, PGUSER: user, PGPASSWORD: pass, PGDATABASE: db };
}

function runPreviewPsql(conn: PreviewDbConn, sql: string): { status: number; stdout: string; stderr: string } {
  const res = spawnSync(
    PSQL,
    ["-X", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    {
      input: sql,
      encoding: "utf8",
      env: {
        ...process.env,
        PGHOST: conn.PGHOST,
        PGPORT: conn.PGPORT,
        PGUSER: conn.PGUSER,
        PGPASSWORD: conn.PGPASSWORD,
        PGDATABASE: conn.PGDATABASE,
        PGSSLMODE: "require",
      },
    }
  );
  return {
    status: res.status ?? 1,
    stdout: (res.stdout || "").trim(),
    stderr: (res.stderr || "").trim(),
  };
}

test("Phase B2.10 Preview Integration Testing Suite (jiyuiydzsfydjklosvvq)", async (t) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  assert.ok(
    supabaseUrl.includes(PREVIEW_REF),
    `Expected NEXT_PUBLIC_SUPABASE_URL to target Preview (${PREVIEW_REF}), got ${supabaseUrl}`
  );
  assert.ok(
    !supabaseUrl.includes("fohpqheglxhfdecadhzw"),
    "STRICT PROHIBITION: Production project must never be targeted"
  );
  assert.ok(anonKey.length > 0, "Preview publishable/anon key must be present");
  assert.ok(serviceKey.length > 0, "Preview service_role key must be present");

  const sbAnon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const sbAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const dbConn = getPreviewDbConnection();

  // Resolve an existing SUPER_ADMIN, ADMIN, and SELLER profile ID from Preview (no PII queried)
  const rolesMeta = runPreviewPsql(
    dbConn,
    `BEGIN READ ONLY;
     SET LOCAL ROLE postgres;
     SELECT (SELECT pr.profile_id FROM public.profile_roles pr JOIN public.roles r ON r.id = pr.role_id WHERE r.name = 'SUPER_ADMIN' ORDER BY pr.profile_id LIMIT 1)
         || '|' ||
            (SELECT pr.profile_id FROM public.profile_roles pr JOIN public.roles r ON r.id = pr.role_id WHERE r.name = 'ADMIN' ORDER BY pr.profile_id LIMIT 1)
         || '|' ||
            COALESCE(
              (SELECT pr.profile_id FROM public.profile_roles pr JOIN public.roles r ON r.id = pr.role_id
               WHERE r.name = 'SELLER'
                 AND NOT EXISTS (
                   SELECT 1 FROM public.profile_roles pr2 JOIN public.roles r2 ON r2.id = pr2.role_id
                   WHERE pr2.profile_id = pr.profile_id AND r2.name IN ('SUPER_ADMIN', 'ADMIN', 'FUNDRAISING_MANAGER')
                 )
               ORDER BY pr.profile_id LIMIT 1),
              '00000000-0000-4000-8000-000000b21090'::uuid
            )
         || '|' ||
            (SELECT id FROM public.campaigns WHERE public_id = 'ssfi-fundraising-lucky-draw')
         || '|' ||
            (SELECT id FROM public.prizes WHERE campaign_id = (SELECT id FROM public.campaigns WHERE public_id = 'ssfi-fundraising-lucky-draw') AND prize_number = 5)
         || '|' ||
            (SELECT id FROM public.prizes WHERE campaign_id = (SELECT id FROM public.campaigns WHERE public_id = 'ssfi-fundraising-lucky-draw') AND prize_number = 4)
         || '|' ||
            (SELECT id FROM public.prizes WHERE campaign_id = (SELECT id FROM public.campaigns WHERE public_id = 'ssfi-fundraising-lucky-draw') AND prize_number = 1);
     ROLLBACK;`
  );
  assert.equal(rolesMeta.status, 0, rolesMeta.stderr);
  const metaLines = rolesMeta.stdout.split(/\r?\n/);
  const dataLine = metaLines.find((l) => l.includes("|")) || "";
  const [SUPER_ADMIN_ID, ADMIN_ID, SELLER_ID, CANON_CAMPAIGN_ID, PRIZE_5_ID, PRIZE_4_ID, PRIZE_1_ID] =
    dataLine.split("|");
  assert.ok(SUPER_ADMIN_ID && ADMIN_ID && SELLER_ID && CANON_CAMPAIGN_ID && PRIZE_5_ID && PRIZE_4_ID && PRIZE_1_ID);

  // ==========================================================================
  // TASK 1: Verify application compatibility with 9-arg admin_lock_eligibility_snapshot RPC
  // ==========================================================================
  await t.test("Task 1: PostgREST 9-argument admin_lock_eligibility_snapshot RPC compatibility", async () => {
    const synthDrawId = "00000000-0000-4000-8000-000000b21099";
    const synthTicketId = "00000000-0000-4000-8000-000000b21098";
    const snapHash = computeCanonicalSnapshotHash(["SSFI-999901"]);
    const { serverSeed, seedCommitment } = generateServerSeed();
    const sealedEnvelope = sealDrawSeed(serverSeed, {
      campaignId: CANON_CAMPAIGN_ID,
      drawId: synthDrawId,
      prizeId: PRIZE_5_ID,
    });

    // 1a. Valid 9-argument call reaches PL/pgSQL body (passes PostgREST schema resolution, staff check, and sealed seed validation; stops safely at 'Draw session not found.')
    const resValidArgs = await sbAdmin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: synthDrawId,
      p_prize_id: PRIZE_5_ID,
      p_snapshot_hash: snapHash,
      p_ticket_ids: [synthTicketId],
      p_ticket_numbers: ["SSFI-999901"],
      p_actor: SUPER_ADMIN_ID,
      p_seed_commitment: seedCommitment,
      p_sealed_seed_envelope: sealedEnvelope,
      p_sealing_kid: sealedEnvelope.kid,
    });
    assert.ok(resValidArgs.error, "Expected synthetic non-existent draw_id to return controlled P0002 error");
    assert.equal(resValidArgs.error.code, "P0002");
    assert.match(resValidArgs.error.message, /Draw session not found/i);

    // 1b. Mismatched sealing_kid vs envelope.kid is rejected by 9-arg RPC validation (22023)
    const resKidMismatch = await sbAdmin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: synthDrawId,
      p_prize_id: PRIZE_5_ID,
      p_snapshot_hash: snapHash,
      p_ticket_ids: [synthTicketId],
      p_ticket_numbers: ["SSFI-999901"],
      p_actor: SUPER_ADMIN_ID,
      p_seed_commitment: seedCommitment,
      p_sealed_seed_envelope: sealedEnvelope,
      p_sealing_kid: "mismatched-kid",
    });
    assert.ok(resKidMismatch.error);
    assert.equal(resKidMismatch.error.code, "22023");
    assert.match(resKidMismatch.error.message, /Sealed seed envelope kid mismatch/i);

    // 1c. Incomplete sealed seed triplet is rejected (22004)
    const resIncompleteTriplet = await sbAdmin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: synthDrawId,
      p_prize_id: PRIZE_5_ID,
      p_snapshot_hash: snapHash,
      p_ticket_ids: [synthTicketId],
      p_ticket_numbers: ["SSFI-999901"],
      p_actor: SUPER_ADMIN_ID,
      p_seed_commitment: seedCommitment,
      p_sealed_seed_envelope: null,
      p_sealing_kid: sealedEnvelope.kid,
    });
    assert.ok(resIncompleteTriplet.error);
    assert.equal(resIncompleteTriplet.error.code, "22004");
    assert.match(resIncompleteTriplet.error.message, /requires seed_commitment, sealed_seed_envelope, and sealing_kid together/i);
  });

  // ==========================================================================
  // TASKS 2, 3, 4: Synthetic Snapshot Locking, Sealed Seed Persistence,
  // AES-256-GCM Unsealing/Commitment Matching, Preconditions & Seed-Reuse Guard
  // ==========================================================================
  await t.test("Tasks 2, 3 & 4: Synthetic snapshot locking, sealed seed persistence, AES-256-GCM unsealing, and draw execution preconditions (rolled back)", () => {
    const synthDrawId = "00000000-0000-4000-8000-000000b21001";
    const synthCust1 = "00000000-0000-4000-8000-000000b21011";
    const synthCust2 = "00000000-0000-4000-8000-000000b21012";
    const synthOrd1 = "00000000-0000-4000-8000-000000b21021";
    const synthOrd2 = "00000000-0000-4000-8000-000000b21022";
    const synthTkt1 = "00000000-0000-4000-8000-000000b21031";
    const synthTkt2 = "00000000-0000-4000-8000-000000b21032";

    const sealingCfg = loadSealingConfig();
    assert.ok(sealingCfg.activeKid.length > 0);

    // Prepare canonical roster + sealed seeds for Prize 5 and Prize 4
    const roster5 = sortTicketsCanonically([
      { id: synthTkt2, ticket_number: "SSFI-991002" },
      { id: synthTkt1, ticket_number: "SSFI-991001" },
    ]);
    const hash5 = computeCanonicalSnapshotHash(roster5.map((r) => r.ticket_number));
    const { serverSeed: seed5, seedCommitment: comm5 } = generateServerSeed();
    const env5 = sealDrawSeed(
      seed5,
      { campaignId: CANON_CAMPAIGN_ID, drawId: synthDrawId, prizeId: PRIZE_5_ID },
      sealingCfg
    );

    const { serverSeed: seed4, seedCommitment: comm4 } = generateServerSeed();
    const env4 = sealDrawSeed(
      seed4,
      { campaignId: CANON_CAMPAIGN_ID, drawId: synthDrawId, prizeId: PRIZE_4_ID },
      sealingCfg
    );

    const { serverSeed: wrongSeed, seedCommitment: wrongComm } = generateServerSeed();
    const wrongCombined5 = computeCombinedSeed(wrongSeed, "synth-entropy", hash5, PRIZE_5_ID);
    const wrongIdx5 = deriveWinningIndex(wrongCombined5, 2);

    const reuseCombined4 = computeCombinedSeed(seed5, "synth-entropy-4", hash5, PRIZE_4_ID);

    // Execute inside a single PostgreSQL transaction that ALWAYS rolls back at the end
    const txRes = runPreviewPsql(
      dbConn,
      `BEGIN;
       SET LOCAL ROLE postgres;
       SELECT set_config('request.jwt.claim.role', 'service_role', true);
       SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

       -- 1. Seed isolated synthetic draw & 2 synthetic eligible tickets (in-transaction only)
       INSERT INTO public.draws (id, campaign_id, name, status)
       VALUES ('${synthDrawId}', '${CANON_CAMPAIGN_ID}', 'Synthetic B2.10 Integration Test Draw', 'SCHEDULED');

       INSERT INTO public.customers (id, full_name, email, phone) VALUES
         ('${synthCust1}', 'Synthetic Test User 1', 'synth1@b210.invalid', '9000099101'),
         ('${synthCust2}', 'Synthetic Test User 2', 'synth2@b210.invalid', '9000099102');

       INSERT INTO public.orders (id, order_number, campaign_id, customer_id, quantity, unit_price_paise, total_amount_paise, status) VALUES
         ('${synthOrd1}', 'ORD-2026-991001', '${CANON_CAMPAIGN_ID}', '${synthCust1}', 1, 10000, 10000, 'TICKETS_ISSUED'),
         ('${synthOrd2}', 'ORD-2026-991002', '${CANON_CAMPAIGN_ID}', '${synthCust2}', 1, 10000, 10000, 'TICKETS_ISSUED');

       INSERT INTO public.payments (order_id, status, amount_paise, submitted_at, verified_at, verified_by) VALUES
         ('${synthOrd1}', 'VERIFIED', 10000, now(), now(), '${SUPER_ADMIN_ID}'),
         ('${synthOrd2}', 'VERIFIED', 10000, now(), now(), '${SUPER_ADMIN_ID}');

       INSERT INTO public.tickets (id, campaign_id, order_id, customer_id, ticket_number, status) VALUES
         ('${synthTkt1}', '${CANON_CAMPAIGN_ID}', '${synthOrd1}', '${synthCust1}', 'SSFI-991001', 'ISSUED'),
         ('${synthTkt2}', '${CANON_CAMPAIGN_ID}', '${synthOrd2}', '${synthCust2}', 'SSFI-991002', 'ISSUED');

       -- Ensure only the 2 synthetic tickets are eligible in this rolled-back test transaction
       INSERT INTO public.draw_manual_exclusions (campaign_id, prize_id, ticket_id, reason, excluded_by)
       SELECT '${CANON_CAMPAIGN_ID}', NULL, t.id, 'Synthetic B2.10 isolation exclusion', '${SUPER_ADMIN_ID}'
       FROM public.tickets t
       WHERE t.campaign_id = '${CANON_CAMPAIGN_ID}'
         AND t.status = 'ISSUED'
         AND t.id NOT IN ('${synthTkt1}', '${synthTkt2}');

       -- 2. Lock Snapshot for Prize 5 via 9-arg admin_lock_eligibility_snapshot
       SELECT 'SNAP5_ID:' || public.admin_lock_eligibility_snapshot(
         '${synthDrawId}'::uuid,
         '${PRIZE_5_ID}'::uuid,
         '${hash5}',
         ARRAY['${synthTkt1}'::uuid, '${synthTkt2}'::uuid],
         ARRAY['SSFI-991001', 'SSFI-991002'],
         '${SUPER_ADMIN_ID}'::uuid,
         '${comm5}',
         '${JSON.stringify(env5).replace(/'/g, "''")}'::jsonb,
         '${env5.kid}'
       );

       -- 3. Idempotent retry with identical snapshot_hash returns same snapshot_id & preserves original sealed seed
       SELECT 'SNAP5_RETRY_ID:' || public.admin_lock_eligibility_snapshot(
         '${synthDrawId}'::uuid,
         '${PRIZE_5_ID}'::uuid,
         '${hash5}',
         ARRAY['${synthTkt1}'::uuid, '${synthTkt2}'::uuid],
         ARRAY['SSFI-991001', 'SSFI-991002'],
         '${SUPER_ADMIN_ID}'::uuid,
         '${wrongComm}',
         '${JSON.stringify(env4).replace(/'/g, "''")}'::jsonb,
         '${env4.kid}'
       );

       -- 4. Inspect persisted snapshot row & audit log (confirm no plaintext seed leaked)
       SELECT 'SNAP5_ROW:' || json_build_object(
         'id', s.id,
         'is_locked', s.is_locked,
         'total_eligible_count', s.total_eligible_count,
         'seed_commitment', s.seed_commitment,
         'sealing_kid', s.sealing_kid,
         'sealed_seed_envelope', s.sealed_seed_envelope
       )::text
       FROM public.draw_eligibility_snapshots s
       WHERE s.draw_id = '${synthDrawId}'::uuid AND s.prize_id = '${PRIZE_5_ID}'::uuid;

       SELECT 'PLAINTEXT_LEAK_CHECK:' || (
         EXISTS (
           SELECT 1 FROM public.draw_eligibility_snapshots s
           WHERE s.draw_id = '${synthDrawId}'::uuid AND row_to_json(s)::text LIKE '%${seed5}%'
         )
         OR EXISTS (
           SELECT 1 FROM public.audit_logs a
           WHERE a.entity_type = 'draw_snapshot' AND a.metadata::text LIKE '%${seed5}%'
         )
       )::text;

       -- 5. Lock Snapshot for Prize 4 as well to test sequence & seed-reuse guards
       SELECT 'SNAP4_ID:' || public.admin_lock_eligibility_snapshot(
         '${synthDrawId}'::uuid,
         '${PRIZE_4_ID}'::uuid,
         '${hash5}',
         ARRAY['${synthTkt1}'::uuid, '${synthTkt2}'::uuid],
         ARRAY['SSFI-991001', 'SSFI-991002'],
         '${SUPER_ADMIN_ID}'::uuid,
         '${comm4}',
         '${JSON.stringify(env4).replace(/'/g, "''")}'::jsonb,
         '${env4.kid}'
       );

       -- 6. Test negative precondition: Conflicting snapshot_hash on locked Prize 5 snapshot
       DO $$
       BEGIN
         PERFORM public.admin_lock_eligibility_snapshot(
           '${synthDrawId}'::uuid,
           '${PRIZE_5_ID}'::uuid,
           '${"f".repeat(64)}',
           ARRAY['${synthTkt1}'::uuid, '${synthTkt2}'::uuid],
           ARRAY['SSFI-991001', 'SSFI-991002'],
           '${SUPER_ADMIN_ID}'::uuid,
           '${comm5}',
           '${JSON.stringify(env5).replace(/'/g, "''")}'::jsonb,
           '${env5.kid}'
         );
         RAISE EXCEPTION 'Expected snapshot hash conflict to fail';
       EXCEPTION WHEN unique_violation THEN
         RAISE NOTICE 'CHECK_PASS:HASH_CONFLICT_REJECTED';
       END $$;

       -- 7. Test negative precondition: Sequence violation (drawing Prize 4 before Prize 5)
       DO $$
       DECLARE
         v_snap4 uuid;
       BEGIN
         SELECT id INTO v_snap4 FROM public.draw_eligibility_snapshots
         WHERE draw_id = '${synthDrawId}'::uuid AND prize_id = '${PRIZE_4_ID}'::uuid;

         PERFORM public.execute_draw_winner_selection(
           '${synthDrawId}'::uuid,
           '${PRIZE_4_ID}'::uuid,
           v_snap4,
           0,
           '${comm4}',
           '${seed4}',
           '${reuseCombined4}',
           '${SUPER_ADMIN_ID}'::uuid,
           'synth-entropy-4'
         );
         RAISE EXCEPTION 'Expected sequence violation to fail';
       EXCEPTION WHEN check_violation THEN
         IF SQLERRM LIKE '%Sequence violation%' THEN
           RAISE NOTICE 'CHECK_PASS:SEQUENCE_GUARD_ENFORCED';
         ELSE
           RAISE;
         END IF;
       END $$;

       -- 8. Test negative precondition: Commitment mismatch against sealed snapshot commitment
       DO $$
       DECLARE
         v_snap5 uuid;
       BEGIN
         SELECT id INTO v_snap5 FROM public.draw_eligibility_snapshots
         WHERE draw_id = '${synthDrawId}'::uuid AND prize_id = '${PRIZE_5_ID}'::uuid;

         PERFORM public.execute_draw_winner_selection(
           '${synthDrawId}'::uuid,
           '${PRIZE_5_ID}'::uuid,
           v_snap5,
           ${wrongIdx5},
           '${wrongComm}',
           '${wrongSeed}',
           '${wrongCombined5}',
           '${SUPER_ADMIN_ID}'::uuid,
           'synth-entropy'
         );
         RAISE EXCEPTION 'Expected snapshot commitment mismatch to fail';
       EXCEPTION WHEN check_violation THEN
         IF SQLERRM LIKE '%revealed seed commitment does not match sealed snapshot commitment%' THEN
           RAISE NOTICE 'CHECK_PASS:SNAPSHOT_COMMITMENT_MATCH_ENFORCED';
         ELSE
           RAISE;
         END IF;
       END $$;

       -- 9. Test negative precondition: Seed reuse violation across prizes in same draw session
       -- Insert a synthetic draw_results stub on Prize 5 with (comm5, seed5) inside a nested block, then verify Prize 4 rejects reusing seed5/comm5
       DO $$
       DECLARE
         v_snap4 uuid;
         v_snap5 uuid;
       BEGIN
         SELECT id INTO v_snap5 FROM public.draw_eligibility_snapshots
         WHERE draw_id = '${synthDrawId}'::uuid AND prize_id = '${PRIZE_5_ID}'::uuid;
         SELECT id INTO v_snap4 FROM public.draw_eligibility_snapshots
         WHERE draw_id = '${synthDrawId}'::uuid AND prize_id = '${PRIZE_4_ID}'::uuid;

         INSERT INTO public.draw_results (
           draw_id, campaign_id, prize_id, ticket_id, snapshot_id,
           selection_index, seed_commitment, seed_revealed, combined_seed, drawn_by
         ) VALUES (
           '${synthDrawId}'::uuid, '${CANON_CAMPAIGN_ID}'::uuid, '${PRIZE_5_ID}'::uuid,
           '${synthTkt1}'::uuid, v_snap5, 0, '${comm5}', '${seed5}', '${wrongCombined5}', '${SUPER_ADMIN_ID}'::uuid
         );

         BEGIN
           PERFORM public.execute_draw_winner_selection(
             '${synthDrawId}'::uuid,
             '${PRIZE_4_ID}'::uuid,
             v_snap4,
             1,
             '${comm5}',
             '${seed5}',
             '${reuseCombined4}',
             '${SUPER_ADMIN_ID}'::uuid,
             'synth-entropy-4'
           );
           RAISE EXCEPTION 'Expected seed reuse violation to fail';
         EXCEPTION WHEN check_violation THEN
           IF SQLERRM LIKE '%Seed reuse violation%' THEN
             RAISE NOTICE 'CHECK_PASS:SEED_REUSE_GUARD_ENFORCED';
           ELSE
             RAISE;
           END IF;
         END;
       END $$;

       ROLLBACK;`
    );

    assert.equal(txRes.status, 0, `Synthetic transaction failed: ${txRes.stderr}`);

    const snap5Id = txRes.stdout.match(/SNAP5_ID:([0-9a-f-]{36})/)?.[1];
    const snap5RetryId = txRes.stdout.match(/SNAP5_RETRY_ID:([0-9a-f-]{36})/)?.[1];
    assert.ok(snap5Id, "Expected SNAP5_ID from admin_lock_eligibility_snapshot");
    assert.equal(snap5Id, snap5RetryId, "Idempotent retry must return identical snapshot UUID");

    const leakCheck = txRes.stdout.match(/PLAINTEXT_LEAK_CHECK:(true|false)/)?.[1];
    assert.equal(leakCheck, "false", "Plaintext serverSeed must never appear in snapshot or audit_logs");

    const snap5RowJson = txRes.stdout.match(/SNAP5_ROW:(\{.*\})/)?.[1];
    assert.ok(snap5RowJson, "Expected persisted SNAP5_ROW JSON");
    const snap5Row = JSON.parse(snap5RowJson) as {
      id: string;
      is_locked: boolean;
      total_eligible_count: number;
      seed_commitment: string;
      sealing_kid: string;
      sealed_seed_envelope: SealedSeedEnvelope;
    };
    assert.equal(snap5Row.is_locked, true);
    assert.equal(snap5Row.total_eligible_count, 2);
    assert.equal(snap5Row.seed_commitment, comm5);
    assert.equal(snap5Row.sealing_kid, env5.kid);

    // Task 3: Application-side AES-256-GCM unsealing of the database-persisted envelope & commitment matching
    const unsealedFromDb = unsealDrawSeed(
      snap5Row.sealed_seed_envelope,
      { campaignId: CANON_CAMPAIGN_ID, drawId: synthDrawId, prizeId: PRIZE_5_ID },
      sealingCfg
    );
    assert.equal(unsealedFromDb, seed5, "Unsealed seed from DB envelope must match original CSPRNG serverSeed");
    assert.equal(
      verifySeedCommitment(unsealedFromDb, snap5Row.seed_commitment),
      true,
      "Unsealed seed must verify against persisted seed_commitment"
    );

    // Context-bound AAD mismatch on persisted envelope must fail closed
    assert.throws(
      () =>
        unsealDrawSeed(
          snap5Row.sealed_seed_envelope,
          { campaignId: CANON_CAMPAIGN_ID, drawId: synthDrawId, prizeId: PRIZE_4_ID },
          sealingCfg
        ),
      /Unsupported state or unable to authenticate data/i
    );

    // Task 4 precondition notices
    assert.match(txRes.stderr, /CHECK_PASS:HASH_CONFLICT_REJECTED/);
    assert.match(txRes.stderr, /CHECK_PASS:SEQUENCE_GUARD_ENFORCED/);
    assert.match(txRes.stderr, /CHECK_PASS:SNAPSHOT_COMMITMENT_MATCH_ENFORCED/);
    assert.match(txRes.stderr, /CHECK_PASS:SEED_REUSE_GUARD_ENFORCED/);
  });

  // ==========================================================================
  // TASK 5: Test public winner RPC using existing safe test data; confirm TICKET_NUMBER_ONLY
  // ==========================================================================
  await t.test("Task 5: Public winner RPC returns TICKET_NUMBER_ONLY for executed synthetic UAT data and 0 rows for unexecuted canonical campaign", async () => {
    // 5a. Canonical campaign (no executed draw) returns empty array
    const canonRes = await sbAnon.rpc("get_public_draw_winners", {
      p_campaign_public_id: "ssfi-fundraising-lucky-draw",
    });
    assert.equal(canonRes.error, null);
    assert.deepEqual(canonRes.data, []);

    // 5b. Existing safe synthetic UAT campaign (synth-uat-1794143277348) returns 5 winners with TICKET_NUMBER_ONLY fields
    const synthRes = await sbAnon.rpc("get_public_draw_winners", {
      p_campaign_public_id: SYNTH_UAT_CAMPAIGN_PUBLIC_ID,
    });
    assert.equal(synthRes.error, null);
    assert.ok(Array.isArray(synthRes.data));
    assert.equal(synthRes.data.length, 5, "Expected 5 prize winners for executed synthetic UAT draw");

    const expectedKeys = [
      "algorithm_version",
      "combined_seed",
      "drawn_at",
      "prize_number",
      "prize_title",
      "seed_commitment",
      "seed_revealed",
      "selection_index",
      "ticket_number",
      "total_candidates",
    ];
    const forbiddenKeys = [
      "id",
      "draw_id",
      "prize_id",
      "ticket_id",
      "snapshot_id",
      "customer_id",
      "customer_name",
      "customer_email",
      "customer_phone",
      "full_name",
      "email",
      "phone",
      "seller_id",
      "drawn_by",
      "notified_by",
      "locked_by",
      "notification_outbox_id",
      "sealed_seed_envelope",
    ];

    for (const row of synthRes.data) {
      const keys = Object.keys(row).sort();
      assert.deepEqual(keys, expectedKeys, "Public winner DTO must expose only the 10 approved fields");
      for (const fk of forbiddenKeys) {
        assert.equal(fk in row, false, `Forbidden key '${fk}' must never be exposed in get_public_draw_winners`);
      }
      assert.match(row.ticket_number, /^SSFI-\d+$/);
      assert.ok(row.prize_number >= 1 && row.prize_number <= 5);
      assert.equal( verifySeedCommitment(row.seed_revealed, row.seed_commitment), true );
    }
  });

  // ==========================================================================
  // TASK 6: Test admin role restrictions and public spectator access
  // ==========================================================================
  await t.test("Task 6: Admin role restrictions & public spectator access boundaries on Preview", async () => {
    // 6a. Direct anon SELECT on protected draw tables is blocked (42501)
    const protectedTables = [
      "draws",
      "draw_results",
      "draw_randomness_evidence",
      "draw_eligibility_snapshots",
      "draw_snapshot_tickets",
      "draw_manual_exclusions",
      "draw_approvals",
    ];
    for (const tbl of protectedTables) {
      const r = await sbAnon.from(tbl).select("*").limit(1);
      assert.ok(r.error, `Anon direct SELECT on ${tbl} must be denied`);
      assert.equal(r.error.code, "42501", `Expected 42501 on ${tbl}, got ${r.error.code}`);
    }

    // 6b. Anon execution of privileged RPCs is blocked (42501)
    const rLockAnon = await sbAnon.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: "00000000-0000-4000-8000-000000b21099",
      p_prize_id: PRIZE_5_ID,
      p_snapshot_hash: "a".repeat(64),
      p_ticket_ids: ["00000000-0000-4000-8000-000000b21098"],
      p_ticket_numbers: ["SSFI-999901"],
      p_actor: SUPER_ADMIN_ID,
      p_seed_commitment: "a".repeat(64),
      p_sealed_seed_envelope: { kid: "k1" },
      p_sealing_kid: "k1",
    });
    assert.ok(rLockAnon.error);
    assert.equal(rLockAnon.error.code, "42501");

    const rExecAnon = await sbAnon.rpc("execute_draw_winner_selection", {
      p_draw_id: "00000000-0000-4000-8000-000000b21099",
      p_prize_id: PRIZE_5_ID,
      p_snapshot_id: "00000000-0000-4000-8000-000000b21097",
      p_winning_index: 0,
      p_seed_commitment: "a".repeat(64),
      p_seed_revealed: "b".repeat(64),
      p_combined_seed: "c".repeat(64),
      p_actor: SUPER_ADMIN_ID,
      p_client_entropy: "ent",
    });
    assert.ok(rExecAnon.error);
    assert.equal(rExecAnon.error.code, "42501");

    // 6c. Non-staff actor (SELLER_ID) passed to service_role RPC is rejected with 42501 inside PL/pgSQL
    const rSellerActor = await sbAdmin.rpc("admin_lock_eligibility_snapshot", {
      p_draw_id: "00000000-0000-4000-8000-000000b21099",
      p_prize_id: PRIZE_5_ID,
      p_snapshot_hash: "a".repeat(64),
      p_ticket_ids: ["00000000-0000-4000-8000-000000b21098"],
      p_ticket_numbers: ["SSFI-999901"],
      p_actor: SELLER_ID,
      p_seed_commitment: null,
      p_sealed_seed_envelope: null,
      p_sealing_kid: null,
    });
    assert.ok(rSellerActor.error);
    assert.equal(rSellerActor.error.code, "42501");
    assert.match(rSellerActor.error.message, /Administrator privileges required/i);
  });

  // ==========================================================================
  // TASK 7: Verify dashboard, public display, realtime updates, and reconnect behavior
  // ==========================================================================
  await t.test("Task 7: Dashboard, public display, realtime subscription, and reconnect recovery verification", async () => {
    const dashboardSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/admin/draw/LuckyDrawDashboard.tsx"),
      "utf8"
    );
    const drumSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/admin/draw/RotatingNumberDrum.tsx"),
      "utf8"
    );
    const publicSectionSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/home/PublicDrawWinnersSection.tsx"),
      "utf8"
    );
    const publicPageSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/(public)/page.tsx"),
      "utf8"
    );
    const luckyDrawActionSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/server/actions/luckyDraw.ts"),
      "utf8"
    );

    // 7a. LuckyDrawDashboard syncs state via getDrawOverview, online/offline/visibilitychange, and Supabase Realtime channel
    assert.equal(dashboardSrc.includes("refreshOverview"), true);
    assert.equal(dashboardSrc.includes('window.addEventListener("online"'), true);
    assert.equal(dashboardSrc.includes('window.addEventListener("offline"'), true);
    assert.equal(dashboardSrc.includes('document.addEventListener("visibilitychange"'), true);
    assert.equal(dashboardSrc.includes("ssfi-admin-draw-"), true);
    assert.equal(dashboardSrc.includes("activeSnapshot: null"), true);

    // 7b. RotatingNumberDrum syncs activeResult when results prop updates
    assert.equal(drumSrc.includes("results.find((r) => r.id === prev.id)"), true);

    // 7c. PublicDrawWinnersSection & public homepage use get_public_draw_winners (TICKET_NUMBER_ONLY) + reconnect handlers
    assert.equal(publicSectionSrc.includes('rpc("get_public_draw_winners"'), true);
    assert.equal(publicSectionSrc.includes('window.addEventListener("online"'), true);
    assert.equal(publicSectionSrc.includes('document.addEventListener("visibilitychange"'), true);
    assert.equal(publicPageSrc.includes("PublicDrawWinnersSection"), true);

    // 7d. getDrawOverview does not expose sealed_seed_envelope to client props
    assert.equal(
      luckyDrawActionSrc.includes(
        '"id, draw_id, campaign_id, prize_id, total_eligible_count, previous_winner_count, manual_exclusion_count, snapshot_hash, algorithm_version, seed_commitment, sealing_kid, is_locked, locked_at, locked_by"'
      ),
      true
    );

    // 7e. Live Supabase Realtime WebSocket subscribe & reconnect handshake test against Preview
    const realtimeStatuses: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Realtime channel did not reach SUBSCRIBED within 8s (statuses: ${realtimeStatuses.join(",")})`));
      }, 8000);

      const channel = sbAnon
        .channel("ssfi-b210-integration-healthcheck")
        .subscribe((status) => {
          realtimeStatuses.push(status);
          if (status === "SUBSCRIBED") {
            clearTimeout(timer);
            void sbAnon
              .removeChannel(channel)
              .then(() => sbAnon.removeAllChannels())
              .finally(() => {
                sbAnon.realtime.disconnect();
                resolve();
              });
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            clearTimeout(timer);
            void sbAnon
              .removeChannel(channel)
              .then(() => sbAnon.removeAllChannels())
              .finally(() => {
                sbAnon.realtime.disconnect();
                reject(new Error(`Realtime subscription failed with status ${status}`));
              });
          }
        });
    });
    assert.ok(realtimeStatuses.includes("SUBSCRIBED"), "Preview Realtime channel must reach SUBSCRIBED");

    // 7f. Confirm all Preview row counts and canonical campaign state remain 100% untouched after all tests
    const postCheck = runPreviewPsql(
      dbConn,
      `BEGIN READ ONLY;
       SET LOCAL ROLE postgres;
       SELECT 'COUNTS:campaigns=' || (SELECT count(*) FROM public.campaigns)
         || ',draws=' || (SELECT count(*) FROM public.draws)
         || ',snapshots=' || (SELECT count(*) FROM public.draw_eligibility_snapshots)
         || ',results=' || (SELECT count(*) FROM public.draw_results)
         || ',evidence=' || (SELECT count(*) FROM public.draw_randomness_evidence)
         || ',tickets=' || (SELECT count(*) FROM public.tickets)
         || ',canon_draws=' || (SELECT count(*) FROM public.draws WHERE campaign_id = '${CANON_CAMPAIGN_ID}')
         || ',canon_snaps=' || (SELECT count(*) FROM public.draw_eligibility_snapshots WHERE campaign_id = '${CANON_CAMPAIGN_ID}')
         || ',canon_results=' || (SELECT count(*) FROM public.draw_results WHERE campaign_id = '${CANON_CAMPAIGN_ID}');
       ROLLBACK;`
    );
    assert.equal(postCheck.status, 0, postCheck.stderr);
    assert.match(
      postCheck.stdout,
      /COUNTS:campaigns=34,draws=22,snapshots=71,results=70,evidence=70,tickets=283,canon_draws=0,canon_snaps=0,canon_results=0/
    );
  });
});
