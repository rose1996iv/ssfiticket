import Link from "next/link";
import { connection } from "next/server";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  CreditCard,
  IndianRupee,
  RefreshCw,
  Ticket,
} from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ExportDropdown } from "@/components/admin/ExportDropdown";
import { hasCurrentUserRole, requireAnyRole } from "@/lib/auth/server";
import { AdminPaymentScreenshotDownloadButton } from "@/components/admin/AdminPaymentScreenshot";
import { computeServerPaginationWindow } from "@/lib/pagination/serverPagination";
import {
  AdminFilterBar,
  AdminPaginationFooter,
} from "@/components/admin/AdminFilterAndPaginationBar";

type PaymentRow = {
  id: string;
  status: string;
  amount_paise: number;
  utr_reference: string | null;
  payer_name?: string | null;
  submitted_at: string | null;
  created_at?: string;
  seller_review_status?: string | null;
  payment_screenshots?:
    | { uploaded_at: string; file_size_bytes: number; content_type?: string }
    | { uploaded_at: string; file_size_bytes: number; content_type?: string }[]
    | null;
  orders: {
    id: string;
    order_number: string;
    quantity: number;
    total_amount_paise: number;
    seller_id?: string | null;
    snapshot_seller_id?: string | null;
    snapshot_upi_id?: string | null;
    snapshot_account_name?: string | null;
    snapshot_qr_storage_path?: string | null;
    snapshot_seller_display_name?: string | null;
    snapshot_seller_code?: string | null;
    customers: {
      id: string;
      full_name: string;
      phone: string;
      whatsapp_number: string;
    } | null;
    sellers: {
      id: string;
      display_name: string;
      seller_code: string;
    } | null;
    operational_seller?: {
      id: string;
      display_name: string;
      seller_code: string;
    } | null;
  } | null;
};

const SELLER_REVIEW_LABELS: Record<string, { label: string; color: string }> = {
  RECOMMENDED_APPROVAL: {
    label: "Rec: Approve",
    color: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
  RECOMMENDED_REJECTION: {
    label: "Rec: Reject",
    color: "bg-red-100 text-red-800 border-red-200",
  },
  FLAGGED_DISCREPANCY: {
    label: "Flagged",
    color: "bg-amber-100 text-amber-800 border-amber-200",
  },
};

type SearchParams = {
  page?: string;
  pageSize?: string;
  q?: string;
  status?: string;
  seller?: string;
  sellerReview?: string;
  from?: string;
  to?: string;
};

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await connection();
  const params = (await searchParams) ?? {};
  const currentUser = await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);
  const isSuperAdmin = await hasCurrentUserRole("SUPER_ADMIN");
  const db = createSupabaseAdminClient();

  const activeStatus = params.status ? params.status.toUpperCase() : "SUBMITTED";
  const searchQuery = (params.q ?? "").trim();
  const sellerFilter = (params.seller ?? "").trim();
  const sellerReviewFilter = (params.sellerReview ?? "").trim();
  const fromDate = (params.from ?? "").trim();
  const toDate = (params.to ?? "").trim();

  const [{ data: rawStorageMetrics }, { data: sellerList }] = await Promise.all([
    db.rpc("get_payment_screenshot_storage_metrics", { p_actor: currentUser.id }),
    db
      .from("sellers")
      .select("id, display_name, seller_code")
      .order("seller_code", { ascending: true }),
  ]);

  const storageMetrics = Array.isArray(rawStorageMetrics)
    ? rawStorageMetrics[0]
    : rawStorageMetrics;

  const initialWindow = computeServerPaginationWindow(
    { page: params.page, pageSize: params.pageSize },
    0
  );

  // If filtering by order search / seller, resolve matching order IDs server-side first
  let filteredOrderIds: string[] | null = null;
  if (searchQuery || sellerFilter) {
    let orderLookup = db.from("orders").select("id, order_number, customer_id, seller_id, snapshot_seller_id");
    if (sellerFilter) {
      orderLookup = orderLookup.or(
        `seller_id.eq.${sellerFilter},snapshot_seller_id.eq.${sellerFilter}`
      );
    }
    if (searchQuery) {
      const { data: matchingCustomers } = await db
        .from("customers")
        .select("id")
        .or(
          `full_name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%,whatsapp_number.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`
        )
        .limit(500);
      const custIds = (matchingCustomers ?? []).map((c) => c.id);
      if (custIds.length > 0) {
        orderLookup = orderLookup.or(
          `order_number.ilike.%${searchQuery}%,customer_id.in.(${custIds.join(",")})`
        );
      } else {
        orderLookup = orderLookup.ilike("order_number", `%${searchQuery}%`);
      }
    }
    const { data: matchedOrders } = await orderLookup.limit(2000);
    filteredOrderIds = (matchedOrders ?? []).map((o) => o.id);
  }

  let query = db
    .from("payments")
    .select(
      "id, status, amount_paise, utr_reference, payer_name, submitted_at, created_at, seller_review_status, payment_screenshots(uploaded_at, file_size_bytes, content_type), orders(id, order_number, quantity, total_amount_paise, seller_id, snapshot_seller_id, snapshot_upi_id, snapshot_account_name, snapshot_qr_storage_path, snapshot_seller_display_name, snapshot_seller_code, customers(id, full_name, phone, whatsapp_number), sellers:sellers!orders_snapshot_seller_id_fkey(id, display_name, seller_code), operational_seller:sellers!orders_seller_id_fkey(id, display_name, seller_code))",
      { count: "exact" }
    );

  if (activeStatus !== "ALL") {
    query = query.eq("status", activeStatus);
  }

  if (sellerReviewFilter) {
    if (sellerReviewFilter === "PENDING_SELLER_REVIEW") {
      query = query.is("seller_review_status", null);
    } else {
      query = query.eq("seller_review_status", sellerReviewFilter);
    }
  }

  if (fromDate) {
    query = query.gte("created_at", `${fromDate}T00:00:00.000Z`);
  }
  if (toDate) {
    query = query.lte("created_at", `${toDate}T23:59:59.999Z`);
  }

  if (searchQuery && (!filteredOrderIds || filteredOrderIds.length === 0)) {
    query = query.or(
      `utr_reference.ilike.%${searchQuery}%,payer_name.ilike.%${searchQuery}%`
    );
  } else if (filteredOrderIds) {
    if (filteredOrderIds.length === 0) {
      query = query.eq("order_id", "00000000-0000-0000-0000-000000000000");
    } else {
      query = query.in("order_id", filteredOrderIds);
    }
  }

  const { data, count, error } = await query
    .order("submitted_at", { ascending: activeStatus === "SUBMITTED", nullsFirst: false })
    .range(initialWindow.rangeFrom, initialWindow.rangeTo);

  if (error) {
    console.error("[Admin Payments Query Error]", {
      code: error.code,
      message: error.message,
      hint: error.hint,
    });

    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-950 shadow-xs">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-red-600" size={24} />
            <div className="space-y-3">
              <div>
                <h1 className="text-lg font-bold text-red-950">
                  Unable to Load Pending Payments
                </h1>
                <p className="mt-1 text-xs leading-relaxed text-red-800">
                  Failed to fetch pending payment submissions from the database.
                </p>
              </div>

              <div className="rounded-xl border border-red-200 bg-white/90 p-3.5 font-mono text-xs text-red-900">
                <p>
                  <span className="font-bold">Error Code:</span> {error.code || "UNKNOWN"}
                </p>
                <p>
                  <span className="font-bold">Message:</span> {error.message || "Query failed"}
                </p>
                {error.hint && (
                  <p className="mt-1 text-red-700">
                    <span className="font-bold">Hint:</span> {error.hint}
                  </p>
                )}
              </div>

              <div>
                <Link
                  href="/admin/payments"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-red-800"
                >
                  <RefreshCw size={14} />
                  <span>Retry Payments Query</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const payments = (data ?? []) as unknown as PaymentRow[];
  const pagination = computeServerPaginationWindow(
    { page: params.page, pageSize: params.pageSize },
    count ?? payments.length
  );

  // Metric computations
  const pendingCount = count ?? payments.length;
  const totalPendingPaise = payments.reduce((sum, p) => sum + p.amount_paise, 0);
  const pendingTicketsCount = payments.reduce((sum, p) => sum + (p.orders?.quantity ?? 0), 0);
  const oldestSubmission = payments[0]?.submitted_at
    ? new Date(payments[0].submitted_at).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const sellerOptions = (sellerList ?? []).map((s) => ({
    value: s.id as string,
    label: `${s.display_name} (${s.seller_code})`,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#f0e7df] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#35110f] sm:text-3xl">
            Pending Payment Verification
          </h1>
          <p className="mt-1 text-xs text-[#705a54]">
            Review payment screenshots, seller advisory recommendations, and UTR references to
            atomically issue ticket numbers.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-amber-100 px-3 py-1 font-mono text-xs font-bold text-amber-900">
            {pendingCount} matching records
          </span>
          <ExportDropdown
            resource="payments"
            resourceName="Payments"
            status={activeStatus === "ALL" ? undefined : activeStatus}
          />
        </div>
      </div>

      {/* Screenshot Storage Metrics */}
      <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="font-bold text-[#35110f]">Payment Screenshot Storage</h2>
            <p className="mt-1 text-xs text-[#705a54]">
              Private screenshot metadata only; protected via 5-minute signed URLs with audit
              logging.
            </p>
          </div>
          <span className="text-xs text-[#705a54]">Bucket: payment-screenshots (Private)</span>
        </div>
        {storageMetrics ? (
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-[#705a54]">Objects</p>
              <p className="font-bold">{storageMetrics.object_count}</p>
            </div>
            <div>
              <p className="text-xs text-[#705a54]">Storage used</p>
              <p className="font-bold">
                {(Number(storageMetrics.total_bytes) / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <div>
              <p className="text-xs text-[#705a54]">Average size</p>
              <p className="font-bold">
                {(Number(storageMetrics.average_bytes) / 1024).toFixed(0)} KB
              </p>
            </div>
            <div>
              <p className="text-xs text-[#705a54]">Last 7 days</p>
              <p className="font-bold">{storageMetrics.uploads_last_7_days} uploads</p>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-[#705a54]">Storage usage unavailable</p>
        )}
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#705a54]">Matching Payments</span>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-700">
              <Clock size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-800">{pendingCount}</p>
          <span className="text-[11px] font-medium text-amber-700">
            Status: {activeStatus}
          </span>
        </div>

        <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#705a54]">Page Value</span>
            <div className="rounded-lg bg-[#fffaf7] p-2 text-[#7c1619]">
              <IndianRupee size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#7c1619]">
            ₹{(totalPendingPaise / 100).toLocaleString("en-IN")}
          </p>
          <span className="text-[11px] text-[#705a54]">Current page total</span>
        </div>

        <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#705a54]">Page Tickets</span>
            <div className="rounded-lg bg-[#fffaf7] p-2 text-[#7c1619]">
              <Ticket size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#35110f]">{pendingTicketsCount}</p>
          <span className="text-[11px] text-[#705a54]">Tickets in current view</span>
        </div>

        <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#705a54]">Queue Status</span>
            <div className="rounded-lg bg-[#fffaf7] p-2 text-[#7c1619]">
              <CreditCard size={18} />
            </div>
          </div>
          <p className="mt-2 truncate text-xs font-bold text-[#35110f]">
            {oldestSubmission ? `Oldest: ${oldestSubmission}` : "Queue clear"}
          </p>
          <span className="text-[11px] text-[#705a54]">
            {pendingCount === 0 ? "No backlog" : "Server-side paginated"}
          </span>
        </div>
      </div>

      {/* Server-Side Filter Bar */}
      <AdminFilterBar
        basePath="/admin/payments"
        searchPlaceholder="Search by order ref, customer, phone, payer name, or UTR..."
        currentQuery={searchQuery}
        currentStatus={activeStatus}
        statusOptions={[
          { value: "SUBMITTED", label: "SUBMITTED (Awaiting Admin Review)" },
          { value: "VERIFIED", label: "VERIFIED (Approved & Issued)" },
          { value: "FAILED", label: "FAILED / REJECTED" },
          { value: "PENDING", label: "PENDING (Awaiting Customer Proof)" },
          { value: "ALL", label: "ALL PAYMENT STATES" },
        ]}
        currentSeller={sellerFilter}
        sellerOptions={sellerOptions}
        currentSellerReview={sellerReviewFilter}
        sellerReviewOptions={[
          { value: "", label: "All Seller Reviews" },
          { value: "RECOMMENDED_APPROVAL", label: "Seller Recommended Approval" },
          { value: "RECOMMENDED_REJECTION", label: "Seller Recommended Rejection" },
          { value: "FLAGGED_DISCREPANCY", label: "Seller Flagged Discrepancy" },
          { value: "PENDING_SELLER_REVIEW", label: "Pending Seller Review" },
        ]}
        currentFromDate={fromDate}
        currentToDate={toDate}
        currentPageSize={pagination.pageSize}
      />

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-[#eadbcf] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-[#fffaf7] text-xs font-semibold uppercase tracking-wider text-[#705a54]">
              <th className="p-4">Order Ref</th>
              <th className="p-4">Customer</th>
              <th className="p-4">Seller Attribution</th>
              <th className="p-4">Quantity</th>
              <th className="p-4">Amount</th>
              <th className="p-4">Submitted UTR</th>
              <th className="p-4">Seller Review</th>
              <th className="p-4">Submitted Date</th>
              <th className="p-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0e7df]">
            {payments.map((payment) => {
              const submittedDate = payment.submitted_at
                ? new Date(payment.submitted_at).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—";

              const reviewMeta = payment.seller_review_status
                ? SELLER_REVIEW_LABELS[payment.seller_review_status]
                : null;

              return (
                <tr key={payment.id} className="transition-colors hover:bg-[#fffaf7]/60">
                  {/* Order Ref */}
                  <td className="p-4">
                    {payment.orders ? (
                      <Link
                        href={`/admin/orders/${payment.orders.id}`}
                        className="font-mono font-bold text-[#7c1619] hover:underline"
                      >
                        {payment.orders.order_number}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs text-[#705a54]">—</span>
                    )}
                  </td>

                  {/* Customer */}
                  <td className="p-4">
                    <p className="font-semibold text-[#35110f]">
                      {payment.orders?.customers?.full_name ?? "Unknown"}
                    </p>
                    <p className="font-mono text-xs text-[#705a54]">
                      {payment.orders?.customers?.whatsapp_number ||
                        payment.orders?.customers?.phone ||
                        "—"}
                    </p>
                  </td>

                  {/* Seller Attribution */}
                  <td className="p-4">
                    {(() => {
                      const sellerAttribution =
                        payment.orders?.sellers ||
                        (payment.orders?.snapshot_seller_display_name
                          ? {
                              display_name: payment.orders.snapshot_seller_display_name,
                              seller_code: payment.orders.snapshot_seller_code ?? "",
                            }
                          : null) ||
                        payment.orders?.operational_seller;

                      if (!sellerAttribution) {
                        return (
                          <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                            Direct Online
                          </span>
                        );
                      }

                      return (
                        <div>
                          <p className="text-xs font-medium text-[#35110f]">
                            {sellerAttribution.display_name}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span className="inline-block rounded-md bg-[#fceeee] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#7c1619]">
                              {sellerAttribution.seller_code}
                            </span>
                            {payment.orders?.snapshot_upi_id && (
                              <span
                                className="max-w-[140px] truncate font-mono text-[10px] text-[#705a54]"
                                title={payment.orders.snapshot_upi_id}
                              >
                                {payment.orders.snapshot_upi_id}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </td>

                  {/* Quantity */}
                  <td className="p-4 font-semibold text-[#35110f]">
                    {payment.orders?.quantity ?? 1}{" "}
                    {(payment.orders?.quantity ?? 1) === 1 ? "ticket" : "tickets"}
                  </td>

                  {/* Amount */}
                  <td className="p-4 text-base font-bold text-[#7c1619]">
                    ₹{(payment.amount_paise / 100).toLocaleString("en-IN")}
                  </td>

                  {/* Submitted UTR */}
                  <td className="p-4">
                    <span className="inline-block rounded-lg border border-[#eadbcf] bg-[#fffaf7] px-2.5 py-1 font-mono text-xs font-bold text-[#35110f]">
                      {payment.utr_reference ?? "—"}
                    </span>
                  </td>

                  {/* Seller Review */}
                  <td className="p-4">
                    {reviewMeta ? (
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold ${reviewMeta.color}`}
                      >
                        {reviewMeta.label}
                      </span>
                    ) : (
                      <span className="inline-block rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                        Pending
                      </span>
                    )}
                  </td>

                  {/* Submitted Date */}
                  <td className="p-4 whitespace-nowrap text-xs text-[#705a54]">
                    {submittedDate}
                  </td>

                  {/* Action */}
                  <td className="p-4 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {(() => {
                        const rawShot = payment.payment_screenshots;
                        const shot = Array.isArray(rawShot) ? rawShot[0] : rawShot;
                        if (!shot) return null;
                        return (
                          <AdminPaymentScreenshotDownloadButton
                            paymentId={payment.id}
                            canDownload={isSuperAdmin}
                          />
                        );
                      })()}
                      <Link
                        href={`/admin/payments/${payment.id}`}
                        className="inline-flex items-center gap-1 rounded-xl bg-[#7c1619] px-3.5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-[#631214]"
                      >
                        <span>Review</span>
                        <ArrowRight size={13} />
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}

            {payments.length === 0 && (
              <tr>
                <td className="p-12 text-center" colSpan={9}>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-700">
                    <CheckCircle2 size={28} />
                  </div>
                  <h3 className="mt-4 text-base font-bold text-[#35110f]">All Caught Up</h3>
                  <p className="mt-1 text-xs text-[#705a54]">
                    Zero payments match the selected filters.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Server-Side Pagination Footer */}
      <AdminPaginationFooter
        basePath="/admin/payments"
        pagination={pagination}
        queryParams={{
          q: searchQuery,
          status: activeStatus,
          seller: sellerFilter,
          sellerReview: sellerReviewFilter,
          from: fromDate,
          to: toDate,
        }}
      />
    </div>
  );
}
