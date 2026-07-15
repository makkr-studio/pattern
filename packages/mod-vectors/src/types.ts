/**
 * @pattern-js/mod-vectors — value shapes + the engine SPI.
 *
 * The load-bearing idea: a collection DECLARES its embedding alias (and, once
 * written, its dimensions), so "indexed with one model, queried with another"
 * — the classic silent RAG bug — is unrepresentable. Filterable metadata is
 * declared the same way (mod-store's declared-index philosophy): only
 * declared fields are indexed and only declared fields may be filtered on,
 * so a typo'd filter is a located error, not an empty result.
 */

import { z } from "@pattern-js/core";

export const filterValueSchema = z.union([z.string(), z.number(), z.boolean()]);
/** AND of equality/any-of — deliberately minimal so every driver can push it down. */
export const filterSchema = z.record(z.string(), z.union([filterValueSchema, z.array(filterValueSchema)]));
export type Filter = z.infer<typeof filterSchema>;
export type FilterValue = z.infer<typeof filterValueSchema>;

export const queryModeSchema = z.enum(["vector", "keyword", "hybrid"]);
export type QueryMode = z.infer<typeof queryModeSchema>;

export const collectionSpecSchema = z.object({
  name: z.string().min(1),
  /** The embedding alias this collection indexes AND queries with. */
  alias: z.string().min(1),
  /** Locked on first write when omitted; a later mismatch is a hard, located error. */
  dims: z.number().int().positive().optional(),
  metric: z.literal("cosine").default("cosine"),
  /** Meta fields extracted into the indexed side table — the ONLY filterable fields. */
  filterables: z.array(z.string()).default([]),
});
export type CollectionSpec = z.infer<typeof collectionSpecSchema>;

/** One upsert item: text to embed (id defaults to a hash) or a raw vector. */
export const vectorItemSchema = z.object({
  id: z.string().optional(),
  text: z.string().optional(),
  vector: z.array(z.number()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type VectorItem = z.infer<typeof vectorItemSchema>;

export interface Match {
  id: string;
  score: number;
  text: string | null;
  meta: Record<string, unknown> | null;
}

export interface CollectionInfo extends CollectionSpec {
  rows: number;
}

/** A fully-prepared row the service hands the engine (embedding already done). */
export interface EngineRow {
  id: string;
  /** L2-normalized (cosine = dot); null for keyword-only rows. */
  vector: Float32Array | null;
  text: string | null;
  meta: Record<string, unknown> | null;
  /** Values for the DECLARED filterable fields, pre-extracted from meta. */
  filterValues: Record<string, FilterValue[]>;
  /** Content hash — lets indexers skip re-embedding unchanged text. */
  hash: string;
}

export interface EngineQuery {
  /** L2-normalized query vector (vector/hybrid modes). */
  vector?: Float32Array;
  /** The raw text query (keyword/hybrid modes). */
  text?: string;
  k: number;
  filter?: Filter;
  mode: QueryMode;
}

/**
 * The driver SPI (mod-email's registerDriver pattern). The default "local"
 * engine is sqlite-backed brute force; sqlite-vec / pgvector drivers register
 * the same shape and receive `{ filter, mode }` to push down.
 */
/** One stored row, as enumeration (no scores — that's `query`'s job). */
export interface ListedRow {
  id: string;
  text: string | null;
  meta: Record<string, unknown> | null;
  updatedAt: number;
}

export interface VectorsEngine {
  id: string;
  ensureCollection(spec: CollectionSpec): Promise<void>;
  getCollection(name: string): Promise<CollectionSpec | null>;
  listCollections(): Promise<CollectionInfo[]>;
  /** Existing content hashes for these ids (indexers diff against this). */
  hashes(collection: string, ids: string[]): Promise<Map<string, string>>;
  upsert(collection: string, rows: EngineRow[]): Promise<void>;
  query(collection: string, q: EngineQuery): Promise<Match[]>;
  delete(collection: string, ids: string[]): Promise<number>;
  /**
   * Enumerate rows, newest-first, optionally pruned by a declared-filterable
   * filter (admin browsers, memory managers). OPTIONAL — a driver that can't
   * scan cheaply may omit it; the service reports that honestly.
   */
  list?(collection: string, q: { filter?: Filter; limit?: number; offset?: number }): Promise<ListedRow[]>;
  /** Lock dims on first write; throws (naming the alias) on mismatch. */
  close(): Promise<void>;
}
