import { NextRequest } from "next/server";
import { handleMobileFirstPrizeDualAuthPost } from "@/lib/mobile/operations";

export async function POST(request: NextRequest) {
  return handleMobileFirstPrizeDualAuthPost(request);
}
