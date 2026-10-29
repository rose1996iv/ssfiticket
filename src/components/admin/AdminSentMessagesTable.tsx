"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Clock,
  Eye,
  Filter,
  History,
  Mail,
  X,
} from "lucide-react";
import { formatIstDateTime } from "@/lib/date/timezone";

export type SentMessageItem = {
  id: string;
  subject: string;
  body: string;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
  sellers: { seller_code: string; display_name: string } | null;
  profiles: { full_name: string; email: string } | null;
};

type Props = {
  messages: SentMessageItem[];
};

export function AdminSentMessagesTable({ messages }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "READ" | "UNREAD">("ALL");
  const [selectedMessage, setSelectedMessage] = useState<SentMessageItem | null>(null);

  const filtered = messages.filter((m) => {
    const matchSearch =
      m.subject.toLowerCase().includes(search.toLowerCase()) ||
      m.sellers?.seller_code.toLowerCase().includes(search.toLowerCase()) ||
      m.sellers?.display_name.toLowerCase().includes(search.toLowerCase());

    if (!matchSearch) return false;

    if (statusFilter === "READ") return Boolean(m.read_at);
    if (statusFilter === "UNREAD") return !m.read_at;
    return true;
  });

  return (
    <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xs sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-[#f0e7df] pb-4">
        <div className="flex items-center gap-2">
          <History className="text-[#7c1619]" size={20} />
          <div>
            <h2 className="text-base font-bold text-[#35110f]">Sent Message Outbox</h2>
            <p className="text-xs text-[#705a54]">
              Track delivery logs and seller read receipts ({filtered.length} of {messages.length})
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
            {(["ALL", "UNREAD", "READ"] as const).map((filter) => (
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
                {filter === "ALL" ? "All" : filter === "UNREAD" ? "Unread" : "Read"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-12 text-center text-xs text-[#705a54]">
          <Mail size={32} className="mx-auto mb-2 text-gray-300" />
          <p className="font-semibold">No sent messages found.</p>
          <p className="mt-0.5">Use the form above to compose and send your first seller message.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#f0e7df] text-[#705a54]">
                <th className="pb-3 font-semibold">Recipient Seller</th>
                <th className="pb-3 font-semibold">Subject</th>
                <th className="pb-3 font-semibold">Dispatched (IST)</th>
                <th className="pb-3 font-semibold">Read Receipt</th>
                <th className="pb-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0e7df]">
              {filtered.map((msg) => (
                <tr key={msg.id} className="hover:bg-[#fffaf7] transition">
                  <td className="py-3">
                    <span className="font-bold text-[#35110f]">{msg.sellers?.display_name}</span>
                    <span className="ml-2 inline-block rounded-md bg-[#fceeee] px-2 py-0.5 font-mono text-[10px] font-bold text-[#a41f23]">
                      {msg.sellers?.seller_code}
                    </span>
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
                      onClick={() => setSelectedMessage(msg)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#eadbcf] bg-white px-2.5 py-1 text-xs font-semibold text-[#7c1619] shadow-2xs hover:bg-[#fffaf7]"
                    >
                      <Eye size={12} />
                      <span>View</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Message Detail Modal */}
      {selectedMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-2xs">
          <div className="w-full max-w-lg rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between border-b border-[#f0e7df] pb-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
                  In-App Seller Message
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
                <span className="text-[10px] font-semibold uppercase text-[#705a54]">Recipient</span>
                <p className="font-bold text-[#7c1619]">
                  {selectedMessage.sellers?.display_name} ({selectedMessage.sellers?.seller_code})
                </p>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase text-[#705a54]">Sent At (IST)</span>
                <p className="font-mono text-[#35110f]">
                  {formatIstDateTime(selectedMessage.created_at)}
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
              <div>
                <span className="text-[10px] font-semibold uppercase text-[#705a54]">Dispatched By</span>
                <p className="text-[#35110f]">
                  {selectedMessage.profiles?.full_name || selectedMessage.profiles?.email || "Staff"}
                </p>
              </div>
            </div>

            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">
                Message Content
              </span>
              <div className="mt-1.5 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[#eadbcf] bg-white p-4 text-xs text-[#35110f] leading-relaxed">
                {selectedMessage.body}
              </div>
            </div>

            <div className="mt-6 flex justify-end">
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
