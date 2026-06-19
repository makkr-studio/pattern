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

  it("captures a long stream in FULL under the byte budget (no flat 64 cap)", async () => {
    // 200 small tokens are far under the 256 KB budget → every one recorded.
    const items = Array.from({ length: 200 }, (_, i) => `t${i}`);
    const spans = await spansOf(items, true);
    const emit = spans.find((s) => s.attributes["pattern.node.id"] === "emit")!;
    expect(chunkEvents(spans)).toHaveLength(200);
    expect(emit.events?.some((e) => e.name === "stream.chunk.capped")).toBe(false);
  });

  it("clips each chunk to a tight glimpse (binary/huge tokens stay bounded)", async () => {
    const big = "x".repeat(5000);
    const spans = await spansOf([big], true);
    const [ev] = chunkEvents(spans);
    expect(ev?.attributes?.truncated).toBe(true);
    expect(String(ev?.attributes?.preview).length).toBeLessThan(300); // ~256 + ellipsis
  });

  it("downsamples past the budget instead of cutting off — coverage spans the stream", async () => {
    // Each ~300-char token costs a 256 B glimpse; >1024 of them exceeds 256 KB.
    const items = Array.from({ length: 1100 }, (_, i) => `${i}`.padEnd(300, "."));
    const spans = await spansOf(items, true);
    const emit = spans.find((s) => s.attributes["pattern.node.id"] === "emit")!;
    const evs = chunkEvents(spans);
    expect(evs.length).toBeGreaterThan(64); // well past the old cap
    expect(evs.length).toBeLessThan(items.length); // but bounded — tail downsampled
    expect(emit.events?.some((e) => e.name === "stream.chunk.capped")).toBe(true);
    expect(evs.some((e) => e.attributes?.sampled === true)).toBe(true); // downsampled chunks flagged
    // A late chunk is still represented (coverage didn't stop at the budget).
    expect(Number(evs[evs.length - 1]!.attributes?.seq)).toBeGreaterThan(1024);
  });

  it("emits a `started` event and an `output` event per value port", async () => {
    const spans = await spansOf(["a"], true);
    const acc = spans.find((s) => s.attributes["pattern.node.id"] === "acc")!;
    const started = acc.events?.find((e) => e.name === "started");
    expect(started).toBeDefined();
    expect(typeof started!.time).toBe("number");
    expect(typeof started!.attributes?.blockedMs).toBe("number");
    // The accumulator's value output fired exactly once on its `out` port.
    const outs = (acc.events ?? []).filter((e) => e.name === "output");
    expect(outs).toHaveLength(1);
    expect(outs[0]!.attributes?.port).toBe("out");
  });
});
