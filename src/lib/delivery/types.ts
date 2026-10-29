export type DeliveryChannel = "WHATSAPP" | "EMAIL";
export type DeliveryStatus = "PENDING" | "SENT" | "DELIVERED" | "FAILED" | "SIMULATED";

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

