/**
 * §12 — Control flow / workflow primitives.
 *
 * These are where control ports (§2) earn their keep. Control-flow ops declare
 * named `controlOut` ports and pulse them selectively; the engine marks the
 * unpulsed ones as "skipped", propagating skip through the unreached subgraph.
 * Ops with no `controlOut` (delay/assert/noop/foreach/log) are ordinary and
 * auto-pulse `out` on completion — so they sequence naturally too.
 */

import { WorkflowError } from "../errors.js";
import { defineOp, required, value, z } from "./helpers.js";
import { deepEqual } from "./scalars.js";
import type { OpDefinition } from "../types.js";

const subworkflowRef = z.union([z.object({ workflowId: z.string() }), z.object({ workflow: z.any() })]);

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error("aborted"));
    }, { once: true });
  });
}

export const branch = defineOp({
  type: "core.flow.branch",
  title: "core.flow.branch",
  description: "Boolean condition → pulses control-out `then` or `else`.",
  inputs: { condition: required(z.boolean()) },
  outputs: {},
  controlOut: ["then", "else"],
  execute: async (ctx) => {
    const condition = await ctx.input.value<boolean>("condition");
    void ctx.pulse(condition ? "then" : "else");
    return {};
  },
});

export const switchOp = defineOp({
  type: "core.flow.switch",
  title: "core.flow.switch",
  description: "Match a value against config.cases → pulses `case.<i>` or `default`.",
  inputs: { value: required() },
  outputs: {},
  config: z.object({ cases: z.array(z.unknown()) }),
  controlOut: (config: { cases?: unknown[] }) => [
    ...(config.cases ?? []).map((_, i) => `case.${i}`),
    "default",
  ],
  execute: async (ctx) => {
    const v = await ctx.input.value("value");
    const { cases } = ctx.config as { cases: unknown[] };
    const idx = cases.findIndex((c) => deepEqual(c, v));
    void ctx.pulse(idx >= 0 ? `case.${idx}` : "default");
    return {};
  },
});

export const gate = defineOp({
  type: "core.flow.gate",
  title: "core.flow.gate",
  description: "Pass control through `out` only if condition is true; otherwise the path stops here.",
  inputs: { condition: required(z.boolean()) },
  outputs: {},
  controlOut: ["out"],
  execute: async (ctx) => {
    const condition = await ctx.input.value<boolean>("condition");
    if (condition) void ctx.pulse("out");
    return {};
  },
});

export const sequence = defineOp({
  type: "core.flow.sequence",
  title: "core.flow.sequence",
  description: "Pulse control-outs 0..count-1 in order, each waiting for the previous subgraph to finish.",
  inputs: {},
  outputs: {},
  config: z.object({ count: z.number().int().positive() }),
  controlOut: (config: { count?: number }) => Array.from({ length: config.count ?? 0 }, (_, i) => String(i)),
  execute: async (ctx) => {
    const { count } = ctx.config as { count: number };
    for (let i = 0; i < count; i++) {
      await ctx.pulse(String(i)); // resolves when branch i's subgraph quiesces
    }
    return {};
  },
});

export const parallel = defineOp({
  type: "core.flow.parallel",
  title: "core.flow.parallel",
  description: "Fan control-out to N branches at once (control-outs 0..count-1).",
  inputs: {},
  outputs: {},
  config: z.object({ count: z.number().int().positive() }),
  controlOut: (config: { count?: number }) => Array.from({ length: config.count ?? 0 }, (_, i) => String(i)),
  execute: (ctx) => {
    const { count } = ctx.config as { count: number };
    for (let i = 0; i < count; i++) void ctx.pulse(String(i));
    return {};
  },
});

export const join = defineOp({
  type: "core.flow.join",
  title: "core.flow.join",
  description: "Converge N control-ins (waits for all), then pulses `out`. (AND semantics are automatic.)",
  inputs: {},
  outputs: {},
  execute: () => ({}),
});

export const delay = defineOp({
  type: "core.flow.delay",
  title: "core.flow.delay",
  description: "Wait a configured duration, then pulse `out`.",
  inputs: {},
  outputs: {},
  config: z.object({ ms: z.number().int().nonnegative() }),
  execute: async (ctx) => {
    await sleep((ctx.config as { ms: number }).ms, ctx.signal);
    return {};
  },
});

export const tryOp = defineOp({
  type: "core.flow.try",
  title: "core.flow.try",
  description: "Run a referenced sub-workflow; on error pulse `catch` (with `error`), else pulse `out` (with `result`).",
  inputs: { input: value(z.record(z.string(), z.unknown())) },
  outputs: { result: value(), error: value() },
  config: z.object({ workflow: subworkflowRef }),
  controlOut: ["out", "catch"],
  execute: async (ctx) => {
    const ref = (ctx.config as { workflow: any }).workflow;
    const input = (await ctx.input.value<Record<string, unknown>>("input")) ?? {};
    try {
      const res = await ctx.invoke(ref, input);
      void ctx.pulse("out");
      return { result: res, error: null };
    } catch (err) {
      const error = err instanceof WorkflowError ? { message: err.message, data: err.data } : { message: String((err as any)?.message ?? err) };
      void ctx.pulse("catch");
      return { result: null, error };
    }
  },
});

export const throwOp = defineOp({
  type: "core.flow.throw",
  title: "core.flow.throw",
  description: "Raise an error (fails the run / triggers an enclosing try).",
  inputs: { data: value() },
  outputs: {},
  config: z.object({ message: z.string().default("workflow error") }),
  execute: async (ctx) => {
    const data = await ctx.input.value("data");
    throw new WorkflowError((ctx.config as { message: string }).message, data);
  },
});

export const assertOp = defineOp({
  type: "core.flow.assert",
  title: "core.flow.assert",
  description: "Fail unless condition holds; otherwise pass control through.",
  inputs: { condition: required(z.boolean()) },
  outputs: {},
  config: z.object({ message: z.string().default("assertion failed") }),
  execute: async (ctx) => {
    const condition = await ctx.input.value<boolean>("condition");
    if (!condition) throw new WorkflowError((ctx.config as { message: string }).message);
    return {};
  },
});

export const noop = defineOp({
  type: "core.flow.noop",
  title: "core.flow.noop",
  description: "Pure pass-through / sequencing point. Forwards `value` if wired.",
  inputs: { value: value() },
  outputs: { value: value() },
  execute: async (ctx) => ({ value: await ctx.input.value("value") }),
});

export const foreach = defineOp({
  type: "core.flow.foreach",
  title: "core.flow.foreach",
  description: "Iterate a collection, running a sub-workflow per item (sequential or bounded-concurrent).",
  inputs: { values: required(z.array(z.unknown())) },
  outputs: { results: value(z.array(z.unknown())) },
  config: z.object({ workflow: subworkflowRef, concurrency: z.number().int().positive().default(1) }),
  execute: async (ctx) => {
    const values = (await ctx.input.value<unknown[]>("values")) ?? [];
    const { workflow, concurrency } = ctx.config as { workflow: any; concurrency: number };
    const results = new Array<unknown>(values.length);
    let next = 0;
    const limit = Math.max(1, Math.min(concurrency, values.length || 1));
    await Promise.all(
      Array.from({ length: limit }, async () => {
        for (;;) {
          const i = next++;
          if (i >= values.length) return;
          results[i] = await ctx.invoke(workflow, { item: values[i], index: i });
        }
      }),
    );
    return { results };
  },
});

export const log = defineOp({
  type: "core.log",
  title: "core.log",
  description: "Emit a structured log line to the trace sink; pass-through of `value`.",
  inputs: { value: value() },
  outputs: { value: value() },
  config: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    message: z.string().default(""),
  }),
  execute: async (ctx) => {
    const { level, message } = ctx.config as { level: "debug" | "info" | "warn" | "error"; message: string };
    const v = await ctx.input.value("value");
    ctx.log(level, message, v === undefined ? undefined : { value: v });
    return { value: v };
  },
});

export const flowOps: OpDefinition[] = [
  branch,
  switchOp,
  gate,
  sequence,
  parallel,
  join,
  delay,
  tryOp,
  throwOp,
  assertOp,
  noop,
  foreach,
  log,
];
