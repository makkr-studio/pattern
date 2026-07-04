/**
 * @pattern-js/mod-vectors — the VectorsService (key "vectorsService").
 *
 * The contract surface between ops/sibling mods and whichever engine is
 * registered (mod-email's driver pattern: the default "local" engine ships
 * here; sqlite-vec/pgvector drivers register in their `ready`). Embedding
 * happens HERE, always through the collection's declared alias, via the
 * duck-typed "aiProviderService" — mod-ai is never imported.
 */

import { createHash } from "node:crypto";
import type { OpContext } from "@pattern-js/core";
import { normalize } from "./engine-local.js";
import type {
  CollectionInfo,
  CollectionSpec,
  EngineRow,
  Filter,
  FilterValue,
  Match,
  QueryMode,
  VectorItem,
  VectorsEngine,
} from "./types.js";

export const VECTORS_SERVICE = "vectorsService";

/* ── duck-typed views of mod-ai (never imported) ─────────────────────────── */

const AI_PROVIDER_SERVICE = "aiProviderService";

interface EmbeddingModelLike {
  doEmbed(opts: { values: string[]; abortSignal?: AbortSignal }): Promise<{ embeddings: number[][] }>;
  maxEmbeddingsPerCall?: number | undefined | (() => PromiseLike<number | undefined>);
}

interface AiProviderLike {
  textEmbeddingModel(ref: { alias: string }, ctx: OpContext): Promise<EmbeddingModelLike>;
}

export interface VectorsService {
  registerEngine(engine: VectorsEngine): void;
  /** The active engine's id ("local" unless a driver replaced it). */
  engineId(): string;
  ensureCollection(spec: CollectionSpec): Promise<void>;
  listCollections(): Promise<CollectionInfo[]>;
  /** Embed-and-write. Items may carry raw vectors (embedding skipped) or text. */
  upsert(collection: string, items: VectorItem[], ctx: OpContext): Promise<{ count: number; embedded: number }>;
  query(
    collection: string,
    input: { text?: string; vector?: number[]; k?: number; filter?: Filter; mode?: QueryMode },
    ctx: OpContext,
  ): Promise<Match[]>;
  delete(collection: string, ids: string[]): Promise<number>;
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Meta values for the DECLARED filterable fields (arrays flatten to any-of). */
function extractFilterables(meta: Record<string, unknown> | undefined, declared: string[]): Record<string, FilterValue[]> {
  const out: Record<string, FilterValue[]> = {};
  if (!meta) return out;
  for (const field of declared) {
    const raw = meta[field];
    if (raw === undefined || raw === null) continue;
    const values = (Array.isArray(raw) ? raw : [raw]).filter(
      (v): v is FilterValue => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
    );
    if (values.length) out[field] = values;
  }
  return out;
}

export class DefaultVectorsService implements VectorsService {
  private readonly engines = new Map<string, VectorsEngine>();
  private active: string;

  constructor(local: VectorsEngine) {
    this.engines.set(local.id, local);
    this.active = local.id;
  }

  registerEngine(engine: VectorsEngine): void {
    this.engines.set(engine.id, engine);
    // Last registered driver wins (there is at most one real driver installed);
    // the local engine stays available as "local".
    this.active = engine.id;
  }

  engineId(): string {
    return this.active;
  }

  private engine(): VectorsEngine {
    return this.engines.get(this.active)!;
  }

  async ensureCollection(spec: CollectionSpec): Promise<void> {
    if (!spec.alias) {
      throw new Error(
        `vectors: collection "${spec.name}" must declare its embedding alias — that declaration is what makes ` +
          "index-with-one-model-query-with-another unrepresentable.",
      );
    }
    await this.engine().ensureCollection(spec);
  }

  listCollections(): Promise<CollectionInfo[]> {
    return this.engine().listCollections();
  }

  private async spec(collection: string): Promise<CollectionSpec> {
    const spec = await this.engine().getCollection(collection);
    if (!spec) {
      throw new Error(`vectors: unknown collection "${collection}" — declare it first with vectors.collection.ensure`);
    }
    return spec;
  }

  /** The collection's embedding model, via its declared alias — the ONE path to a vector. */
  private async model(spec: CollectionSpec, ctx: OpContext): Promise<EmbeddingModelLike> {
    const provider = ctx.services[AI_PROVIDER_SERVICE] as AiProviderLike | undefined;
    if (!provider || typeof provider.textEmbeddingModel !== "function") {
      throw new Error(
        `vectors: embedding text for collection "${spec.name}" needs @pattern-js/mod-ai installed ` +
          `(it provides the "${spec.alias}" embedding alias). Raw-vector upsert/query works without it.`,
      );
    }
    return provider.textEmbeddingModel({ alias: spec.alias }, ctx);
  }

  private async embed(spec: CollectionSpec, values: string[], ctx: OpContext): Promise<Float32Array[]> {
    if (!values.length) return [];
    const model = await this.model(spec, ctx);
    const perCallRaw = typeof model.maxEmbeddingsPerCall === "function" ? await model.maxEmbeddingsPerCall() : model.maxEmbeddingsPerCall;
    const perCall = Math.max(1, Math.min(Number(perCallRaw) || 64, 64));
    const out: Float32Array[] = [];
    for (let i = 0; i < values.length; i += perCall) {
      const batch = values.slice(i, i + perCall);
      const { embeddings } = await model.doEmbed({ values: batch, abortSignal: ctx.signal });
      for (const e of embeddings) out.push(normalize(e));
    }
    return out;
  }

  async upsert(collection: string, items: VectorItem[], ctx: OpContext): Promise<{ count: number; embedded: number }> {
    const spec = await this.spec(collection);
    const rows: EngineRow[] = [];
    const toEmbed: Array<{ index: number; text: string }> = [];

    for (const item of items) {
      if (item.vector === undefined && !item.text?.trim()) {
        throw new Error(`vectors: an upsert item needs \`text\` (embedded via alias "${spec.alias}") or a raw \`vector\``);
      }
      const id = item.id ?? sha256(item.text ?? JSON.stringify(item.vector)).slice(0, 24);
      const hash = sha256(JSON.stringify({ t: item.text ?? null, v: item.vector ?? null, m: item.meta ?? null }));
      rows.push({
        id,
        vector: item.vector ? normalize(item.vector) : null,
        text: item.text ?? null,
        meta: item.meta ?? null,
        filterValues: extractFilterables(item.meta, spec.filterables),
        hash,
      });
      if (item.vector === undefined) toEmbed.push({ index: rows.length - 1, text: item.text! });
    }

    // Content-hash diffing: unchanged rows (same id + hash) skip re-embedding
    // AND re-writing — the boot indexer leans on this after every upgrade.
    const existing = await this.engine().hashes(collection, rows.map((r) => r.id));
    const changed = new Set(rows.filter((r) => existing.get(r.id) !== r.hash).map((r) => r.id));
    const pendingEmbeds = toEmbed.filter(({ index }) => changed.has(rows[index]!.id));

    const embeddings = await this.embed(spec, pendingEmbeds.map((p) => p.text), ctx);
    pendingEmbeds.forEach(({ index }, i) => {
      rows[index]!.vector = embeddings[i]!;
    });

    const writes = rows.filter((r) => changed.has(r.id));
    await this.engine().upsert(collection, writes);
    return { count: writes.length, embedded: embeddings.length };
  }

  async query(
    collection: string,
    input: { text?: string; vector?: number[]; k?: number; filter?: Filter; mode?: QueryMode },
    ctx: OpContext,
  ): Promise<Match[]> {
    const spec = await this.spec(collection);
    const mode = input.mode ?? "vector";
    const k = Math.max(1, Math.min(input.k ?? 8, 100));

    // Undeclared filter field = a located error naming the field AND the fix.
    if (input.filter) {
      const declared = new Set(spec.filterables);
      for (const field of Object.keys(input.filter)) {
        if (!declared.has(field)) {
          throw new Error(
            `vectors: "${field}" is not a filterable field of collection "${collection}" — declared: ` +
              `[${spec.filterables.join(", ") || "none"}]. Add it to \`filterables\` in vectors.collection.ensure and re-upsert.`,
          );
        }
      }
    }

    if (!input.text?.trim() && input.vector === undefined) {
      throw new Error("vectors: query needs `text` (embedded via the collection's alias) or a raw `vector`");
    }
    if (mode !== "vector" && !input.text?.trim()) {
      throw new Error(`vectors: mode "${mode}" ranks by keywords — it needs a \`text\` query`);
    }

    let vector: Float32Array | undefined;
    if (mode !== "keyword") {
      vector = input.vector ? normalize(input.vector) : (await this.embed(spec, [input.text!], ctx))[0];
    }

    return this.engine().query(collection, { vector, text: input.text, k, filter: input.filter, mode });
  }

  delete(collection: string, ids: string[]): Promise<number> {
    return this.engine().delete(collection, ids);
  }
}
