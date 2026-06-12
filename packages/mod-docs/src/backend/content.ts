/**
 * @pattern/mod-docs — chapter aggregation over the engine's docs seam.
 *
 * Every installed mod with a `docs` contribution becomes a CHAPTER: content is
 * markdown in the mod's registered filesystem (shipped inside its npm package
 * — version-locked to the code). Nav is frontmatter-derived unless the mod
 * declares it explicitly. `ops/<op.type>.md` files are per-op "when to use"
 * prose, merged into the generated reference — never nav pages.
 *
 * Aggregation (nav needs a title read per file) is memoized per process by
 * default — content can't change under a running version. `cache: false`
 * keeps it live for docs-writing sessions.
 */

import type { DocsContribution, DocsNavItem, Engine } from "@pattern/core";
import { filesystems, type Filesystem } from "@pattern/runtime-node";
import type { ResolvedDocsOptions } from "./options.js";

export interface DocsChapter {
  mod: string;
  slug: string;
  title: string;
  order: number;
  /** Chapter landing page (path within the filesystem). */
  index: string;
  filesystem: string;
  nav: DocsNavItem[];
}

/** `---\nkey: value\n---` leading block — hand-rolled, title/order only. */
export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return { meta, body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { meta, body: text };
  for (const line of text.slice(4, end).split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  return { meta, body };
}

/** First `# heading` of a body, as a title fallback. */
function firstHeading(body: string): string | undefined {
  const m = /^#\s+(.+)$/m.exec(body);
  return m?.[1]?.trim();
}

/** "guides/turn-pipeline.md" → "Turn pipeline" (last resort label). */
function prettifyName(file: string): string {
  const base = file.split("/").pop()!.replace(/\.md$/, "").replace(/[-_]/g, " ");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** "@pattern/mod-chat" → "chat"; "my-docs-mod" → "my-docs-mod". */
export function slugOf(modName: string): string {
  const short = modName.split("/").pop()!.replace(/^mod-/, "");
  return short.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "mod";
}

/**
 * Request-supplied content paths are confined to the chapter's filesystem:
 * relative, no traversal, .md only. Returns the normalized path or null.
 */
export function sanitizeDocPath(p: string): string | null {
  if (!p || p.includes("\\") || p.startsWith("/") || p.includes("..") || p.includes("\0")) return null;
  if (!p.endsWith(".md")) return null;
  return p.replace(/^\.\//, "");
}

async function readDoc(fs: Filesystem, path: string): Promise<{ meta: Record<string, string>; body: string } | null> {
  try {
    if (!(await fs.fileExists(path))) return null;
    return parseFrontmatter(await fs.readToString(path));
  } catch {
    return null;
  }
}

const orderOf = (meta: Record<string, string>): number => {
  const n = Number(meta.order);
  return Number.isFinite(n) ? n : 100;
};

const byOrderThenLabel = (a: DocsNavItem, b: DocsNavItem) =>
  (a.order ?? 100) - (b.order ?? 100) || a.label.localeCompare(b.label);

/** Derive a chapter's nav by listing its filesystem (frontmatter-driven). */
async function deriveNav(fs: Filesystem, index: string): Promise<DocsNavItem[]> {
  const entries = await fs.list("", { deep: true }).toArray();
  const files = entries
    .filter((e) => e.isFile && e.path.endsWith(".md"))
    .map((e) => e.path)
    .filter((p) => p !== index && !p.startsWith("ops/"));

  const roots: DocsNavItem[] = [];
  const groups = new Map<string, DocsNavItem[]>();
  for (const file of files) {
    const doc = await readDoc(fs, file);
    if (!doc) continue;
    const item: DocsNavItem = {
      label: doc.meta.title ?? firstHeading(doc.body) ?? prettifyName(file),
      file,
      order: orderOf(doc.meta),
    };
    const slash = file.indexOf("/");
    if (slash < 0) {
      roots.push(item);
    } else {
      const dir = file.slice(0, slash);
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir)!.push(item);
    }
  }
  roots.sort(byOrderThenLabel);
  // Each first-level directory becomes a group; clicking it lands on its
  // first page. Groups follow root items, ordered by their best child.
  const groupItems = [...groups.entries()]
    .map(([dir, items]) => {
      items.sort(byOrderThenLabel);
      return {
        label: prettifyName(`${dir}.md`),
        file: items[0]!.file,
        order: Math.min(...items.map((i) => i.order ?? 100)),
        items,
      } satisfies DocsNavItem;
    })
    .sort(byOrderThenLabel);
  return [...roots, ...groupItems];
}

export class DocsContent {
  private chaptersCache: DocsChapter[] | null = null;

  constructor(
    private readonly getEngine: () => Engine | undefined,
    private readonly opts: ResolvedDocsOptions,
  ) {}

  private engine(): Engine {
    const engine = this.getEngine();
    if (!engine) throw new Error("docs: engine not ready");
    return engine;
  }

  fs(name: string): Filesystem | undefined {
    return filesystems(this.engine()).get(name);
  }

  invalidate(): void {
    this.chaptersCache = null;
  }

  async chapters(): Promise<DocsChapter[]> {
    if (this.opts.cache && this.chaptersCache) return this.chaptersCache;
    const seen = new Set<string>();
    const out: DocsChapter[] = [];
    for (const { mod, docs } of this.engine().docs()) {
      const fs = this.fs(docs.filesystem);
      if (!fs) {
        console.warn(`[pattern/mod-docs] chapter "${mod}" points at unregistered filesystem "${docs.filesystem}" — skipped`);
        continue;
      }
      let slug = slugOf(mod);
      while (seen.has(slug)) slug = `${slug}-2`;
      seen.add(slug);
      const index = docs.index ?? "index.md";
      out.push({
        mod,
        slug,
        title: docs.title ?? mod,
        order: docs.order ?? 100,
        index,
        filesystem: docs.filesystem,
        nav: docs.nav ?? (await deriveNav(fs, index)),
      });
    }
    out.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    if (this.opts.cache) this.chaptersCache = out;
    return out;
  }

  async chapter(slug: string): Promise<DocsChapter | undefined> {
    return (await this.chapters()).find((c) => c.slug === slug);
  }

  /** A page's frontmatter-stripped markdown + resolved title (null = 404). */
  async page(slug: string, file: string): Promise<{ title: string; markdown: string } | null> {
    const chapter = await this.chapter(slug);
    const path = sanitizeDocPath(file);
    if (!chapter || !path) return null;
    const fs = this.fs(chapter.filesystem);
    if (!fs) return null;
    const doc = await readDoc(fs, path);
    if (!doc) return null;
    return { title: doc.meta.title ?? firstHeading(doc.body) ?? prettifyName(path), markdown: doc.body };
  }

  /** Raw markdown bytes of a page (the `.md` view + llms.txt source). */
  async raw(slug: string, file: string): Promise<string | null> {
    const chapter = await this.chapter(slug);
    const path = sanitizeDocPath(file);
    if (!chapter || !path) return null;
    const fs = this.fs(chapter.filesystem);
    if (!fs) return null;
    try {
      if (!(await fs.fileExists(path))) return null;
      return await fs.readToString(path);
    } catch {
      return null;
    }
  }

  /**
   * Per-op "when to use" prose: `ops/<type>.md` in the owning mod's docs fs,
   * else in the docs host's own fs (which homes the core/boundary op prose).
   */
  async opProse(opType: string, owningMod: string | undefined): Promise<string | null> {
    const chapters = await this.chapters();
    const candidates: DocsChapter[] = [];
    if (owningMod) {
      const own = chapters.find((c) => c.mod === owningMod);
      if (own) candidates.push(own);
    }
    const host = chapters.find((c) => c.mod === "@pattern/mod-docs");
    if (host && !candidates.includes(host)) candidates.push(host);
    for (const chapter of candidates) {
      const fs = this.fs(chapter.filesystem);
      if (!fs) continue;
      const doc = await readDoc(fs, `ops/${opType}.md`);
      if (doc) return doc.body;
    }
    return null;
  }
}
