import { NextRequest } from "next/server";
import { handleMobileCustomerDashboardGet } from "@/lib/mobile/operations";

export async function GET(request: NextRequest) {
  return handleMobileCustomerDashboardGet(request);
}
