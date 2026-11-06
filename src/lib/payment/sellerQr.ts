export const SELLER_PAYMENT_QR_BUCKET = "seller-payment-qrs";
export const MAX_SELLER_PAYMENT_QR_BYTES = 2 * 1024 * 1024; // 2 MiB

const signatures = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
} as const;

export type SellerPaymentQrType = keyof typeof signatures;

export function validateSellerPaymentQr(
  file: File,
  bytes: Uint8Array
): { contentType: SellerPaymentQrType; extension: string } {
  if (!Object.hasOwn(signatures, file.type)) {
    throw new Error("Please upload a valid JPEG, PNG, or WebP image.");
  }

  if (file.size < 1 || file.size > MAX_SELLER_PAYMENT_QR_BYTES) {
    throw new Error("The QR code image must be 2 MB or smaller.");
  }

  const contentType = file.type as SellerPaymentQrType;
  const valid = signatures[contentType].some((signature) =>
    signature.every((value, index) => bytes[index] === value)
  );

  if (!valid || (contentType === "image/webp" && String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP")) {
    throw new Error("The uploaded file content does not match its image format.");
  }

  return {
    contentType,
    extension: contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1],
  };
}
