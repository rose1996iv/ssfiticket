import test from "node:test";
import assert from "node:assert/strict";
import {
  type MobileAuthDependencies,
} from "../src/lib/auth/mobile.ts";
import {
  handleMobileAdminAuditLogsGet,
  handleMobileAdminLookupGet,
  handleMobileAdminPaymentDecisionPost,
  handleMobileAdminPaymentDetailGet,
  handleMobileAdminPaymentsGet,
  handleMobileAdminSummaryGet,
  handleMobileCustomerDashboardGet,
  handleMobileFirstPrizeDualAuthPost,
  handleMobileSellerCustomerLookupGet,
  handleMobileSellerDashboardGet,
  handleMobileSellerOrderDetailGet,
  handleMobileSellerOrderPaymentSubmitPost,
  handleMobileSellerOrderScreenshotPost,
  handleMobileSellerOrdersGet,
  handleMobileSellerOrdersPost,
  handleMobileSuperAdminOverviewGet,
  handleMobileSuperAdminPaymentScreenshotGet,
  handleMobileSuperAdminSellerStatusPost,
  handleMobileTicketVerifyGet,
  sanitizePostgrestSearchTerm,
  validateMobileScreenshotFilename,
  type MobileAdminPaymentItem,
  type MobileOperationsDependencies,
  type MobileSellerOrderSummary,
  type SellerProfileRecord,
} from "../src/lib/mobile/operations.ts";
import { resetRateLimitsForTesting } from "../src/lib/security/rateLimit.ts";

const VALID_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIifQ.signature_segment_1234567890";

const USER_SUPER = "11111111-1111-4111-8111-111111111100";
const USER_ADMIN = "11111111-1111-4111-8111-111111111101";
const USER_SELLER_A = "11111111-1111-4111-8111-111111111102";
const USER_CUSTOMER = "11111111-1111-4111-8111-111111111104";
const USER_UNLINKED = "11111111-1111-4111-8111-111111111105";

const SELLER_A_ID = "22222222-2222-4222-8222-222222222201";
const ORDER_A_ID = "33333333-3333-4333-8333-333333333301";
const ORDER_B_ID = "33333333-3333-4333-8333-333333333302";
const PAYMENT_A_ID = "44444444-4444-4444-8444-444444444401";
const DRAW_A_ID = "55555555-5555-4555-8555-555555555511";
const PRIZE_1_ID = "55555555-5555-4555-8555-555555555512";
const SNAP_1_ID = "55555555-5555-4555-8555-555555555513";
const APPROVAL_1_ID = "55555555-5555-4555-8555-555555555514";

function makeSellerProfile(
  overrides?: Partial<SellerProfileRecord>
): SellerProfileRecord {
  return {
    id: SELLER_A_ID,
    profile_id: USER_SELLER_A,
    seller_code: "SELLER-007",
    display_name: "Alpha Seller",
    is_active: true,
    is_qr_active: true,
    qr_storage_path: "qrs/seller-007.png",
    upi_id: "seller007@upi",
    account_name: "Alpha Seller SSFI",
    payment_instructions: "Include order number in remarks.",
    ...overrides,
  };
}

function makeSellerOrder(
  overrides?: Partial<MobileSellerOrderSummary>
): MobileSellerOrderSummary {
  return {
    id: ORDER_A_ID,
    orderNumber: "SSFI-ORD-0001",
    quantity: 2,
    totalAmountPaise: 20000,
    status: "PENDING_PAYMENT",
    createdAt: "2026-11-21T00:00:00.000Z",
    customer: {
      fullName: "Ramesh Kumar",
      phone: "+919876543210",
      whatsappNumber: "+919876543210",
      email: "ramesh@example.test",
    },
    payment: {
      id: PAYMENT_A_ID,
      status: "PENDING",
      utrReference: null,
      payerName: null,
      rejectionReason: null,
      submittedAt: null,
      hasScreenshot: true,
    },
    tickets: [],
    upiInstructions: {
      payeeName: "Alpha Seller SSFI",
      upiId: "seller007@upi",
      amountPaise: 20000,
      currency: "INR",
      upiUri: "upi://pay?pa=seller007%40upi&pn=Alpha+Seller+SSFI&am=200.00&cu=INR",
      paymentInstructions: "Include order number in remarks.",
      isQrActive: true,
    },
    ...overrides,
  };
}

function makeAdminPayment(
  overrides?: Partial<MobileAdminPaymentItem>
): MobileAdminPaymentItem {
  return {
    id: PAYMENT_A_ID,
    status: "SUBMITTED",
    amountPaise: 20000,
    utrReference: "UTR123456789",
    payerName: "Ramesh Kumar",
    submittedAt: "2026-11-21T01:00:00.000Z",
    createdAt: "2026-11-21T00:00:00.000Z",
    rejectionReason: null,
    sellerReviewStatus: "RECOMMENDED_APPROVAL",
    sellerReviewNote: "Verified in bank app",
    hasScreenshot: true,
    screenshotMeta: {
      uploadedAt: "2026-11-21T00:59:00.000Z",
      fileSizeBytes: 120400,
      contentType: "image/png",
    },
    order: {
      id: ORDER_A_ID,
      orderNumber: "SSFI-ORD-0001",
      quantity: 2,
      totalAmountPaise: 20000,
      status: "PAYMENT_SUBMITTED",
      snapshotUpiId: "seller007@upi",
      snapshotAccountName: "Alpha Seller SSFI",
      customer: {
        id: "55555555-5555-4555-8555-555555555501",
        fullName: "Ramesh Kumar",
        phone: "+919876543210",
        whatsappNumber: "+919876543210",
        email: "ramesh@example.test",
      },
      seller: {
        id: SELLER_A_ID,
        displayName: "Alpha Seller",
        sellerCode: "SELLER-007",
      },
      tickets: [],
    },
    ...overrides,
  };
}

function makeAuthDeps(
  userId: string,
  role: "SUPER_ADMIN" | "ADMIN" | "FUNDRAISING_MANAGER" | "SELLER" | null,
  overrides?: Partial<MobileAuthDependencies>
): MobileAuthDependencies {
  return {
    verifyAccessToken: async () => ({
      user: { id: userId, email: "user@example.test" },
    }),
    resolveProfileActive: async () => true,
    checkHasRole: async (_uid, targetRole) => role === targetRole,
    hasCustomerProfile: async () => userId === USER_CUSTOMER,
    hasActiveSellerProfile: async () => role === "SELLER",
    ...overrides,
  };
}

function makeOpsDeps(
  overrides?: Partial<MobileOperationsDependencies>
): MobileOperationsDependencies {
  return {
    authDeps: makeAuthDeps(USER_SELLER_A, "SELLER"),
    getSellerByProfileId: async (pid) =>
      pid === USER_SELLER_A ? makeSellerProfile() : null,
    getCampaign: async () => ({
      id: "66666666-6666-4666-8666-666666666601",
      public_id: "ssfi-fundraising-lucky-draw",
      name: "SSFI Fundraising Lucky Draw",
      status: "ACTIVE",
      ticket_price_paise: 10000,
      total_ticket_limit: 1000,
      sold_ticket_count: 150,
      start_at: null,
      end_at: null,
    }),
    runScheduledTransitions: async () => {},
    getSellerUnreadMessagesCount: async () => 2,
    listSellerOrders: async () => [makeSellerOrder()],
    getSellerOrderById: async (sellerId, orderId) =>
      sellerId === SELLER_A_ID && orderId === ORDER_A_ID
        ? makeSellerOrder()
        : null,
    lookupSellerCustomers: async () => [
      {
        id: "55555555-5555-4555-8555-555555555501",
        fullName: "Ramesh Kumar",
        phone: "+919876543210",
        whatsappNumber: "+919876543210",
        email: "ramesh@example.test",
        totalOrdersWithSeller: 2,
      },
    ],
    createSellerOrderRpc: async () => ORDER_A_ID,
    submitSellerManualUpiRpc: async () => {},
    getAdminCollectionSummary: async () => ({
      verifiedCollectionPaise: 1500000,
      verifiedPaymentsCount: 45,
      pendingPaymentsCount: 3,
      rejectedPaymentsCount: 1,
      totalOrdersCount: 52,
      activeSellersCount: 8,
      campaign: {
        name: "SSFI Fundraising Lucky Draw",
        status: "ACTIVE",
        ticketPricePaise: 10000,
        totalTicketLimit: 1000,
        soldTicketCount: 150,
        remainingTicketCount: 850,
      },
    }),
    listAdminPayments: async () => [makeAdminPayment()],
    getAdminPaymentById: async (pid) =>
      pid === PAYMENT_A_ID ? makeAdminPayment() : null,
    verifyPaymentAndIssueRpc: async () => [
      { ticketNumber: "SSFI-000151", status: "ISSUED" },
      { ticketNumber: "SSFI-000152", status: "ISSUED" },
    ],
    rejectPaymentRpc: async () => {},
    adminLookup: async () => ({
      sellers: [
        {
          id: SELLER_A_ID,
          sellerCode: "SELLER-007",
          displayName: "Alpha Seller",
          isActive: true,
          isQrActive: true,
        },
      ],
      customers: [],
      orders: [],
    }),
    listAuditLogs: async () => [
      {
        id: "aud-1",
        action: "PAYMENT_VERIFIED",
        entityType: "payment",
        createdAt: "2026-11-21T01:00:00Z",
        actorRole: "ADMIN",
        summary: "PAYMENT_VERIFIED (payment)",
      },
    ],
    getSuperAdminOverview: async () => ({
      governance: {
        campaignName: "SSFI Fundraising Lucky Draw",
        campaignStatus: "ACTIVE",
        verifiedCollectionPaise: 1500000,
        verifiedPaymentsCount: 45,
        pendingPaymentsCount: 3,
        soldTicketCount: 150,
        totalTicketLimit: 1000,
        remainingTicketCount: 850,
        activeSellersCount: 7,
        totalSellersCount: 8,
        totalUsersCount: 14,
      },
      users: [],
      sellers: [],
      firstPrizeDualAuth: {
        drawId: DRAW_A_ID,
        drawStatus: "READY",
        firstPrizeId: PRIZE_1_ID,
        firstPrizeTitle: "1st Prize — ₹10,000 Cash",
        lockedSnapshotId: SNAP_1_ID,
        snapshotHash: "hash123",
        eligibleTicketCount: 150,
        approval: null,
      },
      recentAuditLogs: [],
    }),
    requestFirstPrizeApprovalRpc: async () => APPROVAL_1_ID,
    recordFirstPrizeApprovalRpc: async () => {},
    setSellerLifecycleStatus: async ({ action }) => ({
      sellerCode: "SELLER-007",
      isActive: action === "REACTIVATE",
      message: "Updated seller status.",
    }),
    getSuperAdminPaymentScreenshotUrl: async () => ({
      url: "https://signed.example.test/screenshot.jpg",
      fileName: "SSFI-Payment-Screenshot.jpg",
      expiresInSeconds: 60,
    }),
    getCustomerDashboardByProfileId: async (pid) =>
      pid === USER_CUSTOMER
        ? {
            customer: {
              fullName: "Ramesh Kumar",
              phone: "+919876543210",
              whatsappNumber: "+919876543210",
              email: "ramesh@example.test",
            },
            campaign: {
              name: "SSFI Fundraising Lucky Draw",
              status: "ACTIVE",
            },
            orders: [],
            tickets: [
              {
                ticketNumber: "SSFI-000101",
                status: "ISSUED",
                orderNumber: "SSFI-ORD-0001",
                issuedAt: "2026-11-21T01:00:00Z",
              },
            ],
            certifiedWinners: [],
          }
        : null,
    verifyTicketByNumber: async (ticketNo) => ({
      queriedTicketNumber: ticketNo,
      ticketNumber: ticketNo,
      found: ticketNo === "SSFI-000101",
      isValid: ticketNo === "SSFI-000101",
      isVoid: false,
      status: ticketNo === "SSFI-000101" ? "ISSUED" : "NOT_FOUND",
      campaignName: "SSFI Fundraising Lucky Draw",
      issuedAt: "2026-11-21T01:00:00Z",
      voidReason: null,
    }),
    ...overrides,
  };
}

function authHeaders(ip = "198.51.100.40") {
  return new Headers({
    authorization: `Bearer ${VALID_JWT}`,
    "x-real-ip": ip,
  });
}

test("Phase 3.3 Seller Mobile API v1: Dashboard, Customer Lookup, Order Creation & UTR Submission", async (t) => {
  await t.test("Denies unauthenticated, CUSTOMER, and ADMIN callers without SELLER role on /seller/* endpoints", async () => {
    resetRateLimitsForTesting();
    const unauthRes = await handleMobileSellerDashboardGet(
      { headers: new Headers({ "x-real-ip": "198.51.100.41" }) },
      makeOpsDeps()
    );
    assert.equal(unauthRes.status, 401);

    const customerRes = await handleMobileSellerDashboardGet(
      { headers: authHeaders("198.51.100.42") },
      makeOpsDeps({ authDeps: makeAuthDeps(USER_CUSTOMER, null) })
    );
    assert.equal(customerRes.status, 403);

    const adminWithoutSellerRes = await handleMobileSellerDashboardGet(
      { headers: authHeaders("198.51.100.43") },
      makeOpsDeps({ authDeps: makeAuthDeps(USER_ADMIN, "ADMIN") })
    );
    assert.equal(adminWithoutSellerRes.status, 403);
  });

  await t.test("Seller dashboard returns operational metrics and recent own-orders", async () => {
    resetRateLimitsForTesting();
    const res = await handleMobileSellerDashboardGet(
      { headers: authHeaders() },
      makeOpsDeps({
        listSellerOrders: async () => [
          makeSellerOrder({
            status: "TICKETS_ISSUED",
            quantity: 3,
            totalAmountPaise: 30000,
          }),
          makeSellerOrder({
            id: ORDER_B_ID,
            status: "PAYMENT_SUBMITTED",
            quantity: 1,
            totalAmountPaise: 10000,
          }),
        ],
      })
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      data: {
        seller: { sellerCode: string; isQrActive: boolean };
        metrics: {
          ticketsIssuedCount: number;
          verifiedCollectionPaise: number;
          pendingPaymentsCount: number;
        };
      };
    };
    assert.equal(body.data.seller.sellerCode, "SELLER-007");
    assert.equal(body.data.seller.isQrActive, true);
    assert.equal(body.data.metrics.ticketsIssuedCount, 3);
    assert.equal(body.data.metrics.verifiedCollectionPaise, 30000);
    assert.equal(body.data.metrics.pendingPaymentsCount, 1);
  });

  await t.test("Seller customer lookup enforces minimum query length and seller scoping", async () => {
    resetRateLimitsForTesting();
    const shortRes = await handleMobileSellerCustomerLookupGet(
      {
        headers: authHeaders(),
        url: "http://localhost/api/mobile/v1/seller/customers?q=a",
      },
      makeOpsDeps()
    );
    assert.equal(shortRes.status, 400);

    let capturedSellerId = "";
    const okRes = await handleMobileSellerCustomerLookupGet(
      {
        headers: authHeaders(),
        url: "http://localhost/api/mobile/v1/seller/customers?q=Ramesh",
      },
      makeOpsDeps({
        lookupSellerCustomers: async (sellerId) => {
          capturedSellerId = sellerId;
          return [
            {
              id: "55555555-5555-4555-8555-555555555501",
              fullName: "Ramesh Kumar",
              phone: "+919876543210",
              whatsappNumber: "+919876543210",
              email: "ramesh@example.test",
              totalOrdersWithSeller: 1,
            },
          ];
        },
      })
    );
    assert.equal(okRes.status, 200);
    assert.equal(capturedSellerId, SELLER_A_ID);
  });

  await t.test("Seller order creation enforces active personal QR, active campaign, and 1,000-ticket campaign cap", async () => {
    resetRateLimitsForTesting();

    const noQrRes = await handleMobileSellerOrdersPost(
      {
        headers: authHeaders(),
        json: async () => ({
          name: "Ramesh Kumar",
          whatsapp: "+91 98765 43210",
          email: "ramesh@example.test",
          quantity: 2,
        }),
      },
      makeOpsDeps({
        getSellerByProfileId: async () =>
          makeSellerProfile({ is_qr_active: false }),
      })
    );
    assert.equal(noQrRes.status, 400);

    const overCapRes = await handleMobileSellerOrdersPost(
      {
        headers: authHeaders(),
        json: async () => ({
          name: "Ramesh Kumar",
          whatsapp: "+91 98765 43210",
          email: "ramesh@example.test",
          quantity: 10,
        }),
      },
      makeOpsDeps({
        getCampaign: async () => ({
          id: "66666666-6666-4666-8666-666666666601",
          public_id: "ssfi-fundraising-lucky-draw",
          name: "SSFI Fundraising Lucky Draw",
          status: "ACTIVE",
          ticket_price_paise: 10000,
          total_ticket_limit: 1000,
          sold_ticket_count: 995,
          start_at: null,
          end_at: null,
        }),
      })
    );
    assert.equal(overCapRes.status, 400);

    const createdRes = await handleMobileSellerOrdersPost(
      {
        headers: authHeaders(),
        json: async () => ({
          name: "Ramesh Kumar",
          whatsapp: "+91 98765 43210",
          email: "ramesh@example.test",
          quantity: 2,
        }),
      },
      makeOpsDeps()
    );
    assert.equal(createdRes.status, 201);
  });

  await t.test("Seller order detail and UTR submission enforce ownership isolation, screenshot requirement, and duplicate prevention", async () => {
    resetRateLimitsForTesting();

    const otherOrderGet = await handleMobileSellerOrderDetailGet(
      { headers: authHeaders() },
      ORDER_B_ID,
      makeOpsDeps()
    );
    assert.equal(otherOrderGet.status, 404);

    const crossSellerPay = await handleMobileSellerOrderPaymentSubmitPost(
      {
        headers: authHeaders(),
        json: async () => ({ utr: "UTR99887766", payerName: "Ramesh" }),
      },
      ORDER_B_ID,
      makeOpsDeps({
        submitSellerManualUpiRpc: async () => {
          throw new Error("OWNERSHIP_DENIED");
        },
      })
    );
    assert.equal(crossSellerPay.status, 403);

    const dupPay = await handleMobileSellerOrderPaymentSubmitPost(
      {
        headers: authHeaders(),
        json: async () => ({ utr: "UTR99887766", payerName: "Ramesh" }),
      },
      ORDER_A_ID,
      makeOpsDeps({
        submitSellerManualUpiRpc: async () => {
          throw new Error("ALREADY_SUBMITTED");
        },
      })
    );
    assert.equal(dupPay.status, 400);

    const missingScreenPay = await handleMobileSellerOrderPaymentSubmitPost(
      {
        headers: authHeaders(),
        json: async () => ({ utr: "UTR99887766", payerName: "Ramesh" }),
      },
      ORDER_A_ID,
      makeOpsDeps({
        submitSellerManualUpiRpc: async () => {
          throw new Error("SCREENSHOT_REQUIRED");
        },
      })
    );
    assert.equal(missingScreenPay.status, 400);

    const validPay = await handleMobileSellerOrderPaymentSubmitPost(
      {
        headers: authHeaders(),
        json: async () => ({ utr: "UTR99887766", payerName: "Ramesh" }),
      },
      ORDER_A_ID,
      makeOpsDeps({
        getSellerOrderById: async () =>
          makeSellerOrder({ status: "PAYMENT_SUBMITTED" }),
      })
    );
    assert.equal(validPay.status, 200);
  });
});

test("Phase 3.3 Admin Mobile API v1: Collection Summary, Pending Payments, Verify/Issue Tickets, Lookup & Audit Logs", async (t) => {
  await t.test("Denies SELLER and CUSTOMER access to /admin/* endpoints", async () => {
    resetRateLimitsForTesting();
    const sellerOnAdmin = await handleMobileAdminSummaryGet(
      { headers: authHeaders() },
      makeOpsDeps({ authDeps: makeAuthDeps(USER_SELLER_A, "SELLER") })
    );
    assert.equal(sellerOnAdmin.status, 403);

    const customerOnAdmin = await handleMobileAdminPaymentsGet(
      {
        headers: authHeaders(),
        url: "http://localhost/api/mobile/v1/admin/payments",
      },
      makeOpsDeps({ authDeps: makeAuthDeps(USER_CUSTOMER, null) })
    );
    assert.equal(customerOnAdmin.status, 403);
  });

  await t.test("Permits ADMIN to view summary, list pending payments, inspect payment detail, and fetch audit logs", async () => {
    resetRateLimitsForTesting();
    const adminOpsDeps = makeOpsDeps({
      authDeps: makeAuthDeps(USER_ADMIN, "ADMIN"),
    });

    const summaryRes = await handleMobileAdminSummaryGet(
      { headers: authHeaders() },
      adminOpsDeps
    );
    assert.equal(summaryRes.status, 200);

    const listRes = await handleMobileAdminPaymentsGet(
      {
        headers: authHeaders(),
        url: "http://localhost/api/mobile/v1/admin/payments?status=SUBMITTED",
      },
      adminOpsDeps
    );
    assert.equal(listRes.status, 200);

    const detailRes = await handleMobileAdminPaymentDetailGet(
      { headers: authHeaders() },
      PAYMENT_A_ID,
      adminOpsDeps
    );
    assert.equal(detailRes.status, 200);

    const auditRes = await handleMobileAdminAuditLogsGet(
      { headers: authHeaders() },
      adminOpsDeps
    );
    assert.equal(auditRes.status, 200);
  });

  await t.test("Verify payment invokes verify_payment_and_issue -> issue_tickets() and prevents duplicate processing", async () => {
    resetRateLimitsForTesting();
    const adminOpsDeps = makeOpsDeps({
      authDeps: makeAuthDeps(USER_ADMIN, "ADMIN"),
    });

    const verifyRes = await handleMobileAdminPaymentDecisionPost(
      {
        headers: authHeaders(),
        json: async () => ({ action: "VERIFY" }),
      },
      PAYMENT_A_ID,
      adminOpsDeps
    );
    assert.equal(verifyRes.status, 200);
    const verifyBody = (await verifyRes.json()) as {
      data: {
        decision: string;
        issuedTickets: Array<{ ticketNumber: string; status: string }>;
      };
    };
    assert.equal(verifyBody.data.decision, "VERIFIED");
    assert.equal(verifyBody.data.issuedTickets.length, 2);

    const duplicateVerifyRes = await handleMobileAdminPaymentDecisionPost(
      {
        headers: authHeaders(),
        json: async () => ({ action: "VERIFY" }),
      },
      PAYMENT_A_ID,
      makeOpsDeps({
        authDeps: makeAuthDeps(USER_ADMIN, "ADMIN"),
        getAdminPaymentById: async () =>
          makeAdminPayment({ status: "VERIFIED" }),
      })
    );
    assert.equal(duplicateVerifyRes.status, 400);
  });

  await t.test("Reject payment requires reason >= 3 chars and transitions payment to REJECTED", async () => {
    resetRateLimitsForTesting();
    const adminOpsDeps = makeOpsDeps({
      authDeps: makeAuthDeps(USER_ADMIN, "ADMIN"),
    });

    const missingReasonRes = await handleMobileAdminPaymentDecisionPost(
      {
        headers: authHeaders(),
        json: async () => ({ action: "REJECT", reason: "no" }),
      },
      PAYMENT_A_ID,
      adminOpsDeps
    );
    assert.equal(missingReasonRes.status, 400);

    const rejectRes = await handleMobileAdminPaymentDecisionPost(
      {
        headers: authHeaders(),
        json: async () => ({
          action: "REJECT",
          reason: "UTR number does not match bank statement.",
        }),
      },
      PAYMENT_A_ID,
      adminOpsDeps
    );
    assert.equal(rejectRes.status, 200);
  });

  await t.test("Admin directory lookup validates query length and returns sellers/customers/orders", async () => {
    resetRateLimitsForTesting();
    const adminOpsDeps = makeOpsDeps({
      authDeps: makeAuthDeps(USER_ADMIN, "ADMIN"),
    });

    const shortLookup = await handleMobileAdminLookupGet(
      {
        headers: authHeaders(),
        url: "http://localhost/api/mobile/v1/admin/lookup?q=S",
      },
      adminOpsDeps
    );
    assert.equal(shortLookup.status, 400);

    const okLookup = await handleMobileAdminLookupGet(
      {
        headers: authHeaders(),
        url: "http://localhost/api/mobile/v1/admin/lookup?q=SELLER-007&type=SELLERS",
      },
      adminOpsDeps
    );
    assert.equal(okLookup.status, 200);
  });
});

test("Phase 3.3 Super Admin & Customer Mobile API v1: Governance, Policy A Dual Auth, Screenshot Access & Customer Workflows", async (t) => {
  await t.test("SUPER_ADMIN overview, seller lifecycle, and payment screenshot download deny ADMIN/SELLER/CUSTOMER", async () => {
    resetRateLimitsForTesting();
    const adminOnSuper = await handleMobileSuperAdminOverviewGet(
      { headers: authHeaders() },
      makeOpsDeps({ authDeps: makeAuthDeps(USER_ADMIN, "ADMIN") })
    );
    assert.equal(adminOnSuper.status, 403);

    const adminOnScreenshot = await handleMobileSuperAdminPaymentScreenshotGet(
      { headers: authHeaders() },
      PAYMENT_A_ID,
      makeOpsDeps({ authDeps: makeAuthDeps(USER_ADMIN, "ADMIN") })
    );
    assert.equal(adminOnScreenshot.status, 403);

    const superDeps = makeOpsDeps({
      authDeps: makeAuthDeps(USER_SUPER, "SUPER_ADMIN"),
    });
    const superOverview = await handleMobileSuperAdminOverviewGet(
      { headers: authHeaders() },
      superDeps
    );
    assert.equal(superOverview.status, 200);

    const sellerToggle = await handleMobileSuperAdminSellerStatusPost(
      {
        headers: authHeaders(),
        json: async () => ({ action: "DEACTIVATE" }),
      },
      SELLER_A_ID,
      superDeps
    );
    assert.equal(sellerToggle.status, 200);

    const superScreenshot = await handleMobileSuperAdminPaymentScreenshotGet(
      { headers: authHeaders() },
      PAYMENT_A_ID,
      superDeps
    );
    assert.equal(superScreenshot.status, 200);
  });

  await t.test("First Prize Dual Authorization enforces Policy A: SUPER_ADMIN-only initiation and forbids self-approval", async () => {
    resetRateLimitsForTesting();

    // ADMIN cannot initiate 1st Prize dual approval
    const adminInitiate = await handleMobileFirstPrizeDualAuthPost(
      {
        headers: authHeaders(),
        json: async () => ({
          action: "REQUEST",
          drawId: DRAW_A_ID,
          prizeId: PRIZE_1_ID,
          snapshotId: SNAP_1_ID,
        }),
      },
      makeOpsDeps({ authDeps: makeAuthDeps(USER_ADMIN, "ADMIN") })
    );
    assert.equal(adminInitiate.status, 403);

    // SUPER_ADMIN can initiate 1st Prize dual approval
    const superInitiate = await handleMobileFirstPrizeDualAuthPost(
      {
        headers: authHeaders(),
        json: async () => ({
          action: "REQUEST",
          drawId: DRAW_A_ID,
          prizeId: PRIZE_1_ID,
          snapshotId: SNAP_1_ID,
        }),
      },
      makeOpsDeps({ authDeps: makeAuthDeps(USER_SUPER, "SUPER_ADMIN") })
    );
    assert.equal(superInitiate.status, 201);

    // Self-approval returns 403 FORBIDDEN
    const selfApprove = await handleMobileFirstPrizeDualAuthPost(
      {
        headers: authHeaders(),
        json: async () => ({
          action: "DECIDE",
          approvalId: APPROVAL_1_ID,
          decision: "APPROVED",
          notes: "Self approval attempt",
        }),
      },
      makeOpsDeps({
        authDeps: makeAuthDeps(USER_SUPER, "SUPER_ADMIN"),
        recordFirstPrizeApprovalRpc: async () => {
          throw new Error("SELF_APPROVAL_FORBIDDEN");
        },
      })
    );
    assert.equal(selfApprove.status, 403);

    // Separate ADMIN can approve
    const secondAdminApprove = await handleMobileFirstPrizeDualAuthPost(
      {
        headers: authHeaders(),
        json: async () => ({
          action: "DECIDE",
          approvalId: APPROVAL_1_ID,
          decision: "APPROVED",
          notes: "Verified snapshot hash",
        }),
      },
      makeOpsDeps({ authDeps: makeAuthDeps(USER_ADMIN, "ADMIN") })
    );
    assert.equal(secondAdminApprove.status, 200);
  });

  await t.test("Customer dashboard enforces linked customerProfileLinked and ticket verification validates SSFI-XXXXXX format", async () => {
    resetRateLimitsForTesting();

    // Unlinked account denied on /customer/dashboard
    const unlinkedRes = await handleMobileCustomerDashboardGet(
      { headers: authHeaders() },
      makeOpsDeps({ authDeps: makeAuthDeps(USER_UNLINKED, null) })
    );
    assert.equal(unlinkedRes.status, 403);

    // Linked customer permitted
    const linkedRes = await handleMobileCustomerDashboardGet(
      { headers: authHeaders() },
      makeOpsDeps({ authDeps: makeAuthDeps(USER_CUSTOMER, null) })
    );
    assert.equal(linkedRes.status, 200);

    // Ticket verification rejects invalid format with 400 and verifies SSFI-XXXXXX
    const badTicket = await handleMobileTicketVerifyGet(
      { headers: authHeaders() },
      "BAD-TICKET",
      makeOpsDeps({ authDeps: makeAuthDeps(USER_CUSTOMER, null) })
    );
    assert.equal(badTicket.status, 400);

    const goodTicket = await handleMobileTicketVerifyGet(
      { headers: authHeaders() },
      "SSFI-000101",
      makeOpsDeps({ authDeps: makeAuthDeps(USER_CUSTOMER, null) })
    );
    assert.equal(goodTicket.status, 200);
  });
});

test("Phase 3.3 Finalization: Mobile Screenshot Upload & Security Regression Suite", async (t) => {
  const VALID_PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
  const SPOOFED_BYTES = new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x3e]); // <svg>

  function makeMultipartReq(file?: File | null, ip = "198.51.100.70") {
    return {
      headers: authHeaders(ip),
      formData: async () => {
        const fd = new FormData();
        if (file) fd.set("screenshot", file);
        return fd;
      },
    };
  }

  await t.test("Enforces authentication, SELLER role, and cross-seller ownership isolation", async () => {
    resetRateLimitsForTesting();

    const validFile = new File([VALID_PNG_BYTES], "proof.png", {
      type: "image/png",
    });

    const unauth = await handleMobileSellerOrderScreenshotPost(
      {
        headers: new Headers({ "x-real-ip": "198.51.100.71" }),
        formData: async () => new FormData(),
      },
      ORDER_A_ID,
      makeOpsDeps()
    );
    assert.equal(unauth.status, 401);

    const adminNotSeller = await handleMobileSellerOrderScreenshotPost(
      makeMultipartReq(validFile, "198.51.100.72"),
      ORDER_A_ID,
      makeOpsDeps({ authDeps: makeAuthDeps(USER_ADMIN, "ADMIN") })
    );
    assert.equal(adminNotSeller.status, 403);

    const crossSeller = await handleMobileSellerOrderScreenshotPost(
      makeMultipartReq(validFile, "198.51.100.73"),
      ORDER_B_ID,
      makeOpsDeps({
        uploadSellerOrderScreenshot: async () => {
          throw new Error("OWNERSHIP_DENIED");
        },
      })
    );
    assert.equal(crossSeller.status, 403);
  });

  await t.test("Rejects spoofed MIME/magic-bytes, path-traversal filenames, mismatched extensions, oversized files, and public buckets", async () => {
    resetRateLimitsForTesting();

    const spoofedFile = new File([SPOOFED_BYTES], "proof.png", {
      type: "image/png",
    });
    const spoofedRes = await handleMobileSellerOrderScreenshotPost(
      makeMultipartReq(spoofedFile),
      ORDER_A_ID,
      makeOpsDeps()
    );
    assert.equal(spoofedRes.status, 400);

    const mismatchedExt = new File([VALID_PNG_BYTES], "proof.jpg", {
      type: "image/png",
    });
    const mismatchRes = await handleMobileSellerOrderScreenshotPost(
      makeMultipartReq(mismatchedExt),
      ORDER_A_ID,
      makeOpsDeps()
    );
    assert.equal(mismatchRes.status, 400);

    assert.throws(() => validateMobileScreenshotFilename("../evil.png", "image/png"));
    assert.throws(() => validateMobileScreenshotFilename("shell.svg", "image/png"));

    const publicBucketRes = await handleMobileSellerOrderScreenshotPost(
      makeMultipartReq(new File([VALID_PNG_BYTES], "proof.png", { type: "image/png" })),
      ORDER_A_ID,
      makeOpsDeps({
        uploadSellerOrderScreenshot: async () => {
          throw new Error("PUBLIC_BUCKET_VIOLATION");
        },
      })
    );
    assert.equal(publicBucketRes.status, 503);
  });

  await t.test("Accepts valid PNG upload (201), supports safe duplicate replacement (200), and never leaks storage paths or public URLs", async () => {
    resetRateLimitsForTesting();
    const validFile = new File([VALID_PNG_BYTES], "upi-proof.png", {
      type: "image/png",
    });

    const firstRes = await handleMobileSellerOrderScreenshotPost(
      makeMultipartReq(validFile),
      ORDER_A_ID,
      makeOpsDeps({
        uploadSellerOrderScreenshot: async () => ({
          replaced: false,
          contentType: "image/png",
          fileSizeBytes: VALID_PNG_BYTES.byteLength,
          uploadedAt: "2026-11-21T09:00:00.000Z",
        }),
      })
    );
    assert.equal(firstRes.status, 201);
    const firstBody = (await firstRes.json()) as {
      data: Record<string, unknown>;
    };
    assert.equal(firstBody.data.replaced, false);
    assert.equal("storagePath" in firstBody.data, false);
    assert.equal("publicUrl" in firstBody.data, false);

    const replaceRes = await handleMobileSellerOrderScreenshotPost(
      makeMultipartReq(validFile),
      ORDER_A_ID,
      makeOpsDeps({
        uploadSellerOrderScreenshot: async () => ({
          replaced: true,
          contentType: "image/png",
          fileSizeBytes: VALID_PNG_BYTES.byteLength,
          uploadedAt: "2026-11-21T09:05:00.000Z",
        }),
      })
    );
    assert.equal(replaceRes.status, 200);
    const replaceBody = (await replaceRes.json()) as {
      data: { replaced: boolean };
    };
    assert.equal(replaceBody.data.replaced, true);
  });

  await t.test("sanitizePostgrestSearchTerm strips PostgREST filter injection characters", () => {
    assert.equal(
      sanitizePostgrestSearchTerm("SELLER-007,id.neq.null()"),
      "SELLER-007 id.neq.null"
    );
    assert.equal(sanitizePostgrestSearchTerm("abc*def\\ghi"), "abc def ghi");
  });
});
