import { NextRequest } from "next/server";
import { handleMobileAdminPaymentsGet } from "@/lib/mobile/operations";

export async function GET(request: NextRequest) {
  return handleMobileAdminPaymentsGet(request);
}
