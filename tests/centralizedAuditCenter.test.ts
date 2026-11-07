import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_CATEGORY_ACTIONS,
  extractAuditSummaryFields,
  getActionsForCategory,
  getAuditActionInfo,
  sanitizeAuditMetadata,
} from "../src/lib/audit/center.ts";
import { computeServerPaginationWindow } from "../src/lib/pagination/serverPagination.ts";

describe("Centralized Admin Audit Center — Category & Action Mapping", () => {
  it("maps every audit category to its registered action codes", () => {
    assert.ok(getActionsForCategory("PAYMENT").includes("PAYMENT_VERIFIED"));
    assert.ok(getActionsForCategory("PAYMENT").includes("SELLER_PAYMENT_REVIEWED"));
    assert.ok(getActionsForCategory("TICKET").includes("TICKET_ISSUED"));
    assert.ok(getActionsForCategory("TICKET").includes("TICKET_CONTACT_UPDATED"));
    assert.ok(getActionsForCategory("CUSTOMER").includes("CUSTOMER_PROFILE_UPDATED"));
    assert.ok(getActionsForCategory("SCREENSHOT").includes("PAYMENT_SCREENSHOT_UPLOADED"));
    assert.ok(getActionsForCategory("SCREENSHOT").includes("PAYMENT_SCREENSHOT_REPLACED"));
    assert.ok(getActionsForCategory("SCREENSHOT").includes("PAYMENT_SCREENSHOT_VIEWED"));
    assert.ok(getActionsForCategory("SCREENSHOT").includes("PAYMENT_SCREENSHOT_DOWNLOADED"));
    assert.ok(getActionsForCategory("EMAIL").includes("CUSTOMER_EMAIL_QUEUED"));
    assert.ok(getActionsForCategory("EMAIL").includes("CUSTOMER_EMAIL_SENT"));
    assert.ok(getActionsForCategory("EMAIL").includes("CUSTOMER_EMAIL_SIMULATED"));
    assert.ok(getActionsForCategory("EMAIL").includes("CUSTOMER_EMAIL_FAILED"));
    assert.ok(
      getActionsForCategory("COLLABORATION").includes("ORDER_COLLABORATION_NOTE_ADDED")
    );
    assert.ok(
      getActionsForCategory("COLLABORATION").includes("ORDER_REVIEW_ISSUE_RESOLVED")
    );
    assert.ok(getActionsForCategory("SELLER").includes("SELLER_CREATED"));
    assert.ok(getActionsForCategory("SELLER").includes("SELLER_PAYMENT_QR_UPLOADED"));
    assert.ok(getActionsForCategory("SELLER").includes("SELLER_PAYMENT_DETAILS_UPDATED"));
    assert.deepEqual(getActionsForCategory("INVALID_CATEGORY"), []);
  });

  it("returns structured label, category, and badge tone for known and unknown actions", () => {
    const verified = getAuditActionInfo("PAYMENT_VERIFIED");
    assert.equal(verified.label, "Payment Approved (Admin)");
    assert.equal(verified.category, "PAYMENT");
    assert.equal(verified.tone, "emerald");

    const sellerReview = getAuditActionInfo("SELLER_PAYMENT_REVIEWED");
    assert.equal(sellerReview.label, "Seller Payment Reviewed");
    assert.equal(sellerReview.category, "PAYMENT");

    const fallback = getAuditActionInfo("CUSTOM_TICKET_AUDIT_EVENT");
    assert.equal(fallback.category, "TICKET");
    assert.equal(fallback.label, "CUSTOM TICKET AUDIT EVENT");
  });
});

describe("Centralized Admin Audit Center — Metadata Redaction Security", () => {
  it("redacts sensitive token, secret, password, key, and hash fields recursively", () => {
    const rawMetadata = {
      order_id: "11111111-2222-3333-4444-555555555555",
      idempotency_key: "TICKETS_ISSUED:11111111-2222-3333-4444-555555555555",
      setting_key: "customer_email_live_enabled",
      qr_storage_key: "seller-123/qr.png",
      recovery_token: "raw-secret-token-value",
      token_hash: "sha256-abcdef1234567890",
      temporaryPassword: "Ssfi!TempPassword123",
      service_role_key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      nested: {
        authorization: "Bearer secret-jwt",
        webhook_secret: "apps-script-secret",
        safe_field: "allowed-value",
      },
      items: [{ api_key: "hidden-key", label: "visible-label" }],
    };

    const sanitized = sanitizeAuditMetadata(rawMetadata);

    // Safe allowlisted keys remain intact
    assert.equal(sanitized.order_id, "11111111-2222-3333-4444-555555555555");
    assert.equal(
      sanitized.idempotency_key,
      "TICKETS_ISSUED:11111111-2222-3333-4444-555555555555"
    );
    assert.equal(sanitized.setting_key, "customer_email_live_enabled");
    assert.equal(sanitized.qr_storage_key, "seller-123/qr.png");

    // Sensitive keys are strictly redacted
    assert.equal(sanitized.recovery_token, "[REDACTED]");
    assert.equal(sanitized.token_hash, "[REDACTED]");
    assert.equal(sanitized.temporaryPassword, "[REDACTED]");
    assert.equal(sanitized.service_role_key, "[REDACTED]");
    assert.equal(
      (sanitized.nested as Record<string, unknown>).authorization,
      "[REDACTED]"
    );
    assert.equal(
      (sanitized.nested as Record<string, unknown>).webhook_secret,
      "[REDACTED]"
    );
    assert.equal(
      (sanitized.nested as Record<string, unknown>).safe_field,
      "allowed-value"
    );
    assert.equal(
      ((sanitized.items as Record<string, unknown>[])[0]).api_key,
      "[REDACTED]"
    );
    assert.equal(
      ((sanitized.items as Record<string, unknown>[])[0]).label,
      "visible-label"
    );
  });
});

describe("Centralized Admin Audit Center — Summary Field Extraction", () => {
  it("extracts Seller role, before/after values, and order/payment links for SELLER_PAYMENT_REVIEWED", () => {
    const summary = extractAuditSummaryFields({
      action: "SELLER_PAYMENT_REVIEWED",
      entity_type: "payment",
      entity_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      actor_user_id: "99999999-8888-4777-8666-555555555555",
      metadata: {
        actor_role: "SELLER",
        seller_id: "77777777-6666-4555-8444-333333333333",
        order_id: "11111111-2222-4333-8444-555555555555",
        order_number: "SSFI-2026-0042",
        reason: "Verified UTR matches bank statement",
        old_value: { seller_review_status: null, seller_review_note: null },
        new_value: {
          seller_review_status: "RECOMMENDED_APPROVAL",
          seller_review_note: "Verified UTR matches bank statement",
        },
      },
    });

    assert.equal(summary.actorRole, "SELLER");
    assert.equal(summary.paymentId, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    assert.equal(summary.orderId, "11111111-2222-4333-8444-555555555555");
    assert.equal(summary.orderNumber, "SSFI-2026-0042");
    assert.equal(summary.sellerId, "77777777-6666-4555-8444-333333333333");
    assert.equal(summary.reason, "Verified UTR matches bank statement");
    assert.deepEqual(summary.oldValue, {
      seller_review_status: null,
      seller_review_note: null,
    });
    assert.deepEqual(summary.newValue, {
      seller_review_status: "RECOMMENDED_APPROVAL",
      seller_review_note: "Verified UTR matches bank statement",
    });
  });

  it("extracts multi-ticket summary and defaults system actor role when actor_user_id is null", () => {
    const summary = extractAuditSummaryFields({
      action: "CUSTOMER_EMAIL_SENT",
      entity_type: "customer_email_outbox",
      entity_id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      actor_user_id: null,
      metadata: {
        order_id: "11111111-2222-4333-8444-555555555555",
        order_number: "SSFI-2026-0099",
        ticket_numbers: ["SSFI-00101", "SSFI-00102", "SSFI-00103"],
        reason: "Customer email delivered via google_apps_script (TICKETS_ISSUED)",
      },
    });

    assert.equal(summary.actorRole, "SYSTEM");
    assert.equal(summary.ticketNumber, "SSFI-00101 (+2 more)");
    assert.equal(summary.orderNumber, "SSFI-2026-0099");
  });

  it("computes accurate server pagination windows for large audit histories", () => {
    const window = computeServerPaginationWindow(
      {
        page: "3",
        pageSize: "50",
      },
      1240
    );
    assert.equal(window.page, 3);
    assert.equal(window.pageSize, 50);
    assert.equal(window.rangeFrom, 100);
    assert.equal(window.rangeTo, 149);
    assert.equal(window.totalPages, 25);
  });

  it("maintains non-empty action arrays across all defined audit categories", () => {
    for (const [category, actions] of Object.entries(AUDIT_CATEGORY_ACTIONS)) {
      assert.ok(actions.length > 0, `Category ${category} should not be empty`);
    }
  });
});
