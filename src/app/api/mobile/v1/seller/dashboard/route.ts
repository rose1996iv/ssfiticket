import { NextRequest } from "next/server";
import { handleMobileSellerDashboardGet } from "@/lib/mobile/operations";

export async function GET(request: NextRequest) {
  return handleMobileSellerDashboardGet(request);
}
