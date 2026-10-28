"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, HelpCircle, Loader2, Lock, Mail, ShieldAlert } from "lucide-react";
import { login } from "@/server/actions/auth";
import { Logo } from "@/components/brand/Logo";

export function LoginForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const res = await login(formData);
      if (res && res.error) {
        setErrorMsg(res.error);
        setIsSubmitting(false);
      }
    } catch (err: unknown) {
      // In Next.js, redirect() throws an internal NEXT_REDIRECT error which must bubble up
      if (err instanceof Error && (err.message === "NEXT_REDIRECT" || "digest" in err)) {
        throw err;
      }
      setIsSubmitting(false);
      setErrorMsg(err instanceof Error ? err.message : "Unable to authenticate. Please check your credentials.");
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="overflow-hidden rounded-2xl border border-[#eadbcf] bg-white shadow-xl">
        {/* Top Branded Bar */}
        <div className="border-b border-[#e8d6c5] bg-[#7c1619] px-8 py-8 text-center text-white">
          <div className="flex justify-center">
            <Logo size="lg" className="transition-transform hover:scale-105" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">SSFI Lucky Draw</h1>
          <p className="mt-1 text-xs font-medium text-[#f8e9df]">
            Staff & Seller Authentication Portal
          </p>
        </div>

        {/* Form Body */}
        <div className="p-8">
          {errorMsg && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900">
              <ShieldAlert className="mt-0.5 shrink-0 text-red-600" size={18} />
              <div className="leading-relaxed">
                <p className="font-bold">Authentication failed</p>
                <p className="mt-1">{errorMsg}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-bold tracking-wider uppercase text-[#705a54]"
              >
                Email Address
              </label>
              <div className="relative mt-1.5">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[#705a54]">
                  <Mail size={16} />
                </span>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="admin@example.com"
                  className="w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] py-3 pr-3 pl-10 text-sm text-[#35110f] transition focus:border-[#7c1619] focus:bg-white focus:ring-2 focus:ring-[#7c1619]/20 focus:outline-hidden"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-bold tracking-wider uppercase text-[#705a54]"
              >
                Password
              </label>
              <div className="relative mt-1.5">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[#705a54]">
                  <Lock size={16} />
                </span>
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  className="w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] py-3 pr-10 pl-10 text-sm font-mono text-[#35110f] transition focus:border-[#7c1619] focus:bg-white focus:ring-2 focus:ring-[#7c1619]/20 focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-[#705a54] hover:text-[#35110f]"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7c1619] py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-[#631214] focus:ring-2 focus:ring-[#7c1619]/30 focus:outline-hidden disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  <span>Signing in...</span>
                </>
              ) : (
                <span>Sign in to Portal</span>
              )}
            </button>
          </form>

          {/* Admin Setup Help Drawer */}
          <div className="mt-6 border-t border-[#f0e7df] pt-4">
            <button
              type="button"
              onClick={() => setShowHelp((prev) => !prev)}
              className="flex w-full items-center justify-between text-xs text-[#705a54] hover:text-[#7c1619]"
            >
              <span className="inline-flex items-center gap-1.5 font-medium">
                <HelpCircle size={14} />
                <span>Admin credentials setup help</span>
              </span>
              <span>{showHelp ? "▲" : "▼"}</span>
            </button>

            {showHelp && (
              <div className="mt-3 rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-xs leading-relaxed text-[#705a54]">
                <p className="font-bold text-[#35110f]">First time signing in as administrator?</p>
                <ol className="mt-2 list-decimal space-y-1 pl-4">
                  <li>
                    Create your user in <b>Supabase Dashboard</b> → <b>Authentication</b> → <b>Users</b>.
                  </li>
                  <li>
                    Run the role assignment script in <b>Supabase SQL Editor</b> from{" "}
                    <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px] text-[#7c1619]">
                      supabase/provision_admin.sql
                    </code>
                    .
                  </li>
                  <li>Sign in here using your provisioned email and password.</li>
                </ol>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 text-center">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7c1619] transition hover:text-[#631214] hover:underline"
        >
          <ArrowLeft size={14} />
          <span>Return to SSFI Lucky Draw Homepage</span>
        </Link>
      </div>
    </div>
  );
}
