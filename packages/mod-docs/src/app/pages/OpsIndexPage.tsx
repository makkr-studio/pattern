/**
 * The generated op reference index — rendered from THIS installation's live
 * registry, grouped by category, with a filter box. Never stale by design.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { fuzzyFilter } from "../lib/fuzzy";
import type { OpInfo } from "../../shared/types";

const KIND_DOT: Record<string, string> = {
  value: "var(--color-port-value)",
  stream: "var(--color-port-stream)",
  control: "var(--color-port-control)",
};

export function OpsIndexPage() {
  const [ops, setOps] = useState<OpInfo[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    void api.ops().then(setOps).catch(() => setOps([]));
  }, []);

  const groups = useMemo(() => {
    if (!ops) return [];
    const filtered = fuzzyFilter(ops, q, (o) => `${o.type} ${o.title ?? ""} ${o.description ?? ""}`);
    const byCat = new Map<string, OpInfo[]>();
    for (const op of filtered) {
      if (!byCat.has(op.category)) byCat.set(op.category, []);
      byCat.get(op.category)!.push(op);
    }
    return [...byCat.entries()];
  }, [ops, q]);

  if (!ops) return <div className="px-8 py-10 text-[13px] text-muted">loading…</div>;

  return (
    <div className="mx-auto max-w-[78ch] px-5 py-8 md:px-10">
      <h1 className="text-[26px] font-semibold tracking-tight">Op reference</h1>
      <p className="mt-1.5 text-[14px] text-muted">
        Generated from the live registry of <em>this</em> installation — {ops.length} ops. The
        prose is hand-written; the signatures can&rsquo;t go stale because they&rsquo;re never written down.
      </p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter ops…"
        className="glass mt-4 w-full max-w-sm rounded-lg px-3 py-1.5 text-[13.5px] outline-none"
        style={{ color: "var(--fg)" }}
      />

      {groups.map(([category, items]) => (
        <section key={category} className="mt-8">
          <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted">{category}</h2>
          <div className="glass mt-2 overflow-hidden rounded-2xl">
            {items.map((op) => (
              <Link
                key={op.type}
                to={`/ops/${op.type}`}
                className="flex items-baseline gap-3 border-b px-4 py-2.5 transition-colors hairline last:border-b-0 hover:bg-[var(--glass-bg)]"
              >
                <code className="shrink-0 text-[13px]">{op.type}</code>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{op.description}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {op.boundary && (
                    <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted hairline">{op.boundary}</span>
                  )}
                  {[...new Set([...op.inputs, ...op.outputs].map((p) => p.kind))].map((kind) => (
                    <span key={kind} className="h-2 w-2 rounded-full" style={{ background: KIND_DOT[kind] }} title={kind} />
                  ))}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
