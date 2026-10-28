"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import crypto from "node:crypto";
import { requireAnyRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SELLER_CODE_REGEX } from "@/lib/validation/referral";

const createSellerSchema = z.object({
  fullName: z.string().trim().min(2, "Full name must be at least 2 characters.").max(120),
  displayName: z.string().trim().min(2, "Display name must be at least 2 characters.").max(120),
  email: z.string().trim().toLowerCase().email("Please enter a valid email address."),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+ -]{7,20}$/, "Please enter a valid phone number (7-20 digits).")
    .optional()
    .or(z.literal("")),
  sellerCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(SELLER_CODE_REGEX, "Code must match SELLER-XXX format (e.g. SELLER-001).")
    .optional()
    .or(z.literal("")),
  temporaryPassword: z
    .string()
    .min(8, "Temporary password must be at least 8 characters.")
    .max(100)
    .optional()
    .or(z.literal("")),
});

export type CreateSellerResult =
  | {
      success: true;
      seller: {
        id: string;
        sellerCode: string;
        displayName: string;
        email: string;
        temporaryPassword: string;
        activationLink: string | null;
      };
      error?: never;
    }
  | {
      success: false;
      seller?: never;
      error: string;
    };

/**
 * Computes the next sequential seller code (e.g. SELLER-001, SELLER-002...)
 * based on all existing records in public.sellers.
 */
async function getNextSellerCode(): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data: existingSellers, error } = await admin
    .from("sellers")
    .select("seller_code");

  if (error || !existingSellers || existingSellers.length === 0) {
    return "SELLER-001";
  }

  let maxNum = 0;
  for (const s of existingSellers) {
    const match = s.seller_code.match(/^SELLER-([0-9]+)$/i);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  const nextNum = maxNum + 1;
  return `SELLER-${String(nextNum).padStart(3, "0")}`;
}

/**
 * Secure administrator action to provision a new Seller account:
 * 1. Verifies caller has SUPER_ADMIN, ADMIN, or FUNDRAISING_MANAGER role.
 * 2. Creates the Supabase Auth user via Admin API (email auto-confirmed).
 * 3. Ensures public.profiles has full_name, email, and phone.
 * 4. Links the SELLER role in public.profile_roles.
 * 5. Creates the seller attribution record in public.sellers with unique referral code.
 * 6. Handles partial failures with safe automatic rollback.
 */
export async function createSellerAccount(
  rawInput: Record<string, unknown>
): Promise<CreateSellerResult> {
  // 1. Strict Server-Side Administrator Role Verification
  await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);

  // 2. Validate input schema
  const parsed = createSellerSchema.safeParse(rawInput);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues?.[0]?.message;
    return { success: false, error: firstIssue || "Invalid seller account input." };
  }

  const { fullName, displayName, email, phone, sellerCode, temporaryPassword } = parsed.data;
  const admin = createSupabaseAdminClient();

  // 3. Determine and check seller referral code
  let finalCode = sellerCode;
  if (!finalCode) {
    finalCode = await getNextSellerCode();
  }

  // Verify seller code uniqueness
  const { data: codeConflict } = await admin
    .from("sellers")
    .select("id")
    .eq("seller_code", finalCode)
    .maybeSingle();

  if (codeConflict) {
    return {
      success: false,
      error: `Referral code "${finalCode}" is already assigned to another seller.`,
    };
  }

  // 4. Verify email uniqueness across profiles
  const { data: emailConflict } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (emailConflict) {
    return {
      success: false,
      error: `An account with email "${email}" already exists.`,
    };
  }

  // 5. Generate secure temporary password if not provided
  const generatedPassword =
    temporaryPassword ||
    `Ssfi!${crypto.randomBytes(6).toString("hex")}`;

  // 6. Create Supabase Auth User via service-role Admin API
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: generatedPassword,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      phone: phone || null,
    },
  });

  if (authError || !authData.user) {
    return {
      success: false,
      error: authError?.message || "Failed to create authentication user in Supabase.",
    };
  }

  const userId = authData.user.id;

  try {
    // 7. Ensure profile is fully populated with contact information
    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: userId,
        full_name: fullName,
        email,
        phone: phone || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (profileError) {
      throw new Error(`Profile creation failed: ${profileError.message}`);
    }

    // 8. Retrieve the SELLER role ID
    const { data: roleRow, error: roleError } = await admin
      .from("roles")
      .select("id")
      .eq("name", "SELLER")
      .single();

    if (roleError || !roleRow) {
      throw new Error("System role 'SELLER' is missing from public.roles table.");
    }

    // 9. Assign the SELLER role in public.profile_roles
    const { error: prError } = await admin.from("profile_roles").insert({
      profile_id: userId,
      role_id: roleRow.id,
    });

    if (prError) {
      throw new Error(`Role assignment failed: ${prError.message}`);
    }

    // 10. Create the seller record in public.sellers
    const { data: sellerRow, error: sellerError } = await admin
      .from("sellers")
      .insert({
        profile_id: userId,
        seller_code: finalCode,
        display_name: displayName,
        is_active: true,
      })
      .select("id, seller_code, display_name, is_active, created_at")
      .single();

    if (sellerError || !sellerRow) {
      throw new Error(`Seller record creation failed: ${sellerError?.message}`);
    }

    // 11. Generate an initial password recovery/activation link if email service is active
    let activationLink: string | null = null;
    try {
      const { data: linkData } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
      });
      activationLink = linkData?.properties?.action_link || null;
    } catch {
      // Non-fatal if email provider or link generation encounters an issue
    }

    revalidatePath("/admin/sellers");

    return {
      success: true,
      seller: {
        id: sellerRow.id,
        sellerCode: sellerRow.seller_code,
        displayName: sellerRow.display_name,
        email,
        temporaryPassword: generatedPassword,
        activationLink,
      },
    };
  } catch (err: unknown) {
    // 12. Safe Rollback: Clean up any partially created records to avoid orphans
    console.error("[Create Seller Rollback Triggered]", err);
    try {
      await admin.from("sellers").delete().eq("profile_id", userId);
      await admin.from("profile_roles").delete().eq("profile_id", userId);
      await admin.from("profiles").delete().eq("id", userId);
      await admin.auth.admin.deleteUser(userId);
    } catch (cleanupErr) {
      console.error("[Create Seller Cleanup Error]", cleanupErr);
    }

    const message = err instanceof Error ? err.message : "Failed to complete seller provisioning.";
    return {
      success: false,
      error: message,
    };
  }
}
