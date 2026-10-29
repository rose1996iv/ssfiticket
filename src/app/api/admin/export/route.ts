import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  ExportFormat,
  ExportResource,
  ExportDataset,
  buildDashboardDataset,
  buildPaymentsDataset,
  buildOrdersDataset,
  buildTicketsDataset,
  buildCustomersDataset,
  buildSellersDataset,
  generateCsv,
  generateExcel,
  generatePdf,
  generateJson,
  generateExportFilename,
  formatInr,
  PaymentExportRow,
  OrderExportRow,
  TicketExportRow,
  CustomerExportRow,
  SellerExportRow,
  DashboardMetricRow,
} from "@/lib/export";

const EXPORT_MAX_LIMITS = {
  payments: 5000,
  orders: 5000,
  tickets: 10000,
  customers: 5000,
  sellers: 5000,
} as const;

export async function GET(request: NextRequest) {
  // 1. Strict Server-Side Authentication & Role Verification
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = createSupabaseAdminClient();
  const { data: isStaff, error: staffRpcErr } = await db.rpc("is_staff", {
    p_user_id: user.id,
  });

  if (staffRpcErr || !isStaff) {
    return NextResponse.json(
      { error: "Forbidden: Administrative role required to export data." },
      { status: 403 }
    );
  }

  // 2. Parse Query Parameters
  const { searchParams } = new URL(request.url);
  const resource = searchParams.get("resource") as ExportResource;
  const format = (searchParams.get("format") || "xlsx").toLowerCase() as ExportFormat;
  const statusParam = searchParams.get("status") || undefined;

  const validResources: ExportResource[] = [
    "dashboard",
    "payments",
    "orders",
    "tickets",
    "customers",
    "sellers",
  ];
  const validFormats: ExportFormat[] = ["xlsx", "csv", "pdf", "json"];

  if (!validResources.includes(resource)) {
    return NextResponse.json(
      { error: `Invalid resource. Allowed: ${validResources.join(", ")}` },
      { status: 400 }
    );
  }

  if (!validFormats.includes(format)) {
    return NextResponse.json(
      { error: `Invalid format. Allowed: ${validFormats.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    type AnyDataset =
      | ExportDataset<DashboardMetricRow>
      | ExportDataset<PaymentExportRow>
      | ExportDataset<OrderExportRow>
      | ExportDataset<TicketExportRow>
      | ExportDataset<CustomerExportRow>
      | ExportDataset<SellerExportRow>;

    let dataset!: AnyDataset;

    // 3. Fetch and map dataset according to requested resource
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
        const primaryError =
          campaignResult.error || paymentsResult.error || ordersResult.error || sellersResult.error;
        throw primaryError;
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
        {
          metric: "Campaign Name",
          value: campaign?.name || "SSFI Fundraising Lucky Draw 2026",
          notes: "Official SSFI campaign title",
        },
        {
          metric: "Campaign Status",
          value: campaign?.status || "ACTIVE",
          notes: "Live fundraising status",
        },
        {
          metric: "Ticket Price",
          value: formatInr(campaign?.ticket_price_paise ?? 50000),
          notes: "Fixed unit price per ticket",
        },
        {
          metric: "Total Ticket Quota",
          value: totalLimit.toLocaleString("en-IN"),
          notes: "Maximum authorized ticket allocation",
        },
        {
          metric: "Verified Tickets Sold",
          value: soldCount.toLocaleString("en-IN"),
          notes: "Allocated to verified customer orders",
        },
        {
          metric: "Remaining Available Tickets",
          value: remainingCount.toLocaleString("en-IN"),
          notes: "Unsold tickets remaining in pool",
        },
        {
          metric: "Quota Fulfillment (%)",
          value: `${percentageSold}%`,
          notes: "Percent of campaign capacity issued",
        },
        {
          metric: "Total Verified Revenue",
          value: formatInr(verifiedPaise),
          notes: "Reconciled bank collections to date",
        },
        {
          metric: "Verified Payment Count",
          value: verifiedPayments.length.toLocaleString("en-IN"),
          notes: "Approved payments with tickets issued",
        },
        {
          metric: "Pending Payment Submissions",
          value: submittedPayments.length.toLocaleString("en-IN"),
          notes: "Awaiting staff UTR verification",
        },
        {
          metric: "Total Customer Orders",
          value: (ordersResult.count || 0).toLocaleString("en-IN"),
          notes: "Customer orders initiated online",
        },
        {
          metric: "Active Registered Sellers",
          value: (sellersResult.count || 0).toLocaleString("en-IN"),
          notes: "Fundraisers actively generating referrals",
        },
      ];

      dataset = buildDashboardDataset(rows);
    } else if (resource === "payments") {
      let query = db
        .from("payments")
        .select(
          "id, status, amount_paise, utr_reference, submitted_at, verified_at, orders(order_number, customers(full_name, whatsapp_number, phone, email), sellers(display_name, seller_code))"
        )
        .order("submitted_at", { ascending: false })
        .limit(5000);

      if (statusParam && statusParam !== "ALL") {
        query = query.eq("status", statusParam);
      }

      const { data, error } = await query;
      if (error) throw error;
      const rows = (data || []) as unknown as PaymentExportRow[];
      dataset = buildPaymentsDataset(rows, statusParam);
      if (rows.length >= EXPORT_MAX_LIMITS.payments) {
        dataset.metadata = {
          ...dataset.metadata,
          isTruncated: true,
          limit: EXPORT_MAX_LIMITS.payments,
          warning: `Export hit maximum safety limit of ${EXPORT_MAX_LIMITS.payments} records.`,
        };
      }
    } else if (resource === "orders") {
      let query = db
        .from("orders")
        .select(
          "id, order_number, quantity, unit_price_paise, total_amount_paise, status, created_at, customers(full_name, phone, whatsapp_number, email), sellers(display_name, seller_code)"
        )
        .order("created_at", { ascending: false })
        .limit(EXPORT_MAX_LIMITS.orders);

      if (statusParam && statusParam !== "ALL") {
        query = query.eq("status", statusParam);
      }

      const { data, error } = await query;
      if (error) throw error;
      const rows = (data || []) as unknown as OrderExportRow[];
      dataset = buildOrdersDataset(rows);
      if (rows.length >= EXPORT_MAX_LIMITS.orders) {
        dataset.metadata = {
          ...dataset.metadata,
          isTruncated: true,
          limit: EXPORT_MAX_LIMITS.orders,
          warning: `Export hit maximum safety limit of ${EXPORT_MAX_LIMITS.orders} records.`,
        };
      }
    } else if (resource === "tickets") {
      const { data, error } = await db
        .from("tickets")
        .select(
          "id, ticket_number, status, issued_at, orders(order_number), customers(full_name, phone, whatsapp_number), sellers(display_name, seller_code)"
        )
        .order("ticket_number", { ascending: true })
        .limit(EXPORT_MAX_LIMITS.tickets);

      if (error) throw error;
      const rows = (data || []) as unknown as TicketExportRow[];
      dataset = buildTicketsDataset(rows);
      if (rows.length >= EXPORT_MAX_LIMITS.tickets) {
        dataset.metadata = {
          ...dataset.metadata,
          isTruncated: true,
          limit: EXPORT_MAX_LIMITS.tickets,
          warning: `Export hit maximum safety limit of ${EXPORT_MAX_LIMITS.tickets} records.`,
        };
      }
    } else if (resource === "customers") {
      const { data, error } = await db
        .from("customers")
        .select("id, full_name, phone, whatsapp_number, email, created_at")
        .order("created_at", { ascending: false })
        .limit(EXPORT_MAX_LIMITS.customers);

      if (error) throw error;
      const rows = (data || []) as unknown as CustomerExportRow[];
      dataset = buildCustomersDataset(rows);
      if (rows.length >= EXPORT_MAX_LIMITS.customers) {
        dataset.metadata = {
          ...dataset.metadata,
          isTruncated: true,
          limit: EXPORT_MAX_LIMITS.customers,
          warning: `Export hit maximum safety limit of ${EXPORT_MAX_LIMITS.customers} records.`,
        };
      }
    } else if (resource === "sellers") {
      const { data, error } = await db
        .from("sellers")
        .select("id, seller_code, display_name, is_active, created_at")
        .order("created_at", { ascending: false })
        .limit(EXPORT_MAX_LIMITS.sellers);

      if (error) throw error;
      const rows = (data || []) as unknown as SellerExportRow[];
      dataset = buildSellersDataset(rows);
      if (rows.length >= EXPORT_MAX_LIMITS.sellers) {
        dataset.metadata = {
          ...dataset.metadata,
          isTruncated: true,
          limit: EXPORT_MAX_LIMITS.sellers,
          warning: `Export hit maximum safety limit of ${EXPORT_MAX_LIMITS.sellers} records.`,
        };
      }
    }

    // 4. Render Binary / Text Output in Requested Format
    const filename = generateExportFilename(resource, format);
    const exportDataset = dataset as unknown as ExportDataset<unknown>;
    let buffer: Uint8Array;
    let contentType: string;

    switch (format) {
      case "xlsx":
        buffer = await generateExcel(exportDataset);
        contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        break;
      case "csv":
        buffer = generateCsv(exportDataset);
        contentType = "text/csv; charset=utf-8";
        break;
      case "pdf":
        buffer = generatePdf(exportDataset);
        contentType = "application/pdf";
        break;
      case "json":
        buffer = generateJson(exportDataset);
        contentType = "application/json; charset=utf-8";
        break;
    }

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  } catch (err: unknown) {
    const errorObj = err as { message?: string; code?: string } | undefined;
    console.error("[Export Route Error]", {
      resource,
      format,
      message: errorObj?.message,
      code: errorObj?.code,
    });
    return NextResponse.json(
      {
        error: "Failed to generate export file. Please try again or contact system administration.",
        details: errorObj?.message,
      },
      { status: 500 }
    );
  }
}
