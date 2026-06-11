import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ReactFlow, Background, Controls, ReactFlowProvider } from "@xyflow/react";
import type { DeclarativeView as View } from "@pattern/admin-sdk";
import { api } from "../lib/api";
import { useOps, useWorkflow } from "../lib/queries";
import { buildFlow, type OpMap } from "../editor/graph";
import { OpNode } from "../editor/OpNode";
import { GlassPanel, JsonView, Modal, NeonButton, Spinner, Table, type Column } from "./ui";
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
    case "table":
      return <TableView view={view} data={data} />;
    default:
      return <JsonView value={data} />;
  }
}

type TableViewDef = Extract<View, { kind: "table" }>;
type RowAction = NonNullable<TableViewDef["rowActions"]>[number];

/** Map a row action's `args` declaration over a concrete row. */
const rowArgs = (action: RowAction, row: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(action.args ?? {}).map(([argName, rowKey]) => [argName, row[rowKey]]));

/**
 * `table` kind. Row actions invoke their op with args mapped from the row
 * (`args: { userId: "id" }` → `{ userId: row.id }`) and refresh the source —
 * which is how mod screens get mutations without shipping any UI code.
 * `confirm` actions go through the admin's Modal (never window.confirm —
 * native dialogs block automation and skip the design system).
 */
function TableView({ view, data }: { view: TableViewDef; data: unknown }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ action: RowAction; row: Record<string, unknown> } | null>(null);
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const rowActions = view.rowActions ?? [];

  const execute = async (action: RowAction, row: Record<string, unknown>) => {
    const args = rowArgs(action, row);
    setBusy(`${action.label}:${JSON.stringify(args)}`);
    try {
      await api.invoke(action.run, args);
      await queryClient.invalidateQueries({ queryKey: ["invoke", view.source] });
    } finally {
      setBusy(null);
    }
  };

  const columns: Column<Record<string, unknown>>[] = view.columns.map((c) => ({
    key: c.key,
    label: c.label ?? c.key,
    render: (row) => String(row[c.key] ?? ""),
  }));
  if (rowActions.length) {
    columns.push({
      key: "__actions",
      label: "",
      render: (row) => (
        <span className="flex justify-end gap-1.5">
          {rowActions.map((a) => {
            const key = `${a.label}:${JSON.stringify(rowArgs(a, row))}`;
            return (
              <button
                key={a.label}
                type="button"
                disabled={busy !== null}
                onClick={() => (a.confirm ? setPending({ action: a, row }) : void execute(a, row))}
                className="text-muted rounded-md border border-white/10 px-2 py-0.5 text-xs hover:bg-white/10 hover:text-[var(--fg)] disabled:opacity-40"
              >
                {busy === key ? "…" : a.label}
              </button>
            );
          })}
        </span>
      ),
    });
  }

  return (
    <div className="space-y-3">
      <Table columns={columns} rows={rows} getKey={(r) => JSON.stringify(r)} />
      {view.actions?.map((a) => (
        <NeonButton key={a.label} variant="ghost" onClick={() => api.invoke(a.run)}>
          {a.label}
        </NeonButton>
      ))}

      <Modal open={pending !== null} onClose={() => setPending(null)} title={pending?.action.label ?? ""}>
        {pending && (
          <div className="space-y-4">
            <p className="text-sm">
              Run <span className="font-mono">{pending.action.run}</span> with:
            </p>
            <JsonView value={rowArgs(pending.action, pending.row)} className="max-h-40" />
            <div className="flex justify-end gap-2">
              <NeonButton variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </NeonButton>
              <NeonButton
                variant="danger"
                disabled={busy !== null}
                onClick={() => {
                  const { action, row } = pending;
                  setPending(null);
                  void execute(action, row);
                }}
              >
                {pending.action.label}
              </NeonButton>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
