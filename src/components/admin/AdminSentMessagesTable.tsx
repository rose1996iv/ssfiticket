"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Clock,
  Eye,
  Filter,
  History,
  Loader2,
  Mail,
  Reply,
  Send,
  User,
  X,
} from "lucide-react";
import { formatIstDateTime } from "@/lib/date/timezone";
import { replyAdminToSellerMessage } from "@/server/actions/messages";

export type SentMessageItem = {
  id: string;
  subject: string;
  body: string;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
  sender_role?: "ADMIN" | "SELLER";
  parent_message_id?: string | null;
  recipient_seller_id?: string;
  sellers: { seller_code: string; display_name: string } | null;
  profiles: { full_name: string; email: string } | null;
};

type Props = {
  messages: SentMessageItem[];
};

export function AdminSentMessagesTable({ messages }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "INCOMING" | "OUTGOING" | "UNREAD" | "READ">("ALL");
  const [selectedMessage, setSelectedMessage] = useState<SentMessageItem | null>(null);

  // Reply form state
  const [isReplying, setIsReplying] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySuccess, setReplySuccess] = useState<string | null>(null);

  const filtered = messages.filter((m) => {
    const matchSearch =
      m.subject.toLowerCase().includes(search.toLowerCase()) ||
      m.sellers?.seller_code.toLowerCase().includes(search.toLowerCase()) ||
      m.sellers?.display_name.toLowerCase().includes(search.toLowerCase());

    if (!matchSearch) return false;

    if (statusFilter === "INCOMING") return m.sender_role === "SELLER";
    if (statusFilter === "OUTGOING") return m.sender_role !== "SELLER";
    if (statusFilter === "READ") return Boolean(m.read_at);
    if (statusFilter === "UNREAD") return !m.read_at;
    return true;
  });

  const incomingCount = messages.filter((m) => m.sender_role === "SELLER").length;

  const handleOpenModal = (msg: SentMessageItem) => {
    setSelectedMessage(msg);
    setIsReplying(false);
    setReplyBody("");
    setReplyError(null);
    setReplySuccess(null);
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMessage || !selectedMessage.recipient_seller_id) {
      setReplyError("Cannot reply: recipient seller information is missing.");
      return;
    }

    setIsSubmittingReply(true);
    setReplyError(null);
    setReplySuccess(null);

    const formData = new FormData();
    const replySubject = selectedMessage.subject.startsWith("Re: ")
      ? selectedMessage.subject
      : `Re: ${selectedMessage.subject}`;

    formData.set("recipientSellerId", selectedMessage.recipient_seller_id);
    formData.set("parentMessageId", selectedMessage.id);
    formData.set("subject", replySubject);
    formData.set("body", replyBody.trim());

    try {
      const res = await replyAdminToSellerMessage(formData);
      if (!res.success) {
        setReplyError(res.error || "Failed to deliver reply to seller.");
      } else {
        setReplySuccess(res.message || "Reply delivered to seller successfully!");
        setReplyBody("");
        setTimeout(() => {
          setIsReplying(false);
          setReplySuccess(null);
        }, 1500);
      }
    } catch (err: unknown) {
      setReplyError(err instanceof Error ? err.message : "Failed to deliver reply.");
    } finally {
      setIsSubmittingReply(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xs sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-[#f0e7df] pb-4">
        <div className="flex items-center gap-2">
          <History className="text-[#7c1619]" size={20} />
          <div>
            <h2 className="text-base font-bold text-[#35110f]">Seller Communications & Inquiries</h2>
            <p className="text-xs text-[#705a54]">
              Track announcements, incoming seller inquiries, and delivery receipts ({filtered.length} of {messages.length})
            </p>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Filter size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code or subject..."
              className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] py-1.5 pl-8 pr-3 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
            />
          </div>

          <div className="flex rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-0.5 text-xs">
            {(["ALL", "INCOMING", "OUTGOING", "UNREAD", "READ"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                  statusFilter === filter
                    ? "bg-[#7c1619] text-white shadow-2xs"
                    : "text-[#705a54] hover:text-[#7c1619]"
                }`}
              >
                {filter === "ALL"
                  ? "All"
                  : filter === "INCOMING"
                  ? `Inquiries (${incomingCount})`
                  : filter === "OUTGOING"
                  ? "Staff Notices"
                  : filter === "UNREAD"
                  ? "Unread"
                  : "Read"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-12 text-center text-xs text-[#705a54]">
          <Mail size={32} className="mx-auto mb-2 text-gray-300" />
          <p className="font-semibold">No messages found matching criteria.</p>
          <p className="mt-0.5">Use the form above to compose and send your first seller message.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#f0e7df] text-[#705a54]">
                <th className="pb-3 font-semibold">Direction / Seller</th>
                <th className="pb-3 font-semibold">Subject</th>
                <th className="pb-3 font-semibold">Dispatched (IST)</th>
                <th className="pb-3 font-semibold">Read Receipt</th>
                <th className="pb-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0e7df]">
              {filtered.map((msg) => {
                const isSellerInquiry = msg.sender_role === "SELLER";

                return (
                  <tr key={msg.id} className="hover:bg-[#fffaf7] transition">
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        {isSellerInquiry ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-800">
                            <User size={10} />
                            <span>Inquiry</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 border border-blue-200 px-2 py-0.5 font-mono text-[10px] font-bold text-blue-800">
                            <span>Staff Notice</span>
                          </span>
                        )}
                        <span className="font-bold text-[#35110f]">{msg.sellers?.display_name}</span>
                        <span className="rounded-md bg-[#fceeee] px-2 py-0.5 font-mono text-[10px] font-bold text-[#a41f23]">
                          {msg.sellers?.seller_code}
                        </span>
                      </div>
                    </td>
                    <td className="py-3">
                      <p className="font-semibold text-[#35110f] max-w-xs truncate" title={msg.subject}>
                        {msg.subject}
                      </p>
                      <p className="text-[11px] text-[#705a54] max-w-xs truncate">{msg.body}</p>
                    </td>
                    <td className="py-3 font-mono text-[#705a54]">
                      {formatIstDateTime(msg.created_at)}
                    </td>
                    <td className="py-3">
                      {msg.read_at ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                          <CheckCircle2 size={12} />
                          <span>Read ({formatIstDateTime(msg.read_at)})</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
                          <Clock size={12} />
                          <span>Unread</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleOpenModal(msg)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#eadbcf] bg-white px-2.5 py-1 text-xs font-semibold text-[#7c1619] shadow-2xs hover:bg-[#fffaf7]"
                      >
                        <Eye size={12} />
                        <span>View</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Message Detail & Reply Modal */}
      {selectedMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-2xs">
          <div className="w-full max-w-lg rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between border-b border-[#f0e7df] pb-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
                  {selectedMessage.sender_role === "SELLER"
                    ? "Incoming Seller Inquiry"
                    : "Staff Outgoing Notice"}
                </span>
                <h3 className="text-base font-bold text-[#35110f] mt-0.5">
                  {selectedMessage.subject}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMessage(null)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>

            <div className="my-4 grid gap-3 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3 text-xs sm:grid-cols-2">
              <div>
                <span className="text-[10px] font-semibold uppercase text-[#705a54]">Seller</span>
                <p className="font-bold text-[#7c1619]">
                  {selectedMessage.sellers?.display_name} ({selectedMessage.sellers?.seller_code})
                </p>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase text-[#705a54]">Dispatched (IST)</span>
                <p className="font-mono text-[#35110f]">
                  {formatIstDateTime(selectedMessage.created_at)}
                </p>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase text-[#705a54]">Sender</span>
                <p className="text-[#35110f] font-semibold">
                  {selectedMessage.sender_role === "SELLER"
                    ? "Seller Inquiry"
                    : selectedMessage.profiles?.full_name || selectedMessage.profiles?.email || "Staff"}
                </p>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase text-[#705a54]">Read Status</span>
                <p className="font-semibold text-[#35110f]">
                  {selectedMessage.read_at
                    ? `Read on ${formatIstDateTime(selectedMessage.read_at)}`
                    : "Unread"}
                </p>
              </div>
            </div>

            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">
                Message Content
              </span>
              <div className="mt-1.5 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[#eadbcf] bg-white p-4 text-xs text-[#35110f] leading-relaxed">
                {selectedMessage.body}
              </div>
            </div>

            {/* Inline Staff Reply Form */}
            {isReplying ? (
              <form onSubmit={handleSendReply} className="mt-4 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#7c1619] flex items-center gap-1.5">
                    <Reply size={14} />
                    <span>Reply to {selectedMessage.sellers?.display_name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsReplying(false)}
                    className="text-[11px] text-gray-500 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                </div>

                <textarea
                  required
                  rows={3}
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Type official response to seller..."
                  className="w-full rounded-xl border border-[#eadbcf] bg-white p-3 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
                />

                {replyError && (
                  <p className="text-xs font-semibold text-red-700">{replyError}</p>
                )}
                {replySuccess && (
                  <p className="text-xs font-semibold text-green-700">{replySuccess}</p>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="submit"
                    disabled={isSubmittingReply || !replyBody.trim()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#7c1619] px-4 py-2 text-xs font-bold text-white hover:bg-[#631214] disabled:opacity-50"
                  >
                    {isSubmittingReply ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Send size={13} />
                    )}
                    <span>Send Reply</span>
                  </button>
                </div>
              </form>
            ) : null}

            <div className="mt-6 flex items-center justify-between border-t border-[#f0e7df] pt-4">
              {!isReplying && selectedMessage.recipient_seller_id ? (
                <button
                  type="button"
                  onClick={() => setIsReplying(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-[#7c1619] hover:underline"
                >
                  <Reply size={14} />
                  <span>Reply to Seller</span>
                </button>
              ) : (
                <div />
              )}

              <button
                type="button"
                onClick={() => setSelectedMessage(null)}
                className="rounded-xl bg-[#7c1619] px-4 py-2 text-xs font-bold text-white hover:bg-[#631214]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
