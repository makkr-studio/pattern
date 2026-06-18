import { describe, it, expect } from "vitest";
import { Engine, type SpanData, type Workflow } from "../src/index.js";

/**
 * With I/O sampling on, a stream-producing node records bounded, masked
 * `stream.chunk` span events with per-chunk offsets — the data replay scrubs
 * through token-by-token. Off by default; capped for long streams.
 */
function spansOf(items: unknown[], sampleIo: boolean): Promise<SpanData[]> {
  const spans: SpanData[] = [];
  const engine = new Engine();
  engine.onTrace({ onSpanEnd: (s) => spans.push(s) });
  const wf: Workflow = {
    id: "emit-drain",
    nodes: [
      { id: "in", op: "boundary.manual", config: { outputs: ["items"] } },
      { id: "emit", op: "core.stream.emit" },
      { id: "acc", op: "core.stream.accumulate", config: { mode: "array" } },
      { id: "out", op: "boundary.return" },
    ],
    edges: [
      { from: { node: "in", port: "items" }, to: { node: "emit", port: "in" } },
      { from: { node: "emit", port: "out" }, to: { node: "acc", port: "in" } },
      { from: { node: "acc", port: "out" }, to: { node: "out", port: "value" } },
    ],
  };
  engine.registerWorkflow(wf);
  return engine.run(wf, { input: { items }, sampleIo }).then(() => spans);
}

const chunkEvents = (spans: SpanData[]) =>
  spans.find((s) => s.attributes["pattern.node.id"] === "emit")?.events?.filter((e) => e.name === "stream.chunk") ?? [];

describe("replay: per-chunk stream events", () => {
  it("records a masked, ordered stream.chunk event per chunk when sampling is on", async () => {
    const spans = await spansOf(["alpha", "beta", "gamma"], true);
    const evs = chunkEvents(spans);
    expect(evs).toHaveLength(3);
    expect(evs.map((e) => e.attributes?.seq)).toEqual([0, 1, 2]);
    expect(evs.map((e) => e.attributes?.preview)).toEqual(["alpha", "beta", "gamma"]);
    expect(evs.map((e) => e.attributes?.port)).toEqual(["out", "out", "out"]);
    // Each event is timestamped (high-res epoch ms) so replay can place it.
    expect(evs.every((e) => typeof e.time === "number")).toBe(true);
  });

  it("records nothing when sampling is off", async () => {
    const spans = await spansOf(["a", "b", "c"], false);
    expect(chunkEvents(spans)).toHaveLength(0);
  });

  it("caps long streams at 64 events + a 'capped' marker", async () => {
    const items = Array.from({ length: 200 }, (_, i) => `t${i}`);
    const spans = await spansOf(items, true);
    const emit = spans.find((s) => s.attributes["pattern.node.id"] === "emit")!;
    expect(chunkEvents(spans)).toHaveLength(64);
    expect((emit.events ?? []).some((e) => e.name === "stream.chunk.capped")).toBe(true);
  });
});
