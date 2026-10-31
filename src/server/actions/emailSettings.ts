"use server";

import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth/server";
import {
  getCustomerEmailSettings,
  updateCustomerEmailLiveGate,
  updateCustomerEmailEventToggles,
  getCustomerEmailMetrics,
  getRecentCustomerEmailLogs,
  retryFailedEmailJob,
  executeAdminCustomerTestEmail,
  type CustomerEmailSettings,
  type CustomerEmailMetrics,
  type CustomerEmailLogItem,
} from "@/lib/delivery/outbox";
import {
  checkGmailOAuthHealth,
  getGmailApiConfig,
  isGmailApiConfigured,
  type GmailOAuthHealth,
} from "@/lib/delivery/providers/gmail";

export type AdminCustomerEmailDashboardData = {
  environment: string;
  senderAddress: string;
  isOAuthConfigured: boolean;
  settings: CustomerEmailSettings;
  metrics: CustomerEmailMetrics;
  recentLogs: CustomerEmailLogItem[];
};

/**
 * Fetches dashboard data for the Production Customer Transactional Email section.
 * Restricted to verified SUPER_ADMIN and ADMIN roles.
 */
export async function getAdminCustomerEmailDashboardData(): Promise<AdminCustomerEmailDashboardData> {
  await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const environment =
    process.env.VERCEL_ENV ||
    process.env.NEXT_PUBLIC_VERCEL_ENV ||
    process.env.NODE_ENV ||
    "development";

  const config = getGmailApiConfig();
  const isOAuthConfigured = isGmailApiConfigured();
  const settings = await getCustomerEmailSettings();
  const metrics = await getCustomerEmailMetrics();
  const recentLogs = await getRecentCustomerEmailLogs(15);

  return {
    environment,
    senderAddress: config.senderAddress,
    isOAuthConfigured,
    settings,
    metrics,
    recentLogs,
  };
}

/**
 * Toggles the master live customer email sending gate in Production.
 * Enforces confirmation code when enabling live customer email delivery.
 */
export async function toggleAdminCustomerEmailLiveGate(
  enabled: boolean,
  confirmCode?: string
): Promise<{ success: boolean; error?: string }> {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const result = await updateCustomerEmailLiveGate(enabled, confirmCode, user.id);
  revalidatePath("/admin/campaign-settings");
  return result;
}

/**
 * Toggles individual customer email notification events (Order Created, Payment Approved, Tickets Issued).
 */
export async function toggleAdminCustomerEmailEvents(events: {
  ORDER_CREATED?: boolean;
  PAYMENT_APPROVED?: boolean;
  TICKETS_ISSUED?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const result = await updateCustomerEmailEventToggles(events, user.id);
  revalidatePath("/admin/campaign-settings");
  return result;
}

/**
 * Manually retries a failed or retrying email job from the outbox.
 */
export async function retryAdminCustomerEmailJob(
  jobId: string
): Promise<{ success: boolean; error?: string }> {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const result = await retryFailedEmailJob(jobId, user.id);
  revalidatePath("/admin/campaign-settings");
  return result;
}

/**
 * Triggers an official administrative test email for customer service verification.
 */
export async function triggerAdminCustomerTestEmail(
  targetEmail: string
): Promise<{ success: boolean; message: string; jobId?: string; error?: string }> {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const result = await executeAdminCustomerTestEmail(user.id, targetEmail);
  revalidatePath("/admin/campaign-settings");
  return result;
}

/**
 * Inspects Google OAuth connection health, scopes, and sender identity.
 * Strictly sanitizes error messages without exposing client secrets or access tokens.
 */
export async function checkAdminGmailOAuthHealthAction(): Promise<GmailOAuthHealth> {
  await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);
  return await checkGmailOAuthHealth();
}

