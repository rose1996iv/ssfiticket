/**
 * Next.js Deployment ID & Version Skew Protection
 *
 * Rules:
 * 1. Prefer VERCEL_DEPLOYMENT_ID (system-provided by Vercel at build time and runtime).
 * 2. Fall back to VERCEL_GIT_COMMIT_SHA, GITHUB_SHA, or NEXT_DEPLOYMENT_ID.
 * 3. Validation:
 *    - Must NOT begin with 'dpl_'.
 *    - Must be no longer than 32 characters.
 *    - Must be unique between deployments.
 *    - Must be identical across client bundle and server configuration.
 * 4. Safe fallback for local development (undefined) to keep HMR/Fast Refresh functioning.
 */

export function resolveDeploymentId(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.NODE_ENV === "development") {
    return undefined;
  }

  // 1. Prefer Vercel system-provided deployment ID
  const raw =
    env.VERCEL_DEPLOYMENT_ID ||
    env.VERCEL_GIT_COMMIT_SHA ||
    env.GITHUB_SHA ||
    env.GIT_COMMIT_SHA ||
    env.NEXT_DEPLOYMENT_ID;

  if (!raw || raw.trim() === "") {
    return env.NODE_ENV === "production" ? "local-prod-build" : undefined;
  }

  let id = raw.trim();

  // Strip 'dpl_' prefix if present
  if (id.startsWith("dpl_")) {
    id = id.slice(4);
  }

  // Ensure length is <= 32 characters
  if (id.length > 32) {
    id = id.slice(0, 32);
  }

  // Sanitize: alphanumeric, dashes, and underscores only
  id = id.replace(/[^a-zA-Z0-9_-]/g, "");

  if (id.length === 0) {
    return env.NODE_ENV === "production" ? "prod-build" : undefined;
  }

  return id;
}
