export type DrawStatus = "DRAFT" | "SCHEDULED" | "EXECUTED" | "CANCELLED";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export type VerificationStatus = "VERIFIED" | "FAILED";

export interface PrizeItem {
  id: string;
  campaign_id: string;
  prize_number: number;
  title: string;
  description: string | null;
  cash_amount_paise: number | null;
  display_order: number;
  created_at: string;
}

export interface DrawSession {
  id: string;
  campaign_id: string;
  name: string;
  status: DrawStatus;
  scheduled_at: string | null;
  executed_at: string | null;
  created_at: string;
  current_prize_id: string | null;
  seed_commitment: string | null;
  seed_revealed: string | null;
  client_entropy: string | null;
  locked_by: string | null;
}

export interface EligibilitySnapshot {
  id: string;
  draw_id: string;
  campaign_id: string;
  prize_id: string;
  total_eligible_count: number;
  previous_winner_count: number;
  manual_exclusion_count: number;
  snapshot_hash: string;
  algorithm_version: string;
  is_locked: boolean;
  locked_at: string;
  locked_by: string;
}

export interface SnapshotTicket {
  id: string;
  snapshot_id: string;
  ticket_id: string;
  ticket_number: string;
  display_index: number;
}

export interface ManualExclusion {
  id: string;
  campaign_id: string;
  draw_id?: string;
  prize_id: string | null;
  ticket_id: string;
  ticket_number?: string;
  reason: string;
  excluded_by: string;
  excluded_at: string;
  excluded_by_email?: string;
}

export interface DrawApproval {
  id: string;
  draw_id: string;
  campaign_id: string;
  prize_id: string;
  snapshot_id: string;
  snapshot_hash: string;
  initiator_id: string;
  initiator_email?: string;
  approver_id: string | null;
  approver_email?: string;
  status: ApprovalStatus;
  requested_at: string;
  reviewed_at: string | null;
  review_notes: string | null;
}

export interface RandomnessEvidence {
  id: string;
  draw_id: string;
  prize_id: string;
  snapshot_id: string;
  algorithm_version: string;
  server_seed_commitment: string;
  server_seed_revealed: string;
  client_entropy: string | null;
  combined_seed: string;
  selected_index: number;
  total_candidates: number;
  winning_ticket_number: string;
  verification_status: VerificationStatus;
  created_at: string;
}

export interface DrawResultRecord {
  id: string;
  draw_id: string;
  campaign_id: string;
  prize_id: string;
  prize_number: number;
  prize_title: string;
  ticket_id: string;
  ticket_number: string;
  customer_id: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  seller_id?: string;
  seller_name?: string;
  seller_code?: string;
  snapshot_id: string;
  selection_index: number;
  seed_commitment: string;
  seed_revealed: string;
  combined_seed: string;
  drawn_by: string;
  notified_at: string | null;
  notified_by: string | null;
  notification_outbox_id: string | null;
  created_at: string;
}

export interface EligibleTicketRosterItem {
  id: string;
  ticket_number: string;
  campaign_id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  seller_id: string | null;
  seller_name: string | null;
  seller_code: string | null;
  order_id: string;
  order_number: string;
  is_excluded: boolean;
  exclusion_reason?: string;
  exclusion_id?: string;
  is_previous_winner: boolean;
  previous_prize_number?: number;
  is_eligible: boolean;
}

export interface DrawOverviewData {
  campaign: {
    id: string;
    name: string;
    public_id: string;
    status: string;
    total_ticket_limit: number;
    sold_ticket_count: number;
  } | null;
  prizes: PrizeItem[];
  drawSession: DrawSession | null;
  results: DrawResultRecord[];
  nextPrize: PrizeItem | null;
  activeSnapshot: EligibilitySnapshot | null;
  pendingApproval: DrawApproval | null;
  userRole: {
    isSuperAdmin: boolean;
    isAdmin: boolean;
    userId: string;
    email: string;
  };
}

