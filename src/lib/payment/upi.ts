import QRCode from "qrcode";

export type UpiPaymentDetails = {
  payeeVpa: string;        // pa: Payee virtual payment address / UPI ID
  payeeName: string;       // pn: Payee display name
  amountPaise: number;     // Authoritative order amount in paise
  orderNumber: string;     // tn: Transaction note (e.g. order number)
  transactionRef?: string; // tr: Unique transaction reference / tracking ID
  currency?: string;       // cu: Currency code (defaults to INR)
};

/**
 * Builds an RFC-compliant, standard upi://pay URI using URLSearchParams.
 * Guaranteed two-decimal formatting for amount (e.g. 10000 paise -> "100.00").
 */
export function buildUpiPaymentUri(details: UpiPaymentDetails): string {
  if (!details.payeeVpa || !details.payeeVpa.trim()) {
    throw new Error("Payee UPI ID (pa) is required.");
  }
  if (!details.payeeName || !details.payeeName.trim()) {
    throw new Error("Payee Name (pn) is required.");
  }
  if (details.amountPaise <= 0 || !Number.isFinite(details.amountPaise)) {
    throw new Error("Order amount must be a positive number.");
  }

  const params = new URLSearchParams();
  params.set("pa", details.payeeVpa.trim());
  params.set("pn", details.payeeName.trim());

  // Format amount strictly to two decimal places
  const formattedAmount = (details.amountPaise / 100).toFixed(2);
  params.set("am", formattedAmount);
  params.set("cu", (details.currency ?? "INR").trim().toUpperCase());
  params.set("tn", details.orderNumber.trim());

  if (details.transactionRef && details.transactionRef.trim()) {
    params.set("tr", details.transactionRef.trim());
  }

  // URLSearchParams encodes spaces as "+". Standard UPI intent readers across Android/iOS
  // prefer percent-encoded "%20" for payee names and notes.
  const queryString = params.toString().replace(/\+/g, "%20");

  return `upi://pay?${queryString}`;
}

/**
 * Parses a upi://pay URI and extracts its parameters for validation and testing.
 */
export function parseUpiPaymentUri(uri: string): {
  payeeVpa: string | null;
  payeeName: string | null;
  amount: string | null;
  amountPaise: number | null;
  currency: string | null;
  transactionNote: string | null;
  transactionRef: string | null;
} {
  if (!uri.startsWith("upi://pay?")) {
    throw new Error("Invalid UPI URI format. Must start with 'upi://pay?'.");
  }

  const queryString = uri.slice("upi://pay?".length);
  const params = new URLSearchParams(queryString);

  const am = params.get("am");
  let amountPaise: number | null = null;
  if (am) {
    const parsedFloat = parseFloat(am);
    if (!isNaN(parsedFloat)) {
      amountPaise = Math.round(parsedFloat * 100);
    }
  }

  return {
    payeeVpa: params.get("pa"),
    payeeName: params.get("pn"),
    amount: am,
    amountPaise,
    currency: params.get("cu"),
    transactionNote: params.get("tn"),
    transactionRef: params.get("tr"),
  };
}

/**
 * Generates a high-contrast PNG Data URL of an order-specific UPI payment QR code.
 * Uses high-contrast pure black on pure white with quiet zone for optimal mobile camera scanning.
 */
export async function generateUpiQrDataUrl(
  upiUri: string,
  options?: { width?: number; margin?: number }
): Promise<string> {
  return QRCode.toDataURL(upiUri, {
    width: options?.width ?? 320,
    margin: options?.margin ?? 2,
    errorCorrectionLevel: "M",
    color: {
      dark: "#000000", // High contrast black
      light: "#ffffff", // Pure white background
    },
  });
}

/**
 * Generates an SVG representation of an order-specific UPI payment QR code.
 */
export async function generateUpiQrSvg(
  upiUri: string,
  options?: { margin?: number }
): Promise<string> {
  return QRCode.toString(upiUri, {
    type: "svg",
    margin: options?.margin ?? 2,
    errorCorrectionLevel: "M",
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });
}

