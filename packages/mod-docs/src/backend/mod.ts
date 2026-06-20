/**
 * @pattern-js/mod-docs — the mod.
 *
 * Registers TWO filesystems in `setup`:
 *  - `docs-assets`  — the built SPA (dist-app), served at the mount
 *  - `docs-content` — the packaged Pattern handbook (docs/), contributed as a
 *    chapter through the SAME public `docs` seam every other mod uses
 *    (dogfooding: the docs app documents Pattern via its own extension point).
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineMod, type Engine, type PatternMod } from "@pattern-js/core";
import { localFs, memoryFs, provideFilesystem, type Filesystem } from "@pattern-js/runtime-node";
import { resolveOptions, type DocsModOptions } from "./options.js";
import { DocsContent } from "./content.js";
import { makeDocsOps } from "./ops.js";
import { docsRouteWorkflows, spaWorkflow } from "./workflows.js";
import { DOCS_ASSETS_FS, DOCS_CONTENT_FS } from "./services.js";

/** A packaged directory as a filesystem (relative to dist/backend/mod.js). */
function packagedDir(rel: string): Filesystem | null {
  try {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(dir)) return localFs(dir);
  } catch {
    /* fall through */
  }
  return null;
}

/** The built SPA at dist-app/, with a readable placeholder fallback. */
function bundledAssets(mount: string): Filesystem {
  const fs = packagedDir("../../dist-app");
  if (fs) return fs;
  const mem = memoryFs();
  void mem.write(
    "index.html",
    `<!doctype html><html><head><meta charset="utf-8"><title>Pattern Docs</title>
<style>body{font:16px system-ui;margin:0;display:grid;place-items:center;height:100vh;background:#f4f6fb;color:#0b0d12}
.card{padding:2rem 2.5rem;border-radius:14px;background:#fff;border:1px solid #e2e8f0}</style></head>
<body><div class="card"><h1>Pattern Docs</h1>
<p>The docs API is live under <code>${mount}/api</code>.</p>
<p>Build the SPA into the mod's <code>dist-app/</code> to replace this page.</p></div></body></html>`,
  );
  return mem;
}

export function docsMod(options: DocsModOptions = {}): PatternMod {
  const opts = resolveOptions(options);
  let engineRef: Engine | undefined;
  const content = new DocsContent(() => engineRef, opts);

  return defineMod({
    name: "@pattern-js/mod-docs",
    ops: makeDocsOps(() => engineRef, content, opts),
    workflows: [spaWorkflow(opts.mount), ...docsRouteWorkflows(opts)],
    // The handbook chapter — contributed via the public seam, order 0 so the
    // core concepts open the book.
    docs: { filesystem: DOCS_CONTENT_FS, title: "Pattern", order: 0 },
    setup: (engine: Engine) => {
      engineRef = engine;
      provideFilesystem(engine, DOCS_ASSETS_FS, opts.assets ? localFs(opts.assets) : bundledAssets(opts.mount));
      const handbook = opts.content ? localFs(opts.content) : packagedDir("../../docs");
      provideFilesystem(engine, DOCS_CONTENT_FS, handbook ?? memoryFs());
    },
  });
}

/** A ready-to-use docs mod with defaults (for `loadMods`/`engine.use`). */
export default docsMod();
