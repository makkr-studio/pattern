/**
 * @pattern-js/mod-store — node:sqlite driver (+ filesystem blob bytes).
 *
 * Hand-written SQL, no ORM. CAS is a single conditional UPDATE checked via
 * `changes === 1` (atomic in SQLite; ports verbatim to Postgres). Index rows
 * are rewritten with the doc inside one transaction — a query can never see a
 * doc and its index disagree. Blob bytes go to uuid-named files under the
 * blob dir; the metadata row is the source of truth (a file without a row is
 * garbage, a row without a file is a 404).
 */

import { createReadStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import {
  indexValue,
  valueAtPath,
  type AcquireResult,
  type BlobMeta,
  type BlobStore,
  type CollectionDef,
  type DocumentRow,
  type DocumentStore,
  type LeaseRow,
  type LeaseStore,
  type PatternStores,
  type QueryOptions,
} from "./types.js";
import { runMigrations, type SqlDatabase } from "./migrations.js";
import { KeyedMutex } from "./mutex.js";
import { bufferStream } from "./bytes.js";

type Raw = Record<string, unknown>;

const toDoc = (r: Raw): DocumentRow => ({
  id: String(r.id),
  collection: String(r.collection),
  data: JSON.parse(String(r.data)) as Record<string, unknown>,
  version: Number(r.version),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

const toBlobMeta = (r: Raw): BlobMeta => ({
  id: String(r.id),
  mime: String(r.mime),
  size: Number(r.size),
  ownerId: (r.owner_id as string | null) ?? null,
  createdAt: Number(r.created_at),
});

const toLease = (r: Raw): LeaseRow => ({
  key: String(r.key),
  owner: String(r.owner),
  expiresAt: Number(r.expires_at),
  version: Number(r.version),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

/* ── documents ─────────────────────────────────────────────────────────── */

class SqliteDocumentStore implements DocumentStore {
  private readonly indexCache = new Map<string, string[]>();
  private readonly ensureMutex = new KeyedMutex();

  constructor(private readonly db: SqlDatabase) {}

  private indexesOf(collection: string): string[] {
    const cached = this.indexCache.get(collection);
    if (cached) return cached;
    const r = this.db.prepare("SELECT indexes FROM store_collections WHERE name = ?").get(collection) as
      | Raw
      | undefined;
    const idx = r ? (JSON.parse(String(r.indexes)) as string[]) : [];
    this.indexCache.set(collection, idx);
    return idx;
  }

  async ensureCollection(def: CollectionDef): Promise<void> {
    await this.ensureMutex.run(def.name, async () => {
      this.db
        .prepare("INSERT OR IGNORE INTO store_collections (name, indexes, created_at) VALUES (?, '[]', ?)")
        .run(def.name, Date.now());
      const existing = this.indexesOf(def.name);
      const added = def.indexes.filter((f) => !existing.includes(f));
      if (added.length === 0) return;
      const next = [...existing, ...added];
      this.db.exec("BEGIN");
      try {
        this.db
          .prepare("UPDATE store_collections SET indexes = ? WHERE name = ?")
          .run(JSON.stringify(next), def.name);
        // Backfill: extract the new fields from every existing doc.
        const rows = this.db.prepare("SELECT * FROM store_docs WHERE collection = ?").all(def.name) as Raw[];
        const ins = this.db.prepare(
          "INSERT OR REPLACE INTO store_index (collection, doc_id, field, value) VALUES (?,?,?,?)",
        );
        for (const raw of rows) {
          const doc = toDoc(raw);
          for (const field of added) {
            const v = indexValue(valueAtPath(doc.data, field));
            if (v != null) ins.run(def.name, doc.id, field, v);
          }
        }
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
      this.indexCache.set(def.name, next);
    });
  }

  async listCollections(): Promise<Array<CollectionDef & { docCount: number }>> {
    const rows = this.db
      .prepare(
        `SELECT c.name, c.indexes, COUNT(d.id) AS n
         FROM store_collections c LEFT JOIN store_docs d ON d.collection = c.name
         GROUP BY c.name ORDER BY c.name ASC`,
      )
      .all() as Raw[];
    return rows.map((r) => ({
      name: String(r.name),
      indexes: JSON.parse(String(r.indexes)) as string[],
      docCount: Number(r.n),
    }));
  }

  async get(collection: string, id: string): Promise<DocumentRow | null> {
    const r = this.db
      .prepare("SELECT * FROM store_docs WHERE collection = ? AND id = ?")
      .get(collection, id) as Raw | undefined;
    return r ? toDoc(r) : null;
  }

  private writeIndexRows(collection: string, id: string, data: Record<string, unknown>): void {
    this.db.prepare("DELETE FROM store_index WHERE collection = ? AND doc_id = ?").run(collection, id);
    const ins = this.db.prepare(
      "INSERT INTO store_index (collection, doc_id, field, value) VALUES (?,?,?,?)",
    );
    for (const field of this.indexesOf(collection)) {
      const v = indexValue(valueAtPath(data, field));
      if (v != null) ins.run(collection, id, field, v);
    }
  }

  async put(
    collection: string,
    id: string,
    data: Record<string, unknown>,
    expectedVersion?: number,
  ): Promise<DocumentRow | null> {
    const now = Date.now();
    this.db.exec("BEGIN");
    try {
      let okay: boolean;
      if (expectedVersion == null) {
        this.db
          .prepare(
            `INSERT INTO store_docs (collection, id, data, version, created_at, updated_at) VALUES (?,?,?,1,?,?)
             ON CONFLICT(collection, id) DO UPDATE SET
               data = excluded.data, version = store_docs.version + 1, updated_at = excluded.updated_at`,
          )
          .run(collection, id, JSON.stringify(data), now, now);
        okay = true;
      } else {
        const info = this.db
          .prepare(
            "UPDATE store_docs SET data=?, version=version+1, updated_at=? WHERE collection=? AND id=? AND version=?",
          )
          .run(JSON.stringify(data), now, collection, id, expectedVersion);
        okay = Number(info.changes) === 1;
      }
      if (okay) this.writeIndexRows(collection, id, data);
      this.db.exec("COMMIT");
      return okay ? this.get(collection, id) : null;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async patch(
    collection: string,
    id: string,
    patch: Record<string, unknown>,
    expectedVersion: number,
  ): Promise<DocumentRow | null> {
    const current = await this.get(collection, id);
    if (!current || current.version !== expectedVersion) return null;
    return this.put(collection, id, { ...current.data, ...patch }, expectedVersion);
  }

  async delete(collection: string, id: string): Promise<boolean> {
    this.db.exec("BEGIN");
    try {
      const info = this.db
        .prepare("DELETE FROM store_docs WHERE collection = ? AND id = ?")
        .run(collection, id);
      this.db.prepare("DELETE FROM store_index WHERE collection = ? AND doc_id = ?").run(collection, id);
      this.db.exec("COMMIT");
      return Number(info.changes) === 1;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private whereClause(
    collection: string,
    where: Record<string, unknown>,
  ): { joins: string; conds: string; params: unknown[] } {
    const fields = Object.keys(where);
    const declared = this.indexesOf(collection);
    for (const f of fields) {
      if (!declared.includes(f)) {
        throw new Error(
          `store: field "${f}" is not indexed on collection "${collection}" — declare it via ensureCollection`,
        );
      }
    }
    const joins = fields
      .map(
        (_f, i) =>
          ` JOIN store_index ix${i} ON ix${i}.collection = d.collection AND ix${i}.doc_id = d.id`,
      )
      .join("");
    const conds = fields.map((_f, i) => ` AND ix${i}.field = ? AND ix${i}.value = ?`).join("");
    const params = fields.flatMap((f) => [f, indexValue(where[f]) ?? ""]);
    return { joins, conds, params };
  }

  async query(opts: QueryOptions): Promise<DocumentRow[]> {
    const { joins, conds, params } = this.whereClause(opts.collection, opts.where ?? {});
    const dir = opts.orderDir === "desc" ? "DESC" : "ASC";
    let order = "d.created_at " + dir;
    if (opts.orderBy === "updatedAt") order = `d.updated_at ${dir}`;
    else if (opts.orderBy === "id") order = `d.id ${dir}`;
    else if (opts.orderBy && opts.orderBy !== "createdAt") {
      const declared = this.indexesOf(opts.collection);
      if (!declared.includes(opts.orderBy)) {
        throw new Error(
          `store: orderBy "${opts.orderBy}" is not indexed on collection "${opts.collection}"`,
        );
      }
      order = `(SELECT value FROM store_index o WHERE o.collection = d.collection AND o.doc_id = d.id AND o.field = '${opts.orderBy.replaceAll("'", "''")}') ${dir}`;
    }
    const rows = this.db
      .prepare(
        `SELECT d.* FROM store_docs d${joins} WHERE d.collection = ?${conds} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(opts.collection, ...params, opts.limit ?? 100, opts.offset ?? 0) as Raw[];
    return rows.map(toDoc);
  }

  async count(collection: string, where: Record<string, unknown> = {}): Promise<number> {
    const { joins, conds, params } = this.whereClause(collection, where);
    const r = this.db
      .prepare(`SELECT COUNT(*) AS n FROM store_docs d${joins} WHERE d.collection = ?${conds}`)
      .get(collection, ...params) as Raw;
    return Number(r.n);
  }
}

/* ── blobs (sqlite meta + filesystem bytes) ────────────────────────────── */

class SqliteFsBlobStore implements BlobStore {
  constructor(
    private readonly db: SqlDatabase,
    private readonly dir: string,
    private readonly maxBytes: number,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  private path(id: string): string {
    return join(this.dir, id);
  }

  async put(
    data: Uint8Array | ReadableStream<Uint8Array>,
    opts: { mime?: string; ownerId?: string | null } = {},
  ): Promise<BlobMeta> {
    const bytes = data instanceof Uint8Array ? data : await bufferStream(data, this.maxBytes);
    if (bytes.byteLength > this.maxBytes) {
      throw new Error(`store: blob exceeds the ${this.maxBytes}-byte cap`);
    }
    const id = crypto.randomUUID();
    await writeFile(this.path(id), bytes);
    try {
      this.db
        .prepare("INSERT INTO store_blobs (id, mime, size, owner_id, created_at) VALUES (?,?,?,?,?)")
        .run(id, opts.mime ?? "application/octet-stream", bytes.byteLength, opts.ownerId ?? null, Date.now());
    } catch (err) {
      await rm(this.path(id), { force: true });
      throw err;
    }
    return (await this.getMeta(id))!;
  }

  async getMeta(id: string): Promise<BlobMeta | null> {
    const r = this.db.prepare("SELECT * FROM store_blobs WHERE id = ?").get(id) as Raw | undefined;
    return r ? toBlobMeta(r) : null;
  }

  async get(id: string): Promise<{ meta: BlobMeta; stream: ReadableStream<Uint8Array> } | null> {
    const meta = await this.getMeta(id);
    if (!meta) return null;
    const stream = Readable.toWeb(createReadStream(this.path(id))) as ReadableStream<Uint8Array>;
    return { meta, stream };
  }

  async delete(id: string): Promise<boolean> {
    const info = this.db.prepare("DELETE FROM store_blobs WHERE id = ?").run(id);
    await rm(this.path(id), { force: true });
    return Number(info.changes) === 1;
  }

  async list(opts: { ownerId?: string; limit?: number; offset?: number } = {}): Promise<BlobMeta[]> {
    const rows = (
      opts.ownerId != null
        ? this.db
            .prepare("SELECT * FROM store_blobs WHERE owner_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
            .all(opts.ownerId, opts.limit ?? 100, opts.offset ?? 0)
        : this.db
            .prepare("SELECT * FROM store_blobs ORDER BY created_at DESC LIMIT ? OFFSET ?")
            .all(opts.limit ?? 100, opts.offset ?? 0)
    ) as Raw[];
    return rows.map(toBlobMeta);
  }
}

/* ── leases ────────────────────────────────────────────────────────────── */

class SqliteLeaseStore implements LeaseStore {
  constructor(private readonly db: SqlDatabase) {}

  async acquire(key: string, owner: string, ttlMs: number): Promise<AcquireResult> {
    const now = Date.now();
    // One atomic statement: insert, or steal when expired / re-enter when ours.
    const info = this.db
      .prepare(
        `INSERT INTO store_leases (key, owner, expires_at, version, created_at, updated_at) VALUES (?,?,?,1,?,?)
         ON CONFLICT(key) DO UPDATE SET
           owner = excluded.owner, expires_at = excluded.expires_at,
           version = store_leases.version + 1, updated_at = excluded.updated_at
         WHERE store_leases.expires_at < ? OR store_leases.owner = excluded.owner`,
      )
      .run(key, owner, now + ttlMs, now, now, now);
    if (Number(info.changes) === 1) return { ok: true, lease: (await this.get(key))! };
    const held = await this.get(key);
    return held
      ? { ok: false, owner: held.owner, expiresAt: held.expiresAt }
      : this.acquire(key, owner, ttlMs); // released between statements — retry
  }

  async renew(key: string, owner: string, ttlMs: number): Promise<AcquireResult> {
    const now = Date.now();
    const info = this.db
      .prepare(
        "UPDATE store_leases SET expires_at=?, version=version+1, updated_at=? WHERE key=? AND owner=? AND expires_at >= ?",
      )
      .run(now + ttlMs, now, key, owner, now);
    if (Number(info.changes) === 1) return { ok: true, lease: (await this.get(key))! };
    const held = await this.get(key);
    return { ok: false, owner: held?.owner ?? "", expiresAt: held?.expiresAt ?? 0 };
  }

  async release(key: string, owner: string): Promise<void> {
    this.db.prepare("DELETE FROM store_leases WHERE key = ? AND owner = ?").run(key, owner);
  }

  async releaseAll(owner: string): Promise<number> {
    const info = this.db.prepare("DELETE FROM store_leases WHERE owner = ?").run(owner);
    return Number(info.changes);
  }

  async get(key: string): Promise<LeaseRow | null> {
    const r = this.db.prepare("SELECT * FROM store_leases WHERE key = ?").get(key) as Raw | undefined;
    return r ? toLease(r) : null;
  }
}

/* ── factory ───────────────────────────────────────────────────────────── */

/**
 * Open (or create) the store database at `filePath` (":memory:" works) with
 * blob bytes under `blobDir`. Throws helpfully when node:sqlite is missing.
 */
export async function sqlitePatternStores(
  filePath: string,
  blobDir: string,
  opts: { maxBlobBytes?: number } = {},
): Promise<PatternStores> {
  let DatabaseSync: (new (path: string) => SqlDatabase & { close(): void }) | undefined;
  try {
    DatabaseSync = (process.getBuiltinModule("node:sqlite") as never as { DatabaseSync: never } | undefined)
      ?.DatabaseSync;
  } catch {
    /* fall through to the helpful error */
  }
  if (!DatabaseSync) {
    throw new Error(
      "node:sqlite is not available in this Node build — @pattern-js/mod-store needs Node ≥22.5 " +
        "(≥24 recommended). For tests, use memoryPatternStores().",
    );
  }
  if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL");
  runMigrations(db);
  return {
    docs: new SqliteDocumentStore(db),
    blobs: new SqliteFsBlobStore(db, blobDir, opts.maxBlobBytes ?? 25 * 1024 * 1024),
    leases: new SqliteLeaseStore(db),
    close: async () => db.close(),
  };
}
