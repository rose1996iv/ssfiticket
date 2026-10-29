import { connection } from "next/server";
import { MessageSquare } from "lucide-react";
import { requireAnyRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AdminMessageCompose } from "@/components/admin/AdminMessageCompose";
import { AdminSentMessagesTable, type SentMessageItem } from "@/components/admin/AdminSentMessagesTable";

export const instant = false;

type SellerOption = {
  id: string;
  seller_code: string;
  display_name: string;
  is_active: boolean;
};

export default async function AdminMessagesPage() {
  await connection();
  // Administrative staff authorization guard
  await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);

  const db = createSupabaseAdminClient();

  // Fetch all active sellers for recipient selection
  const { data: rawSellers = [] } = await db
    .from("sellers")
    .select("id, seller_code, display_name, is_active")
    .order("seller_code", { ascending: true });

  const sellers = rawSellers as SellerOption[];

  // Fetch recent sent message history with recipient seller & sender profile joins
  const { data: rawMessages = [] } = await db
    .from("seller_messages")
    .select(
      "id, subject, body, created_at, read_at, archived_at, sellers(seller_code, display_name), profiles(full_name, email)"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const messages = rawMessages as unknown as SentMessageItem[];

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-2">
          <MessageSquare className="text-[#7c1619]" size={28} />
          <h1 className="text-2xl font-bold tracking-tight text-[#35110f] sm:text-3xl">
            Seller In-App Messaging
          </h1>
        </div>
        <p className="mt-1 text-sm text-[#705a54]">
          Send targeted administrative announcements, payment verifications, and sales guidance to sellers.
        </p>
      </div>

      {/* Compose & Send Section */}
      <AdminMessageCompose sellers={sellers} />

      {/* Sent Message Outbox & Delivery Tracking */}
      <AdminSentMessagesTable messages={messages} />
    </div>
  );
}

