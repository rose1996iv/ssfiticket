/**
 * SSFI Lucky Draw — UPI Payment Configuration
 *
 * Official Production Payment Details:
 * Payee Name: HLAWN THA DAWT
 * UPI ID: 6909251270@ptaxis
 * Currency: INR
 * Support Email: Senthangstudents@gmail.com
 * Official QR Image: /upi_qr.jpeg
 */

export function isMockPaymentMode(): boolean {
  // Explicit override takes highest precedence (allows testing live or mock locally)
  if (process.env.NEXT_PUBLIC_MOCK_PAYMENTS === "false" || process.env.MOCK_PAYMENTS === "false") {
    return false;
  }
  if (process.env.NEXT_PUBLIC_MOCK_PAYMENTS === "true" || process.env.MOCK_PAYMENTS === "true") {
    return true;
  }
  // Vercel Preview deployments are always isolated in mock mode
  if (
    process.env.VERCEL_ENV === "preview" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview"
  ) {
    return true;
  }
  // Local development defaults to mock mode for safety unless explicitly overridden
  if (process.env.NODE_ENV === "development") {
    return true;
  }
  return false;
}

const isMock = isMockPaymentMode();

export const manualUpiConfig = {
  // Real official UPI ID & Payee Name (displayed for accurate camera inspection)
  upiId: process.env.NEXT_PUBLIC_SSFI_UPI_ID ?? "6909251270@ptaxis",
  displayName: process.env.NEXT_PUBLIC_SSFI_UPI_DISPLAY_NAME ?? "HLAWN THA DAWT",
  currency: "INR",
  supportEmail: "Senthangstudents@gmail.com",
  instructions: isMock
    ? "PREVIEW INSPECTION MODE: The official QR is displayed below for scannability testing only. Do NOT send real money for test orders. Use the simulated test controls below to test payment submission."
    : "Pay the exact order amount via UPI App or scan the official QR code, then submit the 12-digit transaction UTR reference below for administrator review.",
  // Official static QR asset is accessible in both environments so owner can inspect layout & scannability
  qrImagePath: process.env.NEXT_PUBLIC_SSFI_UPI_QR_PATH ?? "/upi_qr.jpeg",
  isMock,
} as const;
