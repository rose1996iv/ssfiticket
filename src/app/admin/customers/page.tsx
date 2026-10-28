import { connection } from "next/server";
import { Users } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const instant = false;

type CustomerRow = {
  id: string;
  full_name: string;
  phone: string;
  whatsapp_number: string | null;
  email: string | null;
  created_at: string;
};

export default async function AdminCustomersPage() {
  await connection();
  const db = createSupabaseAdminClient();
  const { data = [] } = await db
    .from("customers")
    .select("id, full_name, phone, whatsapp_number, email, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const customers = data as CustomerRow[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#f0e7df] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#35110f] sm:text-3xl">
            Customer Directory
          </h1>
          <p className="mt-1 text-xs text-[#705a54]">
            Registered buyers participating in the SSFI Lucky Draw.
          </p>
        </div>
        <span className="font-mono text-xs font-semibold text-[#705a54]">
          {customers.length} registered customers
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#eadbcf] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-[#fffaf7] text-xs font-semibold uppercase tracking-wider text-[#705a54]">
              <th className="p-4">Customer Name</th>
              <th className="p-4">Contact Phone</th>
              <th className="p-4">WhatsApp Reference</th>
              <th className="p-4">Email</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0e7df]">
            {customers.map((c) => (
              <tr key={c.id} className="transition-colors hover:bg-[#fffaf7]/60">
                <td className="p-4 font-bold text-[#35110f]">{c.full_name}</td>
                <td className="p-4 font-mono text-xs text-[#705a54]">{c.phone}</td>
                <td className="p-4 font-mono text-xs text-[#705a54]">
                  {c.whatsapp_number ? (
                    <a
                      href={`https://wa.me/${c.whatsapp_number.replace(/[^0-9]/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-700 hover:underline"
                    >
                      {c.whatsapp_number}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="p-4 text-xs text-[#705a54]">{c.email ?? "—"}</td>
              </tr>
            ))}

            {customers.length === 0 && (
              <tr>
                <td className="p-12 text-center text-[#705a54]" colSpan={4}>
                  <Users size={32} className="mx-auto mb-2 text-gray-300" />
                  <p className="text-base font-bold">No customers yet</p>
                  <p className="text-xs">Customers are registered automatically during order placement.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
