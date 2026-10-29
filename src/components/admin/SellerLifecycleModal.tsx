"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Power,
  RotateCcw,
  Trash2,
  X,
  ShieldAlert,
} from "lucide-react";
import {
  deactivateSellerAccount,
  reactivateSellerAccount,
  permanentlyDeleteSeller,
} from "@/server/actions/seller";

interface SellerLifecycleModalProps {
  sellerId: string;
  sellerCode: string;
  displayName: string;
  isActive: boolean;
  orderCount: number;
  ticketCount: number;
  isSuperAdmin?: boolean;
}

export function SellerLifecycleModal({
  sellerId,
  sellerCode,
  displayName,
  isActive,
  orderCount,
  ticketCount,
  isSuperAdmin = false,
}: SellerLifecycleModalProps) {
  const router = useRouter();
  const [activeModal, setActiveModal] = useState<"deactivate" | "reactivate" | "delete" | null>(
    null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmInput, setConfirmInput] = useState("");

  const hasHistoricalRecords = orderCount > 0 || ticketCount > 0;

  function closeModal() {
    setActiveModal(null);
    setErrorMsg(null);
    setConfirmInput("");
    setIsSubmitting(false);
  }

  async function handleDeactivate() {
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await deactivateSellerAccount(sellerId);
      if (!res.success) {
        setErrorMsg(res.error);
        setIsSubmitting(false);
        return;
      }
      closeModal();
      router.refresh();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to deactivate seller.");
      setIsSubmitting(false);
    }
  }

  async function handleReactivate() {
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await reactivateSellerAccount(sellerId);
      if (!res.success) {
        setErrorMsg(res.error);
        setIsSubmitting(false);
        return;
      }
      closeModal();
      router.refresh();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to reactivate seller.");
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (confirmInput.trim().toUpperCase() !== sellerCode.trim().toUpperCase()) {
      setErrorMsg(`Confirmation code must match "${sellerCode}" exactly.`);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await permanentlyDeleteSeller(sellerId, confirmInput.trim());
      if (!res.success) {
        setErrorMsg(res.error);
        setIsSubmitting(false);
        return;
      }
      closeModal();
      router.refresh();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to delete seller.");
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        {isActive ? (
          <button
            type="button"
            onClick={() => setActiveModal("deactivate")}
            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
            title="Deactivate Seller"
          >
            <Power size={13} className="text-amber-700" />
            <span>Deactivate</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setActiveModal("reactivate")}
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-100"
            title="Reactivate Seller"
          >
            <RotateCcw size={13} className="text-emerald-700" />
            <span>Reactivate</span>
          </button>
        )}

        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => setActiveModal("delete")}
            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 hover:text-red-900"
            title="Permanent Delete (Super Admin only)"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Deactivate Confirmation Modal */}
      {activeModal === "deactivate" && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-amber-100 p-2.5 text-amber-800">
                <AlertTriangle size={22} />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-[#35110f]">
                  Deactivate Seller {sellerCode}?
                </h3>
                <p className="mt-1 text-xs text-[#705a54]">{displayName}</p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900 space-y-1.5">
              <p className="font-semibold">What happens when deactivated:</p>
              <ul className="list-disc pl-4 space-y-1 text-amber-800">
                <li>New customer referrals using {sellerCode} will be blocked.</li>
                <li>The seller portal and sales forms will be inaccessible.</li>
                <li>Existing orders ({orderCount}) and tickets ({ticketCount}) remain intact.</li>
                <li>You can reactivate this seller at any time.</li>
              </ul>
            </div>

            {errorMsg && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {errorMsg}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                className="rounded-xl border border-[#eadbcf] px-4 py-2 text-xs font-semibold text-[#705a54] hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeactivate}
                disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-700 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-800 disabled:opacity-60"
              >
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
                <span>Confirm Deactivation</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reactivate Confirmation Modal */}
      {activeModal === "reactivate" && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-800">
                <CheckCircle2 size={22} />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-[#35110f]">
                  Reactivate Seller {sellerCode}?
                </h3>
                <p className="mt-1 text-xs text-[#705a54]">{displayName}</p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-900 space-y-1.5">
              <p className="font-semibold">Reactivation effects:</p>
              <ul className="list-disc pl-4 space-y-1 text-emerald-800">
                <li>Restores QR code and referral link for ticket sales.</li>
                <li>Restores login access to the Seller Partner Portal.</li>
                <li>All previous attribution records will resume.</li>
              </ul>
            </div>

            {errorMsg && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {errorMsg}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                className="rounded-xl border border-[#eadbcf] px-4 py-2 text-xs font-semibold text-[#705a54] hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReactivate}
                disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-800 disabled:opacity-60"
              >
                {isSubmitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RotateCcw size={14} />
                )}
                <span>Confirm Reactivation</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Delete Modal */}
      {activeModal === "delete" && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-red-100 p-2.5 text-red-800">
                <ShieldAlert size={22} />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-red-950">
                  Permanent Delete: {sellerCode}
                </h3>
                <p className="mt-1 text-xs text-[#705a54]">{displayName}</p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>

            {hasHistoricalRecords ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-xs text-red-950">
                  <p className="font-bold flex items-center gap-1.5">
                    <AlertTriangle size={15} className="text-red-700" />
                    Deletion Strictly Blocked
                  </p>
                  <p className="mt-1.5 leading-relaxed text-red-800">
                    This seller has <b>{orderCount} order(s)</b> and <b>{ticketCount} ticket(s)</b>.
                    Physical deletion is forbidden to safeguard financial integrity and legal
                    ticket audit trails.
                  </p>
                  <p className="mt-2 text-red-900 font-semibold">
                    Recommendation: Use <u>Deactivate</u> to disable referral sales and portal
                    access safely.
                  </p>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-xl bg-gray-800 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-gray-900"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3 text-xs">
                <p className="text-red-800 leading-relaxed">
                  This seller has <b>zero historical orders or tickets</b>. Physical deletion is
                  permitted for SUPER_ADMIN. This action cannot be undone.
                </p>

                <div>
                  <label htmlFor="confirm-code" className="block font-semibold text-[#35110f]">
                    To confirm, type <span className="font-mono text-red-700">{sellerCode}</span>:
                  </label>
                  <input
                    id="confirm-code"
                    value={confirmInput}
                    onChange={(e) => setConfirmInput(e.target.value)}
                    placeholder={sellerCode}
                    disabled={isSubmitting}
                    className="mt-1.5 w-full rounded-xl border border-red-300 bg-red-50/40 p-2.5 font-mono text-xs uppercase text-red-950 focus:border-red-600 focus:outline-hidden"
                  />
                </div>

                {errorMsg && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-800">
                    {errorMsg}
                  </div>
                )}

                <div className="mt-6 flex justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={isSubmitting}
                    className="rounded-xl border border-[#eadbcf] px-4 py-2 text-xs font-semibold text-[#705a54] hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={
                      isSubmitting ||
                      confirmInput.trim().toUpperCase() !== sellerCode.trim().toUpperCase()
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-red-800 disabled:opacity-40"
                  >
                    {isSubmitting ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                    <span>Permanently Delete</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

