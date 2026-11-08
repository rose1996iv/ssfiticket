"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Trophy,
  Users,
  Lock,
  RefreshCw,
  FileCheck,
} from "lucide-react";
import {
  DrawOverviewData,
  DrawResultRecord,
} from "@/lib/draw/types";
import { RotatingNumberDrum } from "./RotatingNumberDrum";
import { EligibilityManager } from "./EligibilityManager";
import { FirstPrizeApprovalCard } from "./FirstPrizeApprovalCard";
import { DrawResultsTable } from "./DrawResultsTable";
import { EvidenceVerifierModal } from "./EvidenceVerifierModal";
import { WinnerNotificationModal } from "./WinnerNotificationModal";

interface LuckyDrawDashboardProps {
  initialData: DrawOverviewData;
}

export function LuckyDrawDashboard({ initialData }: LuckyDrawDashboardProps) {
  const router = useRouter();
  const [data, setData] = useState<DrawOverviewData>(initialData);
  const [activeTab, setActiveTab] = useState<"stage" | "eligibility" | "results" | "approval">(
    "stage"
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Modals state
  const [selectedResultIdForEvidence, setSelectedResultIdForEvidence] = useState<string | null>(null);
  const [isEvidenceModalOpen, setIsEvidenceModalOpen] = useState(false);
  const [selectedResultIdForNotify, setSelectedResultIdForNotify] = useState<string | null>(null);
  const [isNotifyModalOpen, setIsNotifyModalOpen] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    router.refresh();
    setTimeout(() => {
      setIsRefreshing(false);
    }, 800);
  };

  const handleDrawCompleted = (newResult: DrawResultRecord) => {
    setData((prev) => {
      const existing = prev.results.filter((r) => r.id !== newResult.id);
      const updatedResults = [newResult, ...existing];
      const drawnIds = new Set(updatedResults.map((r) => r.prize_id));

      // Re-determine next prize (5th -> 4th -> 3rd -> 2nd -> 1st)
      let next: typeof prev.nextPrize = null;
      for (let pNum = 5; pNum >= 1; pNum--) {
        const p = prev.prizes.find((item) => item.prize_number === pNum);
        if (p && !drawnIds.has(p.id)) {
          next = p;
          break;
        }
      }

      return {
        ...prev,
        results: updatedResults,
        nextPrize: next,
      };
    });
    router.refresh();
  };

  const handleVerifyEvidence = (result: DrawResultRecord) => {
    setSelectedResultIdForEvidence(result.id);
    setIsEvidenceModalOpen(true);
  };

  const handleNotifyWinner = (result: DrawResultRecord) => {
    setSelectedResultIdForNotify(result.id);
    setIsNotifyModalOpen(true);
  };

  const { campaign, prizes, drawSession, results, nextPrize, activeSnapshot, pendingApproval, userRole } = data;

  const totalPrizes = prizes.length || 5;
  const completedPrizes = results.length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* ==================================================================== */}
      {/* 1. HEADER SECTION                                                    */}
      {/* ==================================================================== */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-[#eadbcf] p-6 rounded-3xl shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-[#7c1619] text-white">
              <Trophy className="w-3.5 h-3.5" /> Official Lucky Draw Control Center
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#fffaf7] text-[#7c1619] border border-[#eadbcf]">
              Phase 9D Active
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#2d1810]">
            {campaign?.name || "SSFI Fundraising Lucky Draw"}
          </h1>
          <p className="text-xs sm:text-sm text-[#705a54] mt-1">
            Ceremonial draw order (5th &rarr; 4th &rarr; 3rd &rarr; 2nd &rarr; 1st) with single-winner uniqueness and Policy A dual control.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="px-4 py-2.5 rounded-xl border border-[#eadbcf] text-xs font-bold text-[#5c3e34] bg-[#fffaf7] hover:bg-[#f0e7df] flex items-center gap-2 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>Refresh State</span>
          </button>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 2. NAVIGATION TABS                                                   */}
      {/* ==================================================================== */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-[#eadbcf] pb-2 text-xs font-bold">
        <button
          type="button"
          onClick={() => setActiveTab("stage")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-colors whitespace-nowrap ${
            activeTab === "stage"
              ? "bg-[#7c1619] text-white shadow-xs"
              : "text-[#705a54] hover:bg-[#fffaf7] hover:text-[#2d1810]"
          }`}
        >
          <Trophy className="w-4 h-4" /> Live Drum Stage
          {nextPrize && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-white/20 text-white">
              {nextPrize.prize_number === 1 ? "1st Prize" : `${nextPrize.prize_number}th Prize`}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("eligibility")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-colors whitespace-nowrap ${
            activeTab === "eligibility"
              ? "bg-[#7c1619] text-white shadow-xs"
              : "text-[#705a54] hover:bg-[#fffaf7] hover:text-[#2d1810]"
          }`}
        >
          <Users className="w-4 h-4" /> Eligibility &amp; Snapshot
          {activeSnapshot && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-green-100 text-green-800 font-mono">
              Locked
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("results")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-colors whitespace-nowrap ${
            activeTab === "results"
              ? "bg-[#7c1619] text-white shadow-xs"
              : "text-[#705a54] hover:bg-[#fffaf7] hover:text-[#2d1810]"
          }`}
        >
          <FileCheck className="w-4 h-4" /> Draw Results ({completedPrizes}/{totalPrizes})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("approval")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-colors whitespace-nowrap ${
            activeTab === "approval"
              ? "bg-[#7c1619] text-white shadow-xs"
              : "text-[#705a54] hover:bg-[#fffaf7] hover:text-[#2d1810]"
          }`}
        >
          <Lock className="w-4 h-4" /> 1st Prize Dual Authorization
          {pendingApproval && (
            <span
              className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${
                pendingApproval.status === "APPROVED"
                  ? "bg-green-100 text-green-800"
                  : pendingApproval.status === "REJECTED"
                  ? "bg-red-100 text-red-800"
                  : "bg-amber-100 text-amber-800 animate-pulse"
              }`}
            >
              {pendingApproval.status}
            </span>
          )}
        </button>
      </div>

      {/* ==================================================================== */}
      {/* 3. TAB PANELS                                                        */}
      {/* ==================================================================== */}

      {/* TAB 1: LIVE DRUM STAGE */}
      {activeTab === "stage" && (
        <div className="space-y-6">
          <RotatingNumberDrum
            campaignId={campaign?.id || ""}
            session={drawSession}
            prizes={prizes}
            snapshot={activeSnapshot}
            results={results}
            nextPrize={nextPrize}
            approval={pendingApproval}
            currentUser={{
              id: userRole.userId,
              email: userRole.email,
              role: userRole.isSuperAdmin ? "SUPER_ADMIN" : "ADMIN",
            }}
            onDrawCompleted={handleDrawCompleted}
            onRequestApproval={() => setActiveTab("approval")}
            onVerifyEvidence={handleVerifyEvidence}
            onNotifyWinner={handleNotifyWinner}
          />

          {/* Quick Dual Control Alert if 1st Prize is next and not approved */}
          {nextPrize?.prize_number === 1 && pendingApproval?.status !== "APPROVED" && (
            <div className="bg-[#fffbeb] border border-[#fde68a] rounded-2xl p-5 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#fef3c7] text-[#92400e] flex items-center justify-center shrink-0">
                    <Lock className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-[#92400e]">
                      First Prize Dual Authorization Required (Policy A)
                    </h4>
                    <p className="text-xs text-[#b45309] mt-0.5 max-w-2xl leading-relaxed">
                      Under approved Policy A, drawing the Grand Prize requires initiation by a SUPER_ADMIN and independent approval by a distinct administrator. Self-approval is strictly forbidden.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("approval")}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-[#92400e] hover:bg-[#78350f] text-white shrink-0 transition-colors"
                >
                  Manage Approval &rarr;
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ELIGIBILITY & SNAPSHOT */}
      {activeTab === "eligibility" && (
        <EligibilityManager
          campaignId={campaign?.id || ""}
          drawId={drawSession?.id || ""}
          activePrize={nextPrize || prizes[0] || null}
          activeSnapshot={activeSnapshot}
          onSnapshotLocked={() => {
            router.refresh();
            setActiveTab("stage");
          }}
        />
      )}

      {/* TAB 3: DRAW RESULTS */}
      {activeTab === "results" && (
        <DrawResultsTable
          results={results}
          prizes={prizes}
          onVerifyEvidence={handleVerifyEvidence}
          onNotifyWinner={handleNotifyWinner}
        />
      )}

      {/* TAB 4: 1ST PRIZE DUAL AUTHORIZATION */}
      {activeTab === "approval" && (
        <div className="max-w-3xl mx-auto space-y-6">
          {drawSession && prizes.some((p) => p.prize_number === 1) && activeSnapshot ? (
            <FirstPrizeApprovalCard
              drawId={drawSession.id}
              prizeId={prizes.find((p) => p.prize_number === 1)!.id}
              snapshot={activeSnapshot}
              approval={pendingApproval}
              currentUser={{
                userId: userRole.userId,
                email: userRole.email,
                isSuperAdmin: userRole.isSuperAdmin,
                isAdmin: userRole.isAdmin,
              }}
              onUpdated={() => {
                router.refresh();
              }}
            />
          ) : (
            <div className="bg-white border border-[#eadbcf] rounded-2xl p-6 text-center text-[#705a54] shadow-xs">
              <Lock className="w-10 h-10 text-[#a89086] mx-auto mb-2" />
              <h4 className="font-bold text-base text-[#2d1810]">
                Eligibility Snapshot Required
              </h4>
              <p className="text-xs text-[#a89086] max-w-md mx-auto mt-1 mb-4">
                Before dual authorization can be requested or approved for the 1st Prize, an eligibility snapshot must first be generated and locked for this prize.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab("eligibility")}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-[#7c1619] text-white hover:bg-[#601012] transition-colors"
              >
                Go to Eligibility Manager &rarr;
              </button>
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* 4. MODALS                                                            */}
      {/* ==================================================================== */}

      {/* Cryptographic Evidence Verifier Modal */}
      {selectedResultIdForEvidence && (
        <EvidenceVerifierModal
          drawResultId={selectedResultIdForEvidence}
          isOpen={isEvidenceModalOpen}
          onClose={() => {
            setIsEvidenceModalOpen(false);
            setSelectedResultIdForEvidence(null);
          }}
        />
      )}

      {/* Winner Notification Modal */}
      {selectedResultIdForNotify && (
        <WinnerNotificationModal
          resultId={selectedResultIdForNotify}
          isOpen={isNotifyModalOpen}
          onClose={() => {
            setIsNotifyModalOpen(false);
            setSelectedResultIdForNotify(null);
          }}
          onSuccess={() => {
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
