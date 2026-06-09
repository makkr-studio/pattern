/**
 * @pattern/runtime-node — mod loading (§13, §16/14).
 *
 * Loads external plugins ("mods") by module specifier and installs them into an
 * engine. A mod module should export a `PatternMod` as its default export (or a
 * named `mod`). Mods register ops, boundaries, and auth providers via the
 * engine's registries — the framework's extension seam.
 */

import type { Engine, PatternMod } from "@pattern/core";

/** Dynamically import each specifier and `engine.use()` the exported mod. */
export async function loadMods(engine: Engine, specifiers: string[]): Promise<PatternMod[]> {
  const loaded: PatternMod[] = [];
  for (const spec of specifiers) {
    const mod = await import(spec);
    const def: PatternMod | undefined = mod.default ?? mod.mod;
    if (!def || !def.name) {
      throw new Error(`"${spec}" does not export a PatternMod (default export or named "mod")`);
    }
    engine.use(def);
    loaded.push(def);
  }
  return loaded;
}
