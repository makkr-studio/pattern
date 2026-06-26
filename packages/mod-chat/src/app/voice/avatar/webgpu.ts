/// <reference types="@webgpu/types" />
/**
 * WebGPU particle avatar (the showcase renderer). A compute pass springs ~40k
 * particles toward a per-state posture (computed in-shader) blended with an
 * uploaded morph target, with audio-driven curl turbulence; a render pass draws
 * them as additive glowing point sprites. Creation captures WGSL/validation
 * errors and throws, so the factory falls back to Canvas2D on any problem.
 */

import type { Avatar, AvatarInputs, AvatarState, MorphTarget, RGB } from "./types";
import { DEFAULT_INPUTS } from "./types";

const N = 40000;
const U_FLOATS = 24; // 96 bytes — must match struct U below (two gradient stops)
const HDR_FORMAT: GPUTextureFormat = "rgba16float"; // float accumulation target for the tone-map

const STATE_ID: Record<AvatarState, number> = { idle: 0, listening: 1, thinking: 2, speaking: 3, presenting: 3 };

const COMPUTE_WGSL = /* wgsl */ `
struct U {
  res: vec2f, time: f32, dt: f32,
  level: f32, bass: f32, mid: f32, treble: f32,
  morphMix: f32, scale: f32, stateId: f32, dotSize: f32,
  count: f32, useMorphColor: f32, pad0: f32, pad1: f32,
  colorA: vec4f,
  colorB: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> dyn: array<vec4f>;
@group(0) @binding(2) var<storage, read> cst: array<vec2f>;
@group(0) @binding(3) var<storage, read> morph: array<vec2f>;

const TAU = 6.2831853;

// Per-state posture. The orb breathes when idle, leans out when listening,
// condenses and spins fast when thinking, and STRETCHES WIDE + blooms with the
// voice when speaking (ex/ey are the horizontal/vertical aspect of the form).
fn posture(i: u32, t: f32) -> vec2f {
  let s = cst[i].x;
  let rr = cst[i].y;
  let a0 = s * TAU;
  let lvl = u.level;
  var sc: f32;
  var spin: f32;
  var ex: f32 = 1.0;
  var ey: f32 = 1.0;
  let st = u.stateId;
  if (st < 0.5) {                 // idle
    sc = 1.0 + sin(t * 0.5 + s * 6.0) * 0.04; spin = 0.006;
  } else if (st < 1.5) {          // listening — gentle outward lean to the mic
    sc = 1.02 + lvl * 0.26 + sin(t * 1.3 + a0 * 2.0) * 0.03; spin = 0.012;
    ex = 1.0 + lvl * 0.10;
  } else if (st < 2.5) {          // thinking — tight, fast-spinning core
    sc = 0.60 + sin(t * 1.6 + s * 8.0) * 0.03; spin = 0.40;
  } else {                        // speaking / presenting — wide horizontal bloom
    sc = 0.96 + lvl * 0.22 + u.bass * 0.12;
    spin = 0.014;
    ex = 1.30 + lvl * 0.55 + u.bass * 0.20;
    ey = 0.80 - lvl * 0.05;
  }
  let r = rr * 0.72 * sc;
  let a = a0 + spin * t;
  return vec2f(cos(a) * r * ex, sin(a) * r * ey);
}

// Per-particle drift: a small elliptical orbit around the home spot, with a
// phase/speed hashed PER PARTICLE (decorrelated from spatial position). Neighbours
// move out of phase, so the cloud stays full and just shimmers — no coherent
// streamlines carving black lanes. Grows with the voice for a living bloom.
fn drift(s: f32, rr: f32, t: f32, amp: f32) -> vec2f {
  let h1 = fract(s * 37.0 + rr * 101.0);
  let h2 = fract(s * 17.0 + rr * 53.0);
  let w = 0.5 + h1 * 1.2;
  return vec2f(cos(t * w + h1 * TAU), sin(t * w * 0.92 + h2 * TAU)) * amp;
}

@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u32(u.count)) { return; }
  let t = u.time;
  let d = dyn[i];
  let pos = d.xy;
  var vel = d.zw;
  let s = cst[i].x;
  let rr = cst[i].y;

  let amp = 0.016 + u.level * 0.06 + u.treble * 0.05;
  let dr = drift(s, rr, t, amp);
  let base = posture(i, t) + dr;
  var tgt = base;
  if (u.morphMix > 0.001) {
    // Per-particle staggered assembly: each particle crosses into the shape on
    // its own seeded beat, so the morph flows in like sand rather than every
    // point snapping at once. A little drift rides along so the held shape still
    // breathes (never fully fixed). The window reverses cleanly on dissolve.
    let ph = fract(s * 7.0 + rr * 3.0);
    let win = clamp((u.morphMix - ph * 0.55) / 0.45, 0.0, 1.0);
    let lm = win * win * (3.0 - 2.0 * win); // smoothstep
    let m = morph[i] + dr * 0.35;
    tgt = mix(base, m, lm);
  }

  // Hard-damped pull to the (drifting) target: tracks closely so the fill stays
  // even, with no elastic overshoot. Tighter still while morphing so shapes read.
  let attract = select(0.11, 0.17, u.morphMix > 0.5);
  vel = vel * 0.78 + (tgt - pos) * attract;
  dyn[i] = vec4f(pos + vel, vel);
}
`;

const RENDER_WGSL = /* wgsl */ `
struct U {
  res: vec2f, time: f32, dt: f32,
  level: f32, bass: f32, mid: f32, treble: f32,
  morphMix: f32, scale: f32, stateId: f32, dotSize: f32,
  count: f32, useMorphColor: f32, pad0: f32, pad1: f32,
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
  @location(2) bright: f32,
  @location(3) soft: f32, // 0 = crisp sparkle, 1 = soft mist
};

// Spatially incoherent per-particle random (NOT a linear combo of seed/radius —
// that would draw spiral iso-bands). The sin argument stays small (<~100), so no
// Metal NaN.
fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
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
  // Per-particle random (no spiral). tw skews most particles dim → a soft mist,
  // with a sparse few bright → crisp sparkles. soft drives the sprite falloff:
  // mist motes are wide + faint, sparkles are tight + bright. One system, two reads.
  let depth = hash(vec2f(s, rr));
  let tw = depth * depth;
  let soft = 1.0 - tw;
  // Aspect-correct fit: scale the longer axis down so circles stay circular.
  let asp = vec2f(min(1.0, u.res.y / u.res.x), min(1.0, u.res.x / u.res.y));
  // Mist motes a touch larger (to fill smoothly), sparkles small + crisp.
  let size = u.dotSize * (0.55 + 0.95 * soft);
  let world = p * u.scale + c * size;
  let clip = world * 0.82 * asp;
  var vo: VSOut;
  vo.pos = vec4f(clip, 0.0, 1.0);
  vo.uv = c;
  let speed = clamp((abs(vel.x) + abs(vel.y)) * 5.0, 0.0, 1.0);
  // GRADIENT by POSITION (smooth, no bands): project the particle onto a slowly
  // rotating axis so the whole cloud sweeps colorA→colorB and the gradient itself
  // turns gently over time. A hair of per-particle jitter softens the seam.
  let ga = u.time * 0.05;
  let gdir = vec2f(cos(ga), sin(ga));
  let gt = clamp(0.5 + 0.62 * dot(p, gdir) + (depth - 0.5) * 0.12, 0.0, 1.0);
  var col = mix(u.colorA.xyz, u.colorB.xyz, gt);
  if (u.useMorphColor > 0.5 && u.morphMix > 0.01) {
    col = mix(col, mcol[ii].xyz, u.morphMix * 0.92);
  }
  vo.color = col;
  vo.soft = soft;
  // Dim mist body + bright sparse sparkles (tw skews most low), faster motes flare.
  vo.bright = (0.30 + 1.0 * tw + speed * 0.45) * (0.9 + u.level * 0.6);
  return vo;
}

@fragment
fn fs(frag: VSOut) -> @location(0) vec4f {
  // One sprite, two reads: sparkles (soft≈0) get a tight crisp core; mist motes
  // (soft≈1) get a wide soft falloff at low alpha. Many faint mist motes overlap
  // into a smooth glowing body; the sparkles are the crisp points of light.
  let r2 = dot(frag.uv, frag.uv);
  if (r2 > 1.0) { discard; }
  let k = mix(9.0, 2.4, frag.soft);
  let g = exp(-r2 * k);
  let alpha = g * mix(0.18, 0.05, frag.soft);
  return vec4f(frag.color * frag.bright * alpha, alpha);
}
`;

// Fullscreen-triangle vertex stub shared by the blur + composite passes.
const FS_VS = /* wgsl */ `
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let xy = p[vi];
  var o: VOut;
  o.pos = vec4f(xy, 0.0, 1.0);
  o.uv = vec2f(xy.x, -xy.y) * 0.5 + 0.5;
  return o;
}
`;

// Separable 9-tap Gaussian. Run twice (horizontal, then vertical) at quarter res
// to grow each crisp mote into a wide, soft halo — the "dreamy glow" that the
// sharp particles themselves deliberately lack. `step` is the per-tap UV offset.
const BLUR_WGSL = /* wgsl */ `
struct B { step: vec2f, pad: vec2f };
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> b: B;
${FS_VS}
@fragment
fn fs(i: VOut) -> @location(0) vec4f {
  let s = b.step;
  var c = textureSample(tex, samp, i.uv).rgb * 0.227027;
  c += (textureSample(tex, samp, i.uv + s * 1.0).rgb + textureSample(tex, samp, i.uv - s * 1.0).rgb) * 0.1945946;
  c += (textureSample(tex, samp, i.uv + s * 2.0).rgb + textureSample(tex, samp, i.uv - s * 2.0).rgb) * 0.1216216;
  c += (textureSample(tex, samp, i.uv + s * 3.0).rgb + textureSample(tex, samp, i.uv - s * 3.0).rgb) * 0.0540540;
  c += (textureSample(tex, samp, i.uv + s * 4.0).rgb + textureSample(tex, samp, i.uv - s * 4.0).rgb) * 0.0162162;
  return vec4f(c, 1.0);
}
`;

// Composite: crisp scene + soft bloom, then tone-map the LUMINANCE with Reinhard
// (chroma preserved, so the bright core stays a saturated neon glow rather than
// blowing out to white), over a subtle neon-dark floor.
const COMPOSITE_WGSL = /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var bloomTex: texture_2d<f32>;
${FS_VS}
@fragment
fn fs(i: VOut) -> @location(0) vec4f {
  let scene = textureSample(sceneTex, samp, i.uv).rgb;
  let bloom = textureSample(bloomTex, samp, i.uv).rgb;
  let hdr = scene + bloom * 1.35; // bloom strength
  let l = max(dot(hdr, vec3f(0.2126, 0.7152, 0.0722)), 0.0001);
  let lt = (l * 1.1) / (1.0 + l * 1.1);
  let mapped = min(hdr * (lt / l), vec3f(1.0));
  let bg = vec3f(0.012, 0.011, 0.018); // neon-dark floor
  return vec4f(mapped + bg, 1.0);
}
`;

// Bloom blur spread (taps are this many quarter-res texels apart) — wider = softer.
const BLOOM_SPREAD = 1.7;

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
    // Projected unit sphere: a point uniform on a sphere, flattened to 2D. The
    // radial density is highest at the rim and soft (but never empty) toward the
    // centre → a glassy neon orb, no hot core, no hollow donut.
    const ct = 1 - 2 * Math.random(); // cos(theta), uniform on the sphere
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
          format: HDR_FORMAT,
          blend: {
            color: { srcFactor: "one", dstFactor: "one", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  });

  const blurModule = device.createShaderModule({ code: BLUR_WGSL });
  const blurPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: blurModule, entryPoint: "vs" },
    fragment: { module: blurModule, entryPoint: "fs", targets: [{ format: HDR_FORMAT }] },
    primitive: { topology: "triangle-list" },
  });
  const compositeModule = device.createShaderModule({ code: COMPOSITE_WGSL });
  const compositePipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: compositeModule, entryPoint: "vs" },
    fragment: { module: compositeModule, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  // Per-direction blur step (UV offset). Rewritten on resize.
  const blurStepH = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const blurStepV = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  // Clamp-to-edge so the blur taps don't wrap a glow across the frame.
  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
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

  return new WebGPUAvatar(device, context, format, {
    computePipeline,
    renderPipeline,
    blurPipeline,
    compositePipeline,
    sampler,
    computeBind,
    renderBind,
    uniformBuf,
    morphBuf,
    mcolBuf,
    blurStepH,
    blurStepV,
  });
}

interface GpuRes {
  computePipeline: GPUComputePipeline;
  renderPipeline: GPURenderPipeline;
  blurPipeline: GPURenderPipeline;
  compositePipeline: GPURenderPipeline;
  sampler: GPUSampler;
  computeBind: GPUBindGroup;
  renderBind: GPUBindGroup;
  uniformBuf: GPUBuffer;
  morphBuf: GPUBuffer;
  mcolBuf: GPUBuffer;
  blurStepH: GPUBuffer;
  blurStepV: GPUBuffer;
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
  private raf = 0;
  private t = 0;
  private w = 1;
  private h = 1;
  private disposed = false;
  private sceneTex: GPUTexture | null = null;
  private sceneView: GPUTextureView | null = null;
  private bloomA: GPUTexture | null = null;
  private bloomB: GPUTexture | null = null;
  private bloomAView: GPUTextureView | null = null;
  private bloomBView: GPUTextureView | null = null;
  private blurHBind: GPUBindGroup | null = null;
  private blurVBind: GPUBindGroup | null = null;
  private compositeBind: GPUBindGroup | null = null;

  constructor(
    private device: GPUDevice,
    private context: GPUCanvasContext,
    private format: GPUTextureFormat,
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
    const bw = Math.max(1, Math.floor(this.w / 4));
    const bh = Math.max(1, Math.floor(this.h / 4));
    const dev = this.device;
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;

    // Full-res crisp scene + two quarter-res ping-pong bloom targets.
    this.sceneTex?.destroy();
    this.bloomA?.destroy();
    this.bloomB?.destroy();
    this.sceneTex = dev.createTexture({ size: [this.w, this.h], format: HDR_FORMAT, usage });
    this.bloomA = dev.createTexture({ size: [bw, bh], format: HDR_FORMAT, usage });
    this.bloomB = dev.createTexture({ size: [bw, bh], format: HDR_FORMAT, usage });
    this.sceneView = this.sceneTex.createView();
    this.bloomAView = this.bloomA.createView();
    this.bloomBView = this.bloomB.createView();

    // Blur steps: horizontal reads the full scene, vertical reads the quarter map.
    dev.queue.writeBuffer(this.res.blurStepH, 0, new Float32Array([BLOOM_SPREAD / bw, 0, 0, 0]));
    dev.queue.writeBuffer(this.res.blurStepV, 0, new Float32Array([0, BLOOM_SPREAD / bh, 0, 0]));

    const blurLayout = this.res.blurPipeline.getBindGroupLayout(0);
    // H: scene → bloomB.
    this.blurHBind = dev.createBindGroup({
      layout: blurLayout,
      entries: [
        { binding: 0, resource: this.res.sampler },
        { binding: 1, resource: this.sceneView },
        { binding: 2, resource: { buffer: this.res.blurStepH } },
      ],
    });
    // V: bloomB → bloomA.
    this.blurVBind = dev.createBindGroup({
      layout: blurLayout,
      entries: [
        { binding: 0, resource: this.res.sampler },
        { binding: 1, resource: this.bloomBView },
        { binding: 2, resource: { buffer: this.res.blurStepV } },
      ],
    });
    // Composite: scene + bloomA → canvas.
    this.compositeBind = dev.createBindGroup({
      layout: this.res.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.res.sampler },
        { binding: 1, resource: this.sceneView },
        { binding: 2, resource: this.bloomAView },
      ],
    });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.sceneTex?.destroy();
    this.bloomA?.destroy();
    this.bloomB?.destroy();
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
    if (!this.sceneView || !this.blurHBind || !this.blurVBind || !this.compositeBind) return; // not sized yet

    if (this.morph !== this.lastMorph) {
      this.lastMorph = this.morph;
      if (this.morph) this.uploadMorph(this.morph);
      else this.useMorphColor = 0;
    }

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
    e.morphMix += ((this.morph ? 1 : 0) - e.morphMix) * 0.06;
    const targetScale = inp.state === "thinking" ? 0.78 : inp.state === "speaking" ? 1.08 : 1;
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
    u[10] = STATE_ID[inp.state];
    u[11] = 0.026; // dotSize (world units) — crisp mote size
    u[12] = N;
    u[13] = this.useMorphColor;
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

    const fullPass = (view: GPUTextureView, pipeline: GPURenderPipeline, bind: GPUBindGroup, instances: number, verts: number) => {
      const rp = enc.beginRenderPass({
        colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
      });
      rp.setPipeline(pipeline);
      rp.setBindGroup(0, bind);
      rp.draw(verts, instances);
      rp.end();
    };

    // Pass 1: accumulate crisp particles additively into the full-res scene.
    fullPass(this.sceneView, this.res.renderPipeline, this.res.renderBind, N, 6);
    // Pass 2+3: separable Gaussian → quarter-res bloom (scene→B horizontal, B→A vertical).
    fullPass(this.bloomBView!, this.res.blurPipeline, this.blurHBind, 1, 3);
    fullPass(this.bloomAView!, this.res.blurPipeline, this.blurVBind, 1, 3);
    // Pass 4: composite crisp scene + soft bloom, tone-mapped, onto the canvas.
    fullPass(this.context.getCurrentTexture().createView(), this.res.compositePipeline, this.compositeBind, 1, 3);

    this.device.queue.submit([enc.finish()]);
  }
}
