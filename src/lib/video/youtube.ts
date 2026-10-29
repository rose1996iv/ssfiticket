/**
 * Safe parser for YouTube video URLs and live streams.
 * Strictly verifies the extracted video ID against ^[a-zA-Z0-9_-]{11}$
 * to prevent any arbitrary or malicious iframe embedding.
 */
export function parseYouTubeVideo(rawUrl?: string | null): {
  videoId: string;
  isLive: boolean;
} | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;

  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // Direct 11-character video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return { videoId: trimmed, isLive: false };
  }

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    const pathname = parsed.pathname;

    let videoId: string | null = null;
    let isLive = false;

    if (hostname === "youtu.be") {
      // Example: https://youtu.be/dQw4w9WgXcQ
      videoId = pathname.slice(1).split("/")[0] ?? null;
    } else if (hostname === "youtube.com" || hostname === "youtube-nocookie.com") {
      if (pathname === "/watch") {
        // Example: https://www.youtube.com/watch?v=dQw4w9WgXcQ
        videoId = parsed.searchParams.get("v");
      } else if (pathname.startsWith("/embed/")) {
        // Example: https://www.youtube.com/embed/dQw4w9WgXcQ
        videoId = pathname.slice("/embed/".length).split("/")[0] ?? null;
      } else if (pathname.startsWith("/live/")) {
        // Example: https://www.youtube.com/live/dQw4w9WgXcQ
        videoId = pathname.slice("/live/".length).split("/")[0] ?? null;
        isLive = true;
      } else if (pathname.startsWith("/shorts/")) {
        // Example: https://www.youtube.com/shorts/dQw4w9WgXcQ
        videoId = pathname.slice("/shorts/".length).split("/")[0] ?? null;
      } else if (pathname.startsWith("/v/")) {
        // Example: https://www.youtube.com/v/dQw4w9WgXcQ
        videoId = pathname.slice("/v/".length).split("/")[0] ?? null;
      }
    }

    if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return { videoId, isLive };
    }
  } catch {
    // Malformed or invalid URL string
  }

  return null;
}

/**
 * Builds the official privacy-enhanced YouTube embed URL with
 * parameters optimized for decorative background playback.
 *
 * Parameters used:
 * - autoplay=1: Initiates playback automatically.
 * - mute=1: Ensures autoplay succeeds and stays silent.
 * - playsinline=1: Plays inline on mobile browsers instead of fullscreen.
 * - controls=0: Hides playback controls.
 * - rel=0: Restricts related videos.
 * - disablekb=1: Disables keyboard controls.
 * - modestbranding=1: Minimizes YouTube branding.
 * - loop=1 & playlist=ID: Loops standard videos continuously (not applied to live streams).
 */
export function buildYouTubeHeroEmbedUrl(rawUrl?: string | null): string | null {
  const result = parseYouTubeVideo(rawUrl);
  if (!result) return null;

  const { videoId, isLive } = result;

  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    playsinline: "1",
    controls: "0",
    showinfo: "0",
    rel: "0",
    disablekb: "1",
    modestbranding: "1",
    iv_load_policy: "3",
    fs: "0",
    enablejsapi: "1",
  });

  if (!isLive) {
    // Standard YouTube videos require loop=1 and playlist=<VIDEO_ID> to repeat seamlessly
    params.set("loop", "1");
    params.set("playlist", videoId);
  }

  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}
