import { describe, it, expect } from "vitest";
import { Engine, defineOp, stream, value, z, type Workflow } from "@pattern/core";

async function run(engine: Engine, wf: Workflow, input: Record<string, unknown> = {}) {
  engine.registerWorkflow(wf);
  const res = await engine.run(wf, { input });
  if (res.status === "error") throw res.error;
  return Object.values(res.outputs)[0] ?? {};
}

/** A sub-workflow that doubles `item` → { value }. */
const doubleSub: Workflow = {
  id: "double",
  nodes: [
    { id: "t", op: "boundary.manual", config: { outputs: ["item"] } },
    { id: "two", op: "core.const.number", config: { value: 2 } },
    { id: "mul", op: "core.math.multiply" },
    { id: "out", op: "boundary.return.named", config: { inputs: ["value"] } },
  ],
  edges: [
    { from: { node: "t", port: "item" }, to: { node: "mul", port: "a" } },
    { from: { node: "two", port: "out" }, to: { node: "mul", port: "b" } },
    { from: { node: "mul", port: "out" }, to: { node: "out", port: "value" } },
  ],
};

describe("streams — merge", () => {
  it("concatenates streams in order (concat)", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "merge-concat",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["a", "b"] } },
        { id: "ea", op: "core.stream.emit" },
        { id: "eb", op: "core.stream.emit" },
        { id: "m", op: "core.stream.merge", config: { inputs: 2, ordering: "concat" } },
        { id: "acc", op: "core.stream.accumulate", config: { mode: "array" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "a" }, to: { node: "ea", port: "in" } },
        { from: { node: "t", port: "b" }, to: { node: "eb", port: "in" } },
        { from: { node: "ea", port: "out" }, to: { node: "m", port: "in.0" } },
        { from: { node: "eb", port: "out" }, to: { node: "m", port: "in.1" } },
        { from: { node: "m", port: "out" }, to: { node: "acc", port: "in" } },
        { from: { node: "acc", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    expect(await run(engine, wf, { a: [1, 2], b: [3, 4] })).toEqual({ value: [1, 2, 3, 4] });
  });
});

describe("streams — accumulate modes", () => {
  it("concat mode joins strings", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "acc-concat",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["parts"] } },
        { id: "e", op: "core.stream.emit" },
        { id: "acc", op: "core.stream.accumulate", config: { mode: "concat" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "parts" }, to: { node: "e", port: "in" } },
        { from: { node: "e", port: "out" }, to: { node: "acc", port: "in" } },
        { from: { node: "acc", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    expect(await run(engine, wf, { parts: ["a", "b", "c"] })).toEqual({ value: "abc" });
  });
});

describe("streams — higher-order map via sub-workflow", () => {
  it("maps a stream through a sub-workflow", async () => {
    const engine = new Engine();
    engine.registerWorkflow(doubleSub);
    const wf: Workflow = {
      id: "smap",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["items"] } },
        { id: "e", op: "core.stream.emit" },
        { id: "map", op: "core.stream.map", config: { workflow: { workflowId: "double" } } },
        { id: "acc", op: "core.stream.accumulate", config: { mode: "array" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "items" }, to: { node: "e", port: "in" } },
        { from: { node: "e", port: "out" }, to: { node: "map", port: "in" } },
        { from: { node: "map", port: "out" }, to: { node: "acc", port: "in" } },
        { from: { node: "acc", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    expect(await run(engine, wf, { items: [1, 2, 3] })).toEqual({ value: [2, 4, 6] });
  });
});

describe("streams — split policies", () => {
  it("delivers every item to both branches under backpressure", async () => {
    const engine = new Engine();
    // A slow consumer that awaits between reads, to exercise backpressure.
    engine.registerOp(
      defineOp({
        type: "test.slowsum",
        inputs: { in: stream(z.number()) },
        outputs: { sum: value(z.number()) },
        execute: async (ctx) => {
          const reader = ctx.input.stream<number>("in").getReader();
          let sum = 0;
          for (;;) {
            const { done, value: v } = await reader.read();
            if (done) break;
            await new Promise((r) => setTimeout(r, 1));
            sum += v;
          }
          return { sum };
        },
      }),
    );
    const n = 50;
    const wf: Workflow = {
      id: "bp",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["items"] } },
        { id: "e", op: "core.stream.emit" },
        { id: "sp", op: "core.stream.split", config: { branches: 2, bufferPolicy: "backpressure" } },
        { id: "fast", op: "core.stream.accumulate", config: { mode: "array" } },
        { id: "slow", op: "test.slowsum" },
        { id: "out", op: "boundary.return.named", config: { inputs: ["fast", "slow"] } },
      ],
      edges: [
        { from: { node: "t", port: "items" }, to: { node: "e", port: "in" } },
        { from: { node: "e", port: "out" }, to: { node: "sp", port: "in" } },
        { from: { node: "sp", port: "out.0" }, to: { node: "fast", port: "in" } },
        { from: { node: "sp", port: "out.1" }, to: { node: "slow", port: "in" } },
        { from: { node: "fast", port: "out" }, to: { node: "out", port: "fast" } },
        { from: { node: "slow", port: "sum" }, to: { node: "out", port: "slow" } },
      ],
    };
    const expected = Array.from({ length: n }, (_, i) => i);
    const result = (await run(engine, wf, { items: expected })) as { fast: number[]; slow: number };
    expect(result.fast).toEqual(expected); // fast branch got everything
    expect(result.slow).toEqual(expected.reduce((a, b) => a + b, 0)); // slow branch too — none lost
  });
});

describe("streams — map runs an INLINE sub-workflow per chunk", () => {
  it("accepts a whole workflow in config (no separate deploy) and re-streams results", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "map-inline",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["items"] } },
        { id: "e", op: "core.stream.emit" },
        { id: "m", op: "core.stream.map", config: { workflow: { workflow: doubleSub } } }, // ← inline body
        { id: "acc", op: "core.stream.accumulate", config: { mode: "array" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "items" }, to: { node: "e", port: "in" } },
        { from: { node: "e", port: "out" }, to: { node: "m", port: "in" } },
        { from: { node: "m", port: "out" }, to: { node: "acc", port: "in" } },
        { from: { node: "acc", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    expect(await run(engine, wf, { items: [1, 2, 3] })).toEqual({ value: [2, 4, 6] });
  });
});

describe("streams — pluck / template (lightweight per-chunk, no sub-workflow)", () => {
  it("pluck extracts a dot-path per chunk and drops chunks missing it", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "pluck-demo",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["items"] } },
        { id: "e", op: "core.stream.emit" },
        { id: "p", op: "core.stream.pluck", config: { path: "delta.text" } },
        { id: "acc", op: "core.stream.accumulate", config: { mode: "array" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "items" }, to: { node: "e", port: "in" } },
        { from: { node: "e", port: "out" }, to: { node: "p", port: "in" } },
        { from: { node: "p", port: "out" }, to: { node: "acc", port: "in" } },
        { from: { node: "acc", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    // Agent-like frames: text deltas interleaved with control frames missing the path.
    const items = [{ delta: { text: "Hello" } }, { type: "ping" }, { delta: { text: " World" } }];
    expect(await run(engine, wf, { items })).toEqual({ value: ["Hello", " World"] });
  });

  it("template renders {{path}} per chunk into a string stream", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "tpl-demo",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["items"] } },
        { id: "e", op: "core.stream.emit" },
        { id: "tpl", op: "core.stream.template", config: { template: "{{ i }}:{{ t }}" } },
        { id: "acc", op: "core.stream.accumulate", config: { mode: "concat" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "items" }, to: { node: "e", port: "in" } },
        { from: { node: "e", port: "out" }, to: { node: "tpl", port: "in" } },
        { from: { node: "tpl", port: "out" }, to: { node: "acc", port: "in" } },
        { from: { node: "acc", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    const items = [{ i: 1, t: "a" }, { i: 2, t: "b" }];
    expect(await run(engine, wf, { items })).toEqual({ value: "1:a2:b" });
  });
});
