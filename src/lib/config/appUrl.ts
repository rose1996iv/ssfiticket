/**
 * Resolves the canonical base application URL for SSFI Lucky Draw.
 * Automatically handles local development, Vercel deployments, custom domain,
 * and ensures no trailing slashes or malformed URLs.
 */
export function getBaseAppUrl(requestOrigin?: string): string {
  // 1. Explicit request origin if provided (e.g. from request headers)
  if (requestOrigin && requestOrigin.trim() !== "") {
    return requestOrigin.trim().replace(/\/+$/, "");
  }

  // 2. Explicit public environment variable
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl && envUrl.trim() !== "") {
    return envUrl.trim().replace(/\/+$/, "");
  }

  // 3. Vercel deployment system environment variables
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`.replace(/\/+$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.replace(/\/+$/, "");
  }

  // 4. Default production URL
  return "https://ssfiticket.vercel.app";
}
