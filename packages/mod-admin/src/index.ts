/**
 * @pattern-js/mod-admin — an authorable, self-reflecting control surface for a
 * Pattern engine (admin internals).
 *
 * The admin is a **mod**: a brick you `engine.use()` (install with
 * `await engine.useAsync(adminMod())` so its async `setup` completes). It
 * contributes the `admin.*` ops, the endpoint workflows that expose them over
 * HTTP, and a `boundary.http.app` workflow that serves its SPA — its own backend
 * authored in the same primitives it edits.
 *
 * This entry point exports the backend. The SPA (React) lives under `src/app`
 * and builds to `dist-app/`, served via the app boundary.
 */

export { adminMod, default, type AdminModOptions } from "./backend/mod.js";

// Control plane + store + versioning (admin internals §4, §5, §9)
export { DefaultControlPlane, type ControlPlaneOptions } from "./backend/control-plane/control-plane.js";
export { FlystorageWorkflowStore, extractRoute, type FlystorageWorkflowStoreOptions } from "./backend/control-plane/store.js";
export {
  contentHash,
  diffWorkflows,
  stableStringify,
  type JsonDiff,
  type NodeChange,
} from "./backend/control-plane/versioning.js";
export type {
  AuditEntry,
  ControlPlane,
  DeployResult,
  Fixture,
  RouteConflict,
  RouteInfo,
  Source,
  VersionId,
  VersionInfo,
  WorkflowDoc,
  WorkflowMeta,
  WorkflowStore,
} from "./backend/control-plane/types.js";

// Trace store + aggregates (T4) — the store now lives in runtime-node behind
// core's `TraceStore`; these re-exports keep the historical import paths working.
export {
  MemoryTraceStore,
  MemoryTraceStore as MemoryTraceSink, // deprecated alias
  type MemoryTraceStoreOptions,
  type MemoryTraceStoreOptions as MemoryTraceSinkOptions, // deprecated alias
} from "@pattern-js/runtime-node";
export type { MetricsSummary, LatencyStats, RunDetail, RunSummary, TraceStore } from "@pattern-js/core";

// Ops, endpoints, introspection, services (admin internals §10, §11, §3)
export { adminOps } from "./backend/ops/index.js";
export {
  endpointSpecs,
  endpointWorkflows,
  stampRequireAuth,
  type EndpointSpec,
} from "./backend/workflows/index.js";
export {
  catalog,
  explain,
  modList,
  opGet,
  opList,
  portsCompatible,
  type ModInfo,
  type OpInfo,
  type PortInfo,
  type PortRef,
} from "./backend/introspect.js";
export {
  adminServices,
  registerAdminServices,
  ADMIN_TRACE_SINK,
  ADMIN_ENGINE,
  type AdminBackend,
} from "./backend/services.js";
export { ADMIN_CONTROL_PLANE } from "./backend/control-plane/types.js";
export { builtinTemplates, type Template } from "./backend/templates.js";
export { adminFrontend } from "./backend/frontend.js";
