import type { ExportColumn, ExportDataset } from "./types.ts";
import { formatDateTime, generateExportFilename } from "./formatters.ts";

// -------------------------------------------------------------
// 1. DASHBOARD SUMMARY DATASET
// -------------------------------------------------------------
export interface DashboardMetricRow {
  metric: string;
  value: string | number;
  notes: string;
}

export function buildDashboardDataset(data: DashboardMetricRow[]): ExportDataset<DashboardMetricRow> {
  const columns: ExportColumn<DashboardMetricRow>[] = [
    {
      header: "Performance Metric",
      key: "metric",
      width: 32,
      format: "text",
      getValue: (r) => r.metric,
    },
    {
      header: "Current Value",
      key: "value",
      width: 20,
      format: "text",
      align: "right",
      getValue: (r) => r.value,
    },
    {
      header: "Operational Context / Target",
      key: "notes",
      width: 36,
      format: "text",
      getValue: (r) => r.notes,
    },
  ];

  return {
    title: "SSFI Lucky Draw — Operations KPI Summary",
    resource: "dashboard",
    filename: generateExportFilename("dashboard", "ext"),
    columns,
    data,
  };
}

// -------------------------------------------------------------
// 2. PAYMENTS DATASET
// -------------------------------------------------------------
export interface PaymentExportRow {
  id: string;
  status: string;
  amount_paise: number;
  utr_reference: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  orders: {
    order_number: string;
    customers: { full_name: string; whatsapp_number: string; phone?: string; email?: string } | null;
    sellers: { display_name: string; seller_code: string } | null;
  } | null;
}

export function buildPaymentsDataset(
  data: PaymentExportRow[],
  filterStatus?: string
): ExportDataset<PaymentExportRow> {
  const columns: ExportColumn<PaymentExportRow>[] = [
    {
      header: "Order Ref",
      key: "order_number",
      width: 16,
      format: "text",
      getValue: (r) => r.orders?.order_number || "—",
    },
    {
      header: "Status",
      key: "status",
      width: 14,
      format: "status",
      align: "center",
      getValue: (r) => r.status,
    },
    {
      header: "Amount",
      key: "amount_paise",
      width: 14,
      format: "currency",
      align: "right",
      getValue: (r) => r.amount_paise,
    },
    {
      header: "Bank UTR Reference",
      key: "utr_reference",
      width: 22,
      format: "text",
      getValue: (r) => r.utr_reference || "—",
    },
    {
      header: "Customer Name",
      key: "customer_name",
      width: 22,
      format: "text",
      getValue: (r) => r.orders?.customers?.full_name || "—",
    },
    {
      header: "Customer WhatsApp",
      key: "customer_whatsapp",
      width: 18,
      format: "text",
      getValue: (r) => r.orders?.customers?.whatsapp_number || r.orders?.customers?.phone || "—",
    },
    {
      header: "Seller Attribution",
      key: "seller_name",
      width: 20,
      format: "text",
      getValue: (r) => r.orders?.sellers?.display_name || "Direct / Website",
    },
    {
      header: "Seller Code",
      key: "seller_code",
      width: 14,
      format: "text",
      getValue: (r) => r.orders?.sellers?.seller_code || "—",
    },
    {
      header: "Submitted At",
      key: "submitted_at",
      width: 22,
      format: "datetime",
      getValue: (r) => formatDateTime(r.submitted_at),
    },
    {
      header: "Verified At",
      key: "verified_at",
      width: 22,
      format: "datetime",
      getValue: (r) => formatDateTime(r.verified_at),
    },
  ];

  const totalPaise = data.reduce((sum, r) => sum + (r.amount_paise || 0), 0);

  return {
    title: filterStatus === "SUBMITTED" ? "Pending Payments Verification" : "Payments Directory",
    resource: "payments",
    filename: generateExportFilename("payments", "ext"),
    columns,
    data,
    summary: {
      totalRecords: data.length,
      totalAmountPaise: totalPaise,
      totalAmountRupees: totalPaise / 100,
    },
    metadata: {
      filters: filterStatus ? { status: filterStatus } : {},
    },
  };
}

// -------------------------------------------------------------
// 3. ORDERS DATASET
// -------------------------------------------------------------
export interface OrderExportRow {
  id: string;
  order_number: string;
  quantity: number;
  unit_price_paise: number;
  total_amount_paise: number;
  status: string;
  created_at: string;
  customers: { full_name: string; phone: string; whatsapp_number: string | null; email: string | null } | null;
  sellers: { display_name: string; seller_code: string } | null;
}

export function buildOrdersDataset(data: OrderExportRow[]): ExportDataset<OrderExportRow> {
  const columns: ExportColumn<OrderExportRow>[] = [
    {
      header: "Order Number",
      key: "order_number",
      width: 16,
      format: "text",
      getValue: (r) => r.order_number,
    },
    {
      header: "Status",
      key: "status",
      width: 14,
      format: "status",
      align: "center",
      getValue: (r) => r.status,
    },
    {
      header: "Tickets",
      key: "quantity",
      width: 10,
      format: "number",
      align: "right",
      getValue: (r) => r.quantity,
    },
    {
      header: "Total Amount",
      key: "total_amount_paise",
      width: 15,
      format: "currency",
      align: "right",
      getValue: (r) => r.total_amount_paise,
    },
    {
      header: "Customer Name",
      key: "customer_name",
      width: 22,
      format: "text",
      getValue: (r) => r.customers?.full_name || "—",
    },
    {
      header: "Phone / WhatsApp",
      key: "customer_phone",
      width: 18,
      format: "text",
      getValue: (r) => r.customers?.whatsapp_number || r.customers?.phone || "—",
    },
    {
      header: "Email",
      key: "customer_email",
      width: 24,
      format: "text",
      getValue: (r) => r.customers?.email || "—",
    },
    {
      header: "Seller Attribution",
      key: "seller_name",
      width: 20,
      format: "text",
      getValue: (r) => r.sellers?.display_name || "Direct / Website",
    },
    {
      header: "Seller Code",
      key: "seller_code",
      width: 14,
      format: "text",
      getValue: (r) => r.sellers?.seller_code || "—",
    },
    {
      header: "Order Date",
      key: "created_at",
      width: 22,
      format: "datetime",
      getValue: (r) => formatDateTime(r.created_at),
    },
  ];

  const totalTickets = data.reduce((sum, r) => sum + (r.quantity || 0), 0);
  const totalPaise = data.reduce((sum, r) => sum + (r.total_amount_paise || 0), 0);

  return {
    title: "SSFI Lucky Draw — Orders Directory",
    resource: "orders",
    filename: generateExportFilename("orders", "ext"),
    columns,
    data,
    summary: {
      totalOrders: data.length,
      totalTicketsSold: totalTickets,
      totalCollectionPaise: totalPaise,
      totalCollectionRupees: totalPaise / 100,
    },
  };
}

// -------------------------------------------------------------
// 4. TICKETS DATASET
// -------------------------------------------------------------
export interface TicketExportRow {
  id: string;
  ticket_number: string;
  status: string;
  issued_at: string;
  orders: { order_number: string } | null;
  customers: { full_name: string; phone: string; whatsapp_number?: string | null } | null;
  sellers: { display_name: string; seller_code: string } | null;
}

export function buildTicketsDataset(data: TicketExportRow[]): ExportDataset<TicketExportRow> {
  const columns: ExportColumn<TicketExportRow>[] = [
    {
      header: "Ticket Number",
      key: "ticket_number",
      width: 16,
      format: "text",
      align: "center",
      getValue: (r) => r.ticket_number,
    },
    {
      header: "Status",
      key: "status",
      width: 12,
      format: "status",
      align: "center",
      getValue: (r) => r.status,
    },
    {
      header: "Order Ref",
      key: "order_number",
      width: 16,
      format: "text",
      getValue: (r) => r.orders?.order_number || "—",
    },
    {
      header: "Participant Name",
      key: "customer_name",
      width: 22,
      format: "text",
      getValue: (r) => r.customers?.full_name || "—",
    },
    {
      header: "Phone Number",
      key: "customer_phone",
      width: 18,
      format: "text",
      getValue: (r) => r.customers?.phone || r.customers?.whatsapp_number || "—",
    },
    {
      header: "Seller Attribution",
      key: "seller_name",
      width: 20,
      format: "text",
      getValue: (r) => r.sellers?.display_name || "Direct / Website",
    },
    {
      header: "Seller Code",
      key: "seller_code",
      width: 14,
      format: "text",
      getValue: (r) => r.sellers?.seller_code || "—",
    },
    {
      header: "Issued Date",
      key: "issued_at",
      width: 22,
      format: "datetime",
      getValue: (r) => formatDateTime(r.issued_at),
    },
  ];

  return {
    title: "SSFI Lucky Draw — Issued Tickets Registry",
    resource: "tickets",
    filename: generateExportFilename("tickets", "ext"),
    columns,
    data,
    summary: {
      totalTicketsIssued: data.length,
    },
  };
}

// -------------------------------------------------------------
// 5. CUSTOMERS DATASET
// -------------------------------------------------------------
export interface CustomerExportRow {
  id: string;
  full_name: string;
  phone: string;
  whatsapp_number: string | null;
  email: string | null;
  created_at: string;
}

export function buildCustomersDataset(data: CustomerExportRow[]): ExportDataset<CustomerExportRow> {
  const columns: ExportColumn<CustomerExportRow>[] = [
    {
      header: "Customer ID",
      key: "id",
      width: 20,
      format: "text",
      getValue: (r) => r.id,
    },
    {
      header: "Full Name",
      key: "full_name",
      width: 24,
      format: "text",
      getValue: (r) => r.full_name,
    },
    {
      header: "Mobile Phone",
      key: "phone",
      width: 18,
      format: "text",
      getValue: (r) => r.phone,
    },
    {
      header: "WhatsApp Number",
      key: "whatsapp_number",
      width: 18,
      format: "text",
      getValue: (r) => r.whatsapp_number || "—",
    },
    {
      header: "Email Address",
      key: "email",
      width: 26,
      format: "text",
      getValue: (r) => r.email || "—",
    },
    {
      header: "Registered At",
      key: "created_at",
      width: 22,
      format: "datetime",
      getValue: (r) => formatDateTime(r.created_at),
    },
  ];

  return {
    title: "SSFI Lucky Draw — Customer Directory",
    resource: "customers",
    filename: generateExportFilename("customers", "ext"),
    columns,
    data,
    summary: {
      totalCustomers: data.length,
    },
  };
}

// -------------------------------------------------------------
// 6. SELLERS DATASET
// -------------------------------------------------------------
export interface SellerExportRow {
  id: string;
  seller_code: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
}

export function buildSellersDataset(data: SellerExportRow[]): ExportDataset<SellerExportRow> {
  const columns: ExportColumn<SellerExportRow>[] = [
    {
      header: "Seller Code",
      key: "seller_code",
      width: 16,
      format: "text",
      align: "center",
      getValue: (r) => r.seller_code,
    },
    {
      header: "Fundraiser / Seller Name",
      key: "display_name",
      width: 26,
      format: "text",
      getValue: (r) => r.display_name,
    },
    {
      header: "Status",
      key: "status",
      width: 14,
      format: "status",
      align: "center",
      getValue: (r) => (r.is_active ? "ACTIVE" : "INACTIVE"),
    },
    {
      header: "Registration Date",
      key: "created_at",
      width: 22,
      format: "datetime",
      getValue: (r) => formatDateTime(r.created_at),
    },
  ];

  const activeCount = data.filter((s) => s.is_active).length;

  return {
    title: "SSFI Lucky Draw — Sellers & Fundraisers Directory",
    resource: "sellers",
    filename: generateExportFilename("sellers", "ext"),
    columns,
    data,
    summary: {
      totalSellers: data.length,
      activeSellers: activeCount,
      inactiveSellers: data.length - activeCount,
    },
  };
}
