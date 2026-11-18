import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  PUBLIC_DRAW_EXECUTED_EVENT,
  buildPublicWinnersChannelName,
  buildPublicDrawExecutedPayload,
  assertPublicBroadcastPayloadSafe,
  emitPublicDrawExecutedBroadcast,
  type PublicDrawExecutedBroadcastPayload,
} from "../src/lib/draw/realtimeBroadcast.ts";

const EXPECTED_PREVIEW_REF = "jiyuiydzsfydjklosvvq";
const FORBIDDEN_PROD_REF = "fohpqheglxhfdecadhzw";
const SYNTH_UAT_PUBLIC_ID = "synth-uat-1794143277348";

test("Phase B2.12 Task 1.1 — Successful execution emits public-safe draw_executed broadcast after DB commit", async () => {
  const sentEvents: Array<{
    channelName: string;
    event: string;
    payload: PublicDrawExecutedBroadcastPayload;
  }> = [];

  const res = await emitPublicDrawExecutedBroadcast({
    commitSucceeded: true,
    rpcError: null,
    resultId: "11111111-2222-4333-8444-555555555555",
    campaignPublicId: SYNTH_UAT_PUBLIC_ID,
    prizeNumber: 5,
    occurredAt: "2026-11-16T00:00:00.000Z",
    transport: async (evt) => {
      sentEvents.push(evt);
    },
  });

  assert.equal(res.emitted, true);
  assert.equal(res.channelName, `ssfi-public-winners-${SYNTH_UAT_PUBLIC_ID}`);
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].event, PUBLIC_DRAW_EXECUTED_EVENT);
  assert.deepEqual(sentEvents[0].payload, {
    event_version: 1,
    campaign_public_id: SYNTH_UAT_PUBLIC_ID,
    prize_number: 5,
    draw_completed: false,
    occurred_at: "2026-11-16T00:00:00.000Z",
  });

  // 1st Prize (Grand Prize) sets draw_completed = true
  const grandRes = await emitPublicDrawExecutedBroadcast({
    commitSucceeded: true,
    rpcError: null,
    resultId: "11111111-2222-4333-8444-666666666666",
    campaignPublicId: SYNTH_UAT_PUBLIC_ID,
    prizeNumber: 1,
    occurredAt: "2026-11-16T00:05:00.000Z",
    transport: async (evt) => {
      sentEvents.push(evt);
    },
  });
  assert.equal(grandRes.emitted, true);
  assert.equal(sentEvents.length, 2);
  assert.equal(sentEvents[1].payload.draw_completed, true);
});

test("Phase B2.12 Task 1.2 — Failed or rolled-back draw transactions emit zero broadcast events", async () => {
  const sentEvents: unknown[] = [];
  const transport = async (evt: unknown) => {
    sentEvents.push(evt);
  };

  // Case A: Explicit rollback / commitSucceeded = false
  const rollbackRes = await emitPublicDrawExecutedBroadcast({
    commitSucceeded: false,
    rpcError: { message: "Transaction rolled back", code: "40001" },
    resultId: null,
    campaignPublicId: SYNTH_UAT_PUBLIC_ID,
    prizeNumber: 5,
    transport,
  });
  assert.equal(rollbackRes.emitted, false);
  assert.equal(rollbackRes.reason, "DB_COMMIT_NOT_SUCCEEDED");

  // Case B: RPC returned an error even if caller passed resultId
  const rpcErrorRes = await emitPublicDrawExecutedBroadcast({
    commitSucceeded: true,
    rpcError: { message: "Ceremonial sequence violation", code: "P0001" },
    resultId: "11111111-2222-4333-8444-555555555555",
    campaignPublicId: SYNTH_UAT_PUBLIC_ID,
    prizeNumber: 4,
    transport,
  });
  assert.equal(rpcErrorRes.emitted, false);
  assert.equal(rpcErrorRes.reason, "DB_COMMIT_NOT_SUCCEEDED");

  // Case C: Missing resultId (no committed draw_results row)
  const missingResultRes = await emitPublicDrawExecutedBroadcast({
    commitSucceeded: true,
    rpcError: null,
    resultId: "",
    campaignPublicId: SYNTH_UAT_PUBLIC_ID,
    prizeNumber: 5,
    transport,
  });
  assert.equal(missingResultRes.emitted, false);
  assert.equal(missingResultRes.reason, "DB_COMMIT_NOT_SUCCEEDED");

  assert.equal(sentEvents.length, 0, "Zero events must be emitted on rollback or failure");
});

test("Phase B2.12 Task 1.3 — Duplicate draw execution / seed-reuse rejection (23505) emits zero broadcast events", async () => {
  const sentEvents: unknown[] = [];

  const duplicatePrizeRes = await emitPublicDrawExecutedBroadcast({
    commitSucceeded: false,
    rpcError: {
      code: "23505",
      message: 'duplicate key value violates unique constraint "idx_draw_results_unique_prize"',
    },
    resultId: null,
    campaignPublicId: SYNTH_UAT_PUBLIC_ID,
    prizeNumber: 5,
    transport: async (evt) => {
      sentEvents.push(evt);
    },
  });
  assert.equal(duplicatePrizeRes.emitted, false);

  const duplicateSeedRes = await emitPublicDrawExecutedBroadcast({
    commitSucceeded: false,
    rpcError: {
      code: "23505",
      message: 'duplicate key value violates unique constraint "idx_randomness_evidence_unique_seed_revealed"',
    },
    resultId: null,
    campaignPublicId: SYNTH_UAT_PUBLIC_ID,
    prizeNumber: 4,
    transport: async (evt) => {
      sentEvents.push(evt);
    },
  });
  assert.equal(duplicateSeedRes.emitted, false);
  assert.equal(sentEvents.length, 0, "Duplicate execution rejections must never emit a broadcast");
});

test("Phase B2.12 Task 1.4 — Public broadcast payload safety strictly rejects PII, UUIDs, plaintext seeds, commitments, and sealed envelopes", () => {
  const baseSafe = buildPublicDrawExecutedPayload({
    campaignPublicId: SYNTH_UAT_PUBLIC_ID,
    prizeNumber: 3,
    occurredAt: "2026-11-16T00:10:00.000Z",
  });
  assertPublicBroadcastPayloadSafe(baseSafe);

  const forbiddenInjections: Array<[string, Record<string, unknown>]> = [
    ["customer_name PII", { ...baseSafe, customer_name: "Alice Example" }],
    ["customer_email PII", { ...baseSafe, customer_email: "alice@example.com" }],
    ["customer_phone PII", { ...baseSafe, customer_phone: "+919999999999" }],
    ["ticket_number in broadcast", { ...baseSafe, ticket_number: "SSFI-000123" }],
    ["internal draw_id UUID", { ...baseSafe, draw_id: "588996ca-fa88-4bc4-8660-b5d409446251" }],
    ["internal ticket_id UUID", { ...baseSafe, ticket_id: "588996ca-fa88-4bc4-8660-b5d409446251" }],
    ["UUID disguised as campaign_public_id", { ...baseSafe, campaign_public_id: "0f719dad-4547-4660-aed9-f5c6c7b8ed80" }],
    ["plaintext server_seed", { ...baseSafe, server_seed: "a".repeat(64) }],
    ["seed_commitment hash", { ...baseSafe, seed_commitment: "b".repeat(64) }],
    ["seed_revealed hex", { ...baseSafe, seed_revealed: "c".repeat(64) }],
    ["combined_seed hex", { ...baseSafe, combined_seed: "d".repeat(64) }],
    ["64-hex string inside campaign_public_id", { ...baseSafe, campaign_public_id: "e".repeat(64) }],
    [
      "sealed_seed_envelope object",
      {
        ...baseSafe,
        sealed_seed_envelope: {
          v: 1,
          alg: "AES-256-GCM",
          kid: "k1",
          iv: "AAAA",
          ciphertext: "BBBB",
          tag: "CCCC",
          aad_hash: "f".repeat(64),
        },
      },
    ],
  ];

  for (const [label, unsafePayload] of forbiddenInjections) {
    assert.throws(
      () => assertPublicBroadcastPayloadSafe(unsafePayload),
      /Forbidden key|Unapproved key|safety violation/i,
      `Expected assertPublicBroadcastPayloadSafe to reject ${label}`
    );
  }
});

test("Phase B2.12 Task 1.5 — Static wiring & Live Preview Realtime pub-sub verification (L-01 end-to-end)", async () => {
  // 1. Verify static wiring in luckyDraw.ts and PublicDrawWinnersSection.tsx
  const luckyDrawSource = fs.readFileSync(
    path.join(process.cwd(), "src/server/actions/luckyDraw.ts"),
    "utf8"
  );
  const publicSectionSource = fs.readFileSync(
    path.join(process.cwd(), "src/components/home/PublicDrawWinnersSection.tsx"),
    "utf8"
  );

  const rpcIdx = luckyDrawSource.indexOf('admin.rpc("execute_draw_winner_selection"');
  const broadcastIdx = luckyDrawSource.indexOf("emitPublicDrawExecutedBroadcast(");
  assert.ok(rpcIdx > 0, "execute_draw_winner_selection RPC call must exist in luckyDraw.ts");
  assert.ok(broadcastIdx > rpcIdx, "emitPublicDrawExecutedBroadcast must be called AFTER execute_draw_winner_selection commit");

  assert.ok(
    publicSectionSource.includes("buildPublicWinnersChannelName(campaignPublicId)"),
    "PublicDrawWinnersSection must subscribe to buildPublicWinnersChannelName(campaignPublicId)"
  );
  assert.ok(
    publicSectionSource.includes("PUBLIC_DRAW_EXECUTED_EVENT"),
    "PublicDrawWinnersSection must listen for PUBLIC_DRAW_EXECUTED_EVENT"
  );

  // 2. Verify live Realtime pub-sub delivery over Preview Supabase without mutating DB
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
  assert.ok(
    supabaseUrl.includes(EXPECTED_PREVIEW_REF) && !supabaseUrl.includes(FORBIDDEN_PROD_REF),
    "Must target Preview Supabase only"
  );

  const spectatorClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const channelName = buildPublicWinnersChannelName(SYNTH_UAT_PUBLIC_ID);
  const receivedEvents: PublicDrawExecutedBroadcastPayload[] = [];

  try {
    const channel = spectatorClient.channel(channelName);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Spectator channel subscribe timeout")), 8000);
      channel
        .on("broadcast", { event: PUBLIC_DRAW_EXECUTED_EVENT }, (msg) => {
          receivedEvents.push(msg.payload as PublicDrawExecutedBroadcastPayload);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            clearTimeout(timeout);
            resolve();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            clearTimeout(timeout);
            reject(new Error(`Spectator channel failed with status ${status}`));
          }
        });
    });

    const emitResult = await emitPublicDrawExecutedBroadcast({
      commitSucceeded: true,
      rpcError: null,
      resultId: "99999999-8888-4777-8666-555555555555",
      campaignPublicId: SYNTH_UAT_PUBLIC_ID,
      prizeNumber: 1,
    });

    assert.equal(emitResult.emitted, true);

    const startWait = Date.now();
    while (receivedEvents.length === 0 && Date.now() - startWait < 5000) {
      await new Promise((r) => setTimeout(r, 100));
    }

    assert.ok(
      receivedEvents.length > 0,
      "Spectator client must receive draw_executed broadcast from emitPublicDrawExecutedBroadcast"
    );
    const receivedPayload = receivedEvents[0];
    assertPublicBroadcastPayloadSafe(receivedPayload);
    assert.equal(receivedPayload.campaign_public_id, SYNTH_UAT_PUBLIC_ID);
    assert.equal(receivedPayload.prize_number, 1);
    assert.equal(receivedPayload.draw_completed, true);
  } finally {
    await spectatorClient.removeAllChannels();
    spectatorClient.realtime.disconnect();
  }
});
