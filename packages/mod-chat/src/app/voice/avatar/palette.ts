/**
 * Emotion → color gradient. Neutral is a neon violet→aqua sweep; each emotion
 * shifts both stops so the whole cloud re-hues, not just one flat tone.
 */

import type { RGB } from "./types";

// Neutral gradient stops (electric violet → aqua). Retune these to rebrand the
// avatar's resting palette.
export const BRAND_A: RGB = [0.62, 0.36, 1.0];
export const BRAND_B: RGB = [0.25, 0.92, 0.98];
export const BRAND: RGB = BRAND_A; // back-compat single-color alias

// Keyword → [stopA, stopB] (rgb 0..1). Matched by substring so "very excited"
// still lands. Each pair is two related hues that read as one mood.
const GRAD: Array<[string, [RGB, RGB]]> = [
  ["excited", [[1.0, 0.42, 0.62], [1.0, 0.78, 0.34]]],
  ["happy", [[1.0, 0.6, 0.3], [1.0, 0.86, 0.42]]],
  ["joy", [[1.0, 0.6, 0.3], [1.0, 0.86, 0.42]]],
  ["playful", [[0.92, 0.4, 0.95], [0.45, 0.7, 1.0]]],
  ["curious", [[0.62, 0.45, 1.0], [0.35, 0.92, 0.95]]],
  ["thinking", [[0.4, 0.55, 1.0], [0.45, 0.92, 0.95]]],
  ["focused", [[0.4, 0.55, 1.0], [0.45, 0.92, 0.95]]],
  ["calm", [[0.3, 0.8, 0.85], [0.45, 0.65, 1.0]]],
  ["concerned", [[0.95, 0.78, 0.35], [0.95, 0.5, 0.4]]],
  ["sad", [[0.35, 0.5, 0.9], [0.45, 0.7, 1.0]]],
  ["angry", [[1.0, 0.32, 0.3], [1.0, 0.6, 0.25]]],
  ["neutral", [BRAND_A, BRAND_B]],
];

/** The two-stop gradient for an emotion (defaults to the neutral brand sweep). */
export function emotionGradient(emotion?: string | null): [RGB, RGB] {
  if (!emotion) return [BRAND_A, BRAND_B];
  const key = emotion.toLowerCase();
  for (const [k, g] of GRAD) if (key.includes(k)) return g;
  return [BRAND_A, BRAND_B];
}

/** The primary (stop A) color for an emotion — kept for callers wanting one tone. */
export function emotionColor(emotion?: string | null): RGB {
  return emotionGradient(emotion)[0];
}

export function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
