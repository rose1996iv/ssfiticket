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
  // In Preview or explicit mock mode, ensure no real UPI ID or live QR is exposed or used
  upiId: isMock
    ? "mock.ssfi.preview@upi"
    : (process.env.NEXT_PUBLIC_SSFI_UPI_ID ?? "6909251270@ptaxis"),
  displayName: isMock
    ? "SSFI Fundraising (PREVIEW MOCK MODE)"
    : (process.env.NEXT_PUBLIC_SSFI_UPI_DISPLAY_NAME ?? "HLAWN THA DAWT"),
  currency: "INR",
  supportEmail: "Senthangstudents@gmail.com",
  instructions: isMock
    ? "DEVELOPMENT / PREVIEW TEST MODE: Do not send real money. Use the simulated test controls to submit a mock payment."
    : "Pay the exact order amount via UPI App or scan the official QR code, then submit the 12-digit UTR reference below for administrator review.",
  qrImagePath: isMock ? undefined : (process.env.NEXT_PUBLIC_SSFI_UPI_QR_PATH ?? "/upi_qr.jpeg"),
  isMock,
} as const;
