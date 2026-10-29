/**
 * Resolves the canonical base application URL for SSFI Lucky Draw.
 * Automatically handles local development, Vercel deployments, custom domain,
 * and ensures no trailing slashes or malformed URLs.
 */
export function getBaseAppUrl(requestOrigin?: string): string {
  // 1. Explicit request origin if provided (e.g. from request headers or browser)
  if (requestOrigin && requestOrigin.trim() !== "") {
    return requestOrigin.trim().replace(/\/+$/, "");
  }

  // 2. In Vercel Preview, dynamically resolve to the preview deployment URL
  const isPreview =
    process.env.VERCEL_ENV === "preview" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
  const previewUrl = process.env.VERCEL_URL || process.env.NEXT_PUBLIC_VERCEL_URL;
  if (isPreview && previewUrl && previewUrl.trim() !== "") {
    return `https://${previewUrl.trim()}`.replace(/\/+$/, "");
  }

  // 3. Explicit public environment variable
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl && envUrl.trim() !== "") {
    return envUrl.trim().replace(/\/+$/, "");
  }

  // 4. Vercel deployment system environment variables
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`.replace(/\/+$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.replace(/\/+$/, "");
  }

  // 5. Default production URL
  return "https://ssfiticket.vercel.app";
}
