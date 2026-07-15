/**
 * Pattern — the RunLedger (0.5, durable execution).
 *
 * A durable, full-fidelity record of a run: its exact trigger input and every
 * node's exact value outputs, written as the run progresses. This is what
 * "resume from the failing node" and "re-run with the same input" replay from.
 *
 * The ledger is deliberately NOT the trace store. Traces are a display surface:
 * sampled, capped at 4KB, secret-masked, streams never captured — right for an
 * admin UI, useless for resume. The ledger records real values, so it must be
 * protected like the database it is (the sqlite impl lives in `.pattern-data/`,
 * beside the identity and document stores, and is gitignored with them).
 *
 * Opt-in per workflow (`durable: true`): with no ledger bound, a run does zero
 * extra work per node.
 */

import type { Principal, Workflow } from "../types.js";

/** Engine service key under which the host provides the durable `RunLedger`. */
export const RUN_LEDGER = "runLedger";

/** Terminal-or-live status of a ledgered run. */
export type LedgerRunStatus = "running" | "ok" | "error" | "canceled";

/** The run header: everything needed to re-run from scratch, plus lineage. */
export interface LedgerRunHeader {
  runId: string;
  workflowId: string;
  /** Structural hash of the doc at run time — resume refuses a changed doc. */
  workflowHash: string;
  triggerNodeId: string;
  /** The exact trigger input (encoded values; stream inputs are unserializable). */
  input: Record<string, EncodedValue>;
  params?: Record<string, unknown>;
  principal: Principal;
  parentRunId?: string;
  /** Set on runs started by `resume`/`re-run` — the run they replay. */
  resumedFrom?: string;
  status: LedgerRunStatus;
  error?: { message: string; nodeId?: string };
  startedAt: number;
  endedAt?: number;
}

/** One node's durable record. `outputs` hold exact value-port values. */
export interface LedgerNodeRecord {
  runId: string;
  nodeId: string;
  status: "started" | "done" | "skipped" | "error";
  /** Encoded value-port outputs (absent for skipped/error/started). */
  outputs?: Record<string, EncodedValue>;
  /** Control-outs that fired; every other declared control-out seeds as skip. */
  pulsed?: string[];
  /** The node has stream outputs — it can never be seeded, only re-run. */
  streaming?: boolean;
  /** Some output value refused serialization — not seedable, run untouched. */
  unserializable?: boolean;
  startedAt?: number;
  endedAt?: number;
}

/** The write+read surface. Hosts provide it via `RUN_LEDGER`. */
export interface RunLedger {
  begin(header: LedgerRunHeader): void | Promise<void>;
  nodeStarted(runId: string, nodeId: string, at: number): void | Promise<void>;
  nodeFinished(record: LedgerNodeRecord): void | Promise<void>;
  end(runId: string, status: LedgerRunStatus, error?: LedgerRunHeader["error"]): void | Promise<void>;
  get(runId: string): Promise<{ header: LedgerRunHeader; nodes: LedgerNodeRecord[] } | null>;
  /** Trim old terminal runs; returns how many were dropped. */
  prune(opts?: { keep?: number }): number | Promise<number>;
  close?(): void;
}

// ── Value codec ─────────────────────────────────────────────────────────────
// JSON with one tagged extension (bytes). A value that still refuses to
// serialize (streams, functions, cycles) marks its node unseedable instead of
// failing the run — resume then re-runs that node.

/** An encoded value: tagged JSON text, or the unserializable marker. */
export type EncodedValue = { json: string } | { unserializable: true };

const BYTES_TAG = "__patternBytes";

/** Encode a runtime value for the ledger. */
export function encodeLedgerValue(v: unknown): EncodedValue {
  try {
    const json = JSON.stringify(v === undefined ? null : v, (_k, value: unknown) => {
      if (value instanceof ReadableStream) throw new Error("stream");
      if (typeof value === "function") throw new Error("function");
      if (value instanceof Uint8Array) {
        let bin = "";
        for (const b of value) bin += String.fromCharCode(b);
        // btoa is Web-standard (core stays runtime-neutral).
        return { [BYTES_TAG]: btoa(bin) };
      }
      return value;
    });
    if (json === undefined) return { unserializable: true };
    return { json };
  } catch {
    return { unserializable: true };
  }
}

/** Decode a ledgered value back to its runtime shape. */
export function decodeLedgerValue(v: EncodedValue): unknown {
  if ("unserializable" in v) return undefined;
  return JSON.parse(v.json, (_k, value: unknown) => {
    if (value && typeof value === "object" && BYTES_TAG in (value as Record<string, unknown>)) {
      const b64 = (value as Record<string, string>)[BYTES_TAG]!;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    return value;
  });
}

// ── Structural hash ─────────────────────────────────────────────────────────

/** Stable stringify: object keys sorted recursively, so hashes don't drift. */
function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}

/**
 * Structural hash of a workflow for resume pinning: nodes (id/op/config/retry)
 * and edges — layout (`ui`), comments, and run-shaping metadata like `offload`
 * and `durable` are ignored, mirroring the admin's behavioral-hash stance.
 */
export function ledgerWorkflowHash(workflow: Workflow): string {
  const doc = stable({
    nodes: [...workflow.nodes]
      .map((n) => ({ id: n.id, op: n.op, config: n.config, retry: n.retry }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...workflow.edges]
      .map((e) => ({ from: e.from, to: e.to }))
      .sort((a, b) => (`${a.from.node}${a.from.port}${a.to.node}${a.to.port}` < `${b.from.node}${b.from.port}${b.to.node}${b.to.port}` ? -1 : 1)),
  });
  // FNV-1a, 32-bit ×2 (seeded) — fast, sync, dependency-free; not cryptographic
  // (the ledger is local; this guards drift, not adversaries).
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < doc.length; i++) {
    const c = doc.charCodeAt(i);
    h1 = ((h1 ^ c) * 0x01000193) >>> 0;
    h2 = ((h2 ^ ((c << 1) | 1)) * 0x01000193) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

// ── Transport seam ──────────────────────────────────────────────────────────

/**
 * A serializable ledger write — the wire form for forwarding a worker run's
 * ledger records back to the host (mirrors `TraceEvent` for traces).
 */
export type LedgerEvent =
  | { kind: "begin"; header: LedgerRunHeader }
  | { kind: "nodeStarted"; runId: string; nodeId: string; at: number }
  | { kind: "nodeFinished"; record: LedgerNodeRecord }
  | { kind: "end"; runId: string; status: LedgerRunStatus; error?: LedgerRunHeader["error"] };

/** Replay one forwarded `LedgerEvent` into a ledger. */
export function applyLedgerEvent(ledger: RunLedger, e: LedgerEvent): void | Promise<void> {
  switch (e.kind) {
    case "begin":
      return ledger.begin(e.header);
    case "nodeStarted":
      return ledger.nodeStarted(e.runId, e.nodeId, e.at);
    case "nodeFinished":
      return ledger.nodeFinished(e.record);
    case "end":
      return ledger.end(e.runId, e.status, e.error);
  }
}

// ── In-memory implementation (tests, standalone engines) ────────────────────

/** A Map-backed `RunLedger` — the reference impl and the test double. */
export class MemoryRunLedger implements RunLedger {
  private readonly runs = new Map<string, { header: LedgerRunHeader; nodes: Map<string, LedgerNodeRecord> }>();

  begin(header: LedgerRunHeader): void {
    this.runs.set(header.runId, { header: { ...header }, nodes: new Map() });
  }

  nodeStarted(runId: string, nodeId: string, at: number): void {
    const run = this.runs.get(runId);
    if (!run) return;
    if (!run.nodes.has(nodeId)) run.nodes.set(nodeId, { runId, nodeId, status: "started", startedAt: at });
  }

  nodeFinished(record: LedgerNodeRecord): void {
    const run = this.runs.get(record.runId);
    if (!run) return;
    run.nodes.set(record.nodeId, { ...record });
  }

  end(runId: string, status: LedgerRunStatus, error?: LedgerRunHeader["error"]): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.header.status = status;
    run.header.error = error;
    run.header.endedAt = Date.now();
  }

  async get(runId: string): Promise<{ header: LedgerRunHeader; nodes: LedgerNodeRecord[] } | null> {
    const run = this.runs.get(runId);
    return run ? { header: { ...run.header }, nodes: [...run.nodes.values()] } : null;
  }

  prune(opts?: { keep?: number }): number {
    const keep = opts?.keep ?? 200;
    const terminal = [...this.runs.entries()].filter(([, r]) => r.header.status !== "running");
    if (terminal.length <= keep) return 0;
    terminal.sort((a, b) => (a[1].header.startedAt ?? 0) - (b[1].header.startedAt ?? 0));
    const drop = terminal.slice(0, terminal.length - keep);
    for (const [id] of drop) this.runs.delete(id);
    return drop.length;
  }
}
