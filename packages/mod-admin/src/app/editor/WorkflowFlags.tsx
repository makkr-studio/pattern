/**
 * The workflow-level execution knobs — Offload (worker pool) and Durable
 * (RunLedger) — with their honest copy. Shared by the editor's Workflow panel
 * (edits the draft) and the workflow's Settings tab (saves a version).
 */

import { Cpu, Database } from "lucide-react";

export interface WorkflowFlagsValue {
  offload: boolean;
  durable: boolean;
}

export function WorkflowFlags({
  value,
  onChange,
  cpuHeavyCount = 0,
  disabled,
}: {
  value: WorkflowFlagsValue;
  onChange: (next: WorkflowFlagsValue) => void;
  /** Canvas nodes whose op is `cpuHeavy` — drives the Offload nudge. */
  cpuHeavyCount?: number;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      <label className={`flex items-start gap-3 ${disabled ? "opacity-70" : "cursor-pointer"}`}>
        <input
          type="checkbox"
          checked={value.durable}
          disabled={disabled}
          className="mt-0.5 accent-[var(--color-neon-cyan)]"
          onChange={(e) => onChange({ ...value, durable: e.target.checked })}
        />
        <span>
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Database size={13} /> Durable runs (resume &amp; re-run)
          </span>
          <span className="text-muted mt-0.5 block text-xs leading-relaxed">
            Record each run&rsquo;s exact input and every node&rsquo;s exact outputs in the RunLedger, so a failed run can resume
            from the failing node and any run can re-run with the same input. Costs one ledger write per node, and the ledger
            stores REAL values (under <span className="font-mono">.pattern-data/</span> — gitignored; protect it like your
            database). Best where correctness beats latency: payments, webhooks, provisioning.
          </span>
        </span>
      </label>

      <label className={`flex items-start gap-3 ${disabled ? "opacity-70" : "cursor-pointer"}`}>
        <input
          type="checkbox"
          checked={value.offload}
          disabled={disabled}
          className="mt-0.5 accent-[var(--color-neon-cyan)]"
          onChange={(e) => onChange({ ...value, offload: e.target.checked })}
        />
        <span>
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Cpu size={13} /> Offload to the worker pool
          </span>
          <span className="text-muted mt-0.5 block text-xs leading-relaxed">
            Run this whole workflow off the host event loop, on the worker pool, so its compute can&rsquo;t stall the loop (and
            the admin). Default is inline — only flag CPU-heavy workflows. Needs a pool configured (
            <span className="font-mono">workers</span> in <span className="font-mono">pattern.config.json</span>); with none it
            runs inline. Offloaded runs use the worker&rsquo;s own services, can&rsquo;t reach live WebSocket sockets, and
            aren&rsquo;t pausable from the editor.
          </span>
        </span>
      </label>

      <div
        className={`rounded-lg border px-2.5 py-1.5 text-[11px] leading-relaxed ${
          cpuHeavyCount > 0 && !value.offload
            ? "border-[var(--color-neon-amber)]/40 bg-[var(--color-neon-amber)]/10 text-[var(--color-neon-amber)]"
            : "glass text-muted"
        }`}
      >
        {cpuHeavyCount > 0
          ? value.offload
            ? `${cpuHeavyCount} cpu-heavy node${cpuHeavyCount > 1 ? "s" : ""} on the canvas — they run on the pool.`
            : `⚠ ${cpuHeavyCount} cpu-heavy node${cpuHeavyCount > 1 ? "s" : ""} on the canvas — Offload recommended.`
          : "No cpu-heavy nodes on the canvas. Leave Offload off unless this workflow does heavy compute."}
      </div>
    </div>
  );
}
