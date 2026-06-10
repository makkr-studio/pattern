/**
 * Pattern — core type contracts.
 *
 * This module is the single source of truth for the public shapes the engine
 * speaks in: ports, ops, the workflow document, principals, hooks/events,
 * observability, and the capability interfaces ops use to reach the outside
 * world. It has no runtime dependency beyond Zod and never imports from the
 * scheduler, registries, or adapters — everything depends on `types.ts`, not
 * the other way around.
 *
 * Spec references appear as “§n” throughout, pointing at sections of
 * `pattern-engine-spec.md`.
 */

import { z } from "zod";

/** A Zod schema of any shape. Alias kept for readability at call sites. */
export type ZodAny = z.ZodType;

// ────────────────────────────────────────────────────────────────────────────
// §2 / §3 — Ports
// ────────────────────────────────────────────────────────────────────────────

/** The three kinds of port. Edge kind is *derived* from these (§2). */
export type PortKind = "value" | "stream" | "control";

/**
 * A typed input or output slot on an op (§3).
 *
 * - `value`  — resolves once per run; a value edge into it is a barrier.
 * - `stream` — a `ReadableStream` of `schema`-typed elements; concurrent.
 * - `control`— dataless sequencing pulse; no schema.
 */
export interface PortSpec {
  kind: PortKind;
  /** Value port: the value's schema. Stream port: the element schema. Control: none. */
  schema?: ZodAny;
  /** Value inputs only: must be wired and resolve. A stream input is "present" once wired. */
  required?: boolean;
  /**
   * Trigger outputs only: enforce `schema` on the externally-seeded value at the
   * start of every run (engine-level, so it holds for ANY entry path — HTTP host,
   * editor runs, ctx.invoke). Set on ports whose schema is *user-declared*
   * validation (e.g. http.request `body` when a body schema is configured), not
   * on structural typing like `method: string` that a manual run may omit.
   */
  validate?: boolean;
  description?: string;
}

/** A map of port name → spec. */
export type Ports = Record<string, PortSpec>;

/**
 * Ports may be declared statically, or computed from a node's parsed config for
 * dynamic-arity ops (e.g. `core.stream.split` → `out.0..n`). The engine resolves
 * the function form once per node, after config validation.
 */
export type PortsDef = Ports | ((config: any) => Ports);

/** The implicit control-in port every op exposes (§2). Never declared in `inputs`. */
export const CONTROL_IN = "in" as const;
/** The implicit control-out port every op exposes (§2). Auto-pulses on completion. */
export const CONTROL_OUT = "out" as const;

// ────────────────────────────────────────────────────────────────────────────
// §9 — Principal / identity
// ────────────────────────────────────────────────────────────────────────────

/** The identity a run executes as (§9). Defaults to anonymous. Serializable. */
export type Principal =
  | { kind: "anonymous" }
  | {
      kind: "user";
      id: string;
      provider: string;
      claims?: Record<string, unknown>;
      scopes?: string[];
    };

export const ANONYMOUS: Principal = { kind: "anonymous" };

// ────────────────────────────────────────────────────────────────────────────
// §10 — Observability (OTLP-shaped, zero-dependency)
// ────────────────────────────────────────────────────────────────────────────

export type SpanStatus = "unset" | "ok" | "error";

/** A timestamped event recorded on a span (OTLP-shaped). */
export interface SpanEvent {
  name: string;
  /** epoch milliseconds */
  time: number;
  attributes?: Record<string, unknown>;
}

/**
 * An opt-in sample of a single port's data, captured on a node span when I/O
 * sampling is enabled (T1). Bounded and secret-masked; powers the admin's
 * run-replay data peeks. Replay works structurally without it.
 */
export type IoSample =
  | { kind: "value"; preview: unknown; truncated?: boolean }
  | { kind: "stream"; head: unknown[]; count: number; truncated: boolean };

/** Per-node captured I/O, keyed by port name (T1). */
export interface SpanIo {
  inputs?: Record<string, IoSample>;
  outputs?: Record<string, IoSample>;
}

/** Immutable snapshot of a finished span, handed to `TraceSink.onSpanEnd` (§10). */
export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** epoch milliseconds */
  startTime: number;
  /** epoch milliseconds */
  endTime: number;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  status: SpanStatus;
  /** Present when `status === "error"`. */
  error?: { message: string; stack?: string };
  /**
   * Opt-in sampled inputs/outputs of the node (T1). Present only when sampling
   * is enabled for the run; capped and secret-masked. Off by default.
   */
  io?: SpanIo;
}

/** The live span handed to an op as `ctx.trace` (§5, §10). */
export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  setAttribute(key: string, value: unknown): void;
  setAttributes(attrs: Record<string, unknown>): void;
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  setStatus(status: SpanStatus, error?: unknown): void;
  /** Attach an opt-in I/O sample to this node span (T1). */
  setIo(io: SpanIo): void;
  /** Start a child span (e.g. for a sub-workflow invocation). */
  startChild(name: string): Span;
  end(): void;
}

/** A subscribable telemetry sink (§10). The engine stores nothing itself. */
export interface TraceSink {
  onRunStart?(run: {
    runId: string;
    traceId: string;
    workflowId: string;
    trigger: string;
    principal: Principal;
  }): void;
  onSpanEnd?(span: SpanData): void;
  onRunEnd?(run: {
    runId: string;
    traceId: string;
    status: "ok" | "error";
    error?: unknown;
  }): void;
}

// ────────────────────────────────────────────────────────────────────────────
// §8 — Events & Hooks (interfaces; in-process impls live in events/ & hooks/)
// ────────────────────────────────────────────────────────────────────────────

/** Fire-and-forget pub/sub (§8). Behind an interface for a future network bus. */
export interface EventBus {
  emit(event: string, payload: unknown): void;
  subscribe(event: string, handler: (payload: unknown) => void): () => void;
}

/** A declared hook: a named, Zod-typed, priority-ordered filter chain (§8). */
export interface HookDefinition<P = unknown> {
  name: string;
  /** Payload schema. Undeclared hooks default to `z.unknown()`. */
  payload?: z.ZodType<P>;
  /** Recursion guard; default 16. */
  maxDepth?: number;
}

/** One workflow registered as a member of a hook chain (§8). */
export interface HookRegistration {
  /** The hook name this registration listens on. */
  name: string;
  workflowId: string;
  /** The `boundary.hook` trigger node id. */
  nodeId: string;
  /** Sole ordering key; ascending, default 100 (§8). */
  priority: number;
}

/**
 * The capability ops use to invoke a hook chain (`core.hook.invoke`). Returns
 * the threaded payload after the chain completes (§8).
 */
export interface HookInvoker {
  invoke(name: string, payload: unknown, depth?: number): Promise<unknown>;
}

// ────────────────────────────────────────────────────────────────────────────
// §7 / §12 — WebSocket connection registry (interface; impl in runtime-node)
// ────────────────────────────────────────────────────────────────────────────

/** An opaque, serializable reference to a host-local connection (§7). */
export interface ConnectionRef {
  id: string;
  [k: string]: unknown;
}

/**
 * Routes outbound WS messaging behind an interface so a pub/sub backplane can be
 * added later for distribution (§7). Core ships an in-memory default for tests;
 * `runtime-node` provides the real one bound to live sockets.
 */
export interface ConnectionRegistry {
  send(connection: ConnectionRef | string, data: unknown): Promise<void>;
  /** Stream a sequence of chunks to one connection. */
  sendStream(connection: ConnectionRef | string, data: ReadableStream<unknown>): Promise<void>;
  broadcast(room: string, data: unknown): Promise<void>;
  join(connection: ConnectionRef | string, room: string): Promise<void>;
  leave(connection: ConnectionRef | string, room: string): Promise<void>;
  close(connection: ConnectionRef | string, code?: number, reason?: string): Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────────
// §9 — Auth providers
// ────────────────────────────────────────────────────────────────────────────

export interface AuthContext {
  headers: Headers;
  raw: unknown;
}

/** Resolves a principal from a request (§9). Mods contribute these; they chain. */
export interface AuthProvider {
  name: string;
  authenticate(req: AuthContext): Promise<Principal | null>;
}

// ────────────────────────────────────────────────────────────────────────────
// §5 — Op definition & authoring contract
// ────────────────────────────────────────────────────────────────────────────

/** A reference to a sub-workflow for higher-order ops (§12). */
export type SubworkflowRef = { workflow: Workflow } | { workflowId: string };

/**
 * Capability services handed to ops via context (§4: capabilities, not globals).
 *
 * The three core capabilities are always present. Mods register additional
 * named services with `engine.provideService(name, impl)` — e.g. the admin mod's
 * `adminControlPlane`, or a filesystem registry — reachable here as
 * `ctx.services.<name>`. The index signature keeps that extension typed-loose
 * but real; consumers narrow with a cast at the use site.
 */
export interface OpServices {
  events: EventBus;
  hooks: HookInvoker;
  connections: ConnectionRegistry;
  [name: string]: unknown;
}

/**
 * The context handed to every op's `execute` (§5).
 *
 * The first block is the documented authoring surface from the spec. The second
 * block is the set of capabilities the engine hands in (§4) — sub-workflow
 * invocation for higher-order ops, plus the `OpServices` bag.
 */
export interface OpContext {
  /** Parsed + validated against the op's `config` schema. */
  config: unknown;
  input: {
    /** Barrier: awaits the upstream value. */
    value<T = unknown>(port: string): Promise<T>;
    /** Available immediately; teed per consumer. */
    stream<T = unknown>(port: string): ReadableStream<T>;
    /** True if a value/stream input port is wired. */
    has(port: string): boolean;
  };
  /**
   * Pulse a declared named control-out. The implicit `out` pulses automatically
   * on completion for ordinary ops. The returned promise resolves once the
   * control-subgraph gated by this pulse has quiesced (used by `core.flow.sequence`).
   */
  pulse: (controlOutPort: string) => Promise<void>;
  principal: Principal;
  signal: AbortSignal;
  trace: Span;
  log: (
    level: "debug" | "info" | "warn" | "error",
    msg: string,
    attrs?: Record<string, unknown>,
  ) => void;

  // — capabilities (§4) —
  readonly runId: string;
  readonly nodeId: string;
  readonly workflowId: string;
  /** Run-scoped parameters (read by `core.input`); serializable. */
  readonly params: Record<string, unknown>;
  /** Injected environment map (read by `core.env`); runtime-neutral. */
  readonly env: Record<string, string | undefined>;
  /** Run a referenced sub-workflow to completion; returns its out-gate result. */
  invoke(ref: SubworkflowRef, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
  services: OpServices;
}

/**
 * Op execution result: output port name → value | Promise<value> | ReadableStream.
 * Returning value outputs as promises lets a mixed op start streams immediately
 * while values resolve later (§5).
 */
export type OpResult = Record<string, unknown | Promise<unknown> | ReadableStream<unknown>>;

export type OpExecute = (ctx: OpContext) => OpResult | Promise<OpResult>;

/** A reusable op definition; lives in the `OpRegistry` keyed by `type` (§5). */
export interface OpDefinition {
  /** Globally unique, namespaced: "core.stream.split", "boundary.http.request". */
  type: string;
  title?: string;
  description?: string;
  inputs: PortsDef;
  outputs: PortsDef;
  /**
   * Registration-time config ports (boundary ops). A value edge into one of
   * these feeds the op's config field of the same name; the engine evaluates the
   * feeding sub-graph once at registration (the "resolve phase") and freezes the
   * result into config. Distinct from `inputs` (per-run) — see §7.
   */
  configInputs?: PortsDef;
  /** Extra named control-outs (control-flow ops). The implicit `in`/`out` are always present. */
  controlOut?: string[] | ((config: any) => string[]);
  /** Validated against the node's `config`. */
  config?: ZodAny;
  execute: OpExecute;
  /** Marks boundary ops (§7). */
  boundary?: "trigger" | "outgate";
  /**
   * Boundary ops only: the op type of this boundary's canonical partner — every
   * trigger names its out-gate and vice versa (§7: boundaries come in pairs).
   * Authoring UIs create and delete the pair together; a trigger whose partner
   * is the generic `boundary.return` simply returns its run result.
   */
  pair?: string;
  /**
   * Whether this op is meant for general authoring/reuse. Default `true`.
   * Set `false` for internal/control-plane ops (e.g. `admin.*`, internal
   * boundary helpers): authoring UIs de-emphasize them (a collapsed "Advanced"
   * section) but never block their use.
   */
  reusable?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// §6 — Workflow document
// ────────────────────────────────────────────────────────────────────────────

export const EdgeEndpointSchema = z.object({
  node: z.string(),
  port: z.string(),
});

export const EdgeSchema = z.object({
  from: EdgeEndpointSchema,
  to: EdgeEndpointSchema,
});

/**
 * The editor's canvas position (and any other view-only hints) for a node (T3).
 * Inline on the node so a workflow stays one self-contained file. Data-only —
 * never read by the engine, never affects execution.
 */
export const NodeUiSchema = z
  .object({ x: z.number(), y: z.number() })
  .loose();

export const WorkflowNodeSchema = z.object({
  id: z.string(),
  op: z.string(),
  /** A short human label for the node. */
  title: z.string().optional(),
  /**
   * A free-form note explaining this step — for educational, self-documenting,
   * and "thought-keeping" workflows. Carried as data; never affects execution.
   */
  comment: z.string().optional(),
  config: z.unknown().optional(),
  /** Editor canvas position + view hints (T3). Data-only. */
  ui: NodeUiSchema.optional(),
});

/** Provenance of a workflow document (admin control-plane, §4 of the admin spec). */
export const WorkflowSourceSchema = z.enum(["code", "file", "db"]);
export type WorkflowSource = z.infer<typeof WorkflowSourceSchema>;

export const WorkflowSchema = z.object({
  $schema: z.string().optional(),
  id: z.string(),
  name: z.string().optional(),
  /**
   * A longer prose description of what the workflow does (T3). Data-only;
   * surfaced by the catalog and "explain this workflow". The structural
   * summarizer can write back into it.
   */
  description: z.string().optional(),
  version: z.string().optional(),
  /** Free-form tags for filtering/grouping in the catalog. Data-only. */
  tags: z.array(z.string()).optional(),
  /**
   * Provenance hint (`code` | `file` | `db`). Data-only; the control plane is
   * the authority, this is a convenience for self-contained documents.
   */
  source: WorkflowSourceSchema.optional(),
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(EdgeSchema),
});

export type EdgeEndpoint = z.infer<typeof EdgeEndpointSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type NodeUi = z.infer<typeof NodeUiSchema>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;

// ────────────────────────────────────────────────────────────────────────────
// §4 — Run dispatch transport
// ────────────────────────────────────────────────────────────────────────────

/** A trigger's external input: each output port seeded with a value or stream. */
export type TriggerInput = Record<string, unknown | ReadableStream<unknown>>;

/** A request to run one workflow from one trigger (§4). Serializable. */
export interface RunRequest {
  workflow: Workflow;
  triggerNodeId: string;
  input: TriggerInput;
  principal: Principal;
  /** Run-scoped parameters, exposed to ops as `ctx.params` (read by `core.input`). */
  params?: Record<string, unknown>;
  /** Opt into bounded, masked per-node I/O sampling on spans (admin-spec T1). */
  sampleIo?: boolean;
  /**
   * Hook-chain depth this run executes at (§8). Set when a hook chain spawns the
   * run, so a nested `core.hook.invoke` resumes the same chain's recursion guard
   * — threaded explicitly (not a thread-local) so it survives transport seams.
   */
  hookDepth?: number;
}

/** The terminal result of a run: the resolved outputs of each reachable out-gate. */
export interface RunResult {
  runId: string;
  status: "ok" | "error";
  /** out-gate node id → its resolved external payload. */
  outputs: Record<string, Record<string, unknown>>;
  error?: unknown;
}

/** A live handle to a dispatched run; streams flow back through it (§4). */
export interface RunHandle {
  runId: string;
  result: Promise<RunResult>;
  /** Cooperative cancellation. */
  abort(reason?: unknown): void;
}

/**
 * Dispatch boundary (§4). The scheduler never knows whether a run executes
 * in-process, on a worker thread, or on a remote worker.
 */
export interface RunTransport {
  dispatch(req: RunRequest): RunHandle;
  /** Release resources (worker pools, sockets). */
  close?(): Promise<void>;
}
