import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ReactFlow, Background, Controls, ReactFlowProvider } from "@xyflow/react";
import type { SpanData } from "@pattern/admin-sdk";
import { useOps, useRun, useWorkflow } from "../lib/queries";
import { buildFlow, type OpMap, type ReplayState } from "../editor/graph";
import { OpNode } from "../editor/OpNode";
import { FrameNode } from "../editor/FrameNode";
import { PortalEdge } from "../editor/PortalEdge";
import { Badge, GlassPanel, NeonButton, PageHeader, Spinner } from "../components/ui";
import { ms, statusColor } from "../lib/format";
import { Pause, Play, SkipBack, SkipForward } from "../components/icon";

const nodeTypes = { op: OpNode, frame: FrameNode };
const edgeTypes = { portal: PortalEdge };
const SPEEDS = [0.5, 1, 2, 4] as const;

function nodeIdOf(span: SpanData): string | undefined {
  const id = span.attributes["pattern.node.id"];
  return typeof id === "string" ? id : undefined;
}

/** When the node actually started WORKING — every node launches at t≈0 and
 *  blocks on its inputs first, so raw startTime would light them all at once. */
function effectiveStart(span: SpanData): number {
  return span.startTime + Number(span.attributes["pattern.node.blockedMs"] ?? 0);
}

function stateAt(span: SpanData, t: number): ReplayState {
  if (t < effectiveStart(span)) return "pending";
  if (t < span.endTime) return "running";
  if (span.events?.some((e) => e.name === "skipped")) return "skipped";
  return span.status === "error" ? "error" : "ok";
}

/**
 * Run replay on the graph canvas (mod-admin-spec §15.1): a scrubber with
 * play/pause/step/speed; nodes transition pending→running→ok|error|skipped at
 * the scrubber's position, and edges illuminate once their source completed.
 */
export function ReplayPage() {
  const { runId } = useParams();
  const { data: run, isLoading: runLoading } = useRun(runId);
  const { data: wfData, isLoading: wfLoading } = useWorkflow(run?.summary.workflowId);
  const { data: opsData } = useOps();
  const opMap: OpMap = useMemo(() => new Map((opsData ?? []).map((o) => [o.type, o])), [opsData]);

  // Timeline bounds from node spans.
  const nodeSpans = useMemo(() => (run?.spans ?? []).filter((s) => nodeIdOf(s)), [run]);
  const t0 = useMemo(() => (nodeSpans.length ? Math.min(...nodeSpans.map((s) => s.startTime)) : 0), [nodeSpans]);
  const t1 = useMemo(() => (nodeSpans.length ? Math.max(...nodeSpans.map((s) => s.endTime)) : 0), [nodeSpans]);
  const total = Math.max(0, t1 - t0);

  // Per-chunk stream events (when I/O sampling was on) — each a token transiting
  // a stream edge, with a real offset. Powers token-by-token scrubbing + peeks.
  const chunks = useMemo(() => {
    const out: Array<{ node: string; port: string; seq: number; preview: unknown; truncated?: boolean; at: number }> = [];
    for (const s of nodeSpans) {
      const node = nodeIdOf(s)!;
      for (const e of s.events ?? []) {
        if (e.name !== "stream.chunk") continue;
        const a = e.attributes ?? {};
        out.push({
          node,
          port: String(a.port ?? ""),
          seq: Number(a.seq ?? 0),
          preview: a.preview,
          truncated: Boolean(a.truncated),
          at: Math.max(0, e.time - t0),
        });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }, [nodeSpans, t0]);

  const [t, setT] = useState(0); // offset from t0, ms

  // The chunk that has most recently transited at the scrubber position.
  const currentChunk = useMemo(() => {
    let hit: (typeof chunks)[number] | null = null;
    for (const c of chunks) {
      if (c.at <= t) hit = c;
      else break;
    }
    return hit;
  }, [chunks, t]);

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

  // Step marks = every instant a node CHANGES state: when it starts working
  // (effective start — raw span starts all collapse to t≈0, which made the
  // step buttons jump straight to the end) and when it finishes. Marks closer
  // than 2ms cluster into one step.
  const marks = useMemo(() => {
    const raw = new Set<number>([0, total]);
    for (const s of nodeSpans) {
      raw.add(Math.max(0, effectiveStart(s) - t0));
      raw.add(Math.max(0, s.endTime - t0));
    }
    // Each sampled chunk is its own step, so you can scrub token-by-token.
    for (const c of chunks) raw.add(c.at);
    const sorted = [...raw].sort((a, b) => a - b);
    const clustered: number[] = [];
    for (const m of sorted) {
      if (clustered.length === 0 || m - clustered[clustered.length - 1]! > 2) clustered.push(m);
    }
    return clustered;
  }, [nodeSpans, t0, total, chunks]);
  // Land just PAST the mark (+1ms) so the state flip is visible; stepping pauses.
  const stepBack = () => {
    setPlaying(false);
    setT((cur) => {
      const prev = marks.filter((m) => m < cur - 2).pop();
      return prev === undefined ? 0 : Math.min(prev + 1, total);
    });
  };
  const stepForward = () => {
    setPlaying(false);
    setT((cur) => {
      const next = marks.find((m) => m > cur + 1);
      return next === undefined ? total : Math.min(next + 1, total);
    });
  };

  const doc = wfData?.liveDoc;
  const flow = useMemo(() => (doc && opMap.size ? buildFlow(doc, opMap) : null), [doc, opMap]);

  // Replay states are DISCRETE — they only change when the scrubber crosses a
  // span boundary. Key the decoration on that signature, not on raw `t`:
  // handing React Flow a brand-new nodes array every animation frame keeps its
  // nodes perpetually "unmeasured" (= hidden), blanking the canvas during play.
  const stateSig = useMemo(() => {
    const now = t0 + t;
    return nodeSpans.map((s) => `${nodeIdOf(s)}:${stateAt(s, now)}`).join("|");
  }, [nodeSpans, t, t0]);

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

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <PageHeader
        title={`Replay · ${run.summary.workflowId}`}
        subtitle="Scrub through the run — nodes light up as they execute; edges illuminate as data flows."
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
            nodes={decorated.nodes}
            edges={decorated.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={22} size={1.6} color="var(--canvas-dot)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </GlassPanel>

      {/* Live data peek — the token transiting at the scrubber, when I/O sampling
          was on. Turns replay from node-by-node into token-by-token. */}
      {chunks.length > 0 && (
        <GlassPanel className="mt-3 flex items-center gap-3 px-4 py-2 text-xs">
          <span className="text-muted shrink-0 font-semibold uppercase tracking-wider">stream</span>
          {currentChunk ? (
            <>
              <span className="font-mono text-[var(--color-port-stream)]" title="producing node · port">
                {currentChunk.node}.{currentChunk.port}
              </span>
              <span className="text-muted shrink-0">#{currentChunk.seq}</span>
              <span className="min-w-0 flex-1 truncate font-mono" title={String(currentChunk.preview ?? "")}>
                {typeof currentChunk.preview === "string" ? currentChunk.preview : JSON.stringify(currentChunk.preview)}
              </span>
              {currentChunk.truncated && <span className="text-muted shrink-0 text-[10px]">(capped)</span>}
            </>
          ) : (
            <span className="text-muted">scrub forward to watch {chunks.length} chunk{chunks.length > 1 ? "s" : ""} transit…</span>
          )}
          <span className="text-muted ml-auto shrink-0 tabular-nums">{chunks.filter((c) => c.at <= t).length}/{chunks.length}</span>
        </GlassPanel>
      )}

      {/* Transport bar */}
      <GlassPanel className="mt-3 flex items-center gap-3 px-4 py-3">
        <NeonButton variant="ghost" className="!px-2 !py-1.5" aria-label="Previous node event" title="Step back — previous node event" onClick={stepBack}>
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
        <NeonButton variant="ghost" className="!px-2 !py-1.5" aria-label="Next node event" title="Step forward — next node event" onClick={stepForward}>
          <SkipForward size={14} />
        </NeonButton>

        <input
          type="range"
          min={0}
          max={Math.max(1, total)}
          step={1}
          value={Math.min(t, total)}
          onChange={(e) => {
            setPlaying(false);
            setT(Number(e.target.value));
          }}
          aria-label="Replay position"
          className="flex-1 accent-[var(--color-neon-cyan)]"
        />

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
    </div>
  );
}
