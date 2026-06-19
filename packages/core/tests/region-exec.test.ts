import { describe, it, expect } from "vitest";
import { Engine, type SpanData, type Workflow } from "../src/index.js";

/**
 * A per-chunk stream region (`each` → value ops → `collect`) runs the interior
 * ops ONCE PER CHUNK, inline in the SAME run: no sub-run, no extra run entry —
 * just N spans per member, tagged with the iteration seq. (This is the whole
 * point: the power of map without the Runs-list noise.)
 */
function wf(interior: Workflow["nodes"], wire: Workflow["edges"]): Workflow {
  return {
    id: "region",
    nodes: [
      { id: "in", op: "boundary.manual", config: { outputs: ["items"] } },
      { id: "emit", op: "core.stream.emit" },
      { id: "each", op: "core.stream.each" },
      ...interior,
      { id: "collect", op: "core.stream.collect" },
      { id: "acc", op: "core.stream.accumulate", config: { mode: "array" } },
      { id: "out", op: "boundary.return" },
    ],
    edges: [
      { from: { node: "in", port: "items" }, to: { node: "emit", port: "in" } },
      { from: { node: "emit", port: "out" }, to: { node: "each", port: "in" } },
      ...wire,
      { from: { node: "collect", port: "out" }, to: { node: "acc", port: "in" } },
      { from: { node: "acc", port: "out" }, to: { node: "out", port: "value" } },
    ],
  };
}

async function run(workflow: Workflow, items: unknown[]) {
  const engine = new Engine();
  const runs: unknown[] = [];
  const spans: SpanData[] = [];
  engine.onTrace({ onRunStart: (r) => runs.push(r), onSpanEnd: (s) => spans.push(s) });
  engine.registerWorkflow(workflow);
  const res = await engine.run(workflow, { input: { items } });
  if (res.status === "error") throw res.error;
  const out = (Object.values(res.outputs)[0] as { value: unknown }).value;
  return { out, runs, spans };
}

describe("per-chunk stream region execution", () => {
  it("transforms each chunk through interior ops and re-streams — one run, no sub-run", async () => {
    const w = wf(
      [
        { id: "get", op: "core.object.get", config: { path: "delta.text" } },
        { id: "up", op: "core.string.upper" },
      ],
      [
        { from: { node: "each", port: "item" }, to: { node: "get", port: "object" } },
        { from: { node: "get", port: "out" }, to: { node: "up", port: "value" } },
        { from: { node: "up", port: "out" }, to: { node: "collect", port: "value" } },
      ],
    );
    const { out, runs, spans } = await run(w, [{ delta: { text: "hello" } }, { delta: { text: "world" } }]);
    expect(out).toEqual(["HELLO", "WORLD"]);

    // EXACTLY ONE run started — the region added spans, not a sub-run.
    expect(runs).toHaveLength(1);
    // Interior members ran once per chunk, tagged with the iteration seq.
    const getSpans = spans.filter((s) => s.attributes["pattern.node.id"] === "get");
    expect(getSpans).toHaveLength(2);
    expect(getSpans.map((s) => s.attributes["pattern.iteration.seq"])).toEqual([0, 1]);
    const upSpans = spans.filter((s) => s.attributes["pattern.node.id"] === "up");
    expect(upSpans).toHaveLength(2);
    // each + collect each get a single marker span.
    expect(spans.filter((s) => s.attributes["pattern.node.id"] === "each")).toHaveLength(1);
    expect(spans.filter((s) => s.attributes["pattern.node.id"] === "collect")).toHaveLength(1);
  });

  it("drops a chunk whose result is undefined (return undefined to filter)", async () => {
    const w = wf(
      [{ id: "get", op: "core.object.get", config: { path: "delta.text" } }],
      [
        { from: { node: "each", port: "item" }, to: { node: "get", port: "object" } },
        { from: { node: "get", port: "out" }, to: { node: "collect", port: "value" } },
      ],
    );
    const { out } = await run(w, [{ delta: { text: "a" } }, { type: "ping" }, { delta: { text: "b" } }]);
    expect(out).toEqual(["a", "b"]); // the ping frame (no delta.text) was dropped
  });

  it("captures an outside value into every iteration (computed once)", async () => {
    const w: Workflow = {
      id: "cap",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["items"] } },
        { id: "emit", op: "core.stream.emit" },
        { id: "k", op: "core.const.number", config: { value: 10 } },
        { id: "each", op: "core.stream.each" },
        { id: "add", op: "core.math.add" },
        { id: "collect", op: "core.stream.collect" },
        { id: "acc", op: "core.stream.accumulate", config: { mode: "array" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "items" }, to: { node: "emit", port: "in" } },
        { from: { node: "emit", port: "out" }, to: { node: "each", port: "in" } },
        { from: { node: "each", port: "item" }, to: { node: "add", port: "a" } },
        { from: { node: "k", port: "out" }, to: { node: "add", port: "b" } }, // capture (once)
        { from: { node: "add", port: "out" }, to: { node: "collect", port: "value" } },
        { from: { node: "collect", port: "out" }, to: { node: "acc", port: "in" } },
        { from: { node: "acc", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    const { out, runs } = await run(w, [1, 2]);
    expect(out).toEqual([11, 12]);
    expect(runs).toHaveLength(1);
  });

  it("skips a chunk by predicate with core.value.keep (no branch op)", async () => {
    const w: Workflow = {
      id: "skip",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["items"] } },
        { id: "emit", op: "core.stream.emit" },
        { id: "two", op: "core.const.number", config: { value: 2 } },
        { id: "each", op: "core.stream.each" },
        { id: "gt", op: "core.cmp.gt" }, // item > 2 ?
        { id: "keep", op: "core.value.keep" }, // keep item only when gt
        { id: "collect", op: "core.stream.collect" },
        { id: "acc", op: "core.stream.accumulate", config: { mode: "array" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "items" }, to: { node: "emit", port: "in" } },
        { from: { node: "emit", port: "out" }, to: { node: "each", port: "in" } },
        { from: { node: "each", port: "item" }, to: { node: "gt", port: "a" } },
        { from: { node: "two", port: "out" }, to: { node: "gt", port: "b" } }, // capture
        { from: { node: "gt", port: "out" }, to: { node: "keep", port: "when" } },
        { from: { node: "each", port: "item" }, to: { node: "keep", port: "value" } },
        { from: { node: "keep", port: "out" }, to: { node: "collect", port: "value" } },
        { from: { node: "collect", port: "out" }, to: { node: "acc", port: "in" } },
        { from: { node: "acc", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    const { out, runs } = await run(w, [1, 2, 3, 4]);
    expect(out).toEqual([3, 4]); // 1 and 2 skipped (kept value was undefined ⇒ dropped)
    expect(runs).toHaveLength(1); // still one run, no branch/sub-run
  });
});
