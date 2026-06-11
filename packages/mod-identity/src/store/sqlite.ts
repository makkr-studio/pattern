/**
 * @pattern/mod-identity — node:sqlite store driver.
 *
 * Hand-written SQL, no ORM (decided): the schema is five boring tables and the
 * security-critical statements should read as literal SQL. CAS is a single
 * conditional UPDATE — `WHERE id=? AND version=?` (+ `consumed_at IS NULL` for
 * tokens), checked via `changes === 1` — which is atomic in SQLite and ports
 * verbatim to Postgres, so a future driver is a file, not a redesign.
 *
 * `node:sqlite` is imported dynamically with a helpful error (same pattern as
 * runtime-node's sqlite trace sink); the in-memory store covers builds
 * without it.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  UniqueViolationError,
  type IdentityStores,
  type SessionRow,
  type SessionStore,
  type TokenRow,
  type TokenStore,
  type UserRow,
  type UserStore,
} from "./types.js";
import { runMigrations, type SqlDatabase } from "./migrations.js";

/* ── row mapping ───────────────────────────────────────────────────────── */

type Raw = Record<string, unknown>;

const toUser = (r: Raw): UserRow => ({
  id: String(r.id),
  email: String(r.email),
  emailNorm: String(r.email_norm),
  name: (r.name as string | null) ?? null,
  roles: JSON.parse(String(r.roles ?? "[]")) as string[],
  disabled: Number(r.disabled) === 1,
  version: Number(r.version),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

const toSession = (r: Raw): SessionRow => ({
  id: String(r.id),
  tokenHash: String(r.token_hash),
  userId: String(r.user_id),
  createdAt: Number(r.created_at),
  lastSeenAt: Number(r.last_seen_at),
  expiresAt: Number(r.expires_at),
  revokedAt: r.revoked_at == null ? null : Number(r.revoked_at),
  version: Number(r.version),
  userAgent: (r.user_agent as string | null) ?? null,
  ip: (r.ip as string | null) ?? null,
});

const toToken = (r: Raw): TokenRow => ({
  id: String(r.id),
  tokenHash: String(r.token_hash),
  purpose: String(r.purpose) as TokenRow["purpose"],
  emailNorm: (r.email_norm as string | null) ?? null,
  data: r.data == null ? null : (JSON.parse(String(r.data)) as Record<string, unknown>),
  createdAt: Number(r.created_at),
  expiresAt: Number(r.expires_at),
  consumedAt: r.consumed_at == null ? null : Number(r.consumed_at),
  version: Number(r.version),
});

/* ── stores ────────────────────────────────────────────────────────────── */

class SqliteUserStore implements UserStore {
  constructor(private readonly db: SqlDatabase) {}

  async countUsers(): Promise<number> {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM users").get() as Raw;
    return Number(r.n);
  }

  async findById(id: string): Promise<UserRow | null> {
    const r = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Raw | undefined;
    return r ? toUser(r) : null;
  }

  async findByEmailNorm(emailNorm: string): Promise<UserRow | null> {
    const r = this.db.prepare("SELECT * FROM users WHERE email_norm = ?").get(emailNorm) as Raw | undefined;
    return r ? toUser(r) : null;
  }

  async findByIdentity(provider: string, subject: string): Promise<UserRow | null> {
    const r = this.db
      .prepare(
        "SELECT u.* FROM users u JOIN identities i ON i.user_id = u.id WHERE i.provider = ? AND i.subject = ?",
      )
      .get(provider, subject) as Raw | undefined;
    return r ? toUser(r) : null;
  }

  async createUser(input: {
    email: string;
    emailNorm: string;
    name?: string | null;
    roles: string[];
    identity: { provider: string; subject: string };
  }): Promise<UserRow> {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "INSERT INTO users (id, email, email_norm, name, roles, disabled, version, created_at, updated_at) VALUES (?,?,?,?,?,0,1,?,?)",
        )
        .run(id, input.email, input.emailNorm, input.name ?? null, JSON.stringify(input.roles), now, now);
      this.db
        .prepare("INSERT INTO identities (provider, subject, user_id, created_at) VALUES (?,?,?,?)")
        .run(input.identity.provider, input.identity.subject, id, now);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      if (String(err).includes("UNIQUE")) throw new UniqueViolationError("email");
      throw err;
    }
    return (await this.findById(id))!;
  }

  async linkIdentity(userId: string, provider: string, subject: string): Promise<void> {
    this.db
      .prepare("INSERT OR IGNORE INTO identities (provider, subject, user_id, created_at) VALUES (?,?,?,?)")
      .run(provider, subject, userId, Date.now());
  }

  async updateUser(
    id: string,
    expectedVersion: number,
    patch: Partial<Pick<UserRow, "name" | "roles" | "disabled">>,
  ): Promise<UserRow | null> {
    const current = await this.findById(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    const info = this.db
      .prepare(
        "UPDATE users SET name=?, roles=?, disabled=?, version=version+1, updated_at=? WHERE id=? AND version=?",
      )
      .run(next.name, JSON.stringify(next.roles), next.disabled ? 1 : 0, Date.now(), id, expectedVersion);
    return Number(info.changes) === 1 ? this.findById(id) : null;
  }

  async listUsers(opts: { limit?: number; offset?: number } = {}): Promise<UserRow[]> {
    const rows = this.db
      .prepare("SELECT * FROM users ORDER BY created_at ASC LIMIT ? OFFSET ?")
      .all(opts.limit ?? 500, opts.offset ?? 0) as Raw[];
    return rows.map(toUser);
  }
}

class SqliteSessionStore implements SessionStore {
  constructor(private readonly db: SqlDatabase) {}

  async create(row: Omit<SessionRow, "version">): Promise<SessionRow> {
    this.db
      .prepare(
        "INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at, revoked_at, version, user_agent, ip) VALUES (?,?,?,?,?,?,?,1,?,?)",
      )
      .run(
        row.id,
        row.tokenHash,
        row.userId,
        row.createdAt,
        row.lastSeenAt,
        row.expiresAt,
        row.revokedAt,
        row.userAgent,
        row.ip,
      );
    return (await this.findById(row.id))!;
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    const r = this.db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash) as Raw | undefined;
    return r ? toSession(r) : null;
  }

  async findById(id: string): Promise<SessionRow | null> {
    const r = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Raw | undefined;
    return r ? toSession(r) : null;
  }

  async touch(id: string, expectedVersion: number, lastSeenAt: number, expiresAt: number): Promise<SessionRow | null> {
    const info = this.db
      .prepare("UPDATE sessions SET last_seen_at=?, expires_at=?, version=version+1 WHERE id=? AND version=?")
      .run(lastSeenAt, expiresAt, id, expectedVersion);
    return Number(info.changes) === 1 ? this.findById(id) : null;
  }

  async rotate(id: string, expectedVersion: number, newTokenHash: string): Promise<SessionRow | null> {
    const info = this.db
      .prepare("UPDATE sessions SET token_hash=?, version=version+1 WHERE id=? AND version=?")
      .run(newTokenHash, id, expectedVersion);
    return Number(info.changes) === 1 ? this.findById(id) : null;
  }

  async revoke(id: string, at: number): Promise<void> {
    this.db.prepare("UPDATE sessions SET revoked_at=?, version=version+1 WHERE id=? AND revoked_at IS NULL").run(at, id);
  }

  async revokeAllForUser(userId: string, at: number): Promise<string[]> {
    const ids = (
      this.db.prepare("SELECT id FROM sessions WHERE user_id=? AND revoked_at IS NULL").all(userId) as Raw[]
    ).map((r) => String(r.id));
    this.db
      .prepare("UPDATE sessions SET revoked_at=?, version=version+1 WHERE user_id=? AND revoked_at IS NULL")
      .run(at, userId);
    return ids;
  }

  async listForUser(userId: string): Promise<SessionRow[]> {
    const rows = this.db
      .prepare("SELECT * FROM sessions WHERE user_id=? ORDER BY created_at DESC")
      .all(userId) as Raw[];
    return rows.map(toSession);
  }

  async listAll(opts: { limit?: number } = {}): Promise<SessionRow[]> {
    const rows = this.db
      .prepare("SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?")
      .all(opts.limit ?? 500) as Raw[];
    return rows.map(toSession);
  }
}

class SqliteTokenStore implements TokenStore {
  constructor(private readonly db: SqlDatabase) {}

  async create(row: Omit<TokenRow, "version">): Promise<TokenRow> {
    this.db
      .prepare(
        "INSERT INTO tokens (id, token_hash, purpose, email_norm, data, created_at, expires_at, consumed_at, version) VALUES (?,?,?,?,?,?,?,?,1)",
      )
      .run(
        row.id,
        row.tokenHash,
        row.purpose,
        row.emailNorm,
        row.data == null ? null : JSON.stringify(row.data),
        row.createdAt,
        row.expiresAt,
        row.consumedAt,
      );
    return (await this.findById(row.id))!;
  }

  private async findById(id: string): Promise<TokenRow | null> {
    const r = this.db.prepare("SELECT * FROM tokens WHERE id = ?").get(id) as Raw | undefined;
    return r ? toToken(r) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<TokenRow | null> {
    const r = this.db.prepare("SELECT * FROM tokens WHERE token_hash = ?").get(tokenHash) as Raw | undefined;
    return r ? toToken(r) : null;
  }

  async consume(id: string, expectedVersion: number, at: number): Promise<TokenRow | null> {
    // The load-bearing CAS: `consumed_at IS NULL` in the WHERE means exactly
    // one of N concurrent consumers sees changes === 1.
    const info = this.db
      .prepare("UPDATE tokens SET consumed_at=?, version=version+1 WHERE id=? AND version=? AND consumed_at IS NULL")
      .run(at, id, expectedVersion);
    return Number(info.changes) === 1 ? this.findById(id) : null;
  }

  async deleteExpired(now: number): Promise<number> {
    const info = this.db.prepare("DELETE FROM tokens WHERE expires_at < ?").run(now);
    return Number(info.changes);
  }
}

/* ── factory ───────────────────────────────────────────────────────────── */

/**
 * Open (or create) the identity database at `filePath` (":memory:" works too).
 * Throws a helpful error when this Node build lacks `node:sqlite`.
 */
export async function sqliteIdentityStores(filePath: string): Promise<IdentityStores> {
  // process.getBuiltinModule (Node ≥22.3) loads the optional builtin without
  // going through the module graph — bundlers and vite-node leave it alone.
  let DatabaseSync: (new (path: string) => SqlDatabase & { close(): void }) | undefined;
  try {
    DatabaseSync = (process.getBuiltinModule("node:sqlite") as never as { DatabaseSync: never } | undefined)
      ?.DatabaseSync;
  } catch {
    /* fall through to the helpful error */
  }
  if (!DatabaseSync) {
    throw new Error(
      "node:sqlite is not available in this Node build — @pattern/mod-identity needs Node ≥22.5 " +
        "(≥24 recommended). For tests, use memoryIdentityStores().",
    );
  }
  if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  return {
    users: new SqliteUserStore(db),
    sessions: new SqliteSessionStore(db),
    tokens: new SqliteTokenStore(db),
    close: async () => db.close(),
  };
}
