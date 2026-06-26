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

/** Per-particle staggered ramp (smoothstep over a seeded window). */
function stagger(m: number, ph: number): number {
  const win = Math.max(0, Math.min(1, (m - ph * 0.55) / 0.45));
  return win * win * (3 - 2 * win);
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
  // Staggered state-transition tracking.
  private curState: AvatarState = "idle";
  private prevState: AvatarState = "idle";
  private stateMix = 1;

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

  /** Per-state posture target for one state (so transitions can blend two). */
  private postureFor(s: number, rr: number, t: number, state: AvatarState): [number, number] {
    const lvl = this.eased.level;
    if (state === "speaking" || state === "presenting") {
      // Gaussian bell: x fills left→right; the vertical band tapers from a tall
      // centre to thin edges, the whole envelope rising with the voice.
      const span = 2.0;
      const x = (s - 0.5) * 2 * span;
      const sigma = 0.72;
      const amp = 0.26 + lvl * 0.62 + this.eased.bass * 0.22;
      const env = 0.04 + amp * Math.exp(-(x * x) / (2 * sigma * sigma));
      const hv = hash2(rr, s);
      return [x, (hv - 0.5) * 2 * env];
    }
    const a0 = s * Math.PI * 2;
    let sc: number;
    let spin: number;
    let ex = 1;
    if (state === "listening") {
      sc = 1.02 + lvl * 0.26 + Math.sin(t * 1.3 + a0 * 2) * 0.03;
      spin = 0.012;
      ex = 1 + lvl * 0.1;
    } else if (state === "thinking") {
      sc = 0.6 + Math.sin(t * 1.6 + s * 8) * 0.03;
      spin = 0.4;
    } else {
      sc = 1.0 + Math.sin(t * 0.5 + s * 6) * 0.04;
      spin = 0.006;
    }
    const r = rr * 0.72 * sc;
    const a = a0 + spin * t;
    return [Math.cos(a) * r * ex, Math.sin(a) * r];
  }

  /** Per-particle decorrelated drift (no coherent lanes), grows with the voice. */
  private drift(s: number, rr: number, t: number, amp: number): [number, number] {
    const a1 = (s * 37 + rr * 101) % 1;
    const a2 = (s * 17 + rr * 53) % 1;
    const w = 0.5 + a1 * 1.2;
    const TAU = 6.2831853;
    return [Math.cos(t * w + a1 * TAU) * amp, Math.sin(t * w * 0.92 + a2 * TAU) * amp];
  }

  private step(): void {
    const e = this.eased;
    const inp = this.inputs;
    // Staggered state transition: snapshot the previous state on a change.
    if (inp.state !== this.curState) {
      this.prevState = this.curState;
      this.curState = inp.state;
      this.stateMix = 0;
    }
    this.stateMix += (1 - this.stateMix) * 0.028;

    e.level += (inp.level - e.level) * 0.2;
    e.bass += (inp.bands.bass - e.bass) * 0.25;
    e.mid += (inp.bands.mid - e.mid) * 0.25;
    e.treble += (inp.bands.treble - e.treble) * 0.25;
    // Smooth but noticeable colour easing for the hue transitions.
    e.color[0] += (inp.color[0] - e.color[0]) * 0.03;
    e.color[1] += (inp.color[1] - e.color[1]) * 0.03;
    e.color[2] += (inp.color[2] - e.color[2]) * 0.03;
    e.colorB[0] += (inp.colorB[0] - e.colorB[0]) * 0.03;
    e.colorB[1] += (inp.colorB[1] - e.colorB[1]) * 0.03;
    e.colorB[2] += (inp.colorB[2] - e.colorB[2]) * 0.03;
    const morphing = this.morph != null;
    e.morphMix += ((morphing ? 1 : 0) - e.morphMix) * 0.035;

    const targetScale = this.curState === "thinking" ? 0.78 : this.curState === "speaking" ? 1.08 : 1;
    e.scale += (targetScale - e.scale) * 0.05;

    this.t += 0.016;
    const t = this.t;
    const mp = this.morph?.positions;
    const mix = e.morphMix;
    const sm = this.stateMix;
    const ease = e.morphMix > 0.5 ? 0.09 : 0.055;
    const mpCount = mp ? mp.length / 2 : 0;

    for (let i = 0; i < N; i++) {
      const s = this.seed[i] ?? 0;
      const rr = this.rank[i] ?? 0;
      const ph = (s * 7 + rr * 3) % 1;
      // Staggered blend of previous → current posture.
      const lmS = stagger(sm, ph);
      const [pbx, pby] = this.postureFor(s, rr, t, this.prevState);
      const [cbx, cby] = this.postureFor(s, rr, t, this.curState);
      const amp = 0.016 + e.level * 0.06 + e.treble * 0.05;
      const [dx, dy] = this.drift(s, rr, t, amp);
      let tx = pbx + (cbx - pbx) * lmS + dx;
      let ty = pby + (cby - pby) * lmS + dy;
      if (mp && mix > 0.001 && mpCount > 0) {
        const lmM = stagger(mix, ph);
        const j = i % mpCount;
        const mxp = (mp[j * 2] ?? tx) + dx * 0.35;
        const myp = (mp[j * 2 + 1] ?? ty) + dy * 0.35;
        tx = tx + (mxp - tx) * lmM;
        ty = ty + (myp - ty) * lmM;
      }
      const px = this.px[i] ?? 0;
      const py = this.py[i] ?? 0;
      // Exponential easing (no bounce); store the delta as the speed term.
      const vx = (tx - px) * ease;
      const vy = (ty - py) * ease;
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
    // Clear to the dark background each frame (no trails) — a crisp point cloud.
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#050407";
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H / 2;
    const sc = Math.min(W, H) * 0.4 * this.eased.scale;
    const e = this.eased;
    const ca = e.color;
    const cb = e.colorB;
    const mc = this.morph?.colors;
    const mix = e.morphMix;
    const mcCount = mc ? mc.length / 3 : 0;
    const dotR = Math.max(0.5, Math.min(W, H) * (this.curState === "presenting" ? 0.00086 : 0.00072));

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
      const rnd = hash2(s, rr);
      const speed = Math.min(1, (Math.abs(this.vx[i] ?? 0) + Math.abs(this.vy[i] ?? 0)) * 5);
      // Gradient by POSITION (smooth, no bands): project onto a slowly turning axis.
      const gt = Math.max(0, Math.min(1, 0.5 + 0.62 * (nx * gcos + ny * gsin) + (rnd - 0.5) * 0.12));
      let r = ca[0] + (cb[0] - ca[0]) * gt;
      let g = ca[1] + (cb[1] - ca[1]) * gt;
      let b = ca[2] + (cb[2] - ca[2]) * gt;
      if (mc && mix > 0.01 && mcCount > 0) {
        const j = i % mcCount;
        const m = mix * 0.96;
        r += ((mc[j * 3] ?? r) - r) * m;
        g += ((mc[j * 3 + 1] ?? g) - g) * m;
        b += ((mc[j * 3 + 2] ?? b) - b) * m;
      }
      const bright = 0.82 + 0.3 * rnd + speed * 0.25;
      const cr = Math.min(255, r * 255 * bright) | 0;
      const cg = Math.min(255, g * 255 * bright) | 0;
      const cbl = Math.min(255, b * 255 * bright) | 0;
      const rad = dotR * (0.8 + 0.5 * rnd);
      // A small crisp dot.
      ctx.fillStyle = `rgba(${cr},${cg},${cbl},${(0.72 + 0.28 * rnd).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, 6.2832);
      ctx.fill();
    }
  }
}
