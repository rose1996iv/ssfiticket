"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasCurrentUserRole } from "@/lib/auth/server";

const loginSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address."),
  password: z.string().min(6, "Password must be at least 6 characters."),
});

export type LoginResult = {
  error?: string;
};

export async function login(formData: FormData): Promise<LoginResult | void> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const msg = parsed.error.issues?.[0]?.message ?? "Please enter a valid email address and password.";
    return { error: msg };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    if (error.message.toLowerCase().includes("invalid login credentials")) {
      return {
        error:
          "Invalid email or password. If you are setting up administrator access for the first time, ensure the account is provisioned in Supabase Authentication and assigned the SUPER_ADMIN role.",
      };
    }
    return { error: error.message || "Unable to sign in with those credentials." };
  }

  // 1. Prioritize administrative and fundraising staff roles
  const isSuperAdmin = await hasCurrentUserRole("SUPER_ADMIN");
  const isAdmin = await hasCurrentUserRole("ADMIN");
  const isManager = await hasCurrentUserRole("FUNDRAISING_MANAGER");

  if (isSuperAdmin || isAdmin || isManager) {
    redirect("/admin");
  }

  // 2. Check for seller role
  const isSeller = await hasCurrentUserRole("SELLER");
  if (isSeller) {
    redirect("/seller");
  }

  // 3. User authenticated but lacks active application role
  redirect("/unauthorized");
}

export async function logout() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
