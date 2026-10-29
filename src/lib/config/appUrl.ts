/**
 * Resolves the canonical base application URL for SSFI Lucky Draw.
 * Automatically handles local development, Vercel deployments, custom domains,
 * and ensures no trailing slashes or malformed URLs.
 */

type AppUrlOptions = {
  /**
   * If true, guarantees the link will resolve to the canonical public production domain
   * (or configured APP_BASE_URL), preventing any accidental exposure of private,
   * authentication-protected Vercel Preview deployment URLs to real customers.
   */
  forCustomerFacingLink?: boolean;
};

/**
 * Validates, trims, and normalizes a base URL string.
 */
function normalizeUrl(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }
  return cleaned;
}

export function getBaseAppUrl(
  requestOrigin?: string,
  options?: AppUrlOptions
): string {
  // 1. Explicit request origin if provided (e.g. from request headers or test runners)
  if (requestOrigin && requestOrigin.trim() !== "") {
    return normalizeUrl(requestOrigin);
  }

  // 2. Explicit server-side or public environment variables (highest priority configuration)
  const explicitEnvUrl =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL;

  if (explicitEnvUrl && explicitEnvUrl.trim() !== "") {
    return normalizeUrl(explicitEnvUrl);
  }

  // 3. Environment classification
  const isVercelProduction =
    process.env.VERCEL_ENV === "production" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "production";

  const isVercelPreview =
    process.env.VERCEL_ENV === "preview" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

  // 4. Production or Customer-Facing Links:
  // Customer links must ALWAYS use the public production domain (https://ssfiticket.vercel.app)
  // so external supporters never encounter Vercel Deployment Protection auth barriers.
  if (isVercelProduction || options?.forCustomerFacingLink) {
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
      return normalizeUrl(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
    }
    return "https://ssfiticket.vercel.app";
  }

  // 5. Vercel Preview internal navigation (only for internal staff/dev preview browsing)
  if (isVercelPreview) {
    const previewUrl = process.env.VERCEL_URL || process.env.NEXT_PUBLIC_VERCEL_URL;
    if (previewUrl && previewUrl.trim() !== "") {
      return normalizeUrl(`https://${previewUrl}`);
    }
  }

  // 6. Localhost development fallback
  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3000";
  }

  // 7. Default canonical production domain fallback
  return "https://ssfiticket.vercel.app";
}

/**
 * Returns the exact public customer order status link.
 * Ensures that customer links always resolve to the public production domain
 * (https://ssfiticket.vercel.app) and never to a private, password-protected Preview URL.
 */
export function getCustomerOrderUrl(orderId: string, customOrigin?: string): string {
  const base = getBaseAppUrl(customOrigin, { forCustomerFacingLink: true });
  return `${base}/buy/order/${encodeURIComponent(orderId)}`;
}
