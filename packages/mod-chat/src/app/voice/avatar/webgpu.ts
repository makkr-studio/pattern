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

fn posture(i: u32, t: f32) -> vec2f {
  let s = cst[i].x;
  let rr = cst[i].y;
  let a0 = s * 6.2831853;
  let lvl = u.level;
  var r: f32;
  var spin: f32;
  let st = u.stateId;
  if (st < 0.5) {
    r = 0.48 + 0.18 * rr + sin(t * 0.8 + s * 6.0) * 0.045; spin = t * 0.05;
  } else if (st < 1.5) {
    r = 0.46 + 0.16 * rr + lvl * 0.3 + sin(t * 1.4 + a0 * 3.0) * 0.03; spin = t * 0.09;
  } else if (st < 2.5) {
    r = 0.32 + 0.08 * rr + sin(t * 2.0 + s * 8.0) * 0.02; spin = t * 0.7;
  } else {
    r = 0.44 + 0.18 * rr + lvl * 0.42 + u.bass * 0.28 + sin(t * 3.0 + a0 * 4.0) * u.treble * 0.12; spin = t * 0.16;
  }
  let a = a0 + spin;
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
  var target = base;
  if (u.morphMix > 0.001) {
    let m = morph[i];
    target = base + (m - base) * u.morphMix;
  }
  let s = cst[i].x;
  let nx = sin(pos.y * 3.0 + t * 0.7 + s * 10.0);
  let ny = cos(pos.x * 3.0 - t * 0.6 + s * 10.0);
  let turb = 0.0009 + u.level * 0.004 + u.treble * 0.003;
  var k = 0.05;
  if (u.morphMix > 0.001) { k = 0.09; }
  vel = vel * 0.9 + (target - pos) * k + vec2f(nx, ny) * turb;
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
  // Aspect-correct fit: scale the longer axis down so circles stay circular.
  let asp = vec2f(min(1.0, u.res.y / u.res.x), min(1.0, u.res.x / u.res.y));
  let world = p * u.scale + c * u.dotSize;
  let clip = world * 0.82 * asp;
  var out: VSOut;
  out.pos = vec4f(clip, 0.0, 1.0);
  out.uv = c;
  let s = cst[ii].x;
  let speed = clamp((abs(vel.x) + abs(vel.y)) * 7.0, 0.0, 1.0);
  out.bright = (0.55 + s * 0.45 + speed * 0.4) * (1.0 + u.level * 1.2);
  var col = u.color.xyz;
  if (u.useMorphColor > 0.5 && u.morphMix > 0.01) {
    col = mix(col, mcol[ii].xyz, u.morphMix);
  }
  out.color = col;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let d = length(in.uv);
  let a = smoothstep(1.0, 0.0, d);
  let c = in.color * in.bright * a;
  return vec4f(c, a);
}
`;

export async function createWebGPUAvatar(canvas: HTMLCanvasElement): Promise<Avatar> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) throw new Error("WebGPU unavailable");
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error("no GPU adapter");
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  if (!context) throw new Error("no webgpu context");
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

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
    const rank = Math.sqrt(Math.random());
    cst0[i * 2] = seed;
    cst0[i * 2 + 1] = rank;
    const a = seed * Math.PI * 2;
    const r = 0.5 + 0.2 * rank;
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
          blend: {
            color: { srcFactor: "one", dstFactor: "one", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  });

  const err = await device.popErrorScope();
  if (err) throw new Error(`WGSL/pipeline: ${err.message}`);

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
    u[11] = 0.012; // dotSize (world units)
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

    const view = this.context.getCurrentTexture().createView();
    const rp = enc.beginRenderPass({
      colorAttachments: [{ view, clearValue: { r: 0.03, g: 0.027, b: 0.035, a: 1 }, loadOp: "clear", storeOp: "store" }],
    });
    rp.setPipeline(this.res.renderPipeline);
    rp.setBindGroup(0, this.res.renderBind);
    rp.draw(6, N);
    rp.end();
    this.device.queue.submit([enc.finish()]);
  }
}
