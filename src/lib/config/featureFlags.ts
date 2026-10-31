/**
 * SSFI Lucky Draw — Feature Flags Configuration
 *
 * Lightweight, zero-dependency feature flag architecture designed for safe,
 * incremental releases and operational toggles across Development, Preview,
 * and Production.
 *
 * Principles:
 * 1. Default to Baseline: All flags default to the approved Preview UI/UX and
 *    operational baseline unless explicitly toggled via environment variables.
 * 2. Zero-Overhead: No external network calls, SaaS SDKs, or database latency.
 * 3. Client & Server Parity: Reads standard process.env variables supported
 *    by Next.js App Router.
 */

export interface FeatureFlags {
  /**
   * Automated payment gateway integration (e.g. Razorpay / Cashfree / PhonePe PG).
   * Default: false (strictly preserves the approved Manual UPI verification workflow).
   */
  ENABLE_LIVE_PAYMENT_GATEWAY: boolean;

  /**
   * Automated WhatsApp Cloud API delivery.
   * Default: false (strictly preserves the approved WhatsApp click-to-chat delivery).
   */
  ENABLE_WHATSAPP_CLOUD_API: boolean;

  /**
   * Administrative detailed audit trail export to CSV/JSON.
   * Default: true (active in approved baseline).
   */
  ENABLE_DETAILED_AUDIT_EXPORT: boolean;

  /**
   * Public seller onboarding / self-registration.
   * Default: false (preserves staff-only seller provisioning).
   */
  ENABLE_SELLER_SELF_REGISTRATION: boolean;

  /**
   * System-wide maintenance mode for database migrations or emergency downtime.
   * Default: false.
   */
  ENABLE_MAINTENANCE_MODE: boolean;
}

/**
 * Evaluates whether a feature flag is enabled.
 *
 * Precedence:
 * 1. Process environment variable `FEATURE_<FLAG_NAME>` or `NEXT_PUBLIC_FEATURE_<FLAG_NAME>`
 * 2. Canonical approved baseline default
 */
export function isFeatureEnabled(flag: keyof FeatureFlags): boolean {
  const envVal =
    process.env[`FEATURE_${flag}`] ??
    process.env[`NEXT_PUBLIC_FEATURE_${flag}`];

  if (envVal !== undefined) {
    const normalized = envVal.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }

  // Canonical baseline defaults
  switch (flag) {
    case "ENABLE_DETAILED_AUDIT_EXPORT":
      return true;
    case "ENABLE_LIVE_PAYMENT_GATEWAY":
    case "ENABLE_WHATSAPP_CLOUD_API":
    case "ENABLE_SELLER_SELF_REGISTRATION":
    case "ENABLE_MAINTENANCE_MODE":
    default:
      return false;
  }
}

/**
 * Returns a read-only snapshot of all feature flag states.
 */
export function getAllFeatureFlags(): Readonly<FeatureFlags> {
  return Object.freeze({
    ENABLE_LIVE_PAYMENT_GATEWAY: isFeatureEnabled("ENABLE_LIVE_PAYMENT_GATEWAY"),
    ENABLE_WHATSAPP_CLOUD_API: isFeatureEnabled("ENABLE_WHATSAPP_CLOUD_API"),
    ENABLE_DETAILED_AUDIT_EXPORT: isFeatureEnabled("ENABLE_DETAILED_AUDIT_EXPORT"),
    ENABLE_SELLER_SELF_REGISTRATION: isFeatureEnabled("ENABLE_SELLER_SELF_REGISTRATION"),
    ENABLE_MAINTENANCE_MODE: isFeatureEnabled("ENABLE_MAINTENANCE_MODE"),
  });
}

