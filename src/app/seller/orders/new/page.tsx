import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SellerOrderForm } from "@/components/seller/SellerOrderForm";
import { CampaignCountdown } from "@/components/campaign/CampaignCountdown";
import { evaluateCampaignSchedule } from "@/lib/date/timezone";

export const instant = false;

export default async function NewSalePage() {
  await connection();
  const user = await requireRole("SELLER");
  const db = createSupabaseAdminClient();

  const { data: seller } = await db
    .from("sellers")
    .select("id, display_name, seller_code, is_active")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!seller || !seller.is_active) {
    redirect("/unauthorized?reason=seller_inactive");
  }

  const { data: campaign } = await db
    .from("campaigns")
    .select("id, name, status, ticket_price_paise, total_ticket_limit, sold_ticket_count, start_at, end_at")
    .eq("public_id", "ssfi-fundraising-lucky-draw")
    .maybeSingle();

  const schedule = evaluateCampaignSchedule(
    campaign?.status ?? "DRAFT",
    campaign?.start_at,
    campaign?.end_at
  );
  const isSellingOpen = schedule.isSellingOpen;
  const unitPricePaise = campaign?.ticket_price_paise ?? 10000;
  const remainingCapacity = campaign
    ? Math.max(0, campaign.total_ticket_limit - campaign.sold_ticket_count)
    : 0;

  return (
    <div className="mx-auto max-w-2xl">
      {/* Top back navigation */}
      <div className="mb-4">
        <Link
          href="/seller/orders"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#705a54] transition hover:text-[#7c1619]"
        >
          <ArrowLeft size={14} />
          <span>Back to My Orders</span>
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-[#35110f] sm:text-3xl">
          Record New Sale
        </h1>
        <p className="mt-1 text-sm text-[#705a54]">
          Create a manual ticket order for a buyer, then record their UPI payment reference.
        </p>
      </div>

      {/* Campaign Schedule & Countdown Banner */}
      <div className="mb-6">
        <CampaignCountdown
          status={schedule.scheduleStatus}
          startAt={campaign?.start_at ?? null}
          endAt={campaign?.end_at ?? null}
          variant="seller"
        />
      </div>

      {/* Seller Order Form */}
      <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xs sm:p-8">
        <SellerOrderForm
          sellerName={seller.display_name}
          sellerCode={seller.seller_code}
          unitPricePaise={unitPricePaise}
          remainingCapacity={remainingCapacity}
          isCampaignActive={isSellingOpen}
          campaignStatus={schedule.scheduleStatus}
          scheduleReason={schedule.description}
        />
      </div>
    </div>
  );
}
