"use server";

import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth/server";
import {
  executeAdminGmailPreviewTest,
  getGmailPreviewGateConfig,
  isGmailApiConfigured,
  getGmailApiConfig,
} from "@/lib/delivery/providers/gmail";

export type AdminGmailPreviewTestResult = {
  success: boolean;
  statusLabel: "Provider/API Accepted" | "Failed";
  operationId: string;
  recipient: string;
  providerMessageId?: string | null;
  error?: string | null;
  timestamp: string;
};

export type GmailPreviewGateStatus = {
  isVercelPreview: boolean;
  isRealSendEnabled: boolean;
  isConfigured: boolean;
  allowedRecipientMasked: string;
  senderAddress: string;
};

export async function getGmailPreviewGateStatusAction(): Promise<GmailPreviewGateStatus> {
  await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const gate = getGmailPreviewGateConfig();
  const config = getGmailApiConfig();
  const isConfigured = isGmailApiConfigured();

  let allowedRecipientMasked = "Not configured";
  if (gate.allowedRecipient) {
    const raw = gate.allowedRecipient.trim();
    allowedRecipientMasked = raw.replace(/^(.{2})(.*)(@.*)$/, "$1***$3");
  }

  return {
    isVercelPreview: gate.isVercelPreview,
    isRealSendEnabled: gate.isRealSendEnabled,
    isConfigured,
    allowedRecipientMasked,
    senderAddress: config.senderAddress,
  };
}

export async function sendAdminGmailPreviewTestAction(): Promise<AdminGmailPreviewTestResult> {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN"]);

  const result = await executeAdminGmailPreviewTest({
    actorUserId: user.id,
  });

  revalidatePath("/admin/campaign-settings");
  revalidatePath("/admin/orders");

  return {
    success: result.success,
    statusLabel: result.success ? "Provider/API Accepted" : "Failed",
    operationId: result.operationId,
    recipient: result.recipient,
    providerMessageId: result.providerMessageId,
    error: result.error,
    timestamp: result.timestamp,
  };
}
