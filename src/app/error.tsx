"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto max-w-xl px-6 py-24"><h1 className="text-3xl font-bold">We could not complete that request</h1><p className="mt-4 text-[#705a54]">Check the information and your access, then try again. No payment or ticket is issued unless the server completes the workflow.</p><button onClick={reset} className="mt-6 rounded bg-[#7c1619] px-4 py-3 font-bold text-white">Try again</button></main>;
}
