"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Filter,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { sendAdminSellerMessage } from "@/server/actions/messages";

type SellerOption = {
  id: string;
  seller_code: string;
  display_name: string;
  is_active: boolean;
};

type Props = {
  sellers: SellerOption[];
};

export function AdminMessageCompose({ sellers }: Props) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filterText, setFilterText] = useState("");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const activeSellers = sellers.filter((s) => s.is_active);

  const filteredSellers = activeSellers.filter(
    (s) =>
      s.seller_code.toLowerCase().includes(filterText.toLowerCase()) ||
      s.display_name.toLowerCase().includes(filterText.toLowerCase())
  );

  function toggleSeller(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  function selectAllFiltered() {
    const idsToAdd = filteredSellers.map((s) => s.id);
    setSelectedIds((prev) => Array.from(new Set([...prev, ...idsToAdd])));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  const selectedSellers = activeSellers.filter((s) => selectedIds.includes(s.id));

  async function handleSend() {
    setIsSubmitting(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    const formData = new FormData();
    formData.set("subject", subject);
    formData.set("body", body);
    selectedIds.forEach((id) => formData.append("sellerIds", id));

    try {
      const res = await sendAdminSellerMessage(formData);
      setSuccessMsg(res.message);
      setSubject("");
      setBody("");
      setSelectedIds([]);
      setIsConfirmOpen(false);
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Failed to send message. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xs sm:p-8">
      <div className="mb-6 flex items-center justify-between border-b border-[#f0e7df] pb-4">
        <div className="flex items-center gap-2">
          <Mail className="text-[#7c1619]" size={22} />
          <div>
            <h2 className="text-lg font-bold text-[#35110f]">Compose In-App Seller Message</h2>
            <p className="text-xs text-[#705a54]">
              Deliver private administrative messages directly to seller dashboards.
            </p>
          </div>
        </div>
        <span className="rounded-full bg-[#fceeee] px-3 py-1 font-mono text-xs font-bold text-[#a41f23]">
          {activeSellers.length} Active Sellers
        </span>
      </div>

      {successMsg && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-xs font-semibold text-emerald-900">
          <CheckCircle2 size={16} className="text-emerald-700 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 p-4 text-xs font-semibold text-red-900">
          <AlertTriangle size={16} className="text-red-700 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Recipient Selection Column */}
        <div className="space-y-4 lg:col-span-5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-[#705a54] flex items-center gap-1.5">
              <Users size={14} className="text-[#7c1619]" />
              Select Recipients ({selectedIds.length})
            </label>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={selectAllFiltered}
                className="text-[11px] font-semibold text-[#7c1619] hover:underline"
              >
                Select All
              </button>
              <span className="text-gray-300">|</span>
              <button
                type="button"
                onClick={clearSelection}
                className="text-[11px] text-[#705a54] hover:underline"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Quick search input */}
          <div className="relative">
            <Filter
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search code or seller name..."
              className="w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] py-2 pl-8 pr-3 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
            />
          </div>

          {/* Scrollable Seller Checklist */}
          <div className="max-h-64 overflow-y-auto rounded-xl border border-[#eadbcf] bg-white divide-y divide-[#f0e7df]">
            {filteredSellers.length === 0 ? (
              <p className="p-4 text-center text-xs text-[#705a54]">
                No active sellers match your search.
              </p>
            ) : (
              filteredSellers.map((seller) => {
                const isSelected = selectedIds.includes(seller.id);
                return (
                  <label
                    key={seller.id}
                    className={`flex items-center justify-between p-3 text-xs cursor-pointer transition ${
                      isSelected ? "bg-[#fffaf7]" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSeller(seller.id)}
                        className="h-4 w-4 rounded-sm border-gray-300 text-[#7c1619] focus:ring-[#7c1619]"
                      />
                      <div>
                        <p className="font-semibold text-[#35110f]">{seller.display_name}</p>
                        <p className="font-mono text-[11px] text-[#705a54]">{seller.seller_code}</p>
                      </div>
                    </div>
                    {isSelected && (
                      <span className="rounded-full bg-[#fceeee] px-2 py-0.5 text-[10px] font-bold text-[#a41f23]">
                        Selected
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>

          {/* Selection Summary Pill */}
          {selectedIds.length > 0 && (
            <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3 text-xs">
              <p className="font-semibold text-[#35110f] flex items-center gap-1.5">
                <UserCheck size={14} className="text-[#7c1619]" />
                {selectedIds.length} Seller{selectedIds.length > 1 ? "s" : ""} Targeted:
              </p>
              <p className="mt-1 font-mono text-[11px] text-[#705a54] leading-relaxed">
                {selectedSellers.map((s) => s.seller_code).join(", ")}
              </p>
            </div>
          )}
        </div>

        {/* Message Content Column */}
        <div className="space-y-4 lg:col-span-7">
          <div>
            <label
              htmlFor="msg-subject"
              className="block text-xs font-bold uppercase tracking-wider text-[#705a54]"
            >
              Message Subject <span className="text-red-500">*</span>
            </label>
            <input
              id="msg-subject"
              type="text"
              required
              minLength={2}
              maxLength={200}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Campaign Launch Announcement & Sales Guidelines"
              className="mt-1.5 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3 text-xs text-[#35110f] shadow-2xs focus:border-[#7c1619] focus:outline-hidden"
            />
          </div>

          <div>
            <label
              htmlFor="msg-body"
              className="block text-xs font-bold uppercase tracking-wider text-[#705a54]"
            >
              Message Body <span className="text-red-500">*</span>
            </label>
            <textarea
              id="msg-body"
              required
              rows={7}
              minLength={5}
              maxLength={5000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type your message to sellers here. Include instructions, bank verification notes, or important milestone notices..."
              className="mt-1.5 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3 text-xs text-[#35110f] shadow-2xs focus:border-[#7c1619] focus:outline-hidden"
            />
            <div className="mt-1 flex justify-between text-[11px] text-[#705a54]">
              <span>Plain text formatted for seller inbox readability.</span>
              <span>{body.length} / 5,000 characters</span>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              disabled={
                selectedIds.length === 0 ||
                subject.trim().length < 2 ||
                body.trim().length < 5 ||
                isSubmitting
              }
              onClick={() => setIsConfirmOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7c1619] py-3 text-xs font-bold text-white shadow-xs transition hover:bg-[#631214] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send size={15} />
              <span>
                Review & Send Message ({selectedIds.length} Recipient{selectedIds.length === 1 ? "" : "s"})
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {isConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-2xs">
          <div className="w-full max-w-md rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xl">
            <div className="flex items-center gap-2 text-[#7c1619]">
              <ShieldCheck size={22} />
              <h3 className="font-bold text-base text-[#35110f]">Confirm Message Dispatch</h3>
            </div>

            <p className="mt-3 text-xs text-[#705a54] leading-relaxed">
              You are about to dispatch this private in-app message to{" "}
              <b>{selectedIds.length}</b> verified active seller{selectedIds.length > 1 ? "s" : ""}.
            </p>

            <div className="my-4 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3 text-xs">
              <p className="text-[11px] font-semibold uppercase text-[#705a54]">Subject</p>
              <p className="mt-0.5 font-bold text-[#7c1619]">{subject}</p>
              <p className="mt-2 text-[11px] font-semibold uppercase text-[#705a54]">
                Target Recipients ({selectedIds.length})
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-[#35110f] max-h-16 overflow-y-auto">
                {selectedSellers.map((s) => `${s.display_name} (${s.seller_code})`).join(", ")}
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsConfirmOpen(false)}
                className="rounded-xl border border-[#eadbcf] bg-white px-4 py-2 text-xs font-bold text-[#705a54] hover:bg-gray-50"
              >
                Back to Edit
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleSend}
                className="flex items-center gap-1.5 rounded-xl bg-[#7c1619] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#631214] disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    <span>Confirm & Send</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

