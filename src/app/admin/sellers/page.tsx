import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SellerQrModal } from "@/components/admin/SellerQrModal";
import { ExportDropdown } from "@/components/admin/ExportDropdown";
import { CreateSellerModal } from "@/components/admin/CreateSellerModal";

export const instant = false;

type SellerRow = {
  id: string;
  seller_code: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
};

export default async function AdminSellersPage() {
  await connection();
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("sellers")
    .select("id,seller_code,display_name,is_active,created_at")
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

  const sellers = (data ?? []) as SellerRow[];

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#f0e7df] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#35110f] sm:text-3xl">Sellers & QR Codes</h1>
          <p className="mt-1 text-xs text-[#705a54]">
            Manage fundraisers, generate QR cards, and monitor sales attribution.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-mono text-xs font-semibold text-[#705a54]">
            {sellers.length} registered {sellers.length === 1 ? "seller" : "sellers"}
          </p>
          <ExportDropdown resource="sellers" resourceName="Sellers" />
          <CreateSellerModal />
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-[#fffaf7] text-xs font-semibold uppercase tracking-wider text-[#705a54]">
              <th className="p-4">Code</th>
              <th className="p-4">Name</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Referral QR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0e7df]">
            {sellers.map((s) => (
              <tr key={s.id} className="hover:bg-[#fffaf7]/60">
                <td className="p-4 font-mono font-bold text-[#7c1619]">{s.seller_code}</td>
                <td className="p-4 font-medium">{s.display_name}</td>
                <td className="p-4">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      s.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {s.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <SellerQrModal
                    sellerCode={s.seller_code}
                    sellerName={s.display_name}
                    isActive={s.is_active}
                  />
                </td>
              </tr>
            ))}
            {sellers.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-sm text-[#705a54]">
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
