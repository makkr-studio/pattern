/**
 * The admin's front door. Two jobs, one page:
 *
 *  - GETTING STARTED: every mod-contributed checklist (manifest `checklists`)
 *    renders here as the "open for business" board — a fresh app opens on its
 *    setup path, and the steps tick themselves live (5s poll).
 *  - OPERATING: once running, the same page is the morning glance — runs and
 *    errors in the window, in-flight count, recent failures one click from
 *    their run page, and (when the mods are present) users and paying
 *    customers. Tiles for absent mods simply don't render: the dashboard is
 *    duck-typed against the same routes the mod pages use.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useManifest, useMetrics, useRuns } from "../lib/queries";
import { Badge, GlassPanel, PageHeader, Spinner } from "../components/ui";

/** A mod route probed best-effort: absent mod (404/denied) → tile hidden. */
function useProbe<T>(key: string, path: string, pick: (r: unknown) => T) {
  return useQuery({
    queryKey: ["dash", key],
    queryFn: async () => {
      try {
        return pick(await api.call("GET", path));
      } catch {
        return null;
      }
    },
    refetchInterval: 15000,
  });
}

const arr = (r: unknown, key: string): unknown[] =>
  Array.isArray(r) ? r : ((r as Record<string, unknown[]>)?.[key] ?? []);

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "lime" | "pink" | "amber" }) {
  const color = tone === "lime" ? "var(--color-neon-lime)" : tone === "pink" ? "var(--color-neon-pink)" : tone === "amber" ? "var(--color-neon-amber)" : undefined;
  return (
    <GlassPanel className="p-5">
      <div className="text-2xl font-semibold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="text-muted mt-1 text-xs">{label}</div>
    </GlassPanel>
  );
}

interface ChecklistData {
  steps: Array<{ ok: boolean; label: string; how?: string; detail?: string }>;
  done?: boolean;
  note?: string;
}

/** One mod's checklist card — same rendering contract as the mod's own page. */
function ChecklistCard({ title, path }: { title: string; path: string }) {
  const { data } = useQuery({
    queryKey: ["dash", "checklist", path],
    queryFn: () => api.call<Record<string, unknown>>("GET", path).catch(() => null),
    refetchInterval: 5000,
  });
  const list = (data && ((data as Record<string, unknown>).checklist ?? data)) as ChecklistData | null;
  if (!list || !Array.isArray(list.steps)) return null;
  const steps = list.steps;
  const done = steps.filter((s) => s.ok).length;
  const next = steps.find((s) => !s.ok);
  return (
    <GlassPanel className="space-y-3 p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <Badge hue={done === steps.length ? 140 : 45}>
          {done}/{steps.length}
        </Badge>
      </div>
      <div className="space-y-1.5">
        {steps.map((s, i) => {
          const active = s === next;
          return (
            <div key={i} className={`rounded-lg px-3 py-1.5 ${active ? "bg-white/5" : ""}`}>
              <div className="flex items-center gap-2 text-sm">
                <span style={{ color: s.ok ? "var(--color-neon-lime)" : active ? "var(--color-neon-amber)" : "var(--color-muted)" }}>
                  {s.ok ? "✓" : active ? "→" : "○"}
                </span>
                <span className={s.ok ? "" : active ? "font-medium" : "text-muted"}>{s.label}</span>
                {s.detail && <span className="text-muted font-mono text-xs">{s.detail}</span>}
              </div>
              {!s.ok && active && s.how && (
                <p className="text-muted mt-1 pl-6 text-xs" style={{ userSelect: "text" }}>
                  {s.how}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {list.note && <p className="text-muted/70 text-xs">{list.note}</p>}
    </GlassPanel>
  );
}

export function DashboardPage() {
  const { data: manifest } = useManifest();
  const { data: metrics } = useMetrics();
  const { data: failures } = useRuns({ status: "error", limit: 5 });
  const users = useProbe("users", "/identity/users", (r) => arr(r, "users").length);
  const customers = useProbe("customers", "/billing/api/customers", (r) => {
    const rows = arr(r, "customers") as Array<{ entitled?: unknown }>;
    return { total: rows.length, entitled: rows.filter((c) => c.entitled === true || c.entitled === "yes").length };
  });
  const checklists = manifest?.checklists ?? [];

  if (!metrics && !manifest) return <Spinner />;

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle={metrics ? `${metrics.window.label} · ${metrics.inFlight} in flight` : undefined} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={`runs (${metrics?.window.label ?? "…"})`} value={metrics?.runs ?? "…"} />
        <Stat
          label={`errors · ${metrics ? Math.round(metrics.errorRate * 100) : 0}%`}
          value={metrics?.errors ?? "…"}
          tone={metrics && metrics.errors > 0 ? "pink" : "lime"}
        />
        {users.data != null && <Stat label="users" value={users.data} />}
        {customers.data != null && (
          <Stat label={`customers · ${customers.data.entitled} entitled`} value={customers.data.total} tone={customers.data.entitled > 0 ? "lime" : undefined} />
        )}
      </div>

      {checklists.length > 0 && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {checklists.map((c) => (
            <ChecklistCard key={`${c.mod}:${c.id}`} title={c.title} path={c.route.path} />
          ))}
        </div>
      )}

      {(failures ?? []).length > 0 && (
        <GlassPanel className="space-y-2 p-6">
          <h3 className="font-semibold">Recent failures</h3>
          <div className="space-y-1">
            {(failures ?? []).map((r) => (
              <Link
                key={r.runId}
                to={`/runs/${r.runId}`}
                className="flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 text-sm hover:bg-white/5"
              >
                <span className="min-w-0 truncate font-mono text-xs">{r.workflowId}</span>
                <span className="text-muted shrink-0 text-xs">
                  {r.endTime ? new Date(r.endTime).toLocaleTimeString() : ""}
                </span>
              </Link>
            ))}
          </div>
          <Link to="/runs" className="text-muted hover:text-[var(--fg)] text-xs">
            All runs →
          </Link>
        </GlassPanel>
      )}
    </div>
  );
}
