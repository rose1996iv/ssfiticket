import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasCurrentUserRole } from "@/lib/auth/server";
import { SellerQrModal } from "@/components/admin/SellerQrModal";
import { ExportDropdown } from "@/components/admin/ExportDropdown";
import { CreateSellerModal } from "@/components/admin/CreateSellerModal";
import { SellerDetailModal, SellerDetailData } from "@/components/admin/SellerDetailModal";
import { SellerLifecycleModal } from "@/components/admin/SellerLifecycleModal";

export const instant = false;

export default async function AdminSellersPage() {
  await connection();
  const db = createSupabaseAdminClient();
  const isSuperAdmin = await hasCurrentUserRole("SUPER_ADMIN");

  const { data, error } = await db
    .from("sellers")
    .select(`
      id,
      seller_code,
      display_name,
      is_active,
      created_at,
      profiles (
        id,
        email,
        phone
      ),
      orders (
        id,
        order_number,
        quantity,
        total_amount_paise,
        status,
        created_at,
        payments (
          id,
          status,
          amount_paise
        )
      ),
      tickets (
        id,
        status
      )
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[Admin Sellers Query Error]", {
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
                  Unable to Load Sellers
                </h1>
                <p className="mt-1 text-xs leading-relaxed text-red-800">
                  Failed to fetch registered sellers from the database.
                </p>
              </div>

              <div className="rounded-xl border border-red-200 bg-white/90 p-3.5 font-mono text-xs text-red-900">
                <p><span className="font-bold">Error Code:</span> {error.code || "UNKNOWN"}</p>
                <p><span className="font-bold">Message:</span> {error.message || "Query failed"}</p>
                {error.hint && <p className="mt-1 text-red-700"><span className="font-bold">Hint:</span> {error.hint}</p>}
              </div>

              <div>
                <Link
                  href="/admin/sellers"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-red-800"
                >
                  <RefreshCw size={14} />
                  <span>Retry Sellers Query</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const sellers = ((data ?? []) as unknown as SellerDetailData[]).map((s) => ({
    ...s,
    orders: s.orders || [],
    tickets: s.tickets || [],
  }));

  const activeCount = sellers.filter((s) => s.is_active).length;
  const totalVerifiedRevenuePaise = sellers
    .flatMap((s) => s.orders.flatMap((o) => o.payments || []))
    .filter((p) => p.status === "VERIFIED")
    .reduce((sum, p) => sum + p.amount_paise, 0);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#f0e7df] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#35110f] sm:text-3xl">
            Sellers & Fundraisers
          </h1>
          <p className="mt-1 text-xs text-[#705a54]">
            Manage fundraisers, monitor relational sales attribution, and control account lifecycles.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs font-semibold text-[#705a54]">
            {activeCount}/{sellers.length} active sellers
          </span>
          <ExportDropdown resource="sellers" resourceName="Sellers" />
          <CreateSellerModal />
        </div>
      </div>

      {/* Relational Metric Summary Cards */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-[#eadbcf] bg-white p-4 shadow-2xs">
          <span className="text-xs text-[#705a54]">Total Fundraisers</span>
          <p className="mt-1 font-mono text-2xl font-bold text-[#35110f]">{sellers.length}</p>
        </div>
        <div className="rounded-xl border border-[#eadbcf] bg-white p-4 shadow-2xs">
          <span className="text-xs text-[#705a54]">Active Referrals</span>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-700">{activeCount}</p>
        </div>
        <div className="rounded-xl border border-[#eadbcf] bg-white p-4 shadow-2xs">
          <span className="text-xs text-[#705a54]">Attributed Orders</span>
          <p className="mt-1 font-mono text-2xl font-bold text-[#7c1619]">
            {sellers.reduce((sum, s) => sum + s.orders.length, 0)}
          </p>
        </div>
        <div className="rounded-xl border border-[#eadbcf] bg-white p-4 shadow-2xs">
          <span className="text-xs text-[#705a54]">Seller Revenue</span>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-700">
            ₹{totalVerifiedRevenuePaise / 100}
          </p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-[#eadbcf] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-[#fffaf7] text-xs font-semibold uppercase tracking-wider text-[#705a54]">
              <th className="p-4">Seller Code</th>
              <th className="p-4">Name</th>
              <th className="p-4">Contact</th>
              <th className="p-4 text-center">Orders</th>
              <th className="p-4 text-center">Tickets</th>
              <th className="p-4 text-right">Collection</th>
              <th className="p-4 text-center">Status</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0e7df]">
            {sellers.map((s) => {
              const issuedCount = s.tickets.filter((t) => t.status === "ISSUED").length;
              const verifiedPaise = s.orders
                .flatMap((o) => o.payments || [])
                .filter((p) => p.status === "VERIFIED")
                .reduce((sum, p) => sum + p.amount_paise, 0);

              return (
                <tr key={s.id} className="hover:bg-[#fffaf7]/60">
                  <td className="p-4 font-mono font-bold text-[#7c1619]">
                    {s.seller_code}
                  </td>
                  <td className="p-4 font-medium text-[#35110f]">{s.display_name}</td>
                  <td className="p-4 text-xs text-[#705a54]">
                    <div>{s.profiles?.email || "—"}</div>
                    <div className="text-[11px] text-[#8c736d]">{s.profiles?.phone || ""}</div>
                  </td>
                  <td className="p-4 text-center font-mono font-semibold text-[#35110f]">
                    {s.orders.length}
                  </td>
                  <td className="p-4 text-center font-mono font-semibold text-[#7c1619]">
                    {issuedCount}
                  </td>
                  <td className="p-4 text-right font-mono font-semibold text-emerald-700">
                    ₹{verifiedPaise / 100}
                  </td>
                  <td className="p-4 text-center">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        s.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {s.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <SellerDetailModal seller={s} />
                      <SellerQrModal
                        sellerCode={s.seller_code}
                        sellerName={s.display_name}
                        isActive={s.is_active}
                      />
                      <SellerLifecycleModal
                        sellerId={s.id}
                        sellerCode={s.seller_code}
                        displayName={s.display_name}
                        isActive={s.is_active}
                        orderCount={s.orders.length}
                        ticketCount={s.tickets.length}
                        isSuperAdmin={isSuperAdmin}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {sellers.length === 0 && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-sm text-[#705a54]">
                  No sellers registered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
