import { NextRequest } from "next/server";
import { handleMobileTicketVerifyGet } from "@/lib/mobile/operations";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketNumber: string }> }
) {
  const { ticketNumber } = await params;
  return handleMobileTicketVerifyGet(request, ticketNumber);
}
