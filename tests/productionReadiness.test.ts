import test from "node:test";
import assert from "node:assert/strict";
import { isMockPaymentMode, manualUpiConfig } from "../src/lib/config/payment.ts";
import {
  renderEmailTicketMessage,
  renderWhatsAppTicketMessage,
} from "../src/lib/delivery/templates.ts";
import {
  formatDeliveryStatusLabel,
  type DeliveryPayload,
} from "../src/lib/delivery/types.ts";

test("Area 1: isMockPaymentMode fail-closed guard in Production", () => {
  const origVercelEnv = process.env.VERCEL_ENV;
  const origNextPublicVercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  const origMockPayments = process.env.NEXT_PUBLIC_MOCK_PAYMENTS;

  try {
    // Even if NEXT_PUBLIC_MOCK_PAYMENTS was mistakenly set to "true",
    // VERCEL_ENV="production" MUST override and force false!
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_MOCK_PAYMENTS = "true";
    assert.equal(isMockPaymentMode(), false, "Production must NEVER allow mock payments");

    process.env.VERCEL_ENV = "preview";
    process.env.NEXT_PUBLIC_MOCK_PAYMENTS = "true";
    assert.equal(isMockPaymentMode(), true, "Preview environment permits mock mode");

    process.env.VERCEL_ENV = "preview";
    process.env.NEXT_PUBLIC_MOCK_PAYMENTS = "false";
    assert.equal(isMockPaymentMode(), false, "Preview environment respects explicit false");
  } finally {
    process.env.VERCEL_ENV = origVercelEnv;
    process.env.NEXT_PUBLIC_VERCEL_ENV = origNextPublicVercelEnv;
    process.env.NEXT_PUBLIC_MOCK_PAYMENTS = origMockPayments;
  }
});

test("Area 1: Official UPI credentials and support details are production-accurate", () => {
  assert.equal(manualUpiConfig.upiId, "6909251270@ptaxis");
  assert.equal(manualUpiConfig.displayName, "HLAWN THA DAWT");
  assert.equal(manualUpiConfig.currency, "INR");
  assert.equal(manualUpiConfig.supportEmail, "Senthangstudents@gmail.com");
  assert.equal(manualUpiConfig.qrImagePath, "/upi_qr.jpeg");
});

test("Area 3: Email delivery templates suppress simulation banner in Production", () => {
  const origVercelEnv = process.env.VERCEL_ENV;
  const origNextPublicVercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;

  try {
    const payload: DeliveryPayload = {
      orderId: "c253d72a-1111-4444-8888-123456789abc",
      orderNumber: "SSFI-2026-TEST",
      customerName: "Lalnunmawia",
      whatsappNumber: "+919876543210",
      email: "customer@example.com",
      ticketNumbers: ["SSFI-000001", "SSFI-000002", "SSFI-000003"],
      amountInr: 1500,
      campaignName: "SSFI Lucky Draw 2026",
      issuedAtIst: "31 Oct 2026, 15:30 IST",
      ticketAccessUrl: "https://ssfiticket.vercel.app/buy/order/c253d72a-1111-4444-8888-123456789abc",
      isSimulated: true,
    };

    // 1. In Preview / Dev with isSimulated: true, banner is visible
    process.env.VERCEL_ENV = "preview";
    process.env.NEXT_PUBLIC_VERCEL_ENV = "preview";
    const previewEmail = renderEmailTicketMessage(payload);
    assert.ok(
      previewEmail.html.includes("Development Mode Notice"),
      "Preview should render notice when simulated"
    );

    // 2. In Production, banner MUST NEVER be rendered even if payload.isSimulated was true!
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_VERCEL_ENV = "production";
    const prodEmail = renderEmailTicketMessage(payload);
    assert.ok(
      !prodEmail.html.includes("Development Mode Notice"),
      "Production must NEVER render Development Mode Notice"
    );
    assert.ok(
      prodEmail.html.includes("19 December 2026"),
      "Production email must state confirmed draw date: 19 December 2026"
    );
    assert.ok(
      prodEmail.html.includes("SSFI-000001") &&
        prodEmail.html.includes("SSFI-000002") &&
        prodEmail.html.includes("SSFI-000003"),
      "All multi-ticket numbers must be rendered in email"
    );
    assert.ok(
      prodEmail.html.includes("Senthangstudents@gmail.com"),
      "Official support email must be present"
    );
  } finally {
    process.env.VERCEL_ENV = origVercelEnv;
    process.env.NEXT_PUBLIC_VERCEL_ENV = origNextPublicVercelEnv;
  }
});

test("Area 4: WhatsApp confirmation template formatting and links", () => {
  const payload: DeliveryPayload = {
    orderId: "d412e83b-2222-5555-9999-abcdef123456",
    orderNumber: "SSFI-2026-MULTI",
    customerName: "Biakzuala",
    whatsappNumber: "+919876543210",
    email: "supporter@example.com",
    ticketNumbers: ["SSFI-000101", "SSFI-000102"],
    amountInr: 1000,
    campaignName: "SSFI Lucky Draw 2026",
    issuedAtIst: "31 Oct 2026, 16:00 IST",
    ticketAccessUrl: "https://ssfiticket.vercel.app/buy/order/d412e83b-2222-5555-9999-abcdef123456",
    isSimulated: false,
  };

  const message = renderWhatsAppTicketMessage(payload);
  assert.ok(message.includes("SSFI LUCKY DRAW — TICKET CONFIRMATION"));
  assert.ok(message.includes("Dear Biakzuala,"));
  assert.ok(message.includes("19 December 2026"));
  assert.ok(message.includes("SSFI-000101"));
  assert.ok(message.includes("SSFI-000102"));
  assert.ok(message.includes("/verify/SSFI-000101"));
  assert.ok(message.includes("/verify/SSFI-000102"));
  assert.ok(message.includes("Senthangstudents@gmail.com"));
});

test("Area 4: formatDeliveryStatusLabel accurately formats labels across channels and actions", () => {
  // PENDING state
  assert.equal(formatDeliveryStatusLabel("PENDING", "WHATSAPP"), "Prepared");
  assert.equal(formatDeliveryStatusLabel("PENDING", "EMAIL"), "Email Queued");

  // SENT state
  assert.equal(formatDeliveryStatusLabel("SENT", "EMAIL"), "Provider/API Accepted");

  // DELIVERED state for WHATSAPP
  assert.equal(formatDeliveryStatusLabel("DELIVERED", "WHATSAPP"), "Manually Confirmed Sent");
  assert.equal(formatDeliveryStatusLabel("DELIVERED", "EMAIL"), "Delivery Confirmed");

  // Granular action metadata support
  assert.equal(
    formatDeliveryStatusLabel("PENDING", "WHATSAPP", { whatsapp_action: "WHATSAPP_LINK_OPENED" }),
    "WhatsApp Link Opened"
  );
  assert.equal(
    formatDeliveryStatusLabel("DELIVERED", "WHATSAPP", { whatsapp_action: "MANUALLY_SENT" }),
    "Manually Confirmed Sent"
  );

  // FAILED state
  assert.equal(formatDeliveryStatusLabel("FAILED", "WHATSAPP"), "Failed");
  assert.equal(formatDeliveryStatusLabel("SIMULATED", "EMAIL"), "Simulated (Preview Test)");
});
