/**
 * @pattern/mod-admin — process/host observability (the "Process" page).
 *
 * `processStats()` snapshots the host (os), the Node process (memory, CPU%),
 * the event loop (delay histogram + utilization — the "how busy is the loop"
 * signal), and the engine's run transport. CPU% and event-loop figures are
 * DELTAS since the previous call, so a polling UI gets per-interval readings.
 *
 * `workerBench()` is the worker-efficiency showcase: the same CPU-bound
 * workflow (core.math.fib) dispatched N× concurrently, once on the host event
 * loop and once on a fresh WorkerPoolTransport — wall time and max event-loop
 * lag side by side. Inline, the runs serialize AND freeze the loop; on the
 * pool they parallelize and the loop stays responsive. Numbers tell the story.
 *
 * Node-specific by design (node:os / node:perf_hooks) — the admin's host IS
 * the node runtime; mod-admin already depends on @pattern/runtime-node.
 */

import os from "node:os";
import { monitorEventLoopDelay, performance, type IntervalHistogram } from "node:perf_hooks";
import { Engine, type Workflow } from "@pattern/core";
import { WorkerPoolTransport } from "@pattern/runtime-node";

const toMs = (ns: number): number => Math.round(ns / 1e4) / 100;
const toMb = (b: number): number => Math.round((b / 1048576) * 10) / 10;

// ── Rolling samplers (module-level: deltas between polls) ──

/** Event-loop delay histogram, reset on every read. */
const loopDelay: IntervalHistogram = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();

let lastCpu = process.cpuUsage();
let lastCpuAt = performance.now();
let lastElu = performance.eventLoopUtilization();

export interface ProcessStats {
  host: {
    platform: string;
    arch: string;
    release: string;
    cpuModel: string;
    cpus: number;
    loadAvg: number[];
    totalMemMb: number;
    freeMemMb: number;
    uptimeSec: number;
  };
  process: {
    pid: number;
    node: string;
    uptimeSec: number;
    /** % of ONE core over the last poll interval (can exceed 100 with workers). */
    cpuPercent: number;
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    externalMb: number;
  };
  eventLoop: {
    /** 0..1 — fraction of the last interval the loop spent busy (ELU). */
    utilization: number;
    p50Ms: number;
    p99Ms: number;
    maxMs: number;
  };
  transport: Record<string, unknown>;
}

/** Snapshot host/process/event-loop/transport. Deltas span since the last call. */
export function processStats(engine: Engine): ProcessStats {
  const now = performance.now();
  const cpu = process.cpuUsage();
  const elapsedMs = Math.max(1, now - lastCpuAt);
  const cpuPercent = Math.round(((cpu.user - lastCpu.user + cpu.system - lastCpu.system) / 1000 / elapsedMs) * 1000) / 10;
  lastCpu = cpu;
  lastCpuAt = now;

  const elu = performance.eventLoopUtilization();
  const utilization = Math.round(performance.eventLoopUtilization(elu, lastElu).utilization * 1000) / 1000;
  lastElu = elu;

  const mem = process.memoryUsage();
  const cpus = os.cpus();
  const stats: ProcessStats = {
    host: {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      cpuModel: cpus[0]?.model ?? "unknown",
      cpus: cpus.length,
      loadAvg: os.loadavg().map((l) => Math.round(l * 100) / 100),
      totalMemMb: toMb(os.totalmem()),
      freeMemMb: toMb(os.freemem()),
      uptimeSec: Math.round(os.uptime()),
    },
    process: {
      pid: process.pid,
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      cpuPercent,
      rssMb: toMb(mem.rss),
      heapUsedMb: toMb(mem.heapUsed),
      heapTotalMb: toMb(mem.heapTotal),
      externalMb: toMb(mem.external),
    },
    eventLoop: {
      utilization,
      p50Ms: toMs(loopDelay.percentile(50)),
      p99Ms: toMs(loopDelay.percentile(99)),
      maxMs: toMs(loopDelay.max),
    },
    transport: engine.transportInfo(),
  };
  loopDelay.reset();
  return stats;
}

// ── Worker-efficiency benchmark ──

/** The CPU-bound benchmark workload: one naive-fibonacci node. Base catalog
 *  only, so pool workers have everything they need without loading mods. */
const benchWorkflow = (n: number): Workflow => ({
  id: "admin.bench.fib",
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["n"] } },
    { id: "fib", op: "core.math.fib", config: { n } },
    { id: "out", op: "boundary.return" },
  ],
  edges: [
    { from: { node: "in", port: "n" }, to: { node: "fib", port: "n" } },
    { from: { node: "fib", port: "out" }, to: { node: "out", port: "value" } },
  ],
});

export interface BenchPhase {
  wallMs: number;
  /** Worst event-loop stall observed while the phase ran. */
  maxLagMs: number;
  /** How long the loop was busy during the phase (ELU over the phase). */
  loopUtilization: number;
}

export interface BenchResult {
  n: number;
  runs: number;
  inline: BenchPhase;
  pool: BenchPhase & { workers: number; spawnMs: number };
  /** inline wall / pool wall (computed AFTER subtracting pool spawn cost too). */
  speedup: number;
}

async function measure(dispatch: () => Promise<unknown>): Promise<BenchPhase> {
  const h = monitorEventLoopDelay({ resolution: 5 });
  h.enable();
  // Arm the monitor: its sampling timer needs a quiet turn BEFORE the block,
  // and a turn after so the stalled tick actually fires and records — without
  // both, a fully-blocked loop reads as 0 lag (the one thing we're measuring).
  await new Promise((r) => setTimeout(r, 15));
  const eluStart = performance.eventLoopUtilization();
  const t0 = performance.now();
  await dispatch();
  const wallMs = Math.round(performance.now() - t0);
  const loopUtilization = Math.round(performance.eventLoopUtilization(performance.eventLoopUtilization(), eluStart).utilization * 1000) / 1000;
  await new Promise((r) => setTimeout(r, 20));
  h.disable();
  return { wallMs, maxLagMs: toMs(h.max), loopUtilization };
}

/**
 * Run the fib workload `runs`× concurrently — first inline on this event loop,
 * then on a fresh worker pool — and report wall time + loop stalls for each.
 */
export async function workerBench(opts: { n?: number; runs?: number } = {}): Promise<BenchResult> {
  const n = Math.min(40, Math.max(20, Math.floor(opts.n ?? 34)));
  const runs = Math.min(16, Math.max(1, Math.floor(opts.runs ?? 4)));
  const wf = benchWorkflow(n);

  // Phase 1 — inline: a throwaway in-process engine on THIS event loop.
  const inlineEngine = new Engine();
  inlineEngine.registerWorkflow(wf);
  const inline = await measure(() =>
    Promise.all(Array.from({ length: runs }, () => inlineEngine.run(wf.id, { input: {} }))),
  );

  // Phase 2 — pool: same dispatch on worker threads. Spawn cost reported
  // separately (a real deployment pays it once, not per request).
  const size = Math.max(1, Math.min(runs, os.availableParallelism() - 1));
  const spawn0 = performance.now();
  const pool = new WorkerPoolTransport({ size });
  const poolEngine = new Engine({ transport: pool });
  poolEngine.registerWorkflow(wf);
  // One warm-up run so module loading in the workers isn't billed to the phase.
  await poolEngine.run(wf.id, { input: { n: 10 } });
  const spawnMs = Math.round(performance.now() - spawn0);
  const phase = await measure(() =>
    Promise.all(Array.from({ length: runs }, () => poolEngine.run(wf.id, { input: {} }))),
  );
  await pool.close();

  return {
    n,
    runs,
    inline,
    pool: { ...phase, workers: size, spawnMs },
    speedup: phase.wallMs > 0 ? Math.round((inline.wallMs / phase.wallMs) * 10) / 10 : 0,
  };
}
