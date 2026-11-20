import { createClient } from "@supabase/supabase-js";
import { checkScopedRateLimit, getClientIpFromHeaders } from "../security/rateLimit.ts";

export const MOBILE_API_VERSION = "v1" as const;

/**
 * Authoritative RBAC roles backed strictly by `public.roles` / `public.profile_roles` / `public.has_role`.
 * Customer account linkage (`customers.profile_id`) is deliberately tracked separately via
 * `customerProfileLinked` so it can never implicitly grant RBAC privileges.
 */
export type MobileRbacRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "FUNDRAISING_MANAGER"
  | "SELLER";

export type MobileErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface MobileAuthenticatedUser {
  id: string;
  email: string | null;
  accountStatus: "ACTIVE";
  /** Authoritative database RBAC roles from public.profile_roles ONLY */
  roles: MobileRbacRole[];
  /** Highest-priority authoritative RBAC role, or null if no RBAC role assigned */
  primaryRole: MobileRbacRole | null;
  /** Separate non-RBAC classification: true only if linked to a row in public.customers(profile_id) */
  customerProfileLinked: boolean;
}

export type MobileAuthResult =
  | { ok: true; user: MobileAuthenticatedUser }
  | { ok: false; status: 401 | 403 | 500; code: MobileErrorCode; message: string };

export interface MobileAuthDependencies {
  verifyAccessToken: (
    token: string
  ) => Promise<{ user: { id: string; email?: string | null } | null; error?: string | null }>;
  resolveProfileActive: (userId: string) => Promise<boolean | null>;
  checkHasRole: (
    userId: string,
    role: MobileRbacRole
  ) => Promise<boolean>;
  hasCustomerProfile: (userId: string) => Promise<boolean>;
  hasActiveSellerProfile: (userId: string) => Promise<boolean>;
}

const JWT_STRUCTURE_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const RBAC_ROLE_PRIORITY: readonly MobileRbacRole[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "FUNDRAISING_MANAGER",
  "SELLER",
];

/**
 * Consistent JSON success response helper for `/api/mobile/v1/*`.
 */
export function mobileOk<T>(data: T, status: number = 200, extraHeaders?: Record<string, string>) {
  return Response.json(
    {
      apiVersion: MOBILE_API_VERSION,
      data,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
        ...(extraHeaders ?? {}),
      },
    }
  );
}

/**
 * Consistent sanitized JSON error response helper for `/api/mobile/v1/*`.
 * Never leaks raw database messages, stack traces, or tokens.
 */
export function mobileError(
  status: 400 | 401 | 403 | 404 | 429 | 500 | 503,
  code: MobileErrorCode,
  message: string,
  extraHeaders?: Record<string, string>
) {
  return Response.json(
    {
      apiVersion: MOBILE_API_VERSION,
      error: {
        code,
        message,
      },
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
        ...(extraHeaders ?? {}),
      },
    }
  );
}

/**
 * Extracts and validates the syntactic structure of an `Authorization: Bearer <jwt>` header.
 * Never logs or returns the token in error messages.
 */
export function extractBearerToken(
  headers: Headers | Record<string, string | string[] | undefined>
): string | null {
  let rawAuth: string | null = null;
  if (typeof (headers as Headers).get === "function") {
    rawAuth = (headers as Headers).get("authorization");
  } else {
    const rec = headers as Record<string, string | string[] | undefined>;
    const val = rec["authorization"] ?? rec["Authorization"];
    rawAuth = Array.isArray(val) ? val[0] ?? null : val ?? null;
  }

  if (!rawAuth) return null;
  const parts = rawAuth.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  if (parts[0].toLowerCase() !== "bearer") return null;

  const token = parts[1];
  if (!token || token.length < 20 || token.length > 8192) return null;
  if (!JWT_STRUCTURE_RE.test(token)) return null;

  return token;
}

/**
 * Default production/preview dependencies using Supabase Auth server-side verification
 * (`supabase.auth.getUser(token)`) and authoritative database RBAC (`public.has_role`).
 */
function createDefaultMobileAuthDeps(): MobileAuthDependencies {
  return {
    async verifyAccessToken(token: string) {
      const { getSupabasePublicConfig } = await import("../supabase/config");
      const { url, anonKey } = getSupabasePublicConfig();
      const supabase = createClient(url, anonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) {
        return { user: null, error: error?.message ?? "Invalid token" };
      }
      return {
        user: {
          id: data.user.id,
          email: data.user.email ?? null,
        },
      };
    },
    async resolveProfileActive(userId: string) {
      const { createSupabaseAdminClient } = await import("../supabase/admin");
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin
        .from("profiles")
        .select("is_active")
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        throw new Error("PROFILE_LOOKUP_FAILED");
      }
      return data ? data.is_active === true : null;
    },
    async checkHasRole(userId, role) {
      const { createSupabaseAdminClient } = await import("../supabase/admin");
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.rpc("has_role", {
        p_user_id: userId,
        p_role: role,
      });
      if (error) {
        throw new Error("ROLE_LOOKUP_FAILED");
      }
      return data === true;
    },
    async hasCustomerProfile(userId: string) {
      const { createSupabaseAdminClient } = await import("../supabase/admin");
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin
        .from("customers")
        .select("id")
        .eq("profile_id", userId)
        .maybeSingle();
      if (error) {
        throw new Error("CUSTOMER_LOOKUP_FAILED");
      }
      return Boolean(data?.id);
    },
    async hasActiveSellerProfile(userId: string) {
      const { createSupabaseAdminClient } = await import("../supabase/admin");
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin
        .from("sellers")
        .select("id, is_active")
        .eq("profile_id", userId)
        .maybeSingle();
      if (error) {
        throw new Error("SELLER_LOOKUP_FAILED");
      }
      return Boolean(data && data.is_active === true);
    },
  };
}

/**
 * Authenticates a mobile API request via `Authorization: Bearer <jwt>` and resolves:
 *   1. Profile activation strictly fail-closed (`profileActive === true` required)
 *   2. Authoritative database RBAC roles (`public.has_role` + `sellers.is_active`)
 *   3. Separate `customerProfileLinked` classification (never merged into RBAC `roles`)
 */
export async function authenticateMobileRequest(
  headers: Headers | Record<string, string | string[] | undefined>,
  deps?: MobileAuthDependencies
): Promise<MobileAuthResult> {
  const token = extractBearerToken(headers);
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Missing or malformed Bearer authentication token.",
    };
  }

  const resolvedDeps = deps ?? createDefaultMobileAuthDeps();

  let verifiedUser: { id: string; email?: string | null } | null = null;
  try {
    const verification = await resolvedDeps.verifyAccessToken(token);
    verifiedUser = verification.user;
  } catch {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Invalid or expired authentication token.",
    };
  }

  if (!verifiedUser || !verifiedUser.id) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Invalid or expired authentication token.",
    };
  }

  try {
    const [profileActive, isSuperAdmin, isAdmin, isManager, isSellerRole, hasCustomer] =
      await Promise.all([
        resolvedDeps.resolveProfileActive(verifiedUser.id),
        resolvedDeps.checkHasRole(verifiedUser.id, "SUPER_ADMIN"),
        resolvedDeps.checkHasRole(verifiedUser.id, "ADMIN"),
        resolvedDeps.checkHasRole(verifiedUser.id, "FUNDRAISING_MANAGER"),
        resolvedDeps.checkHasRole(verifiedUser.id, "SELLER"),
        resolvedDeps.hasCustomerProfile(verifiedUser.id),
      ]);

    // REV-2C-01: Strictly fail-closed if profile is missing (null) or inactive (false)
    if (profileActive !== true) {
      return {
        ok: false,
        status: 403,
        code: "FORBIDDEN",
        message: "Account profile is missing or inactive. Please contact an SSFI administrator.",
      };
    }

    const roles: MobileRbacRole[] = [];
    if (isSuperAdmin) roles.push("SUPER_ADMIN");
    if (isAdmin) roles.push("ADMIN");
    if (isManager) roles.push("FUNDRAISING_MANAGER");

    if (isSellerRole) {
      const sellerActive = await resolvedDeps.hasActiveSellerProfile(verifiedUser.id);
      if (sellerActive) {
        roles.push("SELLER");
      } else if (roles.length === 0) {
        return {
          ok: false,
          status: 403,
          code: "FORBIDDEN",
          message: "Seller account is deactivated. Please contact an SSFI administrator.",
        };
      }
    }

    const primaryRole = RBAC_ROLE_PRIORITY.find((r) => roles.includes(r)) ?? null;

    return {
      ok: true,
      user: {
        id: verifiedUser.id,
        email: verifiedUser.email ?? null,
        accountStatus: "ACTIVE",
        roles,
        primaryRole,
        customerProfileLinked: Boolean(hasCustomer),
      },
    };
  } catch {
    return {
      ok: false,
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Unable to verify account authorization at this time.",
    };
  }
}

/**
 * Enforces that an authenticated mobile user holds at least one of the required
 * authoritative RBAC roles (`public.profile_roles`). `customerProfileLinked` never
 * satisfies privileged RBAC checks.
 */
export function requireMobileRoles(
  user: MobileAuthenticatedUser,
  allowedRoles: readonly MobileRbacRole[]
): boolean {
  return allowedRoles.some((role) => user.roles.includes(role));
}

/**
 * Reusable handler for `GET /api/mobile/v1/me` so both the Next.js Route Handler
 * and isolated security tests exercise identical rate-limiting, Bearer JWT validation,
 * authoritative role resolution, and response sanitization.
 */
export async function handleMobileMeGet(
  request: { headers: Headers },
  deps?: MobileAuthDependencies
) {
  const clientIp = getClientIpFromHeaders(request.headers);

  // Pre-auth IP rate limit (trusted proxy IP; fail-closed in production if Redis unavailable)
  const ipRateLimit = await checkScopedRateLimit({
    scope: "mobile_me_ip",
    identifier: clientIp,
    maxAttempts: 60,
    windowSeconds: 300,
    failClosedIfUnavailable: true,
  });

  if (!ipRateLimit.allowed) {
    if (ipRateLimit.reason === "SERVICE_UNAVAILABLE") {
      return mobileError(
        503,
        "SERVICE_UNAVAILABLE",
        "Authentication service is temporarily unavailable. Please try again shortly.",
        { "Retry-After": String(ipRateLimit.retryAfterSeconds ?? 60) }
      );
    }
    return mobileError(
      429,
      "RATE_LIMITED",
      "Too many authentication requests. Please try again shortly.",
      { "Retry-After": String(ipRateLimit.retryAfterSeconds ?? 300) }
    );
  }

  const auth = await authenticateMobileRequest(request.headers, deps);
  if (!auth.ok) {
    return mobileError(auth.status, auth.code, auth.message);
  }

  // Per-user rate limit keyed on verified server-side user.id
  const userRateLimit = await checkScopedRateLimit({
    scope: "mobile_me_user",
    identifier: auth.user.id,
    maxAttempts: 120,
    windowSeconds: 300,
    failClosedIfUnavailable: true,
  });

  if (!userRateLimit.allowed) {
    if (userRateLimit.reason === "SERVICE_UNAVAILABLE") {
      return mobileError(
        503,
        "SERVICE_UNAVAILABLE",
        "Request rate limiting is temporarily unavailable. Please try again shortly.",
        { "Retry-After": String(userRateLimit.retryAfterSeconds ?? 60) }
      );
    }
    return mobileError(
      429,
      "RATE_LIMITED",
      "Request rate limit exceeded. Please try again shortly.",
      { "Retry-After": String(userRateLimit.retryAfterSeconds ?? 300) }
    );
  }

  // Return strictly safe, minimal identity payload (no secrets, no internal seller/customer UUIDs)
  return mobileOk({
    user: {
      id: auth.user.id,
      email: auth.user.email,
      accountStatus: auth.user.accountStatus,
    },
    roles: auth.user.roles,
    primaryRole: auth.user.primaryRole,
    customerProfileLinked: auth.user.customerProfileLinked,
  });
}
