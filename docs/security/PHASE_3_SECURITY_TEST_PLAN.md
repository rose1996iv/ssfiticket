# SSFI Lucky Draw — Phase 3: P0/P1 Security Test Plan & Specification

**Document Status:** `DESIGN AND TEST SPECIFICATION ONLY — AWAITING OWNER APPROVAL`  
**Prepared At:** `2026-11-07T17:09:00+05:30` (`2026-11-07T11:39:00Z`)  
**Target Test Runner:** Vitest (`npm test`) — Offline / Mocked + Local Disposable PostgreSQL Verification  
**Production & Preview Safety:** All tests run offline in Vitest or against a local disposable PostgreSQL instance (`localhost:54322`); zero mutations against Preview (`jiyuiydzsfydjklosvvq`) or Production (`fohpqheglxhfdecadhzw`).

---

## 1. Required Security Test Matrix (Customer Payment Page & Role Boundaries)

| Test ID | Scenario | Actor / Input | Expected Authorization Result | Expected Data / UI Exposure |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | **Anonymous Access (UUID Only)** | Unauthenticated request to `/buy/order/<orderA_uuid>` with no cookie and no `?t=` parameter | `authorized: false` (`MISSING_TOKEN`) | **Zero exposure:** `snapshot_upi_id`, `snapshot_account_name`, `snapshot_qr_storage_path`, signed QR URL, and customer PII are **never** queried or rendered. Uniform verification-required notice returned. |
| **SEC-02** | **Unauthorized Customer Access** | Customer B visits `/buy/order/<orderA_uuid>` without Customer A's token (or with an arbitrary guessed token) | `authorized: false` (`UNAUTHORIZED`) | **Zero exposure:** Identical response to SEC-01 and non-existent UUIDs (prevents order UUID enumeration and cross-customer access). |
| **SEC-03** | **Correct Customer Access (`PENDING_PAYMENT`)** | Customer A visits `/buy/order/<orderA_uuid>` with valid 64-char hex token in `ssfi_order_access_<orderA_uuid>` cookie or `?t=<tokenA>` | `authorized: true` (`scope: "CUSTOMER_TOKEN"`) | Renders `CustomerPaymentJourney` withOrder A's immutable seller snapshot (`snapshot_upi_id`, `snapshot_account_name`, 5-min signed QR URL) and `PaymentDetailsForm`. |
| **SEC-04** | **Expired Token** | Customer A visits `/buy/order/<orderA_uuid>?t=<expiredTokenA>` where `expires_at <= now()` | `authorized: false` (`TOKEN_EXPIRED`) | **Zero exposure:** `snapshot_upi_id` and seller QR are **not** fetched or rendered. Displays link-expired recovery prompt. |
| **SEC-05** | **Invalid / Malformed / Revoked Token** | Request with non-hex token, length `<> 64`, unknown SHA-256 hash, or `revoked_at IS NOT NULL` | `authorized: false` (`INVALID_FORMAT` / `TOKEN_REVOKED`) | **Zero exposure:** Blocked before DB order query; sliding-window rate limiter blocks after `20` attempts per `5` minutes (`RATE_LIMITED`). |
| **SEC-06** | **Cross-Order Token Reuse** | Customer B holds a valid, active token `<tokenB>` for `orderB_uuid` and requests `/buy/order/<orderA_uuid>?t=<tokenB>` | `authorized: false` (`UNAUTHORIZED`) | **Zero exposure:** `verify_order_payment_access(p_order_id, p_token_hash)` enforces `WHERE order_id = p_order_id AND token_hash = p_token_hash`. Token B cannot unlock Order A. |
| **SEC-07** | **`VOID` / `CANCELLED` / `REFUNDED` Order** | Customer A holds a valid token `<tokenA>` for `orderA_uuid`, but `orders.status` is `VOID`, `CANCELLED`, or `REFUNDED` | `authorized: false` (`ORDER_INACTIVE`) | **Zero payment destination exposure:** `CustomerPaymentJourney`, `snapshot_upi_id`, and signed QR URL are never rendered; `submitPublicUpiPayment` rejects submission. |
| **SEC-08** | **Already Submitted / Verified Payment** | Customer A holds a valid token `<tokenA>` for `orderA_uuid` where `orders.status` is `PAYMENT_SUBMITTED` or `TICKETS_ISSUED` | `authorized: true` (`order_status: "PAYMENT_SUBMITTED"` / `"TICKETS_ISSUED"`) | **Payment destination suppressed:** `isPending || isRejected` is `false`, so `CustomerPaymentJourney` (`snapshot_upi_id`, `upiIntentUri`, `dynamicQrDataUrl`, seller QR) is **not** rendered. Only status/tickets are shown; `submitPublicUpiPayment` blocks duplicate submission on `PAYMENT_SUBMITTED`. |
| **SEC-09** | **Seller & Admin Access Boundaries** | 1. `SELLER-007` accessing own `ORD-2026-000041`<br>2. `SELLER-002` accessing `SELLER-007`'s `ORD-2026-000041`<br>3. `ADMIN` / `FUNDRAISING_MANAGER` / `SUPER_ADMIN` | 1. Allowed (`scope: "SELLER"`)<br>2. **Denied (`CROSS_SELLER_FORBIDDEN` / `404`)**<br>3. Allowed (`scope: "STAFF"`) | 1. Owning seller sees own order on `/seller/orders/[orderId]/payment`.<br>2. Cross-seller request returns `404 Not Found` (zero leakage).<br>3. Staff can review payments; only `SUPER_ADMIN` can download payment screenshots (`AdminPaymentScreenshot` `canDownload=true`). |

---

## 2. Reference Vitest Suite (`tests/orderPaymentAuthorization.test.ts` — Proposed)

When approved for implementation, the following self-contained Vitest suite will be added to `tests/orderPaymentAuthorization.test.ts` and executed via `npx vitest run`:

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import crypto from "node:crypto";
import {
  generateSecureRecoveryToken,
  hashRecoveryToken,
  isValidTokenFormat,
} from "../src/lib/payment/recoveryToken";

type OrderStatus =
  | "PENDING_PAYMENT"
  | "PAYMENT_SUBMITTED"
  | "PAYMENT_VERIFIED"
  | "TICKETS_ISSUED"
  | "CANCELLED"
  | "REFUNDED"
  | "VOID";

type ActorRole = "ANON" | "CUSTOMER" | "SELLER" | "FUNDRAISING_MANAGER" | "ADMIN" | "SUPER_ADMIN";

interface MockOrder {
  id: string;
  order_number: string;
  status: OrderStatus;
  seller_id: string;
  snapshot_seller_id: string;
  snapshot_upi_id: string;
  snapshot_account_name: string;
  snapshot_qr_storage_path: string;
}

interface MockTokenRecord {
  id: string;
  order_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

/**
 * Pure reference evaluator mirroring authorizeOrderAccess + verify_order_payment_access
 */
function evaluateOrderPaymentPageAccess(params: {
  requestedOrderId: string;
  candidateRawToken?: string | null;
  actorRole: ActorRole;
  actorSellerId?: string | null;
  ordersById: Map<string, MockOrder>;
  tokens: MockTokenRecord[];
  nowMs?: number;
}): {
  authorized: boolean;
  code: string;
  exposePaymentDestination: boolean;
  exposedUpiId: string | null;
} {
  const now = params.nowMs ?? Date.now();
  const order = params.ordersById.get(params.requestedOrderId);

  // 1. Staff Role Check
  if (
    params.actorRole === "SUPER_ADMIN" ||
    params.actorRole === "ADMIN" ||
    params.actorRole === "FUNDRAISING_MANAGER"
  ) {
    if (!order) {
      return { authorized: false, code: "NOT_FOUND", exposePaymentDestination: false, exposedUpiId: null };
    }
    const canPay = order.status === "PENDING_PAYMENT";
    return {
      authorized: true,
      code: "AUTHORIZED_STAFF",
      exposePaymentDestination: canPay,
      exposedUpiId: canPay ? order.snapshot_upi_id : null,
    };
  }

  // 2. Seller Role Check (Strict Seller Ownership Boundary)
  if (params.actorRole === "SELLER") {
    if (
      !order ||
      !params.actorSellerId ||
      (order.seller_id !== params.actorSellerId && order.snapshot_seller_id !== params.actorSellerId)
    ) {
      return {
        authorized: false,
        code: "CROSS_SELLER_FORBIDDEN",
        exposePaymentDestination: false,
        exposedUpiId: null,
      };
    }
    const canPay = order.status === "PENDING_PAYMENT";
    return {
      authorized: true,
      code: "AUTHORIZED_SELLER",
      exposePaymentDestination: canPay,
      exposedUpiId: canPay ? order.snapshot_upi_id : null,
    };
  }

  // 3. Public / Customer Capability Token Check (UUID alone NEVER authorizes)
  const rawToken = (params.candidateRawToken ?? "").trim();
  if (!isValidTokenFormat(rawToken)) {
    return { authorized: false, code: "UNAUTHORIZED", exposePaymentDestination: false, exposedUpiId: null };
  }

  const tokenHash = hashRecoveryToken(rawToken);
  const matchedToken = params.tokens.find(
    (t) => t.order_id === params.requestedOrderId && t.token_hash === tokenHash
  );

  if (!matchedToken || !order) {
    // Uniform response prevents distinguishing invalid token from cross-order token or missing order
    return { authorized: false, code: "UNAUTHORIZED", exposePaymentDestination: false, exposedUpiId: null };
  }

  if (matchedToken.revoked_at !== null) {
    return { authorized: false, code: "TOKEN_REVOKED", exposePaymentDestination: false, exposedUpiId: null };
  }

  if (new Date(matchedToken.expires_at).getTime() <= now) {
    return { authorized: false, code: "TOKEN_EXPIRED", exposePaymentDestination: false, exposedUpiId: null };
  }

  if (order.status === "CANCELLED" || order.status === "REFUNDED" || order.status === "VOID") {
    return { authorized: false, code: "ORDER_INACTIVE", exposePaymentDestination: false, exposedUpiId: null };
  }

  // Payment destination (UPI ID & QR) is ONLY exposed when order is awaiting payment
  const exposeDestination = order.status === "PENDING_PAYMENT";
  return {
    authorized: true,
    code: "AUTHORIZED_CUSTOMER_TOKEN",
    exposePaymentDestination: exposeDestination,
    exposedUpiId: exposeDestination ? order.snapshot_upi_id : null,
  };
}

describe("P0 Customer Payment Page Authorization & Role Boundaries", () => {
  const orderAId = "11111111-1111-4111-8111-111111111111";
  const orderBId = "22222222-2222-4222-8222-222222222222";
  const seller007Id = "edebd069-4bea-4f69-8afd-f34743def4ab";
  const seller002Id = "fd10bd88-db31-4270-b4d0-ffe3c1ef9204";

  let tokenARaw: string;
  let tokenBRaw: string;
  let ordersById: Map<string, MockOrder>;
  let tokens: MockTokenRecord[];

  beforeEach(() => {
    tokenARaw = generateSecureRecoveryToken();
    tokenBRaw = generateSecureRecoveryToken();

    ordersById = new Map([
      [
        orderAId,
        {
          id: orderAId,
          order_number: "ORD-2026-000041",
          status: "PENDING_PAYMENT",
          seller_id: seller007Id,
          snapshot_seller_id: seller007Id,
          snapshot_upi_id: "preview.seller007@upi",
          snapshot_account_name: "[PREVIEW TEST] SELLER-007 Account",
          snapshot_qr_storage_path: "seller-edebd069-4bea-4f69-8afd-f34743def4ab/preview-synthetic-qr-seller007.png",
        },
      ],
      [
        orderBId,
        {
          id: orderBId,
          order_number: "ORD-2026-000042",
          status: "PENDING_PAYMENT",
          seller_id: seller002Id,
          snapshot_seller_id: seller002Id,
          snapshot_upi_id: "preview.seller002@upi",
          snapshot_account_name: "[PREVIEW TEST] SELLER-002 Account",
          snapshot_qr_storage_path: "seller-fd10bd88-db31-4270-b4d0-ffe3c1ef9204/preview-synthetic-qr-seller002.png",
        },
      ],
    ]);

    tokens = [
      {
        id: crypto.randomUUID(),
        order_id: orderAId,
        token_hash: hashRecoveryToken(tokenARaw),
        expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
        revoked_at: null,
      },
      {
        id: crypto.randomUUID(),
        order_id: orderBId,
        token_hash: hashRecoveryToken(tokenBRaw),
        expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
        revoked_at: null,
      },
    ];
  });

  it("SEC-01: denies anonymous access when only order UUID is provided", () => {
    const res = evaluateOrderPaymentPageAccess({
      requestedOrderId: orderAId,
      candidateRawToken: null,
      actorRole: "ANON",
      ordersById,
      tokens,
    });
    expect(res.authorized).toBe(false);
    expect(res.exposePaymentDestination).toBe(false);
    expect(res.exposedUpiId).toBeNull();
  });

  it("SEC-02: denies unauthorized customer access without a valid token", () => {
    const randomToken = generateSecureRecoveryToken();
    const res = evaluateOrderPaymentPageAccess({
      requestedOrderId: orderAId,
      candidateRawToken: randomToken,
      actorRole: "CUSTOMER",
      ordersById,
      tokens,
    });
    expect(res.authorized).toBe(false);
    expect(res.code).toBe("UNAUTHORIZED");
    expect(res.exposedUpiId).toBeNull();
  });

  it("SEC-03: allows legitimate customer access with matching active order token", () => {
    const res = evaluateOrderPaymentPageAccess({
      requestedOrderId: orderAId,
      candidateRawToken: tokenARaw,
      actorRole: "CUSTOMER",
      ordersById,
      tokens,
    });
    expect(res.authorized).toBe(true);
    expect(res.exposePaymentDestination).toBe(true);
    expect(res.exposedUpiId).toBe("preview.seller007@upi");
  });

  it("SEC-04: denies access when customer token is expired", () => {
    tokens[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const res = evaluateOrderPaymentPageAccess({
      requestedOrderId: orderAId,
      candidateRawToken: tokenARaw,
      actorRole: "CUSTOMER",
      ordersById,
      tokens,
    });
    expect(res.authorized).toBe(false);
    expect(res.code).toBe("TOKEN_EXPIRED");
    expect(res.exposedUpiId).toBeNull();
  });

  it("SEC-05: denies access when token is malformed or revoked", () => {
    const malformed = evaluateOrderPaymentPageAccess({
      requestedOrderId: orderAId,
      candidateRawToken: "not-a-64-char-hex-token",
      actorRole: "CUSTOMER",
      ordersById,
      tokens,
    });
    expect(malformed.authorized).toBe(false);

    tokens[0].revoked_at = new Date().toISOString();
    const revoked = evaluateOrderPaymentPageAccess({
      requestedOrderId: orderAId,
      candidateRawToken: tokenARaw,
      actorRole: "CUSTOMER",
      ordersById,
      tokens,
    });
    expect(revoked.authorized).toBe(false);
    expect(revoked.code).toBe("TOKEN_REVOKED");
  });

  it("SEC-06: blocks cross-order token reuse (Order B token used on Order A)", () => {
    const res = evaluateOrderPaymentPageAccess({
      requestedOrderId: orderAId,
      candidateRawToken: tokenBRaw,
      actorRole: "CUSTOMER",
      ordersById,
      tokens,
    });
    expect(res.authorized).toBe(false);
    expect(res.code).toBe("UNAUTHORIZED");
    expect(res.exposedUpiId).toBeNull();
  });

  it("SEC-07: blocks payment destination exposure on VOID / CANCELLED / REFUNDED orders", () => {
    ordersById.get(orderAId)!.status = "VOID";
    const res = evaluateOrderPaymentPageAccess({
      requestedOrderId: orderAId,
      candidateRawToken: tokenARaw,
      actorRole: "CUSTOMER",
      ordersById,
      tokens,
    });
    expect(res.authorized).toBe(false);
    expect(res.code).toBe("ORDER_INACTIVE");
    expect(res.exposePaymentDestination).toBe(false);
    expect(res.exposedUpiId).toBeNull();
  });

  it("SEC-08: suppresses payment destination exposure when payment is already SUBMITTED or TICKETS_ISSUED", () => {
    ordersById.get(orderAId)!.status = "PAYMENT_SUBMITTED";
    const res = evaluateOrderPaymentPageAccess({
      requestedOrderId: orderAId,
      candidateRawToken: tokenARaw,
      actorRole: "CUSTOMER",
      ordersById,
      tokens,
    });
    expect(res.authorized).toBe(true);
    expect(res.exposePaymentDestination).toBe(false);
    expect(res.exposedUpiId).toBeNull();
  });

  it("SEC-09: enforces Seller ownership boundaries and allows Staff review", () => {
    const ownSeller = evaluateOrderPaymentPageAccess({
      requestedOrderId: orderAId,
      actorRole: "SELLER",
      actorSellerId: seller007Id,
      ordersById,
      tokens,
    });
    expect(ownSeller.authorized).toBe(true);

    const otherSeller = evaluateOrderPaymentPageAccess({
      requestedOrderId: orderAId,
      actorRole: "SELLER",
      actorSellerId: seller002Id,
      ordersById,
      tokens,
    });
    expect(otherSeller.authorized).toBe(false);
    expect(otherSeller.code).toBe("CROSS_SELLER_FORBIDDEN");
    expect(otherSeller.exposedUpiId).toBeNull();
  });
});
```

---

## 3. Database-Level Trigger & RLS Verification Checks (Post-Approval Only)

Once approved by the Project Owner and applied to a local disposable PostgreSQL instance (or Preview `jiyuiydzsfydjklosvvq`), the following SQL assertions verify database-level enforcement:

1. **Direct Update to `orders.snapshot_upi_id` Without Sanitization RPC Fails:**
   ```sql
   -- Must raise: 'Order payment destination snapshot is immutable and cannot be modified.'
   UPDATE public.orders
   SET snapshot_upi_id = 'tampered@upi'
   WHERE order_number = 'ORD-2026-000031';
   ```
2. **Re-Running Sanitization on Already-Synthetic `preview.*@upi` Orders Updates `0` Rows:**
   - Because `protect_order_payment_snapshot()` requires `OLD.snapshot_upi_id NOT LIKE 'preview.%@upi'`, even `admin_sanitize_preview_historical_order_snapshots` cannot alter a snapshot once it holds a `preview.*@upi` address.
3. **Anonymous (`anon`) Reads on `public.campaigns` and `public.prizes` Succeed Without Calling `public.is_staff(uuid)`:**
   ```sql
   SET LOCAL ROLE anon;
   SELECT id, status FROM public.campaigns; -- Returns only ACTIVE campaign (0 permission errors)
   SELECT id, title FROM public.prizes;     -- Returns 5 prizes for ACTIVE campaign (0 permission errors)
   SELECT public.is_staff('00000000-0000-0000-0000-000000000000'); -- Must FAIL with 42501 permission denied
   ```

