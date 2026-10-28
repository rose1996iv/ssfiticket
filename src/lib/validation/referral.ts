import { z } from "zod";

export const SELLER_CODE_REGEX = /^SELLER-[0-9]{3,}$/i;

export const sellerCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(SELLER_CODE_REGEX, "Referral code must be in the format SELLER-XXX (e.g., SELLER-001).");

export type ActiveSellerInfo = {
  id: string;
  seller_code: string;
  display_name: string;
  is_active: boolean;
};

export type ReferralValidationResult =
  | { valid: true; seller: ActiveSellerInfo; error?: never }
  | { valid: false; seller?: never; error: string; code: "INVALID_FORMAT" | "NOT_FOUND" | "INACTIVE" };

/**
 * Validates syntax of a seller referral code without database lookup.
 */
export function validateReferralCodeSyntax(code: unknown): { valid: boolean; normalized?: string; error?: string } {
  const result = sellerCodeSchema.safeParse(code);
  if (!result.success) {
    const firstIssue = result.error.issues?.[0]?.message;
    return { valid: false, error: firstIssue || "Invalid seller code format." };
  }
  return { valid: true, normalized: result.data };
}

/**
 * Server-side lookup and validation of a seller referral code against the database.
 * Confirms that the seller exists and is currently active.
 */
export async function getActiveSellerByReferralCode(rawCode: unknown): Promise<ReferralValidationResult> {
  const syntaxCheck = validateReferralCodeSyntax(rawCode);
  if (!syntaxCheck.valid || !syntaxCheck.normalized) {
    return {
      valid: false,
      code: "INVALID_FORMAT",
      error: syntaxCheck.error ?? "Invalid referral code format. Codes look like SELLER-001.",
    };
  }

  const normalizedCode = syntaxCheck.normalized;
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("sellers")
    .select("id, seller_code, display_name, is_active")
    .eq("seller_code", normalizedCode)
    .maybeSingle();

  if (error || !data) {
    return {
      valid: false,
      code: "NOT_FOUND",
      error: `No registered seller found with referral code "${normalizedCode}".`,
    };
  }

  if (!data.is_active) {
    return {
      valid: false,
      code: "INACTIVE",
      error: `Seller account "${data.display_name}" (${normalizedCode}) is currently inactive.`,
    };
  }

  return {
    valid: true,
    seller: {
      id: data.id,
      seller_code: data.seller_code,
      display_name: data.display_name,
      is_active: data.is_active,
    },
  };
}
