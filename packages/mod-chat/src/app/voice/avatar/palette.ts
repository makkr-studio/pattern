/** Emotion → color. Neutral sits on the brand terracotta; tones shift the hue. */

import type { RGB } from "./types";

export const BRAND: RGB = [0.82, 0.42, 0.24];

// Keyword → rgb (0..1). Matched by substring so "very excited" still lands.
const MAP: Array<[string, RGB]> = [
  ["excited", [0.98, 0.45, 0.55]],
  ["happy", [0.97, 0.64, 0.26]],
  ["joy", [0.97, 0.64, 0.26]],
  ["playful", [0.86, 0.46, 0.88]],
  ["curious", [0.62, 0.5, 0.95]],
  ["thinking", [0.42, 0.62, 0.96]],
  ["focused", [0.42, 0.62, 0.96]],
  ["calm", [0.36, 0.8, 0.78]],
  ["concerned", [0.95, 0.78, 0.35]],
  ["sad", [0.42, 0.54, 0.86]],
  ["angry", [0.96, 0.34, 0.3]],
  ["neutral", BRAND],
];

export function emotionColor(emotion?: string | null): RGB {
  if (!emotion) return BRAND;
  const key = emotion.toLowerCase();
  for (const [k, rgb] of MAP) if (key.includes(k)) return rgb;
  return BRAND;
}

export function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
