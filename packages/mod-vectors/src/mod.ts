/**
 * @pattern-js/mod-vectors — the mod.
 *
 * `setup` opens the local sqlite engine (`.pattern-data/vectors.db` — the
 * gitignored data home, never `.pattern/`) and registers the VectorsService
 * under "vectorsService". DB-backed on purpose: offloaded workflows run on
 * workers with their OWN service instances, and a worker opening the same
 * WAL file sees every vector the host wrote — an in-memory index would be
 * invisible there. Driver mods (sqlite-vec, pgvector) call
 * `registerEngine(spec)` in their `ready`, mod-email-style.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localFs, provideFilesystem } from "@pattern-js/runtime-node";
import { defineMod, type Engine, type PatternMod } from "@pattern-js/core";
import { LocalVectorsEngine } from "./engine-local.js";
import { DefaultVectorsService, VECTORS_SERVICE } from "./service.js";
import { vectorsOps } from "./ops.js";
import { collectionsListOp, vectorsAdminRoutes, vectorsFrontend } from "./admin.js";

export interface VectorsOptions {
  /** Database file (default "./.pattern-data/vectors.db"; ":memory:" for tests). */
  path?: string;
}

/** The packaged docs/ chapter. */
function packagedDocs(engine: Engine): void {
  try {
    const dir = fileURLToPath(new URL("../docs", import.meta.url));
    if (existsSync(dir)) provideFilesystem(engine, "vectors-docs", localFs(dir));
  } catch {
    /* packaged without docs — the contribution is simply skipped */
  }
}

export function vectorsMod(options: VectorsOptions = {}): PatternMod {
  return defineMod({
    name: "@pattern-js/mod-vectors",
    docs: { filesystem: "vectors-docs", title: "Vectors", order: 32 },
    ops: [...vectorsOps, collectionsListOp],
    workflows: vectorsAdminRoutes(),
    frontend: vectorsFrontend(),
    setup: (engine: Engine) => {
      packagedDocs(engine);
      const path = options.path ?? resolve(process.cwd(), ".pattern-data/vectors.db");
      const service = new DefaultVectorsService(new LocalVectorsEngine({ path }));
      engine.provideService(VECTORS_SERVICE, service);
    },
  });
}

/** A ready-to-use vectors mod with defaults (for `loadMods`/`engine.use`). */
export default vectorsMod();
