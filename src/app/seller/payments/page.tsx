import { connection } from "next/server";
import { requireRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { SellerPaymentReviewCard } from "@/components/seller/SellerPaymentReviewCard";
import { Clock, CheckCircle2, AlertCircle } from "lucide-react";


type PaymentForReview = {
  id: string;
  status: string;
  amount_paise: number;
  utr_reference: string | null;
  payer_name: string | null;
  submitted_at: string | null;
  seller_review_status: string | null;
  seller_reviewed_at: string | null;
  seller_review_note: string | null;
  payment_screenshots:
    | { uploaded_at: string }
    | { uploaded_at: string }[]
    | null;
  orders:
    | {
        id: string;
        order_number: string;
        quantity: number;
        customers:
          | { full_name: string; phone: string; whatsapp_number: string }
          | { full_name: string; phone: string; whatsapp_number: string }[]
          | null;
      }
    | {
        id: string;
        order_number: string;
        quantity: number;
        customers:
          | { full_name: string; phone: string; whatsapp_number: string }
          | { full_name: string; phone: string; whatsapp_number: string }[]
          | null;
      }[]
    | null;
};

export default async function SellerPaymentsPage() {
  await connection();
  const user = await requireRole("SELLER");
  const db = createSupabaseAdminClient();

  // Resolve seller
  const { data: seller } = await db
    .from("sellers")
    .select("id, is_active")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!seller || !seller.is_active) {
    redirect("/unauthorized?reason=seller_inactive");
  }

  // Fetch submitted payments for this seller's orders
  const { data: payments, error } = await db
    .from("payments")
    .select(
      "id, status, amount_paise, utr_reference, payer_name, submitted_at, seller_review_status, seller_reviewed_at, seller_review_note, payment_screenshots(uploaded_at), orders!inner(id, order_number, quantity, customers(full_name, phone, whatsapp_number))"
    )
    .eq("status", "SUBMITTED")
    .eq("orders.seller_id", seller.id)
    .order("submitted_at", { ascending: true })
    .limit(100);

  if (error) {
    console.error("[Seller Payments Page] Query error:", error.message);
  }

  const rows = (payments ?? []) as unknown as PaymentForReview[];

  const pendingReview = rows.filter((p) => !p.seller_review_status);
  const alreadyReviewed = rows.filter((p) => !!p.seller_review_status);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#7c1619]">Payment Reviews</h1>
        <p className="mt-1 text-xs text-[#705a54] leading-relaxed max-w-2xl">
          These are your customers&apos; submitted payment screenshots awaiting review.
          Your review is <strong>advisory only</strong> — it helps SSFI administrators prioritise verification.
          Tickets are issued exclusively after Admin final approval.
        </p>
      </div>

      {rows.length === 0 && (
        <div className="rounded-2xl border border-[#eadbcf] bg-white p-8 text-center shadow-sm">
          <CheckCircle2 size={32} className="mx-auto text-emerald-500 mb-3" />
          <p className="font-semibold text-[#35110f]">No pending payment reviews</p>
          <p className="mt-1 text-xs text-[#705a54]">
            All submitted payments have been reviewed or there are no new submissions yet.
          </p>
        </div>
      )}

      {/* Pending review section */}
      {pendingReview.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Clock size={16} className="text-amber-600" />
            <h2 className="text-sm font-bold text-[#35110f]">
              Awaiting Your Review ({pendingReview.length})
            </h2>
          </div>
          <div className="space-y-4">
            {pendingReview.map((p) => (
              <SellerPaymentReviewCard key={p.id} payment={p} />
            ))}
          </div>
        </section>
      )}

      {/* Already reviewed section */}
      {alreadyReviewed.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3 mt-6">
            <AlertCircle size={16} className="text-blue-500" />
            <h2 className="text-sm font-bold text-[#35110f]">
              Already Reviewed — Awaiting Admin Verification ({alreadyReviewed.length})
            </h2>
          </div>
          <div className="space-y-4">
            {alreadyReviewed.map((p) => (
              <SellerPaymentReviewCard key={p.id} payment={p} readonly />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

