/**
 * Canvas2D particle avatar — the always-available renderer (and the WebGPU
 * fallback). A cloud of additively-blended glowing points ("neon sand/smoke")
 * that springs toward a per-state posture, reacts to audio, eases between
 * emotion colors, and flies into emoji/image morph targets. Motion trails come
 * from fading the frame rather than clearing it.
 */

import type { Avatar, AvatarInputs, AvatarState, MorphTarget, RGB } from "./types";
import { DEFAULT_INPUTS } from "./types";

const N = 1600;

interface Eased {
  level: number;
  bass: number;
  mid: number;
  treble: number;
  color: RGB;
  morphMix: number;
  scale: number;
}

export class Canvas2DAvatar implements Avatar {
  readonly backend = "canvas2d" as const;
  private inputs: AvatarInputs = { ...DEFAULT_INPUTS, bands: { ...DEFAULT_INPUTS.bands } };
  private eased: Eased = { level: 0, bass: 0, mid: 0, treble: 0, color: [...DEFAULT_INPUTS.color], morphMix: 0, scale: 1 };
  private morph: MorphTarget | null = null;

  // Particle state (normalized space, roughly [-1,1]).
  private px = new Float32Array(N);
  private py = new Float32Array(N);
  private vx = new Float32Array(N);
  private vy = new Float32Array(N);
  private seed = new Float32Array(N);
  private rank = new Float32Array(N); // radial rank 0..1

  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private t = 0;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    for (let i = 0; i < N; i++) {
      const seed = Math.random();
      const rank = Math.sqrt(Math.random());
      this.seed[i] = seed;
      this.rank[i] = rank;
      const a = seed * Math.PI * 2;
      const r = 0.5 + 0.2 * rank;
      this.px[i] = Math.cos(a) * r;
      this.py[i] = Math.sin(a) * r;
    }
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  set(p: Partial<AvatarInputs>): void {
    if (p.morph !== undefined) this.morph = p.morph;
    this.inputs = { ...this.inputs, ...p, bands: { ...this.inputs.bands, ...(p.bands ?? {}) } };
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
  }

  /** Per-state posture target for particle i (normalized space). */
  private posture(i: number, state: AvatarState, t: number): [number, number] {
    const s = this.seed[i] ?? 0;
    const rr = this.rank[i] ?? 0;
    const a0 = s * Math.PI * 2;
    const lvl = this.eased.level;
    let r: number;
    let spin: number;
    switch (state) {
      case "listening":
        r = 0.46 + 0.16 * rr + lvl * 0.3 + Math.sin(t * 1.4 + a0 * 3) * 0.03;
        spin = t * 0.09;
        break;
      case "thinking":
        r = 0.32 + 0.08 * rr + Math.sin(t * 2 + s * 8) * 0.02;
        spin = t * 0.7;
        break;
      case "speaking":
        r = 0.44 + 0.18 * rr + lvl * 0.42 + this.eased.bass * 0.28 + Math.sin(t * 3 + a0 * 4) * this.eased.treble * 0.12;
        spin = t * 0.16;
        break;
      default: // idle
        r = 0.48 + 0.18 * rr + Math.sin(t * 0.8 + s * 6) * 0.045;
        spin = t * 0.05;
    }
    const a = a0 + spin;
    return [Math.cos(a) * r, Math.sin(a) * r];
  }

  private step(): void {
    const { state } = this.inputs;
    const e = this.eased;
    const inp = this.inputs;
    // Ease scalar inputs toward targets.
    e.level += (inp.level - e.level) * 0.2;
    e.bass += (inp.bands.bass - e.bass) * 0.25;
    e.mid += (inp.bands.mid - e.mid) * 0.25;
    e.treble += (inp.bands.treble - e.treble) * 0.25;
    e.color[0] += (inp.color[0] - e.color[0]) * 0.04;
    e.color[1] += (inp.color[1] - e.color[1]) * 0.04;
    e.color[2] += (inp.color[2] - e.color[2]) * 0.04;
    const morphing = this.morph != null;
    e.morphMix += ((morphing ? 1 : 0) - e.morphMix) * 0.06;

    const targetScale = state === "thinking" ? 0.78 : state === "speaking" ? 1.08 : 1;
    e.scale += (targetScale - e.scale) * 0.05;

    this.t += 0.016;
    const t = this.t;
    const turb = 0.0009 + e.level * 0.004 + e.treble * 0.003;
    const k = morphing ? 0.09 : 0.05;
    const damp = 0.9;
    const mp = this.morph?.positions;
    const mix = e.morphMix;

    for (let i = 0; i < N; i++) {
      let tx: number;
      let ty: number;
      const [bx, by] = this.posture(i, state, t);
      if (mp && mix > 0.001) {
        const mxp = mp[i * 2] ?? bx;
        const myp = mp[i * 2 + 1] ?? by;
        tx = bx + (mxp - bx) * mix;
        ty = by + (myp - by) * mix;
      } else {
        tx = bx;
        ty = by;
      }
      // Spring + lazy curl drift (smoke).
      const s = this.seed[i] ?? 0;
      const px = this.px[i] ?? 0;
      const py = this.py[i] ?? 0;
      const nx = Math.sin(py * 3 + t * 0.7 + s * 10);
      const ny = Math.cos(px * 3 - t * 0.6 + s * 10);
      const vx = (this.vx[i] ?? 0) * damp + (tx - px) * k + nx * turb;
      const vy = (this.vy[i] ?? 0) * damp + (ty - py) * k + ny * turb;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.px[i] = px + vx;
      this.py[i] = py + vy;
    }
  }

  private loop(): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.w === 0) return;
    this.step();

    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    // Fade (motion trails) instead of clear.
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(8, 7, 9, 0.30)";
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = "lighter";
    const cx = W / 2;
    const cy = H / 2;
    const sc = Math.min(W, H) * 0.4 * this.eased.scale;
    const e = this.eased;
    const baseCol = e.color;
    const mc = this.morph?.colors;
    const mix = e.morphMix;
    const dotR = Math.max(1, Math.min(W, H) * 0.0042);
    const glow = 1 + e.level * 1.2;

    for (let i = 0; i < N; i++) {
      const x = cx + (this.px[i] ?? 0) * sc;
      const y = cy + (this.py[i] ?? 0) * sc;
      const speed = Math.min(1, (Math.abs(this.vx[i] ?? 0) + Math.abs(this.vy[i] ?? 0)) * 7);
      let r = baseCol[0];
      let g = baseCol[1];
      let b = baseCol[2];
      if (mc && mix > 0.01) {
        r += ((mc[i * 3] ?? r) - r) * mix;
        g += ((mc[i * 3 + 1] ?? g) - g) * mix;
        b += ((mc[i * 3 + 2] ?? b) - b) * mix;
      }
      // Per-particle brightness variation keeps it organic.
      const bright = (0.55 + (this.seed[i] ?? 0) * 0.45 + speed * 0.4) * glow;
      const cr = Math.min(255, r * 255 * bright) | 0;
      const cg = Math.min(255, g * 255 * bright) | 0;
      const cb = Math.min(255, b * 255 * bright) | 0;
      // Halo + core for a cheap glow.
      ctx.fillStyle = `rgba(${cr},${cg},${cb},0.05)`;
      ctx.beginPath();
      ctx.arc(x, y, dotR * 3.2, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = `rgba(${cr},${cg},${cb},0.85)`;
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, 6.2832);
      ctx.fill();
    }
  }
}
