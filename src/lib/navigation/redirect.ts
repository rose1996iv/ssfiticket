/**
 * Safely determines if an error thrown during a server action or navigation is a Next.js redirect.
 *
 * In Next.js:
 * - In development & test: err.message is "NEXT_REDIRECT" and/or digest starts with "NEXT_REDIRECT"
 * - In production: err.digest is a string starting with "NEXT_REDIRECT" (e.g. "NEXT_REDIRECT;replace;...;307;")
 *
 * CRITICAL: In Next.js production builds, ALL server action errors passed back to the client
 * have an internal cryptographic "digest" property attached (e.g. { digest: "1284920485" }).
 * Checking `"digest" in err` causes normal server validation errors to be mistaken for redirects
 * and re-thrown, crashing the client into Next.js GlobalError / error.tsx instead of displaying
 * friendly user error messages.
 */
export function isNextRedirectError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  if ("message" in err && (err as { message?: unknown }).message === "NEXT_REDIRECT") {
    return true;
  }

  if ("digest" in err && typeof (err as { digest?: unknown }).digest === "string") {
    return (err as { digest: string }).digest.startsWith("NEXT_REDIRECT");
  }

  return false;
}
