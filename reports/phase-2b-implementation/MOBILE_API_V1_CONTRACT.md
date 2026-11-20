# SSFI Lucky Draw — Mobile API v1 Contract (`/api/mobile/v1/`)

**Version:** `v1`  
**Status:** Phase 2B.6 Authentication & Identity Foundation (Local Implementation — Not Deployed)  
**Target Client:** Flutter Android (`supabase_flutter` + `Dio` + `flutter_secure_storage`)  
**Authoritative Backend:** Next.js App Router (`/api/mobile/v1/*`) + Supabase Auth + PostgreSQL RBAC

---

## 1. Authentication Mechanism

1. Flutter authenticates users through **Supabase Auth** (`signInWithPassword` / PKCE session refresh) and stores tokens exclusively in hardware-backed `flutter_secure_storage`.
2. Every protected mobile API request MUST send:
   ```http
   Authorization: Bearer <supabase_access_token>
   ```
3. The Next.js backend extracts the Bearer token (`extractBearerToken`), verifies it server-side via `supabase.auth.getUser(token)` (never trusting unverified JWT payloads), checks `public.profiles.is_active`, and resolves authoritative roles strictly from PostgreSQL (`public.has_role` + `public.sellers.is_active` + `public.customers.profile_id`).
4. Client-supplied headers or claims such as `X-User-Role`, `X-User-Id`, or JWT `user_metadata` are **never** trusted as authorization truth.
5. Bearer tokens are never logged, persisted on the server, or echoed in responses.

---

## 2. Implemented Endpoint: `GET /api/mobile/v1/me`

Returns the authenticated user's minimal identity, account status, and authoritative roles.

### Request
```http
GET /api/mobile/v1/me HTTP/1.1
Authorization: Bearer <supabase_access_token>
Accept: application/json
```

### Success Response (`200 OK`)
Headers:
- `Content-Type: application/json`
- `Cache-Control: no-store, no-cache, must-revalidate`
- `X-Content-Type-Options: nosniff`

Body:
```json
{
  "apiVersion": "v1",
  "data": {
    "user": {
      "id": "66666666-6666-4666-8666-666666666602",
      "email": "admin@ssfi.org",
      "accountStatus": "ACTIVE"
    },
    "roles": ["ADMIN"],
    "primaryRole": "ADMIN",
    "customerProfileLinked": false
  }
}
```

### Role Resolution Rules
- **Fail-Closed Profile Check (`REV-2C-01`):** `public.profiles.is_active` MUST be strictly `true`. Missing (`null`) or inactive (`false`) profiles are rejected with `403 FORBIDDEN`.
- **Authoritative RBAC Roles (`roles`):** Strictly resolved from `public.roles` / `public.profile_roles` via `public.has_role`. Priority order for `primaryRole`: `SUPER_ADMIN` → `ADMIN` → `FUNDRAISING_MANAGER` → `SELLER`.
- **`SELLER`:** Requires `public.has_role(user.id, 'SELLER')` **and** an active row in `public.sellers` (`profile_id = user.id AND is_active = true`). Deactivated sellers with no staff role receive `403 FORBIDDEN`.
- **Customer Account Linkage (`customerProfileLinked`, `REV-2C-03`):** Tracked strictly as a separate boolean derived from `public.customers(profile_id = user.id)`. Customer linkage is **never** merged into `roles[]` and can never implicitly satisfy privileged RBAC checks (`requireMobileRoles`).
- **No Application Role:** Authenticated active users with no role in `profile_roles` receive `roles: []` and `primaryRole: null` (no automatic privilege escalation or fallback).

---

## 3. Standard Response & Error Semantics

### Success Envelope
```json
{
  "apiVersion": "v1",
  "data": {}
}
```

### Error Envelope (Sanitized — No Raw DB Details or Stack Traces)
```json
{
  "apiVersion": "v1",
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired authentication token."
  }
}
```

### HTTP Status Codes

| Status | Error Code | Meaning |
|---|---|---|
| `200` | — | Success |
| `400` | `BAD_REQUEST` | Invalid request parameters or malformed payload |
| `401` | `UNAUTHORIZED` | Missing, malformed, invalid, or expired Bearer token |
| `403` | `FORBIDDEN` | Authenticated user lacks required role, ownership, or active account status |
| `404` | `NOT_FOUND` | Requested resource not found (or not visible to caller) |
| `429` | `RATE_LIMITED` | Rate limit exceeded (`Retry-After` header included) |
| `500` | `INTERNAL_ERROR` | Safe generic server error (no DB messages or stack traces) |

---

## 4. Rate Limiting & Security Restrictions

- `GET /api/mobile/v1/me` enforces dual-layer scoped rate limiting (`checkScopedRateLimit`):
  - Pre-auth IP bucket: `60` requests / `300s` (prevents token brute-forcing).
  - Post-auth verified `user.id` bucket: `120` requests / `300s` (immune to spoofed IP headers).
- Service-role credentials are never sent to Flutter.
- All privileged mutations (payment verification, ticket issuance/void/reissue, seller management, email settings, lucky draw execution) remain strictly server-side behind Next.js `/api/mobile/v1/*` routes and `service_role` RPCs.

---

## 5. Future Endpoint Conventions (Deferred to Phase 2C+)

Planned versioned endpoints (`/dashboard`, `/orders`, `/tickets`, `/email-status`, `/members`, `/sellers`, `/payments`, `/notifications`) will follow:
- Cursor-based pagination (`?cursor=<opaque>&limit=20`, max `50`).
- `Idempotency-Key` header (UUIDv4) on mutating `POST` operations.
- Shared authorization via `authenticateMobileRequest` + `requireMobileRoles` + server-side object ownership verification.
