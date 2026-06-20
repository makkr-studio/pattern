/**
 * @pattern-js/runtime-node — mod loading (§13, §16/14).
 *
 * Loads "mods" (plugins) and installs them into an engine. A mod is any module
 * that exports a `PatternMod` (default export, or named `mod`). Three sources,
 * all the same mechanism:
 *
 *  - **1st-party** mods in this monorepo (`@pattern-js/mod-*`) — a bare specifier.
 *  - **3rd-party** mods published to npm — a bare specifier (an npm dependency).
 *  - **app-local** mods — a relative path (`./mods/foo.ts`), resolved against a
 *    base dir (the app root / config location).
 *
 * Mods may contribute ops, workflows, auth providers, and hooks; bringing a
 * frontend app is a future field on `PatternMod`.
 */

import { pathToFileURL } from "node:url";
import { resolve, isAbsolute } from "node:path";
import type { Engine, PatternMod } from "@pattern-js/core";

export interface LoadModsOptions {
  /** Base dir for resolving relative (app-local) mod specifiers. Default cwd. */
  baseDir?: string;
}

/** Resolve a mod specifier to something `import()` accepts. */
function resolveSpecifier(spec: string, baseDir: string): string {
  if (spec.startsWith(".") || isAbsolute(spec)) {
    return pathToFileURL(resolve(baseDir, spec)).href;
  }
  return spec; // bare npm/workspace specifier
}

/** Dynamically import each specifier and install the exported mod. */
export async function loadMods(
  engine: Engine,
  specifiers: string[],
  opts: LoadModsOptions = {},
): Promise<PatternMod[]> {
  const baseDir = opts.baseDir ?? process.cwd();
  const loaded: PatternMod[] = [];
  for (const spec of specifiers) {
    const mod = await import(resolveSpecifier(spec, baseDir));
    const def: PatternMod | undefined = mod.default ?? mod.mod;
    if (!def || !def.name) {
      throw new Error(`"${spec}" does not export a PatternMod (default export or named "mod")`);
    }
    // Await the mod's async `setup` — `start()` must observe installed mods.
    // `ready` is deferred: it runs once ALL mods are in (see below).
    await engine.useAsync(def, { deferReady: true });
    loaded.push(def);
  }
  // Second phase: every mod is installed (all ops registered) — now run the
  // `ready` hooks. This is what lets the admin's control plane bootstrap
  // stored workflows that use ops from mods listed *after* it in the config.
  for (const def of loaded) {
    await def.ready?.(engine);
  }
  return loaded;
}
