/**
 * `pattern load` — boot the app in-process, attach the flight recorder, drive
 * open-loop HTTP load at it, and report client latency joined with engine span
 * attribution. Evolutive by design: scenarios are data, so SSE/WS/chat-turn
 * scenarios and before/after comparisons slot in later without changing the
 * shape here.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadProject } from "../project.js";
import { FlightRecorder } from "./recorder.js";
import { runStage } from "./generator.js";
import { printStage, printSweepVerdict, summarize, type StageStats } from "./report.js";
import { LoadScenarioSchema, type LoadScenario, type LoadStage } from "./types.js";

export { FlightRecorder } from "./recorder.js";
export { runStage } from "./generator.js";
export { summarize } from "./report.js";
export * from "./types.js";

export interface LoadOptions {
  /** Override the scenario's stages with a saturation sweep. */
  sweep?: boolean;
  /** Sweep rate steps (req/s). */
  sweepRates?: number[];
  /** p99 budget (ms) that defines the sweep's knee. */
  p99BudgetMs?: number;
  /** Write the full report as JSON here. */
  out?: string;
  /** Where to fire when not booting in-process. */
  baseUrl?: string;
}

const DEFAULT_SWEEP = [10, 25, 50, 100, 200, 400, 800];

/** Load + validate a scenario file (JSON). */
export function loadScenario(file: string): LoadScenario {
  if (!existsSync(file)) throw new Error(`scenario not found: ${file}`);
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const parsed = LoadScenarioSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`invalid scenario: ${first?.path.join(".")}: ${first?.message}`);
  }
  return parsed.data;
}

export interface LoadReport {
  scenario: string;
  baseUrl: string;
  booted: boolean;
  stages: StageStats[];
  startedAt: number;
}

/**
 * Run a scenario. Boots the project in-process (unless `entry:false` or a
 * `baseUrl` is given), warms up, runs each measured stage (or a sweep) with a
 * fresh recorder window, prints as it goes, and returns the full report.
 */
export async function runLoad(scenario: LoadScenario, opts: LoadOptions = {}, startedAt = Date.now()): Promise<LoadReport> {
  const recorder = new FlightRecorder();
  let baseUrl = opts.baseUrl ?? scenario.baseUrl ?? "";
  let close: (() => Promise<void>) | undefined;
  let booted = false;

  // Boot in-process unless told to target an external server.
  const shouldBoot = scenario.entry !== false && !opts.baseUrl && !scenario.baseUrl;
  if (shouldBoot) {
    const project = await loadProject();
    project.engine.onTrace(recorder); // the unfair advantage: same-process spans
    const started = await project.start();
    baseUrl = `http://localhost:${started.ports[0]}`;
    booted = true;
    close = started.close;
  }
  if (!baseUrl) throw new Error("no target: set a scenario `baseUrl`, pass --url, or boot in-process with an `entry`");

  try {
    if (scenario.warmup) {
      process.stdout.write(`\n  warming up (${scenario.warmup.rate}/s for ${scenario.warmup.durationMs / 1000}s)…`);
      await runStage(baseUrl, scenario.warmup, scenario.requests, scenario.maxInflight);
      process.stdout.write(" done\n");
    }

    const stages: LoadStage[] = opts.sweep
      ? (opts.sweepRates ?? DEFAULT_SWEEP).map((rate) => ({ rate, durationMs: scenario.stages[0]?.durationMs ?? 5000 }))
      : scenario.stages;

    const results: StageStats[] = [];
    for (const stage of stages) {
      recorder.start(performance.now());
      const samples = await runStage(baseUrl, stage, scenario.requests, scenario.maxInflight);
      const flight = recorder.stop(performance.now());
      const stats = summarize(stage, samples, booted ? flight : undefined);
      results.push(stats);
      printStage(stats);
      // Sweep early-exit: once past the knee, climbing higher just hurts.
      if (opts.sweep && (stats.p99 > (opts.p99BudgetMs ?? 1000) || stats.errors / Math.max(1, stats.requests) > 0.05)) break;
    }

    if (opts.sweep) printSweepVerdict(results, opts.p99BudgetMs ?? 1000);
    return { scenario: "", baseUrl, booted, stages: results, startedAt };
  } finally {
    await close?.();
  }
}

/** Resolve a scenario path relative to cwd (CLI helper). */
export function resolveScenario(file: string): string {
  return resolve(process.cwd(), file);
}
