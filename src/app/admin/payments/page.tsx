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

export const instant = false;

type PaymentRow = {
  id: string;
  status: string;
  amount_paise: number;
  utr_reference: string | null;
  submitted_at: string | null;
  orders: {
    id: string;
    order_number: string;
    quantity: number;
    total_amount_paise: number;
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
  } | null;
};

export default async function PaymentsPage() {
  await connection();
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("payments")
    .select(
      "id, status, amount_paise, utr_reference, submitted_at, orders(id, order_number, quantity, total_amount_paise, customers(id, full_name, phone, whatsapp_number), sellers(id, display_name, seller_code))"
    )
    .eq("status", "SUBMITTED")
    .order("submitted_at", { ascending: true })
    .limit(100);

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
                <p><span className="font-bold">Error Code:</span> {error.code || "UNKNOWN"}</p>
                <p><span className="font-bold">Message:</span> {error.message || "Query failed"}</p>
                {error.hint && <p className="mt-1 text-red-700"><span className="font-bold">Hint:</span> {error.hint}</p>}
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

  // Metric computations
  const pendingCount = payments.length;
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#f0e7df] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#35110f] sm:text-3xl">
            Pending Payment Verification
          </h1>
          <p className="mt-1 text-xs text-[#705a54]">
            Review bank UTR references and verify payments to atomically issue ticket numbers.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-amber-100 px-3 py-1 font-mono text-xs font-bold text-amber-900">
            {pendingCount} awaiting review
          </span>
          <ExportDropdown resource="payments" resourceName="Payments" status="SUBMITTED" />
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#705a54]">Awaiting Review</span>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-700">
              <Clock size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-800">{pendingCount}</p>
          <span className="text-[11px] text-amber-700 font-medium">Pending manual verification</span>
        </div>

        <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#705a54]">Pending Value</span>
            <div className="rounded-lg bg-[#fffaf7] p-2 text-[#7c1619]">
              <IndianRupee size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#7c1619]">
            ₹{(totalPendingPaise / 100).toLocaleString("en-IN")}
          </p>
          <span className="text-[11px] text-[#705a54]">Total unverified amount</span>
        </div>

        <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#705a54]">Tickets Pending</span>
            <div className="rounded-lg bg-[#fffaf7] p-2 text-[#7c1619]">
              <Ticket size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#35110f]">{pendingTicketsCount}</p>
          <span className="text-[11px] text-[#705a54]">Tickets queued for issuance</span>
        </div>

        <div className="rounded-2xl border border-[#eadbcf] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#705a54]">Queue Status</span>
            <div className="rounded-lg bg-[#fffaf7] p-2 text-[#7c1619]">
              <CreditCard size={18} />
            </div>
          </div>
          <p className="mt-2 text-xs font-bold text-[#35110f] truncate">
            {oldestSubmission ? `Oldest: ${oldestSubmission}` : "Queue clear"}
          </p>
          <span className="text-[11px] text-[#705a54]">
            {pendingCount === 0 ? "No backlog" : "Action required"}
          </span>
        </div>
      </div>

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
                      {payment.orders?.customers?.whatsapp_number || payment.orders?.customers?.phone || "—"}
                    </p>
                  </td>

                  {/* Seller Attribution */}
                  <td className="p-4">
                    {payment.orders?.sellers ? (
                      <div>
                        <p className="font-medium text-xs text-[#35110f]">
                          {payment.orders.sellers.display_name}
                        </p>
                        <span className="inline-block rounded-md bg-[#fceeee] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#7c1619]">
                          {payment.orders.sellers.seller_code}
                        </span>
                      </div>
                    ) : (
                      <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                        Direct Online
                      </span>
                    )}
                  </td>

                  {/* Quantity */}
                  <td className="p-4 font-semibold text-[#35110f]">
                    {payment.orders?.quantity ?? 1} {(payment.orders?.quantity ?? 1) === 1 ? "ticket" : "tickets"}
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

                  {/* Submitted Date */}
                  <td className="p-4 text-xs text-[#705a54] whitespace-nowrap">
                    {submittedDate}
                  </td>

                  {/* Action */}
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
              );
            })}

            {payments.length === 0 && (
              <tr>
                <td className="p-12 text-center" colSpan={8}>
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
