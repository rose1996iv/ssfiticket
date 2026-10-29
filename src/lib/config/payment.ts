const isVercelPreview =
  process.env.VERCEL_ENV === "preview" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview" ||
  process.env.NEXT_PUBLIC_MOCK_PAYMENTS === "true" ||
  process.env.MOCK_PAYMENTS === "true";

export const manualUpiConfig = {
  // In Preview or explicit mock mode, ensure no real UPI ID is exposed or used
  upiId: isVercelPreview
    ? "mock.ssfi.preview@upi"
    : (process.env.NEXT_PUBLIC_SSFI_UPI_ID ?? "Update payment configuration"),
  displayName: isVercelPreview
    ? "SSFI Fundraising (PREVIEW MOCK MODE)"
    : (process.env.NEXT_PUBLIC_SSFI_UPI_DISPLAY_NAME ?? "SSFI Fundraising"),
  instructions: isVercelPreview
    ? "PREVIEW TEST MODE: Do not send real money. Submit any test UTR reference (e.g. TEST12345678) to simulate payment."
    : "Pay the exact order amount, then submit the UTR/reference for administrator review.",
  qrImagePath: isVercelPreview ? undefined : process.env.NEXT_PUBLIC_SSFI_UPI_QR_PATH,
  isMock: isVercelPreview,
} as const;
