import { NextRequest } from "next/server";
import { handleMobileAdminPaymentDecisionPost } from "@/lib/mobile/operations";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  const { paymentId } = await params;
  return handleMobileAdminPaymentDecisionPost(request, paymentId);
}
