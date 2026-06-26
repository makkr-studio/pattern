/** The avatar abstraction — one interface, two renderers (WGSL, Canvas2D). */

export type AvatarState = "idle" | "listening" | "thinking" | "speaking" | "presenting";

export type RGB = [number, number, number];

/** A data-driven morph target: positions in [-1,1]², optional per-point colors. */
export interface MorphTarget {
  /** N×2 positions in normalized [-1,1] space. */
  positions: Float32Array;
  /** N×3 rgb (0..1), or null to use the palette color. */
  colors: Float32Array | null;
  /** A short caption shown with the morph (a tool name, etc.). */
  label?: string | null;
}

export interface AvatarInputs {
  state: AvatarState;
  /** Live audio level 0..1 (mic while listening, TTS while speaking). */
  level: number;
  /** Coarse FFT bands 0..1 for richer reactivity. */
  bands: { bass: number; mid: number; treble: number };
  /** Target palette color (rgb 0..1) — the avatar eases toward it. */
  color: RGB;
  /** When set, particles morph into this shape; cleared → back to the posture. */
  morph: MorphTarget | null;
}

export interface Avatar {
  /** Merge new inputs (the renderer eases toward them). */
  set(p: Partial<AvatarInputs>): void;
  resize(w: number, h: number, dpr: number): void;
  dispose(): void;
  /** Which backend is live (for a small badge). */
  readonly backend: "webgpu" | "canvas2d";
}

export const DEFAULT_INPUTS: AvatarInputs = {
  state: "idle",
  level: 0,
  bands: { bass: 0, mid: 0, treble: 0 },
  color: [0.78, 0.42, 0.26],
  morph: null,
};
