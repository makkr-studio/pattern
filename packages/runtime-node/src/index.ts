/**
 * @pattern/runtime-node — the Node runtime adapter for Pattern.
 *
 * Thin by design: it binds external sources (HTTP, WebSocket, CLI, schedule) to
 * boundary triggers, provides a worker-thread pool transport for isolation, a
 * socket-bound connection registry, and optional persistence sinks. All
 * platform code lives here so `@pattern/core` stays runtime-neutral (§4, §7).
 */

export { HttpHost, createHttpHost, type HttpHostOptions } from "./http.js";
export {
  LocalFilesystem,
  MemoryFilesystem,
  FilesystemRegistry,
  filesystems,
  provideFilesystem,
  FILESYSTEMS_SERVICE,
  type Filesystem,
  type FileStat,
} from "./filesystem.js";
export { runCli, type CliHostOptions } from "./cli.js";
export { WsHost, createWsHost, type WsBinding, type WsHostOptions } from "./ws.js";
export { NodeConnectionRegistry } from "./ws-registry.js";
export { WorkerPoolTransport, type WorkerPoolOptions } from "./worker-pool.js";
export { ScheduleHost, createScheduleHost, cronMatcher } from "./schedule.js";
export { jsonlTraceSink, sqliteTraceSink } from "./trace.js";
export { loadMods, type LoadModsOptions } from "./mods.js";
export {
  loadProject,
  loadWorkflowDir,
  defineConfig,
  type PatternConfig,
  type LoadedProject,
} from "./project.js";

// Re-export the Engine for convenience so apps can `import { Engine } from "@pattern/runtime-node"`.
export { Engine, createEngine } from "@pattern/core";
