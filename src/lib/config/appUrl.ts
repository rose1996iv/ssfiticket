/**
 * SSFI Lucky Draw — Environment-Aware Application URLs
 *
 * Guarantees that generated links and QR codes point to the SAME environment
 * and database that owns the record:
 * - Production environment -> https://ssfiticket.vercel.app
 * - Vercel Preview environment -> Preview deployment URL (VERCEL_BRANCH_URL or VERCEL_URL), NEVER Production
 * - Local development -> http://localhost:3000 (or custom request origin)
 */

export type AppUrlResolution = {
  baseUrl: string;
  isProduction: boolean;
  isPreview: boolean;
  isSafePreviewUrlAvailable: boolean;
  isInternalTestingOnly: boolean;
};

/**
 * Validates, trims, and normalizes a base URL string without trailing slashes.
 */
function normalizeUrl(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }
  return cleaned;
}

/**
 * Resolves the environment-accurate base URL with strict environment isolation.
 */
export function resolveEnvironmentAppUrl(requestOrigin?: string): AppUrlResolution {
  // 1. Explicit request origin if provided (e.g. from server request headers or tests)
  if (requestOrigin && requestOrigin.trim() !== "") {
    const isProd = /ssfiticket\.vercel\.app/i.test(requestOrigin);
    const isPrev = /vercel\.app/i.test(requestOrigin) && !isProd;
    return {
      baseUrl: normalizeUrl(requestOrigin),
      isProduction: isProd,
      isPreview: isPrev,
      isSafePreviewUrlAvailable: true,
      isInternalTestingOnly: isPrev,
    };
  }

  const isVercelProduction =
    process.env.VERCEL_ENV === "production" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "production";

  const isVercelPreview =
    process.env.VERCEL_ENV === "preview" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

  // 2. Production Environment: Canonical public production domain
  if (isVercelProduction) {
    const prodUrl =
      process.env.APP_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "https://ssfiticket.vercel.app");
    return {
      baseUrl: normalizeUrl(prodUrl),
      isProduction: true,
      isPreview: false,
      isSafePreviewUrlAvailable: true,
      isInternalTestingOnly: false,
    };
  }

  // 3. Vercel Preview Environment: Must point to the preview deployment, NEVER silently to Production!
  if (isVercelPreview) {
    // Prefer VERCEL_BRANCH_URL (stable branch deployment URL) then VERCEL_URL
    const previewCandidate =
      process.env.VERCEL_BRANCH_URL ||
      process.env.VERCEL_URL ||
      process.env.NEXT_PUBLIC_VERCEL_URL;

    // Use APP_BASE_URL only if explicitly configured for preview (not pointing to production)
    const envCandidate =
      process.env.APP_BASE_URL && !process.env.APP_BASE_URL.includes("ssfiticket.vercel.app")
        ? process.env.APP_BASE_URL
        : process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_APP_URL.includes("ssfiticket.vercel.app")
        ? process.env.NEXT_PUBLIC_APP_URL
        : null;

    const chosenPreview = envCandidate || (previewCandidate ? `https://${previewCandidate}` : null);

    if (chosenPreview) {
      return {
        baseUrl: normalizeUrl(chosenPreview),
        isProduction: false,
        isPreview: true,
        isSafePreviewUrlAvailable: true,
        isInternalTestingOnly: true,
      };
    }

    // If no preview URL candidate exists, NEVER silently fall back to production.
    return {
      baseUrl: "https://preview.ssfiticket.internal",
      isProduction: false,
      isPreview: true,
      isSafePreviewUrlAvailable: false,
      isInternalTestingOnly: true,
    };
  }

  // 4. Localhost development fallback
  const localUrl =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";

  return {
    baseUrl: normalizeUrl(localUrl),
    isProduction: false,
    isPreview: false,
    isSafePreviewUrlAvailable: true,
    isInternalTestingOnly: true,
  };
}

/**
 * Returns the environment-aware base URL for general navigation.
 */
export function getBaseAppUrl(
  requestOrigin?: string,
  options?: { forCustomerFacingLink?: boolean }
): string {
  void options;
  return resolveEnvironmentAppUrl(requestOrigin).baseUrl;
}

/**
 * Returns the exact public customer order status link.
 * Ensures the link targets the environment matching the database that owns the order.
 */
export function getCustomerOrderUrl(orderId: string, customOrigin?: string): string {
  const { baseUrl } = resolveEnvironmentAppUrl(customOrigin);
  return `${baseUrl}/buy/order/${encodeURIComponent(orderId)}`;
}
