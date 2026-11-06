import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SellerPaymentSettingsForm } from "@/components/seller/SellerPaymentSettingsForm";


export default async function SellerPaymentSettingsPage() {
  await connection();
  const user = await requireRole("SELLER");
  const db = createSupabaseAdminClient();

  const { data: seller } = await db
    .from("sellers")
    .select(
      "id, seller_code, display_name, upi_id, account_name, payment_instructions, is_qr_active, qr_storage_path"
    )
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!seller) {
    redirect("/unauthorized?reason=seller_not_found");
  }

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <div>
        <Link
          href="/seller"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7c1619] transition hover:underline"
        >
          <ArrowLeft size={14} />
          <span>Back to Seller Dashboard</span>
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-[#35110f] sm:text-3xl">
          Payment QR &amp; Settings
        </h1>
        <p className="mt-1 text-xs text-[#705a54]">
          Manage your personal UPI QR code and payment account details for ticket buyers
        </p>
      </div>

      <SellerPaymentSettingsForm
        sellerCode={seller.seller_code}
        displayName={seller.display_name}
        initialUpiId={seller.upi_id}
        initialAccountName={seller.account_name}
        initialPaymentInstructions={seller.payment_instructions}
        initialIsQrActive={seller.is_qr_active ?? false}
        hasQrImage={Boolean(seller.qr_storage_path)}
      />
    </div>
  );
}
