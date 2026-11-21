import { NextRequest } from "next/server";
import { handleMobileAdminLookupGet } from "@/lib/mobile/operations";

export async function GET(request: NextRequest) {
  return handleMobileAdminLookupGet(request);
}
