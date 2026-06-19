import { describe, it, expect } from "vitest";
import { Engine, type OpDefinition, type SpanData, type TraceSink, type Workflow } from "../src/index.js";
import { stream, value } from "../src/ops-core/helpers.js";

/**
 * The make-or-break for SELECTABLE pipelines (the chat turn-pipeline feature):
 * a sub-workflow whose out-gate carries a STREAM port can be run via `ctx.invoke`
 * and the parent consumes that stream LIVE — invoke returns at the child's
 * result-ready (the stream attached, not yet drained), so the parent drives it.
 *
 * No built-in op returns an invoked stream today, so we register two throwaway
 * ops to exercise the path: a stream out-gate (passes its stream port through
 * like the generic `outgate()` helper) and a delegator (invoke → re-expose the
 * child's `events` stream as its own output). If this round-trips, the chat
 * endpoint can invoke a chosen turn pipeline and fan its events to SSE + sink.
 */

/** Out-gate carrying a live stream (mirrors core's internal `outgate()` helper). */
const streamReturn: OpDefinition = {
  type: "test.return.stream",
  title: "test.return.stream",
  description: "Out-gate that returns its `events` stream input live.",
  boundary: "outgate",
  pair: "boundary.manual",
  inputs: { events: stream() },
  outputs: {},
  execute: async (ctx) => ({ events: ctx.input.has("events") ? ctx.input.stream("events") : undefined }),
};

/** Invoke a sub-workflow and re-expose its out-gate `events` stream as our own. */
const delegate: OpDefinition = {
  type: "test.invoke.stream",
  title: "test.invoke.stream",
  description: "Runs config.workflow via ctx.invoke and streams back its `events`.",
  inputs: { items: value() },
  outputs: { events: stream() },
  config: undefined,
  execute: async (ctx) => {
    const { workflow } = ctx.config as { workflow: { workflowId: string } };
    const items = await ctx.input.value("items");
    const r = await ctx.invoke(workflow, { items });
    return { events: r.events as ReadableStream };
  },
};

/** child: items → emit → stream out-gate(events). */
const child: Workflow = {
  id: "stream-child",
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["items"] } },
    { id: "emit", op: "core.stream.emit" },
    { id: "out", op: "test.return.stream" },
  ],
  edges: [
    { from: { node: "in", port: "items" }, to: { node: "emit", port: "in" } },
    { from: { node: "emit", port: "out" }, to: { node: "out", port: "events" } },
  ],
};

/** parent: items → delegate(invoke child) → accumulate(array) → return. */
const parent: Workflow = {
  id: "stream-parent",
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["items"] } },
    { id: "call", op: "test.invoke.stream", config: { workflow: { workflowId: "stream-child" } } },
    { id: "acc", op: "core.stream.accumulate", config: { mode: "array" } },
    { id: "out", op: "boundary.return" },
  ],
  edges: [
    { from: { node: "in", port: "items" }, to: { node: "call", port: "items" } },
    { from: { node: "call", port: "events" }, to: { node: "acc", port: "in" } },
    { from: { node: "acc", port: "out" }, to: { node: "out", port: "value" } },
  ],
};

function collectingSink() {
  const starts: Array<Parameters<NonNullable<TraceSink["onRunStart"]>>[0]> = [];
  const spans: SpanData[] = [];
  const sink: TraceSink = { onRunStart: (r) => starts.push(r), onSpanEnd: (s) => spans.push(s) };
  return { sink, starts, spans };
}

describe("stream across ctx.invoke", () => {
  it("a sub-workflow's out-gate stream survives invoke and drains in the parent", async () => {
    const engine = new Engine();
    engine.registerOp(streamReturn).registerOp(delegate);
    engine.registerWorkflow(child);
    engine.registerWorkflow(parent);

    const res = await engine.run("stream-parent", { input: { items: ["a", "b", "c", "d"] } });
    expect(res.status).toBe("ok");
    const out = (Object.values(res.outputs)[0] as { value: unknown }).value;
    expect(out).toEqual(["a", "b", "c", "d"]);
  });

  it("the invoked pipeline is its own (sub-)run — one extra run entry per delegation", async () => {
    const engine = new Engine();
    const { sink, starts } = collectingSink();
    engine.onTrace(sink);
    engine.registerOp(streamReturn).registerOp(delegate);
    engine.registerWorkflow(child);
    engine.registerWorkflow(parent);

    await engine.run("stream-parent", { input: { items: [1, 2, 3] } });
    const parentStart = starts.find((s) => s.workflowId === "stream-parent")!;
    const childStart = starts.find((s) => s.workflowId === "stream-child")!;
    expect(childStart).toBeDefined();
    expect(childStart.runId).not.toBe(parentStart.runId);
    expect(childStart.parent).toMatchObject({ runId: parentStart.runId, nodeId: "call" });
  });
});
