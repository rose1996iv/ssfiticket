import { NextRequest } from "next/server";
import { handleMobileSellerOrderDetailGet } from "@/lib/mobile/operations";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  return handleMobileSellerOrderDetailGet(request, orderId);
}
