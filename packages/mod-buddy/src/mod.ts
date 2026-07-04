/**
 * @pattern-js/mod-buddy — the mod.
 *
 * Ships the control-plane capability layer (the ten restricted `pattern_*`
 * tool workflows + the token-gated /mcp/pattern route) and Buddy's knowledge
 * op. The chat dock, turn pipeline and thread persistence arrive with the
 * buddy backend (`buddy.turn`); this half is useful on its own — point
 * Claude Code at /mcp/pattern (or run `pattern mcp`) and your editor's agent
 * becomes a Pattern author.
 *
 * mod-vectors is NEVER imported: knowledge probes `ctx.services` at runtime
 * and upgrades itself when a vector engine + embedding alias are present.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localFs, provideFilesystem } from "@pattern-js/runtime-node";
import { defineMod, type Engine, type PatternMod } from "@pattern-js/core";
import { KnowledgeService, knowledgeSearchOp } from "./knowledge.js";
import { patternMcpServerWorkflow, toolWorkflows } from "./tools.js";

export interface BuddyOptions {
  /** Where the Pattern MCP server listens (default "/mcp/pattern"). */
  mcpPath?: string;
}

/** The packaged docs/ chapter (registered when the docs dir ships with the package). */
function packagedDocs(engine: Engine): void {
  try {
    const dir = fileURLToPath(new URL("../docs", import.meta.url));
    if (existsSync(dir)) provideFilesystem(engine, "buddy-docs", localFs(dir));
  } catch {
    /* packaged without docs — the contribution is simply skipped */
  }
}

export function buddyMod(options: BuddyOptions = {}): PatternMod {
  let engineRef: Engine | undefined;
  const knowledge = new KnowledgeService(() => engineRef);

  return defineMod({
    name: "@pattern-js/mod-buddy",
    docs: { filesystem: "buddy-docs", title: "Buddy", order: 52 },
    ops: [knowledgeSearchOp(() => knowledge)],
    workflows: [...toolWorkflows(), patternMcpServerWorkflow(options.mcpPath)],
    setup: (engine: Engine) => {
      engineRef = engine;
      packagedDocs(engine);
    },
  });
}

/** A ready-to-use buddy mod with defaults (for `loadMods`/`engine.use`). */
export default buddyMod();
