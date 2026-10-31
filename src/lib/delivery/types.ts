export type DeliveryChannel = "WHATSAPP" | "EMAIL";
export type DeliveryStatus =
  | "PENDING"
  | "SENT"
  | "DELIVERED"
  | "FAILED"
  | "SIMULATED"
  | "WHATSAPP_LINK_OPENED"
  | "MANUALLY_SENT";

export type DeliveryPayload = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  whatsappNumber: string;
  email: string | null;
  ticketNumbers: string[];
  amountInr: number;
  campaignName: string;
  issuedAtIst: string;
  ticketAccessUrl: string;
  sellerAttribution?: string | null;
  supportPhone?: string;
  supportEmail?: string;
  isSimulated?: boolean;
};

export type DeliveryResult = {
  channel: DeliveryChannel;
  status: DeliveryStatus;
  provider: string;
  recipient: string;
  providerMessageId: string | null;
  renderedContent: string;
  subject?: string;
  error?: string | null;
};

export interface DeliveryProvider {
  name: string;
  channel: DeliveryChannel;
  isConfigured(): boolean;
  send(payload: DeliveryPayload): Promise<DeliveryResult>;
}

/**
 * Formats precise, consistent delivery status labels across all UI views.
 *
 * Recognized labels per SSFI specifications:
 * - "Prepared" (WhatsApp prepared / pending)
 * - "WhatsApp Link Opened" (wa.me link clicked by staff)
 * - "Manually Confirmed Sent" (staff marked WhatsApp message as sent)
 * - "Email Queued" (Email pending transmission)
 * - "Provider/API Accepted" (HTTP 200/API response accepted by Gmail/Resend)
 * - "Delivery Confirmed" (webhook confirmation of delivery)
 * - "Failed" (API error or rejection)
 * - "Simulated (Preview Test)" (local preview dry-run)
 */
export function formatDeliveryStatusLabel(
  status: DeliveryStatus | string,
  channel?: DeliveryChannel,
  metadata?: Record<string, unknown>
): string {
  if (metadata?.whatsapp_action === "MANUALLY_SENT") {
    return "Manually Confirmed Sent";
  }
  if (metadata?.whatsapp_action === "WHATSAPP_LINK_OPENED" && status !== "DELIVERED") {
    return "WhatsApp Link Opened";
  }
  switch (status) {
    case "PENDING":
      return channel === "EMAIL" ? "Email Queued" : "Prepared";
    case "WHATSAPP_LINK_OPENED":
      return "WhatsApp Link Opened";
    case "MANUALLY_SENT":
      return "Manually Confirmed Sent";
    case "SENT":
      return "Provider/API Accepted";
    case "DELIVERED":
      return channel === "WHATSAPP" ? "Manually Confirmed Sent" : "Delivery Confirmed";
    case "FAILED":
      return "Failed";
    case "SIMULATED":
      return "Simulated (Preview Test)";
    default:
      return String(status);
  }
}

