import { NextRequest } from "next/server";
import { handleMobileSellerCustomerLookupGet } from "@/lib/mobile/operations";

export async function GET(request: NextRequest) {
  return handleMobileSellerCustomerLookupGet(request);
}
