import Link from "next/link";
import { ArrowLeft, LogOut, ShieldAlert } from "lucide-react";
import { logout } from "@/server/actions/auth";
import { Logo } from "@/components/brand/Logo";

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fffaf7] px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center shadow-lg">
        <div className="mx-auto flex justify-center">
          <div className="rounded-2xl border border-[#eadbcf] bg-[#fffaf7] p-2.5">
            <Logo size="md" />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wider text-red-700">
          <ShieldAlert size={16} />
          <span>Authorization Required</span>
        </div>

        <h1 className="mt-2 text-2xl font-bold text-[#35110f]">Access Restricted</h1>
        <p className="mt-3 text-xs leading-relaxed text-[#705a54]">
          Your account has been authenticated, but has not been assigned an active SSFI application
          role (e.g. <b>SUPER_ADMIN</b>, <b>ADMIN</b>, or <b>SELLER</b>).
        </p>

        <div className="mt-6 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-left text-xs text-[#705a54]">
          <p className="font-semibold text-[#35110f]">Next steps:</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>
              If you are a newly registered administrator, run the role assignment script in the
              Supabase SQL Editor (see <code className="font-mono text-[11px]">supabase/provision_admin.sql</code>).
            </li>
            <li>If you are a ticket seller, contact the SSFI fundraising manager.</li>
          </ul>
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          <form action={logout}>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7c1619] py-3 text-xs font-bold text-white shadow-xs transition hover:bg-[#631214]"
            >
              <LogOut size={14} />
              <span>Sign out and switch account</span>
            </button>
          </form>

          <Link
            href="/"
            className="flex items-center justify-center gap-1.5 rounded-xl border border-[#eadbcf] py-3 text-xs font-semibold text-[#705a54] transition hover:bg-[#fffaf7]"
          >
            <ArrowLeft size={14} />
            <span>Return to SSFI Homepage</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
