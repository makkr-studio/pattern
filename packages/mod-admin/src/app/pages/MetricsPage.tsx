import { useMetrics } from "../lib/queries";
import { GlassPanel, PageHeader, Spinner, Table, type Column } from "../components/ui";
import { ms } from "../lib/format";
import type { LatencyStats } from "@pattern-js/admin-sdk";

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <GlassPanel className="p-5">
      <div className="text-muted text-xs font-semibold uppercase tracking-wider">{label}</div>
      <div className="mt-1 text-2xl font-semibold" style={{ color: accent }}>
        {value}
      </div>
    </GlassPanel>
  );
}

export function MetricsPage() {
  const { data, isLoading } = useMetrics();
  if (isLoading || !data) return <Spinner />;

  const columns: Column<LatencyStats>[] = [
    { key: "workflowId", label: "Workflow", render: (w) => <span className="font-mono text-sm">{w.workflowId}</span> },
    { key: "count", label: "Runs", width: "6rem" },
    { key: "errors", label: "Errors", width: "6rem", render: (w) => (w.errors ? <span className="text-[var(--color-neon-pink)]">{w.errors}</span> : "0") },
    { key: "p50", label: "p50", width: "6rem", render: (w) => ms(w.p50) },
    { key: "p95", label: "p95", width: "6rem", render: (w) => ms(w.p95) },
    { key: "p99", label: "p99", width: "6rem", render: (w) => ms(w.p99) },
    { key: "maxMs", label: "max", width: "6rem", render: (w) => ms(w.maxMs) },
  ];

  return (
    <>
      <PageHeader title="Metrics" subtitle={`Window: ${data.window.label} — counters from the in-memory trace sink.`} />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Runs" value={String(data.runs)} accent="var(--color-neon-cyan)" />
        <Stat label="Errors" value={String(data.errors)} accent={data.errors ? "var(--color-neon-pink)" : undefined} />
        <Stat label="Error rate" value={`${(data.errorRate * 100).toFixed(1)}%`} />
        <Stat label="In flight" value={String(data.inFlight)} accent="var(--color-neon-violet)" />
        <Stat label="Runs / min" value={data.runsPerMin.toFixed(1)} />
      </div>
      {data.perWorkflow.length > 0 ? (
        <Table columns={columns} rows={data.perWorkflow} getKey={(w) => w.workflowId} />
      ) : (
        <GlassPanel className="text-muted p-8 text-center text-sm">No runs recorded yet in this window.</GlassPanel>
      )}
    </>
  );
}
