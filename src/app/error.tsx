"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // If the error is due to chunk failure or stale router tree from a deployment update,
    // a single automatic full reload self-heals the mobile client.
    const message = error?.message || "";
    const isChunkOrVersionError =
      message.includes("Loading chunk") ||
      message.includes("Failed to fetch dynamically imported module") ||
      message.includes("router state") ||
      error?.digest?.includes("NEXT_ROUTER_PREFETCH");

    if (isChunkOrVersionError && typeof window !== "undefined") {
      const reloadedKey = `_reloaded_${error?.digest || message}`;
      if (!sessionStorage.getItem(reloadedKey)) {
        sessionStorage.setItem(reloadedKey, "1");
        window.location.reload();
      }
    }
  }, [error]);

  function handleHardReload() {
    if (typeof window !== "undefined") {
      window.location.href = window.location.href;
    } else {
      reset();
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <h1 className="text-3xl font-bold text-[#35110f]">We could not complete that request</h1>
      <p className="mt-4 text-[#705a54]">
        Check the information and your access, then try again. No payment or ticket is issued unless the server completes the workflow.
      </p>

      {error?.digest && (
        <p className="mt-2 text-xs font-mono text-[#a89088]">
          Error ID: {error.digest}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          onClick={handleHardReload}
          className="rounded-xl bg-[#7c1619] px-5 py-3 font-bold text-white transition hover:bg-[#631214]"
        >
          Reload Page
        </button>
        <button
          onClick={reset}
          className="rounded-xl border border-[#eadbcf] bg-white px-5 py-3 font-bold text-[#705a54] transition hover:bg-[#fffaf7]"
        >
          Try Again
        </button>
      </div>
    </main>
  );
}
