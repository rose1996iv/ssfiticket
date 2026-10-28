"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { AdminSidebar } from "./AdminSidebar";
import { Logo } from "@/components/brand/Logo";

type Props = {
  userEmail: string;
  children: React.ReactNode;
};

export function AdminLayoutClient({ userEmail, children }: Props) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-[#fffaf7]">
      {/* Sidebar (Desktop and Mobile Drawer) */}
      <AdminSidebar
        userEmail={userEmail}
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile Header Bar */}
        <header className="flex h-16 items-center justify-between border-b border-[#e8d6c5] bg-white px-4 lg:hidden">
          <Link href="/admin" className="flex items-center gap-2">
            <Logo size="xs" />
            <span className="text-sm font-bold text-[#7c1619]">SSFI Admin</span>
          </Link>

          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="rounded-lg p-2 text-[#705a54] hover:bg-[#fffaf7] hover:text-[#7c1619]"
            aria-label="Open navigation menu"
          >
            <Menu size={22} />
          </button>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
