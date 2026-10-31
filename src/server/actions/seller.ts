"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import crypto from "node:crypto";
import { requireAnyRole, requireRole } from "@/lib/auth/server";
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
    // Note: The handle_new_user() trigger automatically inserts a public.profiles
    // row upon auth.users creation. We verify the created profile and ensure
    // any contact information (such as phone) is cleanly synchronized.
    const { data: profileRow } = await admin
      .from("profiles")
      .select("id, phone")
      .eq("id", userId)
      .maybeSingle();

    if (!profileRow) {
      // Fallback if the handle_new_user database trigger did not create the row
      const { error: insertError } = await admin.from("profiles").insert({
        id: userId,
        full_name: fullName,
        email,
        phone: phone || null,
        is_active: true,
      });

      if (insertError) {
        throw new Error(`Profile creation failed: ${insertError.message}`);
      }
    } else if (phone && profileRow.phone !== phone) {
      // Synchronize phone number if provided and differing from trigger default
      const { error: updateError } = await admin
        .from("profiles")
        .update({
          phone,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (updateError) {
        console.warn("[Seller Provisioning] Profile phone sync warning:", updateError.message);
      }
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

export type SellerLifecycleResult =
  | { success: true; message?: string }
  | { success: false; error: string };

/**
 * Deactivates an active seller:
 * - Requires SUPER_ADMIN, ADMIN, or FUNDRAISING_MANAGER.
 * - Sets public.sellers.is_active = false.
 * - Sets public.profiles.is_active = false.
 * - Suspends Auth user (ban_duration: '876000h') to block new logins and invalidate active sessions.
 * - Records an audit event.
 * - Preserves all existing orders, payments, tickets, and referral history.
 */
export async function deactivateSellerAccount(sellerId: string): Promise<SellerLifecycleResult> {
  const actor = await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);
  const admin = createSupabaseAdminClient();

  const { data: seller, error: sellerLookupErr } = await admin
    .from("sellers")
    .select("id, profile_id, seller_code, display_name, is_active")
    .eq("id", sellerId)
    .maybeSingle();

  if (sellerLookupErr || !seller) {
    return { success: false, error: "Seller record not found." };
  }

  if (!seller.is_active) {
    return { success: false, error: `Seller "${seller.seller_code}" is already inactive.` };
  }

  // 1. Transactional update to sellers table
  const { error: sellerUpdateErr } = await admin
    .from("sellers")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", sellerId);

  if (sellerUpdateErr) {
    return { success: false, error: `Failed to deactivate seller: ${sellerUpdateErr.message}` };
  }

  // 2. Update profile table
  await admin
    .from("profiles")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", seller.profile_id);

  // 3. Suspend Auth user to invalidate sessions and block sign-in
  try {
    await admin.auth.admin.updateUserById(seller.profile_id, {
      ban_duration: "876000h",
    });
  } catch (authBanErr) {
    console.warn("[Seller Deactivate Warning] Auth ban non-fatal error:", authBanErr);
  }

  // 4. Audit Log
  await admin.from("audit_logs").insert({
    actor_user_id: actor.id,
    action: "SELLER_DEACTIVATED",
    entity_type: "seller",
    entity_id: sellerId,
    metadata: {
      seller_code: seller.seller_code,
      display_name: seller.display_name,
      reason: "Administrative deactivation",
    },
  });

  revalidatePath("/admin/sellers");
  revalidatePath("/seller");

  return {
    success: true,
    message: `Seller ${seller.seller_code} (${seller.display_name}) deactivated successfully.`,
  };
}

/**
 * Reactivates an inactive seller:
 * - Requires SUPER_ADMIN, ADMIN, or FUNDRAISING_MANAGER.
 * - Restores public.sellers.is_active = true and public.profiles.is_active = true.
 * - Unbans the Auth user (ban_duration: 'none').
 * - Verifies the SELLER role is assigned.
 * - Records an audit event.
 */
export async function reactivateSellerAccount(sellerId: string): Promise<SellerLifecycleResult> {
  const actor = await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);
  const admin = createSupabaseAdminClient();

  const { data: seller, error: sellerLookupErr } = await admin
    .from("sellers")
    .select("id, profile_id, seller_code, display_name, is_active")
    .eq("id", sellerId)
    .maybeSingle();

  if (sellerLookupErr || !seller) {
    return { success: false, error: "Seller record not found." };
  }

  if (seller.is_active) {
    return { success: false, error: `Seller "${seller.seller_code}" is already active.` };
  }

  // 1. Verify SELLER role is present
  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", "SELLER")
    .single();

  if (roleRow) {
    const { data: prRow } = await admin
      .from("profile_roles")
      .select("role_id")
      .eq("profile_id", seller.profile_id)
      .eq("role_id", roleRow.id)
      .maybeSingle();

    if (!prRow) {
      await admin.from("profile_roles").insert({
        profile_id: seller.profile_id,
        role_id: roleRow.id,
      });
    }
  }

  // 2. Reactivate sellers record
  const { error: sellerUpdateErr } = await admin
    .from("sellers")
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq("id", sellerId);

  if (sellerUpdateErr) {
    return { success: false, error: `Failed to reactivate seller: ${sellerUpdateErr.message}` };
  }

  // 3. Reactivate profile record
  await admin
    .from("profiles")
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq("id", seller.profile_id);

  // 4. Lift Auth ban
  try {
    await admin.auth.admin.updateUserById(seller.profile_id, {
      ban_duration: "none",
    });
  } catch (authUnbanErr) {
    console.warn("[Seller Reactivate Warning] Auth unban non-fatal error:", authUnbanErr);
  }

  // 5. Audit Log
  await admin.from("audit_logs").insert({
    actor_user_id: actor.id,
    action: "SELLER_REACTIVATED",
    entity_type: "seller",
    entity_id: sellerId,
    metadata: {
      seller_code: seller.seller_code,
      display_name: seller.display_name,
    },
  });

  revalidatePath("/admin/sellers");
  revalidatePath("/seller");

  return {
    success: true,
    message: `Seller ${seller.seller_code} (${seller.display_name}) reactivated successfully.`,
  };
}

/**
 * Permanently deletes a seller record:
 * - STRICT: SUPER_ADMIN only.
 * - BLOCKS deletion if seller has any linked historical orders or tickets.
 * - Requires explicit confirmation matching the seller code.
 * - Deletes seller, removes SELLER role, and removes user/profile if no other roles exist.
 * - Records an audit event.
 */
export async function permanentlyDeleteSeller(
  sellerId: string,
  confirmationCode: string
): Promise<SellerLifecycleResult> {
  const actor = await requireRole("SUPER_ADMIN");
  const admin = createSupabaseAdminClient();

  const { data: seller, error: sellerLookupErr } = await admin
    .from("sellers")
    .select("id, profile_id, seller_code, display_name")
    .eq("id", sellerId)
    .maybeSingle();

  if (sellerLookupErr || !seller) {
    return { success: false, error: "Seller record not found." };
  }

  if (confirmationCode.trim().toUpperCase() !== seller.seller_code.trim().toUpperCase()) {
    return {
      success: false,
      error: `Confirmation code "${confirmationCode}" does not match required code "${seller.seller_code}".`,
    };
  }

  // Check foreign key dependencies
  const [ordersCheck, ticketsCheck] = await Promise.all([
    admin.from("orders").select("id", { count: "exact", head: true }).eq("seller_id", sellerId),
    admin.from("tickets").select("id", { count: "exact", head: true }).eq("seller_id", sellerId),
  ]);

  const orderCount = ordersCheck.count ?? 0;
  const ticketCount = ticketsCheck.count ?? 0;

  if (orderCount > 0 || ticketCount > 0) {
    return {
      success: false,
      error: `Permanent deletion blocked: Seller "${seller.seller_code}" has ${orderCount} associated order(s) and ${ticketCount} issued ticket(s). Deleting this record would corrupt historical business attribution. Please use Deactivate instead.`,
    };
  }

  // Check if user has other administrative roles
  const { data: otherRoles } = await admin
    .from("profile_roles")
    .select("role_id, roles(name)")
    .eq("profile_id", seller.profile_id);

  interface RoleRowItem {
    roles: { name: string } | null;
  }
  const hasStaffRole = ((otherRoles || []) as unknown as RoleRowItem[]).some((r) =>
    r.roles?.name ? ["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"].includes(r.roles.name) : false
  );

  // 1. Ensure historical messages have identity snapshots populated before FK is set to NULL
  try {
    await admin
      .from("seller_messages")
      .update({
        recipient_seller_code: seller.seller_code,
        recipient_display_name: seller.display_name,
      })
      .eq("recipient_seller_id", sellerId)
      .or("recipient_seller_code.is.null,recipient_display_name.is.null");
  } catch (snapshotErr) {
    console.warn("[Seller Delete Warning] Snapshot pre-fill warning:", snapshotErr);
  }

  // 2. Delete seller record (FK automatically sets recipient_seller_id = NULL on seller_messages without deleting history)
  const { error: sellerDelErr } = await admin
    .from("sellers")
    .delete()
    .eq("id", sellerId);

  if (sellerDelErr) {
    let friendlyError = sellerDelErr.message;
    if (sellerDelErr.code === "23503" || sellerDelErr.message.includes("foreign key")) {
      friendlyError = `Cannot delete seller: Dependent database records exist (${sellerDelErr.message}).`;
    }
    return { success: false, error: `Failed to delete seller record: ${friendlyError}` };
  }

  // 3. Remove SELLER role
  const { data: sellerRole } = await admin.from("roles").select("id").eq("name", "SELLER").single();
  if (sellerRole) {
    await admin
      .from("profile_roles")
      .delete()
      .eq("profile_id", seller.profile_id)
      .eq("role_id", sellerRole.id);
  }

  // 4. If user has no remaining staff roles, remove profile & auth user
  if (!hasStaffRole) {
    await admin.from("profiles").delete().eq("id", seller.profile_id);
    try {
      await admin.auth.admin.deleteUser(seller.profile_id);
    } catch (authDelErr) {
      console.warn("[Seller Delete Warning] Auth deletion non-fatal error:", authDelErr);
    }
  }

  // 5. Audit Log
  await admin.from("audit_logs").insert({
    actor_user_id: actor.id,
    action: "SELLER_PERMANENTLY_DELETED",
    entity_type: "seller",
    entity_id: sellerId,
    metadata: {
      seller_code: seller.seller_code,
      display_name: seller.display_name,
      deleted_by: actor.email,
    },
  });

  revalidatePath("/admin/sellers");
  revalidatePath("/admin/messages");
  revalidatePath("/admin");
  return { success: true, message: `Seller ${seller.seller_code} permanently deleted.` };
}
