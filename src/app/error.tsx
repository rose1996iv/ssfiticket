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
    // If an unhandled error reaches the global error boundary,
    // execute a single automatic full reload with cache-busting to self-heal
    // stale mobile browser client tabs, version skew, chunk load failures, or BFCache traps.
    if (typeof window !== "undefined") {
      const message = error?.message || "";
      const isChunkOrVersionError =
        message.includes("Loading chunk") ||
        message.includes("Failed to fetch dynamically imported module") ||
        message.includes("router state") ||
        message.includes("Server Components render") ||
        Boolean(error?.digest);

      if (isChunkOrVersionError) {
        const reloadKey = `_err_rec_${window.location.pathname}_${error?.digest || "stale"}`;
        try {
          if (!sessionStorage.getItem(reloadKey)) {
            sessionStorage.setItem(reloadKey, "1");
            const url = new URL(window.location.href);
            url.searchParams.set("_r", Date.now().toString());
            window.location.replace(url.toString());
          }
        } catch {
          // If sessionStorage access is restricted in private/incognito mode
          try {
            window.location.reload();
          } catch {
            // Ignore if reload blocked
          }
        }
      }
    }
  }, [error]);

  function handleHardReload() {
    if (typeof window !== "undefined") {
      try {
        // Bust mobile browser BFCache and intermediate CDN/proxy caches
        const url = new URL(window.location.href);
        url.searchParams.set("_r", Date.now().toString());
        window.location.replace(url.toString());
      } catch {
        window.location.reload();
      }
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
