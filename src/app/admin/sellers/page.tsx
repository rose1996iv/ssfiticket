import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { connection } from "next/server";
import { SellerQrModal } from "@/components/admin/SellerQrModal";

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
  const { data = [] } = await db
    .from("sellers")
    .select("id,seller_code,display_name,is_active,created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const sellers = data as SellerRow[];

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-3xl font-bold">Sellers</h1>
        <p className="text-sm text-[#705a54]">
          {sellers.length} registered {sellers.length === 1 ? "seller" : "sellers"}
        </p>
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
            {sellers.map((seller) => (
              <tr className="hover:bg-[#fffaf7]/60 transition-colors" key={seller.id}>
                <td className="p-4 font-mono font-semibold text-[#7c1619]">{seller.seller_code}</td>
                <td className="p-4 font-medium">{seller.display_name}</td>
                <td className="p-4">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      seller.is_active
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {seller.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <SellerQrModal
                    sellerCode={seller.seller_code}
                    sellerName={seller.display_name}
                    isActive={seller.is_active}
                  />
                </td>
              </tr>
            ))}
            {sellers.length === 0 && (
              <tr>
                <td className="p-6 text-center text-[#705a54]" colSpan={4}>
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
