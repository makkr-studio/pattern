/**
 * @pattern-js/mod-vectors — the admin surface (Tier-1 declarative, zero build).
 *
 * One Vectors page under Data, three sections: the collections table (what is
 * indexed, through which model), **Ingest text** (paste → chunk → embed —
 * feeding a knowledge base is a form, not a curl), and **Search** (try a
 * hybrid query, see scored matches). Together they are the whole RAG loop
 * without leaving the admin. Each section is backed by its own dedicated
 * admin-scoped route.
 */

import { httpEndpoint, fromBody, value, z, type FrontendContribution, type OpContext, type OpDefinition, type Workflow } from "@pattern-js/core";
import { chunkDoc } from "./chunk.js";
import { VECTORS_SERVICE, type VectorsService } from "./service.js";
import { collectionSpecSchema, type QueryMode } from "./types.js";

const PATH = "/vectors/api/collections";
const INGEST_PATH = "/vectors/api/ingest";
const SEARCH_PATH = "/vectors/api/search";
const API = "/admin/api";

function requireService(ctx: OpContext): VectorsService {
  const svc = ctx.services[VECTORS_SERVICE] as VectorsService | undefined;
  if (!svc) throw new Error("vectors: service not available — is @pattern-js/mod-vectors listed in pattern.config.json mods?");
  return svc;
}

/** Stable content hash (djb2) — re-pasting the same text re-uses the doc id, so dedupe holds. */
function stableHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** The form's meta field is a JSON string (or empty); a workflow may pass an object. */
function parseMeta(raw: unknown): Record<string, unknown> | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  const s = String(raw).trim();
  if (!s) return undefined;
  try {
    const parsed = JSON.parse(s) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* fall through to the located error */
  }
  throw new Error(`meta must be a JSON object, e.g. {"topic":"billing"} — got: ${s.slice(0, 60)}`);
}

/** Backing op for the collections table (privileged; the route carries the admin gate). */
export const collectionsListOp: OpDefinition = {
  type: "vectors.collections.list",
  title: "vectors.collections.list",
  description: "List vector collections with alias, dims, filterables, row count and the active engine (admin).",
  reusable: false,
  sensitivity: "privileged",
  inputs: {},
  outputs: { collections: value() },
  execute: async (ctx) => {
    const svc = ctx.services[VECTORS_SERVICE] as VectorsService | undefined;
    if (!svc) return { collections: [] };
    const collections = await svc.listCollections();
    return {
      collections: collections.map((c) => ({
        name: c.name,
        alias: c.alias,
        dims: c.dims ?? "(locks on first write)",
        filterables: c.filterables.join(", ") || "—",
        rows: c.rows,
        engine: svc.engineId(),
      })),
    };
  },
};

/** Paste-to-RAG (admin): chunk a text and index it, creating the collection when new. */
export const collectionsIngestOp: OpDefinition = {
  type: "vectors.collections.ingest",
  title: "vectors.collections.ingest",
  description:
    "Ingest pasted text into a collection (admin): chunk → embed → upsert, creating the collection (with the " +
    "given embedding alias) when it doesn't exist yet. Re-pasting the same text re-uses its content-derived doc id, " +
    "so unchanged chunks are skipped. Args { collection, text, alias?, docId?, meta? (JSON object) }.",
  reusable: false,
  sensitivity: "privileged",
  inputs: {
    collection: value(z.string()),
    text: value(z.string()),
    alias: value(z.string().optional()),
    docId: value(z.string().optional()),
    meta: value(z.unknown().optional()),
  },
  outputs: { result: value() },
  execute: async (ctx) => {
    const svc = requireService(ctx);
    const collection = String((await ctx.input.value("collection")) ?? "").trim();
    const text = String((await ctx.input.value("text")) ?? "");
    if (!collection) throw new Error("collection is required");
    if (!text.trim()) throw new Error("nothing to ingest — paste some text");
    const alias = ctx.input.has("alias") ? String((await ctx.input.value("alias")) ?? "").trim() : "";
    const docIdIn = ctx.input.has("docId") ? String((await ctx.input.value("docId")) ?? "").trim() : "";
    const meta = parseMeta(ctx.input.has("meta") ? await ctx.input.value("meta") : undefined);

    // Only a NEW collection takes the alias — an existing one already declared
    // its embedding model, and silently re-pointing it would corrupt the space.
    const exists = (await svc.listCollections()).some((c) => c.name === collection);
    // Through the schema, so metric/filterables defaults apply like the canvas op's config does.
    if (!exists) await svc.ensureCollection(collectionSpecSchema.parse({ name: collection, alias: alias || "embeddings" }));

    const docId = docIdIn || `paste-${stableHash(text)}`;
    const chunks = chunkDoc({ id: docId, text, meta }, { maxChars: 1200, overlap: 150, separators: ["\n\n", "\n", ". "] });
    const res = await svc.upsert(collection, chunks.map((c) => ({ id: c.id, text: c.text, meta: c.meta })), ctx);
    return { result: { ok: true, collection, docId, chunks: chunks.length, indexed: res.count, embedded: res.embedded } };
  },
};

/** Try a query (admin): hybrid by default, scored matches back — the smoke test for what got indexed. */
export const collectionsSearchOp: OpDefinition = {
  type: "vectors.collections.search",
  title: "vectors.collections.search",
  description:
    "Search a collection from the admin (hybrid by default): top-k scored matches with their text and meta — " +
    "the quickest way to verify what an ingest actually indexed. Args { collection, query, k?, mode? (vector/keyword/hybrid) }.",
  reusable: false,
  sensitivity: "privileged",
  inputs: {
    collection: value(z.string()),
    query: value(z.string()),
    k: value(z.union([z.string(), z.number()]).optional()),
    mode: value(z.string().optional()),
  },
  outputs: { matches: value() },
  execute: async (ctx) => {
    const svc = requireService(ctx);
    const collection = String((await ctx.input.value("collection")) ?? "").trim();
    const query = String((await ctx.input.value("query")) ?? "");
    if (!collection || !query.trim()) throw new Error("collection and query are required");
    const kRaw = ctx.input.has("k") ? String((await ctx.input.value("k")) ?? "").trim() : "";
    const k = kRaw ? Number(kRaw) : 5;
    if (!Number.isFinite(k) || k <= 0) throw new Error("k must be a positive number");
    const modeRaw = ctx.input.has("mode") ? String((await ctx.input.value("mode")) ?? "").trim() : "";
    const mode = (modeRaw || "hybrid") as QueryMode;
    const matches = await svc.query(collection, { text: query, k, mode }, ctx);
    return {
      matches: matches.map((m) => ({
        score: Number(m.score.toFixed(4)),
        id: m.id,
        text: (m.text ?? "").length > 200 ? `${(m.text ?? "").slice(0, 200)}…` : (m.text ?? ""),
        meta: m.meta ?? {},
      })),
    };
  },
};

export function vectorsAdminRoutes(): Workflow[] {
  return [
    httpEndpoint({
      id: "vectors.route.admin.collections",
      name: `Vectors · GET ${API}${PATH}`,
      method: "GET",
      path: `${API}${PATH}`,
      op: "vectors.collections.list",
      io: { out: "collections" },
      auth: { scopes: ["admin"] },
    }),
    httpEndpoint({
      id: "vectors.route.admin.ingest",
      name: `Vectors · POST ${API}${INGEST_PATH}`,
      method: "POST",
      path: `${API}${INGEST_PATH}`,
      op: "vectors.collections.ingest",
      io: { in: { collection: fromBody(), text: fromBody(), alias: fromBody(), docId: fromBody(), meta: fromBody() }, out: "result" },
      auth: { scopes: ["admin"] },
    }),
    httpEndpoint({
      id: "vectors.route.admin.search",
      name: `Vectors · POST ${API}${SEARCH_PATH}`,
      method: "POST",
      path: `${API}${SEARCH_PATH}`,
      op: "vectors.collections.search",
      io: { in: { collection: fromBody(), query: fromBody(), k: fromBody(), mode: fromBody() }, out: "matches" },
      auth: { scopes: ["admin"] },
    }),
  ];
}

export function vectorsFrontend(): FrontendContribution {
  return {
    menu: [{ category: "Data", label: "Vectors", icon: "network", path: "/x/vectors/collections", order: 30 }],
    pages: [
      {
        // The whole RAG loop on one page: what's indexed, paste to ingest, search to verify.
        path: "/x/vectors/collections",
        views: [
          {
            title: "Collections",
            view: {
              kind: "table",
              route: { method: "GET", path: PATH },
              columns: [
                { key: "name", label: "Collection" },
                { key: "alias", label: "Embedding alias" },
                { key: "dims", label: "Dims" },
                { key: "filterables", label: "Filterables" },
                { key: "rows", label: "Rows" },
                { key: "engine", label: "Engine" },
              ],
            },
          },
          {
            title: "Ingest text",
            view: {
              kind: "form",
              schema: {
                type: "object",
                properties: {
                  collection: { type: "string", default: "kb", description: "Target collection (created if new)" },
                  text: { type: "string", format: "multiline", description: "Paste anything — it's chunked, embedded and indexed" },
                  alias: { type: "string", default: "embeddings", description: "Embedding alias for a NEW collection (Settings → AI Providers)" },
                  docId: { type: "string", description: "Stable id for re-ingesting updates (empty = derived from the text)" },
                  meta: { type: "string", description: 'JSON object stamped on every chunk, e.g. {"topic":"billing"} — filterable if declared' },
                },
                required: ["collection", "text"],
              },
              route: { method: "POST", path: INGEST_PATH },
            },
          },
          {
            title: "Search",
            view: {
              kind: "form",
              schema: {
                type: "object",
                properties: {
                  collection: { type: "string", default: "kb", description: "Collection to search" },
                  query: { type: "string", description: "What are you looking for?" },
                  k: { type: "string", default: "5", description: "How many matches" },
                  mode: { type: "string", enum: ["hybrid", "vector", "keyword"], description: "hybrid = vector + keyword, RRF-fused" },
                },
                required: ["collection", "query"],
              },
              route: { method: "POST", path: SEARCH_PATH },
            },
          },
        ],
      },
    ],
  };
}
