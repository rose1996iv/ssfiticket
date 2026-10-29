import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AppRole = "SUPER_ADMIN" | "ADMIN" | "FUNDRAISING_MANAGER" | "SELLER";

export async function getCurrentUser() {
  await connection();
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) return null;
  return user;
}

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function hasCurrentUserRole(role: AppRole): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("has_role", { p_user_id: user.id, p_role: role });

  if (error) {
    console.error(`[Auth] Database query error verifying role "${role}" for user ${user.id}:`, {
      code: error.code,
      message: error.message,
      hint: error.hint,
    });
    throw new Error(`Database query error while verifying role "${role}".`);
  }

  return data === true;
}

export async function hasAnyCurrentUserRole(roles: readonly AppRole[]): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const results = await Promise.all(roles.map((r) => hasCurrentUserRole(r)));
  return results.some(Boolean);
}

export async function requireRole(role: AppRole) {
  const user = await requireAuth();
  const hasRole = await hasCurrentUserRole(role);

  if (!hasRole) {
    if (role === "SELLER") {
      const isStaff = await hasAnyCurrentUserRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);
      if (isStaff) {
        redirect("/unauthorized?reason=seller_only");
      }
    }
    redirect("/unauthorized");
  }

  return user;
}

export async function requireAnyRole(roles: readonly AppRole[]) {
  const user = await requireAuth();
  const isAuthorized = await hasAnyCurrentUserRole(roles);

  if (!isAuthorized) {
    const isSeller = await hasCurrentUserRole("SELLER");
    if (isSeller) {
      redirect("/unauthorized?reason=admin_only");
    }
    redirect("/unauthorized");
  }

  return user;
}
