import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ReactFlow, Background, Controls, ReactFlowProvider } from "@xyflow/react";
import type { DeclarativeView as View } from "@pattern/admin-sdk";
import { api } from "../lib/api";
import { useOps, useWorkflow } from "../lib/queries";
import { buildFlow, type OpMap } from "../editor/graph";
import { OpNode } from "../editor/OpNode";
import { GlassPanel, JsonView, NeonButton, Spinner, Table, type Column } from "./ui";
import { FormFromSchema } from "./FormFromSchema";

/** Fetch a declarative view's data source (an op type) via admin.invoke. */
function useSource(source: string) {
  return useQuery({ queryKey: ["invoke", source], queryFn: () => api.invoke<unknown>(source), enabled: Boolean(source) });
}

/**
 * Renders a Tier-1 declarative page (mod-admin-spec §6) from a `view` manifest.
 * Data sources are ops/workflows, so a declarative page is wiring over the
 * self-reflecting API — not a new bespoke surface.
 */
export function DeclarativeView({ view }: { view: View }) {
  if (view.kind === "iframe") {
    return <iframe src={view.url} className="glass h-[70vh] w-full rounded-2xl" title="embedded" />;
  }
  if (view.kind === "form") {
    return <FormView schema={view.schema} submit={view.submit} />;
  }
  if (view.kind === "graph") {
    return <GraphView slug={view.workflow} />;
  }
  return <DataView view={view} />;
}

/** `form` kind: a FormFromSchema over the declared JSON schema; submit invokes
 *  the target op with the values and shows its result. */
function FormView({ schema, submit }: { schema: unknown; submit: string }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<unknown>();
  const [pending, setPending] = useState(false);

  const onSubmit = async () => {
    setPending(true);
    try {
      setResult(await api.invoke(submit, values));
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="max-w-xl space-y-4">
      <GlassPanel className="p-5">
        <FormFromSchema schema={schema as Record<string, unknown>} value={values} onChange={setValues} />
        <div className="mt-4 flex justify-end">
          <NeonButton onClick={() => void onSubmit()} disabled={pending}>
            {pending ? "Running…" : "Submit"}
          </NeonButton>
        </div>
      </GlassPanel>
      {result !== undefined && <JsonView value={result} className="max-h-72" />}
    </div>
  );
}

const graphNodeTypes = { op: OpNode };

/** `graph` kind: the named workflow rendered read-only on an xyflow canvas. */
function GraphView({ slug }: { slug: string }) {
  const { data: wfData, isLoading, error } = useWorkflow(slug);
  const { data: opsData } = useOps();
  const opMap: OpMap = useMemo(() => new Map((opsData ?? []).map((o) => [o.type, o])), [opsData]);
  const flow = useMemo(
    () => (wfData?.liveDoc && opMap.size ? buildFlow(wfData.liveDoc, opMap) : null),
    [wfData, opMap],
  );

  if (isLoading || (!flow && !error)) return <Spinner />;
  if (error || !flow) {
    return <GlassPanel className="text-[var(--color-neon-pink)] p-6 text-sm">Workflow “{slug}” not found.</GlassPanel>;
  }
  return (
    <GlassPanel className="h-[70vh] overflow-hidden">
      <ReactFlowProvider>
        <ReactFlow
          nodes={flow.nodes}
          edges={flow.edges}
          nodeTypes={graphNodeTypes}
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
  );
}

function DataView({ view }: { view: Exclude<View, { kind: "iframe" | "form" | "graph" }> }) {
  const source = view.source;
  const { data, isLoading, error } = useSource(source);

  if (isLoading) return <Spinner />;
  if (error) return <GlassPanel className="text-[var(--color-neon-pink)] p-6 text-sm">Failed to load “{source}”.</GlassPanel>;

  switch (view.kind) {
    case "json":
      return <JsonView value={data} />;
    case "markdown":
      return (
        <GlassPanel className="prose-sm whitespace-pre-wrap p-6 text-sm leading-relaxed">{String(data ?? "")}</GlassPanel>
      );
    case "chart": {
      const rows = Array.isArray(data) ? (data as Array<Record<string, number>>) : [];
      const max = Math.max(1, ...rows.map((r) => Number(Object.values(r)[1] ?? Object.values(r)[0] ?? 0)));
      return (
        <GlassPanel className="space-y-2 p-6">
          {rows.map((r, i) => {
            const label = String(Object.values(r)[0]);
            const val = Number(Object.values(r)[1] ?? 0);
            return (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="w-32 truncate font-mono">{label}</span>
                <div className="h-3 rounded bg-[var(--color-neon-cyan)]" style={{ width: `${(val / max) * 100}%`, boxShadow: "0 0 10px var(--color-neon-cyan)" }} />
                <span className="text-muted">{val}</span>
              </div>
            );
          })}
        </GlassPanel>
      );
    }
    case "table": {
      const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      const columns: Column<Record<string, unknown>>[] = view.columns.map((c) => ({
        key: c.key,
        label: c.label ?? c.key,
        render: (row) => String(row[c.key] ?? ""),
      }));
      return (
        <div className="space-y-3">
          <Table columns={columns} rows={rows} getKey={(r) => JSON.stringify(r)} />
          {view.actions?.map((a) => (
            <NeonButton key={a.label} variant="ghost" onClick={() => api.invoke(a.run)}>
              {a.label}
            </NeonButton>
          ))}
        </div>
      );
    }
    default:
      return <JsonView value={data} />;
  }
}
