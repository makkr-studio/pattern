/**
 * @pattern/mod-agents — the mod. Registers the boundary.tool pair, the
 * neutral toolset/guardrail ops, and the live tool registry (AGENTS_SERVICE).
 */

import { defineMod, type Engine, type PatternMod } from "@pattern/core";
import { agentBoundaryOps } from "./boundaries.js";
import { agentsOps } from "./ops.js";
import { AgentsRegistry } from "./service.js";
import { AGENTS_SERVICE } from "./well-known.js";

export function agentsMod(): PatternMod {
  return defineMod({
    name: "@pattern/mod-agents",
    ops: [...agentBoundaryOps, ...agentsOps],
    setup: (engine: Engine) => {
      engine.provideService(AGENTS_SERVICE, new AgentsRegistry(engine));
    },
  });
}

/** A ready-to-use agents-contracts mod (for `loadMods`/`engine.use`). */
export default agentsMod();
