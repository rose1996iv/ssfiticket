import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, LogOut, ShieldAlert, AlertTriangle, UserCheck } from "lucide-react";
import { logout } from "@/server/actions/auth";
import { Logo } from "@/components/brand/Logo";

export const instant = false;

type PageProps = {
  searchParams: Promise<{ reason?: string }>;
};

async function UnauthorizedMessage({ searchParams }: PageProps) {
  const { reason } = await searchParams;

  // Contextual configurations based on reason
  let badgeText = "Authorization Required";
  let title = "Access Restricted";
  let description =
    "Your account has been authenticated, but has not been assigned an active SSFI application role (e.g. SUPER_ADMIN, ADMIN, or SELLER).";
  let redirectTarget: { href: string; label: string } | null = null;
  let showNextSteps = true;
  let isAlert = false;

  if (reason === "seller_only") {
    badgeText = "Staff Role Detected";
    title = "Seller Workspace Restricted";
    description =
      "You are signed in with an Administrator account. The Seller Workspace is reserved for registered fundraisers and ticket sellers. Admin users cannot manage personal sales orders from the seller portal.";
    redirectTarget = { href: "/admin", label: "Go to Admin Dashboard" };
    showNextSteps = false;
  } else if (reason === "admin_only") {
    badgeText = "Seller Role Detected";
    title = "Administrative Privileges Required";
    description =
      "You are signed in as a registered Ticket Seller. The Admin Operations Dashboard requires administrative staff privileges (SUPER_ADMIN, ADMIN, or FUNDRAISING_MANAGER).";
    redirectTarget = { href: "/seller", label: "Go to Seller Workspace" };
    showNextSteps = false;
  } else if (reason === "seller_inactive") {
    badgeText = "Account Inactive";
    title = "Seller Account Deactivated";
    description =
      "Your seller account has been deactivated by an SSFI administrator. Ticket sales and new order submissions are currently disabled for this account.";
    showNextSteps = false;
    isAlert = true;
  }

  return (
    <>
      <div
        className={`mt-6 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
          isAlert ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-900"
        }`}
      >
        {isAlert ? (
          <AlertTriangle size={14} className="text-amber-700" />
        ) : redirectTarget ? (
          <UserCheck size={14} className="text-[#7c1619]" />
        ) : (
          <ShieldAlert size={14} className="text-red-700" />
        )}
        <span>{badgeText}</span>
      </div>

      <h1 className="mt-3 text-2xl font-bold text-[#35110f]">{title}</h1>
      <p className="mt-3 text-xs leading-relaxed text-[#705a54]">{description}</p>

      {/* Primary Role Redirect Button when legitimate role detected */}
      {redirectTarget && (
        <div className="mt-5">
          <Link
            href={redirectTarget.href}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7c1619] py-3 text-xs font-bold text-white shadow-xs transition hover:bg-[#631214]"
          >
            <span>{redirectTarget.label}</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      )}

      {/* Inactive Seller Help Box */}
      {reason === "seller_inactive" && (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-left text-xs text-amber-900">
          <p className="font-semibold text-amber-950">Need assistance?</p>
          <p className="mt-1 leading-relaxed text-amber-800">
            If your seller account was deactivated in error, please contact your SSFI fundraising coordinator or reach out to the administrative team to request account reactivation.
          </p>
        </div>
      )}

      {/* Default Next Steps Guide for Unassigned Accounts */}
      {showNextSteps && (
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
      )}
    </>
  );
}

function UnauthorizedFallback() {
  return (
    <>
      <div className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-red-900">
        <ShieldAlert size={14} className="text-red-700" />
        <span>Authorization Required</span>
      </div>
      <h1 className="mt-3 text-2xl font-bold text-[#35110f]">Access Restricted</h1>
      <p className="mt-3 text-xs leading-relaxed text-[#705a54]">
        Verifying account permissions...
      </p>
    </>
  );
}

export default function UnauthorizedPage({ searchParams }: PageProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fffaf7] px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center shadow-lg">
        <div className="mx-auto flex justify-center">
          <Logo size="lg" className="transition-transform hover:scale-105" />
        </div>

        <Suspense fallback={<UnauthorizedFallback />}>
          <UnauthorizedMessage searchParams={searchParams} />
        </Suspense>

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
