/**
 * @pattern-js/mod-vectors — the `vectors.*` op catalog.
 *
 * Pure domain ops over the VectorsService: declare a collection, chunk text,
 * upsert (text is embedded through the collection's declared alias), query
 * (vector / keyword / hybrid, filterable), delete — plus `vectors.index`,
 * the chunk→embed→upsert convenience that makes on-canvas RAG ingestion a
 * single node.
 */

import { value, z, type OpContext, type OpDefinition } from "@pattern-js/core";
import { chunkDoc, type Chunk } from "./chunk.js";
import { VECTORS_SERVICE, type VectorsService } from "./service.js";
import { collectionSpecSchema, filterSchema, queryModeSchema, vectorItemSchema } from "./types.js";

function service(ctx: OpContext): VectorsService {
  const svc = ctx.services[VECTORS_SERVICE] as VectorsService | undefined;
  if (!svc) throw new Error("vectors: service not available — is @pattern-js/mod-vectors listed in pattern.config.json mods?");
  return svc;
}

const chunkConfig = {
  maxChars: z.number().int().positive().default(1200),
  overlap: z.number().int().min(0).default(150),
  separators: z.array(z.string()).default(["\n\n", "\n", ". "]),
};

const docSchema = z.object({
  id: z.string().optional(),
  text: z.string(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const collectionEnsure: OpDefinition = {
  type: "vectors.collection.ensure",
  title: "vectors.collection.ensure",
  description:
    "Declare (idempotently) an embedding collection: name + embedding alias + filterable meta fields. " +
    "Dims lock on first write; only declared filterables can be filtered on.",
  config: collectionSpecSchema,
  inputs: {},
  outputs: { collection: value(z.string()) },
  execute: async (ctx) => {
    const spec = collectionSpecSchema.parse(ctx.config);
    await service(ctx).ensureCollection(spec);
    return { collection: spec.name };
  },
};

const upsert: OpDefinition = {
  type: "vectors.upsert",
  title: "vectors.upsert",
  description:
    "Write items into a collection: { items: [{ id?, text, meta? } | { id, vector, meta? }] } → { count, embedded }. " +
    "Text embeds through the collection's declared alias; unchanged items (same id + content hash) are skipped.",
  config: z.object({ collection: z.string().min(1) }),
  inputs: { items: value(z.array(vectorItemSchema)) },
  outputs: { count: value(z.number()), embedded: value(z.number()) },
  execute: async (ctx) => {
    const { collection } = ctx.config as { collection: string };
    const items = z.array(vectorItemSchema).parse((await ctx.input.value("items")) ?? []);
    const res = await service(ctx).upsert(collection, items, ctx);
    return { count: res.count, embedded: res.embedded };
  },
};

const query: OpDefinition = {
  type: "vectors.query",
  title: "vectors.query",
  description:
    "Search a collection: text (embedded via the collection's alias) or a raw vector → { matches: [{ id, score, text, meta }] }. " +
    "mode: vector | keyword | hybrid (RRF fusion); filter: { field: value | values[] } over DECLARED filterables, pruned before scoring.",
  config: z.object({
    collection: z.string().min(1),
    k: z.number().int().positive().max(100).default(8),
    mode: queryModeSchema.default("vector"),
    filter: filterSchema.optional(),
  }),
  inputs: {
    text: value(z.string().optional()),
    vector: value(z.array(z.number()).optional()),
    filter: value(filterSchema.optional()),
  },
  outputs: { matches: value() },
  execute: async (ctx) => {
    const cfg = ctx.config as { collection: string; k: number; mode: "vector" | "keyword" | "hybrid"; filter?: z.infer<typeof filterSchema> };
    const [text, vector, filterIn] = await Promise.all([
      ctx.input.has("text") ? ctx.input.value<string>("text") : undefined,
      ctx.input.has("vector") ? ctx.input.value<number[]>("vector") : undefined,
      ctx.input.has("filter") ? ctx.input.value<z.infer<typeof filterSchema>>("filter") : undefined,
    ]);
    const matches = await service(ctx).query(
      cfg.collection,
      { text: text ?? undefined, vector: vector ?? undefined, k: cfg.k, mode: cfg.mode, filter: filterIn ?? cfg.filter },
      ctx,
    );
    return { matches };
  },
};

const del: OpDefinition = {
  type: "vectors.delete",
  title: "vectors.delete",
  description: "Delete rows by id from a collection: { ids } → { count }.",
  config: z.object({ collection: z.string().min(1) }),
  inputs: { ids: value(z.array(z.string())) },
  outputs: { count: value(z.number()) },
  execute: async (ctx) => {
    const { collection } = ctx.config as { collection: string };
    const ids = (await ctx.input.value<string[]>("ids")) ?? [];
    return { count: await service(ctx).delete(collection, ids) };
  },
};

const chunk: OpDefinition = {
  type: "vectors.chunk",
  title: "vectors.chunk",
  description:
    "Split text for indexing (recursive character splitter, overlap carried across boundaries). " +
    "Input `text` (one string) or `docs` ([{ id?, text, meta? }]) → { chunks: [{ id, text, meta? }] } with ids `${docId}#${i}`.",
  config: z.object(chunkConfig),
  inputs: { text: value(z.string().optional()), docs: value(z.array(docSchema).optional()) },
  outputs: { chunks: value() },
  execute: async (ctx) => {
    const cfg = ctx.config as { maxChars: number; overlap: number; separators: string[] };
    const [text, docs] = await Promise.all([
      ctx.input.has("text") ? ctx.input.value<string>("text") : undefined,
      ctx.input.has("docs") ? ctx.input.value<Array<z.infer<typeof docSchema>>>("docs") : undefined,
    ]);
    const inputDocs = docs?.length ? docs : text !== undefined && text !== null ? [{ text }] : [];
    if (!inputDocs.length) throw new Error("vectors.chunk: wire `text` (one string) or `docs` (an array of { id?, text, meta? })");
    const chunks: Chunk[] = inputDocs.flatMap((d) => chunkDoc(d, cfg));
    return { chunks };
  },
};

const index: OpDefinition = {
  type: "vectors.index",
  title: "vectors.index",
  description:
    "Chunk → embed → upsert in one node (the RAG ingestion convenience). Input `docs` ([{ id?, text, meta? }]); " +
    "chunk ids are `${docId}#${i}`, each chunk carries its doc's meta. Unchanged chunks are skipped (content hash).",
  config: z.object({ collection: z.string().min(1), ...chunkConfig }),
  inputs: { docs: value(z.array(docSchema)) },
  outputs: { count: value(z.number()), chunks: value(z.number()) },
  execute: async (ctx) => {
    const cfg = ctx.config as { collection: string; maxChars: number; overlap: number; separators: string[] };
    const docs = z.array(docSchema).parse((await ctx.input.value("docs")) ?? []);
    const chunks = docs.flatMap((d) => chunkDoc(d, cfg));
    const res = await service(ctx).upsert(
      cfg.collection,
      chunks.map((c) => ({ id: c.id, text: c.text, meta: c.meta })),
      ctx,
    );
    return { count: res.count, chunks: chunks.length };
  },
};

export const vectorsOps: OpDefinition[] = [collectionEnsure, upsert, query, del, chunk, index];
