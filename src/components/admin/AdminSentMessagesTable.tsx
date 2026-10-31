"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  Eye,
  Filter,
  History,
  Loader2,
  Mail,
  MessageSquare,
  Reply,
  Send,
  Shield,
  User,
  X,
} from "lucide-react";
import { formatIstDateTime } from "@/lib/date/timezone";
import {
  findRootMessageId,
  getConversationThread,
  getThreadReplyCount,
} from "@/lib/messaging/threading";
import {
  replyAdminToSellerMessage,
  markAdminMessageAsRead,
} from "@/server/actions/messages";

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
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "INCOMING" | "OUTGOING" | "UNREAD" | "READ"
  >("ALL");
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

  const handleOpenModal = async (msg: SentMessageItem) => {
    setSelectedMessage(msg);
    setIsReplying(false);
    setReplyBody("");
    setReplyError(null);
    setReplySuccess(null);

    // If opening an unread seller inquiry, mark as read by staff
    if (msg.sender_role === "SELLER" && !msg.read_at) {
      const formData = new FormData();
      formData.set("messageId", msg.id);
      try {
        await markAdminMessageAsRead(formData);
        router.refresh();
      } catch (err) {
        console.error("Failed to mark inquiry read by admin:", err);
      }
    }
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

    // Find the thread root message ID so all replies in this thread are unified
    const threadRootId = findRootMessageId(selectedMessage, messages);

    const formData = new FormData();
    const replySubject = selectedMessage.subject.startsWith("Re: ")
      ? selectedMessage.subject
      : `Re: ${selectedMessage.subject}`;

    formData.set("recipientSellerId", selectedMessage.recipient_seller_id);
    formData.set("parentMessageId", threadRootId);
    formData.set("subject", replySubject);
    formData.set("body", replyBody.trim());

    try {
      const res = await replyAdminToSellerMessage(formData);
      if (!res.success) {
        setReplyError(res.error || "Failed to deliver reply to seller.");
      } else {
        setReplySuccess(res.message || "Reply delivered to seller successfully!");
        setReplyBody("");
        router.refresh();
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

  // Reconstruct conversation thread if a message is selected
  const activeThread = selectedMessage
    ? getConversationThread(selectedMessage, messages)
    : [];

  return (
    <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xs sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-[#f0e7df] pb-4">
        <div className="flex items-center gap-2">
          <History className="text-[#7c1619]" size={20} />
          <div>
            <h2 className="text-base font-bold text-[#35110f]">
              Seller Communications & Inquiries
            </h2>
            <p className="text-xs text-[#705a54]">
              Track announcements, incoming seller inquiries, and conversation threads ({filtered.length} of {messages.length})
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
                <th className="pb-3 font-semibold">Subject & Thread</th>
                <th className="pb-3 font-semibold">Dispatched (IST)</th>
                <th className="pb-3 font-semibold">Status / Receipt</th>
                <th className="pb-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0e7df]">
              {filtered.map((msg) => {
                const isSellerInquiry = msg.sender_role === "SELLER";
                const replyCount = getThreadReplyCount(msg, messages);

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
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-[#35110f] max-w-xs truncate" title={msg.subject}>
                          {msg.subject}
                        </p>
                        {replyCount > 0 && (
                          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-purple-50 border border-purple-200 px-2 py-0.2 font-mono text-[10px] font-bold text-purple-700">
                            <MessageSquare size={9} />
                            <span>{replyCount + 1} thread</span>
                          </span>
                        )}
                      </div>
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
                        <span>View Thread</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Message Detail & Conversation Thread Modal */}
      {selectedMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-2xs">
          <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-[#eadbcf] bg-white shadow-xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-[#f0e7df] p-6 pb-4 shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-[#fceeee] px-2.5 py-0.5 font-mono text-[10px] font-bold text-[#a41f23]">
                    {selectedMessage.sellers?.seller_code} · {selectedMessage.sellers?.display_name}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
                    Conversation Thread ({activeThread.length} message{activeThread.length > 1 ? "s" : ""})
                  </span>
                </div>
                <h3 className="text-base font-bold text-[#35110f] mt-1">
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

            {/* Modal Conversation Thread Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-[#705a54] block">
                Conversation History
              </span>

              {activeThread.map((threadMsg, idx) => {
                const isSeller = threadMsg.sender_role === "SELLER";

                return (
                  <div
                    key={threadMsg.id}
                    className={`rounded-xl border p-4 text-xs transition ${
                      isSeller
                        ? "border-emerald-200 bg-emerald-50/40 ml-4 sm:ml-8"
                        : "border-[#eadbcf] bg-[#fffaf7] mr-4 sm:mr-8"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 pb-2 mb-2">
                      <div className="flex items-center gap-1.5">
                        {isSeller ? (
                          <>
                            <User size={14} className="text-emerald-700 shrink-0" />
                            <span className="font-bold text-emerald-900">
                              {threadMsg.sellers?.display_name || "Seller"} ({threadMsg.sellers?.seller_code || "SELLER"})
                            </span>
                            <span className="rounded-full bg-emerald-100 px-2 py-0.2 font-mono text-[9px] font-bold text-emerald-800">
                              {idx === 0 ? "Original Inquiry" : "Seller Reply"}
                            </span>
                          </>
                        ) : (
                          <>
                            <Shield size={14} className="text-[#7c1619] shrink-0" />
                            <span className="font-bold text-[#7c1619]">
                              {threadMsg.profiles?.full_name || "SSFI Staff"}
                            </span>
                            <span className="rounded-full bg-blue-100 px-2 py-0.2 font-mono text-[9px] font-bold text-blue-800">
                              {idx === 0 ? "Staff Announcement" : "Staff Response"}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-[#705a54]">
                          {formatIstDateTime(threadMsg.created_at)}
                        </span>
                        {threadMsg.read_at ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700">
                            <CheckCircle2 size={10} />
                            <span>Read</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700">
                            <Clock size={10} />
                            <span>Unread</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="whitespace-pre-wrap leading-relaxed text-[#35110f]">
                      {threadMsg.body}
                    </div>
                  </div>
                );
              })}

              {/* Inline Staff Reply Form */}
              {isReplying ? (
                <form
                  onSubmit={handleSendReply}
                  className="rounded-xl border border-[#eadbcf] bg-white p-4 shadow-2xs space-y-3"
                >
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
                    className="w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
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
                      <span>Send Official Reply</span>
                    </button>
                  </div>
                </form>
              ) : null}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-[#f0e7df] p-4 bg-[#fffaf7] shrink-0">
              {!isReplying && selectedMessage.recipient_seller_id ? (
                <button
                  type="button"
                  onClick={() => setIsReplying(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#eadbcf] bg-white px-4 py-2 text-xs font-bold text-[#7c1619] hover:bg-[#fceeee]"
                >
                  <Reply size={14} />
                  <span>Reply to Thread</span>
                </button>
              ) : (
                <div />
              )}

              <button
                type="button"
                onClick={() => setSelectedMessage(null)}
                className="rounded-xl bg-[#7c1619] px-5 py-2 text-xs font-bold text-white hover:bg-[#631214]"
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
