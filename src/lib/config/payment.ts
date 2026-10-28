export const manualUpiConfig = {
  upiId: process.env.NEXT_PUBLIC_SSFI_UPI_ID ?? "Update payment configuration",
  displayName: process.env.NEXT_PUBLIC_SSFI_UPI_DISPLAY_NAME ?? "SSFI Fundraising",
  instructions: "Pay the exact order amount, then submit the UTR/reference for administrator review.",
  qrImagePath: process.env.NEXT_PUBLIC_SSFI_UPI_QR_PATH,
} as const;
