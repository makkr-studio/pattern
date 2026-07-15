/**
 * @pattern-js/runtime-node — the Node runtime adapter for Pattern.
 *
 * Thin by design: it binds external sources (HTTP, WebSocket, CLI, schedule) to
 * boundary triggers, provides a worker-thread pool transport for isolation, a
 * socket-bound connection registry, and optional persistence sinks. All
 * platform code lives here so `@pattern-js/core` stays runtime-neutral (§4, §7).
 */

export { HttpHost, createHttpHost, type HttpHostOptions } from "./http.js";
export {
  FileStorage,
  localFs,
  memoryFs,
  toFilesystem,
  FilesystemRegistry,
  filesystems,
  provideFilesystem,
  FILESYSTEMS_SERVICE,
  type Filesystem,
  type StatEntry,
  type FileInfo,
} from "./filesystem.js";
export { runCli, type CliHostOptions } from "./cli.js";
export { WsHost, createWsHost, type WsBinding, type WsHostOptions } from "./ws.js";
export { NodeConnectionRegistry } from "./ws-registry.js";
export { WorkerPoolTransport, type WorkerPoolOptions } from "./worker-pool.js";
export { SqliteRunLedger, createRunLedger, type SqliteRunLedgerOptions } from "./durable/sqlite.js";
export { ScheduleHost, createScheduleHost, cronMatcher } from "./schedule.js";
export {
  jsonlTraceSink,
  createTraceStore,
  MemoryTraceStore,
  SqliteTraceStore,
  openSqliteTraceStore,
  type CreateTraceStoreOptions,
  type MemoryTraceStoreOptions,
  type SqliteTraceStoreOptions,
} from "./trace/index.js";
export { loadMods, type LoadModsOptions } from "./mods.js";
export { runMcpStdio } from "./mcp-stdio.js";
export {
  loadProject,
  loadWorkflowDir,
  defineConfig,
  type PatternConfig,
  type LoadedProject,
} from "./project.js";

// Load testing (`pattern load`): open-loop generator + the engine flight recorder.
export {
  runLoad,
  loadScenario,
  resolveScenario,
  FlightRecorder,
  runStage,
  summarize,
  type LoadOptions,
  type LoadReport,
  type LoadScenario,
  type LoadStage,
  type LoadRequest,
  type RequestSample,
  type FlightRecording,
  type OpStat,
} from "./load/index.js";

// Re-export the Engine for convenience so apps can `import { Engine } from "@pattern-js/runtime-node"`.
export { Engine, createEngine } from "@pattern-js/core";
