import crypto from "node:crypto";
import { z } from "zod";
import {
  authenticateMobileRequest,
  mobileError,
  mobileOk,
  requireMobileRoles,
  type MobileAuthDependencies,
  type MobileAuthenticatedUser,
  type MobileRbacRole,
} from "../auth/mobile.ts";
import { isFeatureEnabled } from "../config/featureFlags.ts";
import { manualUpiConfig } from "../config/payment.ts";
import { evaluateCampaignSchedule, formatIstDateTime } from "../date/timezone.ts";
import {
  executeDownloadPaymentScreenshot,
  PAYMENT_SCREENSHOT_DOWNLOAD_TTL_SECONDS,
} from "../payment/screenshotDownload.ts";
import {
  MAX_PAYMENT_SCREENSHOT_BYTES,
  PAYMENT_SCREENSHOT_BUCKET,
  validatePaymentScreenshot,
  type PaymentScreenshotType,
} from "../payment/screenshot.ts";
import { buildUpiPaymentUri } from "../payment/upi.ts";
import {
  checkScopedRateLimit,
  getClientIpFromHeaders,
} from "../security/rateLimit.ts";
import { emailSchema, whatsappSchema } from "../validation/contact.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKET_NUMBER_RE = /^(?:PRV-)?SSFI-[0-9]{6}$/i;

/**
 * Strips PostgREST `.or()` filter metacharacters (commas, parentheses, wildcards,
 * backslashes, control chars) and caps length to prevent filter-clause injection.
 */
export function sanitizePostgrestSearchTerm(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[,()\\*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

const ALLOWED_EXTENSIONS_BY_MIME: Record<PaymentScreenshotType, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
};

/**
 * Validates optional client filename extension against the magic-byte-verified MIME type.
 * Rejects path traversal, null bytes, and mismatched extensions (e.g. `.svg`, `.exe`, `.html`).
 */
export function validateMobileScreenshotFilename(
  fileName: string | undefined | null,
  verifiedMime: PaymentScreenshotType
): void {
  if (!fileName || !fileName.trim()) return;
  const trimmed = fileName.trim();
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..") || trimmed.includes("\0")) {
    throw new Error("Invalid screenshot filename.");
  }
  const dotIdx = trimmed.lastIndexOf(".");
  if (dotIdx <= 0 || dotIdx === trimmed.length - 1) {
    throw new Error("Screenshot file must have a valid image extension (.jpg, .jpeg, .png, or .webp).");
  }
  const ext = trimmed.slice(dotIdx + 1).toLowerCase();
  const allowed = ALLOWED_EXTENSIONS_BY_MIME[verifiedMime];
  if (!allowed.includes(ext)) {
    throw new Error("Screenshot file extension does not match its verified image type.");
  }
}

export const SUPER_ADMIN_MOBILE_ROLES: readonly MobileRbacRole[] = [
  "SUPER_ADMIN",
];

export const ADMIN_AND_SUPER_MOBILE_ROLES: readonly MobileRbacRole[] = [
  "SUPER_ADMIN",
  "ADMIN",
];

export const STAFF_MOBILE_ROLES: readonly MobileRbacRole[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "FUNDRAISING_MANAGER",
];

export const SELLER_MOBILE_ROLES: readonly MobileRbacRole[] = ["SELLER"];

const createSellerOrderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters.")
    .max(120, "Name cannot exceed 120 characters."),
  whatsapp: whatsappSchema,
  email: emailSchema,
  quantity: z.coerce
    .number()
    .int()
    .min(1, "Minimum 1 ticket.")
    .max(1000, "Maximum 1,000 tickets per seller order."),
});

const submitSellerUpiSchema = z.object({
  utr: z
    .string()
    .trim()
    .max(64, "UTR reference cannot exceed 64 characters.")
    .optional()
    .default(""),
  payerName: z
    .string()
    .trim()
    .max(120, "Payer name cannot exceed 120 characters.")
    .optional()
    .default(""),
});

const adminPaymentDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("VERIFY"),
  }),
  z.object({
    action: z.literal("REJECT"),
    reason: z
      .string()
      .trim()
      .min(3, "Rejection reason must be at least 3 characters.")
      .max(500, "Rejection reason cannot exceed 500 characters."),
  }),
]);

const firstPrizeDualAuthSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("REQUEST"),
    drawId: z.string().uuid("Invalid draw ID."),
    prizeId: z.string().uuid("Invalid prize ID."),
    snapshotId: z.string().uuid("Invalid snapshot ID."),
  }),
  z.object({
    action: z.literal("DECIDE"),
    approvalId: z.string().uuid("Invalid approval ID."),
    decision: z.enum(["APPROVED", "REJECTED"]),
    notes: z
      .string()
      .trim()
      .max(1000, "Review notes cannot exceed 1,000 characters.")
      .optional()
      .default(""),
  }),
]);

const sellerLifecycleActionSchema = z.object({
  action: z.enum(["DEACTIVATE", "REACTIVATE"]),
});

export interface SellerProfileRecord {
  id: string;
  profile_id: string;
  seller_code: string;
  display_name: string;
  is_active: boolean;
  is_qr_active: boolean;
  qr_storage_path: string | null;
  upi_id: string | null;
  account_name: string | null;
  payment_instructions: string | null;
}

export interface CampaignRecord {
  id: string;
  public_id: string;
  name: string;
  status: string;
  ticket_price_paise: number;
  total_ticket_limit: number;
  sold_ticket_count: number;
  start_at: string | null;
  end_at: string | null;
}

export interface SellerCustomerSummary {
  id: string;
  fullName: string;
  phone: string;
  whatsappNumber: string;
  email: string | null;
  totalOrdersWithSeller: number;
}

export interface MobileOrderTicketItem {
  ticketNumber: string;
  status: string;
  issuedAt?: string | null;
}

export interface MobileSellerOrderSummary {
  id: string;
  orderNumber: string;
  quantity: number;
  totalAmountPaise: number;
  status: string;
  createdAt: string;
  customer: {
    fullName: string;
    phone: string | null;
    whatsappNumber: string | null;
    email: string | null;
  };
  payment: {
    id: string | null;
    status: string;
    utrReference: string | null;
    payerName: string | null;
    rejectionReason: string | null;
    submittedAt: string | null;
    hasScreenshot: boolean;
  };
  tickets: MobileOrderTicketItem[];
  upiInstructions: {
    payeeName: string;
    upiId: string | null;
    amountPaise: number;
    currency: string;
    upiUri: string | null;
    paymentInstructions: string | null;
    isQrActive: boolean;
  };
}

export interface MobileAdminPaymentItem {
  id: string;
  status: string;
  amountPaise: number;
  utrReference: string | null;
  payerName: string | null;
  submittedAt: string | null;
  createdAt: string | null;
  rejectionReason: string | null;
  sellerReviewStatus: string | null;
  sellerReviewNote: string | null;
  hasScreenshot: boolean;
  screenshotMeta: {
    uploadedAt: string;
    fileSizeBytes: number;
    contentType: string | null;
  } | null;
  order: {
    id: string;
    orderNumber: string;
    quantity: number;
    totalAmountPaise: number;
    status: string;
    snapshotUpiId: string | null;
    snapshotAccountName: string | null;
    customer: {
      id: string;
      fullName: string;
      phone: string;
      whatsappNumber: string;
      email: string | null;
    } | null;
    seller: {
      id: string | null;
      displayName: string;
      sellerCode: string;
    } | null;
    tickets: MobileOrderTicketItem[];
  } | null;
}

export interface MobileAuditLogItem {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
  actorRole: string;
  summary: string;
}

export interface MobileFirstPrizeGovernanceStatus {
  drawId: string | null;
  drawStatus: string;
  firstPrizeId: string | null;
  firstPrizeTitle: string;
  lockedSnapshotId: string | null;
  snapshotHash: string | null;
  eligibleTicketCount: number;
  approval: {
    id: string;
    status: string;
    initiatorId: string;
    initiatorEmail: string | null;
    approverId: string | null;
    approverEmail: string | null;
    requestedAt: string;
    reviewedAt: string | null;
    reviewNotes: string | null;
  } | null;
}

export interface MobileSuperAdminOverviewData {
  governance: {
    campaignName: string;
    campaignStatus: string;
    verifiedCollectionPaise: number;
    verifiedPaymentsCount: number;
    pendingPaymentsCount: number;
    soldTicketCount: number;
    totalTicketLimit: number;
    remainingTicketCount: number;
    activeSellersCount: number;
    totalSellersCount: number;
    totalUsersCount: number;
  };
  users: Array<{
    id: string;
    fullName: string;
    email: string | null;
    isActive: boolean;
    roles: string[];
  }>;
  sellers: Array<{
    id: string;
    sellerCode: string;
    displayName: string;
    isActive: boolean;
    isQrActive: boolean;
    upiId: string | null;
  }>;
  firstPrizeDualAuth: MobileFirstPrizeGovernanceStatus;
  recentAuditLogs: MobileAuditLogItem[];
}

export interface MobileCustomerDashboardData {
  customer: {
    fullName: string;
    phone: string;
    whatsappNumber: string;
    email: string | null;
  };
  campaign: {
    name: string;
    status: string;
  };
  orders: Array<{
    id: string;
    orderNumber: string;
    quantity: number;
    totalAmountPaise: number;
    status: string;
    createdAt: string;
    sellerCode: string | null;
    sellerDisplayName: string | null;
    paymentStatus: string;
    utrReference: string | null;
    rejectionReason: string | null;
    tickets: MobileOrderTicketItem[];
  }>;
  tickets: Array<{
    ticketNumber: string;
    status: string;
    orderNumber: string;
    issuedAt: string | null;
  }>;
  certifiedWinners: Array<{
    prizeNumber: number;
    prizeTitle: string;
    ticketNumber: string;
  }>;
}

export interface MobileTicketVerificationResult {
  queriedTicketNumber: string;
  ticketNumber: string;
  found: boolean;
  isValid: boolean;
  isVoid: boolean;
  status: string;
  campaignName: string | null;
  issuedAt: string | null;
  voidReason: string | null;
}

export interface MobileOperationsDependencies {
  authDeps?: MobileAuthDependencies;
  getSellerByProfileId: (profileId: string) => Promise<SellerProfileRecord | null>;
  getCampaign: () => Promise<CampaignRecord | null>;
  runScheduledTransitions: () => Promise<void>;
  getSellerUnreadMessagesCount: (sellerId: string) => Promise<number>;
  listSellerOrders: (
    sellerId: string,
    filters?: { status?: string; query?: string }
  ) => Promise<MobileSellerOrderSummary[]>;
  getSellerOrderById: (
    sellerId: string,
    orderId: string
  ) => Promise<MobileSellerOrderSummary | null>;
  lookupSellerCustomers: (
    sellerId: string,
    query: string
  ) => Promise<SellerCustomerSummary[]>;
  createSellerOrderRpc: (input: {
    seller: SellerProfileRecord;
    actorUserId: string;
    name: string;
    whatsapp: string;
    email: string;
    quantity: number;
  }) => Promise<string>;
  submitSellerManualUpiRpc: (input: {
    sellerId: string;
    actorUserId: string;
    orderId: string;
    utr: string | null;
    payerName: string | null;
  }) => Promise<void>;
  uploadSellerOrderScreenshot?: (input: {
    sellerId: string;
    actorUserId: string;
    orderId: string;
    bytes: Uint8Array;
    contentType: PaymentScreenshotType;
    extension: string;
    fileSizeBytes: number;
  }) => Promise<{
    replaced: boolean;
    contentType: PaymentScreenshotType;
    fileSizeBytes: number;
    uploadedAt: string;
  }>;
  getAdminCollectionSummary: () => Promise<{
    verifiedCollectionPaise: number;
    verifiedPaymentsCount: number;
    pendingPaymentsCount: number;
    rejectedPaymentsCount: number;
    totalOrdersCount: number;
    activeSellersCount: number;
    campaign: {
      name: string;
      status: string;
      ticketPricePaise: number;
      totalTicketLimit: number;
      soldTicketCount: number;
      remainingTicketCount: number;
    };
  }>;
  listAdminPayments: (filters?: {
    status?: string;
    query?: string;
    sellerId?: string;
  }) => Promise<MobileAdminPaymentItem[]>;
  getAdminPaymentById: (paymentId: string) => Promise<MobileAdminPaymentItem | null>;
  verifyPaymentAndIssueRpc: (input: {
    paymentId: string;
    actorUserId: string;
  }) => Promise<MobileOrderTicketItem[]>;
  rejectPaymentRpc: (input: {
    paymentId: string;
    actorUserId: string;
    reason: string;
  }) => Promise<void>;
  adminLookup: (input: {
    query: string;
    type: "ALL" | "SELLERS" | "CUSTOMERS" | "ORDERS";
  }) => Promise<{
    sellers: Array<{
      id: string;
      sellerCode: string;
      displayName: string;
      isActive: boolean;
      isQrActive: boolean;
    }>;
    customers: Array<{
      id: string;
      fullName: string;
      phone: string;
      whatsappNumber: string;
      email: string | null;
    }>;
    orders: Array<{
      id: string;
      orderNumber: string;
      quantity: number;
      totalAmountPaise: number;
      status: string;
      customerName: string | null;
      sellerCode: string | null;
    }>;
  }>;
  listAuditLogs?: (limit?: number) => Promise<MobileAuditLogItem[]>;
  getSuperAdminOverview?: () => Promise<MobileSuperAdminOverviewData>;
  requestFirstPrizeApprovalRpc?: (input: {
    drawId: string;
    prizeId: string;
    snapshotId: string;
    actorUserId: string;
  }) => Promise<string>;
  recordFirstPrizeApprovalRpc?: (input: {
    approvalId: string;
    decision: "APPROVED" | "REJECTED";
    notes: string;
    actorUserId: string;
  }) => Promise<void>;
  setSellerLifecycleStatus?: (input: {
    sellerId: string;
    action: "DEACTIVATE" | "REACTIVATE";
    actorUserId: string;
  }) => Promise<{ sellerCode: string; isActive: boolean; message: string }>;
  getSuperAdminPaymentScreenshotUrl?: (input: {
    paymentId: string;
    actorUserId: string;
    actorRoles: string[];
  }) => Promise<{
    url: string;
    fileName: string;
    expiresInSeconds: number;
  }>;
  getCustomerDashboardByProfileId?: (
    profileId: string
  ) => Promise<MobileCustomerDashboardData | null>;
  verifyTicketByNumber?: (
    ticketNumber: string
  ) => Promise<MobileTicketVerificationResult>;
}

function buildSellerUpiInstructions(
  orderNumber: string,
  totalAmountPaise: number,
  seller: {
    display_name?: string | null;
    upi_id?: string | null;
    account_name?: string | null;
    payment_instructions?: string | null;
    is_qr_active?: boolean | null;
    qr_storage_path?: string | null;
  },
  snapshot?: {
    snapshot_upi_id?: string | null;
    snapshot_account_name?: string | null;
    snapshot_seller_display_name?: string | null;
    snapshot_payment_instructions?: string | null;
    snapshot_qr_storage_path?: string | null;
  }
) {
  const effectiveUpiId =
    snapshot?.snapshot_upi_id ||
    (seller.is_qr_active ? seller.upi_id ?? null : null) ||
    null;
  const effectivePayeeName =
    snapshot?.snapshot_account_name ||
    snapshot?.snapshot_seller_display_name ||
    seller.account_name ||
    seller.display_name ||
    "SSFI Seller";
  const effectiveInstructions =
    snapshot?.snapshot_payment_instructions ??
    seller.payment_instructions ??
    null;
  const isQrActive = Boolean(
    effectiveUpiId &&
      (snapshot?.snapshot_qr_storage_path ||
        (seller.is_qr_active && seller.qr_storage_path))
  );

  const upiUri = effectiveUpiId
    ? buildUpiPaymentUri({
        payeeVpa: effectiveUpiId,
        payeeName: effectivePayeeName,
        amountPaise: totalAmountPaise,
        orderNumber,
        transactionRef: orderNumber,
        currency: manualUpiConfig.currency,
      })
    : null;

  return {
    payeeName: effectivePayeeName,
    upiId: effectiveUpiId,
    amountPaise: totalAmountPaise,
    currency: manualUpiConfig.currency,
    upiUri,
    paymentInstructions: effectiveInstructions,
    isQrActive,
  };
}

function mapRawSellerOrder(
  raw: Record<string, unknown>,
  seller: SellerProfileRecord
): MobileSellerOrderSummary {
  const rawCust = raw.customers;
  const custObj = (Array.isArray(rawCust) ? rawCust[0] : rawCust) as
    | Record<string, unknown>
    | null
    | undefined;

  const rawPayments = raw.payments;
  const payObj = (Array.isArray(rawPayments) ? rawPayments[0] : rawPayments) as
    | Record<string, unknown>
    | null
    | undefined;

  const rawScreenshots = payObj?.payment_screenshots;
  const hasScreenshot = Array.isArray(rawScreenshots)
    ? rawScreenshots.length > 0
    : Boolean(rawScreenshots);

  const rawTickets = Array.isArray(raw.tickets) ? raw.tickets : [];
  const tickets: MobileOrderTicketItem[] = rawTickets.map((t) => {
    const item = t as Record<string, unknown>;
    return {
      ticketNumber: String(item.ticket_number ?? ""),
      status: String(item.status ?? "ISSUED"),
      issuedAt: item.issued_at ? String(item.issued_at) : null,
    };
  });

  const orderNumber = String(raw.order_number ?? "");
  const totalAmountPaise = Number(raw.total_amount_paise ?? 0);

  return {
    id: String(raw.id ?? ""),
    orderNumber,
    quantity: Number(raw.quantity ?? 0),
    totalAmountPaise,
    status: String(raw.status ?? "PENDING_PAYMENT"),
    createdAt: String(raw.created_at ?? ""),
    customer: {
      fullName: String(custObj?.full_name ?? "Customer"),
      phone: custObj?.phone ? String(custObj.phone) : null,
      whatsappNumber: custObj?.whatsapp_number
        ? String(custObj.whatsapp_number)
        : null,
      email: custObj?.email ? String(custObj.email) : null,
    },
    payment: {
      id: payObj?.id ? String(payObj.id) : null,
      status: payObj?.status ? String(payObj.status) : "PENDING",
      utrReference: payObj?.utr_reference ? String(payObj.utr_reference) : null,
      payerName: payObj?.payer_name ? String(payObj.payer_name) : null,
      rejectionReason: payObj?.rejection_reason
        ? String(payObj.rejection_reason)
        : null,
      submittedAt: payObj?.submitted_at ? String(payObj.submitted_at) : null,
      hasScreenshot,
    },
    tickets,
    upiInstructions: buildSellerUpiInstructions(
      orderNumber,
      totalAmountPaise,
      seller,
      {
        snapshot_upi_id: raw.snapshot_upi_id
          ? String(raw.snapshot_upi_id)
          : null,
        snapshot_account_name: raw.snapshot_account_name
          ? String(raw.snapshot_account_name)
          : null,
        snapshot_seller_display_name: raw.snapshot_seller_display_name
          ? String(raw.snapshot_seller_display_name)
          : null,
        snapshot_payment_instructions: raw.snapshot_payment_instructions
          ? String(raw.snapshot_payment_instructions)
          : null,
        snapshot_qr_storage_path: raw.snapshot_qr_storage_path
          ? String(raw.snapshot_qr_storage_path)
          : null,
      }
    ),
  };
}

function mapRawAdminPayment(raw: Record<string, unknown>): MobileAdminPaymentItem {
  const rawScreenshots = raw.payment_screenshots;
  const screenshotObj = (
    Array.isArray(rawScreenshots) ? rawScreenshots[0] : rawScreenshots
  ) as Record<string, unknown> | null | undefined;

  const rawOrder = raw.orders;
  const orderObj = (Array.isArray(rawOrder) ? rawOrder[0] : rawOrder) as
    | Record<string, unknown>
    | null
    | undefined;

  const rawCust = orderObj?.customers;
  const custObj = (Array.isArray(rawCust) ? rawCust[0] : rawCust) as
    | Record<string, unknown>
    | null
    | undefined;

  const rawSnapSeller = orderObj?.sellers;
  const snapSellerObj = (
    Array.isArray(rawSnapSeller) ? rawSnapSeller[0] : rawSnapSeller
  ) as Record<string, unknown> | null | undefined;

  const rawOpSeller = orderObj?.operational_seller;
  const opSellerObj = (
    Array.isArray(rawOpSeller) ? rawOpSeller[0] : rawOpSeller
  ) as Record<string, unknown> | null | undefined;

  const effectiveSeller =
    snapSellerObj ||
    (orderObj?.snapshot_seller_display_name
      ? {
          id: orderObj?.snapshot_seller_id ?? null,
          display_name: orderObj.snapshot_seller_display_name,
          seller_code: orderObj.snapshot_seller_code ?? "",
        }
      : opSellerObj);

  const rawTickets = Array.isArray(orderObj?.tickets) ? orderObj.tickets : [];
  const tickets: MobileOrderTicketItem[] = rawTickets.map((t) => {
    const item = t as Record<string, unknown>;
    return {
      ticketNumber: String(item.ticket_number ?? ""),
      status: String(item.status ?? "ISSUED"),
    };
  });

  return {
    id: String(raw.id ?? ""),
    status: String(raw.status ?? "SUBMITTED"),
    amountPaise: Number(raw.amount_paise ?? 0),
    utrReference: raw.utr_reference ? String(raw.utr_reference) : null,
    payerName: raw.payer_name ? String(raw.payer_name) : null,
    submittedAt: raw.submitted_at ? String(raw.submitted_at) : null,
    createdAt: raw.created_at ? String(raw.created_at) : null,
    rejectionReason: raw.rejection_reason ? String(raw.rejection_reason) : null,
    sellerReviewStatus: raw.seller_review_status
      ? String(raw.seller_review_status)
      : null,
    sellerReviewNote: raw.seller_review_note
      ? String(raw.seller_review_note)
      : null,
    hasScreenshot: Boolean(screenshotObj),
    screenshotMeta: screenshotObj
      ? {
          uploadedAt: String(screenshotObj.uploaded_at ?? ""),
          fileSizeBytes: Number(screenshotObj.file_size_bytes ?? 0),
          contentType: screenshotObj.content_type
            ? String(screenshotObj.content_type)
            : null,
        }
      : null,
    order: orderObj
      ? {
          id: String(orderObj.id ?? ""),
          orderNumber: String(orderObj.order_number ?? ""),
          quantity: Number(orderObj.quantity ?? 0),
          totalAmountPaise: Number(orderObj.total_amount_paise ?? 0),
          status: String(orderObj.status ?? ""),
          snapshotUpiId: orderObj.snapshot_upi_id
            ? String(orderObj.snapshot_upi_id)
            : null,
          snapshotAccountName: orderObj.snapshot_account_name
            ? String(orderObj.snapshot_account_name)
            : null,
          customer: custObj
            ? {
                id: String(custObj.id ?? ""),
                fullName: String(custObj.full_name ?? ""),
                phone: String(custObj.phone ?? ""),
                whatsappNumber: String(custObj.whatsapp_number ?? ""),
                email: custObj.email ? String(custObj.email) : null,
              }
            : null,
          seller: effectiveSeller
            ? {
                id: effectiveSeller.id ? String(effectiveSeller.id) : null,
                displayName: String(effectiveSeller.display_name ?? ""),
                sellerCode: String(effectiveSeller.seller_code ?? ""),
              }
            : null,
          tickets,
        }
      : null,
  };
}

function mapRawAuditLog(raw: Record<string, unknown>): MobileAuditLogItem {
  const action = String(raw.action ?? "SYSTEM_EVENT");
  const entityType = String(raw.entity_type ?? "system");
  const meta =
    raw.metadata && typeof raw.metadata === "object"
      ? (raw.metadata as Record<string, unknown>)
      : {};
  const actorRole = meta.actor_role ? String(meta.actor_role) : "STAFF";
  const reason = meta.reason ? String(meta.reason) : null;
  const sellerCode = meta.seller_code ? String(meta.seller_code) : null;
  const ticketNumber = meta.ticket_number ? String(meta.ticket_number) : null;

  const summaryParts = [action, `(${entityType})`];
  if (sellerCode) summaryParts.push(`Seller: ${sellerCode}`);
  if (ticketNumber) summaryParts.push(`Ticket: ${ticketNumber}`);
  if (reason) summaryParts.push(`Note: ${reason}`);

  return {
    id: String(raw.id ?? ""),
    action,
    entityType,
    createdAt: String(raw.created_at ?? ""),
    actorRole,
    summary: summaryParts.join(" • "),
  };
}

export function createDefaultMobileOperationsDeps(): MobileOperationsDependencies {
  return {
    async getSellerByProfileId(profileId: string) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const { data, error } = await db
        .from("sellers")
        .select(
          "id, profile_id, seller_code, display_name, is_active, is_qr_active, qr_storage_path, upi_id, account_name, payment_instructions"
        )
        .eq("profile_id", profileId)
        .maybeSingle();
      if (error) throw new Error("SELLER_LOOKUP_FAILED");
      if (!data) return null;
      return {
        id: String(data.id),
        profile_id: String(data.profile_id),
        seller_code: String(data.seller_code),
        display_name: String(data.display_name),
        is_active: data.is_active === true,
        is_qr_active: data.is_qr_active === true,
        qr_storage_path: data.qr_storage_path ? String(data.qr_storage_path) : null,
        upi_id: data.upi_id ? String(data.upi_id) : null,
        account_name: data.account_name ? String(data.account_name) : null,
        payment_instructions: data.payment_instructions
          ? String(data.payment_instructions)
          : null,
      };
    },

    async getCampaign() {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const { data, error } = await db
        .from("campaigns")
        .select(
          "id, public_id, name, status, ticket_price_paise, total_ticket_limit, sold_ticket_count, start_at, end_at"
        )
        .eq("public_id", "ssfi-fundraising-lucky-draw")
        .maybeSingle();
      if (error) throw new Error("CAMPAIGN_LOOKUP_FAILED");
      if (!data) return null;
      return {
        id: String(data.id),
        public_id: String(data.public_id),
        name: String(data.name ?? "SSFI Fundraising Lucky Draw"),
        status: String(data.status ?? "DRAFT"),
        ticket_price_paise: Number(data.ticket_price_paise ?? 10000),
        total_ticket_limit: Number(data.total_ticket_limit ?? 1000),
        sold_ticket_count: Number(data.sold_ticket_count ?? 0),
        start_at: data.start_at ? String(data.start_at) : null,
        end_at: data.end_at ? String(data.end_at) : null,
      };
    },

    async runScheduledTransitions() {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      try {
        await db.rpc("process_scheduled_campaign_transitions");
      } catch {
        // Non-fatal pre-flight transition sync
      }
    },

    async getSellerUnreadMessagesCount(sellerId: string) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const { count } = await db
        .from("seller_messages")
        .select("id", { count: "exact", head: true })
        .eq("recipient_seller_id", sellerId)
        .neq("sender_role", "SELLER")
        .is("read_at", null)
        .is("archived_at", null);
      return count ?? 0;
    },

    async listSellerOrders(sellerId, filters) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const { data: sellerRow } = await db
        .from("sellers")
        .select(
          "id, profile_id, seller_code, display_name, is_active, is_qr_active, qr_storage_path, upi_id, account_name, payment_instructions"
        )
        .eq("id", sellerId)
        .maybeSingle();

      const sellerRecord: SellerProfileRecord = sellerRow
        ? {
            id: String(sellerRow.id),
            profile_id: String(sellerRow.profile_id),
            seller_code: String(sellerRow.seller_code),
            display_name: String(sellerRow.display_name),
            is_active: sellerRow.is_active === true,
            is_qr_active: sellerRow.is_qr_active === true,
            qr_storage_path: sellerRow.qr_storage_path
              ? String(sellerRow.qr_storage_path)
              : null,
            upi_id: sellerRow.upi_id ? String(sellerRow.upi_id) : null,
            account_name: sellerRow.account_name
              ? String(sellerRow.account_name)
              : null,
            payment_instructions: sellerRow.payment_instructions
              ? String(sellerRow.payment_instructions)
              : null,
          }
        : {
            id: sellerId,
            profile_id: "",
            seller_code: "",
            display_name: "Seller",
            is_active: true,
            is_qr_active: false,
            qr_storage_path: null,
            upi_id: null,
            account_name: null,
            payment_instructions: null,
          };

      let query = db
        .from("orders")
        .select(
          "id, order_number, quantity, total_amount_paise, status, created_at, snapshot_upi_id, snapshot_account_name, snapshot_seller_display_name, snapshot_payment_instructions, snapshot_qr_storage_path, customers(full_name, phone, whatsapp_number, email), payments(id, status, utr_reference, payer_name, rejection_reason, submitted_at, payment_screenshots(id)), tickets(ticket_number, status, issued_at)"
        )
        .eq("seller_id", sellerId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (filters?.status && filters.status !== "ALL") {
        query = query.eq("status", filters.status);
      }

      const { data, error } = await query;
      if (error) throw new Error("SELLER_ORDERS_QUERY_FAILED");

      let mapped = (data ?? []).map((row) =>
        mapRawSellerOrder(row as Record<string, unknown>, sellerRecord)
      );

      const q = (filters?.query ?? "").trim().toLowerCase();
      if (q) {
        mapped = mapped.filter(
          (o) =>
            o.orderNumber.toLowerCase().includes(q) ||
            o.customer.fullName.toLowerCase().includes(q) ||
            (o.customer.phone ?? "").toLowerCase().includes(q) ||
            (o.customer.whatsappNumber ?? "").toLowerCase().includes(q) ||
            (o.payment.utrReference ?? "").toLowerCase().includes(q)
        );
      }
      return mapped;
    },

    async getSellerOrderById(sellerId, orderId) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const { data: sellerRow } = await db
        .from("sellers")
        .select(
          "id, profile_id, seller_code, display_name, is_active, is_qr_active, qr_storage_path, upi_id, account_name, payment_instructions"
        )
        .eq("id", sellerId)
        .maybeSingle();

      const { data, error } = await db
        .from("orders")
        .select(
          "id, order_number, quantity, total_amount_paise, status, created_at, snapshot_upi_id, snapshot_account_name, snapshot_seller_display_name, snapshot_payment_instructions, snapshot_qr_storage_path, customers(full_name, phone, whatsapp_number, email), payments(id, status, utr_reference, payer_name, rejection_reason, submitted_at, payment_screenshots(id)), tickets(ticket_number, status, issued_at)"
        )
        .eq("id", orderId)
        .eq("seller_id", sellerId)
        .maybeSingle();
      if (error) throw new Error("SELLER_ORDER_LOOKUP_FAILED");
      if (!data) return null;

      const sellerRecord: SellerProfileRecord = sellerRow
        ? {
            id: String(sellerRow.id),
            profile_id: String(sellerRow.profile_id),
            seller_code: String(sellerRow.seller_code),
            display_name: String(sellerRow.display_name),
            is_active: sellerRow.is_active === true,
            is_qr_active: sellerRow.is_qr_active === true,
            qr_storage_path: sellerRow.qr_storage_path
              ? String(sellerRow.qr_storage_path)
              : null,
            upi_id: sellerRow.upi_id ? String(sellerRow.upi_id) : null,
            account_name: sellerRow.account_name
              ? String(sellerRow.account_name)
              : null,
            payment_instructions: sellerRow.payment_instructions
              ? String(sellerRow.payment_instructions)
              : null,
          }
        : {
            id: sellerId,
            profile_id: "",
            seller_code: "",
            display_name: "Seller",
            is_active: true,
            is_qr_active: false,
            qr_storage_path: null,
            upi_id: null,
            account_name: null,
            payment_instructions: null,
          };

      return mapRawSellerOrder(data as Record<string, unknown>, sellerRecord);
    },

    async lookupSellerCustomers(sellerId, query) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const { data, error } = await db
        .from("orders")
        .select(
          "customer_id, customers(id, full_name, phone, whatsapp_number, email)"
        )
        .eq("seller_id", sellerId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error("SELLER_CUSTOMER_LOOKUP_FAILED");

      const q = query.trim().toLowerCase();
      const map = new Map<string, SellerCustomerSummary>();
      for (const row of data ?? []) {
        const rawCust = (row as Record<string, unknown>).customers;
        const cust = (Array.isArray(rawCust) ? rawCust[0] : rawCust) as
          | Record<string, unknown>
          | null
          | undefined;
        if (!cust?.id) continue;
        const id = String(cust.id);
        const fullName = String(cust.full_name ?? "");
        const phone = String(cust.phone ?? "");
        const whatsappNumber = String(cust.whatsapp_number ?? phone);
        const email = cust.email ? String(cust.email) : null;

        if (
          q &&
          !fullName.toLowerCase().includes(q) &&
          !phone.toLowerCase().includes(q) &&
          !whatsappNumber.toLowerCase().includes(q) &&
          !(email ?? "").toLowerCase().includes(q)
        ) {
          continue;
        }

        const existing = map.get(id);
        if (existing) {
          existing.totalOrdersWithSeller += 1;
        } else {
          map.set(id, {
            id,
            fullName,
            phone,
            whatsappNumber,
            email,
            totalOrdersWithSeller: 1,
          });
        }
      }
      return Array.from(map.values()).slice(0, 25);
    },

    async createSellerOrderRpc({
      seller,
      actorUserId,
      name,
      whatsapp,
      email,
      quantity,
    }) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const { data: orderId, error } = await db.rpc("create_seller_order", {
        p_seller_id: seller.id,
        p_name: name,
        p_whatsapp: whatsapp,
        p_email: email,
        p_quantity: quantity,
        p_actor: actorUserId,
      });

      if (error || !orderId) {
        const msg = error?.message ?? "Failed to create sale.";
        if (msg.includes("capacity")) {
          throw new Error(
            "Sorry, the requested quantity exceeds remaining campaign ticket capacity."
          );
        }
        if (msg.includes("have not opened yet")) {
          throw new Error("Ticket sales have not opened yet for this campaign.");
        }
        if (msg.includes("have ended")) {
          throw new Error("Ticket sales for this lucky draw have ended.");
        }
        if (msg.includes("active campaign not found")) {
          throw new Error("Ticket sales are currently not active for this campaign.");
        }
        if (msg.includes("seller is inactive")) {
          throw new Error("Your seller account is currently inactive.");
        }
        throw new Error("Unable to create this sale. Please try again.");
      }

      try {
        await db
          .from("orders")
          .update({
            snapshot_seller_id: seller.id,
            snapshot_seller_code: seller.seller_code,
            snapshot_seller_display_name: seller.display_name,
            snapshot_qr_storage_path: seller.qr_storage_path,
            snapshot_upi_id: seller.upi_id ?? null,
            snapshot_account_name: seller.account_name ?? null,
            snapshot_payment_instructions: seller.payment_instructions ?? null,
            snapshot_captured_at: new Date().toISOString(),
          })
          .eq("id", orderId);
      } catch {
        // Non-fatal snapshot capture warning
      }

      return String(orderId);
    },

    async submitSellerManualUpiRpc({ sellerId, orderId, utr, payerName }) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const { data: order, error: orderErr } = await db
        .from("orders")
        .select("id, status")
        .eq("id", orderId)
        .eq("seller_id", sellerId)
        .maybeSingle();

      if (orderErr || !order) {
        throw new Error("OWNERSHIP_DENIED");
      }
      if (order.status !== "PENDING_PAYMENT") {
        if (order.status === "PAYMENT_SUBMITTED") {
          throw new Error("ALREADY_SUBMITTED");
        }
        throw new Error("ORDER_NOT_ELIGIBLE");
      }

      const { data: paymentRecord } = await db
        .from("payments")
        .select("id")
        .eq("order_id", orderId)
        .maybeSingle();

      let hasScreenshot = false;
      if (paymentRecord?.id) {
        const { data: screenshotRecord } = await db
          .from("payment_screenshots")
          .select("id")
          .eq("payment_id", paymentRecord.id)
          .maybeSingle();
        hasScreenshot = Boolean(screenshotRecord);
      }

      if (!hasScreenshot) {
        throw new Error("SCREENSHOT_REQUIRED");
      }

      const { error } = await db.rpc("submit_manual_upi", {
        p_order_id: orderId,
        p_utr: utr || null,
        p_payer_name: payerName || null,
      });

      if (error) {
        const msg = error.message ?? "";
        if (
          msg.includes("already been submitted") ||
          msg.includes("already attached") ||
          msg.includes("payments_manual_upi_utr_unique")
        ) {
          throw new Error("DUPLICATE_UTR_OR_SUBMISSION");
        }
        if (msg.includes("screenshot is mandatory")) {
          throw new Error("SCREENSHOT_REQUIRED");
        }
        throw new Error("SUBMIT_FAILED");
      }
    },

    async uploadSellerOrderScreenshot({
      sellerId,
      actorUserId,
      orderId,
      bytes,
      contentType,
      extension,
      fileSizeBytes,
    }) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();

      // 1. Canonical seller ownership validation
      const { data: order, error: orderErr } = await db
        .from("orders")
        .select("id, status")
        .eq("id", orderId)
        .eq("seller_id", sellerId)
        .maybeSingle();

      if (orderErr || !order) {
        throw new Error("OWNERSHIP_DENIED");
      }

      if (!["PENDING_PAYMENT", "PAYMENT_SUBMITTED"].includes(String(order.status))) {
        throw new Error("ORDER_NOT_EDITABLE");
      }

      // 2. Payment eligibility validation
      const { data: payment } = await db
        .from("payments")
        .select("id, status")
        .eq("order_id", orderId)
        .maybeSingle();

      if (!payment || !["PENDING", "SUBMITTED", "FAILED"].includes(String(payment.status))) {
        throw new Error("PAYMENT_NOT_EDITABLE");
      }
      const paymentId = String(payment.id);

      // 3. Enforce private storage bucket integrity (never upload to a public bucket)
      const { data: bucketInfo } = await db.storage.getBucket(PAYMENT_SCREENSHOT_BUCKET);
      if (bucketInfo?.public === true) {
        throw new Error("PUBLIC_BUCKET_VIOLATION");
      }

      const { data: existing } = await db
        .from("payment_screenshots")
        .select("id, storage_path")
        .eq("payment_id", paymentId)
        .maybeSingle();

      const newPath = `${crypto.randomUUID()}.${extension}`;
      const { error: uploadErr } = await db.storage
        .from(PAYMENT_SCREENSHOT_BUCKET)
        .upload(newPath, bytes, { contentType, upsert: false });

      if (uploadErr) {
        throw new Error("STORAGE_UPLOAD_FAILED");
      }

      const uploadedAt = new Date().toISOString();

      if (existing?.id) {
        const { error: updateErr } = await db
          .from("payment_screenshots")
          .update({
            storage_path: newPath,
            content_type: contentType,
            file_size_bytes: fileSizeBytes,
            uploaded_at: uploadedAt,
          })
          .eq("id", existing.id);

        if (updateErr) {
          await db.storage.from(PAYMENT_SCREENSHOT_BUCKET).remove([newPath]);
          throw new Error("METADATA_SAVE_FAILED");
        }

        // Remove superseded screenshot object to avoid orphaned files
        if (existing.storage_path) {
          await db.storage
            .from(PAYMENT_SCREENSHOT_BUCKET)
            .remove([String(existing.storage_path)]);
        }

        await db.from("payment_events").insert({
          payment_id: paymentId,
          event_type: "SCREENSHOT_REPLACED",
          metadata: {
            content_type: contentType,
            file_size_bytes: fileSizeBytes,
            source: "mobile_api_v1",
          },
        });

        await db.from("audit_logs").insert({
          actor_user_id: actorUserId,
          action: "PAYMENT_SCREENSHOT_REPLACED",
          entity_type: "payment",
          entity_id: paymentId,
          metadata: {
            actor_role: "SELLER",
            order_id: orderId,
            payment_id: paymentId,
            reason: "Seller replaced payment screenshot proof via mobile API",
            new_value: {
              content_type: contentType,
              file_size_bytes: fileSizeBytes,
            },
          },
        });

        return {
          replaced: true,
          contentType,
          fileSizeBytes,
          uploadedAt,
        };
      }

      const { error: insertErr } = await db.from("payment_screenshots").insert({
        payment_id: paymentId,
        storage_path: newPath,
        content_type: contentType,
        file_size_bytes: fileSizeBytes,
      });

      if (insertErr) {
        await db.storage.from(PAYMENT_SCREENSHOT_BUCKET).remove([newPath]);
        throw new Error("METADATA_SAVE_FAILED");
      }

      await db.from("payment_events").insert({
        payment_id: paymentId,
        event_type: "SCREENSHOT_SUBMITTED",
        metadata: {
          content_type: contentType,
          file_size_bytes: fileSizeBytes,
          source: "mobile_api_v1",
        },
      });

      await db.from("audit_logs").insert({
        actor_user_id: actorUserId,
        action: "PAYMENT_SCREENSHOT_UPLOADED",
        entity_type: "payment",
        entity_id: paymentId,
        metadata: {
          actor_role: "SELLER",
          order_id: orderId,
          payment_id: paymentId,
          reason: "Seller uploaded payment screenshot proof via mobile API",
          new_value: {
            content_type: contentType,
            file_size_bytes: fileSizeBytes,
          },
        },
      });

      return {
        replaced: false,
        contentType,
        fileSizeBytes,
        uploadedAt,
      };
    },

    async getAdminCollectionSummary() {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const [campaignRes, paymentsRes, ordersRes, sellersRes] = await Promise.all([
        db
          .from("campaigns")
          .select(
            "name, status, ticket_price_paise, total_ticket_limit, sold_ticket_count"
          )
          .eq("public_id", "ssfi-fundraising-lucky-draw")
          .maybeSingle(),
        db.from("payments").select("status, amount_paise"),
        db.from("orders").select("id", { count: "exact", head: true }),
        db
          .from("sellers")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true),
      ]);

      if (
        campaignRes.error ||
        paymentsRes.error ||
        ordersRes.error ||
        sellersRes.error
      ) {
        throw new Error("ADMIN_SUMMARY_QUERY_FAILED");
      }

      const payments = (paymentsRes.data ?? []) as Array<{
        status: string;
        amount_paise: number;
      }>;
      const verified = payments.filter((p) => p.status === "VERIFIED");
      const pending = payments.filter((p) => p.status === "SUBMITTED");
      const rejected = payments.filter((p) => p.status === "FAILED");
      const verifiedCollectionPaise = verified.reduce(
        (acc, p) => acc + Number(p.amount_paise ?? 0),
        0
      );

      const totalLimit = Number(campaignRes.data?.total_ticket_limit ?? 1000);
      const soldCount = Number(campaignRes.data?.sold_ticket_count ?? 0);

      return {
        verifiedCollectionPaise,
        verifiedPaymentsCount: verified.length,
        pendingPaymentsCount: pending.length,
        rejectedPaymentsCount: rejected.length,
        totalOrdersCount: ordersRes.count ?? 0,
        activeSellersCount: sellersRes.count ?? 0,
        campaign: {
          name: String(
            campaignRes.data?.name ?? "SSFI Fundraising Lucky Draw"
          ),
          status: String(campaignRes.data?.status ?? "DRAFT"),
          ticketPricePaise: Number(
            campaignRes.data?.ticket_price_paise ?? 10000
          ),
          totalTicketLimit: totalLimit,
          soldTicketCount: soldCount,
          remainingTicketCount: Math.max(0, totalLimit - soldCount),
        },
      };
    },

    async listAdminPayments(filters) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const statusFilter = (filters?.status ?? "SUBMITTED").toUpperCase();

      let query = db
        .from("payments")
        .select(
          "id, status, amount_paise, utr_reference, payer_name, submitted_at, created_at, rejection_reason, seller_review_status, seller_review_note, payment_screenshots(uploaded_at, file_size_bytes, content_type), orders(id, order_number, quantity, total_amount_paise, status, seller_id, snapshot_seller_id, snapshot_upi_id, snapshot_account_name, snapshot_seller_display_name, snapshot_seller_code, customers(id, full_name, phone, whatsapp_number, email), sellers:sellers!orders_snapshot_seller_id_fkey(id, display_name, seller_code), operational_seller:sellers!orders_seller_id_fkey(id, display_name, seller_code), tickets(ticket_number, status))"
        )
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .limit(50);

      if (statusFilter !== "ALL") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw new Error("ADMIN_PAYMENTS_QUERY_FAILED");

      let items = (data ?? []).map((row) =>
        mapRawAdminPayment(row as Record<string, unknown>)
      );

      if (filters?.sellerId) {
        items = items.filter((p) => p.order?.seller?.id === filters.sellerId);
      }

      const q = (filters?.query ?? "").trim().toLowerCase();
      if (q) {
        items = items.filter(
          (p) =>
            (p.utrReference ?? "").toLowerCase().includes(q) ||
            (p.payerName ?? "").toLowerCase().includes(q) ||
            (p.order?.orderNumber ?? "").toLowerCase().includes(q) ||
            (p.order?.customer?.fullName ?? "").toLowerCase().includes(q) ||
            (p.order?.customer?.phone ?? "").toLowerCase().includes(q) ||
            (p.order?.seller?.sellerCode ?? "").toLowerCase().includes(q) ||
            (p.order?.seller?.displayName ?? "").toLowerCase().includes(q)
        );
      }
      return items;
    },

    async getAdminPaymentById(paymentId) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const { data, error } = await db
        .from("payments")
        .select(
          "id, status, amount_paise, utr_reference, payer_name, submitted_at, created_at, rejection_reason, seller_review_status, seller_review_note, payment_screenshots(uploaded_at, file_size_bytes, content_type), orders(id, order_number, quantity, total_amount_paise, status, seller_id, snapshot_seller_id, snapshot_upi_id, snapshot_account_name, snapshot_seller_display_name, snapshot_seller_code, customers(id, full_name, phone, whatsapp_number, email), sellers:sellers!orders_snapshot_seller_id_fkey(id, display_name, seller_code), operational_seller:sellers!orders_seller_id_fkey(id, display_name, seller_code), tickets(ticket_number, status))"
        )
        .eq("id", paymentId)
        .maybeSingle();
      if (error) throw new Error("ADMIN_PAYMENT_DETAIL_FAILED");
      if (!data) return null;
      return mapRawAdminPayment(data as Record<string, unknown>);
    },

    async verifyPaymentAndIssueRpc({ paymentId, actorUserId }) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const { data, error } = await db.rpc("verify_payment_and_issue", {
        p_payment_id: paymentId,
        p_actor: actorUserId,
      });
      if (error) {
        const msg = error.message ?? "";
        if (msg.includes("not awaiting verification")) {
          throw new Error("PAYMENT_NOT_AWAITING_VERIFICATION");
        }
        if (msg.includes("campaign is not active")) {
          throw new Error("CAMPAIGN_NOT_ACTIVE");
        }
        if (msg.includes("ticket limit exceeded")) {
          throw new Error("CAMPAIGN_TICKET_LIMIT_EXCEEDED");
        }
        throw new Error("PAYMENT_VERIFICATION_FAILED");
      }

      const rawTickets = Array.isArray(data) ? data : [];
      return rawTickets.map((t) => {
        const row = t as Record<string, unknown>;
        return {
          ticketNumber: String(row.ticket_number ?? ""),
          status: String(row.status ?? "ISSUED"),
        };
      });
    },

    async rejectPaymentRpc({ paymentId, actorUserId, reason }) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const { error } = await db.rpc("reject_payment", {
        p_payment_id: paymentId,
        p_actor: actorUserId,
        p_reason: reason,
      });
      if (error) {
        const msg = error.message ?? "";
        if (msg.includes("not awaiting verification")) {
          throw new Error("PAYMENT_NOT_AWAITING_VERIFICATION");
        }
        throw new Error("PAYMENT_REJECTION_FAILED");
      }
    },

    async adminLookup({ query, type }) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const q = sanitizePostgrestSearchTerm(query);
      if (q.length < 2) {
        return { sellers: [], customers: [], orders: [] };
      }
      const safeLike = `%${q}%`;

      const [sellersRes, customersRes, ordersRes] = await Promise.all([
        type === "ALL" || type === "SELLERS"
          ? db
              .from("sellers")
              .select("id, seller_code, display_name, is_active, is_qr_active")
              .or(`seller_code.ilike.${safeLike},display_name.ilike.${safeLike}`)
              .order("seller_code", { ascending: true })
              .limit(20)
          : Promise.resolve({ data: [], error: null }),
        type === "ALL" || type === "CUSTOMERS"
          ? db
              .from("customers")
              .select("id, full_name, phone, whatsapp_number, email")
              .or(
                `full_name.ilike.${safeLike},phone.ilike.${safeLike},whatsapp_number.ilike.${safeLike},email.ilike.${safeLike}`
              )
              .limit(20)
          : Promise.resolve({ data: [], error: null }),
        type === "ALL" || type === "ORDERS"
          ? db
              .from("orders")
              .select(
                "id, order_number, quantity, total_amount_paise, status, customers(full_name), sellers:sellers!orders_seller_id_fkey(seller_code)"
              )
              .ilike("order_number", safeLike)
              .order("created_at", { ascending: false })
              .limit(20)
          : Promise.resolve({ data: [], error: null }),
      ]);

      return {
        sellers: (sellersRes.data ?? []).map((s) => {
          const row = s as Record<string, unknown>;
          return {
            id: String(row.id ?? ""),
            sellerCode: String(row.seller_code ?? ""),
            displayName: String(row.display_name ?? ""),
            isActive: row.is_active === true,
            isQrActive: row.is_qr_active === true,
          };
        }),
        customers: (customersRes.data ?? []).map((c) => {
          const row = c as Record<string, unknown>;
          return {
            id: String(row.id ?? ""),
            fullName: String(row.full_name ?? ""),
            phone: String(row.phone ?? ""),
            whatsappNumber: String(row.whatsapp_number ?? ""),
            email: row.email ? String(row.email) : null,
          };
        }),
        orders: (ordersRes.data ?? []).map((o) => {
          const row = o as Record<string, unknown>;
          const cust = Array.isArray(row.customers)
            ? row.customers[0]
            : row.customers;
          const sell = Array.isArray(row.sellers)
            ? row.sellers[0]
            : row.sellers;
          return {
            id: String(row.id ?? ""),
            orderNumber: String(row.order_number ?? ""),
            quantity: Number(row.quantity ?? 0),
            totalAmountPaise: Number(row.total_amount_paise ?? 0),
            status: String(row.status ?? ""),
            customerName: (cust as Record<string, unknown> | null)?.full_name
              ? String((cust as Record<string, unknown>).full_name)
              : null,
            sellerCode: (sell as Record<string, unknown> | null)?.seller_code
              ? String((sell as Record<string, unknown>).seller_code)
              : null,
          };
        }),
      };
    },

    async listAuditLogs(limit = 30) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const { data, error } = await db
        .from("audit_logs")
        .select("id, action, entity_type, created_at, metadata")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error("AUDIT_LOGS_QUERY_FAILED");
      return (data ?? []).map((row) =>
        mapRawAuditLog(row as Record<string, unknown>)
      );
    },

    async getSuperAdminOverview() {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const [
        campaignRes,
        paymentsRes,
        profilesRes,
        sellersRes,
        auditRes,
      ] = await Promise.all([
        db
          .from("campaigns")
          .select(
            "id, name, status, ticket_price_paise, total_ticket_limit, sold_ticket_count"
          )
          .eq("public_id", "ssfi-fundraising-lucky-draw")
          .maybeSingle(),
        db.from("payments").select("status, amount_paise"),
        db
          .from("profiles")
          .select("id, full_name, email, is_active, profile_roles(roles(name))")
          .order("created_at", { ascending: false })
          .limit(50),
        db
          .from("sellers")
          .select(
            "id, seller_code, display_name, is_active, is_qr_active, upi_id"
          )
          .order("seller_code", { ascending: true })
          .limit(100),
        db
          .from("audit_logs")
          .select("id, action, entity_type, created_at, metadata")
          .order("created_at", { ascending: false })
          .limit(25),
      ]);

      const campaign = campaignRes.data;
      const payments = (paymentsRes.data ?? []) as Array<{
        status: string;
        amount_paise: number;
      }>;
      const verified = payments.filter((p) => p.status === "VERIFIED");
      const pending = payments.filter((p) => p.status === "SUBMITTED");
      const verifiedCollectionPaise = verified.reduce(
        (acc, p) => acc + Number(p.amount_paise ?? 0),
        0
      );

      const sellers = (sellersRes.data ?? []).map((s) => {
        const row = s as Record<string, unknown>;
        return {
          id: String(row.id ?? ""),
          sellerCode: String(row.seller_code ?? ""),
          displayName: String(row.display_name ?? ""),
          isActive: row.is_active === true,
          isQrActive: row.is_qr_active === true,
          upiId: row.upi_id ? String(row.upi_id) : null,
        };
      });

      const users = (profilesRes.data ?? []).map((p) => {
        const row = p as Record<string, unknown>;
        const prList = Array.isArray(row.profile_roles)
          ? row.profile_roles
          : [];
        const roles: string[] = [];
        for (const pr of prList) {
          const rObj = (pr as Record<string, unknown>).roles;
          const r = Array.isArray(rObj) ? rObj[0] : rObj;
          const name = (r as Record<string, unknown> | null)?.name;
          if (name) roles.push(String(name));
        }
        return {
          id: String(row.id ?? ""),
          fullName: String(row.full_name ?? "Member"),
          email: row.email ? String(row.email) : null,
          isActive: row.is_active === true,
          roles,
        };
      });

      let firstPrizeDualAuth: MobileFirstPrizeGovernanceStatus = {
        drawId: null,
        drawStatus: "DRAFT",
        firstPrizeId: null,
        firstPrizeTitle: "1st Prize — ₹10,000 Cash",
        lockedSnapshotId: null,
        snapshotHash: null,
        eligibleTicketCount: 0,
        approval: null,
      };

      if (campaign?.id) {
        const [{ data: drawSession }, { data: firstPrize }, { count: issuedCount }] =
          await Promise.all([
            db
              .from("draws")
              .select("id, status")
              .eq("campaign_id", campaign.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            db
              .from("prizes")
              .select("id, title")
              .eq("campaign_id", campaign.id)
              .eq("prize_number", 1)
              .maybeSingle(),
            db
              .from("tickets")
              .select("id", { count: "exact", head: true })
              .eq("campaign_id", campaign.id)
              .eq("status", "ISSUED"),
          ]);

        let lockedSnap: {
          id: string;
          snapshot_hash: string;
          total_eligible_count: number;
        } | null = null;
        let approvalRow: Record<string, unknown> | null = null;

        if (drawSession?.id && firstPrize?.id) {
          const { data: snapData } = await db
            .from("draw_eligibility_snapshots")
            .select("id, snapshot_hash, total_eligible_count")
            .eq("draw_id", drawSession.id)
            .eq("prize_id", firstPrize.id)
            .eq("is_locked", true)
            .maybeSingle();
          if (snapData) {
            lockedSnap = {
              id: String(snapData.id),
              snapshot_hash: String(snapData.snapshot_hash),
              total_eligible_count: Number(
                snapData.total_eligible_count ?? issuedCount ?? 0
              ),
            };
            const { data: appData } = await db
              .from("draw_approvals")
              .select(
                "id, status, initiator_id, approver_id, requested_at, reviewed_at, review_notes, initiator:initiator_id(email), approver:approver_id(email)"
              )
              .eq("draw_id", drawSession.id)
              .eq("prize_id", firstPrize.id)
              .eq("snapshot_hash", lockedSnap.snapshot_hash)
              .order("requested_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            approvalRow = (appData as Record<string, unknown> | null) ?? null;
          }
        }

        const initiatorObj = Array.isArray(approvalRow?.initiator)
          ? approvalRow?.initiator[0]
          : approvalRow?.initiator;
        const approverObj = Array.isArray(approvalRow?.approver)
          ? approvalRow?.approver[0]
          : approvalRow?.approver;

        firstPrizeDualAuth = {
          drawId: drawSession?.id ? String(drawSession.id) : null,
          drawStatus: String(drawSession?.status ?? "DRAFT"),
          firstPrizeId: firstPrize?.id ? String(firstPrize.id) : null,
          firstPrizeTitle: String(
            firstPrize?.title ?? "1st Prize — ₹10,000 Cash"
          ),
          lockedSnapshotId: lockedSnap?.id ?? null,
          snapshotHash: lockedSnap?.snapshot_hash ?? null,
          eligibleTicketCount:
            lockedSnap?.total_eligible_count ?? (issuedCount ?? 0),
          approval: approvalRow
            ? {
                id: String(approvalRow.id ?? ""),
                status: String(approvalRow.status ?? "PENDING"),
                initiatorId: String(approvalRow.initiator_id ?? ""),
                initiatorEmail: (
                  initiatorObj as Record<string, unknown> | null
                )?.email
                  ? String((initiatorObj as Record<string, unknown>).email)
                  : null,
                approverId: approvalRow.approver_id
                  ? String(approvalRow.approver_id)
                  : null,
                approverEmail: (
                  approverObj as Record<string, unknown> | null
                )?.email
                  ? String((approverObj as Record<string, unknown>).email)
                  : null,
                requestedAt: String(approvalRow.requested_at ?? ""),
                reviewedAt: approvalRow.reviewed_at
                  ? String(approvalRow.reviewed_at)
                  : null,
                reviewNotes: approvalRow.review_notes
                  ? String(approvalRow.review_notes)
                  : null,
              }
            : null,
        };
      }

      const totalLimit = Number(campaign?.total_ticket_limit ?? 1000);
      const soldCount = Number(campaign?.sold_ticket_count ?? 0);

      return {
        governance: {
          campaignName: String(
            campaign?.name ?? "SSFI Fundraising Lucky Draw"
          ),
          campaignStatus: String(campaign?.status ?? "DRAFT"),
          verifiedCollectionPaise,
          verifiedPaymentsCount: verified.length,
          pendingPaymentsCount: pending.length,
          soldTicketCount: soldCount,
          totalTicketLimit: totalLimit,
          remainingTicketCount: Math.max(0, totalLimit - soldCount),
          activeSellersCount: sellers.filter((s) => s.isActive).length,
          totalSellersCount: sellers.length,
          totalUsersCount: users.length,
        },
        users,
        sellers,
        firstPrizeDualAuth,
        recentAuditLogs: (auditRes.data ?? []).map((row) =>
          mapRawAuditLog(row as Record<string, unknown>)
        ),
      };
    },

    async requestFirstPrizeApprovalRpc({
      drawId,
      prizeId,
      snapshotId,
      actorUserId,
    }) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const { data: approvalId, error } = await db.rpc(
        "admin_request_first_prize_approval",
        {
          p_draw_id: drawId,
          p_prize_id: prizeId,
          p_snapshot_id: snapshotId,
          p_actor: actorUserId,
        }
      );
      if (error || !approvalId) {
        throw new Error(
          error?.message || "Failed to initiate 1st Prize dual approval."
        );
      }
      return String(approvalId);
    },

    async recordFirstPrizeApprovalRpc({
      approvalId,
      decision,
      notes,
      actorUserId,
    }) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const { data: approval } = await db
        .from("draw_approvals")
        .select("initiator_id, status")
        .eq("id", approvalId)
        .maybeSingle();

      if (!approval) {
        throw new Error("APPROVAL_NOT_FOUND");
      }
      if (String(approval.initiator_id) === actorUserId) {
        throw new Error("SELF_APPROVAL_FORBIDDEN");
      }

      const { error } = await db.rpc("admin_record_first_prize_approval", {
        p_approval_id: approvalId,
        p_decision: decision,
        p_notes: notes,
        p_actor: actorUserId,
      });
      if (error) {
        if ((error.message ?? "").toLowerCase().includes("self")) {
          throw new Error("SELF_APPROVAL_FORBIDDEN");
        }
        throw new Error(error.message || "Failed to record dual approval decision.");
      }
    },

    async setSellerLifecycleStatus({ sellerId, action, actorUserId }) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const { data: seller } = await db
        .from("sellers")
        .select("id, profile_id, seller_code, display_name, is_active")
        .eq("id", sellerId)
        .maybeSingle();
      if (!seller) throw new Error("SELLER_NOT_FOUND");

      const targetActive = action === "REACTIVATE";
      if (Boolean(seller.is_active) === targetActive) {
        throw new Error(
          targetActive ? "SELLER_ALREADY_ACTIVE" : "SELLER_ALREADY_INACTIVE"
        );
      }

      const nowIso = new Date().toISOString();
      const { error: updateErr } = await db
        .from("sellers")
        .update({ is_active: targetActive, updated_at: nowIso })
        .eq("id", sellerId);
      if (updateErr) throw new Error("SELLER_STATUS_UPDATE_FAILED");

      await db
        .from("profiles")
        .update({ is_active: targetActive, updated_at: nowIso })
        .eq("id", seller.profile_id);

      await db.from("audit_logs").insert({
        actor_user_id: actorUserId,
        action: targetActive ? "SELLER_REACTIVATED" : "SELLER_DEACTIVATED",
        entity_type: "seller",
        entity_id: sellerId,
        metadata: {
          actor_role: "SUPER_ADMIN",
          seller_code: seller.seller_code,
          display_name: seller.display_name,
        },
      });

      return {
        sellerCode: String(seller.seller_code),
        isActive: targetActive,
        message: `Seller ${seller.seller_code} ${
          targetActive ? "reactivated" : "deactivated"
        } successfully.`,
      };
    },

    async getSuperAdminPaymentScreenshotUrl({
      paymentId,
      actorUserId,
      actorRoles,
    }) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();

      const res = await executeDownloadPaymentScreenshot(paymentId, {
        actorUserId,
        resolveActorRoles: async () => actorRoles,
        lookupPaymentAndScreenshot: async (targetPaymentId) => {
          const [{ data: payment }, { data: screenshot }, { data: bucketInfo }] =
            await Promise.all([
              db
                .from("payments")
                .select("id, order_id, orders(id, order_number)")
                .eq("id", targetPaymentId)
                .maybeSingle(),
              db
                .from("payment_screenshots")
                .select(
                  "id, payment_id, storage_path, content_type, file_size_bytes, uploaded_at"
                )
                .eq("payment_id", targetPaymentId)
                .maybeSingle(),
              db.storage.getBucket(PAYMENT_SCREENSHOT_BUCKET),
            ]);
          const orderObj = Array.isArray(payment?.orders)
            ? payment?.orders[0]
            : payment?.orders;
          return {
            payment: payment
              ? {
                  id: String(payment.id),
                  order_id: String(payment.order_id),
                  order_number: (orderObj as Record<string, unknown> | null)
                    ?.order_number
                    ? String(
                        (orderObj as Record<string, unknown>).order_number
                      )
                    : null,
                }
              : null,
            screenshot: screenshot
              ? {
                  id: String(screenshot.id),
                  payment_id: String(screenshot.payment_id),
                  storage_path: String(screenshot.storage_path),
                  content_type: String(screenshot.content_type),
                  file_size_bytes: Number(screenshot.file_size_bytes ?? 0),
                  uploaded_at: String(screenshot.uploaded_at),
                }
              : null,
            bucketIsPublic: bucketInfo?.public === true,
          };
        },
        verifyAndCreateSignedDownloadUrl: async ({
          bucket,
          storagePath,
          fileName,
          expiresInSeconds,
        }) => {
          const { data, error } = await db.storage
            .from(bucket)
            .createSignedUrl(storagePath, expiresInSeconds, {
              download: fileName,
            });
          if (error || !data?.signedUrl) {
            return {
              signedUrl: null,
              fileExists: false,
              error: error?.message,
            };
          }
          return { signedUrl: data.signedUrl, fileExists: true };
        },
        writeAuditLog: async (entry) => {
          await db.from("audit_logs").insert(entry);
        },
      });

      if (!res.success || !res.url) {
        throw new Error(res.code || "SCREENSHOT_UNAVAILABLE");
      }

      return {
        url: res.url,
        fileName: res.fileName ?? `SSFI-Payment-${paymentId}-Screenshot.jpg`,
        expiresInSeconds:
          res.expiresInSeconds ?? PAYMENT_SCREENSHOT_DOWNLOAD_TTL_SECONDS,
      };
    },

    async getCustomerDashboardByProfileId(profileId) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const { data: customer, error: custErr } = await db
        .from("customers")
        .select("id, full_name, phone, whatsapp_number, email")
        .eq("profile_id", profileId)
        .maybeSingle();

      if (custErr) throw new Error("CUSTOMER_LOOKUP_FAILED");
      if (!customer) return null;

      const [campaignRes, ordersRes, winnersRes] = await Promise.all([
        db
          .from("campaigns")
          .select("id, name, status")
          .eq("public_id", "ssfi-fundraising-lucky-draw")
          .maybeSingle(),
        db
          .from("orders")
          .select(
            "id, order_number, quantity, total_amount_paise, status, created_at, sellers:sellers!orders_seller_id_fkey(seller_code, display_name), payments(status, utr_reference, rejection_reason), tickets(ticket_number, status, issued_at)"
          )
          .eq("customer_id", customer.id)
          .order("created_at", { ascending: false })
          .limit(50),
        db
          .from("draw_results")
          .select("prizes:prize_id(prize_number, title), tickets:ticket_id(ticket_number)")
          .order("created_at", { ascending: true })
          .limit(20),
      ]);

      const orders = (ordersRes.data ?? []).map((o) => {
        const row = o as Record<string, unknown>;
        const sell = Array.isArray(row.sellers) ? row.sellers[0] : row.sellers;
        const pay = Array.isArray(row.payments)
          ? row.payments[0]
          : row.payments;
        const rawTickets = Array.isArray(row.tickets) ? row.tickets : [];
        const tickets: MobileOrderTicketItem[] = rawTickets.map((t) => {
          const item = t as Record<string, unknown>;
          return {
            ticketNumber: String(item.ticket_number ?? ""),
            status: String(item.status ?? "ISSUED"),
            issuedAt: item.issued_at ? String(item.issued_at) : null,
          };
        });
        return {
          id: String(row.id ?? ""),
          orderNumber: String(row.order_number ?? ""),
          quantity: Number(row.quantity ?? 0),
          totalAmountPaise: Number(row.total_amount_paise ?? 0),
          status: String(row.status ?? "PENDING_PAYMENT"),
          createdAt: String(row.created_at ?? ""),
          sellerCode: (sell as Record<string, unknown> | null)?.seller_code
            ? String((sell as Record<string, unknown>).seller_code)
            : null,
          sellerDisplayName: (sell as Record<string, unknown> | null)
            ?.display_name
            ? String((sell as Record<string, unknown>).display_name)
            : null,
          paymentStatus: (pay as Record<string, unknown> | null)?.status
            ? String((pay as Record<string, unknown>).status)
            : "PENDING",
          utrReference: (pay as Record<string, unknown> | null)?.utr_reference
            ? String((pay as Record<string, unknown>).utr_reference)
            : null,
          rejectionReason: (pay as Record<string, unknown> | null)
            ?.rejection_reason
            ? String((pay as Record<string, unknown>).rejection_reason)
            : null,
          tickets,
        };
      });

      const allTickets: Array<{
        ticketNumber: string;
        status: string;
        orderNumber: string;
        issuedAt: string | null;
      }> = [];
      for (const ord of orders) {
        for (const t of ord.tickets) {
          allTickets.push({
            ticketNumber: t.ticketNumber,
            status: t.status,
            orderNumber: ord.orderNumber,
            issuedAt: t.issuedAt ?? null,
          });
        }
      }

      const certifiedWinners = (winnersRes.data ?? [])
        .map((w) => {
          const row = w as Record<string, unknown>;
          const prize = Array.isArray(row.prizes) ? row.prizes[0] : row.prizes;
          const ticket = Array.isArray(row.tickets)
            ? row.tickets[0]
            : row.tickets;
          return {
            prizeNumber: Number(
              (prize as Record<string, unknown> | null)?.prize_number ?? 0
            ),
            prizeTitle: String(
              (prize as Record<string, unknown> | null)?.title ?? "Prize"
            ),
            ticketNumber: String(
              (ticket as Record<string, unknown> | null)?.ticket_number ?? ""
            ),
          };
        })
        .filter((w) => w.ticketNumber.length > 0);

      return {
        customer: {
          fullName: String(customer.full_name ?? "Customer"),
          phone: String(customer.phone ?? ""),
          whatsappNumber: String(
            customer.whatsapp_number ?? customer.phone ?? ""
          ),
          email: customer.email ? String(customer.email) : null,
        },
        campaign: {
          name: String(
            campaignRes.data?.name ?? "SSFI Fundraising Lucky Draw"
          ),
          status: String(campaignRes.data?.status ?? "DRAFT"),
        },
        orders,
        tickets: allTickets,
        certifiedWinners,
      };
    },

    async verifyTicketByNumber(rawTicketNumber) {
      const { createSupabaseAdminClient } = await import("../supabase/admin.ts");
      const db = createSupabaseAdminClient();
      const rawInput = rawTicketNumber.trim().toUpperCase();
      const isProductionEnv = process.env.VERCEL_ENV === "production";
      const hasPreviewPrefix = rawInput.startsWith("PRV-");
      const lookupNumber =
        !isProductionEnv && hasPreviewPrefix
          ? rawInput.replace(/^PRV-/, "")
          : rawInput;

      if (isProductionEnv && hasPreviewPrefix) {
        return {
          queriedTicketNumber: rawInput,
          ticketNumber: rawInput,
          found: false,
          isValid: false,
          isVoid: false,
          status: "NOT_FOUND",
          campaignName: null,
          issuedAt: null,
          voidReason: null,
        };
      }

      const { data: ticket, error } = await db
        .from("tickets")
        .select(
          "ticket_number, status, issued_at, void_reason, campaigns(name)"
        )
        .eq("ticket_number", lookupNumber)
        .maybeSingle();

      if (error) throw new Error("TICKET_VERIFY_QUERY_FAILED");
      if (!ticket) {
        return {
          queriedTicketNumber: rawInput,
          ticketNumber: lookupNumber,
          found: false,
          isValid: false,
          isVoid: false,
          status: "NOT_FOUND",
          campaignName: null,
          issuedAt: null,
          voidReason: null,
        };
      }

      const camp = Array.isArray(ticket.campaigns)
        ? ticket.campaigns[0]
        : ticket.campaigns;
      const status = String(ticket.status ?? "");
      const isValid = status === "ISSUED" || status === "ACTIVE";
      const isVoid = status === "VOID";

      return {
        queriedTicketNumber: rawInput,
        ticketNumber: String(ticket.ticket_number ?? lookupNumber),
        found: true,
        isValid,
        isVoid,
        status,
        campaignName: (camp as Record<string, unknown> | null)?.name
          ? String((camp as Record<string, unknown>).name)
          : "SSFI Fundraising Lucky Draw",
        issuedAt: ticket.issued_at ? String(ticket.issued_at) : null,
        voidReason: ticket.void_reason ? String(ticket.void_reason) : null,
      };
    },
  };
}

async function authorizeMobileOperation(
  headers: Headers,
  allowedRoles: readonly MobileRbacRole[],
  scope: string,
  deps?: MobileOperationsDependencies,
  maxAttempts: number = 90
): Promise<
  | { ok: true; user: MobileAuthenticatedUser }
  | { ok: false; response: Response }
> {
  const clientIp = getClientIpFromHeaders(headers);
  const ipLimit = await checkScopedRateLimit({
    scope: `${scope}_ip`,
    identifier: clientIp,
    maxAttempts,
    windowSeconds: 300,
    failClosedIfUnavailable: true,
  });

  if (!ipLimit.allowed) {
    if (ipLimit.reason === "SERVICE_UNAVAILABLE") {
      return {
        ok: false,
        response: mobileError(
          503,
          "SERVICE_UNAVAILABLE",
          "Service is temporarily unavailable. Please try again shortly.",
          { "Retry-After": String(ipLimit.retryAfterSeconds ?? 60) }
        ),
      };
    }
    return {
      ok: false,
      response: mobileError(
        429,
        "RATE_LIMITED",
        "Too many requests. Please try again shortly.",
        { "Retry-After": String(ipLimit.retryAfterSeconds ?? 300) }
      ),
    };
  }

  const auth = await authenticateMobileRequest(headers, deps?.authDeps);
  if (!auth.ok) {
    return {
      ok: false,
      response: mobileError(auth.status, auth.code, auth.message),
    };
  }

  if (!requireMobileRoles(auth.user, allowedRoles)) {
    return {
      ok: false,
      response: mobileError(
        403,
        "FORBIDDEN",
        "You do not have permission to perform this operation."
      ),
    };
  }

  const userLimit = await checkScopedRateLimit({
    scope: `${scope}_user`,
    identifier: auth.user.id,
    maxAttempts,
    windowSeconds: 300,
    failClosedIfUnavailable: true,
  });

  if (!userLimit.allowed) {
    if (userLimit.reason === "SERVICE_UNAVAILABLE") {
      return {
        ok: false,
        response: mobileError(
          503,
          "SERVICE_UNAVAILABLE",
          "Rate limiting service is temporarily unavailable.",
          { "Retry-After": String(userLimit.retryAfterSeconds ?? 60) }
        ),
      };
    }
    return {
      ok: false,
      response: mobileError(
        429,
        "RATE_LIMITED",
        "Request rate limit exceeded. Please try again shortly.",
        { "Retry-After": String(userLimit.retryAfterSeconds ?? 300) }
      ),
    };
  }

  return { ok: true, user: auth.user };
}

async function resolveAuthenticatedSeller(
  user: MobileAuthenticatedUser,
  deps: MobileOperationsDependencies
): Promise<
  | { ok: true; seller: SellerProfileRecord }
  | { ok: false; response: Response }
> {
  const seller = await deps.getSellerByProfileId(user.id);
  if (!seller) {
    return {
      ok: false,
      response: mobileError(
        403,
        "FORBIDDEN",
        "Your seller profile was not found. Please contact SSFI administration."
      ),
    };
  }
  if (!seller.is_active) {
    return {
      ok: false,
      response: mobileError(
        403,
        "FORBIDDEN",
        "Your seller account is currently deactivated."
      ),
    };
  }
  return { ok: true, seller };
}

// ============================================================================
// Seller Mobile API v1 Handlers
// ============================================================================

export async function handleMobileSellerDashboardGet(
  request: { headers: Headers },
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    SELLER_MOBILE_ROLES,
    "mobile_seller_dashboard",
    resolvedDeps
  );
  if (!auth.ok) return auth.response;

  try {
    const sellerRes = await resolveAuthenticatedSeller(auth.user, resolvedDeps);
    if (!sellerRes.ok) return sellerRes.response;
    const { seller } = sellerRes;

    const [campaign, orders, unreadMessagesCount] = await Promise.all([
      resolvedDeps.getCampaign(),
      resolvedDeps.listSellerOrders(seller.id),
      resolvedDeps.getSellerUnreadMessagesCount(seller.id),
    ]);

    const schedule = evaluateCampaignSchedule(
      campaign?.status ?? "DRAFT",
      campaign?.start_at,
      campaign?.end_at
    );

    const issuedOrders = orders.filter((o) => o.status === "TICKETS_ISSUED");
    const pendingOrders = orders.filter((o) => o.status === "PAYMENT_SUBMITTED");
    const awaitingOrders = orders.filter((o) => o.status === "PENDING_PAYMENT");
    const ticketsIssuedCount = issuedOrders.reduce(
      (sum, o) => sum + o.quantity,
      0
    );
    const verifiedCollectionPaise = issuedOrders.reduce(
      (sum, o) => sum + o.totalAmountPaise,
      0
    );

    const totalLimit = campaign?.total_ticket_limit ?? 1000;
    const soldCount = campaign?.sold_ticket_count ?? 0;

    return mobileOk({
      seller: {
        id: seller.id,
        sellerCode: seller.seller_code,
        displayName: seller.display_name,
        isActive: seller.is_active,
        isQrActive: Boolean(
          seller.is_qr_active && seller.qr_storage_path && seller.upi_id
        ),
        upiId: seller.upi_id,
        accountName: seller.account_name,
      },
      campaign: {
        name: campaign?.name ?? "SSFI Fundraising Lucky Draw",
        status: schedule.scheduleStatus,
        isSellingOpen: schedule.isSellingOpen,
        scheduleDescription: schedule.description,
        ticketPricePaise: campaign?.ticket_price_paise ?? 10000,
        totalTicketLimit: totalLimit,
        soldTicketCount: soldCount,
        remainingTicketCount: Math.max(0, totalLimit - soldCount),
        startAt: campaign?.start_at ?? null,
        endAt: campaign?.end_at ?? null,
      },
      metrics: {
        ticketsIssuedCount,
        verifiedCollectionPaise,
        pendingPaymentsCount: pendingOrders.length,
        awaitingPaymentOrdersCount: awaitingOrders.length,
        issuedOrdersCount: issuedOrders.length,
        totalOrdersCount: orders.length,
        unreadMessagesCount,
      },
      recentOrders: orders.slice(0, 10),
    });
  } catch {
    return mobileError(
      500,
      "INTERNAL_ERROR",
      "Unable to load seller dashboard at this time."
    );
  }
}

export async function handleMobileSellerCustomerLookupGet(
  request: { headers: Headers; url: string },
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    SELLER_MOBILE_ROLES,
    "mobile_seller_customers",
    resolvedDeps
  );
  if (!auth.ok) return auth.response;

  try {
    const sellerRes = await resolveAuthenticatedSeller(auth.user, resolvedDeps);
    if (!sellerRes.ok) return sellerRes.response;

    const urlObj = new URL(request.url, "http://localhost");
    const q = (urlObj.searchParams.get("q") ?? "").trim();
    if (q.length > 0 && q.length < 2) {
      return mobileError(
        400,
        "BAD_REQUEST",
        "Customer search query must be at least 2 characters."
      );
    }

    const customers = await resolvedDeps.lookupSellerCustomers(
      sellerRes.seller.id,
      q
    );
    return mobileOk({ customers });
  } catch {
    return mobileError(
      500,
      "INTERNAL_ERROR",
      "Unable to search customers at this time."
    );
  }
}

export async function handleMobileSellerOrdersGet(
  request: { headers: Headers; url: string },
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    SELLER_MOBILE_ROLES,
    "mobile_seller_orders_list",
    resolvedDeps
  );
  if (!auth.ok) return auth.response;

  try {
    const sellerRes = await resolveAuthenticatedSeller(auth.user, resolvedDeps);
    if (!sellerRes.ok) return sellerRes.response;

    const urlObj = new URL(request.url, "http://localhost");
    const status = (urlObj.searchParams.get("status") ?? "ALL").toUpperCase();
    const query = (urlObj.searchParams.get("q") ?? "").trim();

    const orders = await resolvedDeps.listSellerOrders(sellerRes.seller.id, {
      status,
      query,
    });
    return mobileOk({ orders });
  } catch {
    return mobileError(
      500,
      "INTERNAL_ERROR",
      "Unable to load seller orders at this time."
    );
  }
}

export async function handleMobileSellerOrdersPost(
  request: { headers: Headers; json: () => Promise<unknown> },
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    SELLER_MOBILE_ROLES,
    "mobile_seller_order_create",
    resolvedDeps,
    30
  );
  if (!auth.ok) return auth.response;

  if (isFeatureEnabled("ENABLE_MAINTENANCE_MODE")) {
    return mobileError(
      503,
      "SERVICE_UNAVAILABLE",
      "The ticket system is currently undergoing scheduled maintenance. Please check back shortly."
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return mobileError(400, "BAD_REQUEST", "Invalid JSON request body.");
  }

  const parsed = createSellerOrderSchema.safeParse(body);
  if (!parsed.success) {
    const firstMsg =
      parsed.error.issues?.[0]?.message ??
      "Please enter valid customer information and ticket quantity.";
    return mobileError(400, "BAD_REQUEST", firstMsg);
  }

  try {
    const sellerRes = await resolveAuthenticatedSeller(auth.user, resolvedDeps);
    if (!sellerRes.ok) return sellerRes.response;
    const { seller } = sellerRes;

    if (!seller.is_qr_active || !seller.qr_storage_path || !seller.upi_id) {
      return mobileError(
        400,
        "BAD_REQUEST",
        "Your seller account cannot create new orders because your personal payment QR is unavailable or inactive. Please configure and activate your payment QR first."
      );
    }

    await resolvedDeps.runScheduledTransitions();
    const campaign = await resolvedDeps.getCampaign();
    if (!campaign) {
      return mobileError(
        404,
        "NOT_FOUND",
        "Fundraising campaign configuration was not found."
      );
    }

    if (campaign.status !== "ACTIVE") {
      return mobileError(
        400,
        "BAD_REQUEST",
        `Ticket sales are currently not active (campaign status: ${campaign.status}).`
      );
    }

    const now = new Date();
    if (campaign.start_at && now < new Date(campaign.start_at)) {
      return mobileError(
        400,
        "BAD_REQUEST",
        `Ticket sales have not opened yet. Sales are scheduled to open on ${formatIstDateTime(
          campaign.start_at
        )}.`
      );
    }
    if (campaign.end_at && now >= new Date(campaign.end_at)) {
      return mobileError(
        400,
        "BAD_REQUEST",
        `Ticket sales for this lucky draw have ended (closed on ${formatIstDateTime(
          campaign.end_at
        )}).`
      );
    }

    const remaining = Math.max(
      0,
      campaign.total_ticket_limit - campaign.sold_ticket_count
    );
    if (parsed.data.quantity > remaining) {
      return mobileError(
        400,
        "BAD_REQUEST",
        `Sorry, the requested quantity (${parsed.data.quantity}) exceeds remaining campaign capacity (${remaining} tickets available).`
      );
    }

    const orderId = await resolvedDeps.createSellerOrderRpc({
      seller,
      actorUserId: auth.user.id,
      name: parsed.data.name,
      whatsapp: parsed.data.whatsapp,
      email: parsed.data.email,
      quantity: parsed.data.quantity,
    });

    const createdOrder = await resolvedDeps.getSellerOrderById(
      seller.id,
      orderId
    );
    return mobileOk({ orderId, order: createdOrder }, 201);
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : "Unable to create this sale. Please try again.";
    return mobileError(400, "BAD_REQUEST", msg);
  }
}

export async function handleMobileSellerOrderDetailGet(
  request: { headers: Headers },
  orderId: string,
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    SELLER_MOBILE_ROLES,
    "mobile_seller_order_detail",
    resolvedDeps
  );
  if (!auth.ok) return auth.response;

  if (!UUID_RE.test(orderId)) {
    return mobileError(400, "BAD_REQUEST", "Invalid order ID format.");
  }

  try {
    const sellerRes = await resolveAuthenticatedSeller(auth.user, resolvedDeps);
    if (!sellerRes.ok) return sellerRes.response;

    const order = await resolvedDeps.getSellerOrderById(
      sellerRes.seller.id,
      orderId
    );
    if (!order) {
      return mobileError(
        404,
        "NOT_FOUND",
        "Order not found or does not belong to your seller account."
      );
    }

    return mobileOk({ order });
  } catch {
    return mobileError(
      500,
      "INTERNAL_ERROR",
      "Unable to load order details at this time."
    );
  }
}

export async function handleMobileSellerOrderPaymentSubmitPost(
  request: { headers: Headers; json: () => Promise<unknown> },
  orderId: string,
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    SELLER_MOBILE_ROLES,
    "mobile_seller_payment_submit",
    resolvedDeps,
    30
  );
  if (!auth.ok) return auth.response;

  if (!UUID_RE.test(orderId)) {
    return mobileError(400, "BAD_REQUEST", "Invalid order ID format.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return mobileError(400, "BAD_REQUEST", "Invalid JSON request body.");
  }

  const parsed = submitSellerUpiSchema.safeParse(body ?? {});
  if (!parsed.success) {
    const firstMsg =
      parsed.error.issues?.[0]?.message ?? "Invalid payment reference details.";
    return mobileError(400, "BAD_REQUEST", firstMsg);
  }

  const cleanUtr = parsed.data.utr ? parsed.data.utr.trim() : null;
  if (cleanUtr && cleanUtr.length < 6) {
    return mobileError(
      400,
      "BAD_REQUEST",
      "UTR / Reference must be at least 6 characters when provided."
    );
  }
  const cleanPayerName = parsed.data.payerName
    ? parsed.data.payerName.trim()
    : null;

  try {
    const sellerRes = await resolveAuthenticatedSeller(auth.user, resolvedDeps);
    if (!sellerRes.ok) return sellerRes.response;

    await resolvedDeps.submitSellerManualUpiRpc({
      sellerId: sellerRes.seller.id,
      actorUserId: auth.user.id,
      orderId,
      utr: cleanUtr,
      payerName: cleanPayerName,
    });

    const updatedOrder = await resolvedDeps.getSellerOrderById(
      sellerRes.seller.id,
      orderId
    );
    return mobileOk({ order: updatedOrder });
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "OWNERSHIP_DENIED") {
      return mobileError(
        403,
        "FORBIDDEN",
        "This order does not belong to your seller account."
      );
    }
    if (code === "ALREADY_SUBMITTED") {
      return mobileError(
        400,
        "BAD_REQUEST",
        "A payment reference has already been submitted for this order and is currently under review."
      );
    }
    if (code === "ORDER_NOT_ELIGIBLE") {
      return mobileError(
        400,
        "BAD_REQUEST",
        "This order is not eligible for payment submission."
      );
    }
    if (code === "SCREENSHOT_REQUIRED") {
      return mobileError(
        400,
        "BAD_REQUEST",
        "A payment confirmation screenshot is mandatory before submitting UTR reference."
      );
    }
    if (code === "DUPLICATE_UTR_OR_SUBMISSION") {
      return mobileError(
        400,
        "BAD_REQUEST",
        "This UTR reference or payment has already been submitted."
      );
    }
    return mobileError(
      400,
      "BAD_REQUEST",
      "This payment cannot be submitted in its current state."
    );
  }
}

export async function handleMobileSellerOrderScreenshotPost(
  request: { headers: Headers; formData: () => Promise<FormData> },
  orderId: string,
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    SELLER_MOBILE_ROLES,
    "mobile_seller_screenshot_upload",
    resolvedDeps,
    30
  );
  if (!auth.ok) return auth.response;

  if (!UUID_RE.test(orderId)) {
    return mobileError(400, "BAD_REQUEST", "Invalid order ID format.");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return mobileError(
      400,
      "BAD_REQUEST",
      "Expected multipart/form-data payload containing a screenshot file."
    );
  }

  const rawFile = formData.get("screenshot");
  if (!rawFile || typeof rawFile === "string" || typeof rawFile.arrayBuffer !== "function") {
    return mobileError(
      400,
      "BAD_REQUEST",
      "A valid payment screenshot image file is required."
    );
  }

  const fileObj = rawFile as File;
  if (fileObj.size < 1 || fileObj.size > MAX_PAYMENT_SCREENSHOT_BYTES) {
    return mobileError(
      400,
      "BAD_REQUEST",
      "The screenshot must be between 1 byte and 2 MB."
    );
  }

  let bytes: Uint8Array;
  let validated: { contentType: PaymentScreenshotType; extension: string };
  try {
    bytes = new Uint8Array(await fileObj.arrayBuffer());
    validated = validatePaymentScreenshot(fileObj, bytes);
    validateMobileScreenshotFilename(fileObj.name, validated.contentType);
  } catch (err) {
    return mobileError(
      400,
      "BAD_REQUEST",
      err instanceof Error
        ? err.message
        : "Upload a valid JPEG, PNG, or WebP payment screenshot (max 2 MB)."
    );
  }

  try {
    const sellerRes = await resolveAuthenticatedSeller(auth.user, resolvedDeps);
    if (!sellerRes.ok) return sellerRes.response;

    const uploadFn =
      resolvedDeps.uploadSellerOrderScreenshot ??
      createDefaultMobileOperationsDeps().uploadSellerOrderScreenshot!;

    const uploadResult = await uploadFn({
      sellerId: sellerRes.seller.id,
      actorUserId: auth.user.id,
      orderId,
      bytes,
      contentType: validated.contentType,
      extension: validated.extension,
      fileSizeBytes: bytes.byteLength,
    });

    const updatedOrder = await resolvedDeps.getSellerOrderById(
      sellerRes.seller.id,
      orderId
    );

    // Never return raw storage_path, signed URLs, or public URLs
    return mobileOk(
      {
        replaced: uploadResult.replaced,
        contentType: uploadResult.contentType,
        fileSizeBytes: uploadResult.fileSizeBytes,
        uploadedAt: uploadResult.uploadedAt,
        order: updatedOrder,
      },
      uploadResult.replaced ? 200 : 201
    );
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "OWNERSHIP_DENIED") {
      return mobileError(
        403,
        "FORBIDDEN",
        "This order does not belong to your seller account."
      );
    }
    if (code === "ORDER_NOT_EDITABLE" || code === "PAYMENT_NOT_EDITABLE") {
      return mobileError(
        400,
        "BAD_REQUEST",
        "This payment has already been finalized and its screenshot proof cannot be modified."
      );
    }
    if (code === "PUBLIC_BUCKET_VIOLATION") {
      return mobileError(
        503,
        "SERVICE_UNAVAILABLE",
        "Payment screenshot storage security verification failed."
      );
    }
    return mobileError(
      500,
      "INTERNAL_ERROR",
      "Unable to save payment screenshot at this time. Please retry."
    );
  }
}

// ============================================================================
// Admin Mobile API v1 Handlers
// ============================================================================

export async function handleMobileAdminSummaryGet(
  request: { headers: Headers },
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    STAFF_MOBILE_ROLES,
    "mobile_admin_summary",
    resolvedDeps
  );
  if (!auth.ok) return auth.response;

  try {
    const summary = await resolvedDeps.getAdminCollectionSummary();
    return mobileOk({ summary });
  } catch {
    return mobileError(
      500,
      "INTERNAL_ERROR",
      "Unable to load collection summary at this time."
    );
  }
}

export async function handleMobileAdminPaymentsGet(
  request: { headers: Headers; url: string },
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    STAFF_MOBILE_ROLES,
    "mobile_admin_payments_list",
    resolvedDeps
  );
  if (!auth.ok) return auth.response;

  try {
    const urlObj = new URL(request.url, "http://localhost");
    const status = (
      urlObj.searchParams.get("status") ?? "SUBMITTED"
    ).toUpperCase();
    const query = (urlObj.searchParams.get("q") ?? "").trim();
    const sellerId = (urlObj.searchParams.get("sellerId") ?? "").trim();

    const payments = await resolvedDeps.listAdminPayments({
      status,
      query,
      sellerId: sellerId || undefined,
    });
    return mobileOk({ payments });
  } catch {
    return mobileError(
      500,
      "INTERNAL_ERROR",
      "Unable to load payments queue at this time."
    );
  }
}

export async function handleMobileAdminPaymentDetailGet(
  request: { headers: Headers },
  paymentId: string,
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    STAFF_MOBILE_ROLES,
    "mobile_admin_payment_detail",
    resolvedDeps
  );
  if (!auth.ok) return auth.response;

  if (!UUID_RE.test(paymentId)) {
    return mobileError(400, "BAD_REQUEST", "Invalid payment ID format.");
  }

  try {
    const payment = await resolvedDeps.getAdminPaymentById(paymentId);
    if (!payment) {
      return mobileError(404, "NOT_FOUND", "Payment record was not found.");
    }
    return mobileOk({ payment });
  } catch {
    return mobileError(
      500,
      "INTERNAL_ERROR",
      "Unable to load payment details at this time."
    );
  }
}

export async function handleMobileAdminPaymentDecisionPost(
  request: { headers: Headers; json: () => Promise<unknown> },
  paymentId: string,
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    STAFF_MOBILE_ROLES,
    "mobile_admin_payment_decision",
    resolvedDeps,
    30
  );
  if (!auth.ok) return auth.response;

  if (!UUID_RE.test(paymentId)) {
    return mobileError(400, "BAD_REQUEST", "Invalid payment ID format.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return mobileError(400, "BAD_REQUEST", "Invalid JSON request body.");
  }

  const parsed = adminPaymentDecisionSchema.safeParse(body);
  if (!parsed.success) {
    const firstMsg =
      parsed.error.issues?.[0]?.message ??
      "Invalid payment decision payload.";
    return mobileError(400, "BAD_REQUEST", firstMsg);
  }

  try {
    const existing = await resolvedDeps.getAdminPaymentById(paymentId);
    if (!existing) {
      return mobileError(404, "NOT_FOUND", "Payment record was not found.");
    }
    if (existing.status !== "SUBMITTED") {
      return mobileError(
        400,
        "BAD_REQUEST",
        `Payment is already ${existing.status} and cannot be processed again.`
      );
    }

    if (parsed.data.action === "VERIFY") {
      const issuedTickets = await resolvedDeps.verifyPaymentAndIssueRpc({
        paymentId,
        actorUserId: auth.user.id,
      });
      const updated = await resolvedDeps.getAdminPaymentById(paymentId);
      return mobileOk({
        decision: "VERIFIED",
        issuedTickets,
        payment: updated,
      });
    } else {
      await resolvedDeps.rejectPaymentRpc({
        paymentId,
        actorUserId: auth.user.id,
        reason: parsed.data.reason,
      });
      const updated = await resolvedDeps.getAdminPaymentById(paymentId);
      return mobileOk({
        decision: "REJECTED",
        issuedTickets: [],
        payment: updated,
      });
    }
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "PAYMENT_NOT_AWAITING_VERIFICATION") {
      return mobileError(
        400,
        "BAD_REQUEST",
        "This payment is not awaiting verification or was already processed."
      );
    }
    if (code === "CAMPAIGN_NOT_ACTIVE") {
      return mobileError(
        400,
        "BAD_REQUEST",
        "Tickets cannot be issued because the fundraising campaign is not currently ACTIVE."
      );
    }
    if (code === "CAMPAIGN_TICKET_LIMIT_EXCEEDED") {
      return mobileError(
        400,
        "BAD_REQUEST",
        "Cannot issue tickets: this order exceeds the 1,000-ticket campaign cap."
      );
    }
    return mobileError(
      400,
      "BAD_REQUEST",
      "Payment decision could not be completed. It may already have been processed."
    );
  }
}

export async function handleMobileAdminLookupGet(
  request: { headers: Headers; url: string },
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    STAFF_MOBILE_ROLES,
    "mobile_admin_lookup",
    resolvedDeps
  );
  if (!auth.ok) return auth.response;

  try {
    const urlObj = new URL(request.url, "http://localhost");
    const q = (urlObj.searchParams.get("q") ?? "").trim();
    const rawType = (urlObj.searchParams.get("type") ?? "ALL").toUpperCase();
    const type =
      rawType === "SELLERS" || rawType === "CUSTOMERS" || rawType === "ORDERS"
        ? rawType
        : "ALL";

    if (q.length < 2) {
      return mobileError(
        400,
        "BAD_REQUEST",
        "Search query must be at least 2 characters."
      );
    }

    const results = await resolvedDeps.adminLookup({ query: q, type });
    return mobileOk(results);
  } catch {
    return mobileError(
      500,
      "INTERNAL_ERROR",
      "Unable to perform directory lookup at this time."
    );
  }
}

export async function handleMobileAdminAuditLogsGet(
  request: { headers: Headers },
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    STAFF_MOBILE_ROLES,
    "mobile_admin_audit_logs",
    resolvedDeps
  );
  if (!auth.ok) return auth.response;

  try {
    const listFn =
      resolvedDeps.listAuditLogs ??
      createDefaultMobileOperationsDeps().listAuditLogs!;
    const logs = await listFn(30);
    return mobileOk({ auditLogs: logs });
  } catch {
    return mobileError(
      500,
      "INTERNAL_ERROR",
      "Unable to load audit logs at this time."
    );
  }
}

// ============================================================================
// Super Admin Mobile API v1 Handlers
// ============================================================================

export async function handleMobileSuperAdminOverviewGet(
  request: { headers: Headers },
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    SUPER_ADMIN_MOBILE_ROLES,
    "mobile_super_admin_overview",
    resolvedDeps
  );
  if (!auth.ok) return auth.response;

  try {
    const getOverview =
      resolvedDeps.getSuperAdminOverview ??
      createDefaultMobileOperationsDeps().getSuperAdminOverview!;
    const overview = await getOverview();
    return mobileOk(overview);
  } catch {
    return mobileError(
      500,
      "INTERNAL_ERROR",
      "Unable to load Super Admin governance overview at this time."
    );
  }
}

export async function handleMobileFirstPrizeDualAuthPost(
  request: { headers: Headers; json: () => Promise<unknown> },
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    ADMIN_AND_SUPER_MOBILE_ROLES,
    "mobile_first_prize_dual_auth",
    resolvedDeps,
    30
  );
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return mobileError(400, "BAD_REQUEST", "Invalid JSON request body.");
  }

  const parsed = firstPrizeDualAuthSchema.safeParse(body);
  if (!parsed.success) {
    const firstMsg =
      parsed.error.issues?.[0]?.message ??
      "Invalid First Prize dual-authorization payload.";
    return mobileError(400, "BAD_REQUEST", firstMsg);
  }

  if (parsed.data.action === "REQUEST") {
    // Policy A: Strictly SUPER_ADMIN only may initiate 1st Prize dual approval
    if (!auth.user.roles.includes("SUPER_ADMIN")) {
      return mobileError(
        403,
        "FORBIDDEN",
        "Four-eyes Policy Violation: Only a SUPER_ADMIN can initiate 1st Prize dual approval."
      );
    }

    try {
      const reqFn =
        resolvedDeps.requestFirstPrizeApprovalRpc ??
        createDefaultMobileOperationsDeps().requestFirstPrizeApprovalRpc!;
      const approvalId = await reqFn({
        drawId: parsed.data.drawId,
        prizeId: parsed.data.prizeId,
        snapshotId: parsed.data.snapshotId,
        actorUserId: auth.user.id,
      });
      return mobileOk({ approvalId, status: "PENDING" }, 201);
    } catch (err) {
      return mobileError(
        400,
        "BAD_REQUEST",
        err instanceof Error
          ? err.message
          : "Unable to initiate 1st Prize dual approval."
      );
    }
  } else {
    try {
      const decFn =
        resolvedDeps.recordFirstPrizeApprovalRpc ??
        createDefaultMobileOperationsDeps().recordFirstPrizeApprovalRpc!;
      await decFn({
        approvalId: parsed.data.approvalId,
        decision: parsed.data.decision,
        notes: parsed.data.notes,
        actorUserId: auth.user.id,
      });
      return mobileOk({
        approvalId: parsed.data.approvalId,
        status: parsed.data.decision,
      });
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (code === "SELF_APPROVAL_FORBIDDEN") {
        return mobileError(
          403,
          "FORBIDDEN",
          "Policy A Violation: Self-approval is strictly forbidden. A different administrator must review this request."
        );
      }
      if (code === "APPROVAL_NOT_FOUND") {
        return mobileError(
          404,
          "NOT_FOUND",
          "First Prize approval request was not found."
        );
      }
      return mobileError(
        400,
        "BAD_REQUEST",
        err instanceof Error
          ? err.message
          : "Unable to record 1st Prize approval decision."
      );
    }
  }
}

export async function handleMobileSuperAdminSellerStatusPost(
  request: { headers: Headers; json: () => Promise<unknown> },
  sellerId: string,
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    SUPER_ADMIN_MOBILE_ROLES,
    "mobile_super_admin_seller_lifecycle",
    resolvedDeps,
    30
  );
  if (!auth.ok) return auth.response;

  if (!UUID_RE.test(sellerId)) {
    return mobileError(400, "BAD_REQUEST", "Invalid seller ID format.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return mobileError(400, "BAD_REQUEST", "Invalid JSON request body.");
  }

  const parsed = sellerLifecycleActionSchema.safeParse(body);
  if (!parsed.success) {
    return mobileError(
      400,
      "BAD_REQUEST",
      "Invalid seller lifecycle action (must be DEACTIVATE or REACTIVATE)."
    );
  }

  try {
    const statusFn =
      resolvedDeps.setSellerLifecycleStatus ??
      createDefaultMobileOperationsDeps().setSellerLifecycleStatus!;
    const result = await statusFn({
      sellerId,
      action: parsed.data.action,
      actorUserId: auth.user.id,
    });
    return mobileOk(result);
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "SELLER_NOT_FOUND") {
      return mobileError(404, "NOT_FOUND", "Seller record was not found.");
    }
    if (
      code === "SELLER_ALREADY_ACTIVE" ||
      code === "SELLER_ALREADY_INACTIVE"
    ) {
      return mobileError(
        400,
        "BAD_REQUEST",
        "Seller account is already in the requested activation state."
      );
    }
    return mobileError(
      400,
      "BAD_REQUEST",
      "Unable to update seller lifecycle state."
    );
  }
}

export async function handleMobileSuperAdminPaymentScreenshotGet(
  request: { headers: Headers },
  paymentId: string,
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const auth = await authorizeMobileOperation(
    request.headers,
    SUPER_ADMIN_MOBILE_ROLES,
    "mobile_super_admin_screenshot_download",
    resolvedDeps,
    30
  );
  if (!auth.ok) return auth.response;

  if (!UUID_RE.test(paymentId)) {
    return mobileError(400, "BAD_REQUEST", "Invalid payment ID format.");
  }

  try {
    const dlFn =
      resolvedDeps.getSuperAdminPaymentScreenshotUrl ??
      createDefaultMobileOperationsDeps().getSuperAdminPaymentScreenshotUrl!;
    const result = await dlFn({
      paymentId,
      actorUserId: auth.user.id,
      actorRoles: auth.user.roles,
    });
    return mobileOk(result);
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "FORBIDDEN_ROLE") {
      return mobileError(
        403,
        "FORBIDDEN",
        "Only SUPER_ADMIN is authorized to download payment screenshots."
      );
    }
    if (code === "PAYMENT_NOT_FOUND" || code === "SCREENSHOT_NOT_FOUND") {
      return mobileError(
        404,
        "NOT_FOUND",
        "Payment screenshot was not found for this payment."
      );
    }
    return mobileError(
      400,
      "BAD_REQUEST",
      "Unable to generate signed payment screenshot link."
    );
  }
}

// ============================================================================
// Customer & Ticket Verification Mobile API v1 Handlers
// ============================================================================

export async function handleMobileCustomerDashboardGet(
  request: { headers: Headers },
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const clientIp = getClientIpFromHeaders(request.headers);
  const ipLimit = await checkScopedRateLimit({
    scope: "mobile_customer_dashboard_ip",
    identifier: clientIp,
    maxAttempts: 90,
    windowSeconds: 300,
    failClosedIfUnavailable: true,
  });

  if (!ipLimit.allowed) {
    if (ipLimit.reason === "SERVICE_UNAVAILABLE") {
      return mobileError(
        503,
        "SERVICE_UNAVAILABLE",
        "Service is temporarily unavailable.",
        { "Retry-After": String(ipLimit.retryAfterSeconds ?? 60) }
      );
    }
    return mobileError(
      429,
      "RATE_LIMITED",
      "Too many requests. Please try again shortly.",
      { "Retry-After": String(ipLimit.retryAfterSeconds ?? 300) }
    );
  }

  const auth = await authenticateMobileRequest(
    request.headers,
    resolvedDeps.authDeps
  );
  if (!auth.ok) {
    return mobileError(auth.status, auth.code, auth.message);
  }

  // Strictly enforce linked customer profile (customers.profile_id = auth.user.id)
  if (!auth.user.customerProfileLinked) {
    return mobileError(
      403,
      "FORBIDDEN",
      "Your account is not linked to a customer supporter profile."
    );
  }

  const userLimit = await checkScopedRateLimit({
    scope: "mobile_customer_dashboard_user",
    identifier: auth.user.id,
    maxAttempts: 90,
    windowSeconds: 300,
    failClosedIfUnavailable: true,
  });
  if (!userLimit.allowed) {
    if (userLimit.reason === "SERVICE_UNAVAILABLE") {
      return mobileError(
        503,
        "SERVICE_UNAVAILABLE",
        "Rate limiting service is temporarily unavailable.",
        { "Retry-After": String(userLimit.retryAfterSeconds ?? 60) }
      );
    }
    return mobileError(
      429,
      "RATE_LIMITED",
      "Request rate limit exceeded. Please try again shortly.",
      { "Retry-After": String(userLimit.retryAfterSeconds ?? 300) }
    );
  }

  try {
    const getCustDash =
      resolvedDeps.getCustomerDashboardByProfileId ??
      createDefaultMobileOperationsDeps().getCustomerDashboardByProfileId!;
    const dashboard = await getCustDash(auth.user.id);
    if (!dashboard) {
      return mobileError(
        403,
        "FORBIDDEN",
        "Your account is not linked to a customer supporter profile."
      );
    }
    return mobileOk(dashboard);
  } catch {
    return mobileError(
      500,
      "INTERNAL_ERROR",
      "Unable to load customer supporter dashboard at this time."
    );
  }
}

export async function handleMobileTicketVerifyGet(
  request: { headers: Headers },
  ticketNumber: string,
  deps?: MobileOperationsDependencies
) {
  const resolvedDeps = deps ?? createDefaultMobileOperationsDeps();
  const clientIp = getClientIpFromHeaders(request.headers);
  const ipLimit = await checkScopedRateLimit({
    scope: "mobile_ticket_verify_ip",
    identifier: clientIp,
    maxAttempts: 90,
    windowSeconds: 300,
    failClosedIfUnavailable: true,
  });

  if (!ipLimit.allowed) {
    if (ipLimit.reason === "SERVICE_UNAVAILABLE") {
      return mobileError(
        503,
        "SERVICE_UNAVAILABLE",
        "Verification service is temporarily unavailable.",
        { "Retry-After": String(ipLimit.retryAfterSeconds ?? 60) }
      );
    }
    return mobileError(
      429,
      "RATE_LIMITED",
      "Too many verification requests. Please try again shortly.",
      { "Retry-After": String(ipLimit.retryAfterSeconds ?? 300) }
    );
  }

  const auth = await authenticateMobileRequest(
    request.headers,
    resolvedDeps.authDeps
  );
  if (!auth.ok) {
    return mobileError(auth.status, auth.code, auth.message);
  }

  const userLimit = await checkScopedRateLimit({
    scope: "mobile_ticket_verify_user",
    identifier: auth.user.id,
    maxAttempts: 90,
    windowSeconds: 300,
    failClosedIfUnavailable: true,
  });
  if (!userLimit.allowed) {
    if (userLimit.reason === "SERVICE_UNAVAILABLE") {
      return mobileError(
        503,
        "SERVICE_UNAVAILABLE",
        "Verification rate limiting is temporarily unavailable.",
        { "Retry-After": String(userLimit.retryAfterSeconds ?? 60) }
      );
    }
    return mobileError(
      429,
      "RATE_LIMITED",
      "Too many verification requests. Please try again shortly.",
      { "Retry-After": String(userLimit.retryAfterSeconds ?? 300) }
    );
  }

  const cleanInput = decodeURIComponent(ticketNumber || "").trim().toUpperCase();
  if (!TICKET_NUMBER_RE.test(cleanInput)) {
    return mobileError(
      400,
      "BAD_REQUEST",
      "Enter a valid ticket number in SSFI-XXXXXX format (e.g. SSFI-000101)."
    );
  }

  try {
    const verifyFn =
      resolvedDeps.verifyTicketByNumber ??
      createDefaultMobileOperationsDeps().verifyTicketByNumber!;
    const verification = await verifyFn(cleanInput);
    return mobileOk({ verification });
  } catch {
    return mobileError(
      500,
      "INTERNAL_ERROR",
      "Unable to verify ticket number at this time."
    );
  }
}
