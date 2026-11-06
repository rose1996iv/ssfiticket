import Link from "next/link";
import { connection } from "next/server";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  IndianRupee,
  RefreshCw,
  ShoppingBag,
  Ticket,
} from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ExportDropdown } from "@/components/admin/ExportDropdown";
import { computeServerPaginationWindow } from "@/lib/pagination/serverPagination";
import {
  AdminFilterBar,
  AdminPaginationFooter,
} from "@/components/admin/AdminFilterAndPaginationBar";

type OrderRow = {
  id: string;
  order_number: string;
  quantity: number;
  total_amount_paise: number;
  status: string;
  created_at: string;
  customers: {
    id: string;
    full_name: string;
    phone: string;
    whatsapp_number: string;
    email?: string | null;
  } | null;
  sellers: {
    id: string;
    display_name: string;
    seller_code: string;
  } | null;
  payments: {
    id: string;
    status: string;
    utr_reference: string | null;
    payer_name: string | null;
    amount_paise: number;
  }[];
  tickets: {
    id: string;
    ticket_number: string;
    status: string;
  }[];
};

type SearchParams = {
  page?: string;
  pageSize?: string;
  q?: string;
  status?: string;
  seller?: string;
  from?: string;
  to?: string;
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await connection();
  const params = (await searchParams) ?? {};
  const db = createSupabaseAdminClient();

  const searchQuery = (params.q ?? "").trim();
  const statusFilter = (params.status ?? "").trim().toUpperCase();
  const sellerFilter = (params.seller ?? "").trim();
  const fromDate = (params.from ?? "").trim();
  const toDate = (params.to ?? "").trim();

  const initialWindow = computeServerPaginationWindow(
    { page: params.page, pageSize: params.pageSize },
    0
  );

  const { data: sellerList } = await db
    .from("sellers")
    .select("id, display_name, seller_code")
    .order("seller_code", { ascending: true });

  // Resolve customer/payment/ticket matches for search query
  let matchedCustomerIds: string[] = [];
  let matchedOrderIdsFromPaymentOrTicket: string[] = [];
  if (searchQuery) {
    const [{ data: custMatches }, { data: payMatches }, { data: ticketMatches }] =
      await Promise.all([
        db
          .from("customers")
          .select("id")
          .or(
            `full_name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%,whatsapp_number.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`
          )
          .limit(500),
        db
          .from("payments")
          .select("order_id")
          .or(`utr_reference.ilike.%${searchQuery}%,payer_name.ilike.%${searchQuery}%`)
          .limit(500),
        db
          .from("tickets")
          .select("order_id")
          .ilike("ticket_number", `%${searchQuery}%`)
          .limit(500),
      ]);
    matchedCustomerIds = (custMatches ?? []).map((c) => c.id as string);
    matchedOrderIdsFromPaymentOrTicket = Array.from(
      new Set([
        ...(payMatches ?? []).map((p) => p.order_id as string),
        ...(ticketMatches ?? []).map((t) => t.order_id as string),
      ])
    );
  }

  let query = db
    .from("orders")
    .select(
      "id, order_number, quantity, total_amount_paise, status, created_at, customers(id, full_name, phone, whatsapp_number), sellers!orders_seller_id_fkey(id, display_name, seller_code), payments(id, status, utr_reference, payer_name, amount_paise), tickets(id, ticket_number, status)",
      { count: "exact" }
    );

  if (statusFilter && statusFilter !== "ALL") {
    query = query.eq("status", statusFilter);
  }

  if (sellerFilter) {
    query = query.or(
      `seller_id.eq.${sellerFilter},snapshot_seller_id.eq.${sellerFilter}`
    );
  }

  if (fromDate) {
    query = query.gte("created_at", `${fromDate}T00:00:00.000Z`);
  }
  if (toDate) {
    query = query.lte("created_at", `${toDate}T23:59:59.999Z`);
  }

  if (searchQuery) {
    const clauses: string[] = [`order_number.ilike.%${searchQuery}%`];
    if (matchedCustomerIds.length > 0) {
      clauses.push(`customer_id.in.(${matchedCustomerIds.join(",")})`);
    }
    if (matchedOrderIdsFromPaymentOrTicket.length > 0) {
      clauses.push(`id.in.(${matchedOrderIdsFromPaymentOrTicket.join(",")})`);
    }
    query = query.or(clauses.join(","));
  }

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(initialWindow.rangeFrom, initialWindow.rangeTo);

  if (error) {
    console.error("[Admin Orders Query Error]", {
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
                <h1 className="text-lg font-bold text-red-950">Unable to Load Orders</h1>
                <p className="mt-1 text-xs leading-relaxed text-red-800">
                  Failed to fetch customer purchase orders from the database.
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
                  href="/admin/orders"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-red-800"
                >
                  <RefreshCw size={14} />
                  <span>Retry Orders Query</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const orders = (data ?? []) as unknown as OrderRow[];
  const pagination = computeServerPaginationWindow(
    { page: params.page, pageSize: params.pageSize },
    count ?? orders.length
  );

  // Metric computations
  const totalOrders = count ?? orders.length;
  const totalRevenuePaise = orders.reduce((sum, o) => {
    const isPaid =
      o.status === "TICKETS_ISSUED" ||
      o.status === "PAYMENT_VERIFIED" ||
      o.payments.some((p) => p.status === "VERIFIED");
    return isPaid ? sum + o.total_amount_paise : sum;
  }, 0);
  const totalTicketsIssued = orders.reduce((sum, o) => sum + (o.tickets?.length ?? 0), 0);
  const pendingOrders = orders.filter(
    (o) =>
      o.status === "PAYMENT_SUBMITTED" || o.payments.some((p) => p.status === "SUBMITTED")
  ).length;

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
            Orders Directory
          </h1>
          <p className="mt-1 text-xs text-[#705a54]">
            Comprehensive relational view of purchase orders, customer details, seller
            attributions, payment references, and issued tickets.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-semibold text-[#705a54]">
            {totalOrders} matching orders
          </span>
          <ExportDropdown resource="orders" resourceName="Orders" />
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#705a54]">Matching Orders</span>
            <div className="rounded-lg bg-[#fffaf7] p-2 text-[#7c1619]">
              <ShoppingBag size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#35110f]">{totalOrders}</p>
          <span className="text-[11px] text-[#705a54]">Server-side paginated</span>
        </div>

        <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#705a54]">Page Verified Collection</span>
            <div className="rounded-lg bg-green-50 p-2 text-green-700">
              <IndianRupee size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-green-800">
            ₹{(totalRevenuePaise / 100).toLocaleString("en-IN")}
          </p>
          <span className="text-[11px] font-medium text-green-700">From verified purchases</span>
        </div>

        <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#705a54]">Page Issued Tickets</span>
            <div className="rounded-lg bg-[#fffaf7] p-2 text-[#7c1619]">
              <Ticket size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#7c1619]">{totalTicketsIssued}</p>
          <span className="text-[11px] text-[#705a54]">Assigned lucky numbers</span>
        </div>

        <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#705a54]">Pending Review (Page)</span>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-700">
              <Clock size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-800">{pendingOrders}</p>
          <span className="text-[11px] font-medium text-amber-700">Awaiting staff verification</span>
        </div>
      </div>

      {/* Server-Side Filter Bar */}
      <AdminFilterBar
        basePath="/admin/orders"
        searchPlaceholder="Search by order ref, customer name/email/phone, ticket #, or UTR..."
        currentQuery={searchQuery}
        currentStatus={statusFilter || "ALL"}
        statusOptions={[
          { value: "ALL", label: "All Order Statuses" },
          { value: "PENDING_PAYMENT", label: "PENDING PAYMENT" },
          { value: "PAYMENT_SUBMITTED", label: "PAYMENT SUBMITTED" },
          { value: "TICKETS_ISSUED", label: "TICKETS ISSUED" },
          { value: "CANCELLED", label: "CANCELLED" },
        ]}
        currentSeller={sellerFilter}
        sellerOptions={sellerOptions}
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
              <th className="p-4">Date</th>
              <th className="p-4">Customer</th>
              <th className="p-4">Seller Attribution</th>
              <th className="p-4">Size &amp; Amount</th>
              <th className="p-4">Order Status</th>
              <th className="p-4">Payment &amp; UTR</th>
              <th className="p-4">Tickets</th>
              <th className="p-4 text-right">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0e7df]">
            {orders.map((order) => {
              const date = new Date(order.created_at).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              });

              const primaryPayment = order.payments?.[0];
              const ticketCount = order.tickets?.length ?? 0;

              return (
                <tr key={order.id} className="transition-colors hover:bg-[#fffaf7]/60">
                  {/* Order Ref */}
                  <td className="p-4">
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="font-mono font-bold text-[#7c1619] hover:underline"
                    >
                      {order.order_number}
                    </Link>
                  </td>

                  {/* Date */}
                  <td className="p-4 whitespace-nowrap text-xs text-[#705a54]">{date}</td>

                  {/* Customer */}
                  <td className="p-4">
                    <p className="font-semibold text-[#35110f]">
                      {order.customers?.full_name ?? "Unknown Customer"}
                    </p>
                    <p className="font-mono text-xs text-[#705a54]">
                      {order.customers?.whatsapp_number || order.customers?.phone || "—"}
                    </p>
                  </td>

                  {/* Seller Attribution */}
                  <td className="p-4">
                    {order.sellers ? (
                      <div>
                        <p className="text-xs font-medium text-[#35110f]">
                          {order.sellers.display_name}
                        </p>
                        <span className="inline-block rounded-md bg-[#fceeee] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#7c1619]">
                          {order.sellers.seller_code}
                        </span>
                      </div>
                    ) : (
                      <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                        Direct Online
                      </span>
                    )}
                  </td>

                  {/* Size & Amount */}
                  <td className="p-4">
                    <p className="font-bold text-[#35110f]">
                      ₹{(order.total_amount_paise / 100).toLocaleString("en-IN")}
                    </p>
                    <span className="text-xs text-[#705a54]">
                      {order.quantity} {order.quantity === 1 ? "ticket" : "tickets"}
                    </span>
                  </td>

                  {/* Order Status */}
                  <td className="p-4">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        order.status === "TICKETS_ISSUED"
                          ? "bg-green-100 text-green-800"
                          : order.status === "PAYMENT_VERIFIED"
                          ? "bg-blue-100 text-blue-800"
                          : order.status === "PAYMENT_SUBMITTED"
                          ? "bg-amber-100 text-amber-800"
                          : order.status === "CANCELLED"
                          ? "bg-red-100 text-red-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {order.status.replace(/_/g, " ")}
                    </span>
                  </td>

                  {/* Payment & UTR */}
                  <td className="p-4">
                    {primaryPayment ? (
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-block rounded-full px-2 py-0.2 text-[10px] font-bold ${
                              primaryPayment.status === "VERIFIED"
                                ? "bg-green-100 text-green-800"
                                : primaryPayment.status === "SUBMITTED"
                                ? "bg-amber-100 text-amber-800"
                                : primaryPayment.status === "REJECTED"
                                ? "bg-red-100 text-red-800"
                                : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {primaryPayment.status}
                          </span>
                        </div>
                        {primaryPayment.utr_reference ? (
                          <p
                            className="font-mono text-xs font-semibold text-[#35110f]"
                            title="Bank Reference / UTR"
                          >
                            UTR: {primaryPayment.utr_reference}
                          </p>
                        ) : (
                          <p className="text-[11px] italic text-[#705a54]">UTR Optional</p>
                        )}
                        {primaryPayment.payer_name && (
                          <p className="text-[11px] text-[#705a54]" title="Bank / UPI Payer Name">
                            Payer:{" "}
                            <span className="font-medium text-[#35110f]">
                              {primaryPayment.payer_name}
                            </span>
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs italic text-[#705a54]">Pending</span>
                    )}
                  </td>

                  {/* Tickets */}
                  <td className="p-4">
                    {ticketCount > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2 py-1 font-mono text-xs font-bold text-green-800">
                        <CheckCircle2 size={12} className="text-green-600" />
                        <span>{ticketCount} issued</span>
                      </span>
                    ) : (
                      <span className="text-xs text-[#705a54]">—</span>
                    )}
                  </td>

                  {/* Details Link */}
                  <td className="p-4 text-right">
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="inline-flex items-center gap-1 rounded-xl border border-[#eadbcf] px-3 py-1.5 text-xs font-semibold text-[#7c1619] transition hover:bg-[#fffaf7]"
                    >
                      <span>View</span>
                      <ArrowRight size={12} />
                    </Link>
                  </td>
                </tr>
              );
            })}

            {orders.length === 0 && (
              <tr>
                <td className="p-12 text-center" colSpan={9}>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fffaf7] text-[#7c1619]">
                    <ShoppingBag size={28} />
                  </div>
                  <h3 className="mt-4 text-base font-bold text-[#35110f]">No Orders Found</h3>
                  <p className="mt-1 text-xs text-[#705a54]">
                    Zero orders match the selected filters.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Server-Side Pagination Footer */}
      <AdminPaginationFooter
        basePath="/admin/orders"
        pagination={pagination}
        queryParams={{
          q: searchQuery,
          status: statusFilter,
          seller: sellerFilter,
          from: fromDate,
          to: toDate,
        }}
      />
    </div>
  );
}
