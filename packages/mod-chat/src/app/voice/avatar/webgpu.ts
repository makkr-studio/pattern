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
const U_FLOATS = 20; // 80 bytes — must match struct U below
const HDR_FORMAT: GPUTextureFormat = "rgba16float"; // float accumulation target for the tone-map

const STATE_ID: Record<AvatarState, number> = { idle: 0, listening: 1, thinking: 2, speaking: 3, presenting: 3 };

const COMPUTE_WGSL = /* wgsl */ `
struct U {
  res: vec2f, time: f32, dt: f32,
  level: f32, bass: f32, mid: f32, treble: f32,
  morphMix: f32, scale: f32, stateId: f32, dotSize: f32,
  count: f32, useMorphColor: f32, pad0: f32, pad1: f32,
  color: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> dyn: array<vec4f>;
@group(0) @binding(2) var<storage, read> cst: array<vec2f>;
@group(0) @binding(3) var<storage, read> morph: array<vec2f>;

// A soft volumetric blob: rr is a gaussian radius (no hard rim), scaled per
// state. The cloud breathes when idle, leans out when listening, condenses when
// thinking, and blooms with the voice when speaking.
fn posture(i: u32, t: f32) -> vec2f {
  let s = cst[i].x;
  let rr = cst[i].y;
  let a0 = s * 6.2831853;
  let lvl = u.level;
  var sc: f32;
  var spin: f32;
  let st = u.stateId;
  if (st < 0.5) {
    sc = 1.0 + sin(t * 0.5 + s * 6.0) * 0.04; spin = 0.02;
  } else if (st < 1.5) {
    sc = 1.02 + lvl * 0.28 + sin(t * 1.3 + a0 * 2.0) * 0.03; spin = 0.035;
  } else if (st < 2.5) {
    sc = 0.62 + sin(t * 1.6 + s * 8.0) * 0.03; spin = 0.42;
  } else {
    sc = 1.0 + lvl * 0.34 + u.bass * 0.16 + sin(t * 2.4 + a0 * 3.0) * u.treble * 0.08; spin = 0.045;
  }
  let r = rr * 0.72 * sc;
  let a = a0 + spin * t;
  return vec2f(cos(a) * r, sin(a) * r);
}

@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u32(u.count)) { return; }
  let t = u.time;
  let d = dyn[i];
  let pos = d.xy;
  var vel = d.zw;
  let base = posture(i, t);
  var tgt = base;
  if (u.morphMix > 0.001) {
    let m = morph[i];
    tgt = base + (m - base) * u.morphMix;
  }
  let s = cst[i].x;
  // Higher-frequency, per-particle-decorrelated curl → fine smoke shimmer rather
  // than one coherent spiral lane carving a dark crescent.
  let ph = s * 40.0;
  let nx = sin(pos.y * 9.0 + t * 0.7 + ph) + 0.5 * sin(pos.x * 19.0 - t * 0.5 + ph);
  let ny = cos(pos.x * 9.0 - t * 0.6 + ph) + 0.5 * cos(pos.y * 19.0 + t * 0.4 + ph);
  let turb = 0.0007 + u.level * 0.004 + u.treble * 0.003;
  var k = 0.05;
  if (u.morphMix > 0.001) { k = 0.09; }
  vel = vel * 0.9 + (tgt - pos) * k + vec2f(nx, ny) * turb;
  dyn[i] = vec4f(pos + vel, vel);
}
`;

const RENDER_WGSL = /* wgsl */ `
struct U {
  res: vec2f, time: f32, dt: f32,
  level: f32, bass: f32, mid: f32, treble: f32,
  morphMix: f32, scale: f32, stateId: f32, dotSize: f32,
  count: f32, useMorphColor: f32, pad0: f32, pad1: f32,
  color: vec4f,
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
};

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
  // Pseudo-depth per particle (gives the cloud volume): decorrelate from the
  // angle (s) by mixing in the radius (rr), so brightness does not band around
  // the circle. NOTE: never sin() a large value here (f32(ii) etc.) — Metal
  // returns NaN for huge arguments, which collapses every quad to nothing.
  let depth = 0.4 + 0.6 * fract(s * 11.0 + rr * 7.0);
  // Aspect-correct fit: scale the longer axis down so circles stay circular.
  let asp = vec2f(min(1.0, u.res.y / u.res.x), min(1.0, u.res.x / u.res.y));
  let size = u.dotSize * (0.5 + 1.1 * depth);
  let world = p * u.scale + c * size;
  let clip = world * 0.82 * asp;
  var vo: VSOut;
  vo.pos = vec4f(clip, 0.0, 1.0);
  vo.uv = c;
  let speed = clamp((abs(vel.x) + abs(vel.y)) * 6.0, 0.0, 1.0);
  // Gentle, color-preserving brightness — the glow comes from many soft motes
  // accumulating, not from blowing each one out to white.
  vo.bright = (0.35 + 0.5 * depth + speed * 0.25) * (0.9 + u.level * 0.5);
  var col = u.color.xyz;
  if (u.useMorphColor > 0.5 && u.morphMix > 0.01) {
    col = mix(col, mcol[ii].xyz, u.morphMix);
  }
  vo.color = col;
  return vo;
}

@fragment
fn fs(frag: VSOut) -> @location(0) vec4f {
  // Soft gaussian mote. Drawn additively into an HDR target, so it may exceed 1;
  // the tone-map pass rolls the bright core off to a warm glow (no hard white).
  let r2 = dot(frag.uv, frag.uv);
  let g = exp(-r2 * 3.6);
  let alpha = g * 0.05;
  return vec4f(frag.color * frag.bright * alpha, alpha);
}
`;

// Tone-map pass: sample the HDR accumulation and compress with Reinhard (hue is
// preserved, highlights roll off softly instead of clipping to white), over a
// subtle neon-dark background.
const TONEMAP_WGSL = /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

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

@fragment
fn fs(i: VOut) -> @location(0) vec4f {
  let hdr = textureSample(tex, samp, i.uv).rgb;
  // Tone-map the LUMINANCE and keep the chroma, so the bright core stays a
  // saturated neon glow instead of desaturating to cream.
  let l = max(dot(hdr, vec3f(0.2126, 0.7152, 0.0722)), 0.0001);
  let lt = (l * 1.1) / (1.0 + l * 1.1);
  let mapped = min(hdr * (lt / l), vec3f(1.0));
  let bg = vec3f(0.012, 0.011, 0.018); // neon-dark floor
  return vec4f(mapped + bg, 1.0);
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

  const tonemapModule = device.createShaderModule({ code: TONEMAP_WGSL });
  const tonemapPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: tonemapModule, entryPoint: "vs" },
    fragment: { module: tonemapModule, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

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
    tonemapPipeline,
    sampler,
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
  tonemapPipeline: GPURenderPipeline;
  sampler: GPUSampler;
  computeBind: GPUBindGroup;
  renderBind: GPUBindGroup;
  uniformBuf: GPUBuffer;
  morphBuf: GPUBuffer;
  mcolBuf: GPUBuffer;
}

class WebGPUAvatar implements Avatar {
  readonly backend = "webgpu" as const;
  private inputs: AvatarInputs = { ...DEFAULT_INPUTS, bands: { ...DEFAULT_INPUTS.bands } };
  private eased = { level: 0, bass: 0, mid: 0, treble: 0, color: [...DEFAULT_INPUTS.color] as RGB, morphMix: 0, scale: 1 };
  private uni = new Float32Array(U_FLOATS);
  private morph: MorphTarget | null = null;
  private lastMorph: MorphTarget | null = null;
  private useMorphColor = 0;
  private raf = 0;
  private t = 0;
  private w = 1;
  private h = 1;
  private disposed = false;
  private hdrTex: GPUTexture | null = null;
  private hdrView: GPUTextureView | null = null;
  private tonemapBind: GPUBindGroup | null = null;

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
    // (Re)create the HDR accumulation target + its tone-map bind group.
    this.hdrTex?.destroy();
    this.hdrTex = this.device.createTexture({
      size: [this.w, this.h],
      format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.hdrView = this.hdrTex.createView();
    this.tonemapBind = this.device.createBindGroup({
      layout: this.res.tonemapPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.res.sampler },
        { binding: 1, resource: this.hdrView },
      ],
    });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.hdrTex?.destroy();
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
    if (!this.hdrView || !this.tonemapBind) return; // not sized yet

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
    u[11] = 0.042; // dotSize (world units) — soft mote size
    u[12] = N;
    u[13] = this.useMorphColor;
    u[16] = e.color[0];
    u[17] = e.color[1];
    u[18] = e.color[2];
    u[19] = 1;
    this.device.queue.writeBuffer(this.res.uniformBuf, 0, u);

    const enc = this.device.createCommandEncoder();
    const cp = enc.beginComputePass();
    cp.setPipeline(this.res.computePipeline);
    cp.setBindGroup(0, this.res.computeBind);
    cp.dispatchWorkgroups(Math.ceil(N / 64));
    cp.end();

    // Pass 1: accumulate the particles additively into the HDR target.
    const rp = enc.beginRenderPass({
      colorAttachments: [{ view: this.hdrView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
    });
    rp.setPipeline(this.res.renderPipeline);
    rp.setBindGroup(0, this.res.renderBind);
    rp.draw(6, N);
    rp.end();

    // Pass 2: tone-map the HDR target onto the canvas.
    const canvasView = this.context.getCurrentTexture().createView();
    const tp = enc.beginRenderPass({
      colorAttachments: [{ view: canvasView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
    });
    tp.setPipeline(this.res.tonemapPipeline);
    tp.setBindGroup(0, this.tonemapBind);
    tp.draw(3, 1);
    tp.end();

    this.device.queue.submit([enc.finish()]);
  }
}
