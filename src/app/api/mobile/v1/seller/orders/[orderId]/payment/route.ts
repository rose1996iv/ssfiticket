import { NextRequest } from "next/server";
import { handleMobileSellerOrderPaymentSubmitPost } from "@/lib/mobile/operations";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  return handleMobileSellerOrderPaymentSubmitPost(request, orderId);
}
