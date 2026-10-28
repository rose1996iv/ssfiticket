import { connection } from "next/server";
import { requireAnyRole } from "@/lib/auth/server";
import { AdminLayoutClient } from "@/components/admin/AdminLayoutClient";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);

  return (
    <AdminLayoutClient userEmail={user.email ?? "Administrator"}>
      {children}
    </AdminLayoutClient>
  );
}
