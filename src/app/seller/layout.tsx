import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logout } from "@/server/actions/auth";
import { Logo } from "@/components/brand/Logo";
import { LogOut, Mail, PlusCircle, QrCode, ReceiptText, ShoppingBag } from "lucide-react";

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const user = await requireRole("SELLER");
  const db = createSupabaseAdminClient();
  const { data: seller } = await db
    .from("sellers")
    .select("id, is_active")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!seller || !seller.is_active) {
    redirect("/unauthorized?reason=seller_inactive");
  }

  // Count unread active messages sent by staff for the authenticated seller
  const { count: unreadCount = 0 } = await db
    .from("seller_messages")
    .select("id", { count: "exact", head: true })
    .eq("recipient_seller_id", seller.id)
    .neq("sender_role", "SELLER")
    .is("read_at", null)
    .is("archived_at", null);

  // Count pending payment reviews assigned to this seller
  const { count: pendingReviewCount = 0 } = await db
    .from("orders")
    .select("id, payments!inner(id, status)", { count: "exact", head: true })
    .eq("seller_id", seller.id)
    .eq("payments.status", "SUBMITTED");

  return (
    <div className="min-h-screen bg-[#fffaf7]">
      {/* Branded Header */}
      <header className="border-b border-[#e8d6c5] bg-white sticky top-0 z-30 shadow-2xs">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link href="/seller" className="group flex items-center gap-3">
            <Logo size="sm" className="transition-transform group-hover:scale-105" />
            <div>
              <span className="text-sm font-bold tracking-tight text-[#7c1619]">SSFI Seller</span>
              <span className="hidden text-xs text-[#705a54] sm:inline"> A Partner Portal</span>
            </div>
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            <nav className="flex items-center gap-1.5 sm:gap-2.5 text-xs font-semibold">
              <Link
                href="/seller/payment-settings"
                className="flex items-center gap-1.5 rounded-lg border border-[#eadbcf] bg-[#fffaf7] px-2.5 py-1.5 text-[#35110f] transition hover:bg-[#f8e9df]"
                title="Manage personal payment QR"
              >
                <QrCode size={14} className="text-[#7c1619]" />
                <span className="hidden md:inline">Payment QR</span>
              </Link>
              <Link
                href="/seller/payments"
                className="relative flex items-center gap-1.5 rounded-lg border border-[#eadbcf] bg-[#fffaf7] px-2.5 py-1.5 text-[#35110f] transition hover:bg-[#f8e9df]"
                title="Review buyer payment submissions"
              >
                <ReceiptText size={14} className="text-[#7c1619]" />
                <span className="hidden md:inline">Reviews</span>
                {pendingReviewCount && pendingReviewCount > 0 ? (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#7c1619] px-1 text-[10px] font-bold text-white">
                    {pendingReviewCount}
                  </span>
                ) : null}
              </Link>
              <Link
                href="/seller/messages"
                className="relative flex items-center gap-1.5 rounded-lg border border-[#eadbcf] bg-[#fffaf7] px-2.5 py-1.5 text-[#35110f] transition hover:bg-[#f8e9df]"
              >
                <Mail size={14} className="text-[#7c1619]" />
                <span className="hidden sm:inline">Messages</span>
                {unreadCount && unreadCount > 0 ? (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#7c1619] px-1 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                ) : null}
              </Link>
              <Link
                href="/seller/orders"
                className="flex items-center gap-1.5 rounded-lg border border-[#eadbcf] bg-[#fffaf7] px-2.5 py-1.5 text-[#35110f] transition hover:bg-[#f8e9df]"
              >
                <ShoppingBag size={14} className="text-[#7c1619]" />
                <span className="hidden sm:inline">Orders</span>
              </Link>
              <Link
                href="/seller/orders/new"
                className="flex items-center gap-1.5 rounded-lg bg-[#7c1619] px-3 py-1.5 text-white shadow-2xs transition hover:bg-[#631214]"
              >
                <PlusCircle size={14} />
                <span className="hidden sm:inline">New Sale</span>
              </Link>
            </nav>

            <form action={logout} className="border-l border-[#f0e7df] pl-2 sm:pl-3">
              <button
                type="submit"
                title={`Sign out (${user.email})`}
                className="inline-flex items-center gap-1 rounded-lg p-1.5 text-xs text-[#705a54] hover:bg-gray-100 hover:text-[#7c1619]"
              >
                <LogOut size={16} />
                <span className="hidden lg:inline">Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
