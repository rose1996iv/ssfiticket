import Image from "next/image";
import Link from "next/link";
import { Mail, LogIn, Play } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { buildYouTubeStandardEmbedUrl } from "@/lib/video/youtube";

function InstagramIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

function FacebookIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function YouTubeIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

export function OfficialFooter() {
  const currentYear = new Date().getFullYear();
  const footerVideoEmbedUrl = buildYouTubeStandardEmbedUrl(process.env.NEXT_PUBLIC_HERO_YOUTUBE_URL);

  return (
    <footer className="border-t border-[#3d0b0d] bg-[#230607] text-[#f8e9df]">
      {/* Central "Follow Us" & Social Channels Spotlight */}
      <div className="mx-auto max-w-5xl px-6 py-16 sm:px-10 sm:py-20">
        <div className="rounded-3xl border border-[#4d1618] bg-[#350d0f] p-8 shadow-md sm:p-12">
          {/* Section Header: Centered Vertical Stack */}
          <div className="flex flex-col items-center text-center">
            <h2 className="glitch-title text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Follow SSFI on Social Media
            </h2>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#f3ce75]">
              <InstagramIcon size={14} />
              <span>Official Social Media</span>
            </div>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[#eadbcf]">
              Scan the official Instagram QR code or connect across our verified social channels for lucky
              draw announcements, celebration results, and student fellowship activities.
            </p>
          </div>

          {/* Scannable Instagram QR Image Container */}
          <div className="mt-8 flex flex-col items-center">
            <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white p-4 shadow-xl">
              <div className="relative h-48 w-48 overflow-hidden rounded-xl bg-white sm:h-52 sm:w-52">
                <Image
                  src="/insta_qr.png"
                  alt="Scan to follow Senthang Students Fellowship India on Instagram"
                  width={208}
                  height={208}
                  className="h-full w-full object-contain"
                  priority={false}
                />
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-xs font-bold text-[#7c1619]">
                <InstagramIcon size={15} />
                <span>@ssfi_official • Instagram</span>
              </div>
              <span className="mt-1 text-[11px] text-[#705a54]">
                Scan with your phone camera to follow
              </span>
            </div>
          </div>

          {/* Campaign Video Spotlight */}
          {footerVideoEmbedUrl && (
            <div className="mt-10 flex flex-col items-center">
              <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#f3ce75]">
                <Play size={12} fill="currentColor" />
                <span>Campaign Video Spotlight</span>
              </div>
              <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/15 bg-black/40 shadow-2xl">
                <div className="relative aspect-video w-full">
                  <iframe
                    src={footerVideoEmbedUrl}
                    title="SSFI Lucky Draw Campaign Official Video"
                    loading="lazy"
                    className="absolute inset-0 h-full w-full border-0"
                    allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                </div>
              </div>
              <p className="mt-2 text-center text-xs text-[#d8c2b5]">
                Watch the official SSFI Lucky Draw celebration preview video
              </p>
            </div>
          )}

          {/* Verified Official Social Channels Grid */}
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {/* Facebook */}
            <a
              href="https://www.facebook.com/senthangstudents"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col items-center rounded-2xl border border-white/10 bg-white/5 p-5 text-center transition hover:border-[#f3ce75] hover:bg-white/10 hover:scale-[1.02]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1877F2]/20 text-[#1877F2] transition group-hover:bg-[#1877F2] group-hover:text-white">
                <FacebookIcon size={20} />
              </div>
              <span className="mt-3 text-sm font-bold text-white">Facebook</span>
              <span className="mt-1 text-xs text-[#d8c2b5] group-hover:text-[#f3ce75]">
                facebook.com/senthangstudents
              </span>
            </a>

            {/* YouTube */}
            <a
              href="https://www.youtube.com/@SenthangStudentsSSFI"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col items-center rounded-2xl border border-white/10 bg-white/5 p-5 text-center transition hover:border-[#f3ce75] hover:bg-white/10 hover:scale-[1.02]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#FF0000]/20 text-[#FF0000] transition group-hover:bg-[#FF0000] group-hover:text-white">
                <YouTubeIcon size={20} />
              </div>
              <span className="mt-3 text-sm font-bold text-white">YouTube</span>
              <span className="mt-1 text-xs text-[#d8c2b5] group-hover:text-[#f3ce75]">
                @SenthangStudentsSSFI
              </span>
            </a>

            {/* Email */}
            <a
              href="mailto:Senthangstudents@gmail.com"
              className="group flex flex-col items-center rounded-2xl border border-white/10 bg-white/5 p-5 text-center transition hover:border-[#f3ce75] hover:bg-white/10 hover:scale-[1.02]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#EA4335]/20 text-[#EA4335] transition group-hover:bg-[#EA4335] group-hover:text-white">
                <Mail size={20} />
              </div>
              <span className="mt-3 text-sm font-bold text-white">Official Email</span>
              <span className="mt-1 font-mono text-xs text-[#d8c2b5] group-hover:text-[#f3ce75]">
                Senthangstudents@gmail.com
              </span>
            </a>
          </div>
        </div>

        {/* Lower Footer Navigation & Attribution */}
        <div className="mt-16 flex flex-col items-center justify-between gap-6 border-t border-white/10 pt-8 sm:flex-row">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <div className="flex flex-col">
              <span className="text-sm font-bold text-white">Senthang Students Fellowship India</span>
              <span className="text-xs text-[#d8c2b5]">Official Fundraising Campaign &amp; Ticket System</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs text-[#eadbcf]">
            <Link href="/buy" className="hover:text-white hover:underline">
              Buy Tickets
            </Link>
            <Link href="/verify/SSFI-000001" className="hover:text-white hover:underline">
              Ticket Verification
            </Link>
            <Link href="/terms" className="hover:text-white hover:underline">
              Terms &amp; Conditions
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-1 text-[#f3ce75] hover:text-[#ffd980] hover:underline"
            >
              <LogIn size={13} />
              <span>Staff / Seller Portal</span>
            </Link>
          </div>
        </div>

        {/* Legal & Non-Profit Notice */}
        <div className="mt-8 border-t border-white/5 pt-6 text-center text-xs text-[#d8c2b5]/60">
          <p>
            © {currentYear} Senthang Students Fellowship India (SSFI). All rights reserved. This fundraising draw is
            organized strictly for student educational and fellowship initiatives.
          </p>
        </div>
      </div>
    </footer>
  );
}
