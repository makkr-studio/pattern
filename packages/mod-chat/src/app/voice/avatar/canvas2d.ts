/**
 * Canvas2D particle avatar — the always-available renderer (and the WebGPU
 * fallback). A field of crisp glowing motes that flow through a curl field,
 * spring loosely toward a per-state posture (wide + horizontal when speaking),
 * blend a two-stop color gradient, and stagger into emoji/image morph targets.
 * A soft per-mote halo plus a faint frame fade give the dreamy glow without the
 * whole thing dissolving into haze.
 */

import type { Avatar, AvatarInputs, AvatarState, MorphTarget, RGB } from "./types";
import { DEFAULT_INPUTS } from "./types";

const N = 1800;

/** Spatially incoherent per-particle random (no spiral banding). */
function hash2(a: number, b: number): number {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

interface Eased {
  level: number;
  bass: number;
  mid: number;
  treble: number;
  color: RGB;
  colorB: RGB;
  morphMix: number;
  scale: number;
}

export class Canvas2DAvatar implements Avatar {
  readonly backend = "canvas2d" as const;
  private inputs: AvatarInputs = { ...DEFAULT_INPUTS, bands: { ...DEFAULT_INPUTS.bands } };
  private eased: Eased = {
    level: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    color: [...DEFAULT_INPUTS.color],
    colorB: [...DEFAULT_INPUTS.colorB],
    morphMix: 0,
    scale: 1,
  };
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
      // Projected unit sphere → a glassy orb (rim-dense, soft centre).
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
    let ex = 1;
    let ey = 1;
    switch (state) {
      case "listening":
        sc = 1.02 + lvl * 0.26 + Math.sin(t * 1.3 + a0 * 2) * 0.03;
        spin = 0.03;
        ex = 1 + lvl * 0.1;
        break;
      case "thinking":
        sc = 0.6 + Math.sin(t * 1.6 + s * 8) * 0.03;
        spin = 0.4;
        break;
      case "speaking":
      case "presenting":
        sc = 0.96 + lvl * 0.22 + this.eased.bass * 0.12;
        spin = 0.035;
        ex = 1.3 + lvl * 0.55 + this.eased.bass * 0.2;
        ey = 0.8 - lvl * 0.05;
        break;
      default: // idle
        sc = 1.0 + Math.sin(t * 0.5 + s * 6) * 0.04;
        spin = 0.02;
    }
    const r = rr * 0.72 * sc;
    const a = a0 + spin * t;
    return [Math.cos(a) * r * ex, Math.sin(a) * r * ey];
  }

  /** Divergence-free curl flow (cheap potential, finite-difference curl). */
  private curl(x: number, y: number, t: number): [number, number] {
    const pot = (px: number, py: number) =>
      Math.sin(px * 2.4 + t * 0.3) * Math.cos(py * 2.4 - t * 0.22) +
      0.5 * Math.sin(px * 4.7 - t * 0.2) * Math.cos(py * 4.3 + t * 0.16);
    const e = 0.025;
    const dx = pot(x + e, y) - pot(x - e, y);
    const dy = pot(x, y + e) - pot(x, y - e);
    return [dy / (2 * e), -dx / (2 * e)];
  }

  private step(): void {
    const { state } = this.inputs;
    const e = this.eased;
    const inp = this.inputs;
    e.level += (inp.level - e.level) * 0.2;
    e.bass += (inp.bands.bass - e.bass) * 0.25;
    e.mid += (inp.bands.mid - e.mid) * 0.25;
    e.treble += (inp.bands.treble - e.treble) * 0.25;
    e.color[0] += (inp.color[0] - e.color[0]) * 0.04;
    e.color[1] += (inp.color[1] - e.color[1]) * 0.04;
    e.color[2] += (inp.color[2] - e.color[2]) * 0.04;
    e.colorB[0] += (inp.colorB[0] - e.colorB[0]) * 0.04;
    e.colorB[1] += (inp.colorB[1] - e.colorB[1]) * 0.04;
    e.colorB[2] += (inp.colorB[2] - e.colorB[2]) * 0.04;
    const morphing = this.morph != null;
    e.morphMix += ((morphing ? 1 : 0) - e.morphMix) * 0.06;

    const targetScale = state === "thinking" ? 0.78 : state === "speaking" ? 1.08 : 1;
    e.scale += (targetScale - e.scale) * 0.05;

    this.t += 0.016;
    const t = this.t;
    const mp = this.morph?.positions;
    const mix = e.morphMix;
    const mixing = e.morphMix > 0.5;
    const attract = mixing ? 0.09 : 0.052;
    const drag = mixing ? 0.86 : 0.8;
    const flowAmt = (0.0011 + e.level * 0.0018 + e.treble * 0.0022) * (mixing ? 0.5 : 1);
    const mpCount = mp ? mp.length / 2 : 0;

    for (let i = 0; i < N; i++) {
      const s = this.seed[i] ?? 0;
      const rr = this.rank[i] ?? 0;
      const [bx, by] = this.posture(i, state, t);
      let tx = bx;
      let ty = by;
      if (mp && mix > 0.001 && mpCount > 0) {
        const ph = (s * 7 + rr * 3) % 1;
        const win = Math.max(0, Math.min(1, (mix - ph * 0.55) / 0.45));
        const lm = win * win * (3 - 2 * win);
        const j = i % mpCount;
        const mxp = mp[j * 2] ?? bx;
        const myp = mp[j * 2 + 1] ?? by;
        tx = bx + (mxp - bx) * lm;
        ty = by + (myp - by) * lm;
      }
      const px = this.px[i] ?? 0;
      const py = this.py[i] ?? 0;
      const [fx, fy] = this.curl(px * 1.15, py * 1.15, t);
      const vx = (this.vx[i] ?? 0) * drag + (tx - px) * attract + fx * flowAmt;
      const vy = (this.vy[i] ?? 0) * drag + (ty - py) * attract + fy * flowAmt;
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
    // Light frame fade — short, crisp trails (not a long smear).
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(4, 3, 8, 0.42)";
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = "lighter";
    const cx = W / 2;
    const cy = H / 2;
    const sc = Math.min(W, H) * 0.4 * this.eased.scale;
    const e = this.eased;
    const ca = e.color;
    const cb = e.colorB;
    const mc = this.morph?.colors;
    const mix = e.morphMix;
    const mcCount = mc ? mc.length / 3 : 0;
    const dotR = Math.max(1, Math.min(W, H) * 0.0044);
    const glow = 0.9 + e.level * 0.6;

    const ang = this.t * 0.05;
    const gcos = Math.cos(ang);
    const gsin = Math.sin(ang);
    for (let i = 0; i < N; i++) {
      const nx = this.px[i] ?? 0;
      const ny = this.py[i] ?? 0;
      const x = cx + nx * sc;
      const y = cy + ny * sc;
      const s = this.seed[i] ?? 0;
      const rr = this.rank[i] ?? 0;
      // Per-particle random (hash, NOT a linear seed/radius combo — that draws
      // spiral bands). tw skews most motes dim (mist), a few bright (sparkles).
      const depth = hash2(s, rr);
      const tw = depth * depth;
      const soft = 1 - tw;
      const speed = Math.min(1, (Math.abs(this.vx[i] ?? 0) + Math.abs(this.vy[i] ?? 0)) * 5);
      // Gradient by POSITION (smooth, no bands): project onto a slowly turning axis.
      const gt = Math.max(0, Math.min(1, 0.5 + 0.62 * (nx * gcos + ny * gsin) + (depth - 0.5) * 0.12));
      let r = ca[0] + (cb[0] - ca[0]) * gt;
      let g = ca[1] + (cb[1] - ca[1]) * gt;
      let b = ca[2] + (cb[2] - ca[2]) * gt;
      if (mc && mix > 0.01 && mcCount > 0) {
        const j = i % mcCount;
        const m = mix * 0.92;
        r += ((mc[j * 3] ?? r) - r) * m;
        g += ((mc[j * 3 + 1] ?? g) - g) * m;
        b += ((mc[j * 3 + 2] ?? b) - b) * m;
      }
      const bright = (0.3 + tw + speed * 0.45) * glow;
      const cr = Math.min(255, r * 255 * bright) | 0;
      const cg = Math.min(255, g * 255 * bright) | 0;
      const cbl = Math.min(255, b * 255 * bright) | 0;
      // Sparkles: small + bright core. Mist: wider + very faint (a soft wash).
      const rad = dotR * (0.7 + 1.4 * soft);
      ctx.fillStyle = `rgba(${cr},${cg},${cbl},${(0.05 + 0.03 * soft).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, rad * 3, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = `rgba(${cr},${cg},${cbl},${(0.55 * tw + 0.06).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, 6.2832);
      ctx.fill();
    }
  }
}
