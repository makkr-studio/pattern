import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ReactFlow, Background, Controls, ReactFlowProvider } from "@xyflow/react";
import type { SpanData } from "@pattern/admin-sdk";
import { useOps, useRun, useWorkflow } from "../lib/queries";
import { buildFlow, type OpMap, type ReplayState } from "../editor/graph";
import { OpNode } from "../editor/OpNode";
import { Badge, GlassPanel, NeonButton, PageHeader, Spinner } from "../components/ui";
import { ms, statusColor } from "../lib/format";
import { Pause, Play, SkipBack, SkipForward } from "../components/icon";

const nodeTypes = { op: OpNode };
const SPEEDS = [0.5, 1, 2, 4] as const;

function nodeIdOf(span: SpanData): string | undefined {
  const id = span.attributes["pattern.node.id"];
  return typeof id === "string" ? id : undefined;
}

function stateAt(span: SpanData, t: number): ReplayState {
  if (t < span.startTime) return "pending";
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

  const [t, setT] = useState(0); // offset from t0, ms
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

  // Span boundary instants (starts + ends) for step-back/forward.
  const marks = useMemo(() => {
    const set = new Set<number>([0, total]);
    for (const s of nodeSpans) {
      set.add(s.startTime - t0);
      set.add(s.endTime - t0);
    }
    return [...set].filter((m) => m >= 0).sort((a, b) => a - b);
  }, [nodeSpans, t0, total]);
  const stepBack = () => setT((cur) => marks.filter((m) => m < cur - 1).pop() ?? 0);
  const stepForward = () => setT((cur) => marks.find((m) => m > cur + 1) ?? total);

  const doc = wfData?.liveDoc;
  const flow = useMemo(() => (doc && opMap.size ? buildFlow(doc, opMap) : null), [doc, opMap]);

  // Decorate the static flow with per-node replay state + edge illumination.
  const decorated = useMemo(() => {
    if (!flow) return null;
    const now = t0 + t;
    const stateByNode = new Map<string, ReplayState>();
    for (const s of nodeSpans) stateByNode.set(nodeIdOf(s)!, stateAt(s, now));
    const nodes = flow.nodes.map((n) => ({
      ...n,
      data: { ...n.data, replay: stateByNode.get(n.id) ?? "pending" },
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
  }, [flow, nodeSpans, t, t0]);

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
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} color="rgba(255,255,255,0.06)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </GlassPanel>

      {/* Transport bar */}
      <GlassPanel className="mt-3 flex items-center gap-3 px-4 py-3">
        <NeonButton variant="ghost" className="!px-2 !py-1.5" aria-label="Step back" title="Step back" onClick={stepBack}>
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
        <NeonButton variant="ghost" className="!px-2 !py-1.5" aria-label="Step forward" title="Step forward" onClick={stepForward}>
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
