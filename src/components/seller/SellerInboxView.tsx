"use client";

import { useState } from "react";
import {
  Archive,
  Inbox,
  Mail,
  MailOpen,
  MessageSquare,
  Shield,
  X,
} from "lucide-react";
import { formatIstDateTime } from "@/lib/date/timezone";
import { markSellerMessageAsRead, archiveSellerMessage } from "@/server/actions/messages";

export type SellerInboxMessage = {
  id: string;
  subject: string;
  body: string;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
  profiles: { full_name: string; email: string } | null;
};

type Props = {
  messages: SellerInboxMessage[];
};

export function SellerInboxView({ messages }: Props) {
  const [activeTab, setActiveTab] = useState<"INBOX" | "ARCHIVED">("INBOX");
  const [selectedMessage, setSelectedMessage] = useState<SellerInboxMessage | null>(null);

  const inboxMessages = messages.filter((m) => !m.archived_at);
  const archivedMessages = messages.filter((m) => Boolean(m.archived_at));
  const unreadCount = inboxMessages.filter((m) => !m.read_at).length;

  const currentList = activeTab === "INBOX" ? inboxMessages : archivedMessages;

  async function handleOpenMessage(msg: SellerInboxMessage) {
    setSelectedMessage(msg);

    // If message is unread, automatically mark as read
    if (!msg.read_at) {
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

  return (
    <div className="space-y-6">
      {/* Header Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#eadbcf] pb-4">
        <div className="flex items-center gap-2">
          <Inbox className="text-[#7c1619]" size={24} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#35110f]">Seller Inbox</h1>
            <p className="text-xs text-[#705a54]">
              Private messages, guidelines, and updates from SSFI administrative staff.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-[#eadbcf] bg-white p-1 text-xs">
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
            <span>Active Messages</span>
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
                ? "When SSFI administrators send you private notices, they will appear here."
                : "Messages you archive will be stored here for future reference."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#f0e7df]">
            {currentList.map((msg) => {
              const isUnread = !msg.read_at;
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
                      {isUnread ? (
                        <Mail className="text-[#a41f23]" size={18} />
                      ) : (
                        <MailOpen className="text-gray-400" size={18} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`truncate text-sm ${
                            isUnread ? "font-bold text-[#7c1619]" : "text-[#35110f]"
                          }`}
                        >
                          {msg.subject}
                        </span>
                        {isUnread && (
                          <span className="shrink-0 rounded-full bg-[#fceeee] px-2 py-0.5 font-mono text-[10px] font-bold text-[#a41f23]">
                            New
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
                      Read
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
                <Shield size={20} className="text-[#7c1619] shrink-0" />
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
                    Official Staff Message
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
                    {selectedMessage.profiles?.full_name || "SSFI Administration"}
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
              <div className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-xs text-[#35110f] leading-relaxed">
                {selectedMessage.body}
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-[#f0e7df] pt-4">
              {!selectedMessage.archived_at ? (
                <button
                  type="button"
                  onClick={() => handleArchive(selectedMessage.id)}
                  className="inline-flex items-center gap-1.5 text-xs text-[#705a54] hover:text-[#7c1619]"
                >
                  <Archive size={14} />
                  <span>Archive Message</span>
                </button>
              ) : (
                <span className="text-[11px] text-[#705a54]">Archived</span>
              )}

              <button
                type="button"
                onClick={() => setSelectedMessage(null)}
                className="rounded-xl bg-[#7c1619] px-5 py-2 text-xs font-bold text-white hover:bg-[#631214]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
