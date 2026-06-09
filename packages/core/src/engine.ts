/**
 * Pattern — the Engine.
 *
 * The Engine is the public façade that ties the registries, services (events,
 * hooks, connections), run transport, and trace fan-out together. It is the one
 * object most apps hold. Everything it composes sits behind an interface, so any
 * piece (transport, bus, registries) can be swapped for a distributed
 * implementation without touching workflows (§4).
 */

import { resolvePrincipal, type AuthRequirement, meetsRequirement } from "./auth/resolve.js";
import { registerCoreOps } from "./ops-core/index.js";
import { InMemoryConnectionRegistry } from "./connections/memory.js";
import { InProcessEventBus } from "./events/bus.js";
import { findTriggerNodes } from "./graph.js";
import { HookChainRunner } from "./hooks/chain.js";
import { MultiTraceSink } from "./observability/span.js";
import {
  InMemoryAuthProviderRegistry,
  InMemoryHookRegistry,
  InMemoryOpRegistry,
  InMemoryWorkflowRegistry,
  type AuthProviderRegistry,
  type HookRegistry,
  type OpRegistry,
  type WorkflowRegistry,
} from "./registry.js";
import type { RunDeps } from "./scheduler/run.js";
import { InProcessTransport } from "./transport/in-process.js";
import { validateWorkflow } from "./validate.js";
import {
  ANONYMOUS,
  type AuthContext,
  type AuthProvider,
  type ConnectionRegistry,
  type EventBus,
  type HookDefinition,
  type OpDefinition,
  type OpServices,
  type Principal,
  type RunResult,
  type RunTransport,
  type TraceSink,
  type TriggerInput,
  type Workflow,
} from "./types.js";

/**
 * A mod (plugin): contributes ops, auth providers, hooks, and workflows, plus an
 * optional imperative `setup`. Loaded with `engine.use(mod)` (§13).
 */
export interface PatternMod {
  name: string;
  ops?: OpDefinition[];
  authProviders?: AuthProvider[];
  hooks?: HookDefinition[];
  workflows?: Workflow[];
  setup?: (engine: Engine) => void | Promise<void>;
}

export interface EngineOptions {
  ops?: OpRegistry;
  hooks?: HookRegistry;
  events?: EventBus;
  auth?: AuthProviderRegistry;
  workflows?: WorkflowRegistry;
  connections?: ConnectionRegistry;
  /** Override the run transport (e.g. a worker-thread pool from runtime-node). */
  transport?: RunTransport;
  /** Register the base op catalog (§12). Default true. */
  registerCoreOps?: boolean;
}

export interface RunOptions {
  /** Which trigger fires. Defaults to a `boundary.manual` trigger, else the sole trigger. */
  trigger?: string;
  /** The trigger's external input, keyed by output port. */
  input?: TriggerInput;
  /** Run-scoped parameters, read by `core.input`. */
  params?: Record<string, unknown>;
  principal?: Principal;
  /** Skip re-validation (use when the workflow was already validated). */
  validate?: boolean;
  signal?: AbortSignal;
}

export class Engine {
  readonly ops: OpRegistry;
  readonly hooks: HookRegistry;
  readonly events: EventBus;
  readonly auth: AuthProviderRegistry;
  readonly workflows: WorkflowRegistry;
  readonly connections: ConnectionRegistry;

  private readonly traceSink = new MultiTraceSink();
  private readonly services: OpServices;
  private readonly transport: RunTransport;
  /** Per-workflow event-subscription cleanups, so updates/removes tear down cleanly. */
  private readonly eventUnsubs = new Map<string, Array<() => void>>();

  constructor(opts: EngineOptions = {}) {
    this.ops = opts.ops ?? new InMemoryOpRegistry();
    this.hooks = opts.hooks ?? new InMemoryHookRegistry();
    this.events = opts.events ?? new InProcessEventBus();
    this.auth = opts.auth ?? new InMemoryAuthProviderRegistry();
    this.workflows = opts.workflows ?? new InMemoryWorkflowRegistry();
    this.connections = opts.connections ?? new InMemoryConnectionRegistry();

    const hookRunner = new HookChainRunner(this.hooks, this.workflows, (wf, trig, input, principal) =>
      this.runFrom(wf, trig, input, principal),
    );
    this.services = { events: this.events, hooks: hookRunner, connections: this.connections };
    this.transport = opts.transport ?? new InProcessTransport(this.deps());

    if (opts.registerCoreOps !== false) {
      registerCoreOps(this.ops);
    }
  }

  /** The dependency bundle the scheduler/transport need. */
  private deps(): RunDeps {
    return {
      ops: this.ops,
      services: this.services,
      traceSink: this.traceSink,
      resolveWorkflow: (id) => this.workflows.get(id),
    };
  }

  // ── Registration ──

  registerOp(op: OpDefinition): this {
    this.ops.register(op);
    return this;
  }

  registerAuthProvider(provider: AuthProvider): this {
    this.auth.register(provider);
    return this;
  }

  declareHook<P>(def: HookDefinition<P>): this {
    this.hooks.declare(def as HookDefinition);
    return this;
  }

  /**
   * Register a workflow. Scans for `boundary.hook` triggers (auto-registering
   * them into the hook chain) and `boundary.event` triggers (subscribing them to
   * the bus). Returns the engine for chaining.
   */
  registerWorkflow(workflow: Workflow, opts: { validate?: boolean } = {}): this {
    if (opts.validate !== false) validateWorkflow(workflow, this.ops);

    // Upsert: tear down any prior wiring for this id first, so re-registering an
    // updated definition (e.g. reloaded from a DB) doesn't leave stale hook
    // registrations or event subscriptions behind.
    if (this.workflows.has(workflow.id)) this.teardownWorkflow(workflow.id);

    const unsubs: Array<() => void> = [];
    for (const node of workflow.nodes) {
      const op = this.ops.get(node.op);
      if (op?.type === "boundary.hook") {
        const cfg = (node.config ?? {}) as { hook?: string; priority?: number };
        if (cfg.hook) {
          if (!this.hooks.definition(cfg.hook)) this.hooks.declare({ name: cfg.hook });
          this.hooks.register({
            name: cfg.hook,
            workflowId: workflow.id,
            nodeId: node.id,
            priority: cfg.priority ?? 100,
          });
        }
      } else if (op?.type === "boundary.event") {
        const cfg = (node.config ?? {}) as { event?: string };
        if (cfg.event) {
          unsubs.push(
            this.events.subscribe(cfg.event, (payload) => {
              void this.runFrom(workflow, node.id, { payload }, ANONYMOUS).catch((err) => {
                console.error(`[pattern] event workflow "${workflow.id}" failed:`, err);
              });
            }),
          );
        }
      }
    }
    if (unsubs.length) this.eventUnsubs.set(workflow.id, unsubs);

    // Store last so subscribers (HTTP/WS hosts) observe a fully-wired workflow.
    this.workflows.register(workflow);
    return this;
  }

  /** Update a workflow at runtime (alias for the upserting `registerWorkflow`). */
  updateWorkflow(workflow: Workflow, opts?: { validate?: boolean }): this {
    return this.registerWorkflow(workflow, opts);
  }

  /** Remove a workflow at runtime, tearing down its hook/event wiring. */
  unregisterWorkflow(id: string): boolean {
    this.teardownWorkflow(id);
    return this.workflows.delete(id);
  }

  /** Subscribe to workflow add/update/remove (hosts use this to re-derive routes). */
  onWorkflowsChanged(listener: Parameters<WorkflowRegistry["subscribe"]>[0]): () => void {
    return this.workflows.subscribe(listener);
  }

  /** Remove a workflow's hook registrations and event subscriptions. */
  private teardownWorkflow(id: string): void {
    this.hooks.unregisterWorkflow(id);
    const unsubs = this.eventUnsubs.get(id);
    if (unsubs) {
      for (const u of unsubs) u();
      this.eventUnsubs.delete(id);
    }
  }

  /**
   * Install a mod (plugin): its ops, auth providers, hooks, and workflows are
   * registered, then its `setup` runs. This is the extension seam (§13, §16/14)
   * — mods contribute ops, boundaries, and auth providers via the registries.
   */
  use(mod: PatternMod): this {
    for (const op of mod.ops ?? []) {
      if (!this.ops.has(op.type)) this.ops.register(op);
    }
    for (const p of mod.authProviders ?? []) this.auth.register(p);
    for (const h of mod.hooks ?? []) this.hooks.declare(h);
    for (const wf of mod.workflows ?? []) this.registerWorkflow(wf);
    const r = mod.setup?.(this);
    if (r instanceof Promise) r.catch((err) => console.error(`[pattern] mod "${mod.name}" setup failed:`, err));
    return this;
  }

  // ── Observability ──

  /** Subscribe a trace sink; returns an unsubscribe fn (§10). */
  onTrace(sink: TraceSink): () => void {
    return this.traceSink.add(sink);
  }

  // ── Validation ──

  validate(workflow: unknown): Workflow {
    return validateWorkflow(workflow, this.ops);
  }

  // ── Auth ──

  /** Resolve a principal via the provider chain (§9). */
  authenticate(ctx: AuthContext): Promise<Principal> {
    return resolvePrincipal(this.auth, ctx);
  }

  /** Check a principal against a trigger's requirement (§9). */
  authorize(principal: Principal, requirement: AuthRequirement | undefined) {
    return meetsRequirement(principal, requirement);
  }

  // ── Running ──

  /** Run a workflow from a chosen (or inferred) trigger. */
  async run(workflowOrId: Workflow | string, opts: RunOptions = {}): Promise<RunResult> {
    const workflow = typeof workflowOrId === "string" ? this.workflows.get(workflowOrId) : workflowOrId;
    if (!workflow) throw new Error(`workflow "${String(workflowOrId)}" is not registered`);
    if (opts.validate !== false && typeof workflowOrId !== "string") {
      validateWorkflow(workflow, this.ops);
    }

    const triggerId = opts.trigger ?? this.inferTrigger(workflow);
    return this.runFrom(
      workflow,
      triggerId,
      opts.input ?? {},
      opts.principal ?? ANONYMOUS,
      opts.signal,
      opts.params,
    );
  }

  /** Lower-level: run a workflow from an explicit trigger node. */
  runFrom(
    workflow: Workflow,
    triggerNodeId: string,
    input: TriggerInput,
    principal: Principal,
    signal?: AbortSignal,
    params?: Record<string, unknown>,
  ): Promise<RunResult> {
    const handle = this.transport.dispatch({ workflow, triggerNodeId, input, principal, params });
    if (signal) {
      if (signal.aborted) handle.abort(signal.reason);
      else signal.addEventListener("abort", () => handle.abort(signal.reason), { once: true });
    }
    return handle.result;
  }

  private inferTrigger(workflow: Workflow): string {
    const triggers = findTriggerNodes(workflow, this.ops);
    const manual = triggers.find((t) => t.op === "boundary.manual");
    if (manual) return manual.id;
    if (triggers.length === 1) return triggers[0]!.id;
    if (triggers.length === 0) throw new Error(`workflow "${workflow.id}" has no trigger`);
    throw new Error(
      `workflow "${workflow.id}" has multiple triggers; pass { trigger } to choose one (${triggers
        .map((t) => t.id)
        .join(", ")})`,
    );
  }

  /** Emit an event onto the bus (fire-and-forget, §8). */
  emit(event: string, payload: unknown): void {
    this.events.emit(event, payload);
  }

  /** Invoke a hook chain directly (§8). */
  invokeHook(name: string, payload: unknown): Promise<unknown> {
    return this.services.hooks.invoke(name, payload);
  }

  /** Release resources (worker pools, event subscriptions). */
  async close(): Promise<void> {
    for (const unsubs of this.eventUnsubs.values()) for (const u of unsubs) u();
    this.eventUnsubs.clear();
    await this.transport.close?.();
  }
}

/** Convenience: a ready-to-use engine with the base op catalog registered. */
export function createEngine(opts?: EngineOptions): Engine {
  return new Engine(opts);
}

/** Identity helper for authoring a mod with full type-checking & inference. */
export function defineMod(mod: PatternMod): PatternMod {
  return mod;
}
