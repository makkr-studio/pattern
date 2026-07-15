/**
 * @pattern-js/mod-vectors — the default "local" engine.
 *
 * node:sqlite-backed (WAL + busy_timeout, the mod-store recipe): durable AND
 * offload-safe — a worker's own service instance opens the SAME file, so
 * offloaded workflows see every vector the host wrote. Vectors are Float32
 * BLOBs, L2-normalized at write time so cosine similarity is a dot product;
 * search is an honest brute-force scan with a top-k heap (fine to ~100k
 * vectors — past that, register a real driver: the SPI carries filter+mode).
 *
 * Filterables prune BEFORE the scan through the indexed `vec_meta` side
 * table. Keyword ranking uses FTS5 when this sqlite build has it (probed at
 * open) and a zero-dep token-overlap scorer otherwise; hybrid fuses the two
 * rankings with reciprocal-rank fusion (RRF, k=60) — no score calibration.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  CollectionInfo,
  CollectionSpec,
  EngineQuery,
  EngineRow,
  Filter,
  FilterValue,
  Match,
  VectorsEngine,
} from "./types.js";

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

const MIGRATIONS: string[] = [
  // v1 — collections, rows, the filterable side table.
  `
  CREATE TABLE IF NOT EXISTS vec_collections (
    name         TEXT PRIMARY KEY,
    alias        TEXT NOT NULL,
    dims         INTEGER,
    metric       TEXT NOT NULL DEFAULT 'cosine',
    filterables  TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS vec_rows (
    collection  TEXT NOT NULL,
    id          TEXT NOT NULL,
    vector      BLOB,
    text        TEXT,
    meta        TEXT,
    hash        TEXT NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (collection, id)
  );

  CREATE TABLE IF NOT EXISTS vec_meta (
    collection  TEXT NOT NULL,
    id          TEXT NOT NULL,
    field       TEXT NOT NULL,
    value       TEXT NOT NULL,
    PRIMARY KEY (collection, id, field, value)
  );
  CREATE INDEX IF NOT EXISTS idx_vec_meta_lookup ON vec_meta (collection, field, value);
  `,
];

/** L2-normalize into a fresh Float32Array (cosine ≡ dot afterwards). */
export function normalize(vector: number[] | Float32Array): Float32Array {
  const out = new Float32Array(vector.length);
  let sum = 0;
  for (let i = 0; i < vector.length; i++) sum += Number(vector[i]) * Number(vector[i]);
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < vector.length; i++) out[i] = Number(vector[i]) / norm;
  return out;
}

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}.]+/u)
    .filter((t) => t.length > 1);

/** Escape a free-text query into a safe FTS5 OR-query ("tok" OR "tok"…). */
function ftsQuery(text: string): string {
  const tokens = tokenize(text).map((t) => `"${t.replaceAll('"', '""')}"`);
  return tokens.join(" OR ");
}

/** Reciprocal-rank fusion of one or more rankings (RRF, k=60). */
export function rrfFuse(rankings: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return scores;
}

export interface LocalEngineOptions {
  /** ":memory:" works too (tests). */
  path: string;
  /** Test seam: pretend this sqlite build has no FTS5 (exercise the fallback scorer). */
  disableFts?: boolean;
}

export class LocalVectorsEngine implements VectorsEngine {
  readonly id = "local";
  private readonly db: SqlDatabase;
  /** Whether this sqlite build compiled FTS5 (probed at open). */
  readonly hasFts: boolean;

  constructor(opts: LocalEngineOptions) {
    const DatabaseSync = (
      process.getBuiltinModule("node:sqlite") as never as { DatabaseSync?: new (path: string) => SqlDatabase } | undefined
    )?.DatabaseSync;
    if (!DatabaseSync) {
      throw new Error(
        "node:sqlite is not available in this Node build — @pattern-js/mod-vectors needs Node ≥22.5 (≥24 recommended).",
      );
    }
    if (opts.path !== ":memory:") mkdirSync(dirname(opts.path), { recursive: true });
    this.db = new DatabaseSync(opts.path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.runMigrations();

    let fts = false;
    if (!opts.disableFts) {
      try {
        this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS vec_fts USING fts5(collection UNINDEXED, id UNINDEXED, text)");
        fts = true;
      } catch {
        fts = false; // this sqlite build has no FTS5 — the token-overlap scorer takes over
      }
    }
    this.hasFts = fts;
  }

  private runMigrations(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS _vectors_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`);
    const row = this.db.prepare("SELECT MAX(version) AS v FROM _vectors_migrations").get() as { v: number | null } | undefined;
    const current = row?.v ?? 0;
    for (let i = current; i < MIGRATIONS.length; i++) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(MIGRATIONS[i]!);
        this.db.prepare("INSERT INTO _vectors_migrations (version, applied_at) VALUES (?, ?)").run(i + 1, Date.now());
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    }
  }

  /* ── collections ─────────────────────────────────────────────────────── */

  async ensureCollection(spec: CollectionSpec): Promise<void> {
    const existing = await this.getCollection(spec.name);
    if (!existing) {
      this.db
        .prepare("INSERT INTO vec_collections (name, alias, dims, metric, filterables) VALUES (?,?,?,?,?)")
        .run(spec.name, spec.alias, spec.dims ?? null, spec.metric, JSON.stringify(spec.filterables));
      return;
    }
    if (existing.dims != null && spec.dims != null && existing.dims !== spec.dims) {
      throw new Error(
        `vectors: collection "${spec.name}" is locked to ${existing.dims} dims (alias "${existing.alias}") — ` +
          `got dims ${spec.dims}. Re-embedding into a fresh collection is the fix; dims never silently change.`,
      );
    }
    // Idempotent re-declare: alias/filterables may evolve, dims only ever locks.
    this.db
      .prepare("UPDATE vec_collections SET alias=?, filterables=?, dims=COALESCE(dims, ?) WHERE name=?")
      .run(spec.alias, JSON.stringify(spec.filterables), spec.dims ?? null, spec.name);
  }

  async getCollection(name: string): Promise<CollectionSpec | null> {
    const r = this.db.prepare("SELECT * FROM vec_collections WHERE name = ?").get(name) as Raw | undefined;
    if (!r) return null;
    return {
      name: String(r.name),
      alias: String(r.alias),
      dims: r.dims == null ? undefined : Number(r.dims),
      metric: "cosine",
      filterables: JSON.parse(String(r.filterables ?? "[]")) as string[],
    };
  }

  async listCollections(): Promise<CollectionInfo[]> {
    const rows = this.db.prepare("SELECT * FROM vec_collections ORDER BY name").all() as Raw[];
    return rows.map((r) => {
      const count = this.db.prepare("SELECT COUNT(*) AS n FROM vec_rows WHERE collection = ?").get(String(r.name)) as Raw;
      return {
        name: String(r.name),
        alias: String(r.alias),
        dims: r.dims == null ? undefined : Number(r.dims),
        metric: "cosine" as const,
        filterables: JSON.parse(String(r.filterables ?? "[]")) as string[],
        rows: Number(count.n),
      };
    });
  }

  /** Lock dims on the collection's first vector write; mismatch names the alias. */
  private lockDims(collection: string, dims: number): void {
    const spec = this.db.prepare("SELECT alias, dims FROM vec_collections WHERE name = ?").get(collection) as
      | { alias: string; dims: number | null }
      | undefined;
    if (!spec) throw new Error(`vectors: collection "${collection}" does not exist — run vectors.collection.ensure first`);
    if (spec.dims == null) {
      this.db.prepare("UPDATE vec_collections SET dims = ? WHERE name = ?").run(dims, collection);
      return;
    }
    if (Number(spec.dims) !== dims) {
      throw new Error(
        `vectors: collection "${collection}" expects ${spec.dims}-dim vectors (embedding alias "${spec.alias}") — ` +
          `got ${dims}. The alias was probably re-pointed at a different model; re-index into a fresh collection.`,
      );
    }
  }

  /* ── writes ──────────────────────────────────────────────────────────── */

  async hashes(collection: string, ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const batch of chunks(ids, 400)) {
      const rows = this.db
        .prepare(`SELECT id, hash FROM vec_rows WHERE collection = ? AND id IN (${batch.map(() => "?").join(",")})`)
        .all(collection, ...batch) as Raw[];
      for (const r of rows) out.set(String(r.id), String(r.hash));
    }
    return out;
  }

  async upsert(collection: string, rows: EngineRow[]): Promise<void> {
    if (!rows.length) return;
    for (const row of rows) if (row.vector) this.lockDims(collection, row.vector.length);

    const now = Date.now();
    const upsertRow = this.db.prepare(
      `INSERT INTO vec_rows (collection, id, vector, text, meta, hash, updated_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(collection, id) DO UPDATE SET vector=excluded.vector, text=excluded.text, meta=excluded.meta, hash=excluded.hash, updated_at=excluded.updated_at`,
    );
    const clearMeta = this.db.prepare("DELETE FROM vec_meta WHERE collection = ? AND id = ?");
    const addMeta = this.db.prepare("INSERT OR IGNORE INTO vec_meta (collection, id, field, value) VALUES (?,?,?,?)");
    const clearFts = this.hasFts ? this.db.prepare("DELETE FROM vec_fts WHERE collection = ? AND id = ?") : null;
    const addFts = this.hasFts ? this.db.prepare("INSERT INTO vec_fts (collection, id, text) VALUES (?,?,?)") : null;

    this.db.exec("BEGIN");
    try {
      for (const row of rows) {
        const blob = row.vector ? Buffer.from(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength) : null;
        upsertRow.run(collection, row.id, blob, row.text, row.meta ? JSON.stringify(row.meta) : null, row.hash, now);
        clearMeta.run(collection, row.id);
        for (const [field, values] of Object.entries(row.filterValues)) {
          for (const v of values) addMeta.run(collection, row.id, field, String(v));
        }
        if (clearFts && addFts) {
          clearFts.run(collection, row.id);
          if (row.text) addFts.run(collection, row.id, row.text);
        }
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async delete(collection: string, ids: string[]): Promise<number> {
    let n = 0;
    this.db.exec("BEGIN");
    try {
      for (const batch of chunks(ids, 400)) {
        const marks = batch.map(() => "?").join(",");
        n += Number(this.db.prepare(`DELETE FROM vec_rows WHERE collection = ? AND id IN (${marks})`).run(collection, ...batch).changes);
        this.db.prepare(`DELETE FROM vec_meta WHERE collection = ? AND id IN (${marks})`).run(collection, ...batch);
        if (this.hasFts) this.db.prepare(`DELETE FROM vec_fts WHERE collection = ? AND id IN (${marks})`).run(collection, ...batch);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return n;
  }

  /* ── queries ─────────────────────────────────────────────────────────── */

  async query(collection: string, q: EngineQuery): Promise<Match[]> {
    // (1) Filter first: the indexed side table prunes to a candidate id set
    // BEFORE any scoring touches a vector.
    const candidates = q.filter && Object.keys(q.filter).length ? this.filterIds(collection, q.filter) : null;
    if (candidates && candidates.size === 0) return [];

    const wide = Math.max(q.k * 4, 20); // fusion quality: rank deeper than k on each side
    if (q.mode === "vector") return this.vectorRank(collection, q.vector!, q.k, candidates);
    if (q.mode === "keyword") return this.keywordRank(collection, q.text ?? "", q.k, candidates);

    const [byVector, byKeyword] = [
      q.vector ? this.vectorRank(collection, q.vector, wide, candidates) : [],
      this.keywordRank(collection, q.text ?? "", wide, candidates),
    ];
    const fused = rrfFuse([byVector.map((m) => m.id), byKeyword.map((m) => m.id)]);
    const byId = new Map<string, Match>([...byVector, ...byKeyword].map((m) => [m.id, m]));
    return [...fused.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) // deterministic tie-break
      .slice(0, q.k)
      .map(([id, score]) => ({ ...byId.get(id)!, score }));
  }

  async list(
    collection: string,
    q: { filter?: Filter; limit?: number; offset?: number },
  ): Promise<Array<{ id: string; text: string | null; meta: Record<string, unknown> | null; updatedAt: number }>> {
    const limit = Math.max(1, Math.min(q.limit ?? 100, 1000));
    const offset = Math.max(0, q.offset ?? 0);
    const parse = (r: Raw) => ({
      id: String(r.id),
      text: (r.text as string | null) ?? null,
      meta: r.meta == null ? null : (JSON.parse(String(r.meta)) as Record<string, unknown>),
      updatedAt: Number(r.updated_at),
    });
    const candidates = q.filter && Object.keys(q.filter).length ? this.filterIds(collection, q.filter) : null;
    if (candidates === null) {
      const rows = this.db
        .prepare("SELECT id, text, meta, updated_at FROM vec_rows WHERE collection = ? ORDER BY updated_at DESC, id LIMIT ? OFFSET ?")
        .all(collection, limit, offset) as Raw[];
      return rows.map(parse);
    }
    if (candidates.size === 0) return [];
    const out: ReturnType<typeof parse>[] = [];
    for (const batch of chunks([...candidates], 400)) {
      const rows = this.db
        .prepare(`SELECT id, text, meta, updated_at FROM vec_rows WHERE collection = ? AND id IN (${batch.map(() => "?").join(",")})`)
        .all(collection, ...batch) as Raw[];
      out.push(...rows.map(parse));
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(offset, offset + limit);
  }

  /** AND of equality/any-of via the side table: one indexed lookup per field, intersected. */
  private filterIds(collection: string, filter: Filter): Set<string> {
    let acc: Set<string> | null = null;
    for (const [field, raw] of Object.entries(filter)) {
      const values: FilterValue[] = Array.isArray(raw) ? raw : [raw];
      const marks = values.map(() => "?").join(",");
      const rows = this.db
        .prepare(`SELECT DISTINCT id FROM vec_meta WHERE collection = ? AND field = ? AND value IN (${marks})`)
        .all(collection, field, ...values.map(String)) as Raw[];
      const ids = new Set(rows.map((r) => String(r.id)));
      if (acc === null) {
        acc = ids;
      } else {
        const prev: Set<string> = acc;
        acc = new Set([...prev].filter((id) => ids.has(id)));
      }
      if (acc.size === 0) return acc;
    }
    return acc ?? new Set();
  }

  /** Brute-force cosine over the (possibly pruned) rows with a bounded top-k. */
  private vectorRank(collection: string, vector: Float32Array, k: number, candidates: Set<string> | null): Match[] {
    const rows = this.loadRows(collection, candidates, /* needVector */ true);
    const top: Array<{ score: number; row: (typeof rows)[number] }> = [];
    for (const row of rows) {
      const v = row.vector!;
      if (v.length !== vector.length) continue; // legacy rows from a re-pointed alias never match silently
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += v[i]! * vector[i]!;
      if (top.length < k) {
        top.push({ score: dot, row });
        if (top.length === k) top.sort((a, b) => a.score - b.score);
        continue;
      }
      if (dot > top[0]!.score) {
        top[0] = { score: dot, row };
        top.sort((a, b) => a.score - b.score);
      }
    }
    return top
      .sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id))
      .map(({ score, row }) => ({ id: row.id, score, text: row.text, meta: row.meta }));
  }

  private keywordRank(collection: string, text: string, k: number, candidates: Set<string> | null): Match[] {
    if (!text.trim()) return [];
    if (this.hasFts) {
      const match = ftsQuery(text);
      if (!match) return [];
      const rows = this.db
        .prepare(
          `SELECT id, rank FROM vec_fts WHERE vec_fts MATCH ? AND collection = ? ORDER BY rank LIMIT ?`,
        )
        .all(match, collection, candidates ? k * 10 : k) as Raw[];
      const picked = rows.map((r) => String(r.id)).filter((id) => !candidates || candidates.has(id)).slice(0, k);
      return this.hydrate(collection, picked).map((m, i) => ({ ...m, score: 1 / (i + 1) }));
    }
    // Fallback scorer: token overlap over the text column (honest, zero-dep).
    const queryTokens = tokenize(text);
    const rows = this.loadRows(collection, candidates, /* needVector */ false);
    const scored = rows
      .map((row) => {
        const rowTokens = new Set(tokenize(row.text ?? ""));
        let score = 0;
        for (const t of queryTokens) if (rowTokens.has(t)) score += 1;
        return { row, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id))
      .slice(0, k);
    return scored.map(({ row, score }) => ({ id: row.id, score, text: row.text, meta: row.meta }));
  }

  private loadRows(
    collection: string,
    candidates: Set<string> | null,
    needVector: boolean,
  ): Array<{ id: string; vector: Float32Array | null; text: string | null; meta: Record<string, unknown> | null }> {
    const parse = (r: Raw) => ({
      id: String(r.id),
      vector: r.vector ? new Float32Array((r.vector as Buffer).buffer, (r.vector as Buffer).byteOffset, (r.vector as Buffer).byteLength / 4) : null,
      text: (r.text as string | null) ?? null,
      meta: r.meta == null ? null : (JSON.parse(String(r.meta)) as Record<string, unknown>),
    });
    const vectorClause = needVector ? " AND vector IS NOT NULL" : "";
    if (!candidates) {
      return (this.db.prepare(`SELECT * FROM vec_rows WHERE collection = ?${vectorClause}`).all(collection) as Raw[]).map(parse);
    }
    const out: ReturnType<typeof parse>[] = [];
    for (const batch of chunks([...candidates], 400)) {
      const rows = this.db
        .prepare(`SELECT * FROM vec_rows WHERE collection = ? AND id IN (${batch.map(() => "?").join(",")})${vectorClause}`)
        .all(collection, ...batch) as Raw[];
      out.push(...rows.map(parse));
    }
    return out;
  }

  private hydrate(collection: string, ids: string[]): Match[] {
    if (!ids.length) return [];
    const rows = this.loadRows(collection, new Set(ids), false);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => ({ id: r.id, score: 0, text: r.text, meta: r.meta }));
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
