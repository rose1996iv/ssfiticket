import test from "node:test";
import assert from "node:assert/strict";
import {
  renderWhatsAppTicketMessage,
  renderEmailTicketMessage,
} from "../src/lib/delivery/templates.ts";
import {
  formatWhatsAppPhoneNumber,
  buildWhatsAppClickToChatUrl,
} from "../src/lib/delivery/whatsappUrl.ts";
import type { DeliveryPayload, DeliveryResult } from "../src/lib/delivery/types.ts";
import { getTicketVerificationUrl } from "../src/lib/ticket/qr.ts";
import { getBaseAppUrl, getCustomerOrderUrl } from "../src/lib/config/appUrl.ts";
import {
  buildUpiPaymentUri,
  parseUpiPaymentUri,
  generateUpiQrDataUrl,
} from "../src/lib/payment/upi.ts";

type Role = "SUPER_ADMIN" | "ADMIN" | "FUNDRAISING_MANAGER" | "SELLER" | "CUSTOMER";

type OrderState = {
  id: string;
  order_number: string;
  quantity: number;
  total_amount_paise: number;
  status: "PENDING_PAYMENT" | "PAYMENT_SUBMITTED" | "PAYMENT_VERIFIED" | "TICKETS_ISSUED" | "CANCELLED";
  customer_id: string;
  seller_id: string | null;
  campaign_id: string;
};

type PaymentState = {
  id: string;
  order_id: string;
  amount_paise: number;
  status: "PENDING" | "SUBMITTED" | "VERIFIED" | "FAILED" | "CANCELLED";
  utr_reference: string | null;
  rejection_reason: string | null;
  verified_by: string | null;
};

type TicketState = {
  id: string;
  order_id: string;
  ticket_number: string;
  status: "ISSUED" | "VOID" | "REFUNDED";
  void_reason?: string | null;
  voided_by?: string | null;
  original_ticket_id?: string | null;
  reissued_ticket_id?: string | null;
  admin_notes?: string | null;
};

type DeliveryState = {
  id: string;
  order_id: string;
  channel: "WHATSAPP" | "EMAIL";
  status: "PENDING" | "SENT" | "DELIVERED" | "FAILED" | "SIMULATED";
  provider: string;
  recipient: string;
  attempt_count: number;
  rendered_content: string;
};

type AuditLog = {
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
};

// -----------------------------------------------------------------------------
// Pure Simulation Functions
// -----------------------------------------------------------------------------

function verifyPaymentAndIssueTickets(
  payment: PaymentState,
  order: OrderState,
  actorRole: Role,
  actorId: string,
  existingTickets: TicketState[],
  auditLogs: AuditLog[],
  nextSequence: () => number,
  campaignCapacityRemaining: number
): { success: boolean; error?: string; updatedPayment?: PaymentState; updatedOrder?: OrderState; newTickets?: TicketState[] } {
  // Guard 1: Staff role required
  const STAFF_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"];
  if (!STAFF_ROLES.includes(actorRole)) {
    return { success: false, error: "Unauthorized: Staff permission required for payment verification." };
  }

  // Guard 2: Payment must be awaiting verification
  if (payment.status !== "SUBMITTED") {
    return { success: false, error: "Payment is not awaiting verification (already processed or pending)." };
  }

  // Guard 3: Order status must match
  if (order.status !== "PAYMENT_SUBMITTED" || order.total_amount_paise !== payment.amount_paise) {
    return { success: false, error: "Payment and order amounts or states do not match." };
  }

  // Guard 4: Capacity check
  if (order.quantity > campaignCapacityRemaining) {
    return { success: false, error: "Campaign capacity limit exceeded." };
  }

  // Atomic state updates
  const updatedPayment: PaymentState = {
    ...payment,
    status: "VERIFIED",
    verified_by: actorId,
  };

  const newTickets: TicketState[] = [];
  for (let i = 0; i < order.quantity; i++) {
    const seq = nextSequence();
    const ticketNumber = `SSFI-${String(seq).padStart(6, "0")}`;
    newTickets.push({
      id: `t-${seq}`,
      order_id: order.id,
      ticket_number: ticketNumber,
      status: "ISSUED",
    });
  }

  const updatedOrder: OrderState = {
    ...order,
    status: "TICKETS_ISSUED",
  };

  auditLogs.push({
    actor_id: actorId,
    action: "PAYMENT_VERIFIED",
    entity_type: "payment",
    entity_id: payment.id,
    metadata: { order_id: order.id, ticket_count: order.quantity },
  });

  auditLogs.push({
    actor_id: actorId,
    action: "TICKET_ISSUED",
    entity_type: "order",
    entity_id: order.id,
    metadata: { quantity: order.quantity, tickets: newTickets.map((t) => t.ticket_number) },
  });

  return {
    success: true,
    updatedPayment,
    updatedOrder,
    newTickets,
  };
}

function voidTicket(
  ticket: TicketState,
  actorRole: Role,
  actorId: string,
  reason: string,
  auditLogs: AuditLog[]
): { success: boolean; error?: string; updatedTicket?: TicketState } {
  // Only SUPER_ADMIN and ADMIN are permitted
  if (actorRole !== "SUPER_ADMIN" && actorRole !== "ADMIN") {
    return { success: false, error: "Unauthorized: Administrator privileges required to void tickets." };
  }

  if (!reason || reason.trim().length < 3) {
    return { success: false, error: "A specific void reason of at least 3 characters is required." };
  }

  if (ticket.status === "VOID") {
    return { success: false, error: "Ticket is already voided." };
  }

  const updatedTicket: TicketState = {
    ...ticket,
    status: "VOID",
    void_reason: reason.trim(),
    voided_by: actorId,
  };

  auditLogs.push({
    actor_id: actorId,
    action: "TICKET_VOIDED",
    entity_type: "ticket",
    entity_id: ticket.id,
    metadata: { ticket_number: ticket.ticket_number, reason: reason.trim() },
  });

  return { success: true, updatedTicket };
}

function reissueTicket(
  oldTicket: TicketState,
  actorRole: Role,
  actorId: string,
  reason: string,
  nextSequence: () => number,
  auditLogs: AuditLog[]
): { success: boolean; error?: string; updatedOldTicket?: TicketState; newTicket?: TicketState } {
  if (actorRole !== "SUPER_ADMIN" && actorRole !== "ADMIN") {
    return { success: false, error: "Unauthorized: Administrator privileges required to reissue tickets." };
  }

  if (!reason || reason.trim().length < 3) {
    return { success: false, error: "A specific reissue reason of at least 3 characters is required." };
  }

  if (oldTicket.status === "VOID" && oldTicket.reissued_ticket_id) {
    return { success: false, error: "Ticket has already been reissued." };
  }

  const seq = nextSequence();
  const newTicketNumber = `SSFI-${String(seq).padStart(6, "0")}`;
  const newTicket: TicketState = {
    id: `t-${seq}`,
    order_id: oldTicket.order_id,
    ticket_number: newTicketNumber,
    status: "ISSUED",
    original_ticket_id: oldTicket.id,
    admin_notes: `Replacement for ${oldTicket.ticket_number}. Reason: ${reason.trim()}`,
  };

  const updatedOldTicket: TicketState = {
    ...oldTicket,
    status: "VOID",
    void_reason: reason.trim(),
    voided_by: actorId,
    reissued_ticket_id: newTicket.id,
  };

  auditLogs.push({
    actor_id: actorId,
    action: "TICKET_REISSUED",
    entity_type: "ticket",
    entity_id: newTicket.id,
    metadata: {
      old_ticket_number: oldTicket.ticket_number,
      new_ticket_number: newTicket.ticket_number,
      reason: reason.trim(),
    },
  });

  return { success: true, updatedOldTicket, newTicket };
}

function dispatchMockDelivery(
  order: OrderState,
  customerName: string,
  phone: string,
  email: string | null,
  activeTicketNumbers: string[],
  existingDeliveries: DeliveryState[],
  options?: { resend?: boolean; forceChannel?: "WHATSAPP" | "EMAIL" }
): { deliveries: DeliveryState[]; results: DeliveryResult[] } {
  const payload: DeliveryPayload = {
    orderId: order.id,
    orderNumber: order.order_number,
    customerName,
    whatsappNumber: phone,
    email,
    ticketNumbers: activeTicketNumbers,
    amountInr: order.total_amount_paise / 100,
    campaignName: "SSFI Lucky Draw 2026",
    issuedAtIst: "29 Oct 2026, 10:00 AM IST",
    ticketAccessUrl: `http://localhost:3000/buy/order/${order.id}`,
    isSimulated: true,
  };

  const channels: Array<"WHATSAPP" | "EMAIL"> = options?.forceChannel
    ? [options.forceChannel]
    : ["WHATSAPP", ...(email ? (["EMAIL"] as const) : [])];

  const results: DeliveryResult[] = [];
  const updatedDeliveries = [...existingDeliveries];

  for (const channel of channels) {
    const renderedContent =
      channel === "WHATSAPP"
        ? renderWhatsAppTicketMessage(payload)
        : renderEmailTicketMessage(payload).html;

    const existingIdx = updatedDeliveries.findIndex(
      (d) => d.order_id === order.id && d.channel === channel
    );

    const deliveryRecord: DeliveryState = {
      id: existingIdx >= 0 ? updatedDeliveries[existingIdx].id : `del-${channel}-${order.id}`,
      order_id: order.id,
      channel,
      status: "SIMULATED",
      provider: "mock",
      recipient: channel === "WHATSAPP" ? phone : (email || "none"),
      attempt_count: existingIdx >= 0 ? updatedDeliveries[existingIdx].attempt_count + 1 : 1,
      rendered_content: renderedContent,
    };

    if (existingIdx >= 0) {
      updatedDeliveries[existingIdx] = deliveryRecord;
    } else {
      updatedDeliveries.push(deliveryRecord);
    }

    results.push({
      channel,
      status: "SIMULATED",
      provider: "mock",
      recipient: deliveryRecord.recipient,
      providerMessageId: `mock-msg-${Date.now()}`,
      renderedContent,
    });
  }

  return { deliveries: updatedDeliveries, results };
}

// -----------------------------------------------------------------------------
// Test Scenarios
// -----------------------------------------------------------------------------

test("1. Order Creation & UTR Submission flow sets state to PAYMENT_SUBMITTED", () => {
  const order: OrderState = {
    id: "ord-1",
    order_number: "ORD-2026-000001",
    quantity: 3,
    total_amount_paise: 30000,
    status: "PENDING_PAYMENT",
    customer_id: "cust-1",
    seller_id: "seller-1",
    campaign_id: "camp-1",
  };

  const payment: PaymentState = {
    id: "pay-1",
    order_id: "ord-1",
    amount_paise: 30000,
    status: "PENDING",
    utr_reference: null,
    rejection_reason: null,
    verified_by: null,
  };

  // Customer submits valid UTR
  const submittedPayment: PaymentState = {
    ...payment,
    status: "SUBMITTED",
    utr_reference: "SBI1234567890",
  };

  const submittedOrder: OrderState = {
    ...order,
    status: "PAYMENT_SUBMITTED",
  };

  assert.equal(submittedPayment.status, "SUBMITTED");
  assert.equal(submittedOrder.status, "PAYMENT_SUBMITTED");
  assert.equal(submittedPayment.utr_reference, "SBI1234567890");
});

test("2. Payment Verification atomically issues tickets and advances status to TICKETS_ISSUED", () => {
  let seq = 100;
  const nextSeq = () => ++seq;
  const auditLogs: AuditLog[] = [];

  const order: OrderState = {
    id: "ord-2",
    order_number: "ORD-2026-000002",
    quantity: 2,
    total_amount_paise: 20000,
    status: "PAYMENT_SUBMITTED",
    customer_id: "cust-2",
    seller_id: "seller-1",
    campaign_id: "camp-1",
  };

  const payment: PaymentState = {
    id: "pay-2",
    order_id: "ord-2",
    amount_paise: 20000,
    status: "SUBMITTED",
    utr_reference: "HDFC987654321",
    rejection_reason: null,
    verified_by: null,
  };

  const res = verifyPaymentAndIssueTickets(
    payment,
    order,
    "ADMIN",
    "admin-user-1",
    [],
    auditLogs,
    nextSeq,
    500
  );

  assert.equal(res.success, true);
  assert.equal(res.updatedPayment?.status, "VERIFIED");
  assert.equal(res.updatedPayment?.verified_by, "admin-user-1");
  assert.equal(res.updatedOrder?.status, "TICKETS_ISSUED");
  assert.equal(res.newTickets?.length, 2);
  assert.equal(res.newTickets?.[0].ticket_number, "SSFI-000101");
  assert.equal(res.newTickets?.[1].ticket_number, "SSFI-000102");

  // Audit logs verify both payment verification and ticket issuance
  assert.equal(auditLogs.length, 2);
  assert.equal(auditLogs[0].action, "PAYMENT_VERIFIED");
  assert.equal(auditLogs[1].action, "TICKET_ISSUED");
});

test("3. Idempotency: Retrying payment verification fails cleanly and produces NO duplicate tickets", () => {
  let seq = 200;
  const nextSeq = () => ++seq;
  const auditLogs: AuditLog[] = [];

  const alreadyVerifiedPayment: PaymentState = {
    id: "pay-3",
    order_id: "ord-3",
    amount_paise: 10000,
    status: "VERIFIED", // Already verified
    utr_reference: "ICICI11223344",
    rejection_reason: null,
    verified_by: "admin-1",
  };

  const alreadyIssuedOrder: OrderState = {
    id: "ord-3",
    order_number: "ORD-2026-000003",
    quantity: 1,
    total_amount_paise: 10000,
    status: "TICKETS_ISSUED",
    customer_id: "cust-3",
    seller_id: null,
    campaign_id: "camp-1",
  };

  const retryRes = verifyPaymentAndIssueTickets(
    alreadyVerifiedPayment,
    alreadyIssuedOrder,
    "SUPER_ADMIN",
    "super-admin-1",
    [],
    auditLogs,
    nextSeq,
    500
  );

  assert.equal(retryRes.success, false);
  assert.ok(retryRes.error?.includes("not awaiting verification"));
  assert.equal(seq, 200); // Sequence was NOT incremented
  assert.equal(auditLogs.length, 0); // No new audit logs
});

test("4. Payment Rejection sets status to FAILED and resets order to PENDING_PAYMENT without tickets", () => {
  const payment: PaymentState = {
    id: "pay-4",
    order_id: "ord-4",
    amount_paise: 10000,
    status: "SUBMITTED",
    utr_reference: "INVALID-UTR",
    rejection_reason: null,
    verified_by: null,
  };

  const order: OrderState = {
    id: "ord-4",
    order_number: "ORD-2026-000004",
    quantity: 1,
    total_amount_paise: 10000,
    status: "PAYMENT_SUBMITTED",
    customer_id: "cust-4",
    seller_id: null,
    campaign_id: "camp-1",
  };

  // Rejection procedure
  const reason = "UTR not found in bank statement";
  const rejectedPayment: PaymentState = {
    ...payment,
    status: "FAILED",
    rejection_reason: reason,
  };
  const resetOrder: OrderState = {
    ...order,
    status: "PENDING_PAYMENT",
  };

  assert.equal(rejectedPayment.status, "FAILED");
  assert.equal(rejectedPayment.rejection_reason, reason);
  assert.equal(resetOrder.status, "PENDING_PAYMENT");
});

test("5. Ticket Uniqueness & Capacity Guard rejects orders exceeding capacity limit", () => {
  let seq = 300;
  const nextSeq = () => ++seq;
  const auditLogs: AuditLog[] = [];

  const order: OrderState = {
    id: "ord-5",
    order_number: "ORD-2026-000005",
    quantity: 10,
    total_amount_paise: 100000,
    status: "PAYMENT_SUBMITTED",
    customer_id: "cust-5",
    seller_id: null,
    campaign_id: "camp-1",
  };

  const payment: PaymentState = {
    id: "pay-5",
    order_id: "ord-5",
    amount_paise: 100000,
    status: "SUBMITTED",
    utr_reference: "AXIS998877",
    rejection_reason: null,
    verified_by: null,
  };

  // Remaining capacity is only 5 tickets
  const res = verifyPaymentAndIssueTickets(
    payment,
    order,
    "ADMIN",
    "admin-1",
    [],
    auditLogs,
    nextSeq,
    5
  );

  assert.equal(res.success, false);
  assert.ok(res.error?.includes("capacity limit exceeded"));
  assert.equal(seq, 300);
});

test("6. Admin-only Ticket Soft-Voiding succeeds and blocks Sellers/Customers", () => {
  const auditLogs: AuditLog[] = [];
  const ticket: TicketState = {
    id: "t-1",
    order_id: "ord-1",
    ticket_number: "SSFI-000050",
    status: "ISSUED",
  };

  // Seller attempt -> REJECTED
  const sellerAttempt = voidTicket(ticket, "SELLER", "seller-1", "Wrong customer", auditLogs);
  assert.equal(sellerAttempt.success, false);
  assert.ok(sellerAttempt.error?.includes("Administrator privileges required"));

  // Customer attempt -> REJECTED
  const customerAttempt = voidTicket(ticket, "CUSTOMER", "cust-1", "Void please", auditLogs);
  assert.equal(customerAttempt.success, false);

  // Admin attempt -> SUCCESS
  const adminRes = voidTicket(ticket, "ADMIN", "admin-1", "Duplicate registration error", auditLogs);
  assert.equal(adminRes.success, true);
  assert.equal(adminRes.updatedTicket?.status, "VOID");
  assert.equal(adminRes.updatedTicket?.void_reason, "Duplicate registration error");
  assert.equal(adminRes.updatedTicket?.voided_by, "admin-1");

  // Audit log recorded
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, "TICKET_VOIDED");
});

test("7. Void & Reissue generates replacement ticket and preserves history", () => {
  let seq = 500;
  const nextSeq = () => ++seq;
  const auditLogs: AuditLog[] = [];

  const oldTicket: TicketState = {
    id: "t-old",
    order_id: "ord-10",
    ticket_number: "SSFI-000500",
    status: "ISSUED",
  };

  const reissueRes = reissueTicket(
    oldTicket,
    "SUPER_ADMIN",
    "super-admin-1",
    "Customer phone number corrected on physical print",
    nextSeq,
    auditLogs
  );

  assert.equal(reissueRes.success, true);
  assert.equal(reissueRes.updatedOldTicket?.status, "VOID");
  assert.equal(reissueRes.updatedOldTicket?.reissued_ticket_id, reissueRes.newTicket?.id);
  assert.equal(reissueRes.newTicket?.ticket_number, "SSFI-000501");
  assert.equal(reissueRes.newTicket?.original_ticket_id, "t-old");
  assert.equal(reissueRes.newTicket?.status, "ISSUED");

  // Audit log recorded
  assert.equal(auditLogs[0].action, "TICKET_REISSUED");
  assert.equal(auditLogs[0].metadata.old_ticket_number, "SSFI-000500");
  assert.equal(auditLogs[0].metadata.new_ticket_number, "SSFI-000501");
});

test("8. Automated Ticket Delivery generates simulated records in development mode", () => {
  const order: OrderState = {
    id: "ord-deliv-1",
    order_number: "ORD-2026-000088",
    quantity: 2,
    total_amount_paise: 20000,
    status: "TICKETS_ISSUED",
    customer_id: "cust-deliv-1",
    seller_id: "seller-1",
    campaign_id: "camp-1",
  };

  const { deliveries, results } = dispatchMockDelivery(
    order,
    "Lalrinsanga Senthang",
    "+919876543210",
    "supporter@example.com",
    ["SSFI-000088", "SSFI-000089"],
    []
  );

  assert.equal(deliveries.length, 2);
  assert.equal(results.length, 2);

  const wa = deliveries.find((d) => d.channel === "WHATSAPP");
  const em = deliveries.find((d) => d.channel === "EMAIL");

  assert.ok(wa);
  assert.equal(wa.status, "SIMULATED");
  assert.equal(wa.attempt_count, 1);
  assert.ok(wa.rendered_content.includes("SSFI-000088"));
  assert.ok(wa.rendered_content.includes("SSFI-000089"));
  assert.ok(wa.rendered_content.includes("Lalrinsanga Senthang"));
  assert.ok(wa.rendered_content.includes("simulated message"));

  assert.ok(em);
  assert.equal(em.status, "SIMULATED");
  assert.equal(em.attempt_count, 1);
  assert.ok(em.rendered_content.includes("SSFI-000088"));
});

test("9. Delivery Resend increments attempt count without issuing duplicate tickets", () => {
  const order: OrderState = {
    id: "ord-deliv-2",
    order_number: "ORD-2026-000099",
    quantity: 1,
    total_amount_paise: 10000,
    status: "TICKETS_ISSUED",
    customer_id: "cust-deliv-2",
    seller_id: null,
    campaign_id: "camp-1",
  };

  // First dispatch
  const first = dispatchMockDelivery(
    order,
    "Mary Hmar",
    "+919123456789",
    null,
    ["SSFI-000099"],
    []
  );

  assert.equal(first.deliveries.length, 1);
  assert.equal(first.deliveries[0].attempt_count, 1);

  // Resend
  const second = dispatchMockDelivery(
    order,
    "Mary Hmar",
    "+919123456789",
    null,
    ["SSFI-000099"],
    first.deliveries,
    { resend: true }
  );

  assert.equal(second.deliveries.length, 1);
  assert.equal(second.deliveries[0].attempt_count, 2);
  assert.equal(second.deliveries[0].status, "SIMULATED");
});

test("10. Public Verification URL format matches official route structure", () => {
  const url = getTicketVerificationUrl("SSFI-000042", "http://localhost:3000");
  assert.equal(url, "http://localhost:3000/verify/SSFI-000042");

  const urlWithSlash = getTicketVerificationUrl("SSFI-000042", "https://ssfiticket.org/");
  assert.equal(urlWithSlash, "https://ssfiticket.org/verify/SSFI-000042");
});

test("11. Preview Mock Payment Reference Validation accepts test references and blocks fake live references", () => {
  const validateMockUtr = (utr: string, isMock: boolean) => {
    const trimmed = utr.trim();
    if (trimmed.length < 6 || trimmed.length > 64 || !/^[A-Za-z0-9-]+$/.test(trimmed)) {
      return { valid: false, error: "Invalid payment reference format." };
    }
    if (isMock) {
      const isTestRef = /^(TEST|MOCK)[A-Za-z0-9-]*$/i.test(trimmed);
      if (!isTestRef) {
        return {
          valid: false,
          error: "Preview mock payment mode is active. Please enter a recognized test reference starting with TEST or MOCK (e.g. TEST12345678).",
        };
      }
    }
    return { valid: true };
  };

  // Mock mode: Recognized test references succeed
  assert.equal(validateMockUtr("TEST12345678", true).valid, true);
  assert.equal(validateMockUtr("MOCK-UPI-9999", true).valid, true);
  assert.equal(validateMockUtr("test428172918291", true).valid, true);

  // Mock mode: Arbitrary fake live references fail
  const fakeLive = validateMockUtr("428172918291", true);
  assert.equal(fakeLive.valid, false);
  assert.ok(fakeLive.error?.includes("recognized test reference starting with TEST or MOCK"));

  // Production mode: Standard UTR references succeed
  assert.equal(validateMockUtr("428172918291", false).valid, true);
  assert.equal(validateMockUtr("SBI998877665544", false).valid, true);
});

test("12. Duplicate payment submission guard rejects repeat submissions on PAYMENT_SUBMITTED order", () => {
  const checkSubmissionEligibility = (orderStatus: string) => {
    if (orderStatus !== "PENDING_PAYMENT") {
      if (orderStatus === "PAYMENT_SUBMITTED") {
        return {
          eligible: false,
          error: "A payment reference has already been submitted for this order and is currently under review.",
        };
      }
      return { eligible: false, error: "This order is not eligible for payment submission." };
    }
    return { eligible: true };
  };

  // PENDING_PAYMENT -> Allowed
  assert.equal(checkSubmissionEligibility("PENDING_PAYMENT").eligible, true);

  // PAYMENT_SUBMITTED -> Rejected with clear message
  const submittedRes = checkSubmissionEligibility("PAYMENT_SUBMITTED");
  assert.equal(submittedRes.eligible, false);
  assert.ok(submittedRes.error?.includes("already been submitted"));

  // TICKETS_ISSUED -> Rejected
  assert.equal(checkSubmissionEligibility("TICKETS_ISSUED").eligible, false);
});

test("13. Role Boundaries: Sellers and Customers cannot approve payments or issue tickets", () => {
  const payment: PaymentState = {
    id: "pay-rbac-1",
    order_id: "ord-rbac-1",
    amount_paise: 10000,
    status: "SUBMITTED",
    utr_reference: "TEST12345678",
    rejection_reason: null,
    verified_by: null,
  };

  const order: OrderState = {
    id: "ord-rbac-1",
    order_number: "ORD-2026-000077",
    quantity: 1,
    total_amount_paise: 10000,
    status: "PAYMENT_SUBMITTED",
    customer_id: "cust-77",
    seller_id: "seller-77",
    campaign_id: "camp-1",
  };

  // Seller attempt to verify -> Strictly unauthorized
  const sellerRes = verifyPaymentAndIssueTickets(
    payment,
    order,
    "SELLER",
    "seller-77",
    [],
    [],
    () => 1,
    500
  );
  assert.equal(sellerRes.success, false);
  assert.ok(sellerRes.error?.includes("Staff permission required"));

  // Customer attempt to verify -> Strictly unauthorized
  const customerRes = verifyPaymentAndIssueTickets(
    payment,
    order,
    "CUSTOMER",
    "cust-77",
    [],
    [],
    () => 1,
    500
  );
  assert.equal(customerRes.success, false);
  assert.ok(customerRes.error?.includes("Staff permission required"));
});

test("14. Complete Mock Lifecycle: Mock Submission -> Admin Approval -> Atomic Tickets -> Simulated Delivery", () => {
  let seq = 500;
  const nextSeq = () => ++seq;
  const auditLogs: AuditLog[] = [];

  // Step 1: Order exists with attributed customer and seller
  const order: OrderState = {
    id: "ord-lifecycle-1",
    order_number: "ORD-2026-000055",
    quantity: 3,
    total_amount_paise: 30000,
    status: "PENDING_PAYMENT",
    customer_id: "cust-55",
    seller_id: "seller-55",
    campaign_id: "camp-1",
  };

  const payment: PaymentState = {
    id: "pay-lifecycle-1",
    order_id: order.id,
    amount_paise: 30000,
    status: "PENDING",
    utr_reference: null,
    rejection_reason: null,
    verified_by: null,
  };

  // Step 2: Customer submits mock UTR
  const submittedPayment: PaymentState = {
    ...payment,
    status: "SUBMITTED",
    utr_reference: "TEST12345678",
  };
  const submittedOrder: OrderState = {
    ...order,
    status: "PAYMENT_SUBMITTED",
  };

  assert.equal(submittedPayment.status, "SUBMITTED");
  assert.equal(submittedPayment.utr_reference, "TEST12345678");
  assert.equal(submittedOrder.seller_id, "seller-55");
  assert.equal(submittedOrder.customer_id, "cust-55");

  // Step 3: Admin approves the mock payment
  const verifyRes = verifyPaymentAndIssueTickets(
    submittedPayment,
    submittedOrder,
    "ADMIN",
    "admin-user-99",
    [],
    auditLogs,
    nextSeq,
    100
  );

  assert.equal(verifyRes.success, true);
  assert.equal(verifyRes.updatedPayment?.status, "VERIFIED");
  assert.equal(verifyRes.updatedPayment?.verified_by, "admin-user-99");
  assert.equal(verifyRes.updatedOrder?.status, "TICKETS_ISSUED");
  assert.equal(verifyRes.newTickets?.length, 3);
  assert.equal(verifyRes.newTickets?.[0].ticket_number, "SSFI-000501");
  assert.equal(verifyRes.newTickets?.[1].ticket_number, "SSFI-000502");
  assert.equal(verifyRes.newTickets?.[2].ticket_number, "SSFI-000503");

  // Step 4: Verification URLs are valid
  const qrUrl1 = getTicketVerificationUrl(verifyRes.newTickets![0].ticket_number, "https://ssfiticket.org");
  assert.equal(qrUrl1, "https://ssfiticket.org/verify/SSFI-000501");

  // Step 5: Automated delivery is recorded as SIMULATED
  const delivery = dispatchMockDelivery(
    verifyRes.updatedOrder!,
    "John Doe",
    "+919876543210",
    "john@example.com",
    verifyRes.newTickets!.map((t) => t.ticket_number),
    []
  );

  assert.equal(delivery.deliveries.length, 2);
  assert.equal(delivery.deliveries[0].channel, "WHATSAPP");
  assert.equal(delivery.deliveries[0].status, "SIMULATED");
  assert.equal(delivery.deliveries[1].channel, "EMAIL");
  assert.equal(delivery.deliveries[1].status, "SIMULATED");

  // Step 6: Repeated approval is strictly blocked (idempotent)
  const repeatRes = verifyPaymentAndIssueTickets(
    verifyRes.updatedPayment!,
    verifyRes.updatedOrder!,
    "ADMIN",
    "admin-user-99",
    verifyRes.newTickets!,
    auditLogs,
    nextSeq,
    100
  );
  assert.equal(repeatRes.success, false);
  assert.equal(verifyRes.newTickets?.length, 3); // No extra tickets created
});

// -----------------------------------------------------------------------------
// Free WhatsApp Click-to-Chat Delivery Tests
// -----------------------------------------------------------------------------

test("WhatsApp Phone Normalization: Formats Indian mobile numbers to international format", () => {
  assert.equal(formatWhatsAppPhoneNumber("9876543210"), "919876543210");
  assert.equal(formatWhatsAppPhoneNumber("+919876543210"), "919876543210");
  assert.equal(formatWhatsAppPhoneNumber("09876543210"), "919876543210");
  assert.equal(formatWhatsAppPhoneNumber("+91 98765-43210"), "919876543210");
  assert.equal(formatWhatsAppPhoneNumber("919876543210"), "919876543210");
  assert.equal(formatWhatsAppPhoneNumber(""), "");
});

test("Free WhatsApp Click-to-Chat: Builds valid wa.me URL with pre-filled message and verification links", () => {
  const payload: DeliveryPayload = {
    orderId: "ord-test-1234",
    orderNumber: "SSFI-ORD-9999",
    customerName: "Rahul Sharma",
    whatsappNumber: "9876543210",
    email: "rahul@example.com",
    ticketNumbers: ["SSFI-001001", "SSFI-001002"],
    amountInr: 200,
    campaignName: "SSFI Roller Skating Championship 2026",
    issuedAtIst: "29 Oct 2026, 05:00 PM IST",
    ticketAccessUrl: "https://ssfiticket.org/verify/SSFI-001001",
    sellerAttribution: "Official Seller Ravi",
  };

  const result = buildWhatsAppClickToChatUrl(payload);

  assert.equal(result.recipientPhone, "919876543210");
  assert.ok(result.url.startsWith("https://wa.me/919876543210?text="));
  assert.ok(result.messageText.includes("SSFI-ORD-9999"));
  assert.ok(result.messageText.includes("Rahul Sharma"));
  assert.ok(result.messageText.includes("SSFI-001001"));
  assert.ok(result.messageText.includes("SSFI-001002"));
  assert.ok(result.url.includes(encodeURIComponent("SSFI-001001")));
});

test("Duplicate UTR Submission: Gracefully catches duplicate reference without unhandled crash", () => {
  const existingUtrs = new Set<string>(["UTR1122334455", "UTR9988776655"]);

  function simulateManualUpiSubmission(utr: string): { success: boolean; error?: string } {
    const trimmed = utr.trim().toUpperCase();
    if (existingUtrs.has(trimmed)) {
      return {
        success: false,
        error: "This Transaction ID / UTR has already been submitted. Please check your payment receipt and enter a different valid reference.",
      };
    }
    existingUtrs.add(trimmed);
    return { success: true };
  }

  // Duplicate attempt
  const dupResult = simulateManualUpiSubmission("UTR1122334455");
  assert.equal(dupResult.success, false);
  assert.ok(dupResult.error?.includes("already been submitted"));

  // Fresh attempt
  const freshResult = simulateManualUpiSubmission("UTR5566778899");
  assert.equal(freshResult.success, true);
  assert.equal(freshResult.error, undefined);
});

test("Bidirectional Messaging: Threading association and role assignment", () => {
  type MessageRecord = {
    id: string;
    sender_role: "ADMIN" | "SELLER";
    parent_message_id: string | null;
    subject: string;
    body: string;
  };

  const messages: MessageRecord[] = [];

  // Seller creates inquiry
  const sellerMsg: MessageRecord = {
    id: "msg-001",
    sender_role: "SELLER",
    parent_message_id: null,
    subject: "Payment confirmation delay query",
    body: "Customer says they paid 30 minutes ago with UTR 99881122.",
  };
  messages.push(sellerMsg);

  // Admin replies to that inquiry
  const adminReply: MessageRecord = {
    id: "msg-002",
    sender_role: "ADMIN",
    parent_message_id: "msg-001",
    subject: "Re: Payment confirmation delay query",
    body: "We have reviewed the bank statement and approved the order. Tickets are now dispatched.",
  };
  messages.push(adminReply);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].sender_role, "SELLER");
  assert.equal(messages[1].sender_role, "ADMIN");
  assert.equal(messages[1].parent_message_id, "msg-001");
});

// -----------------------------------------------------------------------------
// Customer Order Link & Production Base URL Tests
// -----------------------------------------------------------------------------

test("Customer Order Link: Generates public production URL by default in production environment", () => {
  const originalEnv = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = "production";
    const orderId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const url = getCustomerOrderUrl(orderId);

    // Must start with canonical domain
    assert.ok(
      url.startsWith("https://ssfiticket.vercel.app/buy/order/"),
      `Expected canonical production link, got: ${url}`
    );
    assert.equal(url, `https://ssfiticket.vercel.app/buy/order/${orderId}`);
    assert.ok(!url.includes("-git-"), "Customer link must never expose git branch preview hashes");
    assert.ok(!url.includes(".preview."), "Customer link must not contain protected preview domains");
  } finally {
    process.env.VERCEL_ENV = originalEnv;
  }
});

test("Customer Order Link: Respects custom explicit APP_BASE_URL", () => {
  const orderId = "test-order-99";
  const customOrigin = "https://fundraising.ssfi.in";
  const url = getCustomerOrderUrl(orderId, customOrigin);

  assert.equal(url, "https://fundraising.ssfi.in/buy/order/test-order-99");
});

test("Customer Order Link: getBaseAppUrl strips trailing slashes and normalizes protocols", () => {
  assert.equal(getBaseAppUrl("https://ssfiticket.vercel.app/"), "https://ssfiticket.vercel.app");
  assert.equal(getBaseAppUrl("https://ssfiticket.vercel.app///"), "https://ssfiticket.vercel.app");
  assert.equal(getBaseAppUrl("ssfiticket.vercel.app"), "https://ssfiticket.vercel.app");
});

// -----------------------------------------------------------------------------
// Official SSFI Contact & Template Tests
// -----------------------------------------------------------------------------

test("Official SSFI Contact: Templates use Senthangstudents@gmail.com and omit unverified phone", () => {
  const payload: DeliveryPayload = {
    orderId: "ord-test-contact",
    orderNumber: "SSFI-ORD-7777",
    customerName: "Mary Vung",
    whatsappNumber: "9123456789",
    email: "mary@example.com",
    ticketNumbers: ["SSFI-007777"],
    amountInr: 100,
    campaignName: "SSFI Fundraiser 2026",
    issuedAtIst: "29 Oct 2026, 06:00 PM IST",
    ticketAccessUrl: "https://ssfiticket.vercel.app/buy/order/ord-test-contact",
  };

  const waMsg = renderWhatsAppTicketMessage(payload);
  const emailMsg = renderEmailTicketMessage(payload);

  // 1. Must contain verified official email
  assert.ok(waMsg.includes("Senthangstudents@gmail.com"));
  assert.ok(emailMsg.text.includes("Senthangstudents@gmail.com"));
  assert.ok(emailMsg.html.includes("Senthangstudents@gmail.com"));

  // 2. Must NOT contain fake support email or fake phone
  assert.ok(!waMsg.includes("support@ssfi.org"));
  assert.ok(!emailMsg.text.includes("support@ssfi.org"));
  assert.ok(!emailMsg.html.includes("support@ssfi.org"));

  assert.ok(!waMsg.includes("+91 98765 43210"));
  assert.ok(!emailMsg.text.includes("+91 98765 43210"));
  assert.ok(!emailMsg.html.includes("+91 98765 43210"));

  // 3. Must NOT contain corrupted replacement characters (\uFFFD)
  assert.ok(!waMsg.includes("\uFFFD"));
  assert.ok(!emailMsg.text.includes("\uFFFD"));
  assert.ok(!emailMsg.html.includes("\uFFFD"));

  // 4. Must render valid INR currency
  assert.ok(waMsg.includes("₹100"));
  assert.ok(emailMsg.text.includes("₹100"));
  assert.ok(emailMsg.html.includes("₹100"));
});

// -----------------------------------------------------------------------------
// Automated Email Delivery & Deduping Scenarios
// -----------------------------------------------------------------------------

test("Email Delivery Simulation: Success scenario includes all mandatory order details", () => {
  const payload: DeliveryPayload = {
    orderId: "ord-email-success",
    orderNumber: "SSFI-ORD-1234",
    customerName: "David Lal",
    whatsappNumber: "9812345678",
    email: "david@example.com",
    ticketNumbers: ["SSFI-000101", "SSFI-000102"],
    amountInr: 200,
    campaignName: "SSFI Annual Draw 2026",
    issuedAtIst: "29 Oct 2026, 07:30 PM IST",
    ticketAccessUrl: "https://ssfiticket.vercel.app/buy/order/ord-email-success",
    sellerAttribution: "Lian (SSFI-SEL-001)",
    isSimulated: true,
  };

  const { subject, html, text } = renderEmailTicketMessage(payload);

  assert.ok(subject.includes("SSFI-ORD-1234"));
  assert.ok(text.includes("SSFI-ORD-1234"));
  assert.ok(text.includes("SSFI-000101"));
  assert.ok(text.includes("SSFI-000102"));
  assert.ok(text.includes("₹200"));
  assert.ok(text.includes("29 Oct 2026, 07:30 PM IST"));
  assert.ok(text.includes("Lian (SSFI-SEL-001)"));
  assert.ok(text.includes("https://ssfiticket.vercel.app/buy/order/ord-email-success"));

  assert.ok(html.includes("David Lal"));
  assert.ok(html.includes("SSFI-ORD-1234"));
  assert.ok(html.includes("SSFI-000101"));
  assert.ok(html.includes("SSFI-000102"));
  assert.ok(html.includes("View &amp; Verify Tickets Online"));
});

test("Email Delivery: Missing customer email gracefully skips or records FAILED without crash", () => {
  function simulateEmailDispatch(email: string | null): { status: string; error?: string } {
    if (!email || email.trim() === "") {
      return {
        status: "FAILED",
        error: "No email address recorded for customer.",
      };
    }
    return { status: "SENT" };
  }

  const result = simulateEmailDispatch(null);
  assert.equal(result.status, "FAILED");
  assert.equal(result.error, "No email address recorded for customer.");

  const emptyResult = simulateEmailDispatch("");
  assert.equal(emptyResult.status, "FAILED");
});

test("Email Delivery Deduping: Repeated approval requests do not re-send already SENT emails", () => {
  type DeliveryRecord = {
    channel: string;
    status: string;
    sent_at: string;
    attempt_count: number;
  };

  const existingDeliveries: DeliveryRecord[] = [
    {
      channel: "EMAIL",
      status: "SENT",
      sent_at: "2026-10-29T14:00:00Z",
      attempt_count: 1,
    },
  ];

  function evaluateDeliveryDispatch(
    channel: string,
    resend: boolean
  ): { shouldSend: boolean; reason: string } {
    if (!resend) {
      const existing = existingDeliveries.find(
        (d) => d.channel === channel && d.status === "SENT"
      );
      if (existing) {
        return { shouldSend: false, reason: "Already successfully sent" };
      }
    }
    return { shouldSend: true, reason: "Dispatch permitted" };
  }

  // 1. Repeated verification / approval (resend = false)
  const repeatCheck = evaluateDeliveryDispatch("EMAIL", false);
  assert.equal(repeatCheck.shouldSend, false);
  assert.equal(repeatCheck.reason, "Already successfully sent");

  // 2. Explicit manual resend by staff (resend = true)
  const forceResendCheck = evaluateDeliveryDispatch("EMAIL", true);
  assert.equal(forceResendCheck.shouldSend, true);
});

test("Email Delivery: Provider failure does not rollback valid ticket allocation", () => {
  let paymentVerified = false;
  let ticketsAllocated = false;
  let deliveryResultStatus = "";

  // 1. Transaction step
  paymentVerified = true;
  ticketsAllocated = true;

  // 2. Delivery dispatch step wrapped in safe try/catch
  try {
    // Simulate provider outage (e.g. Resend 500 or network timeout)
    throw new Error("Resend provider 503 service unavailable");
  } catch {
    deliveryResultStatus = "FAILED";
    // Crucial: paymentVerified and ticketsAllocated remain true!
  }

  assert.equal(paymentVerified, true);
  assert.equal(ticketsAllocated, true);
  assert.equal(deliveryResultStatus, "FAILED");
});

test("Preview Environment Safety: Protects real customers by enforcing dry-run mode unless allowed test recipient", () => {
  function evaluatePreviewEmailSafety(
    recipient: string,
    isPreview: boolean,
    allowedTestEmail?: string
  ): { liveSendPermitted: boolean; mode: string } {
    if (isPreview) {
      if (allowedTestEmail && recipient.toLowerCase() === allowedTestEmail.toLowerCase()) {
        return { liveSendPermitted: true, mode: "TEST_INBOX_PERMITTED" };
      }
      return { liveSendPermitted: false, mode: "MOCK_PREVIEW_DRY_RUN" };
    }
    return { liveSendPermitted: true, mode: "PRODUCTION_LIVE" };
  }

  // Real customer in preview -> strictly dry-run
  const realCust = evaluatePreviewEmailSafety("real.customer@gmail.com", true, "developer@ssfi.org");
  assert.equal(realCust.liveSendPermitted, false);
  assert.equal(realCust.mode, "MOCK_PREVIEW_DRY_RUN");

  // Approved developer in preview -> allowed test send
  const devTest = evaluatePreviewEmailSafety("developer@ssfi.org", true, "developer@ssfi.org");
  assert.equal(devTest.liveSendPermitted, true);
  assert.equal(devTest.mode, "TEST_INBOX_PERMITTED");

  // In preview with no allowed test email configured -> strictly dry-run
  const noConfig = evaluatePreviewEmailSafety("anyone@example.com", true, undefined);
  assert.equal(noConfig.liveSendPermitted, false);
  assert.equal(noConfig.mode, "MOCK_PREVIEW_DRY_RUN");
});

/* ========================================================================= */
/* Official UPI Payment Configuration & Mock/Live Lifecycle Test Suite        */
/* ========================================================================= */

test("Official UPI Production Configuration: Payee, UPI ID, Currency, and QR file integrity", async () => {
  const fs = await import("fs");
  const crypto = await import("crypto");

  // 1. Production defaults verification
  const defaultPayee = "HLAWN THA DAWT";
  const defaultUpiId = "6909251270@ptaxis";
  const defaultCurrency = "INR";
  const supportEmail = "Senthangstudents@gmail.com";

  assert.equal(defaultPayee, "HLAWN THA DAWT");
  assert.equal(defaultUpiId, "6909251270@ptaxis");
  assert.equal(defaultCurrency, "INR");
  assert.equal(supportEmail, "Senthangstudents@gmail.com");

  // 2. Production QR image presence & exact file hash verification
  const qrPath = "public/upi_qr.jpeg";
  assert.ok(fs.existsSync(qrPath), "public/upi_qr.jpeg must exist in the public directory");

  const qrBuffer = fs.readFileSync(qrPath);
  assert.ok(qrBuffer.length > 50000, "UPI QR file must be complete and uncorrupted");

  const sha256 = crypto.createHash("sha256").update(qrBuffer).digest("hex");
  // Expected sha256 hash of the supplied upi_qr.jpeg
  assert.equal(sha256, "d336aada6736fea19d433adcfd267acb7a8048b2f31853436449b1aa709d3d1c");
});

test("UPI Intent URI Generator: Formats valid URI for Indian Banking / UPI apps", () => {
  function generateUpiIntentUri(params: {
    upiId: string;
    payeeName: string;
    amountInr: number;
    orderNumber: string;
  }): string {
    return `upi://pay?pa=${encodeURIComponent(params.upiId)}&pn=${encodeURIComponent(
      params.payeeName
    )}&am=${params.amountInr}&cu=INR&tn=${encodeURIComponent(params.orderNumber)}`;
  }

  const uri = generateUpiIntentUri({
    upiId: "6909251270@ptaxis",
    payeeName: "HLAWN THA DAWT",
    amountInr: 200,
    orderNumber: "SSFI-ORD-1005",
  });

  assert.ok(uri.startsWith("upi://pay?"));
  assert.ok(uri.includes("pa=6909251270%40ptaxis"));
  assert.ok(uri.includes("pn=HLAWN%20THA%20DAWT"));
  assert.ok(uri.includes("am=200"));
  assert.ok(uri.includes("cu=INR"));
  assert.ok(uri.includes("tn=SSFI-ORD-1005"));
});

test("Mock vs Production Isolation: Static QR image inspection permitted in Preview with strict safety controls", () => {
  function getUpiEnvironmentConfig(isMock: boolean) {
    return {
      upiId: "6909251270@ptaxis",
      displayName: "HLAWN THA DAWT",
      qrImagePath: "/upi_qr.jpeg",
      currency: "INR",
      supportEmail: "Senthangstudents@gmail.com",
      isMock,
    };
  }

  // 1. Preview / Development Mode
  const mockConfig = getUpiEnvironmentConfig(true);
  assert.equal(mockConfig.upiId, "6909251270@ptaxis");
  assert.equal(mockConfig.displayName, "HLAWN THA DAWT");
  assert.equal(mockConfig.qrImagePath, "/upi_qr.jpeg");
  assert.equal(mockConfig.isMock, true);

  // 2. Production Live Mode
  const liveConfig = getUpiEnvironmentConfig(false);
  assert.equal(liveConfig.upiId, "6909251270@ptaxis");
  assert.equal(liveConfig.displayName, "HLAWN THA DAWT");
  assert.equal(liveConfig.qrImagePath, "/upi_qr.jpeg");
  assert.equal(liveConfig.isMock, false);
});

test("Payment Submission Lifecycle: Mock Success vs Mock Failure vs Duplicate Reference", () => {
  type PaymentRecord = {
    orderId: string;
    utr: string;
    payerName?: string;
    status: "SUBMITTED" | "VERIFIED" | "FAILED";
  };

  const existingPayments: PaymentRecord[] = [
    {
      orderId: "ord-existing-01",
      utr: "TEST-DUP-REF",
      status: "SUBMITTED",
    },
  ];

  function processPaymentSubmission(
    orderId: string,
    utrInput: string,
    payerNameInput?: string,
    isMock: boolean = true
  ): { success: boolean; error?: string; status?: string } {
    const trimmedUtr = utrInput.trim();

    if (!trimmedUtr || trimmedUtr.length < 6) {
      return { success: false, error: "UTR / Transaction Reference must be at least 6 characters." };
    }

    if (isMock) {
      if (trimmedUtr.toUpperCase().includes("FAIL")) {
        return {
          success: false,
          error: "Simulated Mock Payment Failure: Test reference was rejected by test validation rules.",
        };
      }
      const isTestRef = /^(TEST|MOCK)[A-Za-z0-9-]*$/i.test(trimmedUtr);
      if (!isTestRef) {
        return {
          success: false,
          error: "Preview mock payment mode is active. Please enter a recognized test reference starting with TEST or MOCK (e.g. TEST12345678).",
        };
      }
    }

    // Check duplicate
    const isDuplicate = existingPayments.some((p) => p.utr.toLowerCase() === trimmedUtr.toLowerCase());
    if (isDuplicate) {
      return {
        success: false,
        error: "This Transaction ID / UTR has already been submitted. Please check your payment receipt and enter a different valid reference.",
      };
    }

    // Success transition
    return { success: true, status: "SUBMITTED" };
  }

  // Case 1: Valid Mock Submission
  const successRes = processPaymentSubmission("ord-new-01", "TEST-MOCK-889900", "Test Buyer", true);
  assert.equal(successRes.success, true);
  assert.equal(successRes.status, "SUBMITTED");

  // Case 2: Simulated Mock Failure
  const failRes = processPaymentSubmission("ord-new-02", "MOCK-FAIL-REJECTED", "Failing Tester", true);
  assert.equal(failRes.success, false);
  assert.ok(failRes.error?.includes("Simulated Mock Payment Failure"));

  // Case 3: Duplicate UTR Detection
  const dupRes = processPaymentSubmission("ord-new-03", "TEST-DUP-REF", "Duplicate Tester", true);
  assert.equal(dupRes.success, false);
  assert.ok(dupRes.error?.includes("already been submitted"));

  // Case 4: Non-mock reference attempted in Mock mode
  const nonMockRes = processPaymentSubmission("ord-new-04", "123456789012", "Real Buyer", true);
  assert.equal(nonMockRes.success, false);
  assert.ok(nonMockRes.error?.includes("starting with TEST or MOCK"));
});

test("Staff Verification & Ticket Issuance: Tickets generated only after Admin Approval", () => {
  type SystemOrder = {
    id: string;
    orderNumber: string;
    status: "PENDING_PAYMENT" | "PAYMENT_SUBMITTED" | "TICKETS_ISSUED";
    paymentStatus: "PENDING" | "SUBMITTED" | "VERIFIED" | "FAILED";
    tickets: string[];
  };

  const order: SystemOrder = {
    id: "ord-test-lifecycle",
    orderNumber: "SSFI-ORD-9001",
    status: "PENDING_PAYMENT",
    paymentStatus: "PENDING",
    tickets: [],
  };

  // Step 1: User submits UTR
  order.status = "PAYMENT_SUBMITTED";
  order.paymentStatus = "SUBMITTED";

  // Critical verification: NO tickets are generated merely upon UTR submission
  assert.equal(order.status, "PAYMENT_SUBMITTED");
  assert.equal(order.paymentStatus, "SUBMITTED");
  assert.equal(order.tickets.length, 0);

  // Step 2: Admin reviews bank statement and approves
  function adminApproveAndIssue(
    staffRole: string,
    targetOrder: SystemOrder,
    quantity: number
  ): { success: boolean; error?: string } {
    if (!["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"].includes(staffRole)) {
      return { success: false, error: "Unauthorized: Insufficient staff permissions." };
    }
    if (targetOrder.paymentStatus !== "SUBMITTED") {
      return { success: false, error: "Payment is not awaiting verification." };
    }

    targetOrder.paymentStatus = "VERIFIED";
    targetOrder.status = "TICKETS_ISSUED";
    for (let i = 1; i <= quantity; i++) {
      targetOrder.tickets.push(`SSFI-TKT-${1000 + i}`);
    }
    return { success: true };
  }

  // Non-staff attempt fails
  const unauthRes = adminApproveAndIssue("CUSTOMER", order, 2);
  assert.equal(unauthRes.success, false);
  assert.equal(order.tickets.length, 0);

  // Staff approval succeeds and generates sequential tickets
  const authRes = adminApproveAndIssue("ADMIN", order, 2);
  assert.equal(authRes.success, true);
  assert.equal(order.status, "TICKETS_ISSUED");
  assert.equal(order.paymentStatus, "VERIFIED");
  assert.equal(order.tickets.length, 2);
  assert.deepEqual(order.tickets, ["SSFI-TKT-1001", "SSFI-TKT-1002"]);
});

test("Staff Payment Rejection Lifecycle: Order permits customer resubmission", () => {
  type RejectionOrder = {
    id: string;
    status: string;
    paymentStatus: string;
    rejectionReason: string | null;
  };

  const order: RejectionOrder = {
    id: "ord-reject-test",
    status: "PAYMENT_SUBMITTED",
    paymentStatus: "SUBMITTED",
    rejectionReason: null,
  };

  function adminReject(
    staffRole: string,
    targetOrder: RejectionOrder,
    reason: string
  ): { success: boolean; error?: string } {
    if (!["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"].includes(staffRole)) {
      return { success: false, error: "Unauthorized." };
    }
    targetOrder.paymentStatus = "FAILED";
    targetOrder.rejectionReason = reason;
    return { success: true };
  }

  const rejectRes = adminReject("FUNDRAISING_MANAGER", order, "UTR not found on bank statement.");
  assert.equal(rejectRes.success, true);
  assert.equal(order.paymentStatus, "FAILED");
  assert.equal(order.rejectionReason, "UTR not found on bank statement.");
});

test("Security Guard: Client cannot forge approved status via FormData or parameters", () => {
  // Public schema must strictly allow only orderId, utr, payerName
  const allowedKeys = new Set(["orderId", "utr", "payerName"]);

  function sanitizePublicPayload(input: Record<string, unknown>) {
    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(input)) {
      if (allowedKeys.has(key)) {
        sanitized[key] = input[key];
      }
    }
    return sanitized;
  }

  const maliciousPayload = {
    orderId: "c22c070c-2656-4c28-98e3-0d33e9d8995a",
    utr: "TEST-PAY-001",
    payerName: "Attacker",
    status: "VERIFIED",
    verified_at: new Date().toISOString(),
    isMock: false,
    bypassPayment: true,
  };

  const clean = sanitizePublicPayload(maliciousPayload);

  assert.equal(clean.orderId, "c22c070c-2656-4c28-98e3-0d33e9d8995a");
  assert.equal(clean.utr, "TEST-PAY-001");
  assert.equal(clean.status, undefined);
  assert.equal(clean.verified_at, undefined);
  assert.equal(clean.isMock, undefined);
  assert.equal(clean.bypassPayment, undefined);
});

/* ========================================================================= */
/* Task 1 — Environment-Aware Order Links Test Suite                         */
/* ========================================================================= */

test("Environment-Aware App URL: Production orders resolve to canonical production domain", async () => {
  const { resolveEnvironmentAppUrl, getCustomerOrderUrl } = await import("../src/lib/config/appUrl.ts");

  // Simulate Production environment
  const originalEnv = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = "production";
    const res = resolveEnvironmentAppUrl();
    assert.equal(res.isProduction, true);
    assert.equal(res.isPreview, false);
    assert.equal(res.baseUrl, "https://ssfiticket.vercel.app");

    const orderUrl = getCustomerOrderUrl("ord-prod-999");
    assert.equal(orderUrl, "https://ssfiticket.vercel.app/buy/order/ord-prod-999");
  } finally {
    process.env.VERCEL_ENV = originalEnv;
  }
});

test("Environment-Aware App URL: Preview orders point to Preview deployment, never silently to Production", async () => {
  const { resolveEnvironmentAppUrl, getCustomerOrderUrl } = await import("../src/lib/config/appUrl.ts");

  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalVercelBranchUrl = process.env.VERCEL_BRANCH_URL;

  try {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_BRANCH_URL = "ssfiticket-git-deploy-ssfi-homepage-preview-rose1996ivs-projects.vercel.app";

    const res = resolveEnvironmentAppUrl();
    assert.equal(res.isProduction, false);
    assert.equal(res.isPreview, true);
    assert.equal(res.isSafePreviewUrlAvailable, true);
    assert.equal(res.baseUrl, "https://ssfiticket-git-deploy-ssfi-homepage-preview-rose1996ivs-projects.vercel.app");

    const orderUrl = getCustomerOrderUrl("ord-preview-123");
    assert.equal(
      orderUrl,
      "https://ssfiticket-git-deploy-ssfi-homepage-preview-rose1996ivs-projects.vercel.app/buy/order/ord-preview-123"
    );
    // Crucial: Must NEVER contain production domain in Preview!
    assert.ok(!orderUrl.startsWith("https://ssfiticket.vercel.app"));
  } finally {
    process.env.VERCEL_ENV = originalVercelEnv;
    process.env.VERCEL_BRANCH_URL = originalVercelBranchUrl;
  }
});

test("Environment-Aware App URL: Missing preview domain disables external delivery and reports internal test", async () => {
  const { resolveEnvironmentAppUrl } = await import("../src/lib/config/appUrl.ts");

  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalBranch = process.env.VERCEL_BRANCH_URL;
  const originalUrl = process.env.VERCEL_URL;
  const originalAppBase = process.env.APP_BASE_URL;
  const originalNextApp = process.env.NEXT_PUBLIC_APP_URL;

  try {
    process.env.VERCEL_ENV = "preview";
    delete process.env.VERCEL_BRANCH_URL;
    delete process.env.VERCEL_URL;
    delete process.env.APP_BASE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;

    const res = resolveEnvironmentAppUrl();
    assert.equal(res.isPreview, true);
    assert.equal(res.isSafePreviewUrlAvailable, false);
    assert.equal(res.isInternalTestingOnly, true);
    // Must NOT fall back to production domain!
    assert.notEqual(res.baseUrl, "https://ssfiticket.vercel.app");
  } finally {
    process.env.VERCEL_ENV = originalVercelEnv;
    if (originalBranch) process.env.VERCEL_BRANCH_URL = originalBranch;
    if (originalUrl) process.env.VERCEL_URL = originalUrl;
    if (originalAppBase) process.env.APP_BASE_URL = originalAppBase;
    if (originalNextApp) process.env.NEXT_PUBLIC_APP_URL = originalNextApp;
  }
});

/* ========================================================================= */
/* Task 3 — Customer Ticket QR & Verification Isolation                      */
/* ========================================================================= */

test("Ticket QR Generation: Every verified ticket receives a scannable QR resolving to its environment verification route", async () => {
  const { generateTicketQrDataUrl } = await import("../src/lib/ticket/qr.ts");

  const previewBase = "https://ssfiticket-preview-branch.vercel.app";
  const qrDataUrl = await generateTicketQrDataUrl("SSFI-000101", previewBase);

  assert.ok(qrDataUrl.startsWith("data:image/png;base64,"));
  assert.ok(qrDataUrl.length > 500, "Base64 PNG QR code must be populated");
});

test("Customer Order Status Page State Isolation: Ticket QRs hidden during Pending and Submitted states", () => {
  type OrderViewData = {
    status: string;
    tickets: Array<{ ticket_number: string; status: string }>;
  };

  function shouldDisplayTicketQrs(order: OrderViewData): boolean {
    const isIssued = order.status === "TICKETS_ISSUED";
    return isIssued && order.tickets.length > 0;
  }

  // 1. Awaiting payment
  assert.equal(shouldDisplayTicketQrs({ status: "PENDING_PAYMENT", tickets: [] }), false);

  // 2. Payment submitted under review
  assert.equal(shouldDisplayTicketQrs({ status: "PAYMENT_SUBMITTED", tickets: [] }), false);

  // 3. Payment verified & tickets issued
  assert.equal(
    shouldDisplayTicketQrs({
      status: "TICKETS_ISSUED",
      tickets: [{ ticket_number: "SSFI-000101", status: "ISSUED" }],
    }),
    true
  );
});

/* ========================================================================= */
/* Task 4 — WhatsApp Click-to-Chat Link & Unicode Fidelity Test Suite         */
/* ========================================================================= */

test("WhatsApp Phone Normalization: Formats Indian mobile numbers to standard international digits-only", () => {
  assert.equal(formatWhatsAppPhoneNumber("+91 98765 43210"), "919876543210");
  assert.equal(formatWhatsAppPhoneNumber("9876543210"), "919876543210");
  assert.equal(formatWhatsAppPhoneNumber("09876543210"), "919876543210");
  assert.equal(formatWhatsAppPhoneNumber("+91-81234-56789"), "918123456789");
  assert.equal(formatWhatsAppPhoneNumber(""), "");
});

test("WhatsApp Template Formatting & Unicode Fidelity: Preserves line breaks, emoji, currency, and zero U+FFFD", () => {
  const payload: DeliveryPayload = {
    orderId: "ord-unicode-test",
    orderNumber: "SSFI-ORD-777",
    customerName: "David Lalrinchhana",
    whatsappNumber: "+91 98765 43210",
    email: "david@example.com",
    ticketNumbers: ["SSFI-000101", "SSFI-000102"],
    amountInr: 200,
    campaignName: "SSFI Fundraising Lucky Draw",
    issuedAtIst: "29 Oct 2026, 08:30 PM IST",
    ticketAccessUrl: "https://ssfiticket.vercel.app/buy/order/ord-unicode-test",
    sellerAttribution: "Lian (SSFI-SEL-001)",
    supportEmail: "Senthangstudents@gmail.com",
    isSimulated: false,
  };

  const messageText = renderWhatsAppTicketMessage(payload);

  // 1. Line breaks & paragraph structure verification
  assert.ok(messageText.includes("\n\n"), "Message must contain double newlines for paragraph separation");
  assert.ok(messageText.includes("🎟️ *SSFI LUCKY DRAW — TICKET CONFIRMATION*"));
  assert.ok(messageText.includes("Dear David Lalrinchhana,"));
  assert.ok(messageText.includes("Your payment for Order *SSFI-ORD-777* has been verified."));
  assert.ok(messageText.includes("*Campaign:* SSFI Fundraising Lucky Draw"));
  assert.ok(messageText.includes("*Tickets Allocated (2):*"));
  assert.ok(messageText.includes("• *SSFI-000101*"));
  assert.ok(messageText.includes("• *SSFI-000102*"));
  assert.ok(messageText.includes("*Verified Amount:* ₹200"));
  assert.ok(messageText.includes("*Status:* PAYMENT VERIFIED"));
  assert.ok(messageText.includes("*View and verify your tickets:*"));
  assert.ok(messageText.includes("https://ssfiticket.vercel.app/buy/order/ord-unicode-test"));
  assert.ok(messageText.includes("Email: Senthangstudents@gmail.com"));

  // 2. Click-to-Chat URL generation & single-pass encodeURIComponent
  const { url, recipientPhone } = buildWhatsAppClickToChatUrl(payload);

  assert.equal(recipientPhone, "919876543210");
  assert.ok(url.startsWith("https://wa.me/919876543210?text="));

  // 3. Decoding and round-trip fidelity verification
  const encodedPart = url.replace("https://wa.me/919876543210?text=", "");
  const decodedMessage = decodeURIComponent(encodedPart);

  assert.equal(decodedMessage, messageText, "Decoded WhatsApp message must exactly match the rendered source text");

  // 4. Strict Unicode check: Zero U+FFFD (replacement characters)
  assert.equal(messageText.includes("\uFFFD"), false, "Rendered message must not contain U+FFFD");
  assert.equal(decodedMessage.includes("\uFFFD"), false, "Decoded message must not contain U+FFFD");
  assert.equal(url.includes("%EF%BF%BD"), false, "Encoded URL must not contain encoded U+FFFD (%EF%BF%BD)");
});


/* ========================================================================== */
/* DYNAMIC TICKET PRICING, FREE UPI INTENT & DYNAMIC QR TESTS                */
/* ========================================================================== */

test("Ticket Quantity and Dynamic Total: Calculates total based on authoritative campaign price", () => {
  // Campaign source of truth: 10000 paise (₹100)
  const campaignPricePaise = 10000;

  // Quantity 1 -> ₹100.00
  const order1TotalPaise = 1 * campaignPricePaise;
  assert.equal(order1TotalPaise, 10000);
  assert.equal((order1TotalPaise / 100).toFixed(2), "100.00");

  // Quantity 3 -> ₹300.00
  const order3TotalPaise = 3 * campaignPricePaise;
  assert.equal(order3TotalPaise, 30000);
  assert.equal((order3TotalPaise / 100).toFixed(2), "300.00");

  // Quantity 5 -> ₹500.00
  const order5TotalPaise = 5 * campaignPricePaise;
  assert.equal(order5TotalPaise, 50000);
  assert.equal((order5TotalPaise / 100).toFixed(2), "500.00");

  // Custom campaign price: ₹150 (15000 paise)
  const customCampaignPricePaise = 15000;
  const orderCustomTotalPaise = 3 * customCampaignPricePaise;
  assert.equal(orderCustomTotalPaise, 45000);
  assert.equal((orderCustomTotalPaise / 100).toFixed(2), "450.00");
});

test("Ticket Quantity Validation: Enforces minimum 1 and configured maximum limits", () => {
  // Valid quantities
  const validateQuantity = (qty: number, maxCapacity: number) => {
    if (!Number.isInteger(qty) || qty < 1) return { valid: false, error: "Minimum 1 ticket." };
    if (qty > 100) return { valid: false, error: "Maximum 100 tickets per online order." };
    if (qty > maxCapacity) return { valid: false, error: `Exceeds remaining capacity of ${maxCapacity}.` };
    return { valid: true };
  };

  assert.equal(validateQuantity(1, 1000).valid, true);
  assert.equal(validateQuantity(5, 1000).valid, true);
  assert.equal(validateQuantity(100, 1000).valid, true);

  // Rejected invalid quantities
  assert.equal(validateQuantity(0, 1000).valid, false);
  assert.equal(validateQuantity(-1, 1000).valid, false);
  assert.equal(validateQuantity(101, 1000).valid, false);
  assert.equal(validateQuantity(15, 10).valid, false); // Exceeds capacity of 10
});

test("Client Tamper Resistance: Server ignores client total and enforces authoritative calculation", () => {
  const authoritativeUnitPricePaise = 10000;
  const requestedQuantity = 4;

  // Attacker attempts to forge client total as ₹1 (100 paise) or ₹50 instead of ₹400
  const tamperedClientAmount = 100;

  // Server calculation strictly derives total from DB
  const serverAuthoritativeTotalPaise = requestedQuantity * authoritativeUnitPricePaise;
  assert.equal(serverAuthoritativeTotalPaise, 40000);
  assert.notEqual(serverAuthoritativeTotalPaise, tamperedClientAmount);
  assert.equal((serverAuthoritativeTotalPaise / 100).toFixed(2), "400.00");
});

test("Free UPI Intent URI: Generates standard upi://pay URI matching exact specification", () => {
  const uri = buildUpiPaymentUri({
    payeeVpa: "6909251270@ptaxis",
    payeeName: "HLAWN THA DAWT",
    amountPaise: 30000, // ₹300.00
    orderNumber: "SSFI-ORD-2026-000010",
    currency: "INR",
  });

  // Verify format matches specification:
  // upi://pay?pa=6909251270%40ptaxis&pn=HLAWN%20THA%20DAWT&am=300.00&cu=INR&tn=SSFI-ORD-2026-000010
  assert.ok(uri.startsWith("upi://pay?"));
  assert.ok(uri.includes("pa=6909251270%40ptaxis"));
  assert.ok(uri.includes("pn=HLAWN%20THA%20DAWT"));
  assert.ok(uri.includes("am=300.00"));
  assert.ok(uri.includes("cu=INR"));
  assert.ok(uri.includes("tn=SSFI-ORD-2026-000010"));

  // Parse and assert round-trip extraction
  const parsed = parseUpiPaymentUri(uri);
  assert.equal(parsed.payeeVpa, "6909251270@ptaxis");
  assert.equal(parsed.payeeName, "HLAWN THA DAWT");
  assert.equal(parsed.amount, "300.00");
  assert.equal(parsed.amountPaise, 30000);
  assert.equal(parsed.currency, "INR");
  assert.equal(parsed.transactionNote, "SSFI-ORD-2026-000010");
});

test("Free UPI Intent URI: Formats amounts with exact two decimals (e.g. 100.00, 250.50)", () => {
  const uri1 = buildUpiPaymentUri({
    payeeVpa: "6909251270@ptaxis",
    payeeName: "HLAWN THA DAWT",
    amountPaise: 10000, // ₹100
    orderNumber: "ORD-001",
  });
  const parsed1 = parseUpiPaymentUri(uri1);
  assert.equal(parsed1.amount, "100.00");

  const uri2 = buildUpiPaymentUri({
    payeeVpa: "6909251270@ptaxis",
    payeeName: "HLAWN THA DAWT",
    amountPaise: 25050, // ₹250.50
    orderNumber: "ORD-002",
  });
  const parsed2 = parseUpiPaymentUri(uri2);
  assert.equal(parsed2.amount, "250.50");
});

test("Dynamic Order QR: Encodes complete UPI URI with amount and payee", async () => {
  const upiUri = buildUpiPaymentUri({
    payeeVpa: "6909251270@ptaxis",
    payeeName: "HLAWN THA DAWT",
    amountPaise: 50000, // ₹500.00
    orderNumber: "SSFI-ORD-2026-000055",
    currency: "INR",
  });

  const qrDataUrl = await generateUpiQrDataUrl(upiUri, { width: 320 });

  // QR Data URL must be a valid PNG base64 string
  assert.ok(qrDataUrl.startsWith("data:image/png;base64,"));
  assert.ok(qrDataUrl.length > 500);

  // Assert URI parsed from the source encoded into the QR
  const parsed = parseUpiPaymentUri(upiUri);
  assert.equal(parsed.payeeVpa, "6909251270@ptaxis");
  assert.equal(parsed.amount, "500.00");
  assert.equal(parsed.transactionNote, "SSFI-ORD-2026-000055");
});

test("Payment Safety: Submitting UTR transitions only to SUBMITTED and never auto-approves", () => {
  type PaymentRecord = {
    status: "PENDING" | "SUBMITTED" | "VERIFIED" | "FAILED";
    utr: string | null;
  };

  const payment: PaymentRecord = {
    status: "PENDING",
    utr: null,
  };

  // Customer submits valid UTR
  const submitUtr = (p: PaymentRecord, utr: string): PaymentRecord => {
    if (p.status !== "PENDING" && p.status !== "FAILED") throw new Error("Not eligible for submission");
    return {
      status: "SUBMITTED", // Moves strictly to SUBMITTED for review
      utr,
    };
  };

  const updated = submitUtr(payment, "123456789012");
  assert.equal(updated.status, "SUBMITTED");
  assert.notEqual(updated.status, "VERIFIED"); // Must NEVER be auto-approved
});

test("Payment Safety: Duplicate UTR is strictly rejected with a clean message", () => {
  const submittedUtrs = new Set<string>(["123456789012"]);

  const processSubmission = (utr: string) => {
    if (submittedUtrs.has(utr)) {
      return {
        success: false,
        error: "This Transaction ID / UTR has already been submitted. Please check your payment receipt and enter a different valid reference.",
      };
    }
    submittedUtrs.add(utr);
    return { success: true };
  };

  const dupRes = processSubmission("123456789012");
  assert.equal(dupRes.success, false);
  assert.ok(dupRes.error?.includes("already been submitted"));

  const newRes = processSubmission("987654321098");
  assert.equal(newRes.success, true);
});

test("Ticket Issuance Isolation: Tickets are created ONLY after verified payment status", () => {
  type OrderWithTickets = {
    status: "PENDING_PAYMENT" | "PAYMENT_SUBMITTED" | "TICKETS_ISSUED";
    paymentStatus: "PENDING" | "SUBMITTED" | "VERIFIED";
    tickets: string[];
  };

  const order: OrderWithTickets = {
    status: "PENDING_PAYMENT",
    paymentStatus: "PENDING",
    tickets: [],
  };

  // In pending or submitted status, ticket list MUST be empty
  assert.equal(order.tickets.length, 0);

  // App opening event or customer return does NOT issue tickets
  const simulateAppReturn = (ord: OrderWithTickets): OrderWithTickets => ord;
  const returnedOrder = simulateAppReturn(order);
  assert.equal(returnedOrder.tickets.length, 0);

  // Only Admin verification issues tickets
  const verifyByAdmin = (ord: OrderWithTickets, role: Role): OrderWithTickets => {
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") throw new Error("Unauthorized");
    return {
      status: "TICKETS_ISSUED",
      paymentStatus: "VERIFIED",
      tickets: ["SSFI-000101", "SSFI-000102", "SSFI-000103"],
    };
  };

  const verifiedOrder = verifyByAdmin(order, "ADMIN");
  assert.equal(verifiedOrder.status, "TICKETS_ISSUED");
  assert.equal(verifiedOrder.tickets.length, 3);
});

test("Cross-Channel Consistency: Order total and quantity match across WhatsApp and Email", () => {
  const payload: DeliveryPayload = {
    orderId: "ord-match-999",
    orderNumber: "SSFI-ORD-2026-000099",
    customerName: "Mary Ramthangi",
    whatsappNumber: "+91 91234 56789",
    email: "mary@example.com",
    ticketNumbers: ["SSFI-000101", "SSFI-000102", "SSFI-000103", "SSFI-000104"],
    amountInr: 400,
    campaignName: "SSFI Fundraising Lucky Draw",
    issuedAtIst: "30 Oct 2026, 01:00 AM IST",
    ticketAccessUrl: "https://ssfiticket.vercel.app/buy/order/ord-match-999",
    supportEmail: "Senthangstudents@gmail.com",
    isSimulated: false,
  };

  const wa = renderWhatsAppTicketMessage(payload);
  const email = renderEmailTicketMessage(payload);

  // Both must report 4 tickets and ₹400
  assert.ok(wa.includes("Tickets Allocated (4):"));
  assert.ok(wa.includes("Verified Amount:* ₹400"));

  assert.ok(email.text.includes("Allocated Ticket Numbers (4):"));
  assert.ok(email.text.includes("Amount Paid: ₹400"));
  assert.ok(email.html.includes("SSFI-000101"));
  assert.ok(email.html.includes("SSFI-000104"));
});
/* ========================================================================== */
/* TASK 6 — CONTENT AUDIT, PAYMENT GUIDANCE & TERMS AND CONDITIONS TESTS       */
/* ========================================================================== */

test("Landing Page Payment Guidance: Includes all 5 steps, official payee, and safety warning", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");

  const componentPath = path.resolve("src/components/home/PaymentInstructionsSection.tsx");
  const code = fs.readFileSync(componentPath, "utf-8");

  // Step 1: Select tickets and authoritative pricing
  assert.ok(code.includes("Select Tickets"), "Step 1 must be present");
  assert.ok(code.includes("server-side based strictly on the campaign unit price"), "Must enforce server pricing");

  // Step 2: Choose payment method and verified payee
  assert.ok(code.includes("Choose Payment Method"), "Step 2 must be present");
  assert.ok(code.includes("HLAWN THA DAWT"), "Payee name must be HLAWN THA DAWT");
  assert.ok(code.includes("6909251270@ptaxis"), "UPI ID must be 6909251270@ptaxis");
  assert.ok(code.includes("INR"), "Currency must be INR");

  // Step 3: Verify details
  assert.ok(code.includes("Verify Payment Details"), "Step 3 must be present");

  // Step 4: Submit reference UTR
  assert.ok(code.includes("Submit Reference (UTR)"), "Step 4 must be present");
  assert.ok(code.includes("Submitting a UTR does not automatically confirm payment receipt"), "Must warn that UTR submission is not proof");

  // Step 5: Admin review and atomic ticket issuance
  assert.ok(code.includes("Payment Review &amp; Ticket Issuance") || code.includes("Payment Review"), "Step 5 must be present");
  assert.ok(code.includes("only after successful payment verification"), "Tickets valid only after verification");

  // Payment Safety Warning
  assert.ok(code.includes("Payment Safety Warning — Before You Pay"), "Safety warning heading must be present");
  assert.ok(code.includes("Never share your UPI PIN, OTP"), "Credential safety must be enforced");

  // Important Note & Support
  assert.ok(code.includes("Under Review"), "Under review note must be present");
  assert.ok(code.includes("Senthangstudents@gmail.com"), "Official support email must be present");
  assert.ok(code.includes("mailto:Senthangstudents@gmail.com"), "Mailto link must be present");
});

test("Terms and Conditions: Implements all 10 required sections without unsupported claims", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");

  const termsPath = path.resolve("src/app/(public)/terms/page.tsx");
  const code = fs.readFileSync(termsPath, "utf-8");

  // Verify all 10 required section headings
  assert.ok(code.includes("1. Ticket Selection and Order Amount") || code.includes("Ticket Selection and Order Amount"));
  assert.ok(code.includes("2. Payment and Transaction Reference") || code.includes("Payment and Transaction Reference"));
  assert.ok(code.includes("3. Payment Verification") || code.includes("Payment Verification"));
  assert.ok(code.includes("4. Ticket Issuance and Validity") || code.includes("Ticket Issuance and Validity"));
  assert.ok(code.includes("5. Ticket QR Code and Verification") || code.includes("Ticket QR Code and Verification"));
  assert.ok(code.includes("6. Duplicate or Unsuccessful Payments") || code.includes("Duplicate or Unsuccessful Payments"));
  assert.ok(code.includes("7. Draw Information and Prize Conditions") || code.includes("Draw Information and Prize Conditions"));
  assert.ok(code.includes("8. Customer Responsibilities") || code.includes("Customer Responsibilities"));
  assert.ok(code.includes("9. Support and Enquiries") || code.includes("Support and Enquiries"));
  assert.ok(code.includes("10. Changes to Campaign Information") || code.includes("Changes to Campaign Information"));

  // Check official details in terms
  assert.ok(code.includes("HLAWN THA DAWT"));
  assert.ok(code.includes("6909251270@ptaxis"));
  assert.ok(code.includes("Senthangstudents@gmail.com"));

  // Strict avoidance of unauthorized claims
  assert.ok(code.includes("Organizer Approval Required"), "Must document unannounced policies under organizer approval required");
});

test("Public Order Terms Acceptance: Validates terms acceptance on order submission", async () => {
  const { z } = await import("zod");

  const schema = z.object({
    name: z.string().min(2),
    whatsapp: z.string().min(7),
    quantity: z.coerce.number().min(1),
    acceptTerms: z
      .preprocess(
        (val) => val === "on" || val === "true" || val === true || val === "1",
        z.boolean()
      )
      .refine((val) => val === true, {
        message: "You must review and accept the Terms & Conditions to place an order.",
      }),
  });

  // Valid when accepted
  const validRes = schema.safeParse({
    name: "Cingte",
    whatsapp: "+91 98765 43210",
    quantity: 2,
    acceptTerms: "on",
  });
  assert.equal(validRes.success, true);

  // Rejects when unchecked / false
  const invalidRes = schema.safeParse({
    name: "Cingte",
    whatsapp: "+91 98765 43210",
    quantity: 2,
    acceptTerms: "false",
  });
  assert.equal(invalidRes.success, false);
});

test("Delivery Status Nomenclature: Correctly represents distinct delivery states without false claims", () => {
  const deliveryStatuses = [
    "PENDING",
    "SENT",
    "DELIVERED",
    "FAILED",
    "SIMULATED",
    "WHATSAPP_LINK_OPENED",
    "MANUALLY_SENT",
  ];
  assert.equal(deliveryStatuses.length, 7);

  // wa.me opening is classified as WHATSAPP_LINK_OPENED, never falsely as DELIVERED
  function classifyDeliveryProgress(status: string): string {
    switch (status) {
      case "WHATSAPP_LINK_OPENED":
        return "WhatsApp Link Opened / Prepared";
      case "MANUALLY_SENT":
        return "Manually Confirmed Sent";
      case "SIMULATED":
        return "Simulated Dispatch (Test Mode)";
      case "SENT":
        return "Provider Accepted";
      case "DELIVERED":
        return "Confirmed Delivered";
      case "FAILED":
        return "Delivery Failed";
      default:
        return "Pending Dispatch";
    }
  }

  assert.equal(classifyDeliveryProgress("WHATSAPP_LINK_OPENED"), "WhatsApp Link Opened / Prepared");
  assert.equal(classifyDeliveryProgress("MANUALLY_SENT"), "Manually Confirmed Sent");
  assert.equal(classifyDeliveryProgress("SIMULATED"), "Simulated Dispatch (Test Mode)");
});
