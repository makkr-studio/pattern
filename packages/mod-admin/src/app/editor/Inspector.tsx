/**
 * The node inspector: one node's identity (name, comment), reliability (retry
 * policy), and config — a form from the op's schema with typed widgets for
 * schema-valued fields, sub-workflow refs, and `requireAuth`.
 */

import { useMemo, useState } from "react";
import type { Node as RFNode } from "@xyflow/react";
import type { OpInfo } from "@pattern-js/admin-sdk";
import { useWorkflows } from "../lib/queries";
import { FormFromSchema, RawJson, type FieldOverride } from "../components/FormFromSchema";
import { SchemaBuilder } from "../components/SchemaBuilder";
import { Markdown } from "../components/Markdown";
import { RequireAuthField } from "./RequireAuthField";
import { categoryOfType, categoryStyle, humanizeOp } from "../lib/categories";
import type { OpNodeData } from "./graph";

/**
 * Widget for SubworkflowRef config fields ({ workflowId } | { workflow }) on
 * higher-order ops (core.array.map, core.flow.try, …): pick a registered
 * workflow from a select instead of hand-writing JSON. An inline `workflow`
 * doc (advanced) still round-trips through the raw-JSON toggle.
 */
function WorkflowRefField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const { data: workflows } = useWorkflows();
  const current = (value as { workflowId?: string; workflow?: unknown } | undefined) ?? {};
  if (current.workflow) {
    return (
      <div className="text-muted text-xs">
        Inline workflow doc — edit via <span className="font-mono">raw JSON</span>.
      </div>
    );
  }
  return (
    <select
      value={current.workflowId ?? ""}
      onChange={(e) => onChange(e.target.value ? { workflowId: e.target.value } : undefined)}
      className="glass w-full rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]"
    >
      <option value="">— pick a workflow —</option>
      {(workflows ?? []).map((w) => (
        <option key={w.slug} value={w.slug}>
          {w.slug}
        </option>
      ))}
    </select>
  );
}

/**
 * Config fields that hold a JSON Schema get the visual builder instead of a
 * raw JSON box. Keyed by op type — mods with schema-valued fields can be added
 * here (or we promote this to op metadata later).
 */
const SCHEMA_FIELDS: Record<string, string[]> = {
  "core.schema.define": ["schema"],
  "core.schema.validate": ["schema"],
  "boundary.http.request": ["body", "query", "params"],
  "boundary.ws.message": ["message"],
  "boundary.tool": ["params"],
};

export const INPUT_CLS = "glass w-full rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]";

export function Inspector({
  node,
  op,
  onChange,
  onMeta,
}: {
  node: RFNode<OpNodeData>;
  op?: OpInfo;
  onChange: (config: Record<string, unknown>) => void;
  onMeta: (meta: { title?: string; comment?: string; retry?: OpNodeData["retry"] }) => void;
}) {
  const [raw, setRaw] = useState(false);
  const cat = categoryStyle(categoryOfType(node.data.op));
  const config = (node.data.config ?? {}) as Record<string, unknown>;
  const { Icon } = cat;
  const hasSchema = op?.configSchema != null && (op.configSchema as { type?: string }).type === "object";
  const schemaOverrides = useMemo(() => {
    const o: Record<string, FieldOverride> = {};
    for (const f of SCHEMA_FIELDS[node.data.op] ?? []) {
      o[f] = ({ value, onChange: set }) => <SchemaBuilder value={value as Record<string, unknown> | undefined} onChange={set} />;
    }
    // Higher-order ops: a `workflow` config property is a SubworkflowRef —
    // render the picker (detected from the schema, so mod ops get it too).
    const props = (op?.configSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
    if (props && "workflow" in props && !o.workflow) {
      o.workflow = ({ value, onChange: set }) => <WorkflowRefField value={value} onChange={set} />;
    }
    // Boundary triggers: `requireAuth` gets the auth/scope selector (the union
    // renders poorly as a plain form field, and auth deserves a real control).
    if (props && "requireAuth" in props && !o.requireAuth) {
      o.requireAuth = ({ value, onChange: set }) => <RequireAuthField value={value} onChange={set} />;
    }
    return Object.keys(o).length ? o : undefined;
  }, [node.data.op, op?.configSchema]);

  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon size={15} style={{ color: cat.color }} className="shrink-0" />
        <span className="font-mono text-[11px]" style={{ color: cat.color }}>
          {node.data.op}
        </span>
        {op && (op.effects === undefined || op.effects === "external" || op.effects === "dynamic") && !node.data.op.startsWith("boundary.") && (
          <span
            className="ml-auto rounded-full bg-[var(--color-neon-amber)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--color-neon-amber)]"
            title={
              op.effects === "dynamic"
                ? "Effects depend on this node's config — the engine treats it as external unless the config says otherwise."
                : op.effects === "external"
                  ? "Declared external: sends, charges, or writes outside this process. A resume never repeats it blindly."
                  : "Undeclared effects — the engine treats it as external (it may send, charge, or write)."
            }
          >
            external
          </span>
        )}
      </div>
      {op?.description && (
        <div className="text-muted mt-2 text-xs">
          <Markdown text={op.description} />
        </div>
      )}
      {node.data.pairId && (
        <div className="text-muted mt-2 text-xs">
          ⛓ Paired with <span className="font-mono">{node.data.pairId}</span> — boundary pairs are created and deleted together.
        </div>
      )}

      {/* Author-set node identity */}
      <div className="mt-4 space-y-2">
        <div>
          <div className="text-muted mb-1 text-xs">Name</div>
          <input className={INPUT_CLS} value={node.data.title ?? ""} placeholder={humanizeOp(node.data.op)} onChange={(e) => onMeta({ title: e.target.value || undefined })} />
        </div>
        <div>
          <div className="text-muted mb-1 text-xs">Comment (markdown)</div>
          <textarea
            className="glass h-16 w-full rounded-lg p-2 text-xs outline-none focus:ring-1 focus:ring-[var(--color-neon-cyan)]"
            value={node.data.comment ?? ""}
            placeholder="What does this step do?"
            onChange={(e) => onMeta({ comment: e.target.value || undefined })}
          />
        </div>
      </div>

      {/* Reliability: the per-node retry policy (engine-read; validator warns
          on external-effects ops and stream inputs — surfaced under Issues). */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="text-muted text-xs font-semibold uppercase tracking-wider">Reliability</span>
          {node.data.retry ? (
            <button type="button" className="text-muted text-[10px] underline" onClick={() => onMeta({ retry: undefined })}>
              remove retry
            </button>
          ) : (
            <button type="button" className="text-muted text-[10px] underline" onClick={() => onMeta({ retry: { attempts: 3, backoffMs: 500 } })}>
              + retry on failure
            </button>
          )}
        </div>
        {node.data.retry && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(
              [
                ["attempts", "Attempts (total)", 1, 10, "3"],
                ["backoffMs", "Backoff (ms)", 0, undefined, "500"],
                ["factor", "Backoff factor", 1, undefined, "2"],
                ["maxBackoffMs", "Max backoff (ms)", 0, undefined, "30000"],
              ] as const
            ).map(([key, label, min, max, placeholder]) => (
              <div key={key}>
                <div className="text-muted mb-1 text-xs">{label}</div>
                <input
                  type="number"
                  className={INPUT_CLS}
                  min={min}
                  max={max}
                  placeholder={placeholder}
                  value={node.data.retry?.[key] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? undefined : Number(e.target.value);
                    const next = { ...node.data.retry!, [key]: v };
                    if (v === undefined) delete (next as Record<string, unknown>)[key];
                    onMeta({ retry: { ...next, attempts: next.attempts ?? 3 } });
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 mb-2 flex items-center justify-between">
        <span className="text-muted text-xs font-semibold uppercase tracking-wider">Config</span>
        {hasSchema && (
          <button type="button" className="text-muted text-[10px] underline" onClick={() => setRaw((r) => !r)}>
            {raw ? "form" : "raw JSON"}
          </button>
        )}
      </div>

      {raw || !hasSchema ? (
        <RawJson value={config} onChange={onChange} />
      ) : (
        <FormFromSchema schema={op!.configSchema as Record<string, unknown>} value={config} onChange={onChange} overrides={schemaOverrides} />
      )}
    </div>
  );
}
