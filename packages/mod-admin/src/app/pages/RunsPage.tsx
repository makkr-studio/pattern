import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "motion/react";
import type { RunSummary, SpanData } from "@pattern/admin-sdk";
import { api } from "../lib/api";
import { useRun, useRuns } from "../lib/queries";
import { Badge, Dot, GlassPanel, JsonView, PageHeader, Spinner } from "../components/ui";
import { ago, ms, statusColor } from "../lib/format";
import { Play } from "../components/icon";

function nodeOf(span: SpanData): string {
  return String(span.attributes["pattern.node.id"] ?? span.name);
}

function Waterfall({ spans, runStart, total }: { spans: SpanData[]; runStart: number; total: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const nodes = spans.filter((s) => s.attributes["pattern.node.id"] !== undefined);
  if (nodes.length === 0) return <div className="text-muted text-sm">No node spans captured.</div>;
  return (
    <div className="space-y-1.5">
      {nodes.map((s) => {
        const left = total ? ((s.startTime - runStart) / total) * 100 : 0;
        const width = total ? Math.max(1.5, ((s.endTime - s.startTime) / total) * 100) : 100;
        const color = statusColor(s.status);
        return (
          <div key={s.spanId}>
            <button onClick={() => setOpen(open === s.spanId ? null : s.spanId)} className="block w-full text-left">
              <div className="flex items-center gap-3 text-xs">
                <span className="w-40 shrink-0 truncate font-mono">{nodeOf(s)}</span>
                <div className="relative h-4 flex-1 rounded bg-white/5">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${width}%` }}
                    className="absolute top-0 h-4 rounded"
                    style={{ left: `${left}%`, background: color, boxShadow: `0 0 10px ${color}` }}
                  />
                </div>
                <span className="text-muted w-14 shrink-0 text-right">{ms(s.endTime - s.startTime)}</span>
              </div>
            </button>
            {open === s.spanId && (s.io || s.error) && (
              <div className="ml-40 mt-1">
                {s.error && <div className="text-[var(--color-neon-pink)] text-xs">{s.error.message}</div>}
                {s.io && <JsonView value={s.io} className="max-h-48" />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RunDetail({ runId }: { runId: string }) {
  const { data, isLoading } = useRun(runId);
  if (isLoading) return <Spinner />;
  if (!data) return <GlassPanel className="text-muted p-8 text-sm">Run not found (it may have been evicted from the ring buffer).</GlassPanel>;
  const { summary, spans } = data;
  const runStart = Math.min(...spans.map((s) => s.startTime), summary.startTime);
  const runEnd = Math.max(...spans.map((s) => s.endTime), summary.endTime ?? summary.startTime);
  return (
    <GlassPanel className="p-5">
      <div className="mb-4 flex items-center gap-3">
        <Dot color={statusColor(summary.status)} pulse={summary.status === "running"} />
        <span className="font-mono text-sm font-semibold">{summary.workflowId}</span>
        <Badge hue={summary.status === "error" ? 340 : 150}>{summary.status}</Badge>
        <span className="text-muted text-xs">{ms(summary.durationMs)}</span>
        <Link
          to={`/runs/${summary.runId}/replay`}
          className="flex items-center gap-1 text-xs text-[var(--color-neon-cyan)] hover:underline"
        >
          <Play size={12} /> replay on graph
        </Link>
        <span className="text-muted ml-auto font-mono text-xs">{summary.runId.slice(0, 8)}</span>
      </div>
      <Waterfall spans={spans} runStart={runStart} total={runEnd - runStart} />
    </GlassPanel>
  );
}

function LiveTail() {
  const [spans, setSpans] = useState<SpanData[]>([]);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    let active = true;
    // Keep the generator so cleanup can `.return()` it — that runs its
    // `finally` (reader.cancel) and actually closes the SSE connection.
    // Breaking out of the loop alone leaves the socket open until GC.
    const tail = api.runs.tail();
    (async () => {
      for await (const span of tail) {
        if (!active) break;
        setSpans((prev) => [span, ...prev].slice(0, 50));
      }
    })().catch(() => {});
    return () => {
      active = false;
      void tail.return?.(undefined);
    };
  }, [on]);
  return (
    <GlassPanel className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Live tail</h2>
        <button
          onClick={() => setOn((v) => !v)}
          className="glass flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm hover:bg-white/5"
        >
          <Dot color={on ? "var(--color-neon-lime)" : "var(--color-port-control)"} pulse={on} />
          {on ? "streaming" : "paused"}
        </button>
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {spans.length === 0 && <div className="text-muted text-sm">{on ? "Waiting for spans… trigger a run." : "Press play to stream live spans (SSE)."}</div>}
        {spans.map((s) => (
          <div key={s.spanId} className="flex items-center gap-2 text-xs">
            <Dot color={statusColor(s.status)} />
            <span className="font-mono">{nodeOf(s)}</span>
            <span className="text-muted">{s.name}</span>
            <span className="text-muted ml-auto">{ms(s.endTime - s.startTime)}</span>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}

export function RunsPage() {
  const navigate = useNavigate();
  const { runId } = useParams();
  const { data, isLoading } = useRuns();
  if (isLoading) return <Spinner />;
  const runs = data ?? [];

  return (
    <>
      <PageHeader title="Runs" subtitle="Recent runs from the in-memory sink. Click a run for its span waterfall + I/O." />
      <div className="grid grid-cols-[1fr_1.3fr] gap-6">
        <div className="space-y-4">
          <GlassPanel className="overflow-hidden">
            {runs.length === 0 && <div className="text-muted p-6 text-sm">No runs yet — trigger a workflow.</div>}
            {runs.map((r: RunSummary) => (
              <button
                key={r.runId}
                onClick={() => navigate(`/runs/${r.runId}`)}
                className={`flex w-full items-center gap-3 border-b hairline px-4 py-3 text-left last:border-0 hover:bg-white/5 ${
                  r.runId === runId ? "bg-white/10" : ""
                }`}
              >
                <Dot color={statusColor(r.status)} pulse={r.status === "running"} />
                <span className="font-mono text-sm">{r.workflowId}</span>
                <span className="text-muted ml-auto text-xs">{ms(r.durationMs)}</span>
                <span className="text-muted w-16 text-right text-xs">{ago(r.startTime)}</span>
              </button>
            ))}
          </GlassPanel>
          <LiveTail />
        </div>
        <div>
          {runId ? (
            <RunDetail runId={runId} />
          ) : (
            <GlassPanel className="text-muted grid place-items-center p-12 text-sm">
              <div className="flex flex-col items-center gap-2">
                <Play size={24} />
                Select a run to replay it over its spans.
              </div>
            </GlassPanel>
          )}
        </div>
      </div>
    </>
  );
}
