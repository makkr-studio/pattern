/**
 * @pattern-js/runtime-node — the durable RunLedger on Node's `node:sqlite`.
 *
 * Full-fidelity run records (exact trigger input, exact node outputs) for
 * `durable: true` workflows — the substrate resume and re-run replay from.
 * Hand-written SQL like the trace store: WAL for multi-process access,
 * busy_timeout so a dev-server restart waits for the lock. Lives in
 * `.pattern-data/ledger.db` (gitignored beside the identity + document stores)
 * because, unlike the masked trace store, it records REAL values.
 *
 * On open, a boot sweep converts rows stuck `running` (a crash mid-run) into
 * `error: "interrupted"` — a resumable record instead of a stuck one.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LedgerNodeRecord, LedgerRunHeader, LedgerRunStatus, RunLedger } from "@pattern-js/core";

/** Minimal slice of node:sqlite's DatabaseSync this module needs. */
interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

type Raw = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ledger_runs (
  run_id        TEXT PRIMARY KEY,
  workflow_id   TEXT NOT NULL,
  workflow_hash TEXT NOT NULL,
  trigger_node  TEXT NOT NULL,
  input         TEXT NOT NULL,
  params        TEXT,
  principal     TEXT NOT NULL,
  parent_run_id TEXT,
  resumed_from  TEXT,
  status        TEXT NOT NULL,
  error         TEXT,
  started_at    REAL NOT NULL,
  ended_at      REAL
);
CREATE INDEX IF NOT EXISTS idx_ledger_runs_wf ON ledger_runs(workflow_id, started_at);
CREATE TABLE IF NOT EXISTS ledger_nodes (
  run_id     TEXT NOT NULL,
  node_id    TEXT NOT NULL,
  status     TEXT NOT NULL,
  outputs    TEXT,
  pulsed     TEXT,
  streaming  INTEGER NOT NULL DEFAULT 0,
  unserializable INTEGER NOT NULL DEFAULT 0,
  started_at REAL,
  ended_at   REAL,
  PRIMARY KEY (run_id, node_id)
);
`;

export interface SqliteRunLedgerOptions {
  /** Terminal runs kept after pruning (oldest dropped first). Default 200. */
  keep?: number;
}

export class SqliteRunLedger implements RunLedger {
  constructor(
    private readonly db: SqlDatabase,
    private readonly opts: SqliteRunLedgerOptions = {},
  ) {
    // Boot sweep: a crash leaves runs stuck `running` — convert them to a
    // terminal, RESUMABLE record. The one-minute grace protects a live run of
    // ANOTHER process sharing the file (`pattern run` next to the dev server).
    this.db
      .prepare(
        "UPDATE ledger_runs SET status = 'error', error = ?, ended_at = ? WHERE status = 'running' AND started_at < ?",
      )
      .run(JSON.stringify({ message: "interrupted (process exited mid-run)" }), Date.now(), Date.now() - 60_000);
    this.prune();
  }

  begin(h: LedgerRunHeader): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ledger_runs
         (run_id, workflow_id, workflow_hash, trigger_node, input, params, principal,
          parent_run_id, resumed_from, status, error, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
      )
      .run(
        h.runId,
        h.workflowId,
        h.workflowHash,
        h.triggerNodeId,
        JSON.stringify(h.input),
        h.params ? JSON.stringify(h.params) : null,
        JSON.stringify(h.principal),
        h.parentRunId ?? null,
        h.resumedFrom ?? null,
        h.status,
        h.startedAt,
      );
  }

  nodeStarted(runId: string, nodeId: string, at: number): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO ledger_nodes (run_id, node_id, status, started_at) VALUES (?, ?, 'started', ?)",
      )
      .run(runId, nodeId, at);
  }

  nodeFinished(r: LedgerNodeRecord): void {
    this.db
      .prepare(
        `INSERT INTO ledger_nodes (run_id, node_id, status, outputs, pulsed, streaming, unserializable, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (run_id, node_id) DO UPDATE SET
           status = excluded.status, outputs = excluded.outputs, pulsed = excluded.pulsed,
           streaming = excluded.streaming, unserializable = excluded.unserializable,
           ended_at = excluded.ended_at`,
      )
      .run(
        r.runId,
        r.nodeId,
        r.status,
        r.outputs ? JSON.stringify(r.outputs) : null,
        r.pulsed ? JSON.stringify(r.pulsed) : null,
        r.streaming ? 1 : 0,
        r.unserializable ? 1 : 0,
        r.startedAt ?? null,
        r.endedAt ?? null,
      );
  }

  end(runId: string, status: LedgerRunStatus, error?: LedgerRunHeader["error"]): void {
    this.db
      .prepare("UPDATE ledger_runs SET status = ?, error = ?, ended_at = ? WHERE run_id = ?")
      .run(status, error ? JSON.stringify(error) : null, Date.now(), runId);
    if (status !== "running") this.prune();
  }

  async get(runId: string): Promise<{ header: LedgerRunHeader; nodes: LedgerNodeRecord[] } | null> {
    const row = this.db.prepare("SELECT * FROM ledger_runs WHERE run_id = ?").get(runId) as Raw | undefined;
    if (!row) return null;
    const nodes = (this.db.prepare("SELECT * FROM ledger_nodes WHERE run_id = ?").all(runId) as Raw[]).map(
      (n): LedgerNodeRecord => ({
        runId,
        nodeId: String(n.node_id),
        status: String(n.status) as LedgerNodeRecord["status"],
        outputs: n.outputs ? (JSON.parse(String(n.outputs)) as LedgerNodeRecord["outputs"]) : undefined,
        pulsed: n.pulsed ? (JSON.parse(String(n.pulsed)) as string[]) : undefined,
        streaming: Number(n.streaming) === 1 ? true : undefined,
        unserializable: Number(n.unserializable) === 1 ? true : undefined,
        startedAt: n.started_at == null ? undefined : Number(n.started_at),
        endedAt: n.ended_at == null ? undefined : Number(n.ended_at),
      }),
    );
    return {
      header: {
        runId: String(row.run_id),
        workflowId: String(row.workflow_id),
        workflowHash: String(row.workflow_hash),
        triggerNodeId: String(row.trigger_node),
        input: JSON.parse(String(row.input)) as LedgerRunHeader["input"],
        params: row.params ? (JSON.parse(String(row.params)) as Record<string, unknown>) : undefined,
        principal: JSON.parse(String(row.principal)) as LedgerRunHeader["principal"],
        parentRunId: row.parent_run_id == null ? undefined : String(row.parent_run_id),
        resumedFrom: row.resumed_from == null ? undefined : String(row.resumed_from),
        status: String(row.status) as LedgerRunStatus,
        error: row.error ? (JSON.parse(String(row.error)) as LedgerRunHeader["error"]) : undefined,
        startedAt: Number(row.started_at),
        endedAt: row.ended_at == null ? undefined : Number(row.ended_at),
      },
      nodes,
    };
  }

  prune(opts?: { keep?: number }): number {
    const keep = opts?.keep ?? this.opts.keep ?? 200;
    const excess = this.db
      .prepare(
        `SELECT run_id FROM ledger_runs WHERE status != 'running'
         ORDER BY started_at DESC LIMIT -1 OFFSET ?`,
      )
      .all(keep) as Raw[];
    for (const r of excess) {
      this.db.prepare("DELETE FROM ledger_nodes WHERE run_id = ?").run(r.run_id);
      this.db.prepare("DELETE FROM ledger_runs WHERE run_id = ?").run(r.run_id);
    }
    return excess.length;
  }

  close(): void {
    this.db.close();
  }
}

/** Open (creating if needed) the sqlite-backed RunLedger at `path`. */
export function createRunLedger(path: string, opts: SqliteRunLedgerOptions = {}): SqliteRunLedger {
  let DatabaseSync: (new (p: string) => SqlDatabase) | undefined;
  try {
    const mod = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync?: new (p: string) => SqlDatabase } | undefined;
    DatabaseSync = mod?.DatabaseSync;
  } catch {
    /* fall through */
  }
  if (!DatabaseSync) {
    throw new Error("node:sqlite is not available in this Node build — the RunLedger needs Node ≥22.5 (≥24 recommended).");
  }
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  return new SqliteRunLedger(db, opts);
}
