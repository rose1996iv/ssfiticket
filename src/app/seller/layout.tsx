import Link from "next/link";
import { connection } from "next/server";
import { requireRole } from "@/lib/auth/server";
import { logout } from "@/server/actions/auth";
import { Logo } from "@/components/brand/Logo";
import { LogOut, PlusCircle, ShoppingBag } from "lucide-react";

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const user = await requireRole("SELLER");

  return (
    <div className="min-h-screen bg-[#fffaf7]">
      {/* Branded Header */}
      <header className="border-b border-[#e8d6c5] bg-white sticky top-0 z-30 shadow-2xs">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link href="/seller" className="group flex items-center gap-3">
            <Logo size="sm" className="transition-transform group-hover:scale-105" />
            <div>
              <span className="text-sm font-bold tracking-tight text-[#7c1619]">SSFI Seller</span>
              <span className="hidden text-xs text-[#705a54] sm:inline"> · Partner Portal</span>
            </div>
          </Link>

          <div className="flex items-center gap-3 sm:gap-4">
            <nav className="flex items-center gap-2 sm:gap-3 text-xs font-semibold">
              <Link
                href="/seller/orders"
                className="flex items-center gap-1.5 rounded-lg border border-[#eadbcf] bg-[#fffaf7] px-3 py-2 text-[#35110f] transition hover:bg-[#f8e9df]"
              >
                <ShoppingBag size={14} className="text-[#7c1619]" />
                <span className="hidden sm:inline">My Orders</span>
              </Link>
              <Link
                href="/seller/orders/new"
                className="flex items-center gap-1.5 rounded-lg bg-[#7c1619] px-3 py-2 text-white shadow-2xs transition hover:bg-[#631214]"
              >
                <PlusCircle size={14} />
                <span>New Sale</span>
              </Link>
            </nav>

            <form action={logout} className="border-l border-[#f0e7df] pl-3 sm:pl-4">
              <button
                type="submit"
                title={`Sign out (${user.email})`}
                className="inline-flex items-center gap-1 rounded-lg p-2 text-xs text-[#705a54] hover:bg-gray-100 hover:text-[#7c1619]"
              >
                <LogOut size={16} />
                <span className="hidden md:inline">Sign out</span>
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
