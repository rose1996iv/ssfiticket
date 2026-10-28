import Link from "next/link";
import { requireAnyRole } from "@/lib/auth/server";
import { logout } from "@/server/actions/auth";

export const instant = false;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);
  return <main className="min-h-screen bg-[#fffaf7]"><header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-5 py-4"><Link href="/admin" className="font-bold text-[#7c1619]">SSFI Administration</Link><nav className="flex gap-4 text-sm"><Link href="/admin/payments">Payments</Link><Link href="/admin/orders">Orders</Link><Link href="/admin/tickets">Tickets</Link><Link href="/admin/customers">Customers</Link><Link href="/admin/sellers">Sellers</Link></nav><form action={logout}><button className="text-sm underline">Sign out · {user.email}</button></form></header><section className="mx-auto max-w-7xl p-5">{children}</section></main>;
}
