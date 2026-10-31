"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, MessageSquare, Send } from "lucide-react";
import {
  prepareWhatsAppTicketDelivery,
  recordWhatsAppOpenedAction,
  recordWhatsAppManuallySentAction,
} from "@/server/actions/whatsappDelivery";

type Props = {
  orderId: string;
  initialStatus?: string;
  recipientPhone?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function WhatsAppTicketDeliveryButton({
  orderId,
  initialStatus,
  recipientPhone,
  size = "md",
  className = "",
}: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | undefined>(initialStatus);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sentConfirming, setSentConfirming] = useState(false);

  const handleOpenWhatsApp = async () => {
    setLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      const res = await prepareWhatsAppTicketDelivery(orderId);
      if (!res.success || !res.url) {
        setErrorMessage(res.error || "Failed to prepare WhatsApp message.");
        setLoading(false);
        return;
      }

      // Open official wa.me Click-to-Chat in a new window/tab
      window.open(res.url, "_blank", "noopener,noreferrer");

      // Record link opened audit action
      await recordWhatsAppOpenedAction(orderId);
      setStatus("WHATSAPP_LINK_OPENED");
      setInfoMessage("WhatsApp message prepared. Please send it manually in the opened WhatsApp window.");
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("An unexpected error occurred opening WhatsApp.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSent = async () => {
    setSentConfirming(true);
    try {
      await recordWhatsAppManuallySentAction(orderId);
      setStatus("MANUALLY_SENT");
      setInfoMessage("Ticket confirmation successfully marked as sent via WhatsApp!");
    } catch {
      setErrorMessage("Failed to record confirmation. Please try again.");
    } finally {
      setSentConfirming(false);
    }
  };

  const sizeClasses =
    size === "sm"
      ? "px-2.5 py-1.5 text-xs gap-1.5"
      : size === "lg"
      ? "px-5 py-3 text-sm gap-2.5 font-bold"
      : "px-4 py-2.5 text-xs gap-2 font-semibold";

  const isManuallySent = status === "MANUALLY_SENT" || status === "DELIVERED";
  const isLinkOpened = status === "WHATSAPP_LINK_OPENED";

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleOpenWhatsApp}
          disabled={loading}
          className={`inline-flex items-center justify-center rounded-xl font-semibold text-white shadow-xs transition hover:brightness-105 active:scale-98 disabled:cursor-not-allowed disabled:opacity-60 bg-[#25D366] hover:bg-[#20bd5a] text-[#0b3819] ${sizeClasses}`}
        >
          {loading ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <MessageSquare size={16} className="text-[#0b3819]" />
          )}
          <span>
            {isManuallySent
              ? "Re-open WhatsApp Chat"
              : isLinkOpened
              ? "Re-open WhatsApp Chat"
              : "Open WhatsApp Chat (Free)"}
          </span>
          <ExternalLink size={13} className="text-[#0b3819]/70" />
        </button>

        {isLinkOpened && !isManuallySent && (
          <button
            type="button"
            onClick={handleConfirmSent}
            disabled={sentConfirming}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 shadow-2xs transition hover:bg-emerald-100 disabled:opacity-50"
          >
            {sentConfirming ? (
              <Loader2 className="animate-spin" size={14} />
            ) : (
              <Send size={14} className="text-emerald-700" />
            )}
            <span>Confirm Manually Sent</span>
          </button>
        )}

        {isManuallySent && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800">
            <CheckCircle2 size={13} />
            <span>Manually Confirmed Sent</span>
          </span>
        )}
      </div>

      {/* Info Notice */}
      {infoMessage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-2.5 text-xs text-emerald-900 leading-relaxed">
          <p className="font-semibold">{infoMessage}</p>
          {recipientPhone && (
            <p className="mt-0.5 text-[11px] text-emerald-700">Recipient Phone: {recipientPhone}</p>
          )}
        </div>
      )}

      {/* Error Notice */}
      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-900 leading-relaxed">
          <p className="font-semibold">{errorMessage}</p>
        </div>
      )}
    </div>
  );
}
