/**
 * @pattern/core — the runtime-neutral Pattern execution engine.
 *
 * A workflow is a JSON document describing a directed graph of typed ops the
 * engine runs to completion per invocation. This is the public surface: the
 * Engine, type contracts, registries, validation, the scheduler, streams,
 * observability, and the base op catalog.
 *
 * See `pattern-engine-spec.md` for the full design.
 */

export { z } from "zod";

// Engine & high-level API
export {
  Engine,
  createEngine,
  defineMod,
  type EngineOptions,
  type RunOptions,
  type PatternMod,
} from "./engine.js";

// Terminal graph rendering (for `pattern graph`)
export { formatGraph } from "./graph-format.js";

// JSON-Schema → Zod (declarative request validation / port typing)
export { jsonSchemaToZod, type JsonSchema } from "./json-schema.js";

// Environment interpolation for workflow config
export {
  interpolateValue,
  resolveWorkflowEnv,
  EnvConfigError,
  type EnvMap,
  type EnvCastType,
} from "./env-config.js";

// Type contracts
export * from "./types.js";

// Errors
export * from "./errors.js";

// Registries
export {
  InMemoryOpRegistry,
  InMemoryAuthProviderRegistry,
  InMemoryHookRegistry,
  InMemoryWorkflowRegistry,
  type OpRegistry,
  type AuthProviderRegistry,
  type HookRegistry,
  type WorkflowRegistry,
  type WorkflowChange,
} from "./registry.js";

// Validation & graph utilities
export { validateWorkflow, collectIssues, type ValidateResult } from "./validate.js";
export {
  resolvePorts,
  resolveControlOuts,
  portKindOf,
  reachableFrom,
  executionSubgraph,
  detectCycle,
  findTriggerNodes,
  findOutGateNodes,
  edgeInto,
  edgesInto,
  incomingEdges,
  outgoingEdges,
  nodeMap,
  resolveConfigInputs,
  configInputEdges,
} from "./graph.js";

// Boundary config resolve phase
export { resolveBoundaryConfig, hasConfigPorts } from "./resolve-config.js";
export { schemasCompatible, isWildcard } from "./schema-compat.js";

// Scheduler primitives & runner (for advanced/embedding use)
export { runWorkflow, type RunDeps, type RunWorkflowRequest } from "./scheduler/run.js";
export { Deferred, StreamHub, SkipSignal, isSkip, type PulseResult } from "./scheduler/slots.js";

// Streams
export * from "./streams/util.js";
export { streamOps } from "./streams/ops.js";

// Transport
export { InProcessTransport } from "./transport/in-process.js";

// Services / implementations
export { InProcessEventBus } from "./events/bus.js";
export { InMemoryConnectionRegistry, type MessageSink } from "./connections/memory.js";
export { HookChainRunner, type HookRunFn } from "./hooks/chain.js";
export { resolvePrincipal, meetsRequirement, type AuthRequirement } from "./auth/resolve.js";

// Observability
export * from "./observability/index.js";

// Op authoring helpers
export { defineOp, pureOp, value, required, stream, control, asNumber } from "./ops-core/helpers.js";

// Base op catalog
export {
  coreOps,
  valueAndStreamOps,
  registerCoreOps,
  constOps,
  scalarOps,
  stringOps,
  objectOps,
  arrayOps,
  flowOps,
  dataOps,
  timeOps,
  cryptoOps,
  httpFetch,
  wsOps,
  extensibilityOps,
  boundaryOps,
} from "./ops-core/index.js";

// Boundary op contracts (also available via the "@pattern/core/boundaries" subpath)
export * as boundaries from "./boundaries/index.js";
