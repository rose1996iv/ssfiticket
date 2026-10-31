import { z } from "zod";
import { fromIstDatetimeLocalToIso } from "../date/timezone.ts";

export const allowedStatuses = ["DRAFT", "ACTIVE", "PAUSED", "CLOSED", "CANCELLED"] as const;
export type CampaignStatus = (typeof allowedStatuses)[number];

export type CampaignActionResponse = {
  success: boolean;
  message?: string;
  error?: string;
};

export const scheduleSchema = z.object({
  campaignId: z.string().min(1, "Campaign ID cannot be empty.").optional().nullable(),
  publicId: z.string().min(1, "Campaign public identifier cannot be empty.").optional().nullable(),
  startAt: z.string().nullable().optional().or(z.literal("")),
  endAt: z.string().nullable().optional().or(z.literal("")),
});

export const statusSchema = z.object({
  campaignId: z.string().min(1, "Campaign ID cannot be empty.").optional().nullable(),
  publicId: z.string().min(1, "Campaign public identifier cannot be empty.").optional().nullable(),
  status: z.enum(allowedStatuses, { error: "Invalid campaign status." }),
  confirmCode: z.string().nullable().optional(),
});

/**
 * Validates campaign status lifecycle transition inputs.
 * Returns structured validation results rather than throwing unexpected runtime exceptions.
 */
export function validateCampaignStatusPayload(raw: unknown): {
  valid: boolean;
  data?: {
    campaignId?: string | null;
    publicId?: string | null;
    status: CampaignStatus;
    confirmCode?: string | null;
  };
  error?: string;
} {
  const parsed = statusSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      error: parsed.error.issues[0]?.message ?? "Invalid campaign status.",
    };
  }

  const { status, confirmCode } = parsed.data;

  if (status === "CLOSED") {
    if (!confirmCode || confirmCode.trim().toUpperCase() !== "CLOSE") {
      return {
        valid: false,
        error: "To close the campaign, you must type 'CLOSE' in the confirmation box.",
      };
    }
  }

  if (status === "CANCELLED") {
    if (!confirmCode || confirmCode.trim().toUpperCase() !== "CANCEL") {
      return {
        valid: false,
        error: "To cancel the campaign, you must type 'CANCEL' in the confirmation box.",
      };
    }
  }

  return {
    valid: true,
    data: parsed.data,
  };
}

/**
 * Validates campaign opening and closing schedule inputs.
 * Handles null, empty, and ISO representations cleanly without throwing.
 */
export function validateCampaignSchedulePayload(raw: unknown): {
  valid: boolean;
  data?: {
    campaignId?: string | null;
    publicId?: string | null;
    startIso: string | null;
    endIso: string | null;
  };
  error?: string;
} {
  const parsed = scheduleSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      error: parsed.error.issues[0]?.message ?? "Invalid schedule input.",
    };
  }

  const startIso = fromIstDatetimeLocalToIso(parsed.data.startAt);
  const endIso = fromIstDatetimeLocalToIso(parsed.data.endAt);

  if (startIso && endIso) {
    const startTime = new Date(startIso).getTime();
    const endTime = new Date(endIso).getTime();
    if (endTime <= startTime) {
      return {
        valid: false,
        error: "Closing date and time must be strictly after the opening date and time.",
      };
    }
  }

  return {
    valid: true,
    data: {
      campaignId: parsed.data.campaignId,
      publicId: parsed.data.publicId,
      startIso,
      endIso,
    },
  };
}
