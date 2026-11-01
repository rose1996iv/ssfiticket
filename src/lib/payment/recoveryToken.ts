import crypto from "crypto";

export const TOKEN_HEX_LENGTH = 64;
export const DEFAULT_EXPIRY_DAYS = 7;

/**
 * Generates a cryptographically secure, high-entropy 32-byte (64 hex char) random token.
 * Note: The raw token string should ONLY be returned to the authorized admin user once
 * to generate the link and NEVER stored in plaintext in the database or logs.
 */
export function generateSecureRecoveryToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Computes the SHA-256 hex digest of a recovery token.
 * Only this hash is persisted to the database.
 */
export function hashRecoveryToken(rawToken: string): string {
  if (!rawToken || typeof rawToken !== "string") {
    throw new Error("Invalid token input for hashing.");
  }
  return crypto.createHash("sha256").update(rawToken.trim().toLowerCase()).digest("hex");
}

/**
 * Validates that a string is a 64-character hexadecimal token.
 */
export function isValidTokenFormat(rawToken: string): boolean {
  if (!rawToken || typeof rawToken !== "string") return false;
  return /^[0-9a-f]{64}$/i.test(rawToken.trim());
}

/**
 * Builds the canonical public customer payment completion URL using the environment-aware base URL.
 * Never includes order UUIDs, phone numbers, or emails in the URL.
 */
export function buildPaymentRecoveryUrl(baseUrl: string, rawToken: string): string {
  const cleanBase = baseUrl.trim().replace(/\/+$/, "");
  return `${cleanBase}/payment/complete/${encodeURIComponent(rawToken.trim())}`;
}

/**
 * In-memory sliding window rate limiter for token lookups and submissions.
 * Protects against brute-force enumeration of tokens.
 */
type AttemptRecord = {
  attempts: number[];
};

const rateLimitMap = new Map<string, AttemptRecord>();
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS_PER_WINDOW = 20;

export function checkTokenRateLimit(identifier: string): {
  allowed: boolean;
  retryAfterSeconds?: number;
} {
  const now = Date.now();
  const record = rateLimitMap.get(identifier) ?? { attempts: [] };

  // Filter out expired timestamps
  const recentAttempts = record.attempts.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

  if (recentAttempts.length >= MAX_ATTEMPTS_PER_WINDOW) {
    const oldest = recentAttempts[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  recentAttempts.push(now);
  rateLimitMap.set(identifier, { attempts: recentAttempts });

  // Periodically clean up old map entries
  if (rateLimitMap.size > 10000) {
    for (const [key, val] of rateLimitMap.entries()) {
      if (val.attempts.every((ts) => now - ts >= RATE_LIMIT_WINDOW_MS)) {
        rateLimitMap.delete(key);
      }
    }
  }

  return { allowed: true };
}

/**
 * Formats the pre-filled WhatsApp message for an admin to share the recovery link with a customer.
 */
export function buildWhatsAppRecoveryShareUrl(params: {
  phone: string;
  orderNumber: string;
  quantity: number;
  totalAmountInr: number;
  recoveryUrl: string;
  expiresAtIso: string;
}): string {
  const cleanPhone = params.phone.replace(/\D/g, "");
  const expiryDate = new Date(params.expiresAtIso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });

  const message =
    `Hello! Regarding your SSFI Lucky Draw Order ${params.orderNumber} ` +
    `for ${params.quantity} ${params.quantity === 1 ? "ticket" : "tickets"} (₹${params.totalAmountInr}):\n\n` +
    `Please complete your payment details and submit your UPI UTR reference using this secure link:\n` +
    `${params.recoveryUrl}\n\n` +
    `Important: This link will expire on ${expiryDate} IST.\n` +
    `Once you submit your UTR, our organizers will verify the payment and issue your tickets. Thank you!`;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}
