/**
 * Installed mods — from the live engine: what each contributed (ops,
 * workflows) and a link to its docs chapter when it ships one.
 */

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { ModInfo } from "../../shared/types";

export function ModsPage() {
  const [mods, setMods] = useState<ModInfo[] | null>(null);

  useEffect(() => {
    void api.mods().then(setMods).catch(() => setMods([]));
  }, []);

  if (!mods) return <div className="px-8 py-10 text-[13px] text-muted">loading…</div>;

  return (
    <div className="mx-auto max-w-[78ch] px-5 py-8 md:px-10">
      <h1 className="text-[26px] font-semibold tracking-tight">Installed mods</h1>
      <p className="mt-1.5 text-[14px] text-muted">
        What&rsquo;s actually loaded in this installation — and every mod that ships docs gets its
        chapter in the sidebar automatically.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {mods.map((m) => (
          <div key={m.name} className="glass rounded-2xl px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <code className="text-[13.5px] font-medium">{m.name}</code>
              {m.chapter && (
                <Link to={`/${m.chapter}`} className="shrink-0 text-[12px] text-[var(--color-neon-cyan)] underline underline-offset-2">
                  docs →
                </Link>
              )}
            </div>
            <div className="mt-1.5 text-[12px] text-muted">
              {m.ops.length} op{m.ops.length === 1 ? "" : "s"} · {m.workflows.length} workflow
              {m.workflows.length === 1 ? "" : "s"}
            </div>
            {m.ops.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {m.ops.slice(0, 8).map((op) => (
                  <Link key={op} to={`/ops/${op}`} className="rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] text-muted hairline hover:text-[var(--fg)]">
                    {op}
                  </Link>
                ))}
                {m.ops.length > 8 && <span className="text-[10.5px] text-muted">+{m.ops.length - 8}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
