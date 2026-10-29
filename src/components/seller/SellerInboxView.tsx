"use client";

import { useState } from "react";
import {
  Archive,
  CheckCircle2,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  MessageSquare,
  Plus,
  Reply,
  Send,
  Shield,
  User,
  X,
} from "lucide-react";
import { formatIstDateTime } from "@/lib/date/timezone";
import {
  markSellerMessageAsRead,
  archiveSellerMessage,
  sendSellerToAdminMessage,
} from "@/server/actions/messages";

export type SellerInboxMessage = {
  id: string;
  subject: string;
  body: string;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
  sender_role?: "ADMIN" | "SELLER";
  parent_message_id?: string | null;
  profiles: { full_name: string; email: string } | null;
};

type Props = {
  messages: SellerInboxMessage[];
};

export function SellerInboxView({ messages }: Props) {
  const [activeTab, setActiveTab] = useState<"INBOX" | "ARCHIVED">("INBOX");
  const [selectedMessage, setSelectedMessage] = useState<SellerInboxMessage | null>(null);

  // New Inquiry Compose State
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeSuccess, setComposeSuccess] = useState<string | null>(null);

  // In-message reply state
  const [isReplying, setIsReplying] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySuccess, setReplySuccess] = useState<string | null>(null);

  const inboxMessages = messages.filter((m) => !m.archived_at);
  const archivedMessages = messages.filter((m) => Boolean(m.archived_at));
  const unreadCount = inboxMessages.filter((m) => !m.read_at && m.sender_role !== "SELLER").length;

  const currentList = activeTab === "INBOX" ? inboxMessages : archivedMessages;

  async function handleOpenMessage(msg: SellerInboxMessage) {
    setSelectedMessage(msg);
    setIsReplying(false);
    setReplyBody("");
    setReplyError(null);
    setReplySuccess(null);

    // If message is unread and sent by admin, automatically mark as read
    if (!msg.read_at && msg.sender_role !== "SELLER") {
      const formData = new FormData();
      formData.set("messageId", msg.id);
      try {
        await markSellerMessageAsRead(formData);
      } catch (err) {
        console.error("Failed to mark message read:", err);
      }
    }
  }

  async function handleArchive(msgId: string) {
    const formData = new FormData();
    formData.set("messageId", msgId);
    try {
      await archiveSellerMessage(formData);
      if (selectedMessage?.id === msgId) {
        setSelectedMessage(null);
      }
    } catch (err) {
      console.error("Failed to archive message:", err);
    }
  }

  async function handleSendCompose(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setComposeError(null);
    setComposeSuccess(null);

    const formData = new FormData();
    formData.set("subject", composeSubject.trim());
    formData.set("body", composeBody.trim());

    try {
      const res = await sendSellerToAdminMessage(formData);
      if (!res.success) {
        setComposeError(res.error || "Failed to send message to administration.");
      } else {
        setComposeSuccess(res.message || "Your message has been delivered to SSFI Admin.");
        setComposeSubject("");
        setComposeBody("");
        setTimeout(() => {
          setIsComposeOpen(false);
          setComposeSuccess(null);
        }, 1500);
      }
    } catch (err: unknown) {
      setComposeError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMessage) return;

    setIsSendingReply(true);
    setReplyError(null);
    setReplySuccess(null);

    const formData = new FormData();
    const replySubject = selectedMessage.subject.startsWith("Re: ")
      ? selectedMessage.subject
      : `Re: ${selectedMessage.subject}`;

    formData.set("subject", replySubject);
    formData.set("body", replyBody.trim());
    formData.set("parentMessageId", selectedMessage.id);

    try {
      const res = await sendSellerToAdminMessage(formData);
      if (!res.success) {
        setReplyError(res.error || "Failed to send reply.");
      } else {
        setReplySuccess(res.message || "Reply delivered to SSFI Admin!");
        setReplyBody("");
        setTimeout(() => {
          setIsReplying(false);
          setReplySuccess(null);
        }, 1500);
      }
    } catch (err: unknown) {
      setReplyError(err instanceof Error ? err.message : "Failed to send reply.");
    } finally {
      setIsSendingReply(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Tabs & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#eadbcf] pb-4">
        <div className="flex items-center gap-2">
          <Inbox className="text-[#7c1619]" size={24} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#35110f]">Seller Inbox & Messages</h1>
            <p className="text-xs text-[#705a54]">
              Direct communication between your authorized seller account and SSFI administrative staff.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setIsComposeOpen(true);
              setComposeError(null);
              setComposeSuccess(null);
            }}
            className="flex items-center gap-1.5 rounded-xl bg-[#7c1619] px-4 py-2 text-xs font-bold text-white shadow-2xs transition hover:bg-[#631214]"
          >
            <Plus size={14} />
            <span>Contact SSFI Admin</span>
          </button>

          <div className="flex items-center gap-1 rounded-xl border border-[#eadbcf] bg-white p-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("INBOX")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition ${
                activeTab === "INBOX"
                  ? "bg-[#7c1619] text-white shadow-2xs"
                  : "text-[#705a54] hover:text-[#7c1619]"
              }`}
            >
              <Mail size={14} />
              <span>Active</span>
              {unreadCount > 0 && (
                <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.2 text-[10px] font-mono">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("ARCHIVED")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition ${
                activeTab === "ARCHIVED"
                  ? "bg-[#7c1619] text-white shadow-2xs"
                  : "text-[#705a54] hover:text-[#7c1619]"
              }`}
            >
              <Archive size={14} />
              <span>Archived ({archivedMessages.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Message List */}
      <div className="rounded-2xl border border-[#eadbcf] bg-white shadow-xs overflow-hidden">
        {currentList.length === 0 ? (
          <div className="py-16 text-center text-xs text-[#705a54]">
            <MessageSquare size={36} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm font-bold text-[#35110f]">
              {activeTab === "INBOX" ? "Your inbox is clear" : "No archived messages"}
            </p>
            <p className="mt-1 text-[#705a54]">
              {activeTab === "INBOX"
                ? "Notices from SSFI administrators and your sent inquiries will appear here."
                : "Messages you archive will be stored here for future reference."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#f0e7df]">
            {currentList.map((msg) => {
              const isSentBySeller = msg.sender_role === "SELLER";
              const isUnread = !msg.read_at && !isSentBySeller;

              return (
                <div
                  key={msg.id}
                  onClick={() => handleOpenMessage(msg)}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 text-xs cursor-pointer transition ${
                    isUnread
                      ? "bg-[#fffaf7] font-semibold hover:bg-[#f8ede4]"
                      : "hover:bg-gray-50 text-[#594541]"
                  }`}
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="mt-0.5 shrink-0">
                      {isSentBySeller ? (
                        <User className="text-emerald-700" size={18} />
                      ) : isUnread ? (
                        <Mail className="text-[#a41f23]" size={18} />
                      ) : (
                        <MailOpen className="text-gray-400" size={18} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`truncate text-sm ${
                            isUnread ? "font-bold text-[#7c1619]" : "text-[#35110f]"
                          }`}
                        >
                          {msg.subject}
                        </span>
                        {isSentBySeller ? (
                          <span className="shrink-0 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-800">
                            Sent by You
                          </span>
                        ) : isUnread ? (
                          <span className="shrink-0 rounded-full bg-[#fceeee] px-2 py-0.5 font-mono text-[10px] font-bold text-[#a41f23]">
                            New
                          </span>
                        ) : (
                          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[10px] text-gray-600">
                            Staff Notice
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-[#705a54] line-clamp-1 truncate">
                        {msg.body}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <span className="font-mono text-[11px] text-[#705a54]">
                      {formatIstDateTime(msg.created_at)}
                    </span>
                    <button
                      type="button"
                      className="rounded-lg border border-[#eadbcf] bg-white px-2.5 py-1 text-xs font-semibold text-[#7c1619] hover:bg-[#fffaf7]"
                    >
                      View
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Message Reader Modal */}
      {selectedMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-2xs">
          <div className="w-full max-w-lg rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between border-b border-[#f0e7df] pb-4">
              <div className="flex items-center gap-2">
                {selectedMessage.sender_role === "SELLER" ? (
                  <User size={20} className="text-emerald-700 shrink-0" />
                ) : (
                  <Shield size={20} className="text-[#7c1619] shrink-0" />
                )}
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
                    {selectedMessage.sender_role === "SELLER"
                      ? "Your Sent Inquiry"
                      : "Official Staff Message"}
                  </span>
                  <h3 className="text-base font-bold text-[#35110f] mt-0.5">
                    {selectedMessage.subject}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMessage(null)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>

            <div className="my-4 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-semibold uppercase text-[#705a54]">Sender</span>
                  <p className="font-bold text-[#7c1619]">
                    {selectedMessage.sender_role === "SELLER"
                      ? "You (Authorized Seller)"
                      : selectedMessage.profiles?.full_name || "SSFI Administration"}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-semibold uppercase text-[#705a54]">Sent</span>
                  <p className="font-mono text-[11px] text-[#35110f]">
                    {formatIstDateTime(selectedMessage.created_at)}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">
                Message Content
              </span>
              <div className="mt-1.5 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-xs text-[#35110f] leading-relaxed">
                {selectedMessage.body}
              </div>
            </div>

            {/* Inline Reply Form */}
            {isReplying ? (
              <form onSubmit={handleSendReply} className="mt-4 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#7c1619] flex items-center gap-1.5">
                    <Reply size={14} />
                    <span>Reply to Administration</span>
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
                  placeholder="Type your reply or question for SSFI administration..."
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
                    disabled={isSendingReply || !replyBody.trim()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#7c1619] px-4 py-2 text-xs font-bold text-white hover:bg-[#631214] disabled:opacity-50"
                  >
                    {isSendingReply ? (
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
              <div className="flex items-center gap-3">
                {!selectedMessage.archived_at && (
                  <button
                    type="button"
                    onClick={() => handleArchive(selectedMessage.id)}
                    className="inline-flex items-center gap-1.5 text-xs text-[#705a54] hover:text-[#7c1619]"
                  >
                    <Archive size={14} />
                    <span>Archive</span>
                  </button>
                )}

                {!isReplying && (
                  <button
                    type="button"
                    onClick={() => setIsReplying(true)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-[#7c1619] hover:underline"
                  >
                    <Reply size={14} />
                    <span>Reply to Admin</span>
                  </button>
                )}
              </div>

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

      {/* Compose Inquiry Modal */}
      {isComposeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-2xs">
          <div className="w-full max-w-lg rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between border-b border-[#f0e7df] pb-4">
              <div className="flex items-center gap-2">
                <Mail className="text-[#7c1619] shrink-0" size={20} />
                <div>
                  <h3 className="text-base font-bold text-[#35110f]">Contact SSFI Administration</h3>
                  <p className="text-xs text-[#705a54]">
                    Submit an inquiry, dispute, or question directly to campaign management.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsComposeOpen(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSendCompose} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#705a54]">
                  Subject
                </label>
                <input
                  type="text"
                  required
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  placeholder="e.g., Query regarding ticket batch or payment confirmation"
                  className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] px-3.5 py-2.5 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#705a54]">
                  Message
                </label>
                <textarea
                  required
                  rows={4}
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  placeholder="Provide detailed information regarding your inquiry..."
                  className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
                />
              </div>

              {composeError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  {composeError}
                </div>
              )}

              {composeSuccess && (
                <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-xs text-green-900 font-semibold">
                  <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                  <span>{composeSuccess}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 border-t border-[#f0e7df] pt-4">
                <button
                  type="button"
                  onClick={() => setIsComposeOpen(false)}
                  className="rounded-xl border border-[#eadbcf] bg-white px-4 py-2 text-xs font-semibold text-[#705a54] hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !composeSubject.trim() || !composeBody.trim()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#7c1619] px-5 py-2 text-xs font-bold text-white hover:bg-[#631214] disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                  <span>Send Message</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
