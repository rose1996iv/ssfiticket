"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  UserPlus,
  X,
  CheckCircle2,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  QrCode,
  KeyRound,
  Mail,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import { createSellerAccount, CreateSellerResult } from "@/server/actions/seller";

export function CreateSellerModal() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdData, setCreatedData] = useState<CreateSellerResult["seller"] | null>(null);

  // Field states
  const [fullName, setFullName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sellerCode, setSellerCode] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");

  // Copy helpers
  const [copiedField, setCopiedField] = useState<string | null>(null);

  function resetForm() {
    setFullName("");
    setDisplayName("");
    setEmail("");
    setPhone("");
    setSellerCode("");
    setTemporaryPassword("");
    setError(null);
    setCreatedData(null);
    setIsSubmitting(false);
  }

  function handleOpen() {
    resetForm();
    setIsOpen(true);
  }

  function handleClose() {
    setIsOpen(false);
    resetForm();
    router.refresh();
  }

  async function handleCopy(text: string, fieldName: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // fallback
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await createSellerAccount({
        fullName,
        displayName,
        email,
        phone: phone || undefined,
        sellerCode: sellerCode || undefined,
        temporaryPassword: temporaryPassword || undefined,
      });

      if (!res.success) {
        setError(res.error);
        setIsSubmitting(false);
        return;
      }

      setCreatedData(res.seller);
      setIsSubmitting(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to provision seller account.";
      setError(msg);
      setIsSubmitting(false);
    }
  }

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const referralUrl = createdData
    ? `${baseUrl}/buy?ref=${encodeURIComponent(createdData.sellerCode)}`
    : "";

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 rounded-xl bg-[#7c1619] px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[#631214] focus:outline-hidden focus:ring-2 focus:ring-[#7c1619]/20"
      >
        <UserPlus size={15} />
        <span>Add New Seller</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto"
        >
          <div className="relative w-full max-w-lg rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-2xl my-8">
            {/* Close Button */}
            <button
              type="button"
              onClick={handleClose}
              className="absolute right-4 top-4 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
              aria-label="Close"
            >
              <X size={18} />
            </button>

            {createdData ? (
              /* Success / Provisioned Details View */
              <div className="space-y-5">
                <div className="flex items-center gap-3 border-b border-[#f0e7df] pb-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                    <CheckCircle2 size={24} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-[#35110f]">
                      Seller Account Provisioned
                    </h2>
                    <p className="text-xs text-[#705a54]">
                      Auth user, profile, SELLER role, and referral code are active.
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-950">Referral Code</span>
                    <span className="rounded-md bg-emerald-700 px-2.5 py-0.5 font-mono text-xs font-bold text-white">
                      {createdData.sellerCode}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-emerald-900 font-medium">Display Name</span>
                    <span className="font-semibold text-emerald-950">{createdData.displayName}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-emerald-900 font-medium">Account Email</span>
                    <span className="font-mono text-emerald-950">{createdData.email}</span>
                  </div>
                </div>

                {/* Referral Link Box */}
                <div>
                  <label className="block text-xs font-bold text-[#35110f]">
                    Seller Referral URL
                  </label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={referralUrl}
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-gray-800 select-all"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopy(referralUrl, "referralUrl")}
                      className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-[#7c1619] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#631214]"
                    >
                      {copiedField === "referralUrl" ? <Check size={14} /> : <Copy size={14} />}
                      <span>{copiedField === "referralUrl" ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                </div>

                {/* Temporary Password Box */}
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-[#35110f] flex items-center gap-1">
                      <KeyRound size={13} className="text-amber-700" />
                      <span>Initial Temporary Password</span>
                    </label>
                    <span className="text-[10px] text-amber-800 font-semibold bg-amber-100 px-2 py-0.5 rounded-full">
                      Shown once only
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={createdData.temporaryPassword}
                      className="w-full rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 font-mono text-xs font-bold text-amber-950 select-all"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopy(createdData.temporaryPassword, "password")}
                      className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-950 transition hover:bg-amber-50"
                    >
                      {copiedField === "password" ? <Check size={14} /> : <Copy size={14} />}
                      <span>{copiedField === "password" ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-[#705a54]">
                    Provide this temporary password to the seller securely. They will sign in at{" "}
                    <span className="font-mono text-[#7c1619]">/login</span>.
                  </p>
                </div>

                {/* One-Time Activation Link (if available) */}
                {createdData.activationLink && (
                  <div>
                    <label className="block text-xs font-bold text-[#35110f] flex items-center gap-1">
                      <Mail size={13} className="text-blue-600" />
                      <span>Direct Activation / Password Setup Link</span>
                    </label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={createdData.activationLink}
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-gray-700 select-all"
                      />
                      <button
                        type="button"
                        onClick={() => handleCopy(createdData.activationLink!, "activationLink")}
                        className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-900 transition hover:bg-blue-100"
                      >
                        {copiedField === "activationLink" ? <Check size={14} /> : <Copy size={14} />}
                        <span>{copiedField === "activationLink" ? "Copied" : "Copy"}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="pt-2 flex items-center justify-end gap-3 border-t border-[#f0e7df]">
                  <a
                    href={referralUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition"
                  >
                    <ExternalLink size={14} />
                    <span>Test Referral Link</span>
                  </a>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-xl bg-[#7c1619] px-5 py-2 text-xs font-bold text-white transition hover:bg-[#631214]"
                  >
                    Done & Refresh List
                  </button>
                </div>
              </div>
            ) : (
              /* Input Form View */
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="border-b border-[#f0e7df] pb-3">
                  <div className="flex items-center gap-2 text-[#7c1619]">
                    <ShieldCheck size={18} />
                    <h2 className="text-base font-bold text-[#35110f]">
                      Provision New Seller Account
                    </h2>
                  </div>
                  <p className="mt-1 text-xs text-[#705a54]">
                    Creates an authenticated partner account with the SELLER role and unique QR referral code.
                  </p>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-950"
                  >
                    <AlertCircle size={16} className="shrink-0 text-red-600 mt-0.5" />
                    <p className="font-medium leading-relaxed">{error}</p>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-[#35110f]">
                      Full Legal Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Rajesh Kumar"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7]/50 px-3 py-2 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden focus:ring-1 focus:ring-[#7c1619]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#35110f]">
                      Public Display Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Coach Rajesh (Delhi Club)"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7]/50 px-3 py-2 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden focus:ring-1 focus:ring-[#7c1619]"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-[#35110f]">
                      Login Email Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="e.g. rajesh@speedskating.org"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7]/50 px-3 py-2 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden focus:ring-1 focus:ring-[#7c1619]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#35110f]">
                      Phone / WhatsApp Number
                    </label>
                    <input
                      type="tel"
                      placeholder="e.g. +91 98765 43210"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7]/50 px-3 py-2 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden focus:ring-1 focus:ring-[#7c1619]"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-[#35110f]">
                      Custom Seller Code <span className="text-[10px] text-[#705a54] font-normal">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Auto-generated if left blank"
                      value={sellerCode}
                      onChange={(e) => setSellerCode(e.target.value.toUpperCase())}
                      className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7]/50 px-3 py-2 font-mono text-xs uppercase text-[#35110f] focus:border-[#7c1619] focus:outline-hidden focus:ring-1 focus:ring-[#7c1619]"
                    />
                    <p className="mt-0.5 text-[10px] text-[#705a54]">
                      Format: SELLER-XXX (e.g., SELLER-005)
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#35110f]">
                      Custom Password <span className="text-[10px] text-[#705a54] font-normal">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Auto-generated if left blank"
                      value={temporaryPassword}
                      onChange={(e) => setTemporaryPassword(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7]/50 px-3 py-2 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden focus:ring-1 focus:ring-[#7c1619]"
                    />
                    <p className="mt-0.5 text-[10px] text-[#705a54]">
                      Min. 8 characters if specified
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3 text-[11px] text-[#705a54]">
                  <p className="flex items-center gap-1.5 font-semibold text-[#35110f]">
                    <QrCode size={13} className="text-[#7c1619]" />
                    <span>Automatic QR Standee & Referral Link</span>
                  </p>
                  <p className="mt-0.5">
                    Upon creation, a unique QR code standee and referral link (`/buy?ref=SELLER-XXX`) will be immediately issued for this seller.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={isSubmitting}
                    className="rounded-xl border border-[#eadbcf] bg-white px-4 py-2.5 text-xs font-semibold text-[#705a54] transition hover:bg-gray-50 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#7c1619] px-5 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#631214] disabled:opacity-70"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>Provisioning...</span>
                      </>
                    ) : (
                      <>
                        <UserPlus size={14} />
                        <span>Provision Seller Account</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
