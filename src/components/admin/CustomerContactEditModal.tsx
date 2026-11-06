"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  Loader2,
  Lock,
  Mail,
  MessageCircle,
  ShieldAlert,
  Ticket as TicketIcon,
  User,
  X,
} from "lucide-react";
import {
  updateMasterCustomerProfile,
  updateSingleTicketContact,
} from "@/server/actions/customerManagement";

export type CustomerContactEditTarget = {
  mode: "CUSTOMER_PROFILE" | "TICKET_CONTACT";
  customerId: string;
  orderId?: string;
  orderNumber?: string;
  ticketId?: string;
  ticketNumber?: string;
  sellerLabel?: string;
  amountLabel?: string;
  issuedAtLabel?: string;
  initialFullName: string;
  initialEmail: string;
  initialWhatsapp: string;
  buttonLabel?: string;
  buttonVariant?: "compact" | "primary";
};

export function CustomerContactEditModal({
  mode,
  customerId,
  orderId,
  orderNumber,
  ticketId,
  ticketNumber,
  sellerLabel,
  amountLabel,
  issuedAtLabel,
  initialFullName,
  initialEmail,
  initialWhatsapp,
  buttonLabel,
  buttonVariant = "compact",
}: CustomerContactEditTarget) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activeScope, setActiveScope] = useState<"CUSTOMER_PROFILE" | "TICKET_CONTACT">(
    ticketId ? mode : "CUSTOMER_PROFILE"
  );
  const [fullName, setFullName] = useState(initialFullName || "");
  const [email, setEmail] = useState(initialEmail || "");
  const [whatsapp, setWhatsapp] = useState(initialWhatsapp || "");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleOpen = () => {
    setFullName(initialFullName || "");
    setEmail(initialEmail || "");
    setWhatsapp(initialWhatsapp || "");
    setReason("");
    setError(null);
    setSuccessMsg(null);
    setActiveScope(ticketId ? mode : "CUSTOMER_PROFILE");
    setOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res =
        activeScope === "TICKET_CONTACT" && ticketId
          ? await updateSingleTicketContact({
              ticketId,
              orderId,
              fullName,
              email,
              whatsapp,
              reason,
            })
          : await updateMasterCustomerProfile({
              customerId,
              orderId,
              fullName,
              email,
              whatsapp,
              reason,
            });

      setLoading(false);

      if (!res.success) {
        setError(res.error || "Failed to update contact information.");
        return;
      }

      setSuccessMsg(
        activeScope === "TICKET_CONTACT"
          ? `Single-ticket contact updated for ${ticketNumber || "this ticket"} (audit recorded). Other tickets for this customer remain unchanged.`
          : "Master customer profile updated and recorded in the append-only audit trail."
      );
      router.refresh();
    } catch (err: unknown) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Unexpected error updating contact.");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={
          buttonVariant === "primary"
            ? "inline-flex items-center gap-1.5 rounded-xl bg-[#7c1619] px-3.5 py-2 text-xs font-bold text-white shadow-2xs transition hover:bg-[#631214]"
            : "inline-flex items-center gap-1 rounded-lg border border-[#eadbcf] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#7c1619] shadow-2xs transition hover:bg-[#faf3ee]"
        }
      >
        <Edit3 size={12} />
        <span>
          {buttonLabel ||
            (mode === "TICKET_CONTACT" ? "Edit Ticket Contact" : "Edit Customer Profile")}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-[#f0e7df] pb-4">
              <div>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#7c1619]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#7c1619]">
                  Controlled Admin Contact Management
                </span>
                <h2 className="mt-1.5 font-serif text-lg font-bold text-[#35110f]">
                  {activeScope === "TICKET_CONTACT"
                    ? `Update Single Ticket Contact (${ticketNumber || "Ticket"})`
                    : "Update Master Customer Profile"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-[#705a54] transition hover:bg-[#faf3ee] hover:text-[#35110f]"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scope Selector when opened from a Ticket context */}
            {ticketId && (
              <div className="mt-4 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#705a54]">
                  Select Update Operation Scope
                </p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setActiveScope("TICKET_CONTACT")}
                    className={`rounded-lg border p-2.5 text-left text-xs transition ${
                      activeScope === "TICKET_CONTACT"
                        ? "border-[#7c1619] bg-[#7c1619]/10 font-bold text-[#35110f]"
                        : "border-[#eadbcf] bg-white text-[#705a54] hover:bg-[#faf3ee]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <TicketIcon size={13} className="text-[#7c1619]" />
                      <span>Single Ticket Contact Only</span>
                    </div>
                    <p className="mt-1 text-[10px] font-normal text-[#705a54]">
                      Updates only ticket <span className="font-mono">{ticketNumber}</span> without
                      changing other tickets.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveScope("CUSTOMER_PROFILE")}
                    className={`rounded-lg border p-2.5 text-left text-xs transition ${
                      activeScope === "CUSTOMER_PROFILE"
                        ? "border-[#7c1619] bg-[#7c1619]/10 font-bold text-[#35110f]"
                        : "border-[#eadbcf] bg-white text-[#705a54] hover:bg-[#faf3ee]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <User size={13} className="text-[#7c1619]" />
                      <span>Master Customer Profile</span>
                    </div>
                    <p className="mt-1 text-[10px] font-normal text-[#705a54]">
                      Updates the customer&apos;s master contact record across their account.
                    </p>
                  </button>
                </div>
              </div>
            )}

            {/* Locked Immutable Fields Banner */}
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-950">
              <p className="flex items-center gap-1.5 font-bold text-amber-900">
                <Lock size={13} className="shrink-0" />
                <span>Immutable Ticket &amp; Financial Identity (Locked)</span>
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                {ticketNumber && (
                  <div className="rounded-lg border border-amber-200/80 bg-white/80 px-2.5 py-1.5">
                    <span className="block text-[9px] font-bold uppercase text-amber-800">
                      Ticket Number (Locked)
                    </span>
                    <span className="font-mono font-bold text-[#35110f]">{ticketNumber}</span>
                  </div>
                )}
                {orderNumber && (
                  <div className="rounded-lg border border-amber-200/80 bg-white/80 px-2.5 py-1.5">
                    <span className="block text-[9px] font-bold uppercase text-amber-800">
                      Order Number (Locked)
                    </span>
                    <span className="font-mono font-bold text-[#35110f]">{orderNumber}</span>
                  </div>
                )}
                {sellerLabel && (
                  <div className="rounded-lg border border-amber-200/80 bg-white/80 px-2.5 py-1.5">
                    <span className="block text-[9px] font-bold uppercase text-amber-800">
                      Original Seller (Locked)
                    </span>
                    <span className="font-semibold text-[#35110f]">{sellerLabel}</span>
                  </div>
                )}
                {amountLabel && (
                  <div className="rounded-lg border border-amber-200/80 bg-white/80 px-2.5 py-1.5">
                    <span className="block text-[9px] font-bold uppercase text-amber-800">
                      Payment Amount (Locked)
                    </span>
                    <span className="font-mono font-bold text-[#35110f]">{amountLabel}</span>
                  </div>
                )}
                {issuedAtLabel && (
                  <div className="rounded-lg border border-amber-200/80 bg-white/80 px-2.5 py-1.5">
                    <span className="block text-[9px] font-bold uppercase text-amber-800">
                      Issuance Timestamp (Locked)
                    </span>
                    <span className="font-mono text-[#35110f]">{issuedAtLabel}</span>
                  </div>
                )}
              </div>
              <p className="mt-2 text-[10px] text-amber-800">
                Ticket numbers, QR verification tokens, order IDs, payment amounts, and seller
                attribution are protected by database triggers and cannot be modified.
              </p>
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-600" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950">
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-700" />
                <span>{successMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#705a54]">
                  Customer Full Name *
                </label>
                <div className="relative mt-1">
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={120}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full rounded-xl border border-[#eadbcf] bg-white px-3 py-2.5 pr-9 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
                  />
                  <User
                    size={14}
                    className="pointer-events-none absolute right-3 top-2.5 text-[#705a54]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#705a54]">
                  Email Address *
                </label>
                <div className="relative mt-1">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="customer@example.com"
                    className="w-full rounded-xl border border-[#eadbcf] bg-white px-3 py-2.5 pr-9 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
                  />
                  <Mail
                    size={14}
                    className="pointer-events-none absolute right-3 top-2.5 text-[#705a54]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#705a54]">
                  WhatsApp / Contact Number *
                </label>
                <div className="relative mt-1">
                  <input
                    type="text"
                    required
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="+91 9876543210"
                    className="w-full rounded-xl border border-[#eadbcf] bg-white px-3 py-2.5 pr-9 font-mono text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
                  />
                  <MessageCircle
                    size={14}
                    className="pointer-events-none absolute right-3 top-2.5 text-[#705a54]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#705a54]">
                  Mandatory Modification Reason (Audit Log) *
                </label>
                <textarea
                  required
                  minLength={5}
                  maxLength={500}
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="State why this contact information is being updated (e.g., typo in customer email reported via support)..."
                  className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-white p-3 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
                />
                <p className="mt-1 flex items-center gap-1 text-[10px] text-[#705a54]">
                  <ShieldAlert size={11} className="text-[#7c1619]" />
                  <span>
                    Actor identity, old/new values, and this reason are permanently logged in{" "}
                    <code className="font-mono">audit_logs</code>.
                  </span>
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[#f0e7df] pt-4">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-[#eadbcf] bg-white px-4 py-2 text-xs font-bold text-[#705a54] hover:bg-[#faf3ee]"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#7c1619] px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-[#631214] disabled:opacity-50"
                >
                  {loading && <Loader2 size={14} className="animate-spin" />}
                  <span>
                    {activeScope === "TICKET_CONTACT"
                      ? "Save Single-Ticket Contact"
                      : "Save Master Customer Profile"}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

