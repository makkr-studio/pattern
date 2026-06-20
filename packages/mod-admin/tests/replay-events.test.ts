import { describe, it, expect } from "vitest";
import type { SpanData } from "@pattern-js/admin-sdk";
import { buildReplayEvents, stateAt, stepBack, stepForward } from "../src/app/lib/replay.js";

/**
 * Replay steps an ordered EVENT LOG, not a reconstruction from [start,end] bars.
 * The properties Benoit hit: stepping is symmetric (forward-N then back-N returns
 * home), one transition per step, and "running" is actually reachable.
 */
function span(node: string, start: number, end: number, events: SpanData["events"] = [], status: SpanData["status"] = "ok"): SpanData {
  return {
    traceId: "t",
    spanId: node,
    name: node,
    startTime: start,
    endTime: end,
    attributes: { "pattern.node.id": node },
    status,
    events,
  };
}

describe("replay event log", () => {
  // t0 = 100. node A: started@110 (blocked 10), one value output@120, ended@130.
  // node B: a streaming producer — started@115, chunks@140/160/180, ended@200.
  const spans: SpanData[] = [
    span("A", 100, 130, [
      { name: "started", time: 110, attributes: { blockedMs: 10 } },
      { name: "output", time: 120, attributes: { port: "out" } },
    ]),
    span("B", 100, 200, [
      { name: "started", time: 115, attributes: { blockedMs: 15 } },
      { name: "stream.chunk", time: 140, attributes: { port: "tok", seq: 0, preview: "he" } },
      { name: "stream.chunk", time: 160, attributes: { port: "tok", seq: 1, preview: "llo" } },
      { name: "stream.chunk", time: 180, attributes: { port: "tok", seq: 2, preview: "!" } },
    ]),
  ];
  const t0 = 100;
  const events = buildReplayEvents(spans, t0);
  const total = 100; // 200 - t0

  it("flattens started / output / chunk / ended into a time-sorted log", () => {
    expect(events.map((e) => `${e.kind}:${e.node}${e.port ? "." + e.port : ""}@${e.at}`)).toEqual([
      "started:A@10",
      "started:B@15",
      "output:A.out@20",
      "ended:A@30",
      "chunk:B.tok@40",
      "chunk:B.tok@60",
      "chunk:B.tok@80",
      "ended:B@100",
    ]);
  });

  it("steps symmetrically — forward N then back N returns home", () => {
    let t = 0;
    const forward: number[] = [];
    for (let i = 0; i < events.length; i++) forward.push((t = stepForward(events, t, total)));
    // Walked every distinct instant up to the end.
    expect(forward).toEqual([10, 15, 20, 30, 40, 60, 80, 100]);
    const back: number[] = [];
    for (let i = 0; i < events.length; i++) back.push((t = stepBack(events, t)));
    // Mirror image, landing back at 0.
    expect(back).toEqual([80, 60, 40, 30, 20, 15, 10, 0]);
  });

  it("each forward step advances exactly one instant (no multi-jump)", () => {
    const instants = [...new Set(events.map((e) => e.at))].sort((a, b) => a - b);
    let t = 0;
    for (const want of instants) expect((t = stepForward(events, t, total))).toBe(want);
  });

  it("a node is observably 'running' between its started and ended ticks", () => {
    // Step onto A's started instant (t0+10) → A is running, B not yet started.
    expect(stateAt(spans[0]!, t0 + 10)).toBe("running");
    expect(stateAt(spans[1]!, t0 + 10)).toBe("pending");
    // Past A's end, B mid-stream.
    expect(stateAt(spans[0]!, t0 + 50)).toBe("ok");
    expect(stateAt(spans[1]!, t0 + 50)).toBe("running");
  });

  it("falls back to the blockedMs heuristic for spans without a started event", () => {
    const legacy = span("L", 100, 130, [], "ok");
    legacy.attributes["pattern.node.blockedMs"] = 8;
    expect(stateAt(legacy, 105)).toBe("pending"); // before 100+8
    expect(stateAt(legacy, 120)).toBe("running");
  });
});
