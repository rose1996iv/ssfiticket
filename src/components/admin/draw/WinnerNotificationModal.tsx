"use client";

import { useState, useEffect } from "react";
import { Mail, Send, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { previewWinnerNotification, dispatchWinnerNotification } from "@/server/actions/luckyDraw";

type Props = {
  resultId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
};

export function WinnerNotificationModal({ resultId, isOpen, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [preview, setPreview] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dispatchedId, setDispatchedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !resultId) return;

    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      setDispatchedId(null);
      try {
        const res = await previewWinnerNotification(resultId);
        if (!mounted) return;
        if (res.success && res.data) {
          setPreview(res.data);
        } else {
          setError(res.error || "Failed to load notification preview.");
        }
      } catch (err) {
        if (mounted) setError((err as Error).message);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [isOpen, resultId]);

  const handleDispatch = async () => {
    if (!resultId) return;
    setDispatching(true);
    setError(null);
    try {
      const res = await dispatchWinnerNotification(resultId);
      if (res.success && res.data) {
        setDispatchedId(res.data.outboxId);
        if (onSuccess) onSuccess();
      } else {
        setError(res.error || "Failed to dispatch winner notification.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDispatching(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="relative w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl border border-[#eadbcf] max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-[#705a54] hover:text-[#7c1619] p-1 rounded-lg"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fef2f2] text-[#7c1619] border border-[#fecaca]">
            <Mail size={22} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#2d1810]">Manual Winner Notification Dispatch</h2>
            <p className="text-xs text-[#705a54]">Transactional Email Outbox Integration</p>
          </div>
        </div>

        {loading && (
          <div className="py-12 text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#7c1619] border-t-transparent mb-3" />
            <p className="text-sm font-medium text-[#705a54]">Generating email preview...</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-50 p-4 border border-red-200 text-red-800 text-sm mb-4">
            <div className="flex items-center gap-2 font-semibold mb-1">
              <AlertTriangle size={16} /> Notification Error
            </div>
            {error}
          </div>
        )}

        {dispatchedId && (
          <div className="rounded-xl bg-emerald-50 p-6 border border-emerald-200 text-center my-4">
            <CheckCircle2 size={36} className="text-emerald-600 mx-auto mb-2" />
            <h3 className="font-bold text-base text-emerald-900 mb-1">Notification Enqueued Successfully</h3>
            <p className="text-xs text-emerald-800 mb-4">
              Transactional Outbox Job: <span className="font-mono font-semibold">{dispatchedId}</span>
              <br />
              Idempotency Key: <span className="font-mono">WINNER_ANNOUNCED:{resultId}</span>
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-[#7c1619] px-6 py-2.5 text-xs font-semibold text-white shadow hover:bg-[#681215]"
            >
              Done
            </button>
          </div>
        )}

        {!loading && !dispatchedId && preview && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-xs space-y-2">
              <div className="flex justify-between items-center border-b border-[#f0e7df] pb-2">
                <span className="font-semibold text-[#705a54]">Recipient:</span>
                <span className="font-bold text-[#2d1810]">{preview.recipient}</span>
              </div>
              <div className="flex justify-between items-center border-b border-[#f0e7df] pb-2">
                <span className="font-semibold text-[#705a54]">Customer Name:</span>
                <span className="font-bold text-[#2d1810]">{preview.customerName}</span>
              </div>
              <div className="flex justify-between items-center border-b border-[#f0e7df] pb-2">
                <span className="font-semibold text-[#705a54]">Winning Ticket:</span>
                <span className="font-mono font-bold text-[#7c1619]">{preview.ticketNumber}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-[#705a54]">Prize:</span>
                <span className="font-bold text-[#7c1619]">{preview.prizeTitle}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#594541] mb-1">Subject Preview:</label>
              <div className="rounded-lg border border-[#eadbcf] bg-white p-2.5 text-xs font-medium text-[#2d1810]">
                {preview.subject}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#594541] mb-1">Message Preview:</label>
              <div className="rounded-lg border border-[#eadbcf] bg-gray-50 p-3 text-xs text-[#594541] whitespace-pre-wrap max-h-40 overflow-y-auto font-sans leading-relaxed">
                {preview.text}
              </div>
            </div>

            <div className="rounded-xl bg-amber-50 p-3 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Explicit Admin Action:</strong> In compliance with Phase 9 approved business rules, notifications are never dispatched automatically upon draw completion. Clicking below will enqueue the job with strict idempotency (key: <code>WINNER_ANNOUNCED:{resultId}</code>) and stamp the result timestamp.
              </span>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-[#eadbcf] bg-white px-4 py-2 text-xs font-semibold text-[#594541] hover:bg-[#fffaf7]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDispatch}
                disabled={dispatching}
                className="inline-flex items-center gap-2 rounded-xl bg-[#7c1619] px-5 py-2.5 text-xs font-semibold text-white shadow hover:bg-[#681215] disabled:opacity-50"
              >
                {dispatching ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Enqueuing...
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    Dispatch Notification
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

