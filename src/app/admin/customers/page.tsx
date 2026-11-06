import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, RefreshCw, Users } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasAnyCurrentUserRole } from "@/lib/auth/server";
import { ExportDropdown } from "@/components/admin/ExportDropdown";
import { CustomerDetailModal, CustomerDetailData } from "@/components/admin/CustomerDetailModal";
import { CustomerContactEditModal } from "@/components/admin/CustomerContactEditModal";
import { computeServerPaginationWindow } from "@/lib/pagination/serverPagination";
import {
  AdminFilterBar,
  AdminPaginationFooter,
} from "@/components/admin/AdminFilterAndPaginationBar";

type SearchParams = {
  page?: string;
  pageSize?: string;
  q?: string;
  from?: string;
  to?: string;
};

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await connection();
  const params = (await searchParams) ?? {};
  const db = createSupabaseAdminClient();
  const canEditCustomer = await hasAnyCurrentUserRole(["SUPER_ADMIN", "ADMIN"]);

  const searchQuery = (params.q ?? "").trim();
  const fromDate = (params.from ?? "").trim();
  const toDate = (params.to ?? "").trim();

  const initialWindow = computeServerPaginationWindow(
    { page: params.page, pageSize: params.pageSize },
    0
  );

  let query = db
    .from("customers")
    .select(
      `
      id,
      full_name,
      phone,
      whatsapp_number,
      email,
      created_at,
      orders (
        id,
        order_number,
        quantity,
        total_amount_paise,
        status,
        created_at,
        sellers!orders_seller_id_fkey (
          display_name,
          seller_code
        ),
        payments (
          id,
          status,
          amount_paise,
          utr_reference
        )
      ),
      tickets (
        id,
        ticket_number,
        status
      )
    `,
      { count: "exact" }
    );

  if (searchQuery) {
    query = query.or(
      `full_name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%,whatsapp_number.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`
    );
  }
  if (fromDate) {
    query = query.gte("created_at", `${fromDate}T00:00:00.000Z`);
  }
  if (toDate) {
    query = query.lte("created_at", `${toDate}T23:59:59.999Z`);
  }

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(initialWindow.rangeFrom, initialWindow.rangeTo);

  if (error) {
    console.error("[Admin Customers Query Error]", {
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
                <h1 className="text-lg font-bold text-red-950">Unable to Load Customers</h1>
                <p className="mt-1 text-xs leading-relaxed text-red-800">
                  Failed to fetch customer records from the database.
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
                  href="/admin/customers"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-red-800"
                >
                  <RefreshCw size={14} />
                  <span>Retry Customers Query</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const customers = ((data ?? []) as unknown as CustomerDetailData[]).map((c) => ({
    ...c,
    orders: c.orders || [],
    tickets: c.tickets || [],
  }));

  const pagination = computeServerPaginationWindow(
    { page: params.page, pageSize: params.pageSize },
    count ?? customers.length
  );

  const totalCustomers = count ?? customers.length;
  const totalTicketsAllocated = customers.reduce((sum, c) => sum + c.tickets.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#f0e7df] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#35110f] sm:text-3xl">
            Customer Directory
          </h1>
          <p className="mt-1 text-xs text-[#705a54]">
            Registered buyers participating in the SSFI Lucky Draw with controlled contact
            management and audit logging.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-semibold text-[#705a54]">
            {totalCustomers} registered customers ({totalTicketsAllocated} tickets on page)
          </span>
          <ExportDropdown resource="customers" resourceName="Customers" />
        </div>
      </div>

      {/* Filter Bar */}
      <AdminFilterBar
        basePath="/admin/customers"
        searchPlaceholder="Search by customer full name, phone, WhatsApp, or email..."
        currentQuery={searchQuery}
        currentFromDate={fromDate}
        currentToDate={toDate}
        currentPageSize={pagination.pageSize}
      />

      <div className="overflow-x-auto rounded-2xl border border-[#eadbcf] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-[#fffaf7] text-xs font-semibold uppercase tracking-wider text-[#705a54]">
              <th className="p-4">Customer Name</th>
              <th className="p-4">Contact</th>
              <th className="p-4 text-center">Orders</th>
              <th className="p-4 text-center">Tickets</th>
              <th className="p-4 text-right">Verified Spend</th>
              <th className="p-4">Joined Date</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0e7df]">
            {customers.map((c) => {
              const joined = new Date(c.created_at).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              });

              const verifiedSpendPaise = c.orders
                .flatMap((o) => o.payments || [])
                .filter((p) => p.status === "VERIFIED")
                .reduce((sum, p) => sum + p.amount_paise, 0);

              return (
                <tr key={c.id} className="transition-colors hover:bg-[#fffaf7]/60">
                  <td className="p-4">
                    <span className="font-semibold text-[#35110f]">{c.full_name}</span>
                    <div className="font-mono text-[11px] text-[#705a54]">
                      ID: {c.id.slice(0, 8)}...
                    </div>
                  </td>
                  <td className="p-4 text-xs">
                    <div className="font-mono font-medium text-[#35110f]">{c.phone}</div>
                    {c.whatsapp_number && c.whatsapp_number !== c.phone && (
                      <div className="font-mono text-[11px] text-emerald-700">
                        WA: {c.whatsapp_number}
                      </div>
                    )}
                    {c.email && <div className="text-[11px] text-[#705a54]">{c.email}</div>}
                  </td>
                  <td className="p-4 text-center font-mono font-semibold text-[#35110f]">
                    {c.orders.length}
                  </td>
                  <td className="p-4 text-center font-mono font-semibold text-[#7c1619]">
                    {c.tickets.length}
                  </td>
                  <td className="p-4 text-right font-mono font-semibold text-emerald-700">
                    ₹{verifiedSpendPaise / 100}
                  </td>
                  <td className="p-4 text-xs text-[#705a54]">{joined}</td>
                  <td className="p-4 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {canEditCustomer && (
                        <CustomerContactEditModal
                          mode="CUSTOMER_PROFILE"
                          customerId={c.id}
                          initialFullName={c.full_name}
                          initialEmail={c.email ?? ""}
                          initialWhatsapp={c.whatsapp_number || c.phone || ""}
                          buttonLabel="Edit Profile"
                        />
                      )}
                      <CustomerDetailModal customer={c} />
                    </div>
                  </td>
                </tr>
              );
            })}

            {customers.length === 0 && (
              <tr>
                <td className="p-12 text-center" colSpan={7}>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fffaf7] text-[#7c1619]">
                    <Users size={28} />
                  </div>
                  <h3 className="mt-4 text-base font-bold text-[#35110f]">No Customers Found</h3>
                  <p className="mt-1 text-xs text-[#705a54]">
                    Zero customer records match the selected filters.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <AdminPaginationFooter
        basePath="/admin/customers"
        pagination={pagination}
        queryParams={{
          q: searchQuery,
          from: fromDate,
          to: toDate,
        }}
      />
    </div>
  );
}
