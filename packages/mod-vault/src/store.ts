/**
 * @pattern-js/mod-vault — secret rows (sqlite + memory drivers, one table).
 *
 * Rows hold ciphertext + iv only; names and dates are the listable surface.
 * Writes are last-wins upserts (rotation = write the same name again).
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface SecretRow {
  name: string;
  ciphertext: string;
  iv: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export type SecretInfo = Pick<SecretRow, "name" | "createdAt" | "updatedAt" | "version">;

export interface VaultStore {
  get(name: string): Promise<SecretRow | null>;
  put(name: string, ciphertext: string, iv: string): Promise<SecretRow>;
  delete(name: string): Promise<boolean>;
  list(): Promise<SecretInfo[]>;
  close(): Promise<void>;
}

/* ── sqlite ────────────────────────────────────────────────────────────── */

interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

type Raw = Record<string, unknown>;

const toRow = (r: Raw): SecretRow => ({
  name: String(r.name),
  ciphertext: String(r.ciphertext),
  iv: String(r.iv),
  version: Number(r.version),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

class SqliteVaultStore implements VaultStore {
  constructor(
    private readonly db: SqlDatabase & { close(): void },
  ) {}

  async get(name: string): Promise<SecretRow | null> {
    const r = this.db.prepare("SELECT * FROM vault_secrets WHERE name = ?").get(name) as Raw | undefined;
    return r ? toRow(r) : null;
  }

  async put(name: string, ciphertext: string, iv: string): Promise<SecretRow> {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO vault_secrets (name, ciphertext, iv, version, created_at, updated_at) VALUES (?,?,?,1,?,?)
         ON CONFLICT(name) DO UPDATE SET
           ciphertext = excluded.ciphertext, iv = excluded.iv,
           version = vault_secrets.version + 1, updated_at = excluded.updated_at`,
      )
      .run(name, ciphertext, iv, now, now);
    return (await this.get(name))!;
  }

  async delete(name: string): Promise<boolean> {
    return Number(this.db.prepare("DELETE FROM vault_secrets WHERE name = ?").run(name).changes) === 1;
  }

  async list(): Promise<SecretInfo[]> {
    const rows = this.db
      .prepare("SELECT name, version, created_at, updated_at FROM vault_secrets ORDER BY name ASC")
      .all() as Raw[];
    return rows.map((r) => ({
      name: String(r.name),
      version: Number(r.version),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export async function sqliteVaultStore(filePath: string): Promise<VaultStore> {
  let DatabaseSync: (new (path: string) => SqlDatabase & { close(): void }) | undefined;
  try {
    DatabaseSync = (process.getBuiltinModule("node:sqlite") as never as { DatabaseSync: never } | undefined)
      ?.DatabaseSync;
  } catch {
    /* fall through */
  }
  if (!DatabaseSync) {
    throw new Error(
      "node:sqlite is not available in this Node build — @pattern-js/mod-vault needs Node ≥22.5. " +
        "For tests, use memoryVaultStore().",
    );
  }
  if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS vault_secrets (
    name        TEXT PRIMARY KEY,
    ciphertext  TEXT NOT NULL,
    iv          TEXT NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )`);
  return new SqliteVaultStore(db);
}

/* ── memory ────────────────────────────────────────────────────────────── */

class MemoryVaultStore implements VaultStore {
  private rows = new Map<string, SecretRow>();

  async get(name: string): Promise<SecretRow | null> {
    const r = this.rows.get(name);
    return r ? { ...r } : null;
  }

  async put(name: string, ciphertext: string, iv: string): Promise<SecretRow> {
    const now = Date.now();
    const current = this.rows.get(name);
    const next: SecretRow = {
      name,
      ciphertext,
      iv,
      version: (current?.version ?? 0) + 1,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.rows.set(name, next);
    return { ...next };
  }

  async delete(name: string): Promise<boolean> {
    return this.rows.delete(name);
  }

  async list(): Promise<SecretInfo[]> {
    return [...this.rows.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, version, createdAt, updatedAt }) => ({ name, version, createdAt, updatedAt }));
  }

  async close(): Promise<void> {}
}

export function memoryVaultStore(): VaultStore {
  return new MemoryVaultStore();
}
