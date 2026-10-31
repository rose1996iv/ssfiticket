"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  Send,
} from "lucide-react";
import { adminResendDeliveryAction } from "@/server/actions/tickets";
import { DeliveryChannel, DeliveryStatus, formatDeliveryStatusLabel } from "@/lib/delivery/types";
import { AdminGmailPreviewTestCard } from "./AdminGmailPreviewTestCard";

export type DeliveryItem = {
  id: string;
  channel: DeliveryChannel;
  recipient: string;
  status: DeliveryStatus;
  provider: string;
  attempt_count: number;
  last_attempt_at: string | null;
  sent_at: string | null;
  error_message: string | null;
  rendered_content: string;
  subject?: string | null;
  metadata?: Record<string, unknown>;
};

type Props = {
  orderId: string;
  orderNumber: string;
  deliveries: DeliveryItem[];
  canManage?: boolean;
};

export function OrderDeliveryCard({
  orderId,
  orderNumber,
  deliveries,
  canManage = true,
}: Props) {
  const [isResending, setIsResending] = useState<DeliveryChannel | "ALL" | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Preview modal state
  const [previewItem, setPreviewItem] = useState<DeliveryItem | null>(null);
  const [showDiagnostic, setShowDiagnostic] = useState(false);

  async function handleResend(channel?: DeliveryChannel) {
    setIsResending(channel || "ALL");
    setActionMessage(null);
    setActionError(null);

    const formData = new FormData();
    formData.set("orderId", orderId);
    if (channel) {
      formData.set("channel", channel);
    }

    try {
      const res = await adminResendDeliveryAction(formData);
      setActionMessage(res.message);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Resend failed.");
    } finally {
      setIsResending(null);
    }
  }

  const whatsappDelivery = deliveries.find((d) => d.channel === "WHATSAPP");
  const emailDelivery = deliveries.find((d) => d.channel === "EMAIL");

  return (
    <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0e7df] pb-4">
        <div className="flex items-center gap-2">
          <Send className="text-[#7c1619]" size={18} />
          <div>
            <h2 className="text-base font-bold text-[#35110f]">Automated Ticket Delivery — {orderNumber}</h2>
            <p className="text-xs text-[#705a54]">
              Dispatches ticket confirmation and verification links via official SSFI channels.
            </p>
          </div>
        </div>

        {canManage && (
          <button
            type="button"
            disabled={isResending !== null}
            onClick={() => handleResend()}
            className="flex items-center gap-1.5 rounded-xl border border-[#eadbcf] bg-white px-3.5 py-1.5 text-xs font-bold text-[#7c1619] shadow-2xs transition hover:bg-[#fffaf7] disabled:opacity-50"
          >
            {isResending === "ALL" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            <span>Resend All</span>
          </button>
        )}
      </div>

      {actionMessage && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-xs font-semibold text-green-900">
          <CheckCircle2 size={15} className="text-green-600 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {actionError && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-900">
          <AlertTriangle size={15} className="text-red-600 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Deliveries Grid */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {/* WhatsApp Channel Card */}
        <div className="rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold text-[#35110f]">
                <MessageSquare size={14} className="text-emerald-700" />
                <span>WhatsApp Delivery</span>
              </span>

              {whatsappDelivery ? (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                    whatsappDelivery.status === "SIMULATED"
                      ? "bg-blue-100 text-blue-800"
                      : whatsappDelivery.status === "SENT" || whatsappDelivery.status === "DELIVERED"
                      ? "bg-green-100 text-green-800"
                      : whatsappDelivery.status === "FAILED"
                      ? "bg-red-100 text-red-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {formatDeliveryStatusLabel(whatsappDelivery.status, "WHATSAPP", whatsappDelivery.metadata)}
                </span>
              ) : (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
                  Not Dispatched
                </span>
              )}
            </div>

            <div className="mt-3 space-y-1 text-xs text-[#705a54]">
              <p>
                Recipient: <b className="font-mono text-[#35110f]">{whatsappDelivery?.recipient || "—"}</b>
              </p>
              {whatsappDelivery?.provider && (
                <p>
                  Provider: <span className="font-mono text-[11px]">{whatsappDelivery.provider}</span>
                </p>
              )}
              {whatsappDelivery?.last_attempt_at && (
                <p className="text-[11px]">
                  Attempt #{whatsappDelivery.attempt_count} on{" "}
                  {new Date(whatsappDelivery.last_attempt_at).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              )}
              {whatsappDelivery?.error_message && (
                <p className="text-[11px] font-semibold text-red-700">
                  Error: {whatsappDelivery.error_message}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-[#f0e7df] pt-3">
            {whatsappDelivery ? (
              <button
                type="button"
                onClick={() => setPreviewItem(whatsappDelivery)}
                className="flex items-center gap-1 text-xs font-semibold text-[#7c1619] hover:underline"
              >
                <Eye size={12} />
                <span>Preview Message</span>
              </button>
            ) : (
              <span className="text-[11px] text-[#705a54]">Pending payment verification</span>
            )}

            {canManage && whatsappDelivery && (
              <button
                type="button"
                disabled={isResending !== null}
                onClick={() => handleResend("WHATSAPP")}
                className="text-xs font-bold text-[#7c1619] hover:underline disabled:opacity-50"
              >
                {isResending === "WHATSAPP" ? "Sending..." : "Resend WA"}
              </button>
            )}
          </div>
        </div>

        {/* Email Channel Card */}
        <div className="rounded-xl border border-[#f0e7df] bg-[#fffaf7] p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold text-[#35110f]">
                <Mail size={14} className="text-blue-700" />
                <span>Email Delivery</span>
              </span>

              {emailDelivery ? (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                    emailDelivery.status === "SIMULATED"
                      ? "bg-blue-100 text-blue-800"
                      : emailDelivery.status === "SENT" || emailDelivery.status === "DELIVERED"
                      ? "bg-green-100 text-green-800"
                      : emailDelivery.status === "FAILED"
                      ? "bg-red-100 text-red-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {formatDeliveryStatusLabel(emailDelivery.status, "EMAIL", emailDelivery.metadata)}
                </span>
              ) : (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
                  Not Dispatched
                </span>
              )}
            </div>

            <div className="mt-3 space-y-1 text-xs text-[#705a54]">
              <p>
                Recipient: <b className="font-mono text-[#35110f]">{emailDelivery?.recipient || "No Email"}</b>
              </p>
              {emailDelivery?.provider && (
                <p>
                  Provider: <span className="font-mono text-[11px]">{emailDelivery.provider}</span>
                </p>
              )}
              {emailDelivery?.last_attempt_at && (
                <p className="text-[11px]">
                  Attempt #{emailDelivery.attempt_count} on{" "}
                  {new Date(emailDelivery.last_attempt_at).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              )}
              {emailDelivery?.error_message && (
                <p className="text-[11px] font-semibold text-red-700">
                  Error: {emailDelivery.error_message}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-[#f0e7df] pt-3">
            {emailDelivery ? (
              <button
                type="button"
                onClick={() => setPreviewItem(emailDelivery)}
                className="flex items-center gap-1 text-xs font-semibold text-[#7c1619] hover:underline"
              >
                <Eye size={12} />
                <span>Preview Email</span>
              </button>
            ) : (
              <span className="text-[11px] text-[#705a54]">
                Pending payment verification
              </span>
            )}

            {canManage && emailDelivery && (
              <button
                type="button"
                disabled={isResending !== null}
                onClick={() => handleResend("EMAIL")}
                className="text-xs font-bold text-[#7c1619] hover:underline disabled:opacity-50"
              >
                {isResending === "EMAIL" ? "Sending..." : "Resend Email"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Gmail API Diagnostic Test Drawer for Preview / Testing */}
      <div className="mt-4 border-t border-[#f0e7df] pt-3">
        <button
          type="button"
          onClick={() => setShowDiagnostic((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#705a54] hover:text-[#7c1619] transition"
        >
          <Mail size={13} className="text-[#7c1619]" />
          <span>{showDiagnostic ? "Hide Diagnostic Test Panel" : "Test Gmail API Provider Directly (Preview)"}</span>
        </button>

        {showDiagnostic && (
          <div className="mt-3">
            <AdminGmailPreviewTestCard />
          </div>
        )}
      </div>

      {/* Message Preview Modal */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-2xs">
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#f0e7df] pb-3">
              <div className="flex items-center gap-2">
                <Eye size={18} className="text-[#7c1619]" />
                <h3 className="font-bold text-base text-[#35110f]">
                  Rendered Message Preview — {previewItem.channel}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="rounded-lg p-1 text-[#705a54] hover:bg-gray-100 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-[#705a54]">
              <span>Recipient: <b className="font-mono text-[#35110f]">{previewItem.recipient}</b></span>
              <span>Status: <b className="font-semibold text-[#7c1619]">{formatDeliveryStatusLabel(previewItem.status, previewItem.channel, previewItem.metadata)}</b> ({previewItem.provider})</span>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-xs font-mono text-[#35110f] whitespace-pre-wrap leading-relaxed select-text">
              {previewItem.channel === "WHATSAPP" ? (
                previewItem.rendered_content
              ) : (
                <div
                  dangerouslySetInnerHTML={{ __html: previewItem.rendered_content }}
                  className="font-sans"
                />
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="rounded-xl border border-[#eadbcf] bg-white px-5 py-2 text-xs font-bold text-[#705a54] hover:bg-gray-50"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
