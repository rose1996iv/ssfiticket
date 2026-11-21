import { NextRequest } from "next/server";
import {
  handleMobileSellerOrdersGet,
  handleMobileSellerOrdersPost,
} from "@/lib/mobile/operations";

export async function GET(request: NextRequest) {
  return handleMobileSellerOrdersGet(request);
}

export async function POST(request: NextRequest) {
  return handleMobileSellerOrdersPost(request);
}
