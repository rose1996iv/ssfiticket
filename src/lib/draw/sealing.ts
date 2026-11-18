import crypto from "node:crypto";

export interface SealingContext {
  campaignId: string;
  drawId: string;
  prizeId: string;
}

export interface SealedSeedEnvelope {
  version: 1;
  alg: "AES-256-GCM";
  kid: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface SealingConfig {
  activeKid: string;
  keys: Map<string, Buffer>;
}

const KID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Parses and strictly validates a 32-byte AES-256 key from 64-char hex or base64.
 */
function parseSealingKey(rawKey: string, label: string): Buffer {
  const trimmed = rawKey.trim();
  if (!trimmed) {
    throw new Error(`${label} must not be empty.`);
  }

  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, "hex");
  } else {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length !== 32) {
      throw new Error(
        `${label} must be a 64-char hex string or 32-byte base64 key.`
      );
    }
    key = decoded;
  }

  if (key.length !== 32) {
    throw new Error(`${label} must decode to exactly 32 bytes.`);
  }

  return key;
}

/**
 * Loads and strictly validates SSFI_DRAW_SEALING_KEY, SSFI_DRAW_ACTIVE_KID,
 * and optional historical decryption keys (SSFI_DRAW_PREVIOUS_KEYS).
 * Fails closed on missing, malformed, or wrong-length key material.
 */
export function loadSealingConfig(
  env: Record<string, string | undefined> = process.env
): SealingConfig {
  const rawKey = env.SSFI_DRAW_SEALING_KEY?.trim();
  const activeKid = env.SSFI_DRAW_ACTIVE_KID?.trim();

  if (!rawKey) {
    throw new Error("SSFI_DRAW_SEALING_KEY is not configured.");
  }
  if (!activeKid || !KID_REGEX.test(activeKid)) {
    throw new Error("SSFI_DRAW_ACTIVE_KID is missing or malformed.");
  }

  const keys = new Map<string, Buffer>();
  keys.set(activeKid, parseSealingKey(rawKey, "SSFI_DRAW_SEALING_KEY"));

  const rawPrev = env.SSFI_DRAW_PREVIOUS_KEYS?.trim();
  if (rawPrev) {
    let parsedEntries: Array<[string, string]> = [];
    if (rawPrev.startsWith("{")) {
      let obj: unknown;
      try {
        obj = JSON.parse(rawPrev);
      } catch {
        throw new Error("SSFI_DRAW_PREVIOUS_KEYS JSON is malformed.");
      }
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        throw new Error("SSFI_DRAW_PREVIOUS_KEYS must be a JSON object mapping kid to key.");
      }
      parsedEntries = Object.entries(obj as Record<string, unknown>).map(([k, v]) => {
        if (typeof v !== "string") {
          throw new Error(`SSFI_DRAW_PREVIOUS_KEYS entry for '${k}' must be a string.`);
        }
        return [k, v];
      });
    } else {
      for (const pair of rawPrev.split(",")) {
        const sep = pair.indexOf(":");
        if (sep <= 0) {
          throw new Error("SSFI_DRAW_PREVIOUS_KEYS entries must use 'kid:key' format.");
        }
        parsedEntries.push([pair.slice(0, sep), pair.slice(sep + 1)]);
      }
    }

    for (const [rawKid, rawPrevKey] of parsedEntries) {
      const kid = rawKid.trim();
      if (!KID_REGEX.test(kid)) {
        throw new Error(`Invalid historical key ID '${kid}' in SSFI_DRAW_PREVIOUS_KEYS.`);
      }
      if (keys.has(kid)) {
        throw new Error(`Duplicate key ID '${kid}' in sealing keyring.`);
      }
      keys.set(kid, parseSealingKey(rawPrevKey, `SSFI_DRAW_PREVIOUS_KEYS[${kid}]`));
    }
  }

  return { activeKid, keys };
}

/**
 * Builds deterministic context-bound Additional Authenticated Data (AAD).
 */
export function buildSealingAad(
  context: SealingContext,
  kid: string,
  version: number = 1
): Buffer {
  const campaignId = context.campaignId?.trim().toLowerCase();
  const drawId = context.drawId?.trim().toLowerCase();
  const prizeId = context.prizeId?.trim().toLowerCase();
  const cleanKid = kid?.trim();

  if (!campaignId || !drawId || !prizeId || !cleanKid) {
    throw new Error("Invalid sealing AAD context: campaignId, drawId, prizeId, and kid are required.");
  }

  return Buffer.from(
    `ssfi:draw-seed:v${version}|campaign=${campaignId}|draw=${drawId}|prize=${prizeId}|kid=${cleanKid}`,
    "utf8"
  );
}

/**
 * Encrypts a plaintext server seed using AES-256-GCM under activeKid,
 * with a unique 96-bit CSPRNG IV and context-bound AAD.
 */
export function sealDrawSeed(
  plaintextSeed: string,
  context: SealingContext,
  config: SealingConfig = loadSealingConfig()
): SealedSeedEnvelope {
  const seed = plaintextSeed?.trim();
  if (!seed || !/^[0-9a-fA-F]{64}$/.test(seed)) {
    throw new Error("Plaintext server seed must be a 64-character hex string.");
  }

  const activeKey = config.keys.get(config.activeKid);
  if (!activeKey) {
    throw new Error(`Active sealing key '${config.activeKid}' is not present in keyring.`);
  }

  const iv = crypto.randomBytes(12);
  const aad = buildSealingAad(context, config.activeKid, 1);
  const cipher = crypto.createCipheriv("aes-256-gcm", activeKey, iv);
  cipher.setAAD(aad);

  const encrypted = Buffer.concat([cipher.update(seed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    alg: "AES-256-GCM",
    kid: config.activeKid,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: encrypted.toString("hex"),
  };
}

/**
 * Decrypts and authenticates a SealedSeedEnvelope under the expected context.
 * Supports explicitly configured historical KIDs; fails closed on unknown KIDs,
 * missing keys, unsupported versions, or tampered ciphertext/tag/AAD.
 */
export function unsealDrawSeed(
  envelope: SealedSeedEnvelope,
  context: SealingContext,
  config: SealingConfig = loadSealingConfig()
): string {
  if (!envelope || envelope.version !== 1 || envelope.alg !== "AES-256-GCM") {
    throw new Error("Unsupported sealed seed envelope version or algorithm.");
  }
  if (!envelope.kid || !KID_REGEX.test(envelope.kid)) {
    throw new Error("Sealed seed envelope is missing a valid key ID (kid).");
  }

  const key = config.keys.get(envelope.kid);
  if (!key) {
    throw new Error(`Sealed seed key ID (kid) '${envelope.kid}' is not configured in keyring.`);
  }

  if (!/^[0-9a-fA-F]{24}$/.test(envelope.iv)) {
    throw new Error("Invalid sealed seed IV length.");
  }
  if (!/^[0-9a-fA-F]{32}$/.test(envelope.tag)) {
    throw new Error("Invalid sealed seed authentication tag length.");
  }
  if (!envelope.ciphertext || !/^[0-9a-fA-F]+$/.test(envelope.ciphertext)) {
    throw new Error("Invalid sealed seed ciphertext.");
  }

  const iv = Buffer.from(envelope.iv, "hex");
  const tag = Buffer.from(envelope.tag, "hex");
  const ciphertext = Buffer.from(envelope.ciphertext, "hex");
  const aad = buildSealingAad(context, envelope.kid, envelope.version);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
