/**
 * §12 — Stream (dataflow) ops, built on Web Streams.
 *
 *  - split: tee/fan-out one stream into N branches (backpressure or drop).
 *  - merge: combine N streams (interleave or concat).
 *  - accumulate: reduce/collect a stream into a value — a BARRIER.
 *  - emit: value/iterable → stream.
 *  - map/filter: per-element transform via a referenced sub-workflow.
 *
 * The bidirectional value↔stream bridge lives in `accumulate` (stream→value) and
 * `emit` (value→stream), the only sanctioned crossings (§2).
 */

import { defineOp, required, stream, value, z } from "../ops-core/helpers.js";
import { StreamHub } from "../scheduler/slots.js";
import { iterableToStream, streamToIterable } from "./util.js";
import { getPath } from "../ops-core/objects.js";
import { renderTemplate } from "../ops-core/strings.js";
import type { OpDefinition, Ports } from "../types.js";

const subworkflowRef = z.union([z.object({ workflowId: z.string() }), z.object({ workflow: z.any() })]);
const bufferPolicy = z.union([z.literal("backpressure"), z.object({ drop: z.number().int().positive() })]);

/** Broadcast one source into N branches under the chosen buffering policy. */
function broadcast(
  source: ReadableStream<unknown>,
  branches: number,
  policy: "backpressure" | { drop: number },
): ReadableStream<unknown>[] {
  if (policy === "backpressure") {
    const hub = new StreamHub();
    const outs = Array.from({ length: branches }, () => hub.subscribe());
    hub.connect(source);
    return outs;
  }
  // Drop policy: never let a slow branch slow the source; overflow is dropped.
  const max = policy.drop;
  const controllers: ReadableStreamDefaultController<unknown>[] = [];
  const outs = Array.from(
    { length: branches },
    () =>
      new ReadableStream<unknown>(
        { start: (c) => controllers.push(c) },
        new CountQueuingStrategy({ highWaterMark: max }),
      ),
  );
  void (async () => {
    const reader = source.getReader();
    try {
      for (;;) {
        const { done, value: v } = await reader.read();
        if (done) break;
        for (const c of controllers) {
          if ((c.desiredSize ?? 0) > 0) {
            try {
              c.enqueue(v);
            } catch {
              /* branch gone */
            }
          } // else: drop
        }
      }
      for (const c of controllers) {
        try {
          c.close();
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      for (const c of controllers) {
        try {
          c.error(err);
        } catch {
          /* ignore */
        }
      }
    } finally {
      reader.releaseLock();
    }
  })();
  return outs;
}

export const split: OpDefinition = defineOp({
  type: "core.stream.split",
  title: "core.stream.split",
  description: "Tee/fan-out a stream into `branches` outputs (out.0..n). bufferPolicy: backpressure | { drop }.",
  inputs: { in: stream() },
  outputs: (config: { branches?: number }): Ports =>
    Object.fromEntries(Array.from({ length: config.branches ?? 2 }, (_, i) => [`out.${i}`, stream()])),
  config: z.object({ branches: z.number().int().positive().default(2), bufferPolicy: bufferPolicy.default("backpressure") }),
  execute: (ctx) => {
    const { branches, bufferPolicy: policy } = ctx.config as { branches: number; bufferPolicy: "backpressure" | { drop: number } };
    const outs = broadcast(ctx.input.stream("in"), branches, policy);
    return Object.fromEntries(outs.map((s, i) => [`out.${i}`, s]));
  },
});

export const merge: OpDefinition = defineOp({
  type: "core.stream.merge",
  title: "core.stream.merge",
  description: "Merge N input streams (in.0..n) into one. ordering: interleave | concat.",
  inputs: (config: { inputs?: number }): Ports =>
    Object.fromEntries(Array.from({ length: config.inputs ?? 2 }, (_, i) => [`in.${i}`, stream()])),
  outputs: { out: stream() },
  config: z.object({ inputs: z.number().int().positive().default(2), ordering: z.enum(["interleave", "concat"]).default("interleave") }),
  execute: (ctx) => {
    const { inputs, ordering } = ctx.config as { inputs: number; ordering: "interleave" | "concat" };
    const streams = Array.from({ length: inputs }, (_, i) => ctx.input.stream(`in.${i}`));
    return { out: ordering === "concat" ? concatStreams(streams) : interleaveStreams(streams) };
  },
});

function concatStreams(streams: ReadableStream<unknown>[]): ReadableStream<unknown> {
  return iterableToStream(
    (async function* () {
      for (const s of streams) yield* streamToIterable(s);
    })(),
  );
}

function interleaveStreams(streams: ReadableStream<unknown>[]): ReadableStream<unknown> {
  return new ReadableStream<unknown>({
    start(controller) {
      const readers = streams.map((s) => s.getReader());
      let open = readers.length;
      // Once any branch errors the controller, surviving branches must stop:
      // enqueueing on an errored controller throws, and those throws would
      // escape the void-ed IIFEs as unhandled rejections.
      let errored = false;
      if (open === 0) return controller.close();
      for (const reader of readers) {
        void (async () => {
          try {
            for (;;) {
              const { done, value: v } = await reader.read();
              if (done || errored) break;
              controller.enqueue(v);
            }
          } catch (err) {
            if (!errored) {
              errored = true;
              try {
                controller.error(err);
              } catch {
                /* consumer already cancelled */
              }
            }
          } finally {
            reader.releaseLock();
            if (--open === 0 && !errored) {
              try {
                controller.close();
              } catch {
                /* ignore */
              }
            }
          }
        })();
      }
    },
  });
}

export const accumulate: OpDefinition = defineOp({
  type: "core.stream.accumulate",
  title: "core.stream.accumulate",
  description: "Reduce/collect a stream into a value (BARRIER). mode: array | concat | reduce.",
  inputs: { in: stream() },
  outputs: { out: value() },
  config: z.object({
    mode: z.enum(["array", "concat", "reduce"]).default("array"),
    workflow: subworkflowRef.optional(),
    initial: z.unknown().optional(),
  }),
  execute: async (ctx) => {
    const { mode, workflow, initial } = ctx.config as { mode: string; workflow?: any; initial?: unknown };
    const input = ctx.input.stream("in");
    if (mode === "array") {
      const out: unknown[] = [];
      for await (const chunk of streamToIterable(input)) out.push(chunk);
      return { out };
    }
    if (mode === "concat") {
      let acc: unknown;
      let first = true;
      for await (const chunk of streamToIterable(input)) {
        if (first) {
          acc = Array.isArray(chunk) ? [...chunk] : chunk;
          first = false;
        } else if (typeof acc === "string") acc = acc + String(chunk);
        else if (Array.isArray(acc)) acc = [...acc, ...(Array.isArray(chunk) ? chunk : [chunk])];
        else acc = String(acc) + String(chunk);
      }
      return { out: first ? "" : acc };
    }
    // reduce via sub-workflow ({ acc, item, index } → { value })
    if (!workflow) throw new Error("accumulate mode 'reduce' requires config.workflow");
    let acc = initial;
    let index = 0;
    for await (const item of streamToIterable(input)) {
      const res = await ctx.invoke(workflow, { acc, item, index: index++ });
      acc = "value" in res ? res.value : acc;
    }
    return { out: acc };
  },
});

export const emit: OpDefinition = defineOp({
  type: "core.stream.emit",
  title: "core.stream.emit",
  description: "Value/iterable → stream.",
  inputs: { in: required(z.union([z.array(z.unknown()), z.any()])) },
  outputs: { out: stream() },
  execute: async (ctx) => {
    const v = await ctx.input.value<Iterable<unknown> | AsyncIterable<unknown> | unknown>("in");
    if (v == null) return { out: iterableToStream([]) };
    if (typeof v === "object" && (Symbol.iterator in (v as object) || Symbol.asyncIterator in (v as object))) {
      return { out: iterableToStream(v as Iterable<unknown>) };
    }
    return { out: iterableToStream([v]) };
  },
});

export const map: OpDefinition = defineOp({
  type: "core.stream.map",
  title: "core.stream.map",
  description: "Per-element transform via a sub-workflow ({ item, index } → { value }).",
  inputs: { in: stream() },
  outputs: { out: stream() },
  config: z.object({ workflow: subworkflowRef }),
  execute: (ctx) => {
    const { workflow } = ctx.config as { workflow: any };
    const input = ctx.input.stream("in");
    const out = iterableToStream(
      (async function* () {
        let index = 0;
        for await (const item of streamToIterable(input)) {
          const res = await ctx.invoke(workflow, { item, index: index++ });
          yield "value" in res ? res.value : undefined;
        }
      })(),
    );
    return { out };
  },
});

export const filter: OpDefinition = defineOp({
  type: "core.stream.filter",
  title: "core.stream.filter",
  description: "Keep elements whose sub-workflow returns a truthy { value }.",
  inputs: { in: stream() },
  outputs: { out: stream() },
  config: z.object({ workflow: subworkflowRef }),
  execute: (ctx) => {
    const { workflow } = ctx.config as { workflow: any };
    const input = ctx.input.stream("in");
    const out = iterableToStream(
      (async function* () {
        let index = 0;
        for await (const item of streamToIterable(input)) {
          const res = await ctx.invoke(workflow, { item, index: index++ });
          if ("value" in res ? res.value : false) yield item;
        }
      })(),
    );
    return { out };
  },
});

export const pluck: OpDefinition = defineOp({
  type: "core.stream.pluck",
  title: "core.stream.pluck",
  description:
    "Extract `config.path` (dot/bracket) from each chunk and re-emit as a stream — no sub-workflow. " +
    "Chunks where the path is missing are dropped, so e.g. agent frames like { delta: { text } } become a clean text stream via path 'delta.text'.",
  inputs: { in: stream() },
  outputs: { out: stream() },
  config: z.object({ path: z.string() }),
  execute: (ctx) => {
    const { path } = ctx.config as { path: string };
    const input = ctx.input.stream("in");
    const out = iterableToStream(
      (async function* () {
        for await (const item of streamToIterable(input)) {
          const v = getPath(item, path);
          if (v !== undefined && v !== null) yield v;
        }
      })(),
    );
    return { out };
  },
});

export const template: OpDefinition = defineOp({
  type: "core.stream.template",
  title: "core.stream.template",
  description:
    "Render a string per chunk from `{{ dot.path }}` placeholders over the chunk, and re-emit as a stream — no sub-workflow. " +
    "Great for formatting object chunks (e.g. agent deltas) into display text.",
  inputs: { in: stream() },
  outputs: { out: stream() },
  config: z.object({ template: z.string() }),
  execute: (ctx) => {
    const { template: tpl } = ctx.config as { template: string };
    const input = ctx.input.stream("in");
    const out = iterableToStream(
      (async function* () {
        for await (const item of streamToIterable(input)) yield renderTemplate(tpl, item);
      })(),
    );
    return { out };
  },
});

export const streamOps: OpDefinition[] = [split, merge, accumulate, emit, map, filter, pluck, template];
