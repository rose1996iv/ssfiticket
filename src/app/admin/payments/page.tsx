import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const instant = false;

type PaymentRow = {
  id: string;
  amount_paise: number;
  utr_reference: string | null;
  submitted_at: string | null;
  orders: {
    order_number: string;
    customers: { full_name: string; whatsapp_number: string } | null;
    sellers: { display_name: string; seller_code: string } | null;
  } | null;
};

export default async function PaymentsPage() {
  await connection();
  const db = createSupabaseAdminClient();
  const { data = [] } = await db
    .from("payments")
    .select(
      "id, status, amount_paise, utr_reference, submitted_at, orders(order_number, customers(full_name, whatsapp_number), sellers(display_name, seller_code))"
    )
    .eq("status", "SUBMITTED")
    .order("submitted_at", { ascending: true })
    .limit(100);

  const payments = data as unknown as PaymentRow[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#f0e7df] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#35110f] sm:text-3xl">
            Pending Payment Verification
          </h1>
          <p className="mt-1 text-xs text-[#705a54]">
            Review bank UTR references and verify payments to atomically issue ticket numbers.
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 font-mono text-xs font-bold text-amber-900">
          {payments.length} awaiting review
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#eadbcf] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-[#fffaf7] text-xs font-semibold uppercase tracking-wider text-[#705a54]">
              <th className="p-4">Order Ref</th>
              <th className="p-4">Customer</th>
              <th className="p-4">Seller Attribution</th>
              <th className="p-4">Amount</th>
              <th className="p-4">Submitted UTR</th>
              <th className="p-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0e7df]">
            {payments.map((payment) => (
              <tr key={payment.id} className="transition-colors hover:bg-[#fffaf7]/60">
                <td className="p-4 font-mono font-semibold text-[#7c1619]">
                  {payment.orders?.order_number}
                </td>
                <td className="p-4">
                  <p className="font-semibold text-[#35110f]">{payment.orders?.customers?.full_name}</p>
                  <p className="font-mono text-xs text-[#705a54]">{payment.orders?.customers?.whatsapp_number}</p>
                </td>
                <td className="p-4">
                  <p className="font-medium">{payment.orders?.sellers?.display_name ?? "Direct"}</p>
                  {payment.orders?.sellers?.seller_code && (
                    <span className="font-mono text-xs text-[#705a54]">
                      {payment.orders?.sellers?.seller_code}
                    </span>
                  )}
                </td>
                <td className="p-4 text-base font-bold text-[#7c1619]">
                  ₹{payment.amount_paise / 100}
                </td>
                <td className="p-4">
                  <span className="inline-block rounded-lg border border-[#eadbcf] bg-[#fffaf7] px-2.5 py-1 font-mono text-xs font-bold text-[#35110f]">
                    {payment.utr_reference ?? "—"}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <Link
                    href={`/admin/payments/${payment.id}`}
                    className="inline-flex items-center gap-1 rounded-xl bg-[#7c1619] px-3.5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-[#631214]"
                  >
                    <span>Review</span>
                    <ArrowRight size={13} />
                  </Link>
                </td>
              </tr>
            ))}

            {payments.length === 0 && (
              <tr>
                <td className="p-12 text-center" colSpan={6}>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-700">
                    <CheckCircle2 size={28} />
                  </div>
                  <h3 className="mt-4 text-base font-bold text-[#35110f]">All Caught Up</h3>
                  <p className="mt-1 text-xs text-[#705a54]">
                    Zero payments are currently awaiting verification.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
