/**
 * @pattern/mod-agents-openai — the provider mod. Requires @pattern/mod-agents
 * (the contracts + registry); list both in pattern.config.json.
 */

import { defineMod, type Engine, type PatternMod } from "@pattern/core";
import { AGENTS_SERVICE } from "@pattern/mod-agents";
import { openaiAgentOps } from "./ops.js";

export function agentsOpenAIMod(): PatternMod {
  return defineMod({
    name: "@pattern/mod-agents-openai",
    ops: openaiAgentOps,
    ready: (engine: Engine) => {
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
