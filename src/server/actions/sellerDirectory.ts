import "server-only";
import QRCode from "qrcode";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getBaseAppUrl } from "@/lib/config/appUrl";

export type PublicSellerDto = {
  sellerCode: string;
  regionName: string;
  representativeName: string;
  contactNumber: string;
  referralPath: string;
  qrDataUrl: string;
};

/**
 * Retrieves the approved public seller directory.
 * Filters strictly to active sellers and extracts only public presentation fields:
 * Region Name (display_name), Representative Name (full_name), and Contact Number.
 * Generates an official branded QR code for each seller's referral link.
 *
 * Security & Privacy:
 * - Never returns profile_id, auth_id, emails, internal timestamps, or private admin notes.
 * - Inactive sellers are strictly excluded.
 */
export async function getPublicSellerDirectory(baseUrl?: string): Promise<PublicSellerDto[]> {
  try {
    const db = createSupabaseAdminClient();

    const { data: sellers, error } = await db
      .from("sellers")
      .select("id, seller_code, display_name, is_active, profiles(full_name, phone)")
      .eq("is_active", true)
      .order("seller_code", { ascending: true });

    if (error || !sellers) {
      console.error("[Seller Directory] Failed to fetch public sellers:", {
        code: error?.code,
        message: error?.message,
      });
      return [];
    }

    const cleanHost = getBaseAppUrl(baseUrl);

    const publicSellers: PublicSellerDto[] = await Promise.all(
      sellers.map(async (seller) => {
        const referralPath = `/buy?ref=${encodeURIComponent(seller.seller_code)}`;
        const fullReferralUrl = `${cleanHost}${referralPath}`;

        let qrDataUrl = "";
        try {
          qrDataUrl = await QRCode.toDataURL(fullReferralUrl, {
            width: 220,
            margin: 2,
            color: {
              dark: "#7c1619", // SSFI Maroon
              light: "#ffffff",
            },
          });
        } catch {
          // If QR generation fails, leave empty string
          qrDataUrl = "";
        }

        const profile = Array.isArray(seller.profiles) ? seller.profiles[0] : seller.profiles;

        return {
          sellerCode: seller.seller_code,
          regionName: seller.display_name || "Official SSFI Representative",
          representativeName: profile?.full_name || "SSFI Volunteer",
          contactNumber: profile?.phone || "",
          referralPath,
          qrDataUrl,
        };
      })
    );

    return publicSellers;
  } catch (err) {
    console.error("[Seller Directory] Unexpected exception:", err);
    return [];
  }
}

