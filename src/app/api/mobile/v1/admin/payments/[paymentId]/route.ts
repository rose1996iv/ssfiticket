import { NextRequest } from "next/server";
import { handleMobileAdminPaymentDetailGet } from "@/lib/mobile/operations";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  const { paymentId } = await params;
  return handleMobileAdminPaymentDetailGet(request, paymentId);
}
