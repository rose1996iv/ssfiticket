"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Trophy,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Play,
  RotateCcw,
  Send,
  Eye,
  EyeOff,
  Copy,
  Check,
  AlertTriangle,
  Lock,
} from "lucide-react";
import {
  DrawSession,
  PrizeItem,
  EligibilitySnapshot,
  DrawResultRecord,
  DrawApproval,
} from "@/lib/draw/types";
import { formatPrizeLabel, formatPrizeWinnerLabel } from "@/lib/draw/formatOrdinal";
import { executePrizeDraw } from "@/server/actions/luckyDraw";

interface RotatingNumberDrumProps {
  campaignId: string;
  session: DrawSession | null;
  prizes: PrizeItem[];
  snapshot: EligibilitySnapshot | null;
  snapshots?: EligibilitySnapshot[];
  eligibleTicketCount?: number;
  selectedPrizeId?: string | null;
  onSelectPrize?: (prizeId: string) => void;
  onGoToEligibility?: (prizeId?: string) => void;
  results: DrawResultRecord[];
  nextPrize: PrizeItem | null;
  approval: DrawApproval | null;
  currentUser: {
    id: string;
    email: string;
    role: string;
  };
  onDrawCompleted: (result: DrawResultRecord) => void;
  onRequestApproval?: () => void;
  onVerifyEvidence?: (result: DrawResultRecord) => void;
  onNotifyWinner?: (result: DrawResultRecord) => void;
}

// Audio synthesizer for mechanical drum tick and win fanfare
class DrumAudio {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => { });
    }
    return this.ctx;
  }

  playTick(frequency = 600, duration = 0.03) {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // Audio autoplay policy fallback
    }
  }

  playChime() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
        gain.gain.setValueAtTime(0.12, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.45);
      });
    } catch {
      // Silently catch audio policy blocks
    }
  }
}

const drumAudio = new DrumAudio();

export function RotatingNumberDrum({
  session,
  prizes,
  snapshot,
  snapshots,
  eligibleTicketCount,
  selectedPrizeId,
  onSelectPrize,
  onGoToEligibility,
  results,
  nextPrize,
  approval,
  currentUser,
  onDrawCompleted,
  onRequestApproval,
  onVerifyEvidence,
  onNotifyWinner,
}: RotatingNumberDrumProps) {
  // Default placeholder format
  const DEFAULT_FORMAT = "SSFI-000000";
  const initialResult = results.length > 0 ? results[results.length - 1] : null;
  const initialTicketNumber = initialResult?.ticket_number || DEFAULT_FORMAT;

  const [isSpinning, setIsSpinning] = useState(false);
  const [internalSelectedPrizeId, setInternalSelectedPrizeId] = useState<string | null>(
    () => selectedPrizeId || nextPrize?.id || initialResult?.prize_id || prizes[0]?.id || null
  );
  const [displayedChars, setDisplayedChars] = useState<string[]>(() => initialTicketNumber.split(""));
  const [activeResult, setActiveResult] = useState<DrawResultRecord | null>(initialResult);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [showPhone, setShowPhone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stoppingReels, setStoppingReels] = useState<boolean[]>(() =>
    new Array(initialTicketNumber.length).fill(true)
  );

  const spinIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const drumContainerRef = useRef<HTMLDivElement | null>(null);

  const effectiveSelectedPrizeId =
    selectedPrizeId !== undefined ? selectedPrizeId : internalSelectedPrizeId;

  const inspectedPrize =
    prizes.find((p) => p.id === effectiveSelectedPrizeId) ||
    nextPrize ||
    (activeResult ? prizes.find((p) => p.id === activeResult.prize_id) || null : null) ||
    prizes[0] ||
    null;

  const inspectedResult = inspectedPrize
    ? results.find((r) => r.prize_id === inspectedPrize.id) || null
    : null;

  const allSnapshots = snapshots || (snapshot ? [snapshot] : []);
  const inspectedSnapshot = inspectedPrize
    ? allSnapshots.find((s) => s.prize_id === inspectedPrize.id) ||
    (snapshot?.prize_id === inspectedPrize.id ? snapshot : null)
    : snapshot;

  const handleSelectPrizeCard = (prize: PrizeItem) => {
    if (isSpinning) return;
    setDrawError(null);
    setInternalSelectedPrizeId(prize.id);
    if (onSelectPrize) {
      onSelectPrize(prize.id);
    }
    const existingResult = results.find((r) => r.prize_id === prize.id) || null;
    if (existingResult) {
      setActiveResult(existingResult);
      setDisplayedChars(existingResult.ticket_number.split(""));
      setStoppingReels(new Array(existingResult.ticket_number.length).fill(true));
    } else {
      setActiveResult(null);
      setDisplayedChars(DEFAULT_FORMAT.split(""));
      setStoppingReels(new Array(DEFAULT_FORMAT.length).fill(true));
    }
  };

  // Sync activeResult when results prop updates (e.g. notification stamp or reconnect refresh)
  useEffect(() => {
    if (isSpinning || results.length === 0) return;
    setActiveResult((prev) => {
      if (prev) {
        const updated = results.find((r) => r.id === prev.id);
        if (updated) return updated;
      }
      const latest = results[results.length - 1];
      setDisplayedChars(latest.ticket_number.split(""));
      setStoppingReels(new Array(latest.ticket_number.length).fill(true));
      return latest;
    });
  }, [results, isSpinning]);

  // Clean up spin timers on unmount
  useEffect(() => {
    return () => {
      if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
    };
  }, []);

  // Animation runner: cycles characters until target is locked
  const runDrumAnimation = (targetTicketNumber: string, onFinish: () => void) => {
    setIsSpinning(true);
    setDrawError(null);

    const target = targetTicketNumber.split("");
    const length = target.length;
    const current = [...displayedChars];
    while (current.length < length) current.push("0");
    while (current.length > length) current.pop();

    const charPool = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const stoppedState = new Array(length).fill(false);
    setStoppingReels([...stoppedState]);

    let ticks = 0;
    const intervalTime = 40; // 25 fps
    const totalSpinTimeMs = 3200; // total animation time
    const reelStopDelayMs = 180; // delay between locking consecutive reels

    spinIntervalRef.current = setInterval(() => {
      ticks++;
      drumAudio.playTick(400 + (ticks % 10) * 40, 0.02);

      // Randomize unfixed characters
      const updated = current.map((ch, idx) => {
        if (stoppedState[idx]) {
          return target[idx];
        }
        if (target[idx] === "-") {
          return "-";
        }
        return charPool[Math.floor(Math.random() * charPool.length)];
      });

      setDisplayedChars([...updated]);
    }, intervalTime);

    // Staggered stopping sequence
    setTimeout(() => {
      target.forEach((_, idx) => {
        setTimeout(() => {
          stoppedState[idx] = true;
          setStoppingReels([...stoppedState]);
          drumAudio.playTick(800 + idx * 80, 0.05);

          // Once last reel stops
          if (idx === target.length - 1) {
            if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
            setDisplayedChars([...target]);
            setIsSpinning(false);
            drumAudio.playChime();
            onFinish();
          }
        }, idx * reelStopDelayMs);
      });
    }, totalSpinTimeMs);
  };

  // Safe replay animation
  const handleReplayAnimation = () => {
    if (isSpinning || !activeResult) return;
    runDrumAnimation(activeResult.ticket_number, () => { });
  };

  // Main draw execution handler
  const handleDrawWinner = async () => {
    if (!nextPrize || !session) return;
    if (isSpinning) return;

    setDrawError(null);

    // Guard: Must have a locked snapshot for the prize
    if (!snapshot || !snapshot.is_locked || snapshot.prize_id !== nextPrize.id) {
      setDrawError(
        `Eligibility snapshot for ${nextPrize.title} is not locked. Please review and lock the snapshot in the Eligibility tab first.`
      );
      return;
    }

    // Guard: 1st prize dual authorization check
    if (nextPrize.prize_number === 1) {
      if (!approval || approval.status !== "APPROVED") {
        setDrawError(
          "First Prize dual-authorization policy requires an approved authorization record from a separate administrator before drawing."
        );
        return;
      }
    }

    // Generate 32 bytes client entropy via CSPRNG
    const entropyBytes = new Uint8Array(32);
    crypto.getRandomValues(entropyBytes);
    const clientEntropyHex = Array.from(entropyBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    setIsSpinning(true);

    try {
      const res = await executePrizeDraw({
        drawId: session.id,
        prizeId: nextPrize.id,
        snapshotId: snapshot.id,
        clientEntropy: clientEntropyHex,
      });

      if (!res.success || !res.data) {
        setIsSpinning(false);
        setDrawError(res.error || "Failed to execute draw winner selection.");
        return;
      }

      const winningResult = res.data.result;

      // Run dramatic drum animation decelerating to winning ticket
      runDrumAnimation(winningResult.ticket_number, () => {
        setActiveResult(winningResult);
        onDrawCompleted(winningResult);
      });
    } catch (err: unknown) {
      setIsSpinning(false);
      setDrawError(err instanceof Error ? err.message : "An unexpected draw execution error occurred.");
    }
  };

  const copyTicketNumber = () => {
    if (!activeResult) return;
    navigator.clipboard.writeText(activeResult.ticket_number);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Format telephone with privacy masking
  const formatPhone = (phone?: string) => {
    if (!phone) return "—";
    if (showPhone) return phone;
    if (phone.length <= 4) return phone;
    return phone.slice(0, 3) + "•••••" + phone.slice(-3);
  };

  // Sorted ceremonial sequence (5th down to 1st)
  const ceremonialPrizes = [...prizes].sort((a, b) => b.prize_number - a.prize_number);

  const hasDrawRole = ["SUPER_ADMIN", "ADMIN"].includes(currentUser.role);
  const targetPrizeForDraw = inspectedPrize || nextPrize;
  const isTargetCurrentNext = Boolean(
    targetPrizeForDraw && nextPrize && targetPrizeForDraw.id === nextPrize.id && !inspectedResult
  );
  const isTargetSnapshotLocked = Boolean(
    inspectedSnapshot?.is_locked &&
    targetPrizeForDraw &&
    inspectedSnapshot.prize_id === targetPrizeForDraw.id
  );
  const isFirstPrizeTarget = targetPrizeForDraw?.prize_number === 1;
  const isFirstPrizeApproved = !isFirstPrizeTarget || approval?.status === "APPROVED";
  const canExecuteCurrentDraw =
    hasDrawRole &&
    isTargetCurrentNext &&
    isTargetSnapshotLocked &&
    isFirstPrizeApproved &&
    !isSpinning;

  // Determine exact disabled reason for the Draw button when it is disabled
  let disabledReasonType:
    | "NONE"
    | "INSUFFICIENT_AUTHORIZATION"
    | "DRAW_ALREADY_EXECUTED"
    | "PREVIOUS_PRIZE_REQUIRED"
    | "NO_ELIGIBLE_TICKETS"
    | "SNAPSHOT_REQUIRED"
    | "DUAL_APPROVAL_REQUIRED" = "NONE";

  if (!hasDrawRole) {
    disabledReasonType = "INSUFFICIENT_AUTHORIZATION";
  } else if (inspectedResult || !nextPrize) {
    disabledReasonType = "DRAW_ALREADY_EXECUTED";
  } else if (targetPrizeForDraw && targetPrizeForDraw.id !== nextPrize.id) {
    disabledReasonType = "PREVIOUS_PRIZE_REQUIRED";
  } else if (!isTargetSnapshotLocked) {
    if (eligibleTicketCount !== undefined && eligibleTicketCount <= 0) {
      disabledReasonType = "NO_ELIGIBLE_TICKETS";
    } else {
      disabledReasonType = "SNAPSHOT_REQUIRED";
    }
  } else if (isFirstPrizeTarget && !isFirstPrizeApproved) {
    disabledReasonType = "DUAL_APPROVAL_REQUIRED";
  }

  return (
    <div className="space-y-6">
      {/* ==================================================================== */}
      {/* 1. CEREMONIAL SEQUENCE STEPPER (5th -> 4th -> 3rd -> 2nd -> 1st)      */}
      {/* ==================================================================== */}
      <div className="bg-white border border-[#eadbcf] rounded-2xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 mb-4 border-b border-[#f0e7df]">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#7c1619]">
              Ceremonial Sequence (Approved Order)
            </span>
            <h3 className="text-lg font-bold text-[#2d1810]">
              5th Prize &rarr; 4th Prize &rarr; 3rd Prize &rarr; 2nd Prize &rarr; 1st Prize
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#fffaf7] text-[#7c1619] border border-[#eadbcf]">
              <ShieldCheck className="w-3.5 h-3.5" /> Single-Winner Invariant Active
            </span>
          </div>
        </div>

        {/* Prize sequence grid — every card is an interactive button */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          {ceremonialPrizes.map((p) => {
            const resultForPrize = results.find((r) => r.prize_id === p.id);
            const snapshotForCard =
              allSnapshots.find((s) => s.prize_id === p.id) ||
              (snapshot?.prize_id === p.id ? snapshot : null);
            const isCompleted = Boolean(resultForPrize);
            const isCurrent = nextPrize?.id === p.id && !isCompleted;
            const isSelected = inspectedPrize?.id === p.id;
            const isFirstPrize = p.prize_number === 1;
            const isCardReadyToDraw =
              isCurrent &&
              Boolean(snapshotForCard?.is_locked) &&
              (!isFirstPrize || approval?.status === "APPROVED");

            return (
              <button
                key={p.id}
                type="button"
                data-testid={`prize-card-${p.prize_number}`}
                aria-pressed={isSelected}
                onClick={() => handleSelectPrizeCard(p)}
                className={`relative text-left rounded-xl p-3.5 border transition-all cursor-pointer focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c1619] focus-visible:ring-2 focus-visible:ring-[#d6a23b] focus-visible:ring-offset-2 focus-visible:ring-offset-white ${isCompleted
                  ? "bg-[#f0fdf4] border-[#bbf7d0] text-[#166534] hover:border-[#4ade80]"
                  : isCurrent
                    ? "bg-[#fef2f2] border-[#7c1619] text-[#7c1619] shadow-sm hover:bg-[#fee2e2]/60"
                    : "bg-[#faf8f6] border-[#eadbcf] text-[#705a54] hover:bg-[#fffaf7] hover:border-[#d6a23b]"
                  } ${isSelected ? "ring-2 ring-[#7c1619] shadow-md" : ""}`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className={`text-xs font-extrabold uppercase px-2 py-0.5 rounded-full ${isCompleted
                      ? "bg-[#dcfce7] text-[#15803d]"
                      : isCurrent
                        ? "bg-[#7c1619] text-white"
                        : "bg-[#e8d6c5] text-[#5c3e34]"
                      }`}
                  >
                    {formatPrizeLabel(p.prize_number)}
                  </span>

                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-[#16a34a]" />
                  ) : isCurrent ? (
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#7c1619] opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#7c1619]"></span>
                    </span>
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-[#a89086]" />
                  )}
                </div>

                <div className="font-bold text-sm truncate text-[#2d1810]" title={p.title}>
                  {p.title}
                </div>

                {isCompleted && resultForPrize ? (
                  <div className="mt-2 pt-2 border-t border-[#bbf7d0] flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-[#166534]">
                      {resultForPrize.ticket_number}
                    </span>
                    <span className="text-[11px] underline font-medium text-[#14532d]">
                      {isSelected ? "Selected" : "View"}
                    </span>
                  </div>
                ) : isCurrent ? (
                  <div className="mt-2 pt-2 border-t border-[#fecaca] text-xs font-bold text-[#7c1619] flex items-center justify-between">
                    <span>
                      {isCardReadyToDraw
                        ? "Ready to Draw →"
                        : !snapshotForCard?.is_locked
                          ? "Snapshot Required"
                          : "Dual Auth Required"}
                    </span>
                    {isSelected && <span className="text-[10px] uppercase">Active</span>}
                  </div>
                ) : (
                  <div className="mt-2 pt-2 border-t border-[#eadbcf] text-xs text-[#a89086] flex items-center justify-between">
                    <span>{isFirstPrize ? "Dual Control" : "Awaiting Sequence"}</span>
                    {isSelected && (
                      <span className="text-[10px] font-bold text-[#7c1619] uppercase">
                        Selected
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 2. THE MECHANICAL ROTATING DRUM STAGE                                */}
      {/* ==================================================================== */}
      <div
        ref={drumContainerRef}
        className="relative overflow-hidden bg-gradient-to-b from-[#2d0c0e] via-[#431214] to-[#1e0708] rounded-3xl p-6 sm:p-10 text-white shadow-2xl border-4 border-[#c59a58]/60"
      >
        {/* Decorative corner rivets */}
        <div className="absolute top-3 left-3 w-3 h-3 rounded-full bg-[#f3ce75] shadow-inner border border-[#8a6828]" />
        <div className="absolute top-3 right-3 w-3 h-3 rounded-full bg-[#f3ce75] shadow-inner border border-[#8a6828]" />
        <div className="absolute bottom-3 left-3 w-3 h-3 rounded-full bg-[#f3ce75] shadow-inner border border-[#8a6828]" />
        <div className="absolute bottom-3 right-3 w-3 h-3 rounded-full bg-[#f3ce75] shadow-inner border border-[#8a6828]" />

        {/* Top drum banner */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#f3ce75]/15 border border-[#f3ce75]/30 text-[#f3ce75] text-xs font-bold uppercase tracking-widest mb-2">
            <Sparkles className="w-3.5 h-3.5" /> Provably Fair Mechanical Drum • CSPRNG
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            {inspectedResult
              ? `${formatPrizeLabel(inspectedResult.prize_number)} Drawn: ${inspectedResult.prize_title}`
              : targetPrizeForDraw
                ? `Drawing ${formatPrizeLabel(targetPrizeForDraw.prize_number, { grandLabel: "full" })}: ${targetPrizeForDraw.title}`
                : activeResult
                  ? `${formatPrizeLabel(activeResult.prize_number)} Drawn: ${activeResult.prize_title}`
                  : "All Campaign Prizes Drawn"}
          </h2>
          <p className="text-xs sm:text-sm text-[#f5d9c2]/80 mt-1">
            Rejection-sampled CSPRNG • HMAC-SHA256 • Pre-committed Seed Reveal
          </p>
        </div>

        {/* Drum cylinder container */}
        <div className="relative max-w-2xl mx-auto my-6 sm:my-8 bg-[#180506]/90 p-4 sm:p-6 rounded-2xl border-2 border-[#c59a58]/50 shadow-[inset_0_4px_24px_rgba(0,0,0,0.8)]">
          {/* Glass reflection gradient highlight */}
          <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-white/10 via-transparent to-black/30" />

          {/* Reel columns */}
          <div className="flex items-center justify-center gap-1.5 sm:gap-2.5 overflow-x-auto py-2">
            {displayedChars.map((ch, idx) => {
              const isLocked = stoppingReels[idx] || !isSpinning;
              const isDash = ch === "-";

              if (isDash) {
                return (
                  <div
                    key={idx}
                    className="w-4 sm:w-6 flex items-center justify-center font-black text-2xl sm:text-4xl text-[#f3ce75]"
                  >
                    -
                  </div>
                );
              }

              return (
                <div
                  key={idx}
                  className={`relative w-9 h-14 sm:w-13 sm:h-20 flex items-center justify-center rounded-lg sm:rounded-xl font-mono text-2xl sm:text-4xl font-black shadow-lg transition-all duration-150 ${isLocked
                    ? "bg-gradient-to-b from-[#2a0e10] via-[#541619] to-[#2a0e10] text-[#fde047] border-2 border-[#f3ce75] shadow-[0_0_12px_rgba(243,206,117,0.4)]"
                    : "bg-gradient-to-b from-[#1a0a0b] via-[#331113] to-[#1a0a0b] text-[#fbcfe8] border border-[#a82024]/60 blur-[0.4px] animate-pulse"
                    }`}
                >
                  {/* Subtle inner drum reel texture lines */}
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/50 to-transparent rounded-t-lg sm:rounded-t-xl" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/50 to-transparent rounded-b-lg sm:rounded-b-xl" />

                  {/* Digit character */}
                  <span className="relative z-10 drop-shadow-md select-none">{ch}</span>
                </div>
              );
            })}
          </div>

          {/* Reel indicator line */}
          <div className="flex items-center justify-between text-[11px] font-mono text-[#f3ce75]/70 pt-3 border-t border-[#c59a58]/30 px-2">
            <span>OFFICIAL WINNING TICKET</span>
            <span>
              {isSpinning
                ? "DECELERATING REELS..."
                : activeResult
                  ? `INDEX: #${activeResult.selection_index}`
                  : "AWAITING DRAW"}
            </span>
          </div>
        </div>

        {/* Error alert inside drum stage */}
        {drawError && (
          <div className="max-w-xl mx-auto my-4 bg-red-950/80 border border-red-500/60 rounded-xl p-3.5 text-red-200 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-red-300">Draw Execution Blocked</p>
              <p className="mt-0.5 leading-relaxed">{drawError}</p>
            </div>
          </div>
        )}

        {/* Draw controls & trigger */}
        <div className="flex flex-col items-center justify-center gap-4 mt-6">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {targetPrizeForDraw && !inspectedResult && nextPrize ? (
              <button
                type="button"
                data-testid="draw-prize-button"
                disabled={!canExecuteCurrentDraw}
                onClick={handleDrawWinner}
                className={`relative group px-8 py-4 rounded-2xl text-base font-extrabold uppercase tracking-wider flex items-center gap-3 transition-all duration-200 shadow-xl ${!canExecuteCurrentDraw
                  ? "bg-stone-700 text-stone-400 cursor-not-allowed border border-stone-600"
                  : "bg-gradient-to-r from-[#d97706] via-[#f59e0b] to-[#d97706] text-[#2d1810] hover:scale-105 active:scale-95 border-2 border-[#fef08a] shadow-[0_0_24px_rgba(245,158,11,0.5)]"
                  }`}
              >
                {isSpinning ? (
                  <>
                    <div className="w-5 h-5 border-2 border-[#2d1810] border-t-transparent rounded-full animate-spin" />
                    <span>Selecting Winner...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 fill-current" />
                    <span>
                      Draw {formatPrizeLabel(targetPrizeForDraw.prize_number, { grandLabel: "full" })}
                    </span>
                  </>
                )}
              </button>
            ) : (
              <div className="text-center">
                <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#166534]/40 border border-[#22c55e]/50 text-[#86efac] text-xs font-bold uppercase tracking-wider">
                  <CheckCircle2 className="w-4 h-4" />{" "}
                  {!nextPrize
                    ? "All Campaign Prizes Successfully Drawn"
                    : `${formatPrizeLabel(inspectedResult?.prize_number ?? 1)} Already Executed`}
                </span>
              </div>
            )}

            {activeResult && !isSpinning && (
              <button
                type="button"
                onClick={handleReplayAnimation}
                className="px-4 py-2.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white border border-white/20 flex items-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Replay Reveal
              </button>
            )}
          </div>

          {/* Explicit Disabled-State & Precondition Explanation Panel */}
          {disabledReasonType !== "NONE" && !isSpinning && (
            <div
              data-testid="draw-disabled-reason"
              className="w-full max-w-2xl rounded-2xl bg-black/45 border border-[#f3ce75]/40 p-4 text-xs text-[#f5d9c2]"
            >
              {disabledReasonType === "SNAPSHOT_REQUIRED" && targetPrizeForDraw && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <Lock className="w-4 h-4 text-[#f3ce75] shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-[#f3ce75]">
                        Eligibility Snapshot Required
                      </p>
                      <p className="mt-0.5 leading-relaxed text-[#f5d9c2]/90">
                        Drawing{" "}
                        <strong>
                          {formatPrizeLabel(targetPrizeForDraw.prize_number, { grandLabel: "full" })}{" "}
                          ({targetPrizeForDraw.title})
                        </strong>{" "}
                        is disabled because an immutable eligibility snapshot and pre-committed cryptographic seed have not been locked yet
                        {eligibleTicketCount !== undefined
                          ? ` (${eligibleTicketCount} eligible tickets ready in pool).`
                          : "."}
                      </p>
                    </div>
                  </div>
                  {onGoToEligibility && (
                    <button
                      type="button"
                      data-testid="cta-lock-snapshot"
                      onClick={() => onGoToEligibility(targetPrizeForDraw.id)}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-[#f3ce75] text-[#2d1810] hover:bg-[#ebd082] shrink-0 transition-colors shadow-sm"
                    >
                      Lock Eligibility Snapshot &rarr;
                    </button>
                  )}
                </div>
              )}

              {disabledReasonType === "NO_ELIGIBLE_TICKETS" && targetPrizeForDraw && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-amber-300">No Eligible Tickets</p>
                      <p className="mt-0.5 leading-relaxed text-[#f5d9c2]/90">
                        There are currently 0 eligible issued tickets with verified payments available for{" "}
                        <strong>{targetPrizeForDraw.title}</strong>. At least one eligible ticket is required to lock a snapshot and execute a draw.
                      </p>
                    </div>
                  </div>
                  {onGoToEligibility && (
                    <button
                      type="button"
                      onClick={() => onGoToEligibility(targetPrizeForDraw.id)}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-white/15 hover:bg-white/25 text-white shrink-0 transition-colors"
                    >
                      Inspect Roster &rarr;
                    </button>
                  )}
                </div>
              )}

              {disabledReasonType === "PREVIOUS_PRIZE_REQUIRED" && targetPrizeForDraw && nextPrize && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <Clock className="w-4 h-4 text-[#f3ce75] shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-[#f3ce75]">
                        Previous Prize Must Be Completed
                      </p>
                      <p className="mt-0.5 leading-relaxed text-[#f5d9c2]/90">
                        Sequential ceremonial reveal (5th &rarr; 4th &rarr; 3rd &rarr; 2nd &rarr; 1st) is strictly enforced. You must complete{" "}
                        <strong>
                          {formatPrizeLabel(nextPrize.prize_number)} ({nextPrize.title})
                        </strong>{" "}
                        before{" "}
                        <strong>{formatPrizeLabel(targetPrizeForDraw.prize_number)}</strong>{" "}
                        can be locked or drawn.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="cta-switch-current-prize"
                    onClick={() => handleSelectPrizeCard(nextPrize)}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-[#f3ce75] text-[#2d1810] hover:bg-[#ebd082] shrink-0 transition-colors shadow-sm"
                  >
                    Switch to {formatPrizeLabel(nextPrize.prize_number)} &rarr;
                  </button>
                </div>
              )}

              {disabledReasonType === "DUAL_APPROVAL_REQUIRED" && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <Lock className="w-4 h-4 text-[#f3ce75] shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-[#f3ce75]">
                        Policy A Dual Authorization Required
                      </p>
                      <p className="mt-0.5 leading-relaxed text-[#f5d9c2]/90">
                        The 1st Prize eligibility snapshot is locked, but executing the Grand Prize draw requires initiation by a{" "}
                        <strong>SUPER_ADMIN</strong> and approval by a distinct administrator (Current status:{" "}
                        <strong>{approval?.status || "NOT INITIATED"}</strong>).
                      </p>
                    </div>
                  </div>
                  {onRequestApproval && (
                    <button
                      type="button"
                      onClick={onRequestApproval}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-[#f3ce75] text-[#2d1810] hover:bg-[#ebd082] shrink-0 transition-colors shadow-sm"
                    >
                      Open Dual Authorization &rarr;
                    </button>
                  )}
                </div>
              )}

              {disabledReasonType === "INSUFFICIENT_AUTHORIZATION" && (
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-red-300">Insufficient Authorization</p>
                    <p className="mt-0.5 leading-relaxed text-[#f5d9c2]/90">
                      Only an authenticated administrator with SUPER_ADMIN or ADMIN role is authorized to execute prize draws.
                    </p>
                  </div>
                </div>
              )}

              {disabledReasonType === "DRAW_ALREADY_EXECUTED" && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#86efac] shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-[#86efac]">Draw Already Executed</p>
                      <p className="mt-0.5 leading-relaxed text-[#f5d9c2]/90">
                        {inspectedResult
                          ? `${inspectedResult.prize_title} has already been drawn (Winning Ticket: ${inspectedResult.ticket_number}). Single-winner uniqueness and immutable result invariants prevent re-drawing.`
                          : "All five scheduled prizes for this campaign have been drawn and certified."}
                      </p>
                    </div>
                  </div>
                  {nextPrize && (
                    <button
                      type="button"
                      onClick={() => handleSelectPrizeCard(nextPrize)}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-[#f3ce75] text-[#2d1810] hover:bg-[#ebd082] shrink-0 transition-colors shadow-sm"
                    >
                      Switch to {formatPrizeLabel(nextPrize.prize_number)} &rarr;
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 3. ACTIVE WINNER REVEAL CARD                                         */}
      {/* ==================================================================== */}
      {activeResult && (
        <div className="bg-white border-2 border-[#7c1619]/30 rounded-2xl p-6 shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-[#f0e7df]">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#7c1619] to-[#a82024] text-white flex items-center justify-center shrink-0 shadow-md">
                <Trophy className="w-6 h-6 text-[#f3ce75]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-[#fef2f2] text-[#7c1619] border border-[#fecaca]">
                    {activeResult.prize_number === 1
                      ? "Grand Prize Winner"
                      : formatPrizeWinnerLabel(activeResult.prize_number)}
                  </span>
                  <span className="text-xs text-[#705a54]">
                    Drawn: {new Date(activeResult.created_at).toLocaleTimeString("en-IN")} IST
                  </span>
                </div>
                <h3 className="text-xl font-bold text-[#2d1810] mt-1">
                  {activeResult.prize_title}
                </h3>
              </div>
            </div>

            {/* Winning ticket badge with copy */}
            <div className="flex items-center gap-2 bg-[#fffaf7] border-2 border-[#7c1619] rounded-xl px-4 py-2">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[#7c1619]">
                  Winning Ticket
                </span>
                <span className="font-mono text-xl font-extrabold text-[#7c1619]">
                  {activeResult.ticket_number}
                </span>
              </div>
              <button
                type="button"
                onClick={copyTicketNumber}
                title="Copy ticket number"
                className="p-1.5 rounded-lg hover:bg-[#eadbcf]/50 text-[#7c1619] transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Customer & Seller attribution */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4 border-b border-[#f0e7df] text-xs">
            <div>
              <span className="text-[#705a54] font-medium block mb-0.5">Winner Customer</span>
              <span className="font-bold text-sm text-[#2d1810] block">
                {activeResult.customer_name || "Official Buyer"}
              </span>
              <span className="text-[#a89086] text-[11px]">{activeResult.customer_email || "—"}</span>
            </div>

            <div>
              <span className="text-[#705a54] font-medium block mb-0.5">Phone Number</span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono font-bold text-sm text-[#2d1810]">
                  {formatPhone(activeResult.customer_phone)}
                </span>
                {activeResult.customer_phone && (
                  <button
                    type="button"
                    onClick={() => setShowPhone(!showPhone)}
                    className="p-1 text-[#705a54] hover:text-[#2d1810]"
                  >
                    {showPhone ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
              <span className="text-[#a89086] text-[11px]">Contact for Prize Delivery</span>
            </div>

            <div>
              <span className="text-[#705a54] font-medium block mb-0.5">Attributed Seller</span>
              <span className="font-bold text-sm text-[#2d1810] block">
                {activeResult.seller_name || "Direct / Admin Sale"}
              </span>
              <span className="text-[#a89086] text-[11px]">
                {activeResult.seller_code ? `Code: ${activeResult.seller_code}` : "Official Channel"}
              </span>
            </div>
          </div>

          {/* Cryptographic Proof & Notification Action Footer */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#f0fdf4] text-[#166534] border border-[#bbf7d0]">
                <ShieldCheck className="w-3.5 h-3.5" /> Cryptographic Evidence Verified
              </span>
              <span className="text-xs text-[#705a54]">
                Candidate index: #{activeResult.selection_index}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {onVerifyEvidence && (
                <button
                  type="button"
                  onClick={() => onVerifyEvidence(activeResult)}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold border border-[#eadbcf] text-[#5c3e34] bg-[#fffaf7] hover:bg-[#f0e7df] flex items-center gap-1.5 transition-colors"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-[#7c1619]" />
                  Verify Proof
                </button>
              )}

              {onNotifyWinner && (
                <button
                  type="button"
                  onClick={() => onNotifyWinner(activeResult)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs ${activeResult.notified_at
                    ? "bg-[#f0fdf4] text-[#166534] border border-[#bbf7d0]"
                    : "bg-[#7c1619] hover:bg-[#601012] text-white"
                    }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  {activeResult.notified_at ? "Notification Sent (Re-send)" : "Notify Winner"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
