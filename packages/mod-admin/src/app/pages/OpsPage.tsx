import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { OpInfo, PortInfo } from "@pattern/admin-sdk";
import { useOps } from "../lib/queries";
import { Badge, GlassPanel, GlowCard, JsonView, PageHeader, Spinner } from "../components/ui";
import { portColor } from "../lib/format";

function Port({ p }: { p: PortInfo }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: portColor(p.kind) }} />
      <span className="font-mono">{p.name}</span>
      <span className="text-muted text-xs">{p.kind}</span>
      {p.required && <span className="text-[var(--color-neon-amber)] text-xs">required</span>}
    </div>
  );
}

function OpDetail({ op }: { op: OpInfo }) {
  return (
    <GlassPanel className="p-6">
      <div className="flex items-center gap-3">
        <h2 className="font-mono text-lg font-semibold">{op.type}</h2>
        {op.boundary && <Badge hue={40}>{op.boundary}</Badge>}
        {op.mod && <Badge hue={280}>{op.mod}</Badge>}
      </div>
      {op.description && <p className="text-muted mt-2 text-sm">{op.description}</p>}
      <div className="mt-5 grid grid-cols-2 gap-6">
        <div>
          <div className="text-muted mb-2 text-xs font-semibold uppercase tracking-wider">Inputs</div>
          {op.inputs.length ? op.inputs.map((p) => <Port key={p.name} p={p} />) : <span className="text-muted text-sm">none</span>}
        </div>
        <div>
          <div className="text-muted mb-2 text-xs font-semibold uppercase tracking-wider">Outputs</div>
          {op.outputs.length ? op.outputs.map((p) => <Port key={p.name} p={p} />) : <span className="text-muted text-sm">none</span>}
          {op.controlOut.length > 0 && (
            <div className="text-muted mt-2 text-xs">control-outs: {op.controlOut.join(", ")}</div>
          )}
        </div>
      </div>
      {op.configSchema != null && (
        <div className="mt-5">
          <div className="text-muted mb-2 text-xs font-semibold uppercase tracking-wider">Config schema</div>
          <JsonView value={op.configSchema} className="max-h-72" />
        </div>
      )}
      <div className="text-muted mt-4 text-xs">Used by {op.usedBy} workflow(s).</div>
    </GlassPanel>
  );
}

export function OpsPage() {
  const navigate = useNavigate();
  const { type } = useParams();
  const { data, isLoading } = useOps();

  const byCategory = useMemo(() => {
    const m = new Map<string, OpInfo[]>();
    for (const op of data ?? []) {
      const list = m.get(op.category) ?? [];
      list.push(op);
      m.set(op.category, list);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  if (isLoading) return <Spinner />;
  const selected = (data ?? []).find((o) => o.type === type);

  return (
    <>
      <PageHeader title="Ops" subtitle={`${data?.length ?? 0} ops — base catalog + mod contributions. Living docs.`} />
      <div className="grid grid-cols-[1fr_1.4fr] gap-6">
        <div className="space-y-5">
          {byCategory.map(([category, ops]) => (
            <div key={category}>
              <div className="text-muted mb-2 text-xs font-semibold uppercase tracking-wider">{category}</div>
              <div className="grid gap-2">
                {ops.map((op) => (
                  <GlowCard key={op.type} onClick={() => navigate(`/ops/${op.type}`)} className={`px-3 py-2 ${op.type === type ? "ring-1 ring-[var(--color-neon-cyan)]" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm">{op.type}</span>
                      <span className="text-muted text-xs">{op.usedBy}×</span>
                    </div>
                  </GlowCard>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="sticky top-0">
          {selected ? (
            <OpDetail op={selected} />
          ) : (
            <GlassPanel className="text-muted grid place-items-center p-12 text-sm">Select an op to inspect its ports + config schema.</GlassPanel>
          )}
        </div>
      </div>
    </>
  );
}
