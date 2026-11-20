import { NextRequest } from "next/server";
import { handleMobileMeGet } from "@/lib/auth/mobile";

export async function GET(request: NextRequest) {
  return handleMobileMeGet(request);
}
