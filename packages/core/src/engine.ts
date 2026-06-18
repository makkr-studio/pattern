/**
 * Pattern — the Engine.
 *
 * The Engine is the public façade that ties the registries, services (events,
 * hooks, connections), run transport, and trace fan-out together. It is the one
 * object most apps hold. Everything it composes sits behind an interface, so any
 * piece (transport, bus, registries) can be swapped for a distributed
 * implementation without touching workflows (§4).
 */

import { resolvePrincipal, type AuthRequirement, meetsRequirement, resolveAuthRequirement } from "./auth/resolve.js";
import { resolveWorkflowEnvTracked } from "./env-config.js";
import { collectSecretValues, maskSecretValues, redactConfig } from "./redact.js";
import { resolveBoundaryConfig, hasConfigPorts } from "./resolve-config.js";
import { registerCoreOps } from "./ops-core/index.js";
import { InMemoryConnectionRegistry } from "./connections/memory.js";
import { InProcessEventBus } from "./events/bus.js";
import { findTriggerNodes } from "./graph.js";
import { HookChainRunner } from "./hooks/chain.js";
import { MultiTraceSink, noopTraceSink } from "./observability/span.js";
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
import { collectIssues, validateWorkflow } from "./validate.js";
import { WorkflowValidationError } from "./errors.js";
import type { FrontendContribution, SettingsSection } from "./frontend.js";
import type { DocsContribution } from "./docs.js";
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
  type RunHandle,
  type RunParentRef,
  type RunResult,
  type RunTransport,
  type TraceSink,
  type TriggerInput,
  type Workflow,
} from "./types.js";

/**
 * A mod (plugin): contributes ops, auth providers, hooks, and workflows, plus an
 * optional imperative `setup`. Loaded with `engine.use(mod)` (sync; throws if any
 * workflow uses boundary config ports) or `await engine.useAsync(mod)` (runs the
 * resolve phase — used by `loadMods`/`loadProject`) (§13, admin-spec P3).
 */
export interface PatternMod {
  name: string;
  ops?: OpDefinition[];
  authProviders?: AuthProvider[];
  hooks?: HookDefinition[];
  workflows?: Workflow[];
  /**
   * A frontend contribution (admin-spec P2): menu entries, pages, ⌘K commands,
   * and an assets pointer. Aggregated by a frontend host (the admin) via
   * `engine.frontend()`. Carried as data; ignored by the engine itself.
   */
  frontend?: FrontendContribution;
  /**
   * A documentation chapter: markdown shipped inside the mod's package,
   * registered as a named filesystem in `setup`, referenced here. Aggregated
   * by a docs host (@pattern/mod-docs) via `engine.docs()`. Carried as data;
   * ignored by the engine itself.
   */
  docs?: DocsContribution;
  setup?: (engine: Engine) => void | Promise<void>;
  /**
   * Runs after **every** mod of the installation batch is installed (admin-spec
   * P3). `setup` sees only the mods loaded before it; `ready` sees them all —
   * the seam for work that depends on other mods' ops, e.g. the admin control
   * plane registering stored workflows that use app-mod ops. For a single
   * `use`/`useAsync` install the batch is just that mod, so `ready` follows
   * `setup` immediately; `loadMods` defers it until the whole config list is in.
   */
  ready?: (engine: Engine) => void | Promise<void>;
}

/** A mod paired with the metadata a frontend host needs to attribute its UI. */
export interface InstalledMod {
  name: string;
  frontend?: FrontendContribution;
  docs?: DocsContribution;
  /** Op types the mod contributed (for `admin.mod.list`). */
  opTypes: string[];
  /** Workflow ids the mod contributed. */
  workflowIds: string[];
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
  /**
   * Environment map for resolving `$env` / `${VAR}` references in workflow config
   * at registration time. Defaults to `{}` (object-form refs use their declared
   * defaults). The Node adapter's `loadProject` injects `process.env`.
   */
  env?: Record<string, string | undefined>;
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
  /** Opt into bounded, masked per-node I/O sampling on spans (admin-spec T1). */
  sampleIo?: boolean;
  /** Caller-chosen run id — lets the caller cancel/pause a run it just
   *  started without waiting for the result (see RunRequest.runId). */
  runId?: string;
}

export class Engine {
  readonly ops: OpRegistry;
  readonly hooks: HookRegistry;
  readonly events: EventBus;
  readonly auth: AuthProviderRegistry;
  readonly workflows: WorkflowRegistry;
  readonly connections: ConnectionRegistry;

  private readonly traceSink = new MultiTraceSink();
  /**
   * The services bag handed to every run. A stable object reference: the
   * transport captures it once, and `provideService` mutates it in place so
   * later-registered services (e.g. a mod's control plane) are visible to runs.
   */
  private readonly services: OpServices;
  private readonly transport: RunTransport;
  private readonly env: Record<string, string | undefined>;
  /** Per-workflow event-subscription cleanups, so updates/removes tear down cleanly. */
  private readonly eventUnsubs = new Map<string, Array<() => void>>();
  /** Installed mods, in load order (for frontend aggregation + `admin.mod.list`). */
  private readonly mods: InstalledMod[] = [];
  /** Per-workflow, per-node config paths resolved from the environment (P4). */
  private readonly secretPaths = new Map<string, Record<string, string[]>>();
  /**
   * Pooled secret *values* (schema-tagged + env-resolved config fields) across
   * all registered workflows, fed to the I/O sampler so secrets that flow
   * through run data are masked in span samples (T1). Values are only ever
   * added — masking a value from a since-removed workflow is the safe direction.
   */
  private readonly secretValues = new Set<string>();
  /**
   * When true, runs sample their node I/O even if the caller didn't ask
   * (admin Settings → Observability). An explicit `RunOptions.sampleIo`
   * always wins; `ctx.invoke` sub-runs inherit their parent's decision.
   */
  private sampleIoDefault = false;

  constructor(opts: EngineOptions = {}) {
    this.ops = opts.ops ?? new InMemoryOpRegistry();
    this.hooks = opts.hooks ?? new InMemoryHookRegistry();
    this.events = opts.events ?? new InProcessEventBus();
    this.auth = opts.auth ?? new InMemoryAuthProviderRegistry();
    this.workflows = opts.workflows ?? new InMemoryWorkflowRegistry();
    this.connections = opts.connections ?? new InMemoryConnectionRegistry();
    this.env = opts.env ?? {};

    const hookRunner = new HookChainRunner(this.hooks, this.workflows, (wf, trig, input, principal, hookDepth, opts) =>
      this.runFrom(wf, trig, input, principal, undefined, undefined, undefined, hookDepth, opts?.runId, opts?.parent),
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
      env: this.env,
      resolveWorkflow: (id) => this.workflows.get(id),
      // Mask known secret values out of sampled I/O (reads the live pool, so
      // secrets from workflows registered after construction are covered too).
      maskSample: (v) => maskSecretValues(v, this.secretValues),
    };
  }

  /** Deps for the registration-time resolve phase (no trace noise). */
  private resolveDeps(): RunDeps {
    return { ...this.deps(), traceSink: noopTraceSink };
  }

  /**
   * Add a runtime-discovered secret value to the sample-masking pool (mods
   * that mint or decrypt secrets — a vault — call this so the value can never
   * appear in sampled I/O). Same pool the engine feeds from workflow config;
   * registering before the value flows is enough, masking happens at sample
   * time. Short strings are ignored (masking "a" would shred samples).
   */
  registerSecretValue(value: string): this {
    if (typeof value === "string" && value.length >= 4) this.secretValues.add(value);
    return this;
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

  /**
   * Whether any auth provider is registered — i.e. whether `requireAuth` is
   * actually *enforceable*. With none, stamping a requirement would brick the
   * route (every principal is anonymous, no login to get past it), so a host
   * that wants to secure-by-default keys on this, not a specific provider mod.
   */
  hasAuthProvider(): boolean {
    return this.auth.chain().length > 0;
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
  registerWorkflow(input: Workflow, opts: { validate?: boolean } = {}): this {
    // Resolve `$env` / `${VAR}` config references against the engine's env map,
    // producing a concrete workflow *before* validation (so typed refs like a
    // port satisfy the op's config schema). Track env-derived paths as secrets (P4).
    const { workflow, secretPaths } = resolveWorkflowEnvTracked(input, this.env);
    if (hasConfigPorts(workflow, this.ops)) {
      throw new Error(
        `workflow "${workflow.id}" uses boundary config ports — register it with ` +
          `\`await engine.registerWorkflowAsync(wf)\` (or via loadProject), which runs the resolve phase.`,
      );
    }
    return this.finishRegister(workflow, opts, secretPaths);
  }

  /**
   * Register a workflow, running the registration-time resolve phase for boundary
   * config ports (e.g. an HTTP route's port fed by `core.env`). Use this (or
   * `loadProject`) for workflows that wire ops into a boundary's config; plain
   * `registerWorkflow` stays synchronous for static / `$env` config.
   */
  async registerWorkflowAsync(input: Workflow, opts: { validate?: boolean } = {}): Promise<this> {
    const { workflow: enved, secretPaths } = resolveWorkflowEnvTracked(input, this.env);
    const resolved = await resolveBoundaryConfig(enved, this.ops, this.resolveDeps());
    return this.finishRegister(resolved, opts, secretPaths);
  }

  /**
   * Run the registration-time resolve phase on a doc WITHOUT registering it:
   * `$env` references + boundary config ports (a `core.schema.define` wired into
   * an http.request's `body`, etc.) are frozen into node config. For ephemeral
   * runs of unregistered docs — e.g. the admin editor's Run panel — so they
   * honor the exact semantics a deployed copy would.
   */
  async resolveWorkflowDoc(input: Workflow): Promise<Workflow> {
    const { workflow } = resolveWorkflowEnvTracked(input, this.env);
    return resolveBoundaryConfig(workflow, this.ops, this.resolveDeps());
  }

  /** Validate, wire hooks/events, and store an already-resolved workflow. */
  private finishRegister(
    workflow: Workflow,
    opts: { validate?: boolean } = {},
    secretPaths: Record<string, string[]> = {},
  ): this {
    if (opts.validate !== false) {
      // Errors throw (block registration); warnings are advisory — log them so a
      // file-workflow author who skips `pattern validate` still sees e.g. a
      // privileged op left reachable without requireAuth.
      const { ok, issues } = collectIssues(workflow, this.ops);
      if (!ok) throw new WorkflowValidationError(issues, workflow.id);
      for (const w of issues) if (w.severity === "warning") console.warn(`[pattern] ⚠ ${workflow.id}: ${w.message}`);
    }

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

    if (Object.keys(secretPaths).length) this.secretPaths.set(workflow.id, secretPaths);
    else this.secretPaths.delete(workflow.id);

    // Pool this workflow's concrete secret values for I/O-sample masking (T1).
    for (const node of workflow.nodes) {
      const op = this.ops.get(node.op);
      for (const v of collectSecretValues(node.config, op?.config, secretPaths[node.id])) {
        this.secretValues.add(v);
      }
    }

    // Store last so subscribers (HTTP/WS hosts) observe a fully-wired workflow.
    this.workflows.register(workflow);
    return this;
  }

  /**
   * The redacted config of a node — schema-tagged secrets and env-derived fields
   * masked (P4). Use this anywhere a node's config is surfaced (introspection,
   * the admin API) so raw secret values never leak.
   */
  redactedConfig(workflowId: string, nodeId: string): unknown {
    const wf = this.workflows.get(workflowId);
    const node = wf?.nodes.find((n) => n.id === nodeId);
    if (!node) return undefined;
    const op = this.ops.get(node.op);
    const envPaths = this.secretPaths.get(workflowId)?.[nodeId];
    return redactConfig(node.config, op?.config, envPaths);
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
    this.secretPaths.delete(id);
    const unsubs = this.eventUnsubs.get(id);
    if (unsubs) {
      for (const u of unsubs) u();
      this.eventUnsubs.delete(id);
    }
  }

  /**
   * Register a named capability service, reachable by ops as `ctx.services.<name>`
   * (admin-spec P1/§3). Mods call this from `setup` to expose a control plane, a
   * filesystem registry, etc. Mutates the shared services object so runs
   * dispatched after registration see it. Throws on collision with a core
   * capability (events/hooks/connections).
   */
  provideService(name: string, impl: unknown): this {
    if (name === "events" || name === "hooks" || name === "connections") {
      throw new Error(`service name "${name}" is reserved for a core capability`);
    }
    (this.services as Record<string, unknown>)[name] = impl;
    return this;
  }

  /** Read a registered service by name (typed-loose; narrow at the call site). */
  service<T = unknown>(name: string): T | undefined {
    return (this.services as Record<string, unknown>)[name] as T | undefined;
  }

  /**
   * Install a mod (plugin): its ops, auth providers, hooks, and workflows are
   * registered, then its `setup` runs. This is the extension seam (§13, §16/14)
   * — mods contribute ops, boundaries, and auth providers via the registries.
   *
   * Synchronous: a mod whose workflows use boundary config ports must be loaded
   * with `await engine.useAsync(mod)` instead (the error from `registerWorkflow`
   * names the fix). `loadMods`/`loadProject` use the async path.
   */
  use(mod: PatternMod): this {
    this.installMod(mod, (wf) => {
      this.registerWorkflow(wf);
    });
    const r = Promise.resolve(mod.setup?.(this)).then(() => mod.ready?.(this));
    r.catch((err) => console.error(`[pattern] mod "${mod.name}" setup failed:`, err));
    return this;
  }

  /**
   * Install a mod, running the registration-time resolve phase for any workflow
   * that uses boundary config ports, and awaiting an async `setup` (admin-spec P3).
   * Use this whenever a mod's workflows may wire ops into a boundary's config.
   */
  async useAsync(mod: PatternMod, opts: { deferReady?: boolean } = {}): Promise<this> {
    const pending: Array<Promise<unknown>> = [];
    this.installMod(mod, (wf) => {
      pending.push(this.registerWorkflowAsync(wf));
    });
    await Promise.all(pending);
    await mod.setup?.(this);
    // Batch installs (`loadMods`) defer `ready` until every mod is in.
    if (!opts.deferReady) await mod.ready?.(this);
    return this;
  }

  /** Shared mod-install body: ops/providers/hooks/workflows + bookkeeping. */
  private installMod(mod: PatternMod, registerWorkflow: (wf: Workflow) => void): void {
    const opTypes: string[] = [];
    for (const op of mod.ops ?? []) {
      if (!this.ops.has(op.type)) {
        this.ops.register(op);
        opTypes.push(op.type);
      }
    }
    for (const p of mod.authProviders ?? []) this.auth.register(p);
    for (const h of mod.hooks ?? []) this.hooks.declare(h);
    const workflowIds: string[] = [];
    for (const wf of mod.workflows ?? []) {
      registerWorkflow(wf);
      workflowIds.push(wf.id);
    }
    this.mods.push({ name: mod.name, frontend: mod.frontend, docs: mod.docs, opTypes, workflowIds });
  }

  /** Installed mods, in load order (for `admin.mod.list` and frontend aggregation). */
  installedMods(): readonly InstalledMod[] {
    return this.mods;
  }

  /**
   * Aggregate the `frontend` contributions of every installed mod (admin-spec P2).
   * A frontend host (the admin) builds its nav/pages/commands from this; menu
   * categories are the union of `MenuEntry.category`, each sorted by `order`
   * then label.
   */
  frontend(): {
    assets: Array<{ mod: string; assets: string }>;
    menu: FrontendContribution["menu"];
    pages: FrontendContribution["pages"];
    commands: FrontendContribution["commands"];
    settings: Array<{ mod: string; section: SettingsSection }>;
  } {
    const assets: Array<{ mod: string; assets: string }> = [];
    const menu: NonNullable<FrontendContribution["menu"]> = [];
    const pages: NonNullable<FrontendContribution["pages"]> = [];
    const commands: NonNullable<FrontendContribution["commands"]> = [];
    const settings: Array<{ mod: string; section: SettingsSection }> = [];
    for (const mod of this.mods) {
      const f = mod.frontend;
      if (!f) continue;
      if (f.assets) assets.push({ mod: mod.name, assets: f.assets });
      if (f.menu) menu.push(...f.menu);
      if (f.pages) pages.push(...f.pages);
      if (f.commands) commands.push(...f.commands);
      if (f.settings) settings.push(...f.settings.map((section) => ({ mod: mod.name, section })));
    }
    menu.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.label.localeCompare(b.label));
    return { assets, menu, pages, commands, settings };
  }

  /**
   * The `docs` contributions of every installed mod, in load order. A docs
   * host (@pattern/mod-docs) builds its chapters from this — content itself
   * stays in each mod's registered filesystem.
   */
  docs(): Array<{ mod: string; docs: DocsContribution }> {
    const out: Array<{ mod: string; docs: DocsContribution }> = [];
    for (const mod of this.mods) {
      if (mod.docs) out.push({ mod: mod.name, docs: mod.docs });
    }
    return out;
  }

  // ── Observability ──

  /** Subscribe a trace sink; returns an unsubscribe fn (§10). */
  onTrace(sink: TraceSink): () => void {
    return this.traceSink.add(sink);
  }

  /** Sample node I/O on every run by default (T1). Explicit `RunOptions.sampleIo` still wins. */
  setIoSampling(on: boolean): void {
    this.sampleIoDefault = on;
  }

  /** Whether runs sample node I/O by default. */
  ioSampling(): boolean {
    return this.sampleIoDefault;
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

  /**
   * Check a principal against a trigger's requirement (§9). An `{ env }`
   * requirement is resolved against the engine's env map here, per call —
   * hosts never see the deferred form.
   */
  authorize(principal: Principal, requirement: AuthRequirement | undefined) {
    const resolved = resolveAuthRequirement(requirement, this.env);
    // A requirement is *unenforceable* with no auth provider registered: nobody
    // can authenticate, so enforcing it would brick the route (401 with no way
    // in). So a declared requireAuth degrades to **advisory** — the route serves
    // open and the host warns loudly at boot. Add a provider and the *same*
    // declaration is enforced, with zero workflow changes. (≥1 provider → normal
    // 401/403; a present-but-failing provider still denies, fail-secure.)
    if (resolved && !this.hasAuthProvider()) return { ok: true as const };
    return meetsRequirement(principal, resolved);
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
      opts.sampleIo,
      undefined,
      opts.runId,
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
    sampleIo?: boolean,
    hookDepth?: number,
    runId?: string,
    parent?: RunParentRef,
  ): Promise<RunResult> {
    const handle = this.transport.dispatch({
      workflow,
      triggerNodeId,
      input,
      principal,
      params,
      sampleIo: sampleIo ?? this.sampleIoDefault,
      hookDepth,
      runId,
      parent,
    });
    // Track every in-flight run (whatever the entry path) so the admin can
    // cancel / pause it by runId while it executes.
    this.inflightRuns.set(handle.runId, handle);
    void handle.result.catch(() => {}).finally(() => this.inflightRuns.delete(handle.runId));
    if (signal) {
      if (signal.aborted) handle.abort(signal.reason);
      else signal.addEventListener("abort", () => handle.abort(signal.reason), { once: true });
    }
    return handle.result;
  }

  // ── In-flight run control (any entry path: hosts, admin, invoke) ──

  private readonly inflightRuns = new Map<string, RunHandle>();

  /** Abort a run in flight. False = unknown/already settled. */
  cancelRun(runId: string, reason?: unknown): boolean {
    const h = this.inflightRuns.get(runId);
    if (!h) return false;
    h.abort(reason ?? new Error("cancelled from admin"));
    return true;
  }

  /** Pause node scheduling for a run (in-flight node executions finish).
   *  False = unknown run, or the transport can't pause (e.g. worker pool). */
  pauseRun(runId: string): boolean {
    return this.inflightRuns.get(runId)?.pause?.() ?? false;
  }

  /** Release a paused run. */
  resumeRun(runId: string): boolean {
    return this.inflightRuns.get(runId)?.resume?.() ?? false;
  }

  /** Is this in-flight run currently paused? (undefined = not in flight) */
  runPaused(runId: string): boolean | undefined {
    const h = this.inflightRuns.get(runId);
    return h ? (h.paused?.() ?? false) : undefined;
  }

  /** Ids of runs currently executing. */
  inflightRunIds(): string[] {
    return [...this.inflightRuns.keys()];
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

  /** What this engine runs workflows ON (observability; see RunTransport.describe). */
  transportInfo(): Record<string, unknown> {
    return this.transport.describe?.() ?? { kind: "unknown" };
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
