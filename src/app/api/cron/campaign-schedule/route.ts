import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Background Cron Route for Campaign Schedule Synchronization
 * Triggered by pg_cron, Vercel Cron, GitHub Actions, or external monitoring pings.
 * Automatically executes DRAFT -> ACTIVE (on start_at) and ACTIVE -> CLOSED (on end_at).
 */
export async function GET(request: NextRequest) {
  return handleCronExecution(request);
}

export async function POST(request: NextRequest) {
  return handleCronExecution(request);
}

async function handleCronExecution(request: NextRequest) {
  const isProduction = process.env.NODE_ENV === "production";
  const expectedSecret = process.env.CRON_SECRET;

  // In production, CRON_SECRET is strictly mandatory to prevent unauthorized triggers
  if (isProduction && !expectedSecret) {
    console.error("[Cron Campaign Schedule Security] CRON_SECRET is mandatory in production but is not configured.");
    return NextResponse.json(
      { error: "Server misconfiguration: CRON_SECRET is required in production." },
      { status: 500 }
    );
  }

  // Security barrier via CRON_SECRET header (Bearer token or x-cron-secret)
  if (expectedSecret) {
    const authHeader = request.headers.get("authorization");
    const xCronSecret = request.headers.get("x-cron-secret");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const isAuthorized = bearerToken === expectedSecret || xCronSecret === expectedSecret;

    if (!isAuthorized) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or missing cron secret." },
        { status: 401 }
      );
    }
  }

  const admin = createSupabaseAdminClient();

  try {
    const { data, error } = await admin.rpc("process_scheduled_campaign_transitions");

    if (error) {
      console.error("[Cron Campaign Schedule Diagnostic] RPC failure:", {
        code: error.code,
        message: error.message,
      });
      return NextResponse.json(
        { error: "Failed to process scheduled campaign transitions.", details: error.message },
        { status: 500 }
      );
    }

    const payload = data as {
      processed_at?: string;
      transition_count?: number;
      transitions?: Array<{ campaign_id: string; public_id: string; from: string; to: string; reason: string }>;
    } | null;

    const transitionCount = Number(payload?.transition_count ?? 0);

    if (transitionCount > 0) {
      revalidatePath("/admin/campaign-settings");
      revalidatePath("/buy");
      revalidatePath("/seller");
      revalidatePath("/seller/orders/new");
    }

    return NextResponse.json({
      success: true,
      processedAt: payload?.processed_at ?? new Date().toISOString(),
      transitionCount,
      transitions: payload?.transitions ?? [],
    });
  } catch (err: unknown) {
    console.error("[Cron Campaign Schedule Diagnostic] Unexpected exception:", err);
    return NextResponse.json(
      { error: "Internal server error during scheduled campaign sync." },
      { status: 500 }
    );
  }
}
