import Link from "next/link";
import { requireRole } from "@/lib/auth/server";
import { logout } from "@/server/actions/auth";

export const instant = false;

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("SELLER");
  return <main className="min-h-screen bg-[#fffaf7]"><header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-5 py-4"><Link href="/seller" className="font-bold text-[#7c1619]">SSFI Seller</Link><nav className="flex gap-4 text-sm"><Link href="/seller/orders">My orders</Link><Link href="/seller/orders/new">New sale</Link></nav><form action={logout}><button className="text-sm underline">Sign out · {user.email}</button></form></header><section className="mx-auto max-w-6xl p-5">{children}</section></main>;
}
