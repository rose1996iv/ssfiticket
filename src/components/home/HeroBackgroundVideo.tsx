import { buildYouTubeHeroEmbedUrl } from "@/lib/video/youtube";

type HeroBackgroundVideoProps = {
  videoUrl?: string;
};

/**
 * Decorative YouTube background video player for the homepage hero section.
 *
 * Features:
 * - Plays silently in the background (muted autoplay) with no user controls.
 * - Sits behind content (pointer-events-none, z-0) so clicks and navigation are never intercepted.
 * - Seamlessly loops standard videos (live streams play continuously without looping).
 * - Preserves SSFI burgundy and gold branding through an ambient color overlay.
 * - Automatically falls back to a deep burgundy gradient when no URL is set or if loading fails.
 * - Natively honors reduced-motion preferences (`motion-reduce:hidden`).
 */
export function HeroBackgroundVideo({ videoUrl }: HeroBackgroundVideoProps) {
  const targetUrl = videoUrl ?? process.env.NEXT_PUBLIC_HERO_YOUTUBE_URL;
  const embedUrl = buildYouTubeHeroEmbedUrl(targetUrl);

  return (
    <div
      className="pointer-events-none absolute inset-0 select-none overflow-hidden"
      aria-hidden="true"
    >
      {/* 1. Base Static Burgundy Gradient (Always present as primary base / fallback) */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#7c1619] via-[#631214] to-[#420a0b]" />

      {/* 2. Embedded Video Layer (Rendered only when valid YouTube URL is configured) */}
      {embedUrl && (
        <div className="absolute inset-0 overflow-hidden opacity-35 mix-blend-luminosity motion-reduce:hidden">
          <iframe
            src={embedUrl}
            title="SSFI Promotional Video"
            tabIndex={-1}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-1/2 aspect-video min-h-full min-w-full -translate-x-1/2 -translate-y-1/2 border-0 [height:56.25vw] [width:177.78vh] filter saturate-75"
            allow="autoplay; encrypted-media"
          />
        </div>
      )}

      {/* 3. Deep Burgundy Brand Overlay (Guarantees WCAG text contrast & brand fidelity) */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#7c1619]/95 via-[#7c1619]/80 to-[#7c1619]/90" />

      {/* 4. Subtle Radial Vignette for depth */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-transparent via-[#7c1619]/40 to-[#420a0b]/80" />
    </div>
  );
}
