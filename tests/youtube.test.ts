import test from "node:test";
import assert from "node:assert/strict";
import { parseYouTubeVideo, buildYouTubeHeroEmbedUrl } from "../src/lib/video/youtube.ts";

test("parseYouTubeVideo extracts ID from standard watch URLs", () => {
  const result = parseYouTubeVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.deepEqual(result, { videoId: "dQw4w9WgXcQ", isLive: false });
});

test("parseYouTubeVideo extracts ID from short youtu.be URLs", () => {
  const result = parseYouTubeVideo("https://youtu.be/dQw4w9WgXcQ");
  assert.deepEqual(result, { videoId: "dQw4w9WgXcQ", isLive: false });
});

test("parseYouTubeVideo extracts ID from embed URLs", () => {
  const result = parseYouTubeVideo("https://www.youtube.com/embed/dQw4w9WgXcQ");
  assert.deepEqual(result, { videoId: "dQw4w9WgXcQ", isLive: false });
});

test("parseYouTubeVideo extracts ID and flags live stream URLs", () => {
  const result = parseYouTubeVideo("https://www.youtube.com/live/dQw4w9WgXcQ?feature=share");
  assert.deepEqual(result, { videoId: "dQw4w9WgXcQ", isLive: true });
});

test("parseYouTubeVideo extracts ID from shorts URLs", () => {
  const result = parseYouTubeVideo("https://youtube.com/shorts/dQw4w9WgXcQ");
  assert.deepEqual(result, { videoId: "dQw4w9WgXcQ", isLive: false });
});

test("parseYouTubeVideo accepts raw 11-char video ID", () => {
  const result = parseYouTubeVideo("dQw4w9WgXcQ");
  assert.deepEqual(result, { videoId: "dQw4w9WgXcQ", isLive: false });
});

test("parseYouTubeVideo returns null for invalid or malicious inputs", () => {
  assert.equal(parseYouTubeVideo(null), null);
  assert.equal(parseYouTubeVideo(""), null);
  assert.equal(parseYouTubeVideo("   "), null);
  assert.equal(parseYouTubeVideo("https://malicious-site.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parseYouTubeVideo("https://www.youtube.com/watch?v=short"), null);
  assert.equal(parseYouTubeVideo("javascript:alert(1)"), null);
  assert.equal(parseYouTubeVideo("<script>alert(1)</script>"), null);
});

test("buildYouTubeHeroEmbedUrl builds looping embed for standard video", () => {
  const url = buildYouTubeHeroEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.ok(url);
  assert.ok(url.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?"));
  assert.ok(url.includes("autoplay=1"));
  assert.ok(url.includes("mute=1"));
  assert.ok(url.includes("loop=1"));
  assert.ok(url.includes("playlist=dQw4w9WgXcQ"));
});

test("buildYouTubeHeroEmbedUrl builds non-looping embed for live stream", () => {
  const url = buildYouTubeHeroEmbedUrl("https://www.youtube.com/live/dQw4w9WgXcQ");
  assert.ok(url);
  assert.ok(url.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?"));
  assert.ok(url.includes("autoplay=1"));
  assert.ok(url.includes("mute=1"));
  assert.equal(url.includes("loop=1"), false);
  assert.equal(url.includes("playlist="), false);
});

test("buildYouTubeHeroEmbedUrl returns null when URL is empty or invalid", () => {
  assert.equal(buildYouTubeHeroEmbedUrl(undefined), null);
  assert.equal(buildYouTubeHeroEmbedUrl(""), null);
  assert.equal(buildYouTubeHeroEmbedUrl("https://vimeo.com/123456"), null);
});
