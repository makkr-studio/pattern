/**
 * Stage statistics + the terminal report. Latency percentiles come from the
 * SCHEDULED-time deltas (queueing included); the flight recording, when
 * present, is printed beneath each stage so the bottleneck reads next to the
 * symptom.
 */

import type { FlightRecording, LoadStage, RequestSample } from "./types.js";

export interface StageStats {
  stage: LoadStage;
  requests: number;
  ok: number;
  errors: number;
  achievedRate: number;
  /** Latency from scheduled→ended, ms. */
  p50: number;
  p90: number;
  p99: number;
  max: number;
  mean: number;
  bytesTotal: number;
  byStatus: Record<string, number>;
  flight?: FlightRecording;
}

const pct = (sorted: number[], p: number): number => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[i]! * 100) / 100;
};

export function summarize(stage: LoadStage, samples: RequestSample[], flight?: FlightRecording): StageStats {
  const lat = samples.map((s) => s.endedAt - s.scheduledAt).sort((a, b) => a - b);
  const ok = samples.filter((s) => s.ok).length;
  const span = samples.length ? (Math.max(...samples.map((s) => s.endedAt)) - Math.min(...samples.map((s) => s.scheduledAt))) / 1000 : 0;
  const byStatus: Record<string, number> = {};
  for (const s of samples) {
    const key = s.status === 0 ? "ERR" : String(s.status);
    byStatus[key] = (byStatus[key] ?? 0) + 1;
  }
  return {
    stage,
    requests: samples.length,
    ok,
    errors: samples.length - ok,
    achievedRate: span > 0 ? Math.round(samples.length / span) : samples.length,
    p50: pct(lat, 50),
    p90: pct(lat, 90),
    p99: pct(lat, 99),
    max: Math.round((lat.at(-1) ?? 0) * 100) / 100,
    mean: lat.length ? Math.round((lat.reduce((s, v) => s + v, 0) / lat.length) * 100) / 100 : 0,
    bytesTotal: samples.reduce((s, v) => s + v.bytes, 0),
    byStatus,
    flight,
  };
}

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

const ms = (n: number) => `${n}ms`;

export function printStage(s: StageStats): void {
  const errRate = s.requests ? s.errors / s.requests : 0;
  const head = `${c.bold(`${s.stage.rate}/s`)} ${c.dim(`for ${s.stage.durationMs / 1000}s`)} → ${s.requests} reqs, ${c.bold(`${s.achievedRate}/s`)} achieved`;
  console.log(`\n  ${head}`);
  const statusStr = Object.entries(s.byStatus)
    .map(([k, v]) => (k.startsWith("2") ? c.green(`${k}×${v}`) : c.red(`${k}×${v}`)))
    .join(" ");
  console.log(`    ${c.dim("status:")} ${statusStr}${errRate > 0.01 ? c.red(`  (${(errRate * 100).toFixed(1)}% errors)`) : ""}`);
  console.log(
    `    ${c.dim("latency:")} p50 ${c.cyan(ms(s.p50))}  p90 ${c.cyan(ms(s.p90))}  p99 ${c.yellow(ms(s.p99))}  max ${ms(s.max)}  ${c.dim(`mean ${ms(s.mean)}`)}`,
  );

  if (s.flight && s.flight.spans > 0) {
    const f = s.flight;
    console.log(`    ${c.dim("engine:")} ${f.runs} runs, peak concurrency ${c.bold(String(f.maxConcurrency))}${f.runErrors ? c.red(`, ${f.runErrors} run errors`) : ""}`);
    const top = f.ops.slice(0, 5);
    const totalOp = f.ops.reduce((sum, o) => sum + o.totalMs, 0) || 1;
    console.log(`    ${c.dim("where the time went (by op, total span ms):")}`);
    for (const o of top) {
      const share = Math.round((o.totalMs / totalOp) * 100);
      const bar = "█".repeat(Math.max(1, Math.round(share / 5)));
      console.log(
        `      ${c.cyan(o.op.padEnd(26))} ${c.dim(`${bar} ${share}%`)}  ${o.count}× · p99 ${ms(o.p99)}${o.errors ? c.red(` · ${o.errors} err`) : ""}`,
      );
    }
  }
}

/** The saturation verdict: the last stage whose p99 + error rate stayed sane. */
export function printSweepVerdict(stages: StageStats[], p99BudgetMs: number): void {
  const knee = stages.find((s) => s.p99 > p99BudgetMs || s.errors / Math.max(1, s.requests) > 0.02);
  const sustainable = knee ? stages[stages.indexOf(knee) - 1] : stages.at(-1);
  console.log(`\n  ${c.bold("Saturation sweep")}`);
  if (sustainable) {
    console.log(
      `    max sustainable ≈ ${c.green(c.bold(`${sustainable.achievedRate}/s`))} ${c.dim(`(p99 ${ms(sustainable.p99)}, ${(sustainable.errors / Math.max(1, sustainable.requests) * 100).toFixed(1)}% err)`)}`,
    );
  }
  if (knee) {
    console.log(
      `    knee at ${c.yellow(`${knee.stage.rate}/s`)}: ${c.dim(`p99 jumped to ${ms(knee.p99)}`)}${knee.flight ? c.dim(`, top op ${knee.flight.ops[0]?.op ?? "?"}`) : ""}`,
    );
  } else {
    console.log(`    ${c.dim(`no knee within the swept range — budget p99 ${ms(p99BudgetMs)} never exceeded`)}`);
  }
}
