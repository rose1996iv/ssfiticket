import { NextRequest } from "next/server";
import { handleMobileAdminAuditLogsGet } from "@/lib/mobile/operations";

export async function GET(request: NextRequest) {
  return handleMobileAdminAuditLogsGet(request);
}
