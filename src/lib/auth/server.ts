import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AppRole = "SUPER_ADMIN" | "ADMIN" | "FUNDRAISING_MANAGER" | "SELLER";

export async function getCurrentUser() {
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

export async function hasCurrentUserRole(role: AppRole) {
  const user = await getCurrentUser();
  if (!user) return false;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("has_role", { p_user_id: user.id, p_role: role });
  return !error && data === true;
}

export async function requireRole(role: AppRole) {
  const user = await requireAuth();
  if (!(await hasCurrentUserRole(role))) redirect("/unauthorized");
  return user;
}

export async function requireAnyRole(roles: readonly AppRole[]) {
  const user = await requireAuth();
  for (const role of roles) if (await hasCurrentUserRole(role)) return user;
  redirect("/unauthorized");
}
