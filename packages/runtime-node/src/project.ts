/**
 * @pattern/runtime-node — project loader.
 *
 * A Pattern app is configured declaratively (`pattern.config.json`): which mods
 * to load and where the workflow JSON files live. `loadProject` builds an engine,
 * installs the mods (so their ops are available), loads every workflow `.json`
 * from disk, and returns the engine plus a ready HTTP host.
 *
 * This is the seam for the runtime-dynamic future: workflows are data on disk
 * now, but the same `engine.registerWorkflow` / `updateWorkflow` /
 * `unregisterWorkflow` calls accept workflows from a DB or an admin API later —
 * the HTTP host re-derives its routes live on every change.
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Engine, type Workflow } from "@pattern/core";
import { loadMods } from "./mods.js";
import { HttpHost } from "./http.js";
import { WsHost } from "./ws.js";
import { NodeConnectionRegistry } from "./ws-registry.js";

export interface PatternConfig {
  /** Mod specifiers: npm packages and/or app-local paths ("./mods/foo.ts"). */
  mods?: string[];
  /** Directory of workflow `.json` files. Default "./workflows". */
  workflows?: string;
  /** HTTP host defaults. */
  http?: { port?: number; host?: string };
  /**
   * WebSocket upgrades on the HTTP servers. Default true: `boundary.ws.*`
   * trigger workflows bind declaratively (live, like HTTP routes) and
   * authenticated clients can subscribe to `core.ws.notify` pushes even with
   * no WS workflows at all. Set false to refuse upgrades entirely.
   */
  ws?: boolean | { path?: string };
}

/** Identity helper for authoring `pattern.config.ts` with type-checking. */
export function defineConfig(config: PatternConfig): PatternConfig {
  return config;
}

export interface LoadedProject {
  engine: Engine;
  http: HttpHost;
  /** The auto-wired WS host (absent when `config.ws === false`). */
  ws?: WsHost;
  config: PatternConfig;
  /** Start the HTTP host (opens a server per declared port). */
  start: () => Promise<{ ports: number[]; close: () => Promise<void> }>;
}

/** Read & parse every `*.json` workflow in a directory. */
export async function loadWorkflowDir(dir: string): Promise<Workflow[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const workflows: Workflow[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const text = await readFile(join(dir, entry.name), "utf8");
    try {
      workflows.push(JSON.parse(text) as Workflow);
    } catch (err) {
      throw new Error(`failed to parse workflow ${entry.name}: ${(err as Error).message}`);
    }
  }
  return workflows;
}

/**
 * Build a project from a `PatternConfig` (or a path to `pattern.config.json`).
 * Mods load first (they register ops), then workflows are registered.
 */
export async function loadProject(
  configOrPath: PatternConfig | string = "pattern.config.json",
  opts: { engine?: Engine } = {},
): Promise<LoadedProject> {
  let config: PatternConfig;
  let baseDir: string;
  if (typeof configOrPath === "string") {
    const configPath = resolve(process.cwd(), configOrPath);
    baseDir = dirname(configPath);
    config = existsSync(configPath) ? (JSON.parse(await readFile(configPath, "utf8")) as PatternConfig) : {};
  } else {
    config = configOrPath;
    baseDir = process.cwd();
  }

  // Inject process.env so workflow config can use `$env` / `${VAR}` references.
  // The node connection registry up-front means `core.ws.*` ops (notify,
  // broadcast…) reach the same sockets the WS host accepts.
  const engine = opts.engine ?? new Engine({ env: process.env, connections: new NodeConnectionRegistry() });

  if (config.mods?.length) {
    await loadMods(engine, config.mods, { baseDir });
  }

  const wfDir = resolve(baseDir, config.workflows ?? "workflows");
  for (const wf of await loadWorkflowDir(wfDir)) {
    // Async: runs the resolve phase for any boundary config ports (e.g. a route
    // port fed by core.env). Plain `$env` config still works synchronously.
    await engine.registerWorkflowAsync(wf);
  }

  const http = new HttpHost(engine, { defaultPort: config.http?.port, host: config.http?.host });

  // WS rides the same servers (auto mode: boundary.ws.* workflows bind live;
  // bare connections still serve as the notification channel). One WsHost
  // attaches to every port the route reconciler opens, now or later.
  let ws: WsHost | undefined;
  if (config.ws !== false) {
    ws = new WsHost(engine, typeof config.ws === "object" ? { path: config.ws.path } : {});
    const attached = new Set<unknown>();
    http.onServer((server) => {
      if (attached.has(server)) return;
      attached.add(server);
      ws!.attach(server);
    });
  }

  return { engine, http, ws, config, start: () => http.start() };
}
