import test from "node:test";
import assert from "node:assert/strict";
import { isNextRedirectError } from "../src/lib/navigation/redirect.ts";

type CampaignState = {
  id: string;
  public_id: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "CLOSED" | "ARCHIVED";
  total_ticket_limit: number;
  sold_ticket_count: number;
};

type SellerState = {
  id: string;
  seller_code: string;
  is_active: boolean;
};

/**
 * Pure simulation of the server-side campaign & seller order validation guard.
 */
function validatePublicOrderPreconditions(
  seller: SellerState | null,
  campaign: CampaignState | null,
  quantity: number
): { allowed: boolean; error?: string } {
  // 1. Seller referral check
  if (!seller) {
    return { allowed: false, error: "Referral code was not found." };
  }
  if (!seller.is_active) {
    return { allowed: false, error: "The seller associated with this code is currently inactive." };
  }

  // 2. Campaign configuration check
  if (!campaign) {
    return { allowed: false, error: "Fundraising campaign configuration was not found." };
  }

  // 3. Campaign status check
  if (campaign.status !== "ACTIVE") {
    if (campaign.status === "PAUSED") {
      return { allowed: false, error: "Ticket sales are temporarily paused. Please check back shortly." };
    }
    if (campaign.status === "DRAFT") {
      return { allowed: false, error: "Ticket sales have not officially opened yet. This campaign is currently in preview." };
    }
    if (campaign.status === "CLOSED" || campaign.status === "ARCHIVED") {
      return { allowed: false, error: "Ticket sales for this lucky draw have ended." };
    }
    return { allowed: false, error: `Ticket sales are currently not active (campaign status: ${campaign.status}).` };
  }

  // 4. Capacity check
  const remaining = Math.max(0, campaign.total_ticket_limit - campaign.sold_ticket_count);
  if (quantity < 1 || quantity > remaining) {
    return { allowed: false, error: `Sorry, the requested quantity (${quantity}) exceeds remaining campaign capacity (${remaining} tickets available).` };
  }

  return { allowed: true };
}

/**
 * Pure simulation of ticket issuance invariant guard.
 */
function evaluateTicketIssuanceSafety(
  campaignStatus: string,
  paymentStatus: string,
  isTestOrder: boolean
): { canIssue: boolean; reason?: string } {
  if (isTestOrder) {
    return { canIssue: false, reason: "Test orders must never trigger ticket generation." };
  }
  if (campaignStatus !== "ACTIVE") {
    return { canIssue: false, reason: "Tickets can only be issued for ACTIVE campaigns." };
  }
  if (paymentStatus !== "VERIFIED") {
    return { canIssue: false, reason: "Payment must be verified before tickets can be issued." };
  }
  return { canIssue: true };
}

test("Inactive campaign states (DRAFT, PAUSED, CLOSED, ARCHIVED) strictly block order placement", () => {
  const activeSeller: SellerState = { id: "s-1", seller_code: "SELLER-007", is_active: true };

  // DRAFT status
  const draftCampaign: CampaignState = {
    id: "c-1",
    public_id: "ssfi-fundraising-lucky-draw",
    status: "DRAFT",
    total_ticket_limit: 1000,
    sold_ticket_count: 0,
  };
  const draftRes = validatePublicOrderPreconditions(activeSeller, draftCampaign, 2);
  assert.equal(draftRes.allowed, false);
  assert.ok(draftRes.error?.includes("preview") || draftRes.error?.includes("draft"));

  // PAUSED status
  const pausedCampaign: CampaignState = { ...draftCampaign, status: "PAUSED" };
  const pausedRes = validatePublicOrderPreconditions(activeSeller, pausedCampaign, 2);
  assert.equal(pausedRes.allowed, false);
  assert.ok(pausedRes.error?.includes("paused"));

  // CLOSED status
  const closedCampaign: CampaignState = { ...draftCampaign, status: "CLOSED" };
  const closedRes = validatePublicOrderPreconditions(activeSeller, closedCampaign, 2);
  assert.equal(closedRes.allowed, false);
  assert.ok(closedRes.error?.includes("ended"));

  // ARCHIVED status
  const archivedCampaign: CampaignState = { ...draftCampaign, status: "ARCHIVED" };
  const archivedRes = validatePublicOrderPreconditions(activeSeller, archivedCampaign, 2);
  assert.equal(archivedRes.allowed, false);
  assert.ok(archivedRes.error?.includes("ended"));
});

test("Active campaign with active seller and available capacity permits order placement", () => {
  const activeSeller: SellerState = { id: "s-1", seller_code: "SELLER-007", is_active: true };
  const activeCampaign: CampaignState = {
    id: "c-1",
    public_id: "ssfi-fundraising-lucky-draw",
    status: "ACTIVE",
    total_ticket_limit: 1000,
    sold_ticket_count: 200,
  };

  const res = validatePublicOrderPreconditions(activeSeller, activeCampaign, 5);
  assert.equal(res.allowed, true);
  assert.equal(res.error, undefined);
});

test("Capacity overflow is accurately rejected with remaining ticket count", () => {
  const activeSeller: SellerState = { id: "s-1", seller_code: "SELLER-007", is_active: true };
  const nearFullCampaign: CampaignState = {
    id: "c-1",
    public_id: "ssfi-fundraising-lucky-draw",
    status: "ACTIVE",
    total_ticket_limit: 1000,
    sold_ticket_count: 998,
  };

  // Remaining is 2, requesting 5
  const res = validatePublicOrderPreconditions(activeSeller, nearFullCampaign, 5);
  assert.equal(res.allowed, false);
  assert.ok(res.error?.includes("exceeds remaining campaign capacity"));
  assert.ok(res.error?.includes("2 tickets available"));
});

test("Missing campaign configuration returns distinct configuration error", () => {
  const activeSeller: SellerState = { id: "s-1", seller_code: "SELLER-007", is_active: true };
  const res = validatePublicOrderPreconditions(activeSeller, null, 1);
  assert.equal(res.allowed, false);
  assert.equal(res.error, "Fundraising campaign configuration was not found.");
});

test("Invalid and inactive seller referrals are blocked before campaign evaluation", () => {
  const activeCampaign: CampaignState = {
    id: "c-1",
    public_id: "ssfi-fundraising-lucky-draw",
    status: "ACTIVE",
    total_ticket_limit: 1000,
    sold_ticket_count: 0,
  };

  // Missing seller
  const resMissing = validatePublicOrderPreconditions(null, activeCampaign, 1);
  assert.equal(resMissing.allowed, false);
  assert.equal(resMissing.error, "Referral code was not found.");

  // Inactive seller
  const inactiveSeller: SellerState = { id: "s-2", seller_code: "SELLER-002", is_active: false };
  const resInactive = validatePublicOrderPreconditions(inactiveSeller, activeCampaign, 1);
  assert.equal(resInactive.allowed, false);
  assert.ok(resInactive.error?.includes("inactive"));
});

test("Test order flow isolation: test orders must never generate official tickets", () => {
  // Test order with verified payment
  const res1 = evaluateTicketIssuanceSafety("ACTIVE", "VERIFIED", true);
  assert.equal(res1.canIssue, false);
  assert.ok(res1.reason?.includes("Test orders must never trigger ticket generation"));

  // Real order in DRAFT campaign with verified payment
  const res2 = evaluateTicketIssuanceSafety("DRAFT", "VERIFIED", false);
  assert.equal(res2.canIssue, false);
  assert.ok(res2.reason?.includes("ACTIVE campaigns"));

  // Real order with SUBMITTED (unverified) payment
  const res3 = evaluateTicketIssuanceSafety("ACTIVE", "SUBMITTED", false);
  assert.equal(res3.canIssue, false);
  assert.ok(res3.reason?.includes("Payment must be verified"));

  // Valid real order with verified payment in ACTIVE campaign
  const res4 = evaluateTicketIssuanceSafety("ACTIVE", "VERIFIED", false);
  assert.equal(res4.canIssue, true);
});

test("Error classification distinguishes root causes without generic not-found collision", () => {
  function classifyOrderError(rpcError: { code?: string; message: string }): string {
    const msg = rpcError.message;
    if (msg.includes("capacity")) {
      return "CAPACITY_EXCEEDED";
    }
    if (msg.includes("active campaign not found")) {
      return "INACTIVE_CAMPAIGN";
    }
    if (msg.includes("seller is inactive")) {
      return "INACTIVE_SELLER";
    }
    if (rpcError.code === "42501" || msg.includes("permission denied")) {
      return "PERMISSION_DENIED";
    }
    return "UNKNOWN_ERROR";
  }

  assert.equal(classifyOrderError({ message: "requested quantity exceeds remaining campaign capacity" }), "CAPACITY_EXCEEDED");
  assert.equal(classifyOrderError({ message: "active campaign not found" }), "INACTIVE_CAMPAIGN");
  assert.equal(classifyOrderError({ message: "seller is inactive" }), "INACTIVE_SELLER");
  assert.equal(classifyOrderError({ code: "42501", message: "permission denied for function create_seller_order" }), "PERMISSION_DENIED");
  assert.equal(classifyOrderError({ message: "unexpected timeout" }), "UNKNOWN_ERROR");
});

test("isNextRedirectError accurately detects Next.js redirect exceptions without catching normal server errors", () => {
  // Case 1: Standard dev/test redirect Error object
  assert.equal(isNextRedirectError(new Error("NEXT_REDIRECT")), true);

  // Case 2: Production Next.js redirect object with digest starting with NEXT_REDIRECT
  assert.equal(
    isNextRedirectError({ digest: "NEXT_REDIRECT;replace;/buy/order/00000000-0000-0000-0000-000000000001;307;" }),
    true
  );

  // Case 3: Combined message and digest
  assert.equal(
    isNextRedirectError({ message: "NEXT_REDIRECT", digest: "NEXT_REDIRECT;push;/login;307;" }),
    true
  );

  // Case 4: Production Next.js server action validation error WITH a digest (CRITICAL REGRESSION TEST)
  // In Next.js production builds, ALL server action errors have a digest attached (e.g. hash digest).
  // This must NEVER evaluate as a redirect, otherwise PublicOrderForm re-throws to error.tsx!
  const productionActionError = Object.assign(new Error("WhatsApp number must contain between 7 and 15 digits."), {
    digest: "1489201948",
  });
  assert.equal(isNextRedirectError(productionActionError), false);

  // Case 5: Standard user validation error without digest
  assert.equal(isNextRedirectError(new Error("Valid customer email address is required.")), false);

  // Case 6: Edge cases: null, undefined, strings, numbers, empty objects
  assert.equal(isNextRedirectError(null), false);
  assert.equal(isNextRedirectError(undefined), false);
  assert.equal(isNextRedirectError("NEXT_REDIRECT"), false);
  assert.equal(isNextRedirectError(12345), false);
  assert.equal(isNextRedirectError({}), false);
  assert.equal(isNextRedirectError({ digest: 12345 }), false);
});

test("Customer detail normalization handles both object and array shapes from Supabase joins", () => {
  function normalizeCustomer(
    customers:
      | { full_name: string; whatsapp_number: string; email?: string | null }[]
      | { full_name: string; whatsapp_number: string; email?: string | null }
      | null
      | undefined
  ) {
    const raw = customers as unknown;
    return (Array.isArray(raw) ? raw[0] : raw) as
      | { full_name?: string; whatsapp_number?: string; email?: string | null }
      | undefined
      | null;
  }

  // Case 1: Supabase returns single object for foreign-key join (e.g. orders -> customers)
  const singleObj = { full_name: "Joseph", whatsapp_number: "+918810366357", email: "test@example.com" };
  const res1 = normalizeCustomer(singleObj);
  assert.equal(res1?.full_name, "Joseph");
  assert.equal(res1?.whatsapp_number, "+918810366357");

  // Case 2: Supabase returns array for multi-row join
  const arrayObj = [{ full_name: "Joseph Saimon", whatsapp_number: "+918810366357", email: "test@example.com" }];
  const res2 = normalizeCustomer(arrayObj);
  assert.equal(res2?.full_name, "Joseph Saimon");
  assert.equal(res2?.whatsapp_number, "+918810366357");

  // Case 3: Empty / Null cases
  assert.equal(normalizeCustomer(null), null);
  assert.equal(normalizeCustomer(undefined), undefined);
  assert.equal(normalizeCustomer([]), undefined);
});

test("Public buy order structured failure ensures user error visibility without crashing to error boundary", () => {
  type OrderFormResult = { success: boolean; error?: string };

  function simulateFormSubmitHandler(
    orderAction: () => Promise<OrderFormResult | void>,
    state: { isSubmitting: boolean; errorMsg: string | null }
  ) {
    return orderAction()
      .then((res) => {
        if (res && !res.success) {
          state.isSubmitting = false;
          state.errorMsg = res.error || "Failed to place order.";
          return;
        }
      })
      .catch((err: unknown) => {
        if (isNextRedirectError(err)) {
          throw err;
        }
        state.isSubmitting = false;
        if (err instanceof Error) {
          state.errorMsg = err.message;
        } else {
          state.errorMsg = "Failed to place order. Please try again.";
        }
      });
  }

  const state1 = { isSubmitting: true, errorMsg: null as string | null };
  // Validation failure returned as structured result:
  simulateFormSubmitHandler(
    async () => ({ success: false, error: "WhatsApp number must contain between 7 and 15 digits." }),
    state1
  ).then(() => {
    assert.equal(state1.isSubmitting, false);
    assert.equal(state1.errorMsg, "WhatsApp number must contain between 7 and 15 digits.");
  });

  const state2 = { isSubmitting: true, errorMsg: null as string | null };
  // Thrown production error with digest: must be caught and set in errorMsg, NOT rethrown to crash boundary
  const prodError = Object.assign(new Error("Unable to create order"), { digest: "29481928" });
  simulateFormSubmitHandler(
    async () => {
      throw prodError;
    },
    state2
  ).then(() => {
    assert.equal(state2.isSubmitting, false);
    assert.equal(state2.errorMsg, "Unable to create order");
  });

  // Next.js redirect error: MUST be rethrown to let router navigate
  const redirectError = { digest: "NEXT_REDIRECT;replace;/buy/order/123;307;" };
  assert.rejects(
    simulateFormSubmitHandler(async () => {
      throw redirectError;
    }, { isSubmitting: true, errorMsg: null }),
    (err: unknown) => isNextRedirectError(err)
  );
});
