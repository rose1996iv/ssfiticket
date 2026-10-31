"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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
  const { data: authData, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    if (error.message.toLowerCase().includes("invalid login credentials")) {
      return {
        error:
          "Invalid email or password. If you are setting up administrator access for the first time, ensure the account is provisioned in Supabase Authentication and assigned the SUPER_ADMIN role.",
      };
    }
    return { error: error.message || "Unable to sign in with those credentials." };
  }

  // 1. Evaluate application roles in parallel
  const [isSuperAdmin, isAdmin, isManager, isSeller] = await Promise.all([
    hasCurrentUserRole("SUPER_ADMIN"),
    hasCurrentUserRole("ADMIN"),
    hasCurrentUserRole("FUNDRAISING_MANAGER"),
    hasCurrentUserRole("SELLER"),
  ]);

  // 2. Prioritize administrative and fundraising staff roles
  if (isSuperAdmin || isAdmin || isManager) {
    redirect("/admin");
  }

  // 3. Handle seller workspace routing
  if (isSeller) {
    if (authData?.user) {
      const admin = createSupabaseAdminClient();
      const { data: sellerRecord } = await admin
        .from("sellers")
        .select("id, is_active")
        .eq("profile_id", authData.user.id)
        .maybeSingle();

      if (sellerRecord && !sellerRecord.is_active) {
        await supabase.auth.signOut();
        return {
          error: "Your seller account has been deactivated. Please contact an SSFI administrator.",
        };
      }
    }
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
