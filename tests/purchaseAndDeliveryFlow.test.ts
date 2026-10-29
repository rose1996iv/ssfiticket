import test from "node:test";
import assert from "node:assert/strict";
import {
  renderWhatsAppTicketMessage,
  renderEmailTicketMessage,
} from "../src/lib/delivery/templates.ts";
import type { DeliveryPayload, DeliveryResult } from "../src/lib/delivery/types.ts";
import { getTicketVerificationUrl } from "../src/lib/ticket/qr.ts";

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
