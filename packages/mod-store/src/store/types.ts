/**
 * @pattern/mod-store — store contracts.
 *
 * Three facilities behind driver interfaces (sqlite built-in, in-memory for
 * tests; Postgres/S3 later are drivers, not redesigns):
 *
 *  - **Documents** — collections of JSON objects with *declared* indexed
 *    fields. Queries are equality on indexed fields + order/limit/offset:
 *    deliberately not a query language, so every driver can honor the same
 *    contract with boring SQL.
 *  - **Blobs** — binary payloads (images…), metadata row + a pluggable byte
 *    driver (filesystem built-in).
 *  - **Leases** — TTL'd, CAS-claimed advisory locks. The conventional owner is
 *    a runId: the mod auto-releases every lease owned by a run when that run
 *    settles (ok, error or cancel), so workflows never leak a lock; the TTL is
 *    the crash backstop.
 *
 * Every racy mutation is compare-and-swap (rows carry `version`; `null` means
 * "lost the race — re-read and retry"), mirroring mod-identity's discipline.
 */

export interface CollectionDef {
  name: string;
  /**
   * Dotted paths into the document data to index (e.g. "ownerId",
   * "meta.kind"). Only indexed fields are queryable; values are coerced to
   * strings for storage (numbers compare lexicographically — zero-pad if you
   * need ordered numeric indexes; built-in `createdAt`/`updatedAt`/`id` order
   * natively).
   */
  indexes: string[];
}

export interface DocumentRow {
  id: string;
  collection: string;
  data: Record<string, unknown>;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface QueryOptions {
  collection: string;
  /** Equality on *indexed* fields (values coerced like index extraction). */
  where?: Record<string, unknown>;
  /** An indexed field, or one of the built-ins: "createdAt" | "updatedAt" | "id". */
  orderBy?: string;
  orderDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface DocumentStore {
  /**
   * Idempotent: creates the collection and any *new* index fields (existing
   * docs are backfilled). Call from a mod's `ready` (after mod-store's setup).
   */
  ensureCollection(def: CollectionDef): Promise<void>;
  listCollections(): Promise<Array<CollectionDef & { docCount: number }>>;
  get(collection: string, id: string): Promise<DocumentRow | null>;
  /**
   * Upsert when `expectedVersion` is omitted; CAS update when given (the row
   * must exist at that version). Returns the new row, or null on a lost race.
   */
  put(
    collection: string,
    id: string,
    data: Record<string, unknown>,
    expectedVersion?: number,
  ): Promise<DocumentRow | null>;
  /** Shallow-merge `patch` into data (CAS — version required). */
  patch(
    collection: string,
    id: string,
    patch: Record<string, unknown>,
    expectedVersion: number,
  ): Promise<DocumentRow | null>;
  delete(collection: string, id: string): Promise<boolean>;
  query(opts: QueryOptions): Promise<DocumentRow[]>;
  count(collection: string, where?: Record<string, unknown>): Promise<number>;
}

/* ── blobs ─────────────────────────────────────────────────────────────── */

export interface BlobMeta {
  id: string;
  mime: string;
  size: number;
  ownerId: string | null;
  createdAt: number;
}

export interface BlobStore {
  /** Streams are buffered up to the configured cap; bytes land on the driver. */
  put(
    data: Uint8Array | ReadableStream<Uint8Array>,
    opts?: { mime?: string; ownerId?: string | null },
  ): Promise<BlobMeta>;
  get(id: string): Promise<{ meta: BlobMeta; stream: ReadableStream<Uint8Array> } | null>;
  getMeta(id: string): Promise<BlobMeta | null>;
  delete(id: string): Promise<boolean>;
  list(opts?: { ownerId?: string; limit?: number; offset?: number }): Promise<BlobMeta[]>;
}

/* ── leases ────────────────────────────────────────────────────────────── */

export interface LeaseRow {
  key: string;
  owner: string;
  expiresAt: number;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export type AcquireResult =
  | { ok: true; lease: LeaseRow }
  | { ok: false; owner: string; expiresAt: number };

export interface LeaseStore {
  /**
   * Claim `key` for `owner` (re-entrant for the same owner; an expired lease
   * is stealable). Conflict is a VALUE, not an error — workflows branch on it.
   */
  acquire(key: string, owner: string, ttlMs: number): Promise<AcquireResult>;
  /** Extend a lease still held by `owner`. */
  renew(key: string, owner: string, ttlMs: number): Promise<AcquireResult>;
  /** Release if held by `owner` (no-op otherwise). */
  release(key: string, owner: string): Promise<void>;
  /** Release every lease owned by `owner` (run-settle auto-release). */
  releaseAll(owner: string): Promise<number>;
  get(key: string): Promise<LeaseRow | null>;
}

/* ── the bag ───────────────────────────────────────────────────────────── */

export interface PatternStores {
  docs: DocumentStore;
  blobs: BlobStore;
  leases: LeaseStore;
  close(): Promise<void>;
}

/** Coerce a document field value to its index representation (or null = unindexed). */
export function indexValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/** Read a dotted path out of a document. */
export function valueAtPath(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}
