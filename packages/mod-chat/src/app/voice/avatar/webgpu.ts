/// <reference types="@webgpu/types" />
/**
 * WebGPU particle avatar (the showcase renderer). A compute pass eases ~40k
 * particles toward a per-state posture (computed in-shader) blended with an
 * uploaded morph target; a render pass draws them as small CRISP alpha-blended
 * dots straight onto the canvas at native device resolution — a real point cloud,
 * no HDR accumulation, no bloom, no glow. Creation captures WGSL/validation errors
 * and throws, so the factory falls back to Canvas2D on any problem.
 */

import type { Avatar, AvatarInputs, AvatarState, MorphTarget, RGB } from "./types";
import { DEFAULT_INPUTS } from "./types";

const N = 40000;
const U_FLOATS = 24; // 96 bytes — must match struct U below (two gradient stops)
const BG: GPUColor = { r: 0.0196, g: 0.0157, b: 0.0275, a: 1 }; // matches the #050407 overlay

const STATE_ID: Record<AvatarState, number> = { idle: 0, listening: 1, thinking: 2, speaking: 3, presenting: 3 };

const COMPUTE_WGSL = /* wgsl */ `
struct U {
  res: vec2f, time: f32, dt: f32,
  level: f32, bass: f32, mid: f32, treble: f32,
  morphMix: f32, scale: f32, stateId: f32, dotSize: f32,
  count: f32, useMorphColor: f32, prevStateId: f32, stateMix: f32,
  colorA: vec4f,
  colorB: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> dyn: array<vec4f>;
@group(0) @binding(2) var<storage, read> cst: array<vec2f>;
@group(0) @binding(3) var<storage, read> morph: array<vec2f>;

const TAU = 6.2831853;

fn h11(a: f32, b: f32) -> f32 { return fract(sin(a * 12.9898 + b * 78.233) * 43758.5453); }

// Per-particle staggered ramp: each particle crosses its window on its own beat
// (seeded by ph), so a shape forms / a state changes like sand flowing into place
// rather than every point moving at once. Reverses cleanly on the way out.
fn stagger(m: f32, ph: f32) -> f32 {
  let win = clamp((m - ph * 0.55) / 0.45, 0.0, 1.0);
  return win * win * (3.0 - 2.0 * win);
}

// Per-particle drift: a slow elliptical wander around the home spot, phase/speed
// hashed PER PARTICLE (decorrelated from position) so neighbours move out of phase
// and the cloud is always alive without coherent lanes. Grows a little with the voice.
fn drift(s: f32, rr: f32, t: f32, amp: f32) -> vec2f {
  let a1 = fract(s * 37.0 + rr * 101.0);
  let a2 = fract(s * 17.0 + rr * 53.0);
  let w = 0.25 + a1 * 0.6;
  return vec2f(cos(t * w + a1 * TAU), sin(t * w * 0.9 + a2 * TAU)) * amp;
}

// Per-state posture for one stateId (so transitions can blend two of them). idle
// breathes; listening leans out; thinking condenses + spins; speaking spreads into
// a GAUSSIAN BELL across the full width, its height pulsing with the voice.
fn postureFor(s: f32, rr: f32, t: f32, st: f32) -> vec2f {
  let lvl = u.level;
  if (st >= 2.5) {
    let span = 2.0;
    let x = (s - 0.5) * 2.0 * span;
    let sigma = 0.72;
    let amp = 0.26 + lvl * 0.62 + u.bass * 0.22;
    let env = 0.04 + amp * exp(-(x * x) / (2.0 * sigma * sigma));
    let hv = h11(rr, s);
    return vec2f(x, (hv - 0.5) * 2.0 * env);
  }
  let a0 = s * TAU;
  var sc: f32;
  var spin: f32;
  var ex: f32 = 1.0;
  if (st < 0.5) {                 // idle
    sc = 1.0 + sin(t * 0.5 + s * 6.0) * 0.04; spin = 0.006;
  } else if (st < 1.5) {          // listening
    sc = 1.02 + lvl * 0.26 + sin(t * 1.3 + a0 * 2.0) * 0.03; spin = 0.012; ex = 1.0 + lvl * 0.10;
  } else {                        // thinking
    sc = 0.60 + sin(t * 1.6 + s * 8.0) * 0.03; spin = 0.40;
  }
  let r = rr * 0.72 * sc;
  let a = a0 + spin * t;
  return vec2f(cos(a) * r * ex, sin(a) * r);
}

@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u32(u.count)) { return; }
  let t = u.time;
  let pos = dyn[i].xy;
  let s = cst[i].x;
  let rr = cst[i].y;
  let ph = fract(s * 7.0 + rr * 3.0);

  // Staggered state transition: blend the previous posture into the current one.
  let lmState = stagger(u.stateMix, ph);
  let basePosture = mix(postureFor(s, rr, t, u.prevStateId), postureFor(s, rr, t, u.stateId), lmState);

  let amp = 0.020 + u.level * 0.05 + u.treble * 0.04;
  let dr = drift(s, rr, t, amp);
  let base = basePosture + dr;

  var tgt = base;
  if (u.morphMix > 0.001) {
    let lmM = stagger(u.morphMix, ph);
    tgt = mix(base, morph[i] + dr * 0.35, lmM);
  }

  // Exponential easing toward the (moving) target: smooth, monotonic, NO bounce.
  // The stored "velocity" is just this frame's delta, for the render's speed term.
  let ease = select(0.055, 0.09, u.morphMix > 0.5);
  let delta = (tgt - pos) * ease;
  dyn[i] = vec4f(pos + delta, delta);
}
`;

const RENDER_WGSL = /* wgsl */ `
struct U {
  res: vec2f, time: f32, dt: f32,
  level: f32, bass: f32, mid: f32, treble: f32,
  morphMix: f32, scale: f32, stateId: f32, dotSize: f32,
  count: f32, useMorphColor: f32, prevStateId: f32, stateMix: f32,
  colorA: vec4f,
  colorB: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> dyn: array<vec4f>;
@group(0) @binding(2) var<storage, read> cst: array<vec2f>;
@group(0) @binding(3) var<storage, read> mcol: array<vec4f>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) alpha: f32,
};

// Spatially incoherent per-particle random (NOT a linear seed/radius combo — that
// draws spiral iso-bands). The sin argument stays small (<~100), so no Metal NaN.
fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}

// Rotate an RGB colour around the grey axis (a cheap hue shift) — used for a tiny
// always-on ambient drift so the gradient is gently alive.
fn hueRotate(c: vec3f, a: f32) -> vec3f {
  let k = vec3f(0.57735027);
  let ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let c = corners[vi];
  let d = dyn[ii];
  let p = d.xy;
  let vel = d.zw;
  let s = cst[ii].x;
  let rr = cst[ii].y;
  let rnd = hash(vec2f(s, rr));
  // Aspect-correct fit so circles stay circular.
  let asp = vec2f(min(1.0, u.res.y / u.res.x), min(1.0, u.res.x / u.res.y));
  // Small crisp dots; a touch of per-particle size variety for an organic cloud.
  let size = u.dotSize * (0.8 + 0.5 * rnd);
  let world = p * u.scale + c * size;
  let clip = world * 0.82 * asp;
  var vo: VSOut;
  vo.pos = vec4f(clip, 0.0, 1.0);
  vo.uv = c;
  // GRADIENT by POSITION (smooth, no bands): project onto a slowly turning axis.
  let ga = u.time * 0.05;
  let gdir = vec2f(cos(ga), sin(ga));
  let gt = clamp(0.5 + 0.62 * dot(p, gdir) + (rnd - 0.5) * 0.12, 0.0, 1.0);
  var col = mix(u.colorA.xyz, u.colorB.xyz, gt);
  // Subtle always-on ambient hue drift (a few degrees, non-repeating) so even a
  // resting cloud feels alive. Not applied to a morph's own pixels below.
  col = hueRotate(col, sin(u.time * 0.06) * 0.05 + sin(u.time * 0.017) * 0.05);
  if (u.useMorphColor > 0.5 && u.morphMix > 0.01) {
    // A morph's own colours (emoji / image pixels) take over as it assembles.
    col = mix(col, mcol[ii].xyz, u.morphMix * 0.96);
  }
  let speed = clamp((abs(vel.x) + abs(vel.y)) * 5.0, 0.0, 1.0);
  vo.color = col * (0.82 + 0.3 * rnd + speed * 0.25);
  vo.alpha = 0.72 + 0.28 * rnd;
  return vo;
}

@fragment
fn fs(frag: VSOut) -> @location(0) vec4f {
  // A crisp round dot with a 1-px antialiased rim. Alpha-blended over the dark
  // background — discrete points, no additive glow.
  let r = length(frag.uv);
  let a = (1.0 - smoothstep(0.62, 1.0, r)) * frag.alpha;
  if (a <= 0.003) { discard; }
  return vec4f(frag.color, a);
}
`;

export async function createWebGPUAvatar(canvas: HTMLCanvasElement): Promise<Avatar> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) throw new Error("WebGPU unavailable");
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error("no GPU adapter");
  const device = await adapter.requestDevice();
  const format = gpu.getPreferredCanvasFormat();

  device.pushErrorScope("validation");
  const computeModule = device.createShaderModule({ code: COMPUTE_WGSL });
  const renderModule = device.createShaderModule({ code: RENDER_WGSL });

  // Buffers
  const uniformBuf = device.createBuffer({ size: U_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const dynBuf = device.createBuffer({ size: N * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const cstBuf = device.createBuffer({ size: N * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const morphBuf = device.createBuffer({ size: N * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const mcolBuf = device.createBuffer({ size: N * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

  // Seed initial particle + constant data.
  const dyn0 = new Float32Array(N * 4);
  const cst0 = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const seed = Math.random();
    // Projected unit sphere: rim-dense, soft (never empty) centre → a glassy orb.
    const ct = 1 - 2 * Math.random();
    const rank = Math.sqrt(Math.max(0, 1 - ct * ct));
    cst0[i * 2] = seed;
    cst0[i * 2 + 1] = rank;
    const a = seed * Math.PI * 2;
    const r = rank * 0.72;
    dyn0[i * 4] = Math.cos(a) * r;
    dyn0[i * 4 + 1] = Math.sin(a) * r;
  }
  device.queue.writeBuffer(dynBuf, 0, dyn0);
  device.queue.writeBuffer(cstBuf, 0, cst0);

  const computePipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: computeModule, entryPoint: "cs" },
  });
  const renderPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: renderModule, entryPoint: "vs" },
    fragment: {
      module: renderModule,
      entryPoint: "fs",
      targets: [
        {
          format,
          // Straight (non-premultiplied) alpha over the background — crisp dots.
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  });

  const err = await device.popErrorScope();
  if (err) {
    device.destroy?.();
    throw new Error(`WGSL/pipeline: ${err.message}`);
  }

  // Acquire the canvas's WebGPU context ONLY now that the shaders/pipelines are
  // known good. A canvas can hold a single context type, so touching it before
  // validation would taint it and break the Canvas2D fallback when WGSL fails.
  const context = canvas.getContext("webgpu");
  if (!context) {
    device.destroy?.();
    throw new Error("no webgpu context");
  }
  context.configure({ device, format, alphaMode: "opaque" });

  const computeBind = device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: dynBuf } },
      { binding: 2, resource: { buffer: cstBuf } },
      { binding: 3, resource: { buffer: morphBuf } },
    ],
  });
  const renderBind = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: dynBuf } },
      { binding: 2, resource: { buffer: cstBuf } },
      { binding: 3, resource: { buffer: mcolBuf } },
    ],
  });

  return new WebGPUAvatar(device, context, {
    computePipeline,
    renderPipeline,
    computeBind,
    renderBind,
    uniformBuf,
    morphBuf,
    mcolBuf,
  });
}

interface GpuRes {
  computePipeline: GPUComputePipeline;
  renderPipeline: GPURenderPipeline;
  computeBind: GPUBindGroup;
  renderBind: GPUBindGroup;
  uniformBuf: GPUBuffer;
  morphBuf: GPUBuffer;
  mcolBuf: GPUBuffer;
}

class WebGPUAvatar implements Avatar {
  readonly backend = "webgpu" as const;
  private inputs: AvatarInputs = { ...DEFAULT_INPUTS, bands: { ...DEFAULT_INPUTS.bands } };
  private eased = {
    level: 0, bass: 0, mid: 0, treble: 0,
    color: [...DEFAULT_INPUTS.color] as RGB,
    colorB: [...DEFAULT_INPUTS.colorB] as RGB,
    morphMix: 0, scale: 1,
  };
  private uni = new Float32Array(U_FLOATS);
  private morph: MorphTarget | null = null;
  private lastMorph: MorphTarget | null = null;
  private useMorphColor = 0;
  // Staggered state-transition tracking.
  private curState: AvatarState = "idle";
  private prevState: AvatarState = "idle";
  private stateMix = 1;
  private raf = 0;
  private t = 0;
  private w = 1;
  private h = 1;
  private sized = false;
  private disposed = false;

  constructor(
    private device: GPUDevice,
    private context: GPUCanvasContext,
    private res: GpuRes,
  ) {
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  set(p: Partial<AvatarInputs>): void {
    if (p.morph !== undefined) this.morph = p.morph;
    this.inputs = { ...this.inputs, ...p, bands: { ...this.inputs.bands, ...(p.bands ?? {}) } };
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = Math.max(1, Math.floor(w * dpr));
    this.h = Math.max(1, Math.floor(h * dpr));
    (this.context.canvas as HTMLCanvasElement).width = this.w;
    (this.context.canvas as HTMLCanvasElement).height = this.h;
    this.sized = true;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.device.destroy?.();
  }

  /** Expand a morph target's positions/colors to exactly N and upload. */
  private uploadMorph(m: MorphTarget): void {
    const pos = new Float32Array(N * 2);
    const count = m.positions.length / 2;
    for (let i = 0; i < N; i++) {
      const j = count > 0 ? i % count : 0;
      pos[i * 2] = m.positions[j * 2] ?? 0;
      pos[i * 2 + 1] = m.positions[j * 2 + 1] ?? 0;
    }
    this.device.queue.writeBuffer(this.res.morphBuf, 0, pos);
    if (m.colors) {
      const col = new Float32Array(N * 4);
      const cc = m.colors.length / 3;
      for (let i = 0; i < N; i++) {
        const j = cc > 0 ? i % cc : 0;
        col[i * 4] = m.colors[j * 3] ?? 1;
        col[i * 4 + 1] = m.colors[j * 3 + 1] ?? 1;
        col[i * 4 + 2] = m.colors[j * 3 + 2] ?? 1;
        col[i * 4 + 3] = 1;
      }
      this.device.queue.writeBuffer(this.res.mcolBuf, 0, col);
      this.useMorphColor = 1;
    } else {
      this.useMorphColor = 0;
    }
  }

  private loop(): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.sized) return;

    if (this.morph !== this.lastMorph) {
      this.lastMorph = this.morph;
      if (this.morph) this.uploadMorph(this.morph);
      else this.useMorphColor = 0;
    }

    // Staggered state transition: snapshot the previous state on a change.
    if (this.inputs.state !== this.curState) {
      this.prevState = this.curState;
      this.curState = this.inputs.state;
      this.stateMix = 0;
    }
    this.stateMix += (1 - this.stateMix) * 0.028;

    const e = this.eased;
    const inp = this.inputs;
    e.level += (inp.level - e.level) * 0.2;
    e.bass += (inp.bands.bass - e.bass) * 0.25;
    e.mid += (inp.bands.mid - e.mid) * 0.25;
    e.treble += (inp.bands.treble - e.treble) * 0.25;
    // Slower colour easing → a smoother hue transition.
    e.color[0] += (inp.color[0] - e.color[0]) * 0.02;
    e.color[1] += (inp.color[1] - e.color[1]) * 0.02;
    e.color[2] += (inp.color[2] - e.color[2]) * 0.02;
    e.colorB[0] += (inp.colorB[0] - e.colorB[0]) * 0.02;
    e.colorB[1] += (inp.colorB[1] - e.colorB[1]) * 0.02;
    e.colorB[2] += (inp.colorB[2] - e.colorB[2]) * 0.02;
    e.morphMix += ((this.morph ? 1 : 0) - e.morphMix) * 0.035;
    const targetScale = this.curState === "thinking" ? 0.78 : this.curState === "speaking" ? 1.08 : 1;
    e.scale += (targetScale - e.scale) * 0.05;
    this.t += 0.016;

    const u = this.uni;
    u[0] = this.w;
    u[1] = this.h;
    u[2] = this.t;
    u[3] = 0.016;
    u[4] = e.level;
    u[5] = e.bass;
    u[6] = e.mid;
    u[7] = e.treble;
    u[8] = e.morphMix;
    u[9] = e.scale;
    u[10] = STATE_ID[this.curState];
    // Small crisp dot; finer still while presenting a picture (more, smaller dots).
    u[11] = this.curState === "presenting" ? 0.0030 : 0.0042;
    u[12] = N;
    u[13] = this.useMorphColor;
    u[14] = STATE_ID[this.prevState];
    u[15] = this.stateMix;
    u[16] = e.color[0];
    u[17] = e.color[1];
    u[18] = e.color[2];
    u[19] = 1;
    u[20] = e.colorB[0];
    u[21] = e.colorB[1];
    u[22] = e.colorB[2];
    u[23] = 1;
    this.device.queue.writeBuffer(this.res.uniformBuf, 0, u);

    const enc = this.device.createCommandEncoder();
    const cp = enc.beginComputePass();
    cp.setPipeline(this.res.computePipeline);
    cp.setBindGroup(0, this.res.computeBind);
    cp.dispatchWorkgroups(Math.ceil(N / 64));
    cp.end();

    // One pass: clear to the dark background, then draw the crisp dots over it.
    const rp = enc.beginRenderPass({
      colorAttachments: [{ view: this.context.getCurrentTexture().createView(), clearValue: BG, loadOp: "clear", storeOp: "store" }],
    });
    rp.setPipeline(this.res.renderPipeline);
    rp.setBindGroup(0, this.res.renderBind);
    rp.draw(6, N);
    rp.end();

    this.device.queue.submit([enc.finish()]);
  }
}
