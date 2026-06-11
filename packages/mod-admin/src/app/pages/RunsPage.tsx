import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "motion/react";
import type { RunSummary, SpanData, SpanIoSample } from "@pattern/admin-sdk";
import { api } from "../lib/api";
import { useRun, useRunControl, useRuns } from "../lib/queries";
import { Badge, Dot, GlassPanel, JsonView, NeonButton, PageHeader, Spinner } from "../components/ui";
import { ago, ms, statusColor } from "../lib/format";
import { fuzzyFilter } from "../lib/fuzzy";
import { Pause, Play, Search } from "../components/icon";
import { ChevronLeft, ChevronRight, Square } from "lucide-react";
import { sfx } from "../lib/sfx";

const PAGE_SIZE = 25;
/** How many recent runs we pull for client-side search/paging. */
const FETCH_WINDOW = 500;

function nodeOf(span: SpanData): string {
  return String(span.attributes["pattern.node.id"] ?? span.name);
}

/** One side of a node's sampled I/O: a labeled row per port. */
function IoPorts({ title, ports }: { title: string; ports?: Record<string, SpanIoSample> }) {
  const entries = Object.entries(ports ?? {});
  if (entries.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-muted text-[10px] font-semibold uppercase tracking-wider">{title}</div>
      {entries.map(([port, s]) => (
        <div key={port} className="flex items-start gap-2 text-xs">
          <span className="text-muted w-24 shrink-0 truncate pt-0.5 text-right font-mono" title={port}>
            {port}
          </span>
          {s.kind === "stream" ? (
            <span className="text-muted pt-0.5 italic">stream — flows, not stored</span>
          ) : (
            <div className="min-w-0 flex-1">
              <JsonView value={s.preview} className="max-h-24" />
              {s.truncated && <span className="text-muted text-[10px]">preview truncated (4 KB cap)</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Waterfall({ spans, runStart, total }: { spans: SpanData[]; runStart: number; total: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const nodes = spans.filter((s) => s.attributes["pattern.node.id"] !== undefined);
  if (nodes.length === 0) return <div className="text-muted text-sm">No node spans captured.</div>;
  return (
    <div>
      {/* What am I looking at? One row per node; the bar is when it ran. */}
      <div className="text-muted mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span>One row per node — faint = waiting on inputs, solid = working. Click a bar for its I/O.</span>
        <span className="flex items-center gap-3">
          {(
            [
              ["ok", "var(--color-neon-lime)"],
              ["error", "var(--color-neon-pink)"],
              ["running", "var(--color-neon-cyan)"],
            ] as const
          ).map(([label, color]) => (
            <span key={label} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />
              {label}
            </span>
          ))}
        </span>
      </div>
      {/* Time axis over the bar lane (aligned with the rows' grid below). */}
      <div className="mb-1.5 flex items-center gap-3 text-[10px]">
        <span className="w-40 shrink-0" />
        <div className="text-muted flex flex-1 justify-between border-b hairline pb-0.5 font-mono">
          <span>0</span>
          <span>{ms(total / 2)}</span>
          <span>{ms(total)}</span>
        </div>
        <span className="w-14 shrink-0" />
      </div>
      <div className="space-y-1.5">
      {nodes.map((s) => {
        const left = total ? ((s.startTime - runStart) / total) * 100 : 0;
        const width = total ? Math.max(1.5, ((s.endTime - s.startTime) / total) * 100) : 100;
        const color = statusColor(s.status);
        // Every node launches at t≈0 and blocks on its inputs — the engine
        // reports that prefix so we can dim it: faint = waiting, solid = working.
        const blockedMs = Number(s.attributes["pattern.node.blockedMs"] ?? 0);
        const blocked = total ? Math.min((blockedMs / total) * 100, width - 1) : 0;
        const active = s.endTime - s.startTime - blockedMs;
        // Sub-workflow invocations this node made (ctx.invoke) — linkable runs.
        const invokes = (s.events ?? []).filter((e) => e.name === "invoke");
        return (
          <div key={s.spanId}>
            <button onClick={() => setOpen(open === s.spanId ? null : s.spanId)} className="block w-full text-left">
              <div className="flex items-center gap-3 text-xs">
                <span className="flex w-40 shrink-0 items-center gap-1 truncate font-mono">
                  <span className="truncate">{nodeOf(s)}</span>
                  {invokes.length > 0 && (
                    <span
                      className="shrink-0 text-[var(--color-neon-cyan)]"
                      title={`invoked ${invokes.length} sub-workflow run${invokes.length > 1 ? "s" : ""} — click for links`}
                    >
                      ↳{invokes.length > 1 ? invokes.length : ""}
                    </span>
                  )}
                </span>
                <div className="relative h-4 flex-1 rounded bg-white/5" {...(blockedMs > 0 ? { title: `waited ${ms(blockedMs)} on inputs · worked ${ms(Math.max(0, active))}` } : {})}>
                  {blocked > 0.5 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.22 }}
                      className="absolute top-0 h-4 rounded-l"
                      style={{ left: `${left}%`, width: `${blocked}%`, background: color }}
                    />
                  )}
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(1.5, width - blocked)}%` }}
                    className="absolute top-0 h-4 rounded"
                    style={{ left: `${left + blocked}%`, background: color, boxShadow: `0 0 10px ${color}` }}
                  />
                </div>
                <span className="text-muted w-14 shrink-0 text-right">{ms(s.endTime - s.startTime)}</span>
              </div>
            </button>
            {open === s.spanId && (s.io || s.error || invokes.length > 0) && (
              <div className="ml-40 mt-1 space-y-2">
                {s.error && <div className="text-[var(--color-neon-pink)] text-xs">{s.error.message}</div>}
                {invokes.map((e, i) => (
                  <Link
                    key={i}
                    to={`/runs/${String(e.attributes?.runId ?? "")}`}
                    className="flex items-center gap-1.5 text-xs text-[var(--color-neon-cyan)] hover:underline"
                  >
                    ↳ ran <span className="font-mono">{String(e.attributes?.workflowId ?? "?")}</span>
                    <span className="text-muted font-mono">{String(e.attributes?.runId ?? "").slice(0, 8)}</span>
                  </Link>
                ))}
                <IoPorts title="In" ports={s.io?.inputs} />
                <IoPorts title="Out" ports={s.io?.outputs} />
              </div>
            )}
            {open === s.spanId && !s.io && (
              <div className="text-muted ml-40 mt-1 text-[10px]">
                No I/O sampled for this run — turn on “Sample run I/O” in Settings → Observability, or run it from the editor.
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}

/** One run's `ctx.log` lines: `log.<level>` span events, in time order. */
function RunLogs({ spans, runStart }: { spans: SpanData[]; runStart: number }) {
  const lines = spans
    .flatMap((s) =>
(s.events ?? [])
        .filter((e) => e.name.startsWith("log."))
        .map((e) => ({
          time: e.time,
          level: e.name.slice(4),
          node: nodeOf(s),
          message: String(e.attributes?.message ?? ""),
          extra: Object.fromEntries(Object.entries(e.attributes ?? {}).filter(([k]) => k !== "message")),
        })),
    )
    .sort((a, b) => a.time - b.time);
  if (lines.length === 0) return null;

  const levelColor: Record<string, string> = {
    error: "var(--color-neon-pink)",
    warn: "var(--color-neon-amber)",
    info: "var(--color-neon-cyan)",
    debug: "var(--fg-muted)",
  };
  return (
    <div className="mt-4">
      <h3 className="text-muted mb-2 text-xs font-semibold uppercase tracking-wider">Logs ({lines.length})</h3>
      <div className="glass max-h-64 space-y-0.5 overflow-y-auto rounded-xl p-3 font-mono text-xs leading-relaxed">
        {lines.map((l, i) => (
          <div key={i} className="flex items-baseline gap-2">
            <span className="text-muted shrink-0 tabular-nums">+{(l.time - runStart).toFixed(0)}ms</span>
            <span className="shrink-0 font-semibold uppercase" style={{ color: levelColor[l.level] ?? "var(--fg)" }}>
              {l.level}
            </span>
            <span className="text-muted shrink-0">{l.node}</span>
            <span className="min-w-0 break-all">
              {l.message}
              {Object.keys(l.extra).length > 0 && <span className="text-muted"> {JSON.stringify(l.extra)}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The run's principal, readably (the session provider puts email in claims). */
function whoOf(principal: unknown): string | null {
  const p = principal as { kind?: string; id?: string; claims?: { email?: unknown } } | undefined;
  if (!p || p.kind !== "user") return null;
  return typeof p.claims?.email === "string" ? p.claims.email : (p.id ?? null);
}

function RunDetail({ runId }: { runId: string }) {
  const { data, isLoading } = useRun(runId);
  const control = useRunControl(runId);
  if (isLoading) return <Spinner />;
  if (!data) return <GlassPanel className="text-muted p-8 text-sm">Run not found (it may have been evicted from the ring buffer).</GlassPanel>;
  const { summary, spans, inflight, paused, children } = data;
  const runStart = Math.min(...spans.map((s) => s.startTime), summary.startTime);
  const runEnd = Math.max(...spans.map((s) => s.endTime), summary.endTime ?? summary.startTime);
  const act = (action: "cancel" | "pause" | "resume") => {
    sfx.play(action === "cancel" ? "error" : "toggle");
    control.mutate(action);
  };
  return (
    <GlassPanel className="p-5">
      <div className="mb-4 flex items-center gap-3">
        <Dot color={paused ? "var(--color-neon-amber)" : statusColor(summary.status)} pulse={summary.status === "running" && !paused} />
        <span className="font-mono text-sm font-semibold">{summary.workflowId}</span>
        <Badge hue={summary.status === "error" ? 340 : 150}>{summary.status}</Badge>
        {paused && <Badge hue={45}>paused</Badge>}
        <span className="text-muted text-xs">{ms(summary.durationMs)}</span>
        <Link
          to={`/runs/${summary.runId}/replay`}
          className="flex items-center gap-1 text-xs text-[var(--color-neon-cyan)] hover:underline"
        >
          <Play size={12} /> replay on graph
        </Link>
        {/* In-flight controls: pause holds new node starts; stop aborts. */}
        {inflight && (
          <span className="ml-auto flex items-center gap-1">
            <NeonButton
              variant="ghost"
              className="!px-2 !py-1"
              aria-label={paused ? "Resume run" : "Pause run"}
              title={paused ? "Resume — held nodes proceed" : "Pause — no new node starts; running ops finish"}
              disabled={control.isPending}
              onClick={() => act(paused ? "resume" : "pause")}
            >
              {paused ? <Play size={12} /> : <Pause size={12} />}
            </NeonButton>
            <NeonButton
              variant="danger"
              className="!px-2 !py-1"
              aria-label="Stop run"
              title="Stop — abort this run"
              disabled={control.isPending}
              onClick={() => act("cancel")}
            >
              <Square size={12} />
            </NeonButton>
          </span>
        )}
        <span className={`text-muted font-mono text-xs ${inflight ? "" : "ml-auto"}`}>{summary.runId.slice(0, 8)}</span>
      </div>
      {whoOf(summary.principal) && (
        <div className="text-muted mb-3 text-xs">
          run as <span className="font-mono text-[var(--color-neon-cyan)]">{whoOf(summary.principal)}</span>
          <span className="ml-2 opacity-60">· trigger {summary.trigger}</span>
        </div>
      )}
      {/* This run was started by another run's node (ctx.invoke) — link up. */}
      {summary.parent && (
        <div className="text-muted mb-3 text-xs">
          invoked by{" "}
          <Link to={`/runs/${summary.parent.runId}`} className="font-mono text-[var(--color-neon-cyan)] hover:underline">
            {summary.parent.workflowId}
          </Link>
          <span className="ml-1 opacity-60">
            · node <span className="font-mono">{summary.parent.nodeId}</span>
          </span>
        </div>
      )}
      <Waterfall spans={spans} runStart={runStart} total={runEnd - runStart} />
      {/* Sub-runs this run started (ctx.invoke) — link down. */}
      {(children?.length ?? 0) > 0 && (
        <div className="mt-4">
          <h3 className="text-muted mb-2 text-xs font-semibold uppercase tracking-wider">Sub-runs ({children!.length})</h3>
          <div className="glass max-h-48 overflow-y-auto rounded-xl">
            {children!.map((c) => (
              <Link
                key={c.runId}
                to={`/runs/${c.runId}`}
                className="flex items-center gap-3 border-b hairline px-3 py-2 text-xs last:border-0 hover:bg-white/5"
              >
                <Dot color={statusColor(c.status)} pulse={c.status === "running"} />
                <span className="font-mono">{c.workflowId}</span>
                <span className="text-muted">via {c.parent?.nodeId}</span>
                <span className="text-muted ml-auto">{ms(c.durationMs)}</span>
                <span className="text-muted font-mono">{c.runId.slice(0, 8)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      <RunLogs spans={spans} runStart={runStart} />
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
  const { data, isLoading } = useRuns({ limit: FETCH_WINDOW });
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  // Fuzzy over workflow id + status + run id; searching resets to page 1.
  const filtered = useMemo(
    () => fuzzyFilter(data ?? [], query, (r) => `${r.workflowId} ${r.status} ${r.runId}`),
    [data, query],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const pageRuns = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  if (isLoading) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Runs"
        subtitle="Recent runs from the in-memory sink. Pick a run: the panel on the right is its timeline — when each node ran, for how long, and what flowed through it. Try sample.replay for a telling one."
      />
      <div className="grid grid-cols-[1fr_1.3fr] gap-6">
        <div className="space-y-4">
          {/* Fuzzy search over the retained window */}
          <div className="glass flex items-center gap-2 rounded-xl px-3 py-2">
            <Search size={14} className="text-muted shrink-0" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Fuzzy search runs (workflow, status, id)…"
              aria-label="Search runs"
              className="w-full bg-transparent text-sm outline-none"
            />
            {query && (
              <button type="button" aria-label="Clear search" className="text-muted text-xs" onClick={() => setQuery("")}>
                ✕
              </button>
            )}
          </div>

          <GlassPanel className="overflow-hidden">
            {pageRuns.length === 0 && (
              <div className="text-muted p-6 text-sm">{query ? "No runs match." : "No runs yet — trigger a workflow."}</div>
            )}
            {pageRuns.map((r: RunSummary) => (
              <button
                key={r.runId}
                onClick={() => navigate(`/runs/${r.runId}`)}
                className={`flex w-full items-center gap-3 border-b hairline px-4 py-3 text-left last:border-0 hover:bg-white/5 ${
                  r.runId === runId ? "bg-white/10" : ""
                }`}
              >
                <Dot color={statusColor(r.status)} pulse={r.status === "running"} />
                {r.parent && (
                  <span className="text-muted -ml-1 shrink-0" title={`sub-run — invoked by ${r.parent.workflowId}`}>
                    ↳
                  </span>
                )}
                <span className="font-mono text-sm">{r.workflowId}</span>
                <span className="text-muted ml-auto text-xs">{ms(r.durationMs)}</span>
                <span className="text-muted w-16 text-right text-xs">{ago(r.startTime)}</span>
              </button>
            ))}
            {/* Pagination over the retained window */}
            {filtered.length > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t hairline px-4 py-2">
                <button
                  type="button"
                  aria-label="Previous page"
                  className="text-muted rounded p-1 hover:bg-white/10 hover:text-[var(--fg)] disabled:opacity-30"
                  disabled={current === 0}
                  onClick={() => setPage(current - 1)}
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-muted text-xs">
                  {current * PAGE_SIZE + 1}–{Math.min((current + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
                  {query && data ? ` (filtered from ${data.length})` : ""}
                </span>
                <button
                  type="button"
                  aria-label="Next page"
                  className="text-muted rounded p-1 hover:bg-white/10 hover:text-[var(--fg)] disabled:opacity-30"
                  disabled={current >= pages - 1}
                  onClick={() => setPage(current + 1)}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
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
