export const CANONICAL_CAMPAIGN_PUBLIC_ID = "ssfi-fundraising-lucky-draw";

export interface CampaignSelectionCandidate {
  id: string;
  public_id: string;
  status: string;
}

export interface CampaignSelectionOptions {
  requestedCampaignId?: string | null;
  canOverrideCampaign: boolean;
}

export function isSyntheticCampaignPublicId(publicId: string | null | undefined): boolean {
  if (!publicId) return false;
  return publicId.trim().toLowerCase().startsWith("synth-");
}

export function validateResolvedDrawCampaign(
  campaign: CampaignSelectionCandidate | null,
  options: CampaignSelectionOptions
): { valid: true; campaign: CampaignSelectionCandidate } | { valid: false; error: string } {
  if (!campaign) {
    return {
      valid: false,
      error: options.requestedCampaignId
        ? "Requested campaign was not found."
        : `Canonical campaign '${CANONICAL_CAMPAIGN_PUBLIC_ID}' was not found.`,
    };
  }

  const allowedStatuses = new Set(["ACTIVE", "CLOSED"]);
  if (!allowedStatuses.has(campaign.status)) {
    return {
      valid: false,
      error: `Campaign '${campaign.public_id}' is not in an eligible draw state (status=${campaign.status}).`,
    };
  }

  if (!options.requestedCampaignId) {
    if (campaign.public_id !== CANONICAL_CAMPAIGN_PUBLIC_ID) {
      return {
        valid: false,
        error: `Default draw campaign must be '${CANONICAL_CAMPAIGN_PUBLIC_ID}', got '${campaign.public_id}'.`,
      };
    }
    if (isSyntheticCampaignPublicId(campaign.public_id)) {
      return {
        valid: false,
        error: "Synthetic campaigns cannot be selected as the default draw campaign.",
      };
    }
  } else {
    if (!options.canOverrideCampaign) {
      return {
        valid: false,
        error: "Unauthorized: only SUPER_ADMIN or ADMIN may select a non-default campaign.",
      };
    }
    if (campaign.id !== options.requestedCampaignId) {
      return {
        valid: false,
        error: "Resolved campaign ID does not match requested campaign ID.",
      };
    }
  }

  return { valid: true, campaign };
}
