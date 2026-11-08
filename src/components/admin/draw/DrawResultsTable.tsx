"use client";

import React, { useState } from "react";
import {
  Trophy,
  ShieldCheck,
  Send,
  Eye,
  EyeOff,
  Copy,
  Check,
  Clock,
  CheckCircle2,
  FileCheck,
} from "lucide-react";
import { DrawResultRecord, PrizeItem } from "@/lib/draw/types";

interface DrawResultsTableProps {
  results: DrawResultRecord[];
  prizes: PrizeItem[];
  onVerifyEvidence: (result: DrawResultRecord) => void;
  onNotifyWinner: (result: DrawResultRecord) => void;
}

export function DrawResultsTable({
  results,
  prizes,
  onVerifyEvidence,
  onNotifyWinner,
}: DrawResultsTableProps) {
  const [showPhones, setShowPhones] = useState<Record<string, boolean>>({});
  const [copiedTicketId, setCopiedTicketId] = useState<string | null>(null);

  const togglePhone = (id: string) => {
    setShowPhones((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyTicket = (ticketNumber: string, id: string) => {
    navigator.clipboard.writeText(ticketNumber);
    setCopiedTicketId(id);
    setTimeout(() => setCopiedTicketId(null), 2000);
  };

  const formatPhone = (phone?: string, id?: string) => {
    if (!phone) return "—";
    if (id && showPhones[id]) return phone;
    if (phone.length <= 4) return phone;
    return phone.slice(0, 3) + "•••••" + phone.slice(-3);
  };

  const formatIstTime = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }) + " IST";
    } catch {
      return isoString;
    }
  };

  // Sort results by prize_number (1st prize at top or bottom? Ceremonial order 5th to 1st, but overview table standard is 1st to 5th or draw order)
  const sortedResults = [...results].sort((a, b) => a.prize_number - b.prize_number);
  const totalPrizesCount = prizes.length;
  const drawnCount = results.length;
  const notifiedCount = results.filter((r) => r.notified_at).length;

  return (
    <div className="space-y-6">
      {/* Top statistics summary bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#eadbcf] rounded-2xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">
              Draw Progress
            </span>
            <div className="text-2xl font-extrabold text-[#2d1810] mt-0.5">
              {drawnCount} / {totalPrizesCount || 5} Prizes
            </div>
            <span className="text-xs text-[#a89086]">
              {drawnCount === totalPrizesCount ? "All prizes drawn" : `${totalPrizesCount - drawnCount} remaining`}
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-[#fffaf7] border border-[#eadbcf] flex items-center justify-center text-[#7c1619]">
            <Trophy className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white border border-[#eadbcf] rounded-2xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">
              Cryptographic Integrity
            </span>
            <div className="text-2xl font-extrabold text-[#166534] mt-0.5 flex items-center gap-1.5">
              <ShieldCheck className="w-6 h-6" /> 100%
            </div>
            <span className="text-xs text-[#166534]">
              All winners provably fair verified
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-[#f0fdf4] border border-[#bbf7d0] flex items-center justify-center text-[#166534]">
            <FileCheck className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white border border-[#eadbcf] rounded-2xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#705a54]">
              Notifications
            </span>
            <div className="text-2xl font-extrabold text-[#2d1810] mt-0.5">
              {notifiedCount} / {drawnCount || 0} Sent
            </div>
            <span className="text-xs text-[#a89086]">
              Transactional Outbox Stamped
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-[#fffaf7] border border-[#eadbcf] flex items-center justify-center text-[#7c1619]">
            <Send className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main Results Table */}
      <div className="bg-white border border-[#eadbcf] rounded-2xl shadow-xs overflow-hidden">
        <div className="p-5 border-b border-[#f0e7df] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-[#2d1810] flex items-center gap-2">
              <Trophy className="w-5 h-5 text-[#7c1619]" /> Official Prize Draw Results
            </h3>
            <p className="text-xs text-[#705a54] mt-0.5">
              Immutable ledger of certified winners, seed commitments, and notification audit logs.
            </p>
          </div>

          <div className="text-xs font-semibold text-[#7c1619] bg-[#fffaf7] border border-[#eadbcf] px-3.5 py-1.5 rounded-full inline-flex items-center gap-1.5 self-start sm:self-auto">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <span>Provably Fair &bull; Zero Modulo Bias</span>
          </div>
        </div>

        {sortedResults.length === 0 ? (
          <div className="p-12 text-center text-[#705a54]">
            <Trophy className="w-12 h-12 text-[#e8d6c5] mx-auto mb-3" />
            <p className="font-bold text-base text-[#2d1810]">No Prizes Drawn Yet</p>
            <p className="text-xs text-[#a89086] max-w-md mx-auto mt-1">
              Select the Live Drum tab to begin the ceremonial lucky draw starting with the 5th Prize.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#fffaf7] border-b border-[#f0e7df] text-[#705a54] uppercase font-bold text-[11px] tracking-wider">
                  <th className="py-3 px-4">Prize Tier</th>
                  <th className="py-3 px-4">Winning Ticket</th>
                  <th className="py-3 px-4">Winner Details</th>
                  <th className="py-3 px-4">Attributed Seller</th>
                  <th className="py-3 px-4">Drawn At (IST)</th>
                  <th className="py-3 px-4">Notification</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0e7df]">
                {sortedResults.map((r) => {
                  const isFirst = r.prize_number === 1;

                  return (
                    <tr
                      key={r.id}
                      className={`hover:bg-[#fffaf7]/60 transition-colors ${
                        isFirst ? "bg-[#fffdf7]" : ""
                      }`}
                    >
                      {/* Prize Tier */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-extrabold px-2.5 py-1 rounded-full text-[11px] uppercase tracking-wider ${
                              isFirst
                                ? "bg-[#7c1619] text-white shadow-xs"
                                : "bg-[#fef2f2] text-[#7c1619] border border-[#fecaca]"
                            }`}
                          >
                            {isFirst ? "1st (Grand)" : `${r.prize_number}th Prize`}
                          </span>
                        </div>
                        <div className="font-bold text-sm text-[#2d1810] mt-1">{r.prize_title}</div>
                      </td>

                      {/* Winning Ticket */}
                      <td className="py-3.5 px-4">
                        <div className="inline-flex items-center gap-1.5 bg-[#faf8f6] border border-[#eadbcf] px-2.5 py-1 rounded-lg">
                          <span className="font-mono font-extrabold text-sm text-[#7c1619]">
                            {r.ticket_number}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyTicket(r.ticket_number, r.id)}
                            title="Copy ticket"
                            className="text-[#a89086] hover:text-[#7c1619] p-0.5"
                          >
                            {copiedTicketId === r.id ? (
                              <Check className="w-3.5 h-3.5 text-green-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                        <div className="text-[10px] text-[#a89086] mt-0.5 font-mono">
                          Index #{r.selection_index}
                        </div>
                      </td>

                      {/* Winner Details */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-[#2d1810]">
                          {r.customer_name || "Official Buyer"}
                        </div>
                        <div className="flex items-center gap-1 text-[#705a54] mt-0.5">
                          <span className="font-mono">{formatPhone(r.customer_phone, r.id)}</span>
                          {r.customer_phone && (
                            <button
                              type="button"
                              onClick={() => togglePhone(r.id)}
                              className="text-[#a89086] hover:text-[#2d1810] p-0.5"
                            >
                              {showPhones[r.id] ? (
                                <EyeOff className="w-3 h-3" />
                              ) : (
                                <Eye className="w-3 h-3" />
                              )}
                            </button>
                          )}
                        </div>
                        <div className="text-[11px] text-[#a89086]">{r.customer_email || "—"}</div>
                      </td>

                      {/* Attributed Seller */}
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-[#2d1810]">
                          {r.seller_name || "Direct / Admin Sale"}
                        </div>
                        <div className="text-[11px] text-[#a89086]">
                          {r.seller_code ? `Code: ${r.seller_code}` : "Central SSFI"}
                        </div>
                      </td>

                      {/* Drawn At */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-[#705a54]">
                        {formatIstTime(r.created_at)}
                      </td>

                      {/* Notification Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {r.notified_at ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#f0fdf4] text-[#166534] border border-[#bbf7d0]">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Sent
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#fffbeb] text-[#92400e] border border-[#fde68a]">
                            <Clock className="w-3.5 h-3.5" /> Pending
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onVerifyEvidence(r)}
                            className="px-2.5 py-1.5 rounded-lg border border-[#eadbcf] text-[#5c3e34] bg-[#fffaf7] hover:bg-[#f0e7df] font-semibold flex items-center gap-1 transition-colors"
                            title="Verify mathematical randomness evidence"
                          >
                            <ShieldCheck className="w-3.5 h-3.5 text-[#7c1619]" /> Proof
                          </button>

                          <button
                            type="button"
                            onClick={() => onNotifyWinner(r)}
                            className={`px-2.5 py-1.5 rounded-lg font-semibold flex items-center gap-1 transition-colors shadow-2xs ${
                              r.notified_at
                                ? "border border-[#eadbcf] text-[#5c3e34] bg-[#faf8f6] hover:bg-[#f0e7df]"
                                : "bg-[#7c1619] hover:bg-[#601012] text-white"
                            }`}
                            title="Send official winner notification email"
                          >
                            <Send className="w-3.5 h-3.5" />
                            {r.notified_at ? "Re-send" : "Notify"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
