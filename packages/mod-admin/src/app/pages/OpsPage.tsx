import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { OpInfo, PortInfo } from "@pattern/admin-sdk";
import { useOps } from "../lib/queries";
import { Badge, GlassPanel, GlowCard, JsonView, PageHeader, Spinner } from "../components/ui";
import { categoryStyle } from "../lib/categories";
import { portFill, portTypeLabel } from "../lib/format";
import { fuzzyFilter } from "../lib/fuzzy";
import { sfx } from "../lib/sfx";
import { Search } from "../components/icon";

function Port({ p, config }: { p: PortInfo; config?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className="inline-block h-2.5 w-2.5"
        style={{ background: portFill(p), borderRadius: config ? 2 : "50%" }}
      />
      <span className="font-mono">{p.name}</span>
      <span className="text-muted text-xs">{portTypeLabel(p)}</span>
      {p.required && <span className="text-[var(--color-neon-amber)] text-xs">required</span>}
      {config && <span className="text-muted text-xs">config</span>}
    </div>
  );
}

function OpDetail({ op }: { op: OpInfo }) {
  const navigate = useNavigate();
  return (
    <GlassPanel className="p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-lg font-semibold">{op.type}</h2>
        {op.boundary && <Badge hue={40}>{op.boundary}</Badge>}
        {op.mod && <Badge hue={280}>{op.mod}</Badge>}
      </div>
      {op.description && <p className="text-muted mt-2 text-sm">{op.description}</p>}
      {op.pair && (
        <p className="text-muted mt-2 text-xs">
          ⛓ Pairs with <span className="font-mono">{op.pair}</span> — boundary triggers and out-gates are added and removed together.
        </p>
      )}
      <div className="mt-5 grid grid-cols-2 gap-6">
        <div>
          <div className="text-muted mb-2 text-xs font-semibold uppercase tracking-wider">Inputs</div>
          {(op.configInputs ?? []).map((p) => (
            <Port key={`c-${p.name}`} p={p} config />
          ))}
          {op.inputs.length ? op.inputs.map((p) => <Port key={p.name} p={p} />) : (op.configInputs ?? []).length === 0 && <span className="text-muted text-sm">none</span>}
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
      {/* Who uses this op — each chip opens that workflow in the editor. */}
      <div className="mt-5">
        <div className="text-muted mb-2 text-xs font-semibold uppercase tracking-wider">
          Used by {op.usedBy} workflow{op.usedBy === 1 ? "" : "s"}
        </div>
        {(op.usedByWorkflows ?? []).length === 0 ? (
          <span className="text-muted text-sm">No registered workflow uses it yet.</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {(op.usedByWorkflows ?? []).map((wf) => (
              <button
                key={wf}
                type="button"
                title={`Open ${wf} in the editor`}
                onClick={() => {
                  sfx.play("nav");
                  navigate(`/editor/${wf}`);
                }}
                className="glass rounded-lg px-2.5 py-1 font-mono text-xs hover:bg-white/10 hover:text-[var(--color-neon-cyan)]"
              >
                {wf} ↗
              </button>
            ))}
          </div>
        )}
      </div>
    </GlassPanel>
  );
}

export function OpsPage() {
  const navigate = useNavigate();
  const { type } = useParams();
  const { data, isLoading } = useOps();
  const [query, setQuery] = useState("");
  const [mod, setMod] = useState("");

  const mods = useMemo(() => [...new Set((data ?? []).map((o) => o.mod ?? "core"))].sort(), [data]);
  const filtered = useMemo(() => {
    let list = data ?? [];
    if (mod) list = list.filter((o) => (o.mod ?? "core") === mod);
    // Type + title only — descriptions are prose and drown the type ranking.
    return fuzzyFilter(list, query, (o) => `${o.type} ${o.title ?? ""}`);
  }, [data, query, mod]);
  const searching = query.trim().length > 0;

  const byCategory = useMemo(() => {
    const m = new Map<string, OpInfo[]>();
    for (const op of filtered) {
      const list = m.get(op.category) ?? [];
      list.push(op);
      m.set(op.category, list);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  // Landing on /ops/<type> (link, ⌘K, reload): bring the current op into view
  // in the list, so the highlight is actually visible.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!type || !data) return;
    const el = listRef.current?.querySelector(`[data-op-type="${CSS.escape(type)}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [type, data]);

  if (isLoading) return <Spinner />;
  const selected = (data ?? []).find((o) => o.type === type);

  const opCard = (op: OpInfo) => {
    const current = op.type === type;
    const accent = current ? categoryStyle(op.category).color : undefined;
    return (
      <GlowCard
        key={op.type}
        // The list scrolls the current op into view (see the effect above) —
        // landing on /ops/<type> from anywhere finds it highlighted in place.
        data-op-type={op.type}
        onClick={() => {
          sfx.play("nav");
          navigate(`/ops/${op.type}`);
        }}
        className="px-3 py-2"
        style={current ? { boxShadow: `inset 0 0 0 1.5px ${accent}, 0 0 12px color-mix(in srgb, ${accent} 30%, transparent)` } : undefined}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-sm" style={current ? { color: accent } : undefined}>{op.type}</span>
          <span className="text-muted shrink-0 text-xs">{op.usedBy}×</span>
        </div>
      </GlowCard>
    );
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <PageHeader title="Ops" subtitle={`${data?.length ?? 0} ops — base catalog + mod contributions. Living docs.`} />
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_1.4fr] gap-6">
        {/* Left: filterable list, scrolls on its own */}
        <div className="flex min-h-0 flex-col">
          <div className="mb-3 flex gap-2">
            <div className="glass flex flex-1 items-center gap-2 rounded-xl px-3 py-2">
              <Search size={14} className="text-muted shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Fuzzy search ops…"
                aria-label="Search ops"
                className="w-full bg-transparent text-sm outline-none"
              />
              {query && (
                <button type="button" aria-label="Clear search" className="text-muted text-xs" onClick={() => setQuery("")}>
                  ✕
                </button>
              )}
            </div>
            <select
              value={mod}
              onChange={(e) => setMod(e.target.value)}
              aria-label="Filter by mod"
              className="glass rounded-xl px-3 py-2 text-sm outline-none [&>option]:bg-[var(--bg)]"
            >
              <option value="">All mods</option>
              {mods.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div ref={listRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 pb-4">
            {filtered.length === 0 && <GlassPanel className="text-muted p-8 text-center text-sm">No ops match.</GlassPanel>}
            {searching ? (
              // Ranked flat list while searching (best match first).
              <div className="grid gap-2">{filtered.map(opCard)}</div>
            ) : (
              byCategory.map(([category, ops]) => (
                <div key={category}>
                  <div className="text-muted mb-2 text-xs font-semibold uppercase tracking-wider">{category}</div>
                  <div className="grid gap-2">{ops.map(opCard)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: detail, scrolls on its own */}
        <div className="min-h-0 overflow-y-auto pb-4">
          {selected ? (
            <OpDetail op={selected} />
          ) : (
            <GlassPanel className="text-muted grid place-items-center p-12 text-sm">Select an op to inspect its ports + config schema.</GlassPanel>
          )}
        </div>
      </div>
    </div>
  );
}
