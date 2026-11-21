import { NextRequest } from "next/server";
import { handleMobileSuperAdminOverviewGet } from "@/lib/mobile/operations";

export async function GET(request: NextRequest) {
  return handleMobileSuperAdminOverviewGet(request);
}
