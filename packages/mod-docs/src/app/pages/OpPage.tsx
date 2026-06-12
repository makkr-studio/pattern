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
import { useDocs } from "../shell/Shell";
import type { OpInfo, PortInfo } from "../../shared/types";

const KIND_DOT: Record<string, string> = {
  value: "var(--color-port-value)",
  stream: "var(--color-port-stream)",
  control: "var(--color-port-control)",
};

function PortTable({ title, ports }: { title: string; ports: PortInfo[] }) {
  if (!ports.length) return null;
  return (
    <section className="mt-6">
      <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted">{title}</h2>
      <div className="mt-2 overflow-hidden rounded-2xl border hairline">
        {ports.map((p) => (
          <div key={p.name} className="flex items-baseline gap-3 border-b px-4 py-2 hairline last:border-b-0">
            <span className="flex shrink-0 items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: KIND_DOT[p.kind] }} title={p.kind} />
              <code className="text-[13px]">{p.name}</code>
            </span>
            <span className="shrink-0 text-[11px] text-muted">{p.kind}</span>
            {p.required && <span className="shrink-0 text-[11px] text-[var(--color-neon-amber)]">required</span>}
            <span className="min-w-0 flex-1 text-[12.5px] text-muted">{p.description}</span>
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
        <div className="mt-5 rounded-2xl border px-5 py-4 hairline" style={{ background: "var(--glass-bg)" }}>
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
          <pre className="mt-2 overflow-x-auto rounded-2xl border px-4 py-3 text-[12px] leading-relaxed hairline" style={{ background: "var(--pre-bg)" }}>
            <code>{JSON.stringify(info.configSchema, null, 2)}</code>
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
