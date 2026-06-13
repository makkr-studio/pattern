/**
 * @pattern/runtime-node — load-testing scenario schema (`pattern load`).
 *
 * A scenario is DATA (like everything in Pattern): versioned, diffable,
 * committable. v1 fires HTTP requests at a workflow app under an OPEN-LOOP
 * arrival schedule (requests launch at a fixed rate regardless of how many are
 * in flight — closed-loop concurrency self-throttles and lies about capacity).
 * The differentiator is the engine FLIGHT RECORDER: when the app boots
 * in-process, a trace sink attributes client latency to per-node span time, so
 * the report says *where* the pressure is, not just that there is some.
 */

import { z } from "@pattern/core";

/** One request shape the generator can fire (chosen by weight). */
export const LoadRequestSchema = z.object({
  /** Relative pick weight among requests (default 1). */
  weight: z.number().positive().default(1),
  method: z.string().default("GET"),
  /** Path or absolute URL. Relative paths resolve against the target base URL. */
  path: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  /** Request body — a string sent as-is, or an object sent as JSON. */
  body: z.unknown().optional(),
  /** A label for the report (defaults to "METHOD path"). */
  label: z.string().optional(),
});
export type LoadRequest = z.infer<typeof LoadRequestSchema>;

/** A constant-rate phase: `rate` requests/second for `durationMs`. */
export const LoadStageSchema = z.object({
  rate: z.number().positive(),
  durationMs: z.number().int().positive(),
});
export type LoadStage = z.infer<typeof LoadStageSchema>;

export const LoadScenarioSchema = z.object({
  version: z.literal(1).default(1),
  /**
   * Project entry to BOOT in-process (default "src/index.ts" when present).
   * Booting in-process is what unlocks the flight recorder. Set `false` to
   * skip booting and fire at an already-running `baseUrl` (client metrics
   * only — no span attribution).
   */
  entry: z.union([z.string(), z.literal(false)]).optional(),
  /** Where to fire. Defaults to the booted host's first port. */
  baseUrl: z.string().optional(),
  /** A gentle phase before measurement (JIT warmup, pool spin-up). */
  warmup: LoadStageSchema.optional(),
  /** The measured phases, run in order. */
  stages: z.array(LoadStageSchema).default([{ rate: 50, durationMs: 10_000 }]),
  /** The request mix. */
  requests: z.array(LoadRequestSchema).min(1),
  /** Safety cap on simultaneously in-flight requests (default 10k). */
  maxInflight: z.number().int().positive().default(10_000),
});
export type LoadScenario = z.infer<typeof LoadScenarioSchema>;

/** One completed request observation. */
export interface RequestSample {
  /** When this request was SCHEDULED to fire (open-loop reference). */
  scheduledAt: number;
  /** When it actually went out (scheduledAt + scheduling lag). */
  sentAt: number;
  endedAt: number;
  status: number;
  ok: boolean;
  bytes: number;
  label: string;
  error?: string;
}

/** Per-op rollup from the flight recorder (one window). */
export interface OpStat {
  op: string;
  count: number;
  totalMs: number;
  selfMs: number;
  p50: number;
  p99: number;
  errors: number;
}

/** What the recorder observed during a window. */
export interface FlightRecording {
  spans: number;
  runs: number;
  runErrors: number;
  maxConcurrency: number;
  ops: OpStat[];
  /** Wall time the window covered (ms). */
  windowMs: number;
}
