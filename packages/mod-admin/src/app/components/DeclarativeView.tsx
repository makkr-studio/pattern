import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ReactFlow, Background, Controls, ReactFlowProvider } from "@xyflow/react";
import type { DeclarativeView as View, RouteRef } from "@pattern/admin-sdk";
import { api } from "../lib/api";
import { useOps, useWorkflow } from "../lib/queries";
import { buildFlow, type OpMap } from "../editor/graph";
import { OpNode } from "../editor/OpNode";
import { GlassPanel, JsonView, Modal, NeonButton, Spinner, Table, type Column } from "./ui";
import { FormFromSchema } from "./FormFromSchema";

/** A declarative data binding: a dedicated `route`. */
type DataRef = { route: RouteRef };

/** The react-query key for a binding — a stable prefix the table refresh can invalidate. */
function dataKey(ref: DataRef, args?: Record<string, unknown>): unknown[] {
  return ["call", ref.route.method ?? "GET", ref.route.path, args ?? {}];
}

/** Fetch a binding by calling its dedicated route. */
function fetchData<T = unknown>(ref: DataRef, args?: Record<string, unknown>): Promise<T> {
  return api.call<T>(ref.route.method ?? "GET", ref.route.path, args);
}

/** Call an action's dedicated route (default POST). */
function runAction(route: RouteRef, args: Record<string, unknown>): Promise<unknown> {
  return api.call(route.method ?? "POST", route.path, args);
}

/**
 * Fetch a declarative view's data from its dedicated route. Page/route params
 * (a details page's :userId, say) ride along — filling the route's `:tokens`,
 * then any remainder as the query.
 */
function useData(ref: DataRef, args?: Record<string, unknown>) {
  return useQuery({
    queryKey: dataKey(ref, args),
    queryFn: () => fetchData(ref, args),
    enabled: Boolean(ref.route),
  });
}

/**
 * Renders a Tier-1 declarative page (admin internals §6) from a `view` manifest.
 * Data sources are ops/workflows, so a declarative page is wiring over the
 * self-reflecting API — not a new bespoke surface.
 */
export function DeclarativeView({ view, params = {} }: { view: View; params?: Record<string, string> }) {
  if (view.kind === "iframe") {
    return <iframe src={view.url} className="glass h-[70vh] w-full rounded-2xl" title="embedded" />;
  }
  if (view.kind === "form") {
    return <FormView schema={view.schema} route={view.route} />;
  }
  if (view.kind === "graph") {
    return <GraphView slug={view.workflow} />;
  }
  if (view.kind === "detail") {
    return <DetailView view={view} args={params as Record<string, unknown>} />;
  }
  return <DataView view={view} args={params as Record<string, unknown>} />;
}

/** `detail` kind: one object as labeled rows (ResultView — copy keys included). */
function DetailView({ view, args }: { view: DataRef; args: Record<string, unknown> }) {
  const { data, isLoading, error } = useData(view, args);
  if (isLoading) return <Spinner />;
  if (error) {
    return <GlassPanel className="text-[var(--color-neon-pink)] p-6 text-sm">Failed to load this view.</GlassPanel>;
  }
  return (
    <GlassPanel className="max-w-2xl p-5">
      <ResultView value={data} />
    </GlassPanel>
  );
}

/**
 * An op result meant for human eyes: objects render as labeled rows (never
 * raw JSON), and a `copy` key becomes a copyable field — relative paths get
 * the admin's origin prepended, so a minted link is one click from a chat
 * message. Non-objects fall back to the JSON view.
 */
export function ResultView({ value }: { value: unknown }) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return <JsonView value={value} className="max-h-80" />;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const copy = entries.find(([k]) => k === "copy")?.[1];
  const rows = entries.filter(([k]) => k !== "copy");
  return (
    <div className="space-y-4">
      {typeof copy === "string" && <CopyField value={copy} />}
      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-6 text-sm">
              <span className="text-muted shrink-0 text-xs uppercase tracking-wider">{k}</span>
              <span className="min-w-0 break-all text-right font-mono text-xs">
                {typeof v === "string" ? v : v === true ? "yes" : v === false ? "no" : JSON.stringify(v)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CopyField({ value }: { value: string }) {
  const absolute = value.startsWith("/") ? `${location.origin}${value}` : value;
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={absolute}
        onFocus={(e) => e.currentTarget.select()}
        className="glass min-w-0 flex-1 rounded-lg px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]"
      />
      <NeonButton
        onClick={() => {
          void navigator.clipboard?.writeText(absolute);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
      >
        {copied ? "Copied ✓" : "Copy"}
      </NeonButton>
    </div>
  );
}

/** `form` kind: a FormFromSchema over the declared JSON schema; submit calls
 *  the target route with the values and shows its result. */
function FormView({ schema, route }: { schema: unknown; route: RouteRef }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<unknown>();
  const [pending, setPending] = useState(false);

  const onSubmit = async () => {
    setPending(true);
    try {
      setResult(await runAction(route, values));
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
      {result !== undefined && <ResultView value={result} />}
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

function DataView({ view, args }: { view: Exclude<View, { kind: "iframe" | "form" | "graph" | "detail" }>; args: Record<string, unknown> }) {
  const { data, isLoading, error } = useData(view, args);

  if (isLoading) return <Spinner />;
  if (error) return <GlassPanel className="text-[var(--color-neon-pink)] p-6 text-sm">Failed to load this view.</GlassPanel>;

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
 * `table` kind. Row actions call their dedicated route with args mapped from the
 * row (`args: { userId: "id" }` → `{ userId: row.id }`) and refresh the table —
 * which is how mod screens get mutations without shipping any UI code.
 * `confirm` actions go through the admin's Modal (never window.confirm —
 * native dialogs block automation and skip the design system), and action
 * RESULTS are shown in a Modal too: a route that returns something (a minted
 * sign-in link, the new settings value) hands it straight to the operator.
 */
function TableView({ view, data }: { view: TableViewDef; data: unknown }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ action: RowAction; row: Record<string, unknown> } | null>(null);
  const [result, setResult] = useState<{ title: string; value: unknown } | null>(null);
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const rowActions = view.rowActions ?? [];
  // The table's data-query key prefix — invalidated to refresh after a mutation.
  const tableKey = dataKey(view).slice(0, -1);

  const execute = async (label: string, route: RouteRef, args: Record<string, unknown>, show: boolean) => {
    setBusy(`${label}:${JSON.stringify(args)}`);
    try {
      const out = await runAction(route, args);
      await queryClient.invalidateQueries({ queryKey: tableKey });
      // Silent (default): the refreshed table IS the feedback. "show" is for
      // routes whose return value belongs in the operator's hands (minted links).
      if (show && out != null) setResult({ title: label, value: out });
    } catch (err) {
      // Errors always surface.
      setResult({ title: label, value: { error: err instanceof Error ? err.message : String(err) } });
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
                onClick={() => {
                  if (a.path) {
                    const filled = Object.entries(rowArgs(a, row)).reduce(
                      (acc, [k, v]) => acc.replace(`:${k}`, encodeURIComponent(String(v))),
                      a.path,
                    );
                    navigate(filled);
                  } else if (a.confirm) setPending({ action: a, row });
                  else if (a.route) void execute(a.label, a.route, rowArgs(a, row), a.result === "show");
                }}
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
        <NeonButton key={a.label} variant="ghost" disabled={busy !== null} onClick={() => void execute(a.label, a.route, {}, a.result === "show")}>
          {a.label}
        </NeonButton>
      ))}

      <Modal open={pending !== null} onClose={() => setPending(null)} title={pending?.action.label ?? ""}>
        {pending && (
          <div className="space-y-4">
            <p className="text-sm">
              Call <span className="font-mono">{pending.action.route?.path}</span> with:
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
                  if (action.route) void execute(action.label, action.route, rowArgs(action, row), action.result === "show");
                }}
              >
                {pending.action.label}
              </NeonButton>
            </div>
          </div>
        )}
      </Modal>

      {/* Action results: minted links, new settings values, errors. */}
      <Modal open={result !== null} onClose={() => setResult(null)} title={result?.title ?? ""}>
        {result && (
          <div className="space-y-4">
            <ResultView value={result.value} />
            <div className="flex justify-end">
              <NeonButton variant="ghost" onClick={() => setResult(null)}>
                Close
              </NeonButton>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
