/**
 * @pattern-js/mod-buddy — Buddy's knowledge retrieval.
 *
 * One op, `buddy.knowledge.search`, behind one output shape
 * `{ results: [{ title, path, snippet, score }] }`. The BASELINE engine is
 * lexical over the live handbook (mod-docs' DocsContent: page titles,
 * headings, page bodies) plus the op catalog — first-class, not a fallback:
 * this corpus is structured docs and exact op names, where lexical genuinely
 * shines. When mod-vectors + an embedding alias are present the same op
 * silently upgrades to semantic retrieval (0.4 phase 7); the output shape
 * never changes, so nothing downstream cares which engine answered.
 */

import { value, z, type Engine, type OpContext, type OpDefinition } from "@pattern-js/core";
import { DocsContent, resolveOptions } from "@pattern-js/mod-docs";

export interface KnowledgeResult {
  title: string;
  /** `guide/<chapter>/<file>` for handbook pages, `op/<type>` for catalog hits. */
  path: string;
  snippet: string;
  score: number;
}

/* ── duck-typed views of mod-vectors + mod-ai (NEVER imported) ───────────── */

const VECTORS_SERVICE = "vectorsService";
const AI_CONFIG_SERVICE = "aiConfig";

export const DOCS_COLLECTION = "buddy.docs";

interface VectorsLike {
  ensureCollection(spec: { name: string; alias: string; metric: "cosine"; filterables: string[] }): Promise<void>;
  upsert(
    collection: string,
    items: Array<{ id: string; text: string; meta?: Record<string, unknown> }>,
    ctx: OpContext,
  ): Promise<{ count: number; embedded: number }>;
  query(
    collection: string,
    input: { text: string; k: number; mode: "hybrid" },
    ctx: OpContext,
  ): Promise<Array<{ id: string; score: number; text: string | null; meta: Record<string, unknown> | null }>>;
}

interface AiConfigLike {
  aliases(): Array<{ name: string; modality?: string }>;
}

function vectorsOf(services: Record<string, unknown>): VectorsLike | null {
  const svc = services[VECTORS_SERVICE] as VectorsLike | undefined;
  return svc && typeof svc.query === "function" ? svc : null;
}

/** The embedding alias Buddy indexes with: "buddy" when it embeds, else the first embedding alias. */
function embeddingAlias(services: Record<string, unknown>): string | null {
  const config = services[AI_CONFIG_SERVICE] as AiConfigLike | undefined;
  if (!config || typeof config.aliases !== "function") return null;
  const embedding = config.aliases().filter((a) => a.modality === "embedding");
  return embedding.find((a) => a.name === "buddy")?.name ?? embedding[0]?.name ?? null;
}

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter((t) => t.length > 1);

/** Overlap score of query tokens against a text (whole-token 2, substring 1). */
function overlap(queryTokens: string[], text: string): number {
  const hay = text.toLowerCase();
  const hayTokens = new Set(tokenize(hay));
  let score = 0;
  for (const q of queryTokens) {
    if (hayTokens.has(q)) score += 2;
    else if (hay.includes(q)) score += 1;
  }
  return score;
}

/** A ±2-line window around the best-matching line of a markdown body. */
function snippetAround(markdown: string, queryTokens: string[]): string {
  const lines = markdown.split("\n").filter((l) => l.trim().length > 0);
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < lines.length; i++) {
    const s = overlap(queryTokens, lines[i]!);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }
  return lines
    .slice(Math.max(0, bestIdx - 1), bestIdx + 3)
    .join(" ")
    .slice(0, 500);
}

export class KnowledgeService {
  private readonly content: DocsContent;
  /** True once the boot indexer has the docs corpus in vectors — search upgrades itself. */
  private semanticReady = false;

  constructor(private readonly getEngine: () => Engine | undefined) {
    this.content = new DocsContent(getEngine, resolveOptions({}));
  }

  /** Whether searches currently run semantically (the status probe reports it). */
  isSemantic(): boolean {
    return this.semanticReady;
  }

  /**
   * Boot indexer (fire-and-forget from ready(), never blocks boot): when
   * mod-vectors AND an embedding alias are present, chunk every handbook page
   * into the "buddy.docs" collection. Content-hashing in vectors.upsert makes
   * re-runs after upgrades cost only the diff. Any failure leaves the lexical
   * baseline in charge — one warn, no drama.
   */
  async indexDocs(ctx: OpContext): Promise<void> {
    const vectors = vectorsOf(ctx.services);
    const alias = embeddingAlias(ctx.services);
    if (!vectors || !alias) return;
    try {
      await vectors.ensureCollection({ name: DOCS_COLLECTION, alias, metric: "cosine", filterables: ["kind", "chapter"] });
      const items: Array<{ id: string; text: string; meta: Record<string, unknown> }> = [];
      for (const page of await this.content.searchIndex()) {
        const md = await this.content.page(page.chapter, page.file).catch(() => null);
        if (!md?.markdown.trim()) continue;
        // Coarse paragraph packing (~1500 chars) — pages are structured prose,
        // this keeps chunks self-contained without a tokenizer.
        const paragraphs = md.markdown.split("\n\n");
        let buf = "";
        let i = 0;
        const flush = () => {
          if (!buf.trim()) return;
          items.push({
            id: `guide/${page.chapter}/${page.file}#${i++}`,
            text: buf,
            meta: { kind: "guide", chapter: page.chapter, title: page.title, path: `guide/${page.chapter}/${page.file}` },
          });
          buf = "";
        };
        for (const p of paragraphs) {
          if (buf.length + p.length > 1500) flush();
          buf = buf ? `${buf}\n\n${p}` : p;
        }
        flush();
      }
      if (!items.length) return;
      const res = await vectors.upsert(DOCS_COLLECTION, items, ctx);
      this.semanticReady = true;
      if (res.embedded > 0) {
        console.log(`[pattern/mod-buddy] knowledge index ready — ${res.embedded} chunk(s) embedded via alias "${alias}"`);
      }
    } catch (err) {
      console.warn(`[pattern/mod-buddy] semantic indexing unavailable (lexical search stays on): ${(err as Error).message}`);
    }
  }

  /** Semantic path: hybrid retrieval over the indexed handbook + lexical op-catalog hits. */
  private async searchSemantic(query: string, k: number, ctx: OpContext): Promise<KnowledgeResult[] | null> {
    const vectors = vectorsOf(ctx.services);
    const engine = this.getEngine();
    if (!vectors || !engine || !this.semanticReady) return null;
    try {
      const matches = await vectors.query(DOCS_COLLECTION, { text: query, k, mode: "hybrid" }, ctx);
      const guide = matches.map((m) => ({
        title: String(m.meta?.title ?? m.id),
        path: String(m.meta?.path ?? m.id),
        snippet: (m.text ?? "").slice(0, 500),
        score: m.score,
      }));
      // Ops aren't vector-indexed (exact names are lexical's home turf) — blend
      // the top catalog hits in after the guide results.
      const queryTokens = tokenize(query);
      const ops = engine.ops
        .list()
        .map((op) => ({ op, score: overlap(queryTokens, `${op.type} ${op.description ?? ""}`) }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(2, Math.floor(k / 3)))
        .map(({ op, score }) => ({ title: op.type, path: `op/${op.type}`, snippet: op.description ?? "", score }));
      return [...guide, ...ops].slice(0, k + ops.length);
    } catch {
      return null; // embedding hiccup → the lexical baseline answers
    }
  }

  async search(query: string, k = 6, ctx?: OpContext): Promise<KnowledgeResult[]> {
    if (ctx) {
      const semantic = await this.searchSemantic(query, k, ctx);
      if (semantic) return semantic;
    }
    const engine = this.getEngine();
    if (!engine) return [];
    const queryTokens = tokenize(query);
    if (!queryTokens.length) return [];

    // Rank the whole corpus on cheap metadata first (titles, headings, op
    // descriptions) — then load ONLY the winning pages' markdown for snippets.
    const scored: Array<{ title: string; path: string; score: number; page?: { chapter: string; file: string } }> = [];

    for (const page of await this.content.searchIndex().catch(() => [])) {
      const meta = `${page.title} ${page.headings.join(" ")} ${page.chapter} ${page.file}`;
      const score = overlap(queryTokens, meta);
      if (score > 0) {
        scored.push({
          title: page.title,
          path: `guide/${page.chapter}/${page.file}`,
          score,
          page: { chapter: page.chapter, file: page.file },
        });
      }
    }
    for (const op of engine.ops.list()) {
      const score = overlap(queryTokens, `${op.type} ${op.description ?? ""}`);
      if (score > 0) {
        scored.push({ title: op.type, path: `op/${op.type}`, score: score + (queryTokens.includes(op.type.toLowerCase()) ? 4 : 0) });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.max(1, Math.min(k, 20)));

    return Promise.all(
      top.map(async (hit) => {
        let snippet = "";
        if (hit.page) {
          const page = await this.content.page(hit.page.chapter, hit.page.file).catch(() => null);
          snippet = page ? snippetAround(page.markdown, queryTokens) : "";
        } else {
          const type = hit.path.slice("op/".length);
          snippet = engine.ops.get(type)?.description ?? "";
        }
        return { title: hit.title, path: hit.path, snippet, score: hit.score };
      }),
    );
  }
}

/** `buddy.knowledge.search` — retrieval for Buddy and the pattern_search_docs tool. */
export function knowledgeSearchOp(service: () => KnowledgeService): OpDefinition {
  return {
    type: "buddy.knowledge.search",
    title: "buddy.knowledge.search",
    description:
      "Search Buddy's knowledge (the live handbook + op catalog). Inputs { query, k? } → { results: [{ title, path, snippet, score }] }. " +
      "Lexical by default; upgrades to semantic retrieval when mod-vectors + an embedding alias are installed.",
    reusable: false,
    inputs: { query: value(z.string()), k: value(z.number().optional()) },
    outputs: { results: value() },
    execute: async (ctx) => {
      const query = String((await ctx.input.value("query")) ?? "");
      const k = ctx.input.has("k") ? Number((await ctx.input.value("k")) ?? 6) : 6;
      return { results: await service().search(query, Number.isFinite(k) && k > 0 ? k : 6, ctx) };
    },
  };
}
