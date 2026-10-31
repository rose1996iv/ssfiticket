import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SellerInboxView, type SellerInboxMessage } from "@/components/seller/SellerInboxView";

export const instant = false;

export default async function SellerMessagesPage() {
  await connection();
  const user = await requireRole("SELLER");
  const db = createSupabaseAdminClient();

  // Verify seller identity strictly from server-side session
  const { data: seller } = await db
    .from("sellers")
    .select("id, is_active")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!seller || !seller.is_active) {
    redirect("/unauthorized?reason=seller_inactive");
  }

  // Fetch messages addressed to or initiated by this authenticated seller
  const { data: rawMessages = [] } = await db
    .from("seller_messages")
    .select(
      "id, subject, body, created_at, read_at, archived_at, sender_role, parent_message_id, profiles(full_name, email)"
    )
    .eq("recipient_seller_id", seller.id)
    .order("created_at", { ascending: false });

  const messages = rawMessages as unknown as SellerInboxMessage[];

  return <SellerInboxView messages={messages} />;
}

