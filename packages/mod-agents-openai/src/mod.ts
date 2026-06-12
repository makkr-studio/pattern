/**
 * @pattern/mod-agents-openai — the provider mod. Requires @pattern/mod-agents
 * (the contracts + registry); list both in pattern.config.json.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localFs, provideFilesystem } from "@pattern/runtime-node";
import { defineMod, type Engine, type PatternMod } from "@pattern/core";
import { AGENTS_SERVICE } from "@pattern/mod-agents";
import { openaiAgentOps } from "./ops.js";


/** The packaged docs/ chapter (the `docs` contribution points at "agents-openai-docs"). */
function packagedDocs(engine: Engine): void {
  try {
    const dir = fileURLToPath(new URL("../docs", import.meta.url));
    if (existsSync(dir)) provideFilesystem(engine, "agents-openai-docs", localFs(dir));
  } catch {
    /* packaged without docs — the contribution is simply skipped */
  }
}

export function agentsOpenAIMod(): PatternMod {
  return defineMod({
    name: "@pattern/mod-agents-openai",
    docs: { filesystem: "agents-openai-docs", title: "Agents · OpenAI", order: 51 },
    ops: openaiAgentOps,
    ready: (engine: Engine) => {
      packagedDocs(engine);
      if (!engine.service(AGENTS_SERVICE)) {
        throw new Error(
          '@pattern/mod-agents-openai needs @pattern/mod-agents — add "@pattern/mod-agents" to your pattern.config.json mods',
        );
      }
    },
  });
}

/** A ready-to-use OpenAI agents mod (for `loadMods`/`engine.use`). */
export default agentsOpenAIMod();
