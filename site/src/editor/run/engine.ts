import { useEffect, useRef, useState } from "react";
import type { MiniGraph, ReplayState } from "../../graph/types";

const DEPTH_STEP = 650;
const NODE_DUR = 480;
const STREAM_DUR = 2600;
const TAIL = 500;

/** Longest-path depth per node (the DAG is acyclic by construction). */
function depths(goal: MiniGraph): Map<string, number> {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of goal.nodes) indeg.set(n.id, 0);
  for (const e of goal.edges) {
    indeg.set(e.to.node, (indeg.get(e.to.node) ?? 0) + 1);
    (adj.get(e.from.node) ?? adj.set(e.from.node, []).get(e.from.node)!).push(e.to.node);
  }
  const depth = new Map<string, number>();
  const q = goal.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  for (const id of q) depth.set(id, 0);
  while (q.length) {
    const u = q.shift()!;
    for (const v of adj.get(u) ?? []) {
      depth.set(v, Math.max(depth.get(v) ?? 0, (depth.get(u) ?? 0) + 1));
      indeg.set(v, (indeg.get(v) ?? 0) - 1);
      if ((indeg.get(v) ?? 0) === 0) q.push(v);
    }
  }
  for (const n of goal.nodes) if (!depth.has(n.id)) depth.set(n.id, 0);
  return depth;
}

export interface Timeline {
  run: Map<string, number>;
  ok: Map<string, number>;
  edgeLit: Map<string, number>;
  streamEdge?: { id: string; start: number; end: number };
  total: number;
}

function buildTimeline(goal: MiniGraph): Timeline {
  const d = depths(goal);
  const run = new Map<string, number>();
  const ok = new Map<string, number>();
  const streamSpec = goal.edges.find((e) => e.kind === "stream");

  for (const n of goal.nodes) {
    const t = (d.get(n.id) ?? 0) * DEPTH_STEP;
    run.set(n.id, t);
    // The stream source streams for a while before completing.
    const isStreamSource = streamSpec?.from.node === n.id;
    ok.set(n.id, t + (isStreamSource ? STREAM_DUR : NODE_DUR));
  }

  const edgeLit = new Map<string, number>();
  let streamEdge: Timeline["streamEdge"];
  for (const e of goal.edges) {
    if (e.kind === "stream") {
      const start = (run.get(e.from.node) ?? 0) + 300;
      const end = ok.get(e.from.node) ?? start + STREAM_DUR;
      edgeLit.set(e.id, start);
      streamEdge = { id: e.id, start, end };
      // The stream's target finishes when the stream ends.
      run.set(e.to.node, Math.max(run.get(e.to.node) ?? 0, start));
      ok.set(e.to.node, Math.max(ok.get(e.to.node) ?? 0, end + 250));
    } else {
      edgeLit.set(e.id, ok.get(e.from.node) ?? 0);
    }
  }

  const total = Math.max(0, ...[...ok.values()]) + TAIL;
  return { run, ok, edgeLit, streamEdge, total };
}

export interface RunState {
  phase: "idle" | "running" | "done";
  nodeState: Record<string, ReplayState>;
  edgeLit: Record<string, boolean>;
  streamFlowing: boolean;
  streamProgress: number; // 0..1 across the streaming window
}

/**
 * Plays a faked run over the goal graph: nodes go pending → running → ok, edges
 * illuminate as their source completes, and the stream edge flows for a window.
 * Re-runs whenever `runKey` increments (0 = idle). Calls `onDone` once per run.
 */
export function useFakeRun(goal: MiniGraph, runKey: number, onDone: () => void): RunState {
  const [state, setState] = useState<RunState>({ phase: "idle", nodeState: {}, edgeLit: {}, streamFlowing: false, streamProgress: 0 });
  const raf = useRef(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (runKey === 0) {
      setState({ phase: "idle", nodeState: {}, edgeLit: {}, streamFlowing: false, streamProgress: 0 });
      return;
    }
    const tl = buildTimeline(goal);
    const start = performance.now();
    let finished = false;

    const tick = () => {
      const t = performance.now() - start;
      const nodeState: Record<string, ReplayState> = {};
      for (const n of goal.nodes) {
        const okAt = tl.ok.get(n.id) ?? 0;
        const runAt = tl.run.get(n.id) ?? 0;
        nodeState[n.id] = t >= okAt ? "ok" : t >= runAt ? "running" : "pending";
      }
      const edgeLit: Record<string, boolean> = {};
      for (const [id, at] of tl.edgeLit) edgeLit[id] = t >= at;

      let streamFlowing = false;
      let streamProgress = 0;
      if (tl.streamEdge) {
        const { start: s, end: e } = tl.streamEdge;
        if (t >= s && t < e) {
          streamFlowing = true;
          streamProgress = (t - s) / (e - s);
        } else if (t >= e) {
          streamProgress = 1;
        }
      }

      const phase: RunState["phase"] = t >= tl.total ? "done" : "running";
      setState({ phase, nodeState, edgeLit, streamFlowing, streamProgress });

      if (t >= tl.total) {
        if (!finished) {
          finished = true;
          doneRef.current();
        }
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [goal, runKey]);

  return state;
}
