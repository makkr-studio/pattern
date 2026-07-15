/**
 * @pattern-js/mod-identity — schema migrations.
 *
 * Hand-written SQL, versioned by position in the array; `runMigrations`
 * applies anything past the recorded version inside a transaction. No
 * tooling, no down-migrations — append-only, like the rest of the store.
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
  // v1 — identity core: users, provider identities, sessions, single-use tokens.
  `
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    email       TEXT NOT NULL,
    email_norm  TEXT NOT NULL UNIQUE,
    name        TEXT,
    roles       TEXT NOT NULL DEFAULT '[]',
    disabled    INTEGER NOT NULL DEFAULT 0,
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS identities (
    provider    TEXT NOT NULL,
    subject     TEXT NOT NULL,
    user_id     TEXT NOT NULL REFERENCES users(id),
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (provider, subject)
  );
  CREATE INDEX IF NOT EXISTS idx_identities_user ON identities(user_id);

  CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    token_hash    TEXT NOT NULL UNIQUE,
    user_id       TEXT NOT NULL REFERENCES users(id),
    created_at    INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    revoked_at    INTEGER,
    version       INTEGER NOT NULL DEFAULT 1,
    user_agent    TEXT,
    ip            TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS tokens (
    id           TEXT PRIMARY KEY,
    token_hash   TEXT NOT NULL UNIQUE,
    purpose      TEXT NOT NULL,
    email_norm   TEXT,
    data         TEXT,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    consumed_at  INTEGER,
    version      INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_tokens_purpose ON tokens(purpose);
  `,

  // v2 — runtime-mutable settings (signup policy toggled from the admin).
  `
  CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
  `,

  // v3 — scoped, revocable API tokens (control-plane bearer credentials).
  `
  CREATE TABLE IF NOT EXISTS api_tokens (
    id            TEXT PRIMARY KEY,
    token_hash    TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    scopes        TEXT NOT NULL DEFAULT '[]',
    user_id       TEXT,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER,
    revoked_at    INTEGER,
    last_used_at  INTEGER,
    version       INTEGER NOT NULL DEFAULT 1
  );
  `,

  // v4 — invites as first-class records (status, next path, audit trail). The
  // single-use token stays the credential; this row is what the admin sees.
  // email_norm is deliberately NOT unique — re-inviting is a normal act.
  `
  CREATE TABLE IF NOT EXISTS invites (
    id                TEXT PRIMARY KEY,
    email             TEXT NOT NULL,
    email_norm        TEXT NOT NULL,
    roles             TEXT NOT NULL DEFAULT '[]',
    next              TEXT,
    invited_by        TEXT,
    created_at        INTEGER NOT NULL,
    expires_at        INTEGER NOT NULL,
    accepted_at       INTEGER,
    accepted_user_id  TEXT,
    revoked_at        INTEGER,
    version           INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email_norm);
  `,
];

export function runMigrations(db: SqlDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _identity_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const row = db.prepare("SELECT MAX(version) AS v FROM _identity_migrations").get() as
    | { v: number | null }
    | undefined;
  const current = row?.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[i]!);
      db.prepare("INSERT INTO _identity_migrations (version, applied_at) VALUES (?, ?)").run(i + 1, Date.now());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
