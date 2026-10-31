import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";
import { Logo } from "@/components/brand/Logo";

export default function OrderNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#fffaf7] px-4 py-12 text-[#35110f] sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-[#eadbcf] bg-white p-8 text-center shadow-lg">
        <div className="mx-auto flex justify-center">
          <Logo size="lg" className="transition-transform hover:scale-105" />
        </div>

        <div className="mt-6 mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-700">
          <SearchX size={28} />
        </div>

        <h1 className="mt-4 text-xl font-bold sm:text-2xl">Order Not Found</h1>
        <p className="mt-2 text-xs text-[#705a54] leading-relaxed">
          We could not locate an order matching this reference. If you placed this order in a test or preview deployment, please ensure your link points to that specific test environment rather than Production.
        </p>

        <div className="mt-5 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3 text-xs text-[#594541]">
          <p className="font-semibold">Need Assistance?</p>
          <p className="mt-1">
            Email:{" "}
            <a href="mailto:Senthangstudents@gmail.com" className="font-semibold text-[#7c1619] underline">
              Senthangstudents@gmail.com
            </a>
          </p>
        </div>

        <div className="mt-6 border-t border-[#f0e7df] pt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#7c1619] px-5 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#631214]"
          >
            <ArrowLeft size={14} />
            <span>Return to SSFI Homepage</span>
          </Link>
        </div>
      </div>
    </main>
  );
}

