/**
 * @pattern/mod-store — the mod.
 *
 * `setup` opens the stores (sqlite at ./.pattern-data/store.db by default),
 * provides STORE_SERVICE, and registers the lease auto-release TraceSink:
 * every lease owned by a runId is dropped the moment that run settles (ok,
 * error or cancel) — the TTL is only the crash backstop. Consumers declare
 * their collections from `ready` via `docs.ensureCollection`.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localFs, provideFilesystem } from "@pattern/runtime-node";
import { defineMod, type Engine, type PatternMod } from "@pattern/core";
import { resolveOptions, type StoreOptions } from "./options.js";
import { storeOps } from "./ops.js";
import { storeFrontend } from "./frontend.js";
import { blobServeWorkflow } from "./workflows.js";
import { memoryPatternStores } from "./store/memory.js";
import { sqlitePatternStores } from "./store/sqlite.js";
import { STORE_SERVICE } from "./well-known.js";
import type { PatternStores } from "./store/types.js";


/** The packaged docs/ chapter (the `docs` contribution points at "store-docs"). */
function packagedDocs(engine: Engine): void {
  try {
    const dir = fileURLToPath(new URL("../docs", import.meta.url));
    if (existsSync(dir)) provideFilesystem(engine, "store-docs", localFs(dir));
  } catch {
    /* packaged without docs — the contribution is simply skipped */
  }
}

export function storeMod(options: StoreOptions = {}): PatternMod {
  const opts = resolveOptions(options);
  let stores: PatternStores | undefined;

  return defineMod({
    name: "@pattern/mod-store",
    docs: { filesystem: "store-docs", title: "Store", order: 30 },
    ops: storeOps,
    workflows: opts.blobRoute === false ? [] : [blobServeWorkflow(opts.blobRoute.requireAuth)],
    frontend: storeFrontend(),
    setup: async (engine: Engine) => {
      packagedDocs(engine);
      stores =
        opts.storage === "memory"
          ? memoryPatternStores({ maxBlobBytes: opts.maxBlobBytes })
          : await sqlitePatternStores(opts.storage, opts.blobDir, { maxBlobBytes: opts.maxBlobBytes });
      engine.provideService(STORE_SERVICE, stores);
      // Run-settle auto-release: leases conventionally owned by a runId never
      // outlive their run. Fire-and-forget — a failed release falls back to TTL.
      engine.onTrace({
        onRunEnd: ({ runId }) => {
          void stores!.leases.releaseAll(runId).catch((err) => {
            console.error("[pattern/mod-store] lease auto-release failed:", err);
          });
        },
      });
    },
  });
}

/** A ready-to-use store mod with defaults (for `loadMods`/`engine.use`). */
export default storeMod();
