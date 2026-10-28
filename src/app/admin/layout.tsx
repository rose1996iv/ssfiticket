import { requireAnyRole } from "@/lib/auth/server";
import { AdminLayoutClient } from "@/components/admin/AdminLayoutClient";

export const instant = false;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);

  return (
    <AdminLayoutClient userEmail={user.email ?? "Administrator"}>
      {children}
    </AdminLayoutClient>
  );
}
