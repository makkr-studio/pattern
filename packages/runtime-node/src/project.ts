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
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Engine, TRACE_STORE, type TraceStore, type Workflow } from "@pattern/core";
import { loadMods } from "./mods.js";
import { createTraceStore } from "./trace/index.js";
import { HttpHost } from "./http.js";
import { WsHost } from "./ws.js";
import { NodeConnectionRegistry } from "./ws-registry.js";
import { WorkerPoolTransport } from "./worker-pool.js";

export interface PatternConfig {
  /** Mod specifiers: npm packages and/or app-local paths ("./mods/foo.ts"). */
  mods?: string[];
  /** Directory of workflow `.json` files. Default "./workflows". */
  workflows?: string;
  /** HTTP host defaults. */
  http?: { port?: number; host?: string };
  /**
   * Off-loop execution for workflows flagged `offload`. A worker-thread pool
   * runs those runs so their CPU-heavy compute can't stall the host event loop;
   * everything else stays inline. `number` = pool size; the object form also
   * picks which mods each worker loads (default: this project's `mods`). Omit
   * to keep everything inline — an `offload` flag then degrades to a no-op.
   *
   * Exclude heavy / host-only mods from the worker set via the `{ mods }` form
   * — e.g. drop `@pattern/mod-admin` so the admin's control-plane setup doesn't
   * run in every worker (workers execute domain ops, not the admin).
   */
  workers?: number | { size?: number; mods?: string[] };
  /**
   * WebSocket upgrades on the HTTP servers. Default true: `boundary.ws.*`
   * trigger workflows bind declaratively (live, like HTTP routes) and
   * authenticated clients can subscribe to `core.ws.notify` pushes even with
   * no WS workflows at all. Set false to refuse upgrades entirely.
   */
  ws?: boolean | { path?: string };
  /**
   * Run telemetry persistence. Durable SQLite by default so runs survive
   * restarts and any process writing the same DB (host, workers, `pattern run`)
   * shows up in the admin. `persist: false` keeps it in-memory (ephemeral);
   * `path` overrides the default `<project>/.pattern/traces.db`. Degrades to
   * in-memory automatically when `node:sqlite` is unavailable.
   */
  trace?: { persist?: boolean; path?: string; capacity?: number };
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

/**
 * Load `.env` from the project dir into process.env (already-set variables
 * win — the real environment outranks the file, dotenv-style). Hand-rolled
 * on purpose: KEY=VALUE lines, # comments, optional single/double quotes.
 * This is where PATTERN_VAULT_KEY / OPENAI_API_KEY live in dev.
 */
export function loadDotEnv(baseDir: string, file = ".env"): void {
  const path = resolve(baseDir, file);
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
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

  // `.env` first (existing env wins), so mods' setup — the vault reading
  // PATTERN_VAULT_KEY, agents reading OPENAI_API_KEY — and `$env` config
  // interpolation all see it, whatever entry point launched us.
  loadDotEnv(baseDir);

  // Off-loop pool for `offload`-flagged workflows (opt-in via `workers`). Built
  // here so it can be handed to the engine as `offloadTransport`; when the
  // caller brought their own engine, they own its transports (so we skip it).
  let offloadPool: WorkerPoolTransport | undefined;
  let traceStore: TraceStore | undefined;

  // Inject process.env so workflow config can use `$env` / `${VAR}` references.
  // The node connection registry up-front means `core.ws.*` ops (notify,
  // broadcast…) reach the same sockets the WS host accepts.
  const engine = opts.engine ?? new Engine({ env: process.env, connections: new NodeConnectionRegistry() });

  if (!opts.engine && config.workers !== undefined) {
    const w = typeof config.workers === "number" ? { size: config.workers } : config.workers;
    // Forward each worker's trace into this engine's sink so offloaded runs land
    // in the admin's Runs view (and the rest of the trace surfaces) like inline
    // ones, tagged with which worker ran them.
    offloadPool = new WorkerPoolTransport({
      size: w.size,
      mods: w.mods ?? config.mods,
      onTrace: (evt) => engine.ingestTrace(evt),
    });
    engine.setOffloadTransport(offloadPool);
  }

  // Durable run telemetry. Created here (before the mods' setup) and provided as
  // a service so the admin reads it instead of spinning up its own in-memory
  // store — runs persist across restarts and any process writing the same DB
  // shows up. Off only when the caller brought their own engine (they own it).
  if (!opts.engine && config.trace?.persist !== false) {
    traceStore = await createTraceStore({
      kind: "sqlite",
      path: config.trace?.path ?? resolve(baseDir, ".pattern/traces.db"),
      capacity: config.trace?.capacity,
    });
    engine.onTrace(traceStore);
    engine.provideService(TRACE_STORE, traceStore);
  }

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

  return {
    engine,
    http,
    ws,
    config,
    start: async () => {
      const { ports, close } = await http.start();
      // The returned close tears down the worker pool too (idempotent with
      // engine.close(), which also owns it). No pool → a no-op.
      return { ports, close: async () => void (await close(), await offloadPool?.close(), await traceStore?.close()) };
    },
  };
}
