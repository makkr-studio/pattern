/**
 * ```workflow fence → a live read-only graph. Parses the fence body as a
 * workflow JSON doc, fetches the op catalog once (module-cached), and lazily
 * loads the xyflow canvas so reading pages never pay for it.
 */

import React, { Suspense, useEffect, useState } from "react";
import { fetchOps } from "../lib/api";
import type { OpInfo } from "../../shared/types";
import type { WorkflowDocLite } from "./WorkflowGraph";

const WorkflowGraph = React.lazy(() => import("./WorkflowGraph"));

export function WorkflowEmbed({ source }: { source: string }) {
  const [ops, setOps] = useState<OpInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  let doc: WorkflowDocLite | null = null;
  try {
    const parsed = JSON.parse(source) as WorkflowDocLite;
    if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) doc = parsed;
  } catch {
    /* fall through to the error card */
  }

  useEffect(() => {
    if (!doc) return;
    void fetchOps()
      .then(setOps)
      .catch(() => setError("op catalog unavailable"));
  }, [doc != null]);

  if (!doc) {
    return (
      <div className="glass my-5 rounded-2xl px-4 py-3 text-[12.5px] text-muted">
        ⚠ This <code>workflow</code> block isn&rsquo;t valid workflow JSON (needs <code>nodes</code> + <code>edges</code>).
      </div>
    );
  }
  if (error) {
    return (
      <pre>
        <code>{source}</code>
      </pre>
    );
  }
  if (!ops) {
    return <div className="glass my-5 flex h-[200px] items-center justify-center rounded-2xl text-[12.5px] text-muted">loading graph…</div>;
  }
  return (
    <Suspense
      fallback={
        <div className="glass my-5 flex h-[200px] items-center justify-center rounded-2xl text-[12.5px] text-muted">loading graph…</div>
      }
    >
      <WorkflowGraph doc={doc} ops={ops} />
    </Suspense>
  );
}
