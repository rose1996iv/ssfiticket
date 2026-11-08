"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, ShieldCheck, Copy, Check, X } from "lucide-react";
import { verifyDrawEvidenceAction } from "@/server/actions/luckyDraw";

type Props = {
  evidenceId: string;
  isOpen: boolean;
  onClose: () => void;
};

export function EvidenceVerifierModal({ evidenceId, isOpen, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleVerify = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await verifyDrawEvidenceAction(evidenceId);
      if (res.success && res.data) {
        setResult(res.data);
      } else {
        setError(res.error || "Verification failed to complete.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="relative w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl border border-[#eadbcf] max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-[#705a54] hover:text-[#7c1619] p-1 rounded-lg"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fef2f2] text-[#7c1619] border border-[#fecaca]">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#2d1810]">Provably Fair Cryptographic Verification</h2>
            <p className="text-xs text-[#705a54]">Independent verification of pre-committed seeds & entropy derivation</p>
          </div>
        </div>

        {!result && !loading && (
          <div className="py-6 text-center">
            <p className="text-sm text-[#594541] mb-6">
              Run deterministic mathematical verification on this draw result. The engine will independently re-hash the revealed server seed, recompute the HMAC combined entropy, and verify the winning index with zero modulo bias.
            </p>
            <button
              type="button"
              onClick={handleVerify}
              className="inline-flex items-center gap-2 rounded-xl bg-[#7c1619] px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#681215] transition-colors"
            >
              <ShieldCheck size={18} />
              Execute Independent Verification
            </button>
          </div>
        )}

        {loading && (
          <div className="py-12 text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#7c1619] border-t-transparent mb-3" />
            <p className="text-sm font-medium text-[#705a54]">Recomputing cryptographic proofs...</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-50 p-4 border border-red-200 text-red-800 text-sm mb-4">
            <div className="flex items-center gap-2 font-semibold mb-1">
              <XCircle size={16} /> Verification Error
            </div>
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div
              className={`rounded-xl p-4 border ${
                result.isValid ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-red-50 border-red-200 text-red-900"
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-base mb-1">
                {result.isValid ? (
                  <>
                    <CheckCircle2 size={20} className="text-emerald-600" />
                    CRYPTOGRAPHIC PROOF VERIFIED — 100% MATHEMATICAL INTEGRITY
                  </>
                ) : (
                  <>
                    <XCircle size={20} className="text-red-600" />
                    VERIFICATION FAILED — INTEGRITY MISMATCH DETECTED
                  </>
                )}
              </div>
              <p className="text-xs">
                Algorithm: <span className="font-mono font-semibold">{result.evidence.algorithm_version}</span> | Timestamp:{" "}
                {new Date(result.evidence.created_at).toLocaleString("en-IN")}
              </p>
            </div>

            {/* Checklist */}
            <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-xs space-y-2">
              <div className="font-bold text-[#7c1619] uppercase tracking-wider text-[11px] mb-2">
                Verification Proof Checklist
              </div>
              {result.details.map((detail: string) => {
                const isPass = detail.startsWith("PASS");
                return (
                  <div key={detail} className="flex items-start gap-2">
                    {isPass ? (
                      <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle size={16} className="text-red-600 shrink-0 mt-0.5" />
                    )}
                    <span className={isPass ? "text-[#2d1810]" : "text-red-700 font-semibold"}>{detail}</span>
                  </div>
                );
              })}
            </div>

            {/* Evidence Technical Data */}
            <div className="space-y-2 text-xs">
              <div className="rounded-lg border border-[#eadbcf] p-3 bg-white">
                <div className="flex items-center justify-between text-[#705a54] mb-1">
                  <span className="font-semibold">Pre-Committed Seed Hash (SHA-256):</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(result.evidence.server_seed_commitment, "commit")}
                    className="text-[#7c1619] hover:underline flex items-center gap-1"
                  >
                    {copiedKey === "commit" ? <Check size={12} /> : <Copy size={12} />}
                    {copiedKey === "commit" ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="font-mono text-[11px] break-all bg-gray-50 p-2 rounded border border-gray-100">
                  {result.evidence.server_seed_commitment}
                </div>
              </div>

              <div className="rounded-lg border border-[#eadbcf] p-3 bg-white">
                <div className="flex items-center justify-between text-[#705a54] mb-1">
                  <span className="font-semibold">Revealed Server Seed:</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(result.evidence.server_seed_revealed, "seed")}
                    className="text-[#7c1619] hover:underline flex items-center gap-1"
                  >
                    {copiedKey === "seed" ? <Check size={12} /> : <Copy size={12} />}
                    {copiedKey === "seed" ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="font-mono text-[11px] break-all bg-gray-50 p-2 rounded border border-gray-100">
                  {result.evidence.server_seed_revealed}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-[#eadbcf] p-3 bg-white">
                  <span className="font-semibold text-[#705a54] block mb-1">Client Entropy:</span>
                  <span className="font-mono text-[11px] break-all">{result.evidence.client_entropy || "N/A"}</span>
                </div>
                <div className="rounded-lg border border-[#eadbcf] p-3 bg-white">
                  <span className="font-semibold text-[#705a54] block mb-1">Derived Winning Index:</span>
                  <span className="font-bold text-sm text-[#7c1619]">
                    Index {result.evidence.selected_index} of {result.evidence.total_candidates} tickets
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-[#eadbcf] bg-white px-5 py-2.5 text-xs font-semibold text-[#594541] hover:bg-[#fffaf7]"
              >
                Close Verification
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

