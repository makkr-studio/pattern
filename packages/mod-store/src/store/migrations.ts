/**
 * @pattern-js/mod-store — schema migrations.
 *
 * Same shape as mod-identity's: hand-written SQL, versioned by array
 * position, applied transactionally past the recorded version. Append-only.
 */

/** Minimal slice of node:sqlite's DatabaseSync this module needs. */
export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

export const MIGRATIONS: string[] = [
  // v1 — documents: collections (with declared indexes), docs, index rows.
  `
  CREATE TABLE IF NOT EXISTS store_collections (
    name        TEXT PRIMARY KEY,
    indexes     TEXT NOT NULL DEFAULT '[]',
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS store_docs (
    collection  TEXT NOT NULL,
    id          TEXT NOT NULL,
    data        TEXT NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (collection, id)
  );

  CREATE TABLE IF NOT EXISTS store_index (
    collection  TEXT NOT NULL,
    doc_id      TEXT NOT NULL,
    field       TEXT NOT NULL,
    value       TEXT NOT NULL,
    PRIMARY KEY (collection, doc_id, field)
  );
  CREATE INDEX IF NOT EXISTS idx_store_index_lookup ON store_index(collection, field, value);
  `,

  // v2 — blob metadata (bytes live on the blob driver, filesystem by default).
  `
  CREATE TABLE IF NOT EXISTS store_blobs (
    id          TEXT PRIMARY KEY,
    mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
    size        INTEGER NOT NULL,
    owner_id    TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_store_blobs_owner ON store_blobs(owner_id);
  `,

  // v3 — leases (TTL'd advisory locks, CAS-claimed).
  `
  CREATE TABLE IF NOT EXISTS store_leases (
    key         TEXT PRIMARY KEY,
    owner       TEXT NOT NULL,
    expires_at  INTEGER NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_store_leases_owner ON store_leases(owner);
  `,
];

export function runMigrations(db: SqlDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _store_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const row = db.prepare("SELECT MAX(version) AS v FROM _store_migrations").get() as
    | { v: number | null }
    | undefined;
  const current = row?.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[i]!);
      db.prepare("INSERT INTO _store_migrations (version, applied_at) VALUES (?, ?)").run(i + 1, Date.now());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
