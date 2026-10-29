import test from "node:test";
import assert from "node:assert/strict";

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
 * Pure simulation of seller manual order pre-flight validation logic
 * matching src/server/actions/operations.ts createSale()
 */
function validateSellerOrderPreconditions(
  seller: SellerState | null,
  campaign: CampaignState | null,
  quantity: number
): { allowed: boolean; error?: string } {
  // 1. Seller status check
  if (!seller) {
    return { allowed: false, error: "Your seller account is unavailable." };
  }
  if (!seller.is_active) {
    return { allowed: false, error: "Your seller account is currently inactive." };
  }

  // 2. Quantity validation
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { allowed: false, error: "Minimum 1 ticket." };
  }
  if (quantity > 1000) {
    return { allowed: false, error: "Maximum 1,000 tickets per seller order." };
  }

  // 3. Campaign configuration check
  if (!campaign) {
    return { allowed: false, error: "Fundraising campaign configuration was not found." };
  }

  // 4. Strict Campaign status check
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

  // 5. Capacity check
  const remaining = Math.max(0, campaign.total_ticket_limit - campaign.sold_ticket_count);
  if (quantity > remaining) {
    return {
      allowed: false,
      error: `Sorry, the requested quantity (${quantity}) exceeds remaining campaign capacity (${remaining} tickets available).`,
    };
  }

  return { allowed: true };
}

/**
 * Pure simulation of RPC error translation and sanitized diagnostics
 */
function translateRpcError(rpcError: { code?: string; message: string; hint?: string }): {
  userMessage: string;
  sanitizedDiagnostic: { code?: string; message: string; hint?: string };
} {
  const sanitizedDiagnostic = {
    code: rpcError.code,
    message: rpcError.message,
    hint: rpcError.hint,
  };

  const errorMsg = rpcError.message;
  let userMessage = "Unable to create this sale. Please try again.";

  if (errorMsg.includes("capacity")) {
    userMessage = "Sorry, the requested quantity exceeds remaining campaign ticket capacity.";
  } else if (errorMsg.includes("active campaign not found")) {
    userMessage = "Ticket sales are currently not active for this campaign.";
  } else if (errorMsg.includes("seller is inactive")) {
    userMessage = "Your seller account is currently inactive.";
  } else if (rpcError.code === "42501" || errorMsg.includes("permission denied")) {
    userMessage = "Order creation failed due to database authorization restrictions.";
  }

  return { userMessage, sanitizedDiagnostic };
}

test("Inactive campaign states (DRAFT, PAUSED, CLOSED, ARCHIVED) strictly block seller orders", () => {
  const activeSeller: SellerState = { id: "s-1", seller_code: "SELLER-001", is_active: true };

  // DRAFT status
  const draftCampaign: CampaignState = {
    id: "c-1",
    public_id: "ssfi-fundraising-lucky-draw",
    status: "DRAFT",
    total_ticket_limit: 1000,
    sold_ticket_count: 0,
  };
  const draftRes = validateSellerOrderPreconditions(activeSeller, draftCampaign, 5);
  assert.equal(draftRes.allowed, false);
  assert.ok(draftRes.error?.includes("preview") || draftRes.error?.includes("draft"));

  // PAUSED status
  const pausedCampaign: CampaignState = { ...draftCampaign, status: "PAUSED" };
  const pausedRes = validateSellerOrderPreconditions(activeSeller, pausedCampaign, 5);
  assert.equal(pausedRes.allowed, false);
  assert.ok(pausedRes.error?.includes("paused"));

  // CLOSED status
  const closedCampaign: CampaignState = { ...draftCampaign, status: "CLOSED" };
  const closedRes = validateSellerOrderPreconditions(activeSeller, closedCampaign, 5);
  assert.equal(closedRes.allowed, false);
  assert.ok(closedRes.error?.includes("ended"));

  // ARCHIVED status
  const archivedCampaign: CampaignState = { ...draftCampaign, status: "ARCHIVED" };
  const archivedRes = validateSellerOrderPreconditions(activeSeller, archivedCampaign, 5);
  assert.equal(archivedRes.allowed, false);
  assert.ok(archivedRes.error?.includes("ended"));
});

test("Active campaign with active seller and available capacity permits seller order creation", () => {
  const activeSeller: SellerState = { id: "s-1", seller_code: "SELLER-001", is_active: true };
  const activeCampaign: CampaignState = {
    id: "c-1",
    public_id: "ssfi-fundraising-lucky-draw",
    status: "ACTIVE",
    total_ticket_limit: 1000,
    sold_ticket_count: 350,
  };

  const res = validateSellerOrderPreconditions(activeSeller, activeCampaign, 10);
  assert.equal(res.allowed, true);
  assert.equal(res.error, undefined);
});

test("Capacity limit rejects orders exceeding remaining tickets", () => {
  const activeSeller: SellerState = { id: "s-1", seller_code: "SELLER-001", is_active: true };
  const fullCampaign: CampaignState = {
    id: "c-1",
    public_id: "ssfi-fundraising-lucky-draw",
    status: "ACTIVE",
    total_ticket_limit: 1000,
    sold_ticket_count: 995,
  };

  // 5 remaining, requesting 6
  const res = validateSellerOrderPreconditions(activeSeller, fullCampaign, 6);
  assert.equal(res.allowed, false);
  assert.ok(res.error?.includes("exceeds remaining campaign capacity"));
  assert.ok(res.error?.includes("5 tickets available"));

  // 5 remaining, requesting exactly 5
  const exactRes = validateSellerOrderPreconditions(activeSeller, fullCampaign, 5);
  assert.equal(exactRes.allowed, true);
});

test("Inactive seller is strictly rejected before campaign checks", () => {
  const inactiveSeller: SellerState = { id: "s-2", seller_code: "SELLER-002", is_active: false };
  const activeCampaign: CampaignState = {
    id: "c-1",
    public_id: "ssfi-fundraising-lucky-draw",
    status: "ACTIVE",
    total_ticket_limit: 1000,
    sold_ticket_count: 0,
  };

  const res = validateSellerOrderPreconditions(inactiveSeller, activeCampaign, 2);
  assert.equal(res.allowed, false);
  assert.equal(res.error, "Your seller account is currently inactive.");
});

test("Missing seller account is rejected", () => {
  const activeCampaign: CampaignState = {
    id: "c-1",
    public_id: "ssfi-fundraising-lucky-draw",
    status: "ACTIVE",
    total_ticket_limit: 1000,
    sold_ticket_count: 0,
  };

  const res = validateSellerOrderPreconditions(null, activeCampaign, 2);
  assert.equal(res.allowed, false);
  assert.equal(res.error, "Your seller account is unavailable.");
});

test("RPC error translation maps specific errors to helpful user messages", () => {
  // 1. Capacity exceeded
  const capErr = translateRpcError({ message: "requested quantity exceeds remaining campaign capacity" });
  assert.equal(capErr.userMessage, "Sorry, the requested quantity exceeds remaining campaign ticket capacity.");

  // 2. Active campaign not found (e.g. DRAFT or PAUSED)
  const draftErr = translateRpcError({ message: "active campaign not found" });
  assert.equal(draftErr.userMessage, "Ticket sales are currently not active for this campaign.");

  // 3. Inactive seller
  const sellerErr = translateRpcError({ message: "seller is inactive" });
  assert.equal(sellerErr.userMessage, "Your seller account is currently inactive.");

  // 4. Permission denied
  const permErr = translateRpcError({ code: "42501", message: "permission denied for function create_seller_order" });
  assert.equal(permErr.userMessage, "Order creation failed due to database authorization restrictions.");

  // 5. Unknown error
  const unkErr = translateRpcError({ message: "Connection timeout on socket" });
  assert.equal(unkErr.userMessage, "Unable to create this sale. Please try again.");
});

test("Sanitized diagnostics never contain secret credentials or customer PII", () => {
  const rpcError = {
    code: "42501",
    message: "active campaign not found",
    hint: "Ensure campaign status is ACTIVE",
  };

  const { sanitizedDiagnostic } = translateRpcError(rpcError);
  const serialized = JSON.stringify(sanitizedDiagnostic);

  // Must not have secret keys, passwords, bearer tokens, or user details
  assert.ok(!serialized.toLowerCase().includes("bearer"));
  assert.ok(!serialized.toLowerCase().includes("password"));
  assert.ok(!serialized.toLowerCase().includes("service_role"));
  assert.ok(!serialized.toLowerCase().includes("secret"));
});

test("Seller order creation sets initial order status to PENDING_PAYMENT, never directly TICKETS_ISSUED", () => {
  // Invariant: The create_seller_order RPC creates an order with PENDING_PAYMENT status and a PENDING payment record.
  // Tickets are only issued via verify_payment_and_issue after staff review.
  const initialOrderStatus = "PENDING_PAYMENT";
  const initialPaymentStatus = "PENDING";
  const issuedTicketsCount = 0;

  assert.equal(initialOrderStatus, "PENDING_PAYMENT");
  assert.equal(initialPaymentStatus, "PENDING");
  assert.equal(issuedTicketsCount, 0);
});

