"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle, Home, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Only attempt automatic reload if this is a deployment-skew chunk load failure
    // where an updated JS bundle hash is missing from the client cache.
    if (typeof window !== "undefined") {
      const message = error?.message || "";
      const isChunkLoadError =
        message.includes("Loading chunk") ||
        message.includes("Failed to fetch dynamically imported module") ||
        message.includes("missing chunk");

      if (isChunkLoadError) {
        const reloadKey = `_chunk_err_${window.location.pathname}`;
        try {
          if (!sessionStorage.getItem(reloadKey)) {
            sessionStorage.setItem(reloadKey, "1");
            window.location.reload();
          }
        } catch {
          // If storage is unavailable (e.g. private mode quota), do not loop
        }
      }
    }
  }, [error]);

  function handleCleanReload() {
    if (typeof window !== "undefined") {
      window.location.reload();
    } else {
      reset();
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-24 text-[#35110f]">
      <div className="flex items-center gap-2 text-red-700">
        <AlertCircle size={28} />
        <span className="text-xs font-bold tracking-widest uppercase">System Notice</span>
      </div>

      <h1 className="mt-4 text-3xl font-bold">We could not complete that request</h1>
      <p className="mt-3 text-sm leading-6 text-[#705a54]">
        Check the information and your access, then try again. No payment or ticket is issued unless the server completes the workflow.
      </p>

      {error?.digest && (
        <p className="mt-2 text-xs font-mono text-[#a89088]">
          Error Reference: {error.digest}
        </p>
      )}

      {error?.message && (
        <div className="mt-3 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3 text-left text-xs text-[#705a54]">
          <span className="font-semibold text-[#7c1619]">Diagnostic Detail:</span>
          <p className="mt-1 font-mono text-[11px] break-words text-red-900">
            {error.message}
          </p>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-2 rounded-xl bg-[#7c1619] px-5 py-3 text-sm font-bold text-white shadow transition hover:bg-[#631214]"
        >
          <RefreshCw size={16} />
          <span>Try Again</span>
        </button>
        <button
          type="button"
          onClick={handleCleanReload}
          className="inline-flex items-center gap-2 rounded-xl border border-[#eadbcf] bg-white px-5 py-3 text-sm font-bold text-[#705a54] shadow-xs transition hover:bg-[#fffaf7]"
        >
          <span>Reload Page</span>
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-xl border border-transparent px-4 py-3 text-sm font-semibold text-[#7c1619] hover:underline"
        >
          <Home size={16} />
          <span>Return to Homepage</span>
        </Link>
      </div>
    </main>
  );
}
