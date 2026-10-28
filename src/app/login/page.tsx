import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Sign in — SSFI Portal",
  description: "Sign in to the Senthang Students Fellowship India (SSFI) Lucky Draw administration or seller portal.",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#fffaf7] px-4 py-12 sm:px-6 lg:px-8">
      <LoginForm />
    </main>
  );
}
