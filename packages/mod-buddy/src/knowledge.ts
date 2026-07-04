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

import { value, z, type Engine, type OpDefinition } from "@pattern-js/core";
import { DocsContent, resolveOptions } from "@pattern-js/mod-docs";

export interface KnowledgeResult {
  title: string;
  /** `guide/<chapter>/<file>` for handbook pages, `op/<type>` for catalog hits. */
  path: string;
  snippet: string;
  score: number;
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

  constructor(private readonly getEngine: () => Engine | undefined) {
    this.content = new DocsContent(getEngine, resolveOptions({}));
  }

  async search(query: string, k = 6): Promise<KnowledgeResult[]> {
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
      return { results: await service().search(query, Number.isFinite(k) && k > 0 ? k : 6) };
    },
  };
}
