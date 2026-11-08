import { connection } from "next/server";
import { requireAnyRole } from "@/lib/auth/server";
import { getDrawOverview } from "@/server/actions/luckyDraw";
import { LuckyDrawDashboard } from "@/components/admin/draw/LuckyDrawDashboard";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";

export default async function LuckyDrawAdminPage() {
  await connection();
  await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const res = await getDrawOverview();

  if (!res.success || !res.data) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-900 shadow-xs">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-lg font-bold text-red-900">Failed to Load Lucky Draw Session</h2>
              <p className="text-sm text-red-700 mt-1">
                {res.error || "Could not retrieve draw configuration or campaign data."}
              </p>
              <div className="mt-4 flex items-center gap-3">
                <Link
                  href="/admin"
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  Return to Dashboard
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <LuckyDrawDashboard initialData={res.data} />;
}
