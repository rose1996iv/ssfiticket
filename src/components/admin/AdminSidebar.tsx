"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  LayoutDashboard,
  LogOut,
  QrCode,
  ShoppingBag,
  Ticket,
  Users,
  X,
} from "lucide-react";
import { logout } from "@/server/actions/auth";
import { Logo } from "@/components/brand/Logo";

type Props = {
  userEmail: string;
  isOpen: boolean;
  onClose: () => void;
};

const navItems = [
  { href: "/admin", label: "Operations Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/payments", label: "Pending Payments", icon: Banknote },
  { href: "/admin/orders", label: "Orders Directory", icon: ShoppingBag },
  { href: "/admin/tickets", label: "Issued Tickets", icon: Ticket },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/sellers", label: "Sellers & QR Codes", icon: QrCode },
];

export function AdminSidebar({ userEmail, isOpen, onClose }: Props) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          role="presentation"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs lg:hidden"
        />
      )}

      {/* Sidebar container */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-[#e8d6c5] bg-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand Header */}
        <div className="flex h-20 items-center justify-between border-b border-[#f0e7df] px-6">
          <Link href="/admin" className="flex items-center gap-3">
            <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-1.5 shadow-xs">
              <Logo size="xs" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-tight text-[#7c1619]">SSFI Admin</span>
              <span className="text-[11px] font-medium text-[#705a54]">Lucky Draw Portal</span>
            </div>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 lg:hidden"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-6">
          <p className="px-3 pb-2 text-[10px] font-bold tracking-widest uppercase text-[#705a54]">
            Management
          </p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-xl px-3.5 py-3 text-xs font-semibold transition ${
                  isActive
                    ? "bg-[#7c1619] text-white shadow-xs"
                    : "text-[#594541] hover:bg-[#fffaf7] hover:text-[#7c1619]"
                }`}
              >
                <Icon size={18} className={isActive ? "text-white" : "text-[#7c1619]"} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User Profile & Sign Out Footer */}
        <div className="border-t border-[#f0e7df] bg-[#fffaf7] p-4">
          <div className="mb-3 px-2">
            <span className="inline-block rounded-full bg-[#fceeee] px-2 py-0.5 text-[10px] font-bold uppercase text-[#a41f23]">
              Staff
            </span>
            <p className="mt-1 truncate font-mono text-xs font-semibold text-[#35110f]" title={userEmail}>
              {userEmail}
            </p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#eadbcf] bg-white px-3 py-2.5 text-xs font-bold text-[#7c1619] shadow-2xs transition hover:bg-red-50"
            >
              <LogOut size={14} />
              <span>Sign out</span>
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
