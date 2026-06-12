/**
 * Pattern — docs contribution contract.
 *
 * A mod ships its documentation as markdown files INSIDE its npm package —
 * version-locked to the code by construction — registers that folder as a
 * named filesystem in `setup` (the same move as SPA assets), and points at it
 * here. A docs host (`@pattern/mod-docs`) aggregates contributions across all
 * installed mods: install a mod, its chapter appears.
 *
 * Like `FrontendContribution`, this is pure DATA — serializable over HTTP,
 * React-free, ignored by the engine itself beyond retention + aggregation.
 */

/** One nav entry in a chapter (explicit-nav mods only — see `nav` below). */
export interface DocsNavItem {
  label: string;
  /** Markdown file path within the mod's docs filesystem (e.g. "guides/tools.md"). */
  file: string;
  /** Ordering within the level; ascending, then label. Default 100. */
  order?: number;
  items?: DocsNavItem[];
}

/** A mod's documentation chapter, aggregated by the docs host. */
export interface DocsContribution {
  /**
   * Registered filesystem name holding this mod's markdown (convention:
   * `"<short>-docs"`, e.g. "chat-docs"). The mod registers it in `setup`.
   */
  filesystem: string;
  /** Chapter title in the docs nav. Default: the mod's name. */
  title?: string;
  /** Chapter ordering, ascending; default 100 (the core handbook uses < 100). */
  order?: number;
  /** The chapter's landing page within the filesystem. Default "index.md". */
  index?: string;
  /**
   * Explicit nav override. When omitted, the docs host DERIVES nav by listing
   * the filesystem: every `*.md` outside `ops/` becomes a page, titled and
   * ordered by frontmatter (`title:`, `order:`), falling back to the first
   * `# heading`, then the filename. Files under `ops/` follow the per-op
   * prose convention — `ops/<op.type>.md` is merged into the generated op
   * reference ("when to use" prose above the live port/config tables) and
   * never becomes a nav page.
   */
  nav?: DocsNavItem[];
}
