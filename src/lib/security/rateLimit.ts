import crypto from "crypto";

export type RateLimitResult = {
  allowed: boolean;
  reason?: "IP_LIMIT_EXCEEDED" | "GLOBAL_ORDER_LIMIT_EXCEEDED" | "SERVICE_UNAVAILABLE";
  retryAfterSeconds?: number;
  ipAttempts?: number;
  orderAttempts?: number;
};

export type CheckRateLimitOptions = {
  orderId: string;
  clientIp?: string;
  failClosedIfUnavailable?: boolean;
};

// Window duration: 15 minutes = 900 seconds
export const RATE_LIMIT_WINDOW_SECONDS = 900;
// Max attempts per (orderId, hashedIp)
export const MAX_ATTEMPTS_PER_IP = 10;
// Max attempts per order globally
export const MAX_ATTEMPTS_PER_ORDER = 30;

/**
 * In-memory fallback bucket for development and test environments
 */
type MemoryEntry = {
  count: number;
  expiresAt: number;
};

const memoryStore = new Map<string, MemoryEntry>();

export function resetRateLimitsForTesting() {
  memoryStore.clear();
}

/**
 * Cleans expired entries from the in-memory fallback store
 */
function sweepExpiredMemoryEntries() {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.expiresAt <= now) {
      memoryStore.delete(key);
    }
  }
}

/**
 * Normalizes and hashes the client IP with a salt so raw IP addresses
 * are never logged or stored in keys/memory.
 */
export function hashClientIp(clientIp: string): string {
  const normalized = (clientIp || "127.0.0.1").trim().toLowerCase();
  const salt = process.env.RATE_LIMIT_SALT || "ssfi-rate-limit-salt-v1";
  return crypto.createHash("sha256").update(normalized + salt, "utf8").digest("hex").slice(0, 16);
}

/**
 * Extracts client IP from trusted proxy HTTP headers.
 * Prefers platform-overwritten headers (Vercel / reverse proxy) over leftmost
 * client-spoofable X-Forwarded-For values.
 */
export function getClientIpFromHeaders(
  headers?: Headers | Record<string, string | string[] | undefined> | null
): string {
  if (!headers) return "127.0.0.1";

  const getHeader = (name: string): string | null => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name);
    }
    const rec = headers as Record<string, string | string[] | undefined>;
    const val = rec[name] || rec[name.toLowerCase()];
    if (Array.isArray(val)) return val[0] || null;
    return val || null;
  };

  // 1. Platform-overwritten trusted headers (cannot be spoofed by end clients behind Vercel/Cloudflare)
  const vercelForwarded = getHeader("x-vercel-forwarded-for");
  if (vercelForwarded) {
    const parts = vercelForwarded.split(",").map((s) => s.trim()).filter(Boolean);
    const trustedIp = parts[parts.length - 1];
    if (trustedIp) return trustedIp;
  }

  const xRealIp = getHeader("x-real-ip");
  if (xRealIp && xRealIp.trim()) return xRealIp.trim();

  const cfConnectingIp = getHeader("cf-connecting-ip");
  if (cfConnectingIp && cfConnectingIp.trim()) return cfConnectingIp.trim();

  // 2. Fallback to rightmost proxy-appended hop in X-Forwarded-For (immune to client-prepended values)
  const xForwardedFor = getHeader("x-forwarded-for");
  if (xForwardedFor) {
    const parts = xForwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
    const rightmostIp = parts[parts.length - 1];
    if (rightmostIp) return rightmostIp;
  }

  return "127.0.0.1";
}

/**
 * Atomic in-memory increment and expire
 */
function incrementInMemory(key: string, windowSeconds: number): number {
  const now = Date.now();
  const existing = memoryStore.get(key);

  if (!existing || existing.expiresAt <= now) {
    const newEntry: MemoryEntry = {
      count: 1,
      expiresAt: now + windowSeconds * 1000,
    };
    memoryStore.set(key, newEntry);
    return 1;
  }

  existing.count += 1;
  return existing.count;
}

/**
 * Checks and increments rate limit buckets for order access.
 * Uses Upstash Redis REST API when configured; falls back to in-memory store in dev/test.
 */
export async function checkOrderAccessRateLimit(
  options: CheckRateLimitOptions
): Promise<RateLimitResult> {
  const { orderId, clientIp = "127.0.0.1", failClosedIfUnavailable = false } = options;
  const ipHash = hashClientIp(clientIp);

  const ipKey = `rl:order_ip:${orderId.toLowerCase()}:${ipHash}`;
  const globalKey = `rl:order_global:${orderId.toLowerCase()}`;

  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (upstashUrl && upstashToken) {
    try {
      const pipelineBody = [
        ["INCR", ipKey],
        ["EXPIRE", ipKey, RATE_LIMIT_WINDOW_SECONDS, "NX"],
        ["INCR", globalKey],
        ["EXPIRE", globalKey, RATE_LIMIT_WINDOW_SECONDS, "NX"],
      ];

      const res = await fetch(`${upstashUrl}/pipeline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${upstashToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pipelineBody),
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`Upstash returned HTTP ${res.status}`);
      }

      const results = (await res.json()) as Array<{ result: number }>;
      const ipCount = typeof results[0]?.result === "number" ? results[0].result : 1;
      const globalCount = typeof results[2]?.result === "number" ? results[2].result : 1;

      if (ipCount > MAX_ATTEMPTS_PER_IP) {
        return {
          allowed: false,
          reason: "IP_LIMIT_EXCEEDED",
          retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS,
          ipAttempts: ipCount,
          orderAttempts: globalCount,
        };
      }

      if (globalCount > MAX_ATTEMPTS_PER_ORDER) {
        return {
          allowed: false,
          reason: "GLOBAL_ORDER_LIMIT_EXCEEDED",
          retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS,
          ipAttempts: ipCount,
          orderAttempts: globalCount,
        };
      }

      return {
        allowed: true,
        ipAttempts: ipCount,
        orderAttempts: globalCount,
      };
    } catch {
      if (failClosedIfUnavailable && process.env.NODE_ENV === "production") {
        return {
          allowed: false,
          reason: "SERVICE_UNAVAILABLE",
          retryAfterSeconds: 60,
        };
      }
      // Non-production fallback to in-memory store
    }
  }

  // In-memory fallback
  sweepExpiredMemoryEntries();
  const ipCount = incrementInMemory(ipKey, RATE_LIMIT_WINDOW_SECONDS);
  const globalCount = incrementInMemory(globalKey, RATE_LIMIT_WINDOW_SECONDS);

  if (ipCount > MAX_ATTEMPTS_PER_IP) {
    return {
      allowed: false,
      reason: "IP_LIMIT_EXCEEDED",
      retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS,
      ipAttempts: ipCount,
      orderAttempts: globalCount,
    };
  }

  if (globalCount > MAX_ATTEMPTS_PER_ORDER) {
    return {
      allowed: false,
      reason: "GLOBAL_ORDER_LIMIT_EXCEEDED",
      retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS,
      ipAttempts: ipCount,
      orderAttempts: globalCount,
    };
  }

  return {
    allowed: true,
    ipAttempts: ipCount,
    orderAttempts: globalCount,
  };
}

export type ScopedRateLimitOptions = {
  scope: string;
  identifier: string;
  maxAttempts: number;
  windowSeconds: number;
  failClosedIfUnavailable?: boolean;
};

export type ScopedRateLimitResult = {
  allowed: boolean;
  attempts: number;
  limit: number;
  retryAfterSeconds?: number;
  reason?: "RATE_LIMIT_EXCEEDED" | "SERVICE_UNAVAILABLE";
};

/**
 * Generic scoped rate limiter reusing Upstash Redis REST pipeline when configured,
 * with in-memory fallback in local/test environments.
 * Always hashes the identifier so raw user IDs or IPs are never stored in plain keys.
 */
export async function checkScopedRateLimit(
  options: ScopedRateLimitOptions
): Promise<ScopedRateLimitResult> {
  const {
    scope,
    identifier,
    maxAttempts,
    windowSeconds,
    failClosedIfUnavailable = false,
  } = options;

  const cleanScope = scope.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
  const idHash = hashClientIp(identifier || "anonymous");
  const key = `rl:${cleanScope}:${idHash}`;

  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const isProdRuntime =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";

  if (upstashUrl && upstashToken) {
    try {
      const pipelineBody = [
        ["INCR", key],
        ["EXPIRE", key, windowSeconds, "NX"],
      ];

      const res = await fetch(`${upstashUrl}/pipeline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${upstashToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pipelineBody),
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`Upstash returned HTTP ${res.status}`);
      }

      const results = (await res.json()) as Array<{ result: number }>;
      const attempts = typeof results[0]?.result === "number" ? results[0].result : 1;

      if (attempts > maxAttempts) {
        return {
          allowed: false,
          attempts,
          limit: maxAttempts,
          retryAfterSeconds: windowSeconds,
          reason: "RATE_LIMIT_EXCEEDED",
        };
      }

      return { allowed: true, attempts, limit: maxAttempts };
    } catch {
      console.warn(`[RateLimit] Distributed Redis check failed for scope="${cleanScope}".`);
      if (failClosedIfUnavailable && isProdRuntime) {
        return {
          allowed: false,
          attempts: 0,
          limit: maxAttempts,
          retryAfterSeconds: 60,
          reason: "SERVICE_UNAVAILABLE",
        };
      }
    }
  } else if (isProdRuntime) {
    console.warn(`[RateLimit] Upstash Redis is not configured in production for scope="${cleanScope}".`);
    if (failClosedIfUnavailable) {
      return {
        allowed: false,
        attempts: 0,
        limit: maxAttempts,
        retryAfterSeconds: 60,
        reason: "SERVICE_UNAVAILABLE",
      };
    }
  }

  sweepExpiredMemoryEntries();
  const attempts = incrementInMemory(key, windowSeconds);
  if (attempts > maxAttempts) {
    return {
      allowed: false,
      attempts,
      limit: maxAttempts,
      retryAfterSeconds: windowSeconds,
      reason: "RATE_LIMIT_EXCEEDED",
    };
  }

  return { allowed: true, attempts, limit: maxAttempts };
}
