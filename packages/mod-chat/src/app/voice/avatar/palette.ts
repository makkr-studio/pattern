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
// still lands. Each pair is two related hues that read as one mood — deliberately
// distinct from the neutral violet/aqua so the shift reads, not subliminal.
const GRAD: Array<[string, [RGB, RGB]]> = [
  ["excited", [[1.0, 0.28, 0.5], [1.0, 0.66, 0.2]]], // hot pink → orange
  ["happy", [[1.0, 0.74, 0.2], [1.0, 0.48, 0.32]]], // gold → coral
  ["joy", [[1.0, 0.74, 0.2], [1.0, 0.48, 0.32]]],
  ["playful", [[1.0, 0.36, 0.86], [0.4, 0.78, 1.0]]], // magenta → sky
  ["curious", [[0.86, 0.34, 1.0], [0.5, 0.45, 1.0]]], // magenta-violet
  ["thinking", [[0.26, 0.5, 1.0], [0.3, 0.85, 1.0]]], // blue → cyan
  ["focused", [[0.26, 0.5, 1.0], [0.3, 0.85, 1.0]]],
  ["calm", [[0.2, 0.82, 0.74], [0.36, 0.92, 0.5]]], // teal → mint
  ["concerned", [[1.0, 0.62, 0.18], [0.96, 0.36, 0.3]]], // amber → red
  ["sad", [[0.3, 0.42, 0.82], [0.46, 0.52, 0.72]]], // muted indigo
  ["angry", [[1.0, 0.2, 0.22], [1.0, 0.42, 0.16]]], // red → ember
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
