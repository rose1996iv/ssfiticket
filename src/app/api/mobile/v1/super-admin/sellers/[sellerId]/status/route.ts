import { NextRequest } from "next/server";
import { handleMobileSuperAdminSellerStatusPost } from "@/lib/mobile/operations";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> }
) {
  const { sellerId } = await params;
  return handleMobileSuperAdminSellerStatusPost(request, sellerId);
}
