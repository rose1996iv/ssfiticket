import { NextRequest } from "next/server";
import { handleMobileAdminSummaryGet } from "@/lib/mobile/operations";

export async function GET(request: NextRequest) {
  return handleMobileAdminSummaryGet(request);
}
