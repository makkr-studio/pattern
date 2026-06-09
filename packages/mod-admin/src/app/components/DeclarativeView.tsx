import { useQuery } from "@tanstack/react-query";
import type { DeclarativeView as View } from "@pattern/admin-sdk";
import { api } from "../lib/api";
import { GlassPanel, JsonView, NeonButton, Spinner, Table, type Column } from "./ui";

/** Fetch a declarative view's data source (an op type) via admin.invoke. */
function useSource(source: string) {
  return useQuery({ queryKey: ["invoke", source], queryFn: () => api.invoke<unknown>(source) });
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
  return <DataView view={view} />;
}

function DataView({ view }: { view: Exclude<View, { kind: "iframe" }> }) {
  const source = "source" in view ? view.source : "workflow" in view ? view.workflow : "";
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
    case "graph":
      return <JsonView value={data} className="max-h-[70vh]" />;
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
    case "form":
      return <GlassPanel className="text-muted p-6 text-sm">Form views render from a Zod→JSON schema (coming with the form kit).</GlassPanel>;
    default:
      return <JsonView value={data} />;
  }
}
