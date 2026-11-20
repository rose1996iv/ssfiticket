import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { resolveEnvironmentAppUrl } from "@/lib/config/appUrl";
import { getTicketVerificationUrl } from "@/lib/ticket/qr";

const VALID_TICKET_NUMBER_RE = /^[A-Z0-9-]{4,32}$/;

/**
 * Public, PII-free PNG QR code endpoint for ticket verification links.
 * Used by transactional ticket emails (Gmail strips data:image/png;base64 URIs,
 * so HTTPS PNG images ensure reliable QR rendering in Gmail Inbox).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ ticketNumber: string }> }
) {
  const { ticketNumber } = await context.params;
  const cleanNumber = decodeURIComponent(ticketNumber || "").trim().toUpperCase();

  if (!VALID_TICKET_NUMBER_RE.test(cleanNumber)) {
    return NextResponse.json(
      { error: "Invalid ticket number format." },
      { status: 400 }
    );
  }

  const requestOrigin = request.nextUrl?.origin;
  const { baseUrl } = resolveEnvironmentAppUrl(requestOrigin);
  const verificationUrl = getTicketVerificationUrl(cleanNumber, baseUrl);

  try {
    const pngBuffer = await QRCode.toBuffer(verificationUrl, {
      type: "png",
      width: 220,
      margin: 2,
      color: {
        dark: "#7c1619",
        light: "#ffffff",
      },
      errorCorrectionLevel: "M",
    });

    return new NextResponse(new Uint8Array(pngBuffer), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to generate ticket QR code." },
      { status: 500 }
    );
  }
}
