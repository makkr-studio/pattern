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
      // Projected unit sphere → a glassy orb (rim-dense, soft centre), matching
      // the WebGPU renderer.
      const ct = 1 - 2 * Math.random();
      const rank = Math.sqrt(Math.max(0, 1 - ct * ct));
      this.seed[i] = seed;
      this.rank[i] = rank;
      const a = seed * Math.PI * 2;
      const r = rank * 0.72;
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
    let sc: number;
    let spin: number;
    switch (state) {
      case "listening":
        sc = 1.06 + lvl * 0.55 + Math.sin(t * 1.3 + a0 * 2) * 0.03;
        spin = 0.04;
        break;
      case "thinking":
        sc = 0.6 + Math.sin(t * 1.6 + s * 8) * 0.03;
        spin = 0.5;
        break;
      case "speaking":
        sc = 1.04 + lvl * 0.7 + this.eased.bass * 0.3 + Math.sin(t * 2.4 + a0 * 3) * this.eased.treble * 0.1;
        spin = 0.05;
        break;
      default: // idle
        sc = 1.0 + Math.sin(t * 0.5 + s * 6) * 0.04;
        spin = 0.022;
    }
    const r = rr * 0.72 * sc;
    const a = a0 + spin * t;
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
    // Fade (motion trails) instead of clear — long, soft trails for smoke.
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(4, 3, 6, 0.22)";
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = "lighter";
    const cx = W / 2;
    const cy = H / 2;
    const sc = Math.min(W, H) * 0.4 * this.eased.scale;
    const e = this.eased;
    const baseCol = e.color;
    const mc = this.morph?.colors;
    const mix = e.morphMix;
    const dotR = Math.max(1.5, Math.min(W, H) * 0.0075);
    const glow = 0.9 + e.level * 0.5;

    for (let i = 0; i < N; i++) {
      const x = cx + (this.px[i] ?? 0) * sc;
      const y = cy + (this.py[i] ?? 0) * sc;
      const seed = this.seed[i] ?? 0;
      const speed = Math.min(1, (Math.abs(this.vx[i] ?? 0) + Math.abs(this.vy[i] ?? 0)) * 6);
      const depth = 0.55 + 0.45 * Math.sin(seed * 12.9898 + 1.7);
      let r = baseCol[0];
      let g = baseCol[1];
      let b = baseCol[2];
      if (mc && mix > 0.01) {
        r += ((mc[i * 3] ?? r) - r) * mix;
        g += ((mc[i * 3 + 1] ?? g) - g) * mix;
        b += ((mc[i * 3 + 2] ?? b) - b) * mix;
      }
      // Gentle, color-preserving brightness; the glow comes from accumulation.
      const bright = (0.35 + depth * 0.5 + speed * 0.25) * glow;
      const cr = Math.min(255, r * 255 * bright) | 0;
      const cg = Math.min(255, g * 255 * bright) | 0;
      const cb = Math.min(255, b * 255 * bright) | 0;
      const rad = dotR * (0.6 + 1.1 * depth);
      // A wide soft halo + a faint core, both low-alpha → smoke, not hard dots.
      ctx.fillStyle = `rgba(${cr},${cg},${cb},0.045)`;
      ctx.beginPath();
      ctx.arc(x, y, rad * 2.6, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = `rgba(${cr},${cg},${cb},0.13)`;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, 6.2832);
      ctx.fill();
    }
  }
}
