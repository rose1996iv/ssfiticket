"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasCurrentUserRole } from "@/lib/auth/server";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });

export async function login(formData: FormData) {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) throw new Error("Enter a valid email address and password.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) throw new Error("Unable to sign in with those credentials.");
  if (await hasCurrentUserRole("SELLER")) redirect("/seller");
  if (await hasCurrentUserRole("SUPER_ADMIN") || await hasCurrentUserRole("ADMIN") || await hasCurrentUserRole("FUNDRAISING_MANAGER")) redirect("/admin");
  redirect("/unauthorized");
}

export async function logout() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
