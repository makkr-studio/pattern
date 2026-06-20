/**
 * @pattern-js/mod-agents — the mod. Registers the boundary.tool pair, the
 * neutral toolset/guardrail ops, and the live tool registry (AGENTS_SERVICE).
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localFs, provideFilesystem } from "@pattern-js/runtime-node";
import { defineMod, type Engine, type PatternMod } from "@pattern-js/core";
import { agentBoundaryOps } from "./boundaries.js";
import { agentsOps } from "./ops.js";
import { AgentsRegistry } from "./service.js";
import { AGENTS_SERVICE } from "./well-known.js";


/** The packaged docs/ chapter (the `docs` contribution points at "agents-docs"). */
function packagedDocs(engine: Engine): void {
  try {
    const dir = fileURLToPath(new URL("../docs", import.meta.url));
    if (existsSync(dir)) provideFilesystem(engine, "agents-docs", localFs(dir));
  } catch {
    /* packaged without docs — the contribution is simply skipped */
  }
}

export function agentsMod(): PatternMod {
  return defineMod({
    name: "@pattern-js/mod-agents",
    docs: { filesystem: "agents-docs", title: "Agents", order: 50 },
    ops: [...agentBoundaryOps, ...agentsOps],
    setup: (engine: Engine) => {
      packagedDocs(engine);
      engine.provideService(AGENTS_SERVICE, new AgentsRegistry(engine));
    },
  });
}

/** A ready-to-use agents-contracts mod (for `loadMods`/`engine.use`). */
export default agentsMod();
