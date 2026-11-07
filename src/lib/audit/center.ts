export type AuditActionCategory =
  | "PAYMENT"
  | "TICKET"
  | "CUSTOMER"
  | "SCREENSHOT"
  | "EMAIL"
  | "COLLABORATION"
  | "SELLER"
  | "CAMPAIGN"
  | "SYSTEM";

export type AuditActorRoleFilter =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "FUNDRAISING_MANAGER"
  | "SELLER"
  | "SYSTEM";

export type AuditBadgeTone =
  | "emerald"
  | "blue"
  | "amber"
  | "rose"
  | "purple"
  | "indigo"
  | "slate";

export const AUDIT_CATEGORY_LABELS: Record<AuditActionCategory, string> = {
  PAYMENT: "Payment Events",
  TICKET: "Ticket Events",
  CUSTOMER: "Customer Modifications",
  SCREENSHOT: "Screenshot Access & Uploads",
  EMAIL: "Email & Ticket Delivery",
  COLLABORATION: "Order Collaboration & Flags",
  SELLER: "Seller Account & QR Settings",
  CAMPAIGN: "Campaign & Draw Operations",
  SYSTEM: "System & Recovery Settings",
};

export const AUDIT_CATEGORY_ACTIONS: Record<AuditActionCategory, readonly string[]> = {
  PAYMENT: [
    "ORDER_CREATED",
    "PAYMENT_SUBMITTED",
    "PAYMENT_DETAILS_SUBMITTED",
    "PAYMENT_VERIFIED",
    "PAYMENT_REJECTED",
    "SELLER_PAYMENT_REVIEWED",
    "PAYMENT_RECOVERY_TOKEN_GENERATED",
    "PAYMENT_RECOVERY_TOKEN_REVOKED",
    "PAYMENT_RECOVERY_LINK_GENERATED",
    "PAYMENT_RECOVERY_LINK_REVOKED",
  ],
  TICKET: [
    "TICKET_ISSUED",
    "TICKET_DELIVERED",
    "TICKET_DELIVERY_PREPARED",
    "TICKET_DELIVERY_SIMULATED",
    "TICKET_DELIVERY_MANUALLY_SENT",
    "TICKET_CONTACT_UPDATED",
    "TICKET_VOIDED",
    "TICKET_REISSUED",
    "TICKET_NOTES_UPDATED",
  ],
  CUSTOMER: [
    "CUSTOMER_PROFILE_UPDATED",
    "TICKET_CONTACT_UPDATED",
  ],
  SCREENSHOT: [
    "PAYMENT_SCREENSHOT_UPLOADED",
    "PAYMENT_SCREENSHOT_REPLACED",
    "PAYMENT_SCREENSHOT_VIEWED",
    "PAYMENT_SCREENSHOT_DOWNLOADED",
    "PAYMENT_SCREENSHOT_DOWNLOAD_SUCCEEDED",
    "PAYMENT_SCREENSHOT_DOWNLOAD_DENIED",
    "PAYMENT_SCREENSHOT_DOWNLOAD_FAILED",
  ],
  EMAIL: [
    "CUSTOMER_EMAIL_QUEUED",
    "CUSTOMER_EMAIL_SENT",
    "CUSTOMER_EMAIL_SIMULATED",
    "CUSTOMER_EMAIL_FAILED",
    "CUSTOMER_EMAIL_JOB_MANUAL_RETRY",
    "CUSTOMER_EMAIL_LIVE_ENABLED",
    "CUSTOMER_EMAIL_LIVE_DISABLED",
    "CUSTOMER_EMAIL_EVENTS_UPDATED",
    "GMAIL_PROVIDER_TEST_SENT",
    "WHATSAPP_LINK_OPENED",
    "TICKET_DELIVERED",
    "TICKET_DELIVERY_PREPARED",
    "TICKET_DELIVERY_SIMULATED",
    "TICKET_DELIVERY_MANUALLY_SENT",
  ],
  COLLABORATION: [
    "ORDER_COLLABORATION_NOTE_ADDED",
    "ORDER_REVIEW_ISSUE_RESOLVED",
    "SELLER_MESSAGE_SENT",
    "STAFF_MESSAGE_REPLIED",
  ],
  SELLER: [
    "SELLER_CREATED",
    "SELLER_DEACTIVATED",
    "SELLER_REACTIVATED",
    "SELLER_PERMANENTLY_DELETED",
    "SELLER_PAYMENT_QR_UPLOADED",
    "SELLER_PAYMENT_DETAILS_UPDATED",
    "SELLER_PAYMENT_QR_ACTIVATED",
    "SELLER_PAYMENT_QR_DEACTIVATED",
    "SELLER_PAYMENT_REVIEWED",
    "SELLER_MESSAGE_SENT",
    "STAFF_MESSAGE_REPLIED",
  ],
  CAMPAIGN: [
    "CAMPAIGN_SCHEDULE_UPDATED",
    "CAMPAIGN_STATUS_UPDATED",
    "CAMPAIGN_LIFECYCLE_CHANGED",
    "CAMPAIGN_YOUTUBE_UPDATED",
    "DRAW_EXECUTED",
  ],
  SYSTEM: [
    "CUSTOMER_EMAIL_LIVE_ENABLED",
    "CUSTOMER_EMAIL_LIVE_DISABLED",
    "CUSTOMER_EMAIL_EVENTS_UPDATED",
    "GMAIL_PROVIDER_TEST_SENT",
    "PAYMENT_RECOVERY_TOKEN_GENERATED",
    "PAYMENT_RECOVERY_TOKEN_REVOKED",
    "PAYMENT_RECOVERY_LINK_GENERATED",
    "PAYMENT_RECOVERY_LINK_REVOKED",
  ],
};

const ACTION_METADATA_MAP: Record<
  string,
  { label: string; category: AuditActionCategory; tone: AuditBadgeTone }
> = {
  // Orders & Payments
  ORDER_CREATED: {
    label: "Order Created",
    category: "PAYMENT",
    tone: "blue",
  },
  PAYMENT_SUBMITTED: {
    label: "Payment Details Submitted",
    category: "PAYMENT",
    tone: "blue",
  },
  PAYMENT_DETAILS_SUBMITTED: {
    label: "Payment Details & Proof Submitted",
    category: "PAYMENT",
    tone: "blue",
  },
  SELLER_PAYMENT_REVIEWED: {
    label: "Seller Payment Reviewed",
    category: "PAYMENT",
    tone: "indigo",
  },
  PAYMENT_VERIFIED: {
    label: "Payment Approved (Admin)",
    category: "PAYMENT",
    tone: "emerald",
  },
  PAYMENT_REJECTED: {
    label: "Payment Rejected (Admin)",
    category: "PAYMENT",
    tone: "rose",
  },
  PAYMENT_RECOVERY_TOKEN_GENERATED: {
    label: "Payment Recovery Link Generated",
    category: "PAYMENT",
    tone: "amber",
  },
  PAYMENT_RECOVERY_TOKEN_REVOKED: {
    label: "Payment Recovery Link Revoked",
    category: "PAYMENT",
    tone: "slate",
  },
  PAYMENT_RECOVERY_LINK_GENERATED: {
    label: "Payment Recovery Link Generated",
    category: "PAYMENT",
    tone: "amber",
  },
  PAYMENT_RECOVERY_LINK_REVOKED: {
    label: "Payment Recovery Link Revoked",
    category: "PAYMENT",
    tone: "slate",
  },

  // Tickets
  TICKET_ISSUED: {
    label: "Tickets Issued",
    category: "TICKET",
    tone: "emerald",
  },
  TICKET_DELIVERED: {
    label: "Ticket Delivered",
    category: "EMAIL",
    tone: "emerald",
  },
  TICKET_DELIVERY_PREPARED: {
    label: "Ticket Delivery Prepared",
    category: "EMAIL",
    tone: "blue",
  },
  TICKET_DELIVERY_SIMULATED: {
    label: "Ticket Delivery Simulated",
    category: "EMAIL",
    tone: "indigo",
  },
  TICKET_CONTACT_UPDATED: {
    label: "Ticket Buyer Contact Updated",
    category: "TICKET",
    tone: "purple",
  },
  TICKET_VOIDED: {
    label: "Ticket Voided",
    category: "TICKET",
    tone: "rose",
  },
  TICKET_REISSUED: {
    label: "Ticket Reissued",
    category: "TICKET",
    tone: "amber",
  },
  TICKET_NOTES_UPDATED: {
    label: "Ticket Notes Updated",
    category: "TICKET",
    tone: "slate",
  },

  // Customers
  CUSTOMER_PROFILE_UPDATED: {
    label: "Customer Profile Updated",
    category: "CUSTOMER",
    tone: "purple",
  },

  // Screenshots
  PAYMENT_SCREENSHOT_UPLOADED: {
    label: "Payment Screenshot Uploaded",
    category: "SCREENSHOT",
    tone: "blue",
  },
  PAYMENT_SCREENSHOT_REPLACED: {
    label: "Payment Screenshot Replaced",
    category: "SCREENSHOT",
    tone: "amber",
  },
  PAYMENT_SCREENSHOT_VIEWED: {
    label: "Payment Screenshot Viewed",
    category: "SCREENSHOT",
    tone: "slate",
  },
  PAYMENT_SCREENSHOT_DOWNLOADED: {
    label: "Payment Screenshot Downloaded",
    category: "SCREENSHOT",
    tone: "indigo",
  },
  PAYMENT_SCREENSHOT_DOWNLOAD_SUCCEEDED: {
    label: "Payment Screenshot Download Succeeded",
    category: "SCREENSHOT",
    tone: "emerald",
  },
  PAYMENT_SCREENSHOT_DOWNLOAD_DENIED: {
    label: "Payment Screenshot Download Denied",
    category: "SCREENSHOT",
    tone: "rose",
  },
  PAYMENT_SCREENSHOT_DOWNLOAD_FAILED: {
    label: "Payment Screenshot Download Failed",
    category: "SCREENSHOT",
    tone: "amber",
  },

  // Collaboration
  ORDER_COLLABORATION_NOTE_ADDED: {
    label: "Order Note / Flag Added",
    category: "COLLABORATION",
    tone: "amber",
  },
  ORDER_REVIEW_ISSUE_RESOLVED: {
    label: "Order Issue Flag Resolved",
    category: "COLLABORATION",
    tone: "emerald",
  },
  SELLER_MESSAGE_SENT: {
    label: "Seller Support Message Sent",
    category: "COLLABORATION",
    tone: "blue",
  },
  STAFF_MESSAGE_REPLIED: {
    label: "Admin Replied to Seller Message",
    category: "COLLABORATION",
    tone: "indigo",
  },

  // Email & Delivery
  CUSTOMER_EMAIL_QUEUED: {
    label: "Customer Email Queued",
    category: "EMAIL",
    tone: "blue",
  },
  CUSTOMER_EMAIL_SENT: {
    label: "Customer Email Sent",
    category: "EMAIL",
    tone: "emerald",
  },
  CUSTOMER_EMAIL_SIMULATED: {
    label: "Customer Email Simulated (Preview)",
    category: "EMAIL",
    tone: "indigo",
  },
  CUSTOMER_EMAIL_FAILED: {
    label: "Customer Email Failed",
    category: "EMAIL",
    tone: "rose",
  },
  CUSTOMER_EMAIL_JOB_MANUAL_RETRY: {
    label: "Customer Email Manual Retry",
    category: "EMAIL",
    tone: "amber",
  },
  CUSTOMER_EMAIL_LIVE_ENABLED: {
    label: "Live Customer Email Gate Enabled",
    category: "EMAIL",
    tone: "emerald",
  },
  CUSTOMER_EMAIL_LIVE_DISABLED: {
    label: "Live Customer Email Gate Disabled",
    category: "EMAIL",
    tone: "rose",
  },
  CUSTOMER_EMAIL_EVENTS_UPDATED: {
    label: "Customer Email Event Toggles Updated",
    category: "EMAIL",
    tone: "blue",
  },
  GMAIL_PROVIDER_TEST_SENT: {
    label: "Email Provider Diagnostic Test Sent",
    category: "EMAIL",
    tone: "indigo",
  },
  WHATSAPP_LINK_OPENED: {
    label: "WhatsApp Ticket Link Opened",
    category: "EMAIL",
    tone: "emerald",
  },
  TICKET_DELIVERY_MANUALLY_SENT: {
    label: "Ticket Delivery Marked Sent",
    category: "EMAIL",
    tone: "emerald",
  },

  // Sellers
  SELLER_CREATED: {
    label: "Seller Account Created",
    category: "SELLER",
    tone: "emerald",
  },
  SELLER_DEACTIVATED: {
    label: "Seller Account Deactivated",
    category: "SELLER",
    tone: "rose",
  },
  SELLER_REACTIVATED: {
    label: "Seller Account Reactivated",
    category: "SELLER",
    tone: "emerald",
  },
  SELLER_PERMANENTLY_DELETED: {
    label: "Seller Account Permanently Deleted",
    category: "SELLER",
    tone: "rose",
  },
  SELLER_PAYMENT_QR_UPLOADED: {
    label: "Seller Payment QR Uploaded",
    category: "SELLER",
    tone: "blue",
  },
  SELLER_PAYMENT_DETAILS_UPDATED: {
    label: "Seller Payment Details Updated",
    category: "SELLER",
    tone: "indigo",
  },
  SELLER_PAYMENT_QR_ACTIVATED: {
    label: "Seller Payment QR Activated",
    category: "SELLER",
    tone: "emerald",
  },
  SELLER_PAYMENT_QR_DEACTIVATED: {
    label: "Seller Payment QR Deactivated",
    category: "SELLER",
    tone: "amber",
  },

  // Campaign
  CAMPAIGN_SCHEDULE_UPDATED: {
    label: "Campaign Schedule Updated",
    category: "CAMPAIGN",
    tone: "indigo",
  },
  CAMPAIGN_STATUS_UPDATED: {
    label: "Campaign Status Updated",
    category: "CAMPAIGN",
    tone: "amber",
  },
  CAMPAIGN_LIFECYCLE_CHANGED: {
    label: "Campaign Lifecycle Changed",
    category: "CAMPAIGN",
    tone: "amber",
  },
  CAMPAIGN_YOUTUBE_UPDATED: {
    label: "Campaign YouTube Broadcast Updated",
    category: "CAMPAIGN",
    tone: "blue",
  },
  DRAW_EXECUTED: {
    label: "Lucky Draw Executed",
    category: "CAMPAIGN",
    tone: "emerald",
  },
};

export function getActionsForCategory(category: string | undefined | null): string[] {
  if (!category) return [];
  const normalized = category.trim().toUpperCase() as AuditActionCategory;
  const list = AUDIT_CATEGORY_ACTIONS[normalized];
  return list ? [...list] : [];
}

export function getAuditActionInfo(action: string): {
  label: string;
  category: AuditActionCategory;
  categoryLabel: string;
  tone: AuditBadgeTone;
} {
  const normalized = (action || "").trim().toUpperCase();
  const known = ACTION_METADATA_MAP[normalized];
  if (known) {
    return {
      label: known.label,
      category: known.category,
      categoryLabel: AUDIT_CATEGORY_LABELS[known.category],
      tone: known.tone,
    };
  }

  let fallbackCategory: AuditActionCategory = "SYSTEM";
  if (normalized.includes("PAYMENT") || normalized.includes("ORDER")) {
    fallbackCategory = "PAYMENT";
  } else if (normalized.includes("TICKET")) {
    fallbackCategory = "TICKET";
  } else if (normalized.includes("CUSTOMER")) {
    fallbackCategory = "CUSTOMER";
  } else if (normalized.includes("SCREENSHOT")) {
    fallbackCategory = "SCREENSHOT";
  } else if (normalized.includes("EMAIL") || normalized.includes("WHATSAPP") || normalized.includes("DELIVERY")) {
    fallbackCategory = "EMAIL";
  } else if (normalized.includes("COLLABORATION") || normalized.includes("ISSUE")) {
    fallbackCategory = "COLLABORATION";
  } else if (normalized.includes("SELLER")) {
    fallbackCategory = "SELLER";
  } else if (normalized.includes("CAMPAIGN") || normalized.includes("DRAW")) {
    fallbackCategory = "CAMPAIGN";
  }

  return {
    label: normalized.replace(/_/g, " "),
    category: fallbackCategory,
    categoryLabel: AUDIT_CATEGORY_LABELS[fallbackCategory],
    tone: "slate",
  };
}

const SAFE_KEY_ALLOWLIST = new Set([
  "idempotency_key",
  "setting_key",
  "storage_key",
  "qr_storage_key",
  "previous_qr_key",
  "new_qr_key",
]);

const SENSITIVE_KEY_REGEX =
  /(token|secret|password|passcode|private_key|api_key|service_role|authorization|cookie|credential|hash|signed_url|storage_path)/i;

/**
 * Deeply sanitizes an audit metadata payload so that secret tokens, hashes,
 * passwords, or credentials are never exposed in the Admin UI or API responses.
 */
export function sanitizeAuditMetadata(
  value: unknown,
  depth = 0
): Record<string, unknown> {
  if (depth > 6 || !value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, rawVal] of Object.entries(input)) {
    const lowerKey = key.toLowerCase();
    if (!SAFE_KEY_ALLOWLIST.has(lowerKey) && SENSITIVE_KEY_REGEX.test(lowerKey)) {
      output[key] = "[REDACTED]";
      continue;
    }

    if (rawVal && typeof rawVal === "object" && !Array.isArray(rawVal)) {
      output[key] = sanitizeAuditMetadata(rawVal, depth + 1);
    } else if (Array.isArray(rawVal)) {
      output[key] = rawVal.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? sanitizeAuditMetadata(item, depth + 1)
          : item
      );
    } else {
      output[key] = rawVal;
    }
  }

  return output;
}

export interface ExtractedAuditSummary {
  actorRole: string;
  reason: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  orderId: string | null;
  orderNumber: string | null;
  paymentId: string | null;
  ticketId: string | null;
  ticketNumber: string | null;
  customerId: string | null;
  sellerId: string | null;
  sellerCode: string | null;
}

function asCleanString(val: unknown): string | null {
  if (typeof val === "string" && val.trim().length > 0) {
    return val.trim();
  }
  return null;
}

function asRecordOrNull(val: unknown): Record<string, unknown> | null {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return sanitizeAuditMetadata(val);
  }
  return null;
}

/**
 * Extracts normalized summary fields from an audit_logs row and its metadata JSONB.
 */
export function extractAuditSummaryFields(row: {
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_user_id: string | null;
  metadata: unknown;
  inferredActorRole?: string | null;
}): ExtractedAuditSummary {
  const meta = sanitizeAuditMetadata(row.metadata);
  const entityType = (row.entity_type || "").toLowerCase();
  const entityId = asCleanString(row.entity_id);

  // Determine actor role
  const explicitRole =
    asCleanString(meta.actor_role) ||
    asCleanString(row.inferredActorRole);
  let actorRole = explicitRole ? explicitRole.toUpperCase() : "SYSTEM";
  if (!explicitRole && row.actor_user_id) {
    if (row.action.startsWith("SELLER_PAYMENT_REVIEWED") || row.action.startsWith("SELLER_PAYMENT_QR_UPLOADED") || row.action.startsWith("SELLER_PAYMENT_DETAILS_UPDATED")) {
      actorRole = "SELLER";
    } else {
      actorRole = "ADMIN";
    }
  }

  // Extract reason / note
  const reason =
    asCleanString(meta.reason) ||
    asCleanString(meta.rejection_reason) ||
    asCleanString(meta.resolution_note) ||
    asCleanString(meta.review_note) ||
    asCleanString(meta.message_preview) ||
    asCleanString(meta.error_message) ||
    asCleanString(meta.error) ||
    null;

  // Extract before/after values
  let oldValue = asRecordOrNull(meta.old_value);
  let newValue = asRecordOrNull(meta.new_value);

  if (!oldValue && !newValue) {
    if (meta.previous_state !== undefined || meta.new_state !== undefined) {
      oldValue = { state: meta.previous_state ?? null };
      newValue = { state: meta.new_state ?? null };
    } else if (meta.previous_notes !== undefined || meta.new_notes !== undefined) {
      oldValue = { notes: meta.previous_notes ?? null };
      newValue = { notes: meta.new_notes ?? null };
    }
  }

  // Extract linked entity IDs & human-readable numbers
  const orderId =
    (entityType === "order" || entityType === "orders" ? entityId : null) ||
    asCleanString(meta.order_id);
  const orderNumber = asCleanString(meta.order_number);

  const paymentId =
    (entityType === "payment" || entityType === "payments" ? entityId : null) ||
    asCleanString(meta.payment_id);

  const ticketId =
    (entityType === "ticket" || entityType === "tickets" ? entityId : null) ||
    asCleanString(meta.ticket_id);

  let ticketNumber =
    asCleanString(meta.ticket_number) ||
    asCleanString(meta.new_ticket_number) ||
    asCleanString(meta.original_ticket_number);
  if (!ticketNumber && Array.isArray(meta.ticket_numbers) && meta.ticket_numbers.length > 0) {
    const first = asCleanString(meta.ticket_numbers[0]);
    if (first) {
      ticketNumber =
        meta.ticket_numbers.length > 1
          ? `${first} (+${meta.ticket_numbers.length - 1} more)`
          : first;
    }
  }

  const customerId =
    (entityType === "customer" || entityType === "customers" ? entityId : null) ||
    asCleanString(meta.customer_id);

  const sellerId =
    (entityType === "seller" || entityType === "sellers" ? entityId : null) ||
    asCleanString(meta.seller_id);

  const sellerCode = asCleanString(meta.seller_code);

  return {
    actorRole,
    reason,
    oldValue,
    newValue,
    orderId,
    orderNumber,
    paymentId,
    ticketId,
    ticketNumber,
    customerId,
    sellerId,
    sellerCode,
  };
}

