/**
 * @pattern-js/runtime-node — process liveness for shared SQLite files (0.5).
 *
 * The RunLedger and the trace store are files several processes may write —
 * the dev server and a `pattern run` beside it, a restarting host and its
 * predecessor's last seconds. Both need to tell "that run's process DIED" from
 * "that run is just long", and a run's age can't: a crash twenty seconds
 * before a restart leaves a young stuck row (`running` forever), while a
 * five-minute job in a live sibling looks stale (wrongly marked `error`).
 *
 * So every writer registers an OWNER row and heartbeats it; every run row is
 * stamped with its owner; the sweep converts running rows whose owner has no
 * fresh heartbeat — at boot and on every heartbeat tick, so a crash shortly
 * before a restart is caught within one stale window. Rows from before owners
 * existed (owner NULL) keep the old age rule.
 */

/** Minimal slice of node:sqlite's DatabaseSync the registry needs. */
export interface LivenessDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

export interface LivenessOptions {
  /** Heartbeat period. Default 10s. */
  heartbeatMs?: number;
  /** A heartbeat older than this means the owner is gone. Default 30s (3 missed beats). */
  staleMs?: number;
  /** Age rule for owner-less legacy rows. Default 60s. */
  legacyGraceMs?: number;
  /** Clock (tests). Default Date.now. */
  now?: () => number;
  /** Owner id (tests). Default `${pid}-${random}`. */
  ownerId?: string;
}

const OWNERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS pattern_owners (
  owner_id     TEXT PRIMARY KEY,
  pid          INTEGER,
  heartbeat_at REAL NOT NULL
);
`;

export class Liveness {
  readonly ownerId: string;
  private readonly heartbeatMs: number;
  private readonly staleMs: number;
  private readonly legacyGraceMs: number;
  private readonly now: () => number;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: LivenessDb,
    opts: LivenessOptions = {},
    /** Runs after every heartbeat — the store's sweep. */
    private readonly onBeat?: () => void,
  ) {
    this.ownerId = opts.ownerId ?? `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    this.heartbeatMs = opts.heartbeatMs ?? 10_000;
    this.staleMs = opts.staleMs ?? 30_000;
    this.legacyGraceMs = opts.legacyGraceMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  /** Register this owner and start heartbeating (the timer never keeps the process alive). */
  start(): this {
    this.db.exec(OWNERS_SCHEMA);
    this.beat();
    this.timer = setInterval(() => {
      this.beat();
      this.onBeat?.();
    }, this.heartbeatMs);
    (this.timer as { unref?: () => void }).unref?.();
    return this;
  }

  beat(): void {
    const now = this.now();
    this.db.prepare("INSERT OR REPLACE INTO pattern_owners (owner_id, pid, heartbeat_at) VALUES (?, ?, ?)").run(this.ownerId, process.pid, now);
    // Owners long dead leave the table (their runs were swept ages ago).
    this.db.prepare("DELETE FROM pattern_owners WHERE heartbeat_at < ?").run(now - 10 * this.staleMs);
  }

  /**
   * A WHERE fragment (+ its params) selecting rows whose owner is gone: an
   * owner other than us with no fresh heartbeat, or an owner-less legacy row
   * older than the grace. Our own rows are never orphans — the sweep runs on
   * every beat, and we are, by definition, alive.
   */
  orphaned(ownerCol: string, startedCol: string): { sql: string; params: unknown[] } {
    const now = this.now();
    return {
      sql:
        `((${ownerCol} IS NULL AND ${startedCol} < ?) OR ` +
        `(${ownerCol} IS NOT NULL AND ${ownerCol} != ? AND ${ownerCol} NOT IN (SELECT owner_id FROM pattern_owners WHERE heartbeat_at >= ?)))`,
      params: [now - this.legacyGraceMs, this.ownerId, now - this.staleMs],
    };
  }

  /** Stop heartbeating and drop the owner row — a clean exit hands its runs to the next sweep only if they're still running. */
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    try {
      this.db.prepare("DELETE FROM pattern_owners WHERE owner_id = ?").run(this.ownerId);
    } catch {
      /* the database may already be closing */
    }
  }
}
