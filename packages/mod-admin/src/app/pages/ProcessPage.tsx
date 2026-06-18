import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Badge, GlassPanel, NeonButton, PageHeader, Spinner } from "../components/ui";
import { Cpu, Gauge, Play } from "../components/icon";
import { readSettings } from "../lib/settings";
import { sfx } from "../lib/sfx";

/* Mirrors backend/system-stats.ts (mod-admin owns both ends). */
interface ProcessStats {
  host: { platform: string; arch: string; release: string; cpuModel: string; cpus: number; loadAvg: number[]; totalMemMb: number; freeMemMb: number; uptimeSec: number };
  process: { pid: number; node: string; uptimeSec: number; cpuPercent: number; rssMb: number; heapUsedMb: number; heapTotalMb: number; externalMb: number };
  eventLoop: { utilization: number; p50Ms: number; p99Ms: number; maxMs: number };
  transport: {
    kind?: string;
    size?: number;
    inflight?: number[];
    /** The offload worker pool, when one is configured (hybrid: inline + pool). */
    offload?: { kind?: string; size?: number; inflight?: number[] } & Record<string, unknown>;
  } & Record<string, unknown>;
}
interface BenchPhase {
  wallMs: number;
  maxLagMs: number;
  loopUtilization: number;
}
interface BenchResult {
  n: number;
  runs: number;
  inline: BenchPhase;
  pool: BenchPhase & { workers: number; spawnMs: number };
  speedup: number;
}

const POLL_MS = 2000;

function uptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${sec % 60}s`;
}

/** Tiny polyline of the last N samples — enough to see a trend, not a chart. */
function Sparkline({ values, color, max }: { values: number[]; color: string; max?: number }) {
  const w = 132;
  const h = 32;
  if (values.length < 2) return <svg width={w} height={h} aria-hidden />;
  const m = Math.max(max ?? 0, ...values, 0.001);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - (Math.min(v, m) / m) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

function Bar({ frac, color }: { frac: number; color: string }) {
  return (
    <div className="h-1.5 w-full rounded bg-white/10">
      <div className="h-1.5 rounded" style={{ width: `${Math.min(100, Math.max(0, frac * 100))}%`, background: color }} />
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted text-xs">{label}</span>
      <span className="font-mono text-xs">{children}</span>
    </div>
  );
}

const CYAN = "var(--color-neon-cyan)";
const VIOLET = "var(--color-neon-violet)";
const LIME = "var(--color-neon-lime)";
const PINK = "var(--color-neon-pink)";
const AMBER = "var(--color-neon-amber)";

/** Horizontal comparison bar for the bench (wall time across phases). */
function PhaseBar({ label, ms, maxMs, color, detail }: { label: string; ms: number; maxMs: number; color: string; detail: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="font-mono">{ms}ms</span>
      </div>
      <div className="h-4 w-full rounded bg-white/5">
        <div className="h-4 rounded" style={{ width: `${Math.max(2, (ms / Math.max(1, maxMs)) * 100)}%`, background: color, boxShadow: `0 0 10px ${color}` }} />
      </div>
      <div className="text-muted text-[11px]">{detail}</div>
    </div>
  );
}

export function ProcessPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["system-stats"],
    queryFn: () => api.systemStats<ProcessStats>(),
    refetchInterval: POLL_MS,
  });

  // Rolling history for the sparklines (client-side; survives across polls).
  const cpuHist = useRef<number[]>([]);
  const eluHist = useRef<number[]>([]);
  useEffect(() => {
    if (!data) return;
    cpuHist.current = [...cpuHist.current, data.process.cpuPercent].slice(-45);
    eluHist.current = [...eluHist.current, data.eventLoop.utilization * 100].slice(-45);
  }, [data]);

  const [benchBusy, setBenchBusy] = useState(false);
  const [bench, setBench] = useState<BenchResult | null>(null);
  // Defaults come from Settings (persisted per browser).
  const [benchN, setBenchN] = useState(() => readSettings().benchN);
  const [benchRuns, setBenchRuns] = useState(() => readSettings().benchRuns);
  const [benchWorkers, setBenchWorkers] = useState<number | null>(() => readSettings().benchWorkers);

  const runBench = async () => {
    setBenchBusy(true);
    sfx.play("run");
    try {
      setBench(await api.systemBench<BenchResult>({ n: benchN, runs: benchRuns, ...(benchWorkers != null ? { workers: benchWorkers } : {}) }));
      sfx.play("ok");
    } catch {
      sfx.play("error");
    } finally {
      setBenchBusy(false);
    }
  };

  if (isLoading || !data) return <Spinner />;
  const { host, process: proc, eventLoop: loop, transport } = data;
  const memUsed = host.totalMemMb - host.freeMemMb;
  const benchMax = bench ? Math.max(bench.inline.wallMs, bench.pool.wallMs) : 0;

  return (
    <>
      <PageHeader
        title="Process"
        subtitle="The runtime's vitals — host, process, event loop, and how runs are dispatched. Refreshes every 2s; CPU and loop figures are per-interval."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {/* Process */}
        <GlassPanel className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Cpu size={14} className="text-[var(--color-neon-cyan)]" /> Process</h2>
            <span className="text-muted font-mono text-[10px]">pid {proc.pid} · {proc.node}</span>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-2xl font-semibold" style={{ color: CYAN }}>{proc.cpuPercent.toFixed(1)}%</div>
              <div className="text-muted text-[11px]">CPU (one core = 100%)</div>
            </div>
            <Sparkline values={cpuHist.current} color={CYAN} max={100} />
          </div>
          <div className="space-y-2 pt-1">
            <Stat label="RSS">{proc.rssMb} MB</Stat>
            <Stat label={`Heap ${proc.heapUsedMb} / ${proc.heapTotalMb} MB`}> </Stat>
            <Bar frac={proc.heapUsedMb / Math.max(1, proc.heapTotalMb)} color={CYAN} />
            <Stat label="External">{proc.externalMb} MB</Stat>
            <Stat label="Uptime">{uptime(proc.uptimeSec)}</Stat>
          </div>
        </GlassPanel>

        {/* Event loop */}
        <GlassPanel className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Gauge size={14} className="text-[var(--color-neon-violet)]" /> Event loop</h2>
            <span className="text-muted text-[10px]">delay percentiles per interval</span>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-2xl font-semibold" style={{ color: VIOLET }}>{(loop.utilization * 100).toFixed(1)}%</div>
              <div className="text-muted text-[11px]">utilization (busy fraction)</div>
            </div>
            <Sparkline values={eluHist.current} color={VIOLET} max={100} />
          </div>
          <Bar frac={loop.utilization} color={VIOLET} />
          <div className="space-y-2 pt-1">
            <Stat label="Lag p50">{loop.p50Ms} ms</Stat>
            <Stat label="Lag p99">{loop.p99Ms} ms</Stat>
            <Stat label="Lag max">{loop.maxMs} ms</Stat>
          </div>
          <p className="text-muted text-[11px]">
            Lag is how late timers fire — the loop held hostage by synchronous work. Run the benchmark below to see it spike.
          </p>
        </GlassPanel>

        {/* Host */}
        <GlassPanel className="space-y-3 p-5">
          <h2 className="text-sm font-semibold">Host</h2>
          <div className="space-y-2">
            <Stat label="OS">{host.platform} {host.arch}</Stat>
            <Stat label="CPU">{host.cpus}× cores</Stat>
            <div className="text-muted truncate text-[10px]" title={host.cpuModel}>{host.cpuModel}</div>
            <Stat label="Load 1/5/15m">{host.loadAvg.join(" / ")}</Stat>
            <Stat label={`Memory ${Math.round(memUsed / 1024 * 10) / 10} / ${Math.round(host.totalMemMb / 1024 * 10) / 10} GB`}> </Stat>
            <Bar frac={memUsed / Math.max(1, host.totalMemMb)} color={AMBER} />
            <Stat label="Up">{uptime(host.uptimeSec)}</Stat>
          </div>
        </GlassPanel>

        {/* Transport */}
        <GlassPanel className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Run transport</h2>
            <Badge hue={transport.kind === "worker-pool" ? 150 : transport.offload ? 150 : 200}>
              {transport.offload ? "hybrid" : String(transport.kind ?? "unknown")}
            </Badge>
          </div>
          {transport.kind === "worker-pool" ? (
            <div className="space-y-2">
              <Stat label="Workers">{String(transport.size)}</Stat>
              <Stat label="In flight">{(transport.inflight ?? []).join(", ") || "0"}</Stat>
              <p className="text-muted text-[11px]">Runs execute on worker threads — CPU-bound workflows can't stall this event loop.</p>
            </div>
          ) : transport.offload ? (
            <div className="space-y-2">
              <Stat label="Default">Inline (host event loop)</Stat>
              <Stat label="Offload pool">{String(transport.offload.size ?? "?")}× workers</Stat>
              <Stat label="In flight">{(transport.offload.inflight ?? []).join(", ") || "0"}</Stat>
              <p className="text-muted text-[11px]">
                I/O-bound graphs run inline (the loop is already free during their awaits). Workflows marked
                <span className="font-medium"> Offload</span> in the editor run on the worker pool, so their CPU-bound
                compute can&rsquo;t stall this event loop (or this admin).
              </p>
            </div>
          ) : (
            <p className="text-muted text-[11px]">
              Runs execute on the host event loop. Fine for I/O-bound graphs; a CPU-bound node blocks everything else
              while it computes — including this admin. Mark a heavy workflow <span className="font-medium">Offload</span>
              {" "}(editor → settings) and add a <span className="font-mono">workers</span> pool to move it off the loop;
              the benchmark below quantifies the difference.
            </p>
          )}
        </GlassPanel>
      </div>

      {/* Worker-efficiency bench */}
      <GlassPanel className="mt-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">Worker efficiency</h2>
          <span className="text-muted text-xs">
            the same CPU-bound workflow ({benchRuns}× fib({benchN}), concurrent) — on this event loop vs on a fresh worker pool
          </span>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <label className="text-muted flex items-center gap-1">
              fib n
              <input
                type="number" min={20} max={40} value={benchN}
                onChange={(e) => setBenchN(Number(e.target.value))}
                className="glass w-14 rounded px-1.5 py-1 font-mono outline-none"
                aria-label="Fibonacci index"
              />
            </label>
            <label className="text-muted flex items-center gap-1">
              runs
              <input
                type="number" min={1} max={16} value={benchRuns}
                onChange={(e) => setBenchRuns(Number(e.target.value))}
                className="glass w-12 rounded px-1.5 py-1 font-mono outline-none"
                aria-label="Concurrent runs"
              />
            </label>
            <label className="text-muted flex items-center gap-1">
              workers
              <input
                type="number" min={1} max={data.host.cpus} value={benchWorkers ?? ""}
                placeholder="auto"
                onChange={(e) => setBenchWorkers(e.target.value === "" ? null : Number(e.target.value))}
                className="glass w-14 rounded px-1.5 py-1 font-mono outline-none"
                aria-label="Pool size (blank = auto)"
                title="Pool size — blank = min(runs, cores − 1)"
              />
            </label>
            <NeonButton onClick={() => void runBench()} disabled={benchBusy}>
              <Play size={13} /> {benchBusy ? "Crunching…" : "Run benchmark"}
            </NeonButton>
          </div>
        </div>

        {benchBusy && (
          <p className="text-muted mt-4 text-xs">
            Running… the inline phase is deliberately freezing this very server — even this admin's API calls queue behind it.
          </p>
        )}

        {bench && !benchBusy && (
          <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_1fr_14rem]">
            <PhaseBar
              label="On the event loop"
              ms={bench.inline.wallMs}
              maxMs={benchMax}
              color={PINK}
              detail={`runs serialized · worst loop stall ${bench.inline.maxLagMs}ms · loop ${Math.round(bench.inline.loopUtilization * 100)}% busy`}
            />
            <PhaseBar
              label={`On ${bench.pool.workers} worker thread${bench.pool.workers === 1 ? "" : "s"}`}
              ms={bench.pool.wallMs}
              maxMs={benchMax}
              color={LIME}
              detail={`runs parallel · worst loop stall ${bench.pool.maxLagMs}ms · loop ${Math.round(bench.pool.loopUtilization * 100)}% busy · pool spawn ${bench.pool.spawnMs}ms (paid once)`}
            />
            <div className="flex flex-col justify-center rounded-xl bg-white/5 px-4 py-3">
              <div className="text-2xl font-semibold" style={{ color: LIME }}>{bench.speedup}×</div>
              <div className="text-muted text-[11px]">
                faster wall-clock — and the event loop stayed at {bench.pool.maxLagMs}ms worst stall instead of {bench.inline.maxLagMs}ms.
                That stall is every other request waiting.
              </div>
            </div>
          </div>
        )}
      </GlassPanel>
    </>
  );
}
