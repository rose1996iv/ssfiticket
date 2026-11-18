/**
 * ============================================================================
 * SSFI LUCKY DRAW — PUBLIC-SAFE REALTIME BROADCAST HELPER (PHASE B2.12 / L-01)
 * ============================================================================
 * Guarantees that the public `draw_executed` broadcast on channel
 * `ssfi-public-winners-<campaignPublicId>`:
 *   1. Is emitted ONLY after a confirmed PostgreSQL commit (`commitSucceeded === true`,
 *      no RPC error, and a non-empty `resultId`).
 *   2. Never emits on rollback, RPC error, or duplicate-execution rejection (`23505`).
 *   3. Carries a strictly public-safe, minimal metadata payload containing zero
 *      customer PII, zero internal UUIDs, zero plaintext seeds, zero commitments,
 *      and zero sealed envelopes. Public spectators fetch certified ticket numbers
 *      via `get_public_draw_winners` upon receiving this signal.
 * ============================================================================
 */

import { createClient } from "@supabase/supabase-js";

export const PUBLIC_DRAW_EXECUTED_EVENT = "draw_executed" as const;
const DEFAULT_CAMPAIGN_PUBLIC_ID = "ssfi-fundraising-lucky-draw";

export interface PublicDrawExecutedBroadcastPayload {
  event_version: 1;
  campaign_public_id: string;
  prize_number: number;
  draw_completed: boolean;
  occurred_at: string;
}

const ALLOWED_PAYLOAD_KEYS = new Set([
  "event_version",
  "campaign_public_id",
  "prize_number",
  "draw_completed",
  "occurred_at",
]);

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "id",
  "result_id",
  "draw_id",
  "campaign_id",
  "prize_id",
  "ticket_id",
  "snapshot_id",
  "customer_id",
  "seller_id",
  "order_id",
  "drawn_by",
  "ticket_number",
  "customer_name",
  "customer_email",
  "customer_phone",
  "full_name",
  "email",
  "phone",
  "seller_name",
  "seller_code",
  "server_seed",
  "serverSeed",
  "seed_commitment",
  "seedCommitment",
  "seed_revealed",
  "seedRevealed",
  "combined_seed",
  "combinedSeed",
  "client_entropy",
  "clientEntropy",
  "sealed_seed_envelope",
  "sealedEnvelope",
  "sealing_kid",
  "ciphertext",
  "iv",
  "tag",
]);

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HEX_64_REGEX = /\b[0-9a-f]{64}\b/i;

/**
 * Builds the canonical Realtime broadcast channel name for public draw winners.
 */
export function buildPublicWinnersChannelName(
  campaignPublicId: string = DEFAULT_CAMPAIGN_PUBLIC_ID
): string {
  const cleanId = (campaignPublicId || DEFAULT_CAMPAIGN_PUBLIC_ID).trim();
  return `ssfi-public-winners-${cleanId}`;
}

/**
 * Constructs a strictly minimal, public-safe `draw_executed` broadcast payload.
 */
export function buildPublicDrawExecutedPayload(input: {
  campaignPublicId: string;
  prizeNumber: number;
  occurredAt?: string;
}): PublicDrawExecutedBroadcastPayload {
  const cleanPublicId = (input.campaignPublicId || "").trim();
  if (!cleanPublicId) {
    throw new Error("Campaign public_id is required for public draw broadcast.");
  }
  if (UUID_REGEX.test(cleanPublicId)) {
    throw new Error("Unsafe campaignPublicId: internal UUIDs must not be broadcast.");
  }
  const prizeNumber = Number(input.prizeNumber);
  if (!Number.isInteger(prizeNumber) || prizeNumber < 1 || prizeNumber > 100) {
    throw new Error(`Invalid prize_number for public broadcast: ${String(input.prizeNumber)}`);
  }

  const occurredAt = input.occurredAt || new Date().toISOString();

  const payload: PublicDrawExecutedBroadcastPayload = {
    event_version: 1,
    campaign_public_id: cleanPublicId,
    prize_number: prizeNumber,
    draw_completed: prizeNumber === 1,
    occurred_at: occurredAt,
  };

  assertPublicBroadcastPayloadSafe(payload);
  return payload;
}

/**
 * Asserts that a broadcast payload contains ONLY the approved public-safe keys
 * and contains no customer PII, internal UUIDs, 64-hex seeds/commitments, or
 * sealed envelope fields. Throws if any violation is detected.
 */
export function assertPublicBroadcastPayloadSafe(
  payload: unknown
): asserts payload is PublicDrawExecutedBroadcastPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid public broadcast payload: expected plain object.");
  }

  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);

  for (const key of keys) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) {
      throw new Error(`Forbidden key "${key}" detected in public broadcast payload.`);
    }
    if (!ALLOWED_PAYLOAD_KEYS.has(key)) {
      throw new Error(`Unapproved key "${key}" detected in public broadcast payload.`);
    }
  }

  for (const requiredKey of ALLOWED_PAYLOAD_KEYS) {
    if (!(requiredKey in record)) {
      throw new Error(`Missing required key "${requiredKey}" in public broadcast payload.`);
    }
  }

  if (record.event_version !== 1) {
    throw new Error("Invalid event_version in public broadcast payload.");
  }
  if (typeof record.campaign_public_id !== "string" || !record.campaign_public_id.trim()) {
    throw new Error("Invalid campaign_public_id in public broadcast payload.");
  }
  if (
    typeof record.prize_number !== "number" ||
    !Number.isInteger(record.prize_number) ||
    record.prize_number < 1
  ) {
    throw new Error("Invalid prize_number in public broadcast payload.");
  }
  if (typeof record.draw_completed !== "boolean") {
    throw new Error("Invalid draw_completed flag in public broadcast payload.");
  }
  if (typeof record.occurred_at !== "string" || Number.isNaN(Date.parse(record.occurred_at))) {
    throw new Error("Invalid occurred_at timestamp in public broadcast payload.");
  }

  const serialized = JSON.stringify(record);
  if (UUID_REGEX.test(serialized)) {
    throw new Error("Public broadcast payload safety violation: internal UUID detected.");
  }
  if (HEX_64_REGEX.test(serialized)) {
    throw new Error(
      "Public broadcast payload safety violation: 64-char hex seed or commitment detected."
    );
  }
}

export type BroadcastTransportFn = (args: {
  channelName: string;
  event: typeof PUBLIC_DRAW_EXECUTED_EVENT;
  payload: PublicDrawExecutedBroadcastPayload;
}) => Promise<void>;

/**
 * Default transport that sends a one-shot broadcast over Supabase Realtime
 * and cleans up the channel without blocking or failing the committed DB draw.
 */
async function defaultSupabaseBroadcastTransport(args: {
  channelName: string;
  event: typeof PUBLIC_DRAW_EXECUTED_EVENT;
  payload: PublicDrawExecutedBroadcastPayload;
}): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "";
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase configuration missing for realtime broadcast.");
  }
  const admin = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const channel = admin.channel(args.channelName);
  try {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 2500);
      channel.subscribe((status: string) => {
        if (
          status === "SUBSCRIBED" ||
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    await channel.send({
      type: "broadcast",
      event: args.event,
      payload: args.payload,
    });
  } finally {
    await admin.removeChannel(channel);
    admin.realtime.disconnect();
  }
}

/**
 * Emits the public `draw_executed` broadcast ONLY when the database commit
 * succeeded (`commitSucceeded === true`, `!rpcError`, and a valid `resultId`).
 * Failed, rolled-back, or duplicate-rejected transactions never emit an event.
 */
export async function emitPublicDrawExecutedBroadcast(options: {
  commitSucceeded: boolean;
  rpcError?: { message?: string; code?: string } | null;
  resultId?: string | null;
  campaignPublicId: string;
  prizeNumber: number;
  occurredAt?: string;
  transport?: BroadcastTransportFn;
}): Promise<{
  emitted: boolean;
  reason?: string;
  channelName?: string;
  payload?: PublicDrawExecutedBroadcastPayload;
}> {
  if (!options.commitSucceeded || options.rpcError || !options.resultId) {
    return {
      emitted: false,
      reason: "DB_COMMIT_NOT_SUCCEEDED",
    };
  }

  const payload = buildPublicDrawExecutedPayload({
    campaignPublicId: options.campaignPublicId,
    prizeNumber: options.prizeNumber,
    occurredAt: options.occurredAt,
  });

  const channelName = buildPublicWinnersChannelName(options.campaignPublicId);
  const transport = options.transport ?? defaultSupabaseBroadcastTransport;

  try {
    await transport({
      channelName,
      event: PUBLIC_DRAW_EXECUTED_EVENT,
      payload,
    });
    return {
      emitted: true,
      channelName,
      payload,
    };
  } catch (err) {
    return {
      emitted: false,
      reason: `BROADCAST_TRANSPORT_ERROR: ${(err as Error).message}`,
      channelName,
      payload,
    };
  }
}
