import QRCode from "qrcode";

/**
 * Returns the canonical public referral URL for a seller.
 * Example: https://ssfiticket.vercel.app/buy?ref=SELLER-001
 */
export function getSellerReferralUrl(sellerCode: string, origin?: string): string {
  const cleanCode = sellerCode.trim().toUpperCase();
  const base = (
    origin ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://ssfiticket.vercel.app"
  ).replace(/\/+$/, "");

  return `${base}/buy?ref=${encodeURIComponent(cleanCode)}`;
}

/**
 * Generates a high-resolution PNG data URL for the given text/URL.
 * Suitable for rendering in <img> tags and downloading as PNG.
 */
export async function generateQrDataUrl(
  text: string,
  options?: { width?: number; margin?: number; color?: { dark?: string; light?: string } }
): Promise<string> {
  return QRCode.toDataURL(text, {
    width: options?.width ?? 400,
    margin: options?.margin ?? 2,
    color: {
      dark: options?.color?.dark ?? "#7c1619", // SSFI primary maroon
      light: options?.color?.light ?? "#ffffff",
    },
    errorCorrectionLevel: "M",
  });
}

/**
 * Generates an SVG string for scalable rendering.
 */
export async function generateQrSvg(
  text: string,
  options?: { margin?: number; color?: { dark?: string; light?: string } }
): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    margin: options?.margin ?? 2,
    color: {
      dark: options?.color?.dark ?? "#7c1619",
      light: options?.color?.light ?? "#ffffff",
    },
    errorCorrectionLevel: "M",
  });
}
