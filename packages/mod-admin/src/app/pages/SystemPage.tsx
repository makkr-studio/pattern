import type { ReactNode } from "react";
import { useSystemMap } from "../lib/queries";
import { Badge, GlassPanel, PageHeader, Spinner } from "../components/ui";

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <GlassPanel className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-semibold">{title}</h2>
        <Badge>{count}</Badge>
      </div>
      {count === 0 ? <div className="text-muted text-sm">none</div> : <div className="space-y-1.5">{children}</div>}
    </GlassPanel>
  );
}

function Row({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="font-mono">{left}</span>
      {right && <span className="text-muted text-xs">{right}</span>}
    </div>
  );
}

export function SystemPage() {
  const { data, isLoading } = useSystemMap();
  if (isLoading || !data) return <Spinner />;

  return (
    <>
      <PageHeader
        title="System map"
        subtitle={`Listening ports: ${data.ports.length ? data.ports.join(", ") : "default"} — derived live from registered workflows.`}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="HTTP routes" count={data.routes.length}>
          {data.routes.map((r, i) => (
            <Row
              key={i}
              left={
                <span className={r.conflict ? "text-[var(--color-neon-pink)]" : ""}>
                  {r.method} {r.path}
                  {r.port ? `  :${r.port}` : ""}
                  {r.conflict && " ⚠"}
                </span>
              }
              right={r.workflow}
            />
          ))}
        </Section>

        <Section title="Static apps" count={data.apps.length}>
          {data.apps.map((a, i) => (
            <Row key={i} left={`${a.mount}${a.port ? `  :${a.port}` : ""}`} right={`${a.workflow} · ${a.filesystem}`} />
          ))}
        </Section>

        <Section title="Schedules" count={data.schedules.length}>
          {data.schedules.map((s, i) => (
            <Row key={i} left={s.cron ?? (s.intervalMs ? `every ${s.intervalMs}ms` : "—")} right={s.workflow} />
          ))}
        </Section>

        <Section title="Hook chains" count={data.hooks.length}>
          {data.hooks.map((h, i) => (
            <Row key={i} left={`${h.hook}`} right={`${h.workflow} · priority ${h.priority}`} />
          ))}
        </Section>

        <Section title="Event subscriptions" count={data.events.length}>
          {data.events.map((e, i) => (
            <Row key={i} left={e.event} right={e.workflow} />
          ))}
        </Section>

        <Section title="WebSocket" count={data.ws.length}>
          {data.ws.map((w, i) => (
            <Row key={i} left={w.kind} right={w.workflow} />
          ))}
        </Section>
      </div>
    </>
  );
}
