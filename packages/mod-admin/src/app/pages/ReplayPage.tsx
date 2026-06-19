import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ReactFlow, Background, Controls, ReactFlowProvider, type Edge as RFEdge } from "@xyflow/react";
import type { SpanData } from "@pattern/admin-sdk";
import { useOps, useRun, useWorkflow } from "../lib/queries";
import { buildFlow, type OpMap, type ReplayState } from "../editor/graph";
import { OpNode } from "../editor/OpNode";
import { FrameNode } from "../editor/FrameNode";
import { PortalEdge } from "../editor/PortalEdge";
import { Badge, GlassPanel, JsonView, NeonButton, PageHeader, Spinner } from "../components/ui";
import { ms, statusColor } from "../lib/format";
import { Pause, Play, SkipBack, SkipForward } from "../components/icon";
import {
  buildReplayEvents,
  nodeIdOf,
  nodeStateAt,
  spanAt,
  stepBack as stepBackTo,
  stepForward as stepForwardTo,
  type ReplayEvent,
  type ReplayEventKind,
} from "../lib/replay";

const nodeTypes = { op: OpNode, frame: FrameNode };
const edgeTypes = { portal: PortalEdge };
const SPEEDS = [0.5, 1, 2, 4] as const;

const TICK_COLOR: Record<ReplayEventKind, string> = {
  started: "var(--color-neon-cyan)",
  output: "var(--color-port-value)",
  chunk: "var(--color-port-stream)",
  ended: "var(--color-neon-lime)",
  skipped: "var(--color-port-control)",
};

/** A compact, inline glimpse of whatever happened at this event. */
function peekText(e: ReplayEvent, ioOf: (node: string, port: string) => unknown): string {
  if (e.kind === "chunk") return typeof e.preview === "string" ? e.preview : JSON.stringify(e.preview);
  if (e.kind === "output") {
    const v = ioOf(e.node, e.port ?? "");
    return v === undefined ? "(value passed)" : typeof v === "string" ? v : JSON.stringify(v);
  }
  if (e.kind === "started") return "started working";
  return e.status ?? "done";
}

/**
 * Run replay on the graph canvas (mod-admin-spec §15.1). The timeline is an
 * ordered EVENT LOG — each node's started / per-output / per-stream-chunk /
 * ended moment — not a reconstruction from [start,end] bars. The scrubber steps
 * event-to-event (symmetric forward/back, one transition per step) over a
 * real-time track ticked at every event; nodes transition pending→running→
 * ok|error|skipped and edges illuminate as data flows. Hover an edge to see the
 * value (or current token) that crossed it.
 */
export function ReplayPage() {
  const { runId } = useParams();
  const { data: run, isLoading: runLoading } = useRun(runId);
  const { data: wfData, isLoading: wfLoading } = useWorkflow(run?.summary.workflowId);
  const { data: opsData } = useOps();
  const opMap: OpMap = useMemo(() => new Map((opsData ?? []).map((o) => [o.type, o])), [opsData]);

  // Timeline bounds from node spans.
  const nodeSpans = useMemo(() => (run?.spans ?? []).filter((s) => nodeIdOf(s)), [run]);
  // One node id can have MANY spans (a per-chunk region runs a member per chunk).
  const spansByNode = useMemo(() => {
    const m = new Map<string, SpanData[]>();
    for (const s of nodeSpans) {
      const id = nodeIdOf(s)!;
      (m.get(id) ?? m.set(id, []).get(id)!).push(s);
    }
    return m;
  }, [nodeSpans]);
  const t0 = useMemo(() => (nodeSpans.length ? Math.min(...nodeSpans.map((s) => s.startTime)) : 0), [nodeSpans]);
  const t1 = useMemo(() => (nodeSpans.length ? Math.max(...nodeSpans.map((s) => s.endTime)) : 0), [nodeSpans]);
  const total = Math.max(0, t1 - t0);

  // The event log: every span's lifecycle moments, flattened + time-sorted. The
  // single source of discrete scrubber positions (see lib/replay).
  const events = useMemo(() => buildReplayEvents(nodeSpans, t0), [nodeSpans, t0]);

  const chunks = useMemo(() => events.filter((e) => e.kind === "chunk"), [events]);

  const [t, setT] = useState(0); // offset from t0, ms

  // The event the scrubber is currently on (last at ≤ t) — drives the peek.
  const current = useMemo(() => {
    let hit: ReplayEvent | null = null;
    for (const e of events) {
      if (e.at <= t) hit = e;
      else break;
    }
    return hit;
  }, [events, t]);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const raf = useRef<number>(0);
  const lastTick = useRef<number>(0);

  // Playback: advance with wall-clock dt × speed; pause at the end.
  useEffect(() => {
    if (!playing) return;
    lastTick.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTick.current) * speed;
      lastTick.current = now;
      setT((cur) => {
        const next = cur + dt;
        if (next >= total) {
          setPlaying(false);
          return total;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed, total]);

  // Stepping = move one event in the log. Symmetric by construction: forward
  // lands on the first event strictly after the cursor, back on the last one
  // strictly before — N forward then N back returns home. Same-instant events
  // are one stop (strict inequality skips the cluster together).
  const stepForward = () => {
    setPlaying(false);
    setT((cur) => stepForwardTo(events, cur, total));
  };
  const stepBack = () => {
    setPlaying(false);
    setT((cur) => stepBackTo(events, cur));
  };

  // Ticks rendered over the track (downsampled for pathological streams; the
  // step buttons still traverse the full event list).
  const ticks = useMemo(() => {
    if (total <= 0) return [] as ReplayEvent[];
    const stride = events.length > 400 ? Math.ceil(events.length / 400) : 1;
    return events.filter((_, i) => i % stride === 0);
  }, [events, total]);

  const doc = wfData?.liveDoc;
  const flow = useMemo(() => (doc && opMap.size ? buildFlow(doc, opMap) : null), [doc, opMap]);

  // Replay states are DISCRETE — they only change when the scrubber crosses a
  // span boundary. Key the decoration on that signature, not on raw `t`:
  // handing React Flow a brand-new nodes array every animation frame keeps its
  // nodes perpetually "unmeasured" (= hidden), blanking the canvas during play.
  const stateSig = useMemo(() => {
    const now = t0 + t;
    return [...spansByNode.entries()].map(([id, spans]) => `${id}:${nodeStateAt(spans, now)}`).join("|");
  }, [spansByNode, t, t0]);

  // Decorate the static flow with per-node replay state + edge illumination.
  const decorated = useMemo(() => {
    if (!flow) return null;
    const spanState = new Map<string, ReplayState>();
    for (const part of stateSig ? stateSig.split("|") : []) {
      const i = part.lastIndexOf(":");
      spanState.set(part.slice(0, i), part.slice(i + 1) as ReplayState);
    }
    // Triggers never execute (the engine seeds their outputs), so they have no
    // span — but the run existing means they fired: show them ok from t0.
    const stateByNode = new Map<string, ReplayState>(
      flow.nodes.map((n) => [n.id, spanState.get(n.id) ?? (n.data.boundary === "trigger" ? "ok" : "pending")]),
    );
    const nodes = flow.nodes.map((n) => ({
      ...n,
      data: { ...n.data, replay: stateByNode.get(n.id) },
    }));
    const edges = flow.edges.map((e) => {
      const srcState = stateByNode.get(e.source);
      const lit = srcState === "ok" || srcState === "error";
      return {
        ...e,
        animated: lit && stateByNode.get(e.target) === "running",
        style: { ...e.style, opacity: lit ? 1 : 0.25 },
      };
    });
    return { nodes, edges };
  }, [flow, stateSig]);

  // Edge hover — the value (or current token) that crossed this edge.
  const [hover, setHover] = useState<{ x: number; y: number; edge: RFEdge } | null>(null);
  const ioOf = (node: string, port: string): unknown => {
    const io = spanAt(spansByNode.get(node), t0 + t)?.io?.outputs?.[port];
    return io?.kind === "value" ? io.preview : undefined;
  };

  if (runLoading || wfLoading) return <Spinner />;
  if (!run || !runId) {
    return <GlassPanel className="text-muted p-8 text-sm">Run not found (it may have been evicted from the ring buffer).</GlassPanel>;
  }
  if (!decorated) {
    return (
      <GlassPanel className="text-muted p-8 text-sm">
        The workflow "{run.summary.workflowId}" isn't in the catalog (draft runs replay only as a waterfall).{" "}
        <Link className="underline" to={`/runs/${runId}`}>
          Back to the run
        </Link>
        .
      </GlassPanel>
    );
  }

  const seen = events.filter((e) => e.at <= t).length;

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <PageHeader
        title={`Replay · ${run.summary.workflowId}`}
        subtitle="Scrub the run event-by-event — nodes light up as they execute; hover an edge to see what flowed through it."
        actions={
          <div className="flex items-center gap-2">
            <Badge hue={run.summary.status === "error" ? 340 : 150}>{run.summary.status}</Badge>
            <Link to={`/runs/${runId}`} className="text-muted text-xs underline">
              waterfall view
            </Link>
          </div>
        }
      />

      <GlassPanel className="min-h-0 flex-1 overflow-hidden">
        <ReactFlowProvider>
          <ReactFlow
            className="replay-canvas"
            nodes={decorated.nodes}
            edges={decorated.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            onEdgeMouseEnter={(ev, edge) => setHover({ x: ev.clientX, y: ev.clientY, edge })}
            onEdgeMouseMove={(ev, edge) => setHover({ x: ev.clientX, y: ev.clientY, edge })}
            onEdgeMouseLeave={() => setHover(null)}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={22} size={1.6} color="var(--canvas-dot)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </GlassPanel>

      {/* Live data peek — the event the scrubber sits on (stream token, value,
          or a node transition). Turns replay from node-by-node into atom-by-atom. */}
      {events.length > 0 && (
        <GlassPanel className="mt-3 flex items-center gap-3 px-4 py-2 text-xs">
          <span className="shrink-0 font-semibold uppercase tracking-wider" style={{ color: current ? TICK_COLOR[current.kind] : "var(--color-port-control)" }}>
            {current?.kind ?? "event"}
          </span>
          {current ? (
            <>
              <span className="font-mono text-[var(--color-port-stream)]" title="node · port">
                {current.node}
                {current.port ? `.${current.port}` : ""}
              </span>
              {current.kind === "chunk" && <span className="text-muted shrink-0">#{current.seq}</span>}
              <span className="min-w-0 flex-1 truncate font-mono" title={peekText(current, ioOf)}>
                {peekText(current, ioOf)}
              </span>
              {current.truncated && <span className="text-muted shrink-0 text-[10px]">(glimpse)</span>}
              {current.sampled && <span className="text-muted shrink-0 text-[10px]">(downsampled)</span>}
            </>
          ) : (
            <span className="text-muted">scrub forward to step through {events.length} events…</span>
          )}
          <span className="text-muted ml-auto shrink-0 tabular-nums">
            {seen}/{events.length}
            {chunks.length > 0 ? ` · ${chunks.filter((c) => c.at <= t).length}/${chunks.length} chunks` : ""}
          </span>
        </GlassPanel>
      )}

      {/* Transport bar */}
      <GlassPanel className="mt-3 flex items-center gap-3 px-4 py-3">
        <NeonButton variant="ghost" className="!px-2 !py-1.5" aria-label="Previous event" title="Step back — previous event" onClick={stepBack}>
          <SkipBack size={14} />
        </NeonButton>
        <NeonButton
          variant="ghost"
          className="!px-2 !py-1.5"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          onClick={() => {
            if (!playing && t >= total) setT(0); // replay from the top
            setPlaying((p) => !p);
          }}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </NeonButton>
        <NeonButton variant="ghost" className="!px-2 !py-1.5" aria-label="Next event" title="Step forward — next event" onClick={stepForward}>
          <SkipForward size={14} />
        </NeonButton>

        {/* Real-time track with a tick per event (the step targets). */}
        <div className="flex-1">
          <div className="relative mb-1 h-2">
            {ticks.map((e, i) => (
              <span
                key={i}
                className="absolute top-0 h-2 w-px opacity-70"
                style={{ left: `${total > 0 ? (e.at / total) * 100 : 0}%`, background: TICK_COLOR[e.kind] }}
              />
            ))}
            {total > 0 && (
              <span className="absolute top-0 h-2 w-0.5 bg-white" style={{ left: `${(Math.min(t, total) / total) * 100}%` }} />
            )}
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(1, total)}
            step={total > 100 ? 1 : 0.01}
            value={Math.min(t, total)}
            onChange={(e) => {
              setPlaying(false);
              setT(Number(e.target.value));
            }}
            aria-label="Replay position"
            className="w-full accent-[var(--color-neon-cyan)]"
          />
        </div>

        <span className="text-muted w-28 text-right font-mono text-xs">
          {ms(t)} / {ms(total)}
        </span>

        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className={`rounded px-1.5 py-0.5 text-[10px] ${speed === s ? "bg-[var(--color-neon-cyan)] text-black" : "text-muted hover:bg-white/5"}`}
            >
              {s}×
            </button>
          ))}
        </div>

        {/* Legend */}
        <div className="text-muted hidden items-center gap-3 text-[10px] lg:flex">
          {(["running", "ok", "error", "skipped"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: statusColor(s) }} />
              {s}
            </span>
          ))}
        </div>
      </GlassPanel>

      {hover && <EdgeHoverCard hover={hover} spansByNode={spansByNode} t0={t0} chunks={chunks} t={t} />}
    </div>
  );
}

/** Floating peek of the value/token that crossed the hovered edge. */
function EdgeHoverCard({
  hover,
  spansByNode,
  t0,
  chunks,
  t,
}: {
  hover: { x: number; y: number; edge: RFEdge };
  spansByNode: Map<string, SpanData[]>;
  t0: number;
  chunks: ReplayEvent[];
  t: number;
}) {
  const { edge } = hover;
  const node = edge.source;
  const port = edge.sourceHandle ?? "";
  const kind = (edge.data as { kind?: string } | undefined)?.kind;
  const span = spanAt(spansByNode.get(node), t0 + t);

  let body: React.ReactNode;
  if (kind === "control") {
    body = <span className="text-muted">control pulse</span>;
  } else if (kind === "stream") {
    let last: ReplayEvent | undefined;
    let count = 0;
    for (const c of chunks) {
      if (c.node !== node || c.port !== port) continue;
      count++;
      if (c.at <= t) last = c;
    }
    body = last ? (
      <>
        <div className="text-muted mb-1 text-[10px]">
          token #{last.seq} of {count}
          {last.truncated ? " · glimpse" : ""}
        </div>
        <div className="font-mono break-words">{typeof last.preview === "string" ? last.preview : JSON.stringify(last.preview)}</div>
      </>
    ) : count > 0 ? (
      <span className="text-muted">scrub forward — {count} tokens streamed here</span>
    ) : (
      <span className="text-muted">stream (I/O sampling off)</span>
    );
  } else {
    const io = span?.io?.outputs?.[port];
    body =
      io?.kind === "value" ? <JsonView value={io.preview} className="max-h-40" /> : <span className="text-muted">value (I/O sampling off)</span>;
  }

  return (
    <div
      className="pointer-events-none fixed z-50 max-w-sm rounded-lg border border-white/10 bg-[var(--glass-bg)] px-3 py-2 text-xs shadow-xl backdrop-blur"
      style={{ left: hover.x + 14, top: hover.y + 14 }}
    >
      <div className="mb-1 font-mono text-[var(--color-neon-cyan)]">
        {node}.{port}
      </div>
      {body}
    </div>
  );
}
