/**
 * Pattern — op-authoring helpers.
 *
 * Most base ops are pure value functions: await some value inputs, compute,
 * return one value. `pureOp` captures that shape so each op definition stays a
 * few lines and the port wiring is declared once. Streaming, control-flow, and
 * boundary ops are authored directly against `OpDefinition` where they need more
 * control.
 */

import { z } from "zod";
import type { OpContext, OpDefinition, OpEffects, PortSpec, Ports } from "../types.js";

// ── Port builders ──

/** A value input/output port. */
export const value = (schema?: z.ZodType, extra?: Partial<PortSpec>): PortSpec => ({
  kind: "value",
  schema,
  ...extra,
});

/** A required value input. */
export const required = (schema?: z.ZodType, extra?: Partial<PortSpec>): PortSpec => ({
  kind: "value",
  schema,
  required: true,
  ...extra,
});

/** A stream port of `schema`-typed elements. */
export const stream = (schema?: z.ZodType, extra?: Partial<PortSpec>): PortSpec => ({
  kind: "stream",
  schema,
  ...extra,
});

/** A dataless control port. */
export const control = (description?: string): PortSpec => ({ kind: "control", description });

/** Identity passthrough — keeps `OpDefinition` literals readable & checked. */
export function defineOp(op: OpDefinition): OpDefinition {
  return op;
}

/**
 * Define a pure value op: declared value inputs are awaited (in parallel), then
 * `compute({ ...inputs }, ctx)` runs and its return value becomes the single
 * output port (default `out`). Unwired optional inputs arrive as `undefined`.
 */
export function pureOp<C = unknown>(opts: {
  type: string;
  title?: string;
  description?: string;
  inputs: Ports;
  /** Output port name; default "out". */
  outPort?: string;
  /** Output schema; default `z.any()`. */
  output?: z.ZodType;
  config?: z.ZodType;
  /** Replay-safety override; a `pureOp` is, by construction, "pure". */
  effects?: OpEffects;
  compute: (inputs: Record<string, any>, ctx: OpContext & { config: C }) => unknown | Promise<unknown>;
}): OpDefinition {
  const outPort = opts.outPort ?? "out";
  return {
    type: opts.type,
    title: opts.title,
    description: opts.description,
    inputs: opts.inputs,
    outputs: { [outPort]: value(opts.output ?? z.any()) },
    config: opts.config,
    effects: opts.effects ?? "pure",
    execute: async (ctx) => {
      const names = Object.entries(opts.inputs).filter(([, s]) => s.kind === "value");
      const entries = await Promise.all(
        names.map(async ([name]) => [name, await ctx.input.value(name)] as const),
      );
      const inputs = Object.fromEntries(entries);
      const result = await opts.compute(inputs, ctx as OpContext & { config: C });
      return { [outPort]: result };
    },
  };
}

/** Coerce a value to a finite number or throw a friendly error. */
export function asNumber(v: unknown, what = "value"): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`${what} is not a finite number: ${JSON.stringify(v)}`);
  return n;
}

export { z };
