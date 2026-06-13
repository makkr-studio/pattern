/**
 * One op: hand-written "when to use" prose (when the owning mod ships
 * ops/<type>.md) above the GENERATED ports/config tables from the live
 * registry — plus used-by links and an admin deep link for readers who
 * actually have the admin.
 */

import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, hasAdminAccess } from "../lib/api";
import { Markdown } from "../lib/md";
import { highlight } from "../lib/highlight";
import { useDocs } from "../shell/Shell";
import type { OpInfo, PortInfo } from "../../shared/types";

/** Port data-type → the admin's type colors (arrays take their element hue family). */
function typeColor(dataType: string): string {
  if (dataType.includes("|") || dataType === "any") return "var(--color-type-any)";
  if (dataType.endsWith("[]") || dataType === "array") return "var(--color-type-array)";
  const base = dataType.replace(/\[\]$/, "");
  const map: Record<string, string> = {
    string: "var(--color-type-string)",
    number: "var(--color-type-number)",
    integer: "var(--color-type-number)",
    boolean: "var(--color-type-boolean)",
    object: "var(--color-type-object)",
    enum: "var(--color-type-string)",
  };
  return map[base] ?? "var(--color-type-any)";
}

/**
 * The port's dot color — the admin's convention: a value port shows what
 * FLOWS through it (its data type), while stream/control keep their kind hue
 * (those carry meaning the type label can't, and the kind is shown anyway).
 */
function dotColor(p: PortInfo): string {
  if (p.kind === "stream") return "var(--color-port-stream)";
  if (p.kind === "control") return "var(--color-port-control)";
  return p.dataType ? typeColor(p.dataType) : "var(--color-port-value)";
}

/** True when the schema says more than the dataType label already does. */
function schemaWorthExpanding(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const keys = Object.keys(schema as object).filter((k) => k !== "type");
  return keys.length > 0;
}

function PortTable({ title, ports }: { title: string; ports: PortInfo[] }) {
  if (!ports.length) return null;
  return (
    <section className="mt-6">
      <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted">{title}</h2>
      <div className="glass mt-2 overflow-hidden rounded-2xl">
        {ports.map((p) => (
          <div key={p.name} className="border-b px-4 py-2 hairline last:border-b-0">
            <div className="flex items-baseline gap-3">
              <span className="flex shrink-0 items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: dotColor(p) }} title={`${p.kind} port`} />
                <code className="text-[13px]">{p.name}</code>
              </span>
              {p.dataType && (
                <code className="shrink-0 text-[11.5px]" style={{ color: typeColor(p.dataType) }}>
                  {p.dataType}
                </code>
              )}
              <span className="shrink-0 text-[11px] text-muted">{p.kind === "value" ? "" : p.kind}</span>
              {p.required && <span className="shrink-0 text-[11px] text-[var(--color-neon-amber)]">required</span>}
              <span className="min-w-0 flex-1 text-[12.5px] text-muted">{p.description}</span>
            </div>
            {schemaWorthExpanding(p.schema) && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] text-muted hover:text-[var(--fg)]">schema</summary>
                <pre className="mt-1 overflow-x-auto rounded-lg px-3 py-2 text-[11px] leading-relaxed" style={{ background: "var(--pre-bg)" }}>
                  <code>{highlight(JSON.stringify(p.schema, null, 2), "json")}</code>
                </pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function OpPage() {
  const { manifest } = useDocs();
  const type = useParams()["*"] ?? "";
  const [data, setData] = useState<{ info: OpInfo; prose: string | null } | null>(null);
  const [missing, setMissing] = useState(false);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    setData(null);
    setMissing(false);
    void api
      .op(type)
      .then(setData)
      .catch(() => setMissing(true));
    void hasAdminAccess(manifest.adminMount).then(setAdmin);
  }, [type]);

  if (missing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[14px] text-muted">
        <div>
          Unknown op <code>{type}</code> — not registered in this installation.
        </div>
        <Link to="/ops" className="text-[var(--color-neon-cyan)] underline underline-offset-2">
          Back to the reference
        </Link>
      </div>
    );
  }
  if (!data) return <div className="px-8 py-10 text-[13px] text-muted">loading…</div>;
  const { info, prose } = data;

  return (
    <div className="mx-auto max-w-[78ch] px-5 py-8 md:px-10">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <Link to="/ops" className="hover:text-[var(--fg)]">
          Op reference
        </Link>
        <span>/</span>
        <span>{info.category}</span>
        {info.mod && <span className="rounded-full border px-2 py-0.5 hairline">{info.mod}</span>}
        {info.boundary && (
          <span className="rounded-full border px-2 py-0.5 hairline">
            {info.boundary}
            {info.pair ? ` · pairs with ${info.pair}` : ""}
          </span>
        )}
      </div>
      <h1 className="mt-2 font-mono text-[24px] font-semibold tracking-tight">{info.type}</h1>
      {info.description && <p className="mt-1.5 max-w-[65ch] text-[14.5px] text-muted">{info.description}</p>}

      {prose && (
        <div className="glass mt-5 rounded-2xl px-5 py-4">
          <Markdown text={prose} />
        </div>
      )}

      <PortTable title="Inputs" ports={info.inputs} />
      <PortTable title="Outputs" ports={info.outputs} />
      <PortTable title="Config inputs (registration-time)" ports={info.configInputs} />

      {info.controlOut.length > 0 && (
        <section className="mt-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted">Named control-outs</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {info.controlOut.map((c) => (
              <code key={c} className="rounded-md border px-2 py-0.5 text-[12px] hairline">
                {c}
              </code>
            ))}
          </div>
        </section>
      )}

      {info.configSchema != null && (
        <section className="mt-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted">Config schema</h2>
          <pre className="glass mt-2 overflow-x-auto rounded-2xl px-4 py-3 text-[12px] leading-relaxed">
            <code>{highlight(JSON.stringify(info.configSchema, null, 2), "json")}</code>
          </pre>
        </section>
      )}

      <section className="mt-6 flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
        <span>
          Used by {info.usedBy} workflow{info.usedBy === 1 ? "" : "s"}
          {info.usedByWorkflows.length > 0 && (
            <>
              {": "}
              {info.usedByWorkflows.slice(0, 6).map((id, i) => (
                <React.Fragment key={id}>
                  {i > 0 && ", "}
                  <code>{id}</code>
                </React.Fragment>
              ))}
              {info.usedByWorkflows.length > 6 && " …"}
            </>
          )}
        </span>
        {admin && (
          <a
            href={`${manifest.adminMount}/ops`}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-neon-cyan)] underline underline-offset-2"
          >
            open in admin ↗
          </a>
        )}
      </section>
    </div>
  );
}
