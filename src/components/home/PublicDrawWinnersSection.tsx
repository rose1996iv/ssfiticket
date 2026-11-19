"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Trophy, ShieldCheck, RefreshCw } from "lucide-react";
import type { PublicDrawWinnerRecord } from "@/lib/draw/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatPrizeLabel } from "@/lib/draw/formatOrdinal";
import { CANONICAL_CAMPAIGN_PUBLIC_ID } from "@/lib/draw/campaignSelection";
import {
  buildPublicWinnersChannelName,
  PUBLIC_DRAW_EXECUTED_EVENT,
} from "@/lib/draw/realtimeBroadcast";

interface PublicDrawWinnersSectionProps {
  initialWinners: PublicDrawWinnerRecord[];
  campaignPublicId?: string;
}

export function PublicDrawWinnersSection({
  initialWinners,
  campaignPublicId = CANONICAL_CAMPAIGN_PUBLIC_ID,
}: PublicDrawWinnersSectionProps) {
  const [winners, setWinners] = useState<PublicDrawWinnerRecord[]>(initialWinners);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hadDisconnectRef = useRef(false);

  useEffect(() => {
    setWinners(initialWinners);
  }, [initialWinners]);

  const refreshPublicWinners = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("get_public_draw_winners", {
        p_campaign_public_id: campaignPublicId,
      });
      if (!error && Array.isArray(data)) {
        // Strictly map TICKET_NUMBER_ONLY public DTO fields
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped: PublicDrawWinnerRecord[] = data.map((row: any) => ({
          prize_number: Number(row.prize_number),
          prize_title: String(row.prize_title ?? ""),
          ticket_number: String(row.ticket_number ?? ""),
          drawn_at: String(row.drawn_at ?? ""),
          algorithm_version: String(row.algorithm_version ?? "SSFI-CSPRNG-V1"),
          seed_commitment: String(row.seed_commitment ?? ""),
          seed_revealed: String(row.seed_revealed ?? ""),
          combined_seed: String(row.combined_seed ?? ""),
          selection_index: Number(row.selection_index ?? 0),
          total_candidates: Number(row.total_candidates ?? 0),
        }));
        setWinners(mapped);
      }
    } catch {
      // Non-fatal network fallback for public spectators
    } finally {
      setIsRefreshing(false);
    }
  }, [campaignPublicId]);

  useEffect(() => {
    const handleOnline = () => {
      void refreshPublicWinners();
    };
    const handleOffline = () => {
      hadDisconnectRef.current = true;
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshPublicWinners();
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    let supabase: ReturnType<typeof createSupabaseBrowserClient> | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null;
    try {
      supabase = createSupabaseBrowserClient();
      channel = supabase
        .channel(buildPublicWinnersChannelName(campaignPublicId))
        .on("broadcast", { event: PUBLIC_DRAW_EXECUTED_EVENT }, () => {
          void refreshPublicWinners();
        })
        .subscribe((status: string) => {
          if (status === "SUBSCRIBED" && hadDisconnectRef.current) {
            hadDisconnectRef.current = false;
            void refreshPublicWinners();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            hadDisconnectRef.current = true;
          }
        });
    } catch {
      // Realtime optional fallback
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (supabase && channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [campaignPublicId, refreshPublicWinners]);

  if (winners.length === 0) {
    return null;
  }

  return (
    <section className="mx-auto max-w-5xl px-6 pb-8 sm:px-10">
      <div className="rounded-3xl border-2 border-[#d6a23b]/60 bg-white p-6 shadow-md sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#f0e7df] pb-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#7c1619] text-[#f3ce75] shadow-xs">
              <Trophy size={22} />
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-widest text-[#a41f23]">
                Official Certified Results
              </span>
              <h2 className="text-xl font-bold text-[#35110f]">
                SSFI Lucky Draw Winning Tickets
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-800">
              <ShieldCheck size={14} className="text-emerald-600" />
              Provably Fair Verified
            </span>
            <button
              type="button"
              onClick={() => void refreshPublicWinners()}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#eadbcf] bg-[#fffaf7] px-3 py-1.5 text-xs font-semibold text-[#5c3e34] hover:bg-[#f0e7df]"
              title="Refresh certified results"
            >
              <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {winners.map((w) => (
            <div
              key={`${w.prize_number}-${w.ticket_number}`}
              className={`rounded-2xl border p-4 ${
                w.prize_number === 1
                  ? "border-[#d6a23b] bg-gradient-to-br from-[#fffdf7] to-[#fef3c7]/40 shadow-sm"
                  : "border-[#eadbcf] bg-[#fffaf7]"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold uppercase ${
                    w.prize_number === 1
                      ? "bg-[#7c1619] text-white"
                      : "bg-[#fef2f2] text-[#7c1619] border border-[#fecaca]"
                  }`}
                >
                  {formatPrizeLabel(w.prize_number, { grandLabel: "short" })}
                </span>
                <span className="text-[11px] font-mono text-[#705a54]">
                  #{w.selection_index} / {w.total_candidates}
                </span>
              </div>

              <p className="text-sm font-bold text-[#35110f] mb-2">{w.prize_title}</p>

              <div className="rounded-xl border border-[#e8d6c5] bg-white px-3 py-2 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#80635b]">
                  Winning Ticket
                </span>
                <span className="font-mono text-base font-extrabold text-[#7c1619]">
                  {w.ticket_number}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
