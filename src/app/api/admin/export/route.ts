import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isFeatureEnabled } from "@/lib/config/featureFlags";
import {
  EXPORT_MAX_LIMITS,
  handleAdminExportGet,
} from "@/lib/export/adminExportHandler";
import {
  type ExportResource,
  buildDashboardDataset,
  buildPaymentsDataset,
  buildOrdersDataset,
  buildTicketsDataset,
  buildCustomersDataset,
  buildSellersDataset,
  formatInr,
  type PaymentExportRow,
  type OrderExportRow,
  type TicketExportRow,
  type CustomerExportRow,
  type SellerExportRow,
  type DashboardMetricRow,
} from "@/lib/export";

async function loadAdminExportDataset(resource: ExportResource, statusParam?: string) {
  const db = createSupabaseAdminClient();

  if (resource === "dashboard") {
    const [campaignResult, paymentsResult, ordersResult, sellersResult] = await Promise.all([
      db
        .from("campaigns")
        .select("total_ticket_limit, sold_ticket_count, ticket_price_paise, status, name")
        .eq("public_id", "ssfi-fundraising-lucky-draw")
        .maybeSingle(),
      db.from("payments").select("status, amount_paise"),
      db.from("orders").select("id", { count: "exact", head: true }),
      db.from("sellers").select("id", { count: "exact", head: true }).eq("is_active", true),
    ]);

    if (campaignResult.error || paymentsResult.error || ordersResult.error || sellersResult.error) {
      throw (
        campaignResult.error ||
        paymentsResult.error ||
        ordersResult.error ||
        sellersResult.error
      );
    }

    const campaign = campaignResult.data;
    const payments = (paymentsResult.data || []) as { status: string; amount_paise: number }[];
    const verifiedPayments = payments.filter((p) => p.status === "VERIFIED");
    const submittedPayments = payments.filter((p) => p.status === "SUBMITTED");
    const verifiedPaise = verifiedPayments.reduce((acc, p) => acc + p.amount_paise, 0);

    const totalLimit = campaign?.total_ticket_limit ?? 1000;
    const soldCount = campaign?.sold_ticket_count ?? 0;
    const remainingCount = Math.max(0, totalLimit - soldCount);
    const percentageSold = Math.min(100, Math.round((soldCount / totalLimit) * 100));

    const rows: DashboardMetricRow[] = [
      { metric: "Campaign Name", value: campaign?.name || "SSFI Fundraising Lucky Draw 2026", notes: "Official SSFI campaign title" },
      { metric: "Campaign Status", value: campaign?.status || "ACTIVE", notes: "Live fundraising status" },
      { metric: "Ticket Price", value: formatInr(campaign?.ticket_price_paise ?? 50000), notes: "Fixed unit price per ticket" },
      { metric: "Total Ticket Quota", value: totalLimit.toLocaleString("en-IN"), notes: "Maximum authorized ticket allocation" },
      { metric: "Verified Tickets Sold", value: soldCount.toLocaleString("en-IN"), notes: "Allocated to verified customer orders" },
      { metric: "Remaining Available Tickets", value: remainingCount.toLocaleString("en-IN"), notes: "Unsold tickets remaining in pool" },
      { metric: "Quota Fulfillment (%)", value: `${percentageSold}%`, notes: "Percent of campaign capacity issued" },
      { metric: "Total Verified Revenue", value: formatInr(verifiedPaise), notes: "Reconciled bank collections to date" },
      { metric: "Verified Payment Count", value: verifiedPayments.length.toLocaleString("en-IN"), notes: "Approved payments with tickets issued" },
      { metric: "Pending Payment Submissions", value: submittedPayments.length.toLocaleString("en-IN"), notes: "Awaiting staff UTR verification" },
      { metric: "Total Customer Orders", value: (ordersResult.count || 0).toLocaleString("en-IN"), notes: "Customer orders initiated online" },
      { metric: "Active Registered Sellers", value: (sellersResult.count || 0).toLocaleString("en-IN"), notes: "Fundraisers actively generating referrals" },
    ];
    return buildDashboardDataset(rows);
  }

  if (resource === "payments") {
    let query = db
      .from("payments")
      .select(
        "id, status, amount_paise, utr_reference, submitted_at, verified_at, orders(order_number, customers(full_name, whatsapp_number, phone, email), sellers:sellers!orders_snapshot_seller_id_fkey(display_name, seller_code), operational_seller:sellers!orders_seller_id_fkey(display_name, seller_code))"
      )
      .order("submitted_at", { ascending: false })
      .limit(EXPORT_MAX_LIMITS.payments);

    if (statusParam && statusParam !== "ALL") {
      query = query.eq("status", statusParam);
    }

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data || []) as unknown as PaymentExportRow[];
    const ds = buildPaymentsDataset(rows, statusParam);
    if (rows.length >= EXPORT_MAX_LIMITS.payments) {
      ds.metadata = {
        ...ds.metadata,
        isTruncated: true,
        limit: EXPORT_MAX_LIMITS.payments,
        warning: `Export hit maximum safety limit of ${EXPORT_MAX_LIMITS.payments} records.`,
      };
    }
    return ds;
  }

  if (resource === "orders") {
    let query = db
      .from("orders")
      .select(
        "id, order_number, quantity, unit_price_paise, total_amount_paise, status, created_at, customers(full_name, phone, whatsapp_number, email), sellers!orders_seller_id_fkey(display_name, seller_code)"
      )
      .order("created_at", { ascending: false })
      .limit(EXPORT_MAX_LIMITS.orders);

    if (statusParam && statusParam !== "ALL") {
      query = query.eq("status", statusParam);
    }

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data || []) as unknown as OrderExportRow[];
    const ds = buildOrdersDataset(rows);
    if (rows.length >= EXPORT_MAX_LIMITS.orders) {
      ds.metadata = {
        ...ds.metadata,
        isTruncated: true,
        limit: EXPORT_MAX_LIMITS.orders,
        warning: `Export hit maximum safety limit of ${EXPORT_MAX_LIMITS.orders} records.`,
      };
    }
    return ds;
  }

  if (resource === "tickets") {
    const { data, error } = await db
      .from("tickets")
      .select(
        "id, ticket_number, status, issued_at, orders(order_number), customers(full_name, phone, whatsapp_number), sellers(display_name, seller_code)"
      )
      .order("ticket_number", { ascending: true })
      .limit(EXPORT_MAX_LIMITS.tickets);

    if (error) throw error;
    const rows = (data || []) as unknown as TicketExportRow[];
    const ds = buildTicketsDataset(rows);
    if (rows.length >= EXPORT_MAX_LIMITS.tickets) {
      ds.metadata = {
        ...ds.metadata,
        isTruncated: true,
        limit: EXPORT_MAX_LIMITS.tickets,
        warning: `Export hit maximum safety limit of ${EXPORT_MAX_LIMITS.tickets} records.`,
      };
    }
    return ds;
  }

  if (resource === "customers") {
    const { data, error } = await db
      .from("customers")
      .select("id, full_name, phone, whatsapp_number, email, created_at")
      .order("created_at", { ascending: false })
      .limit(EXPORT_MAX_LIMITS.customers);

    if (error) throw error;
    const rows = (data || []) as unknown as CustomerExportRow[];
    const ds = buildCustomersDataset(rows);
    if (rows.length >= EXPORT_MAX_LIMITS.customers) {
      ds.metadata = {
        ...ds.metadata,
        isTruncated: true,
        limit: EXPORT_MAX_LIMITS.customers,
        warning: `Export hit maximum safety limit of ${EXPORT_MAX_LIMITS.customers} records.`,
      };
    }
    return ds;
  }

  const { data, error } = await db
    .from("sellers")
    .select("id, seller_code, display_name, is_active, created_at")
    .order("created_at", { ascending: false })
    .limit(EXPORT_MAX_LIMITS.sellers);

  if (error) throw error;
  const rows = (data || []) as unknown as SellerExportRow[];
  const ds = buildSellersDataset(rows);
  if (rows.length >= EXPORT_MAX_LIMITS.sellers) {
    ds.metadata = {
      ...ds.metadata,
      isTruncated: true,
      limit: EXPORT_MAX_LIMITS.sellers,
      warning: `Export hit maximum safety limit of ${EXPORT_MAX_LIMITS.sellers} records.`,
    };
  }
  return ds;
}

export async function GET(request: NextRequest) {
  return handleAdminExportGet(request, {
    isExportFeatureEnabled: () => isFeatureEnabled("ENABLE_DETAILED_AUDIT_EXPORT"),
    loadDataset: loadAdminExportDataset,
  });
}
