/**
 * @pattern-js/mod-admin — the `admin.*` op catalog (admin internals §10).
 *
 * Each op reaches the control plane / trace sink / engine via `ctx.services`
 * (in-process, P5) and returns value data. They are ordinary `OpDefinition`s, so
 * they appear in the catalog and are editable inside the admin — the system
 * editing its own control plane. Endpoint workflows (§11) map HTTP routes onto
 * these ops; the ops themselves are transport-agnostic.
 */

import {
  boundaries,
  collectIssues,
  httpOutcome,
  stream,
  value,
  z,
  type OpContext,
  type OpDefinition,
  type Ports,
  type Workflow,
} from "@pattern-js/core";
import { adminServices, ASSETS_FS } from "../services.js";
import { processStats, workerBench } from "../system-stats.js";
import { catalog, docPorts, explain, modList, opGet, opList, portsCompatible, safeNodeConfigs, systemMap } from "../introspect.js";
import { diffWorkflows } from "../control-plane/versioning.js";
import { safeSegment } from "../control-plane/store.js";
import { builtinTemplates } from "../templates.js";

// ── Route I/O: how each op's discrete ports map to an HTTP request ──
// The op is a PURE domain function (named inputs in, named outputs out) — it
// never sees HTTP. This table lets the endpoint workflow (§11) decompose the
// request into the op's input ports and recompose its output into the response.

type Src = "params" | "query" | "body";
export interface InSpec {
  src: Src;
  schema: z.ZodType;
}
export interface RouteIO {
  in: Record<string, InSpec>;
  out: string | string[];
  stream?: boolean;
}
export const adminOpRoutes: Record<string, RouteIO> = {};

/** Source helpers + common field schemas (kept permissive — admin's own SPA is the only client). */
const S = z.string();
const objSchema = z.record(z.string(), z.unknown());
const P = (schema: z.ZodType = S): InSpec => ({ src: "params", schema });
const Q = (schema: z.ZodType): InSpec => ({ src: "query", schema });
const Bd = (schema: z.ZodType): InSpec => ({ src: "body", schema });

type Handler = (args: Record<string, unknown>, backend: ReturnType<typeof adminServices>, ctx: OpContext) => unknown | Promise<unknown>;

/**
 * Build an admin op as a PURE domain function: discrete, named input ports
 * (`io.in`) and a named output port (`io.out`, or several for genuinely distinct
 * concerns like `version` + `issues`). The op never sees HTTP — the endpoint
 * workflow decomposes the request into these ports and names the response. The
 * handler still receives a plain args object (the resolved named inputs), so
 * the domain logic is unchanged.
 */
function adminOp(
  type: string,
  description: string,
  io: { in?: Record<string, InSpec>; out: string | string[]; stream?: boolean },
  handler: Handler,
): OpDefinition {
  const inSpec = io.in ?? {};
  adminOpRoutes[type] = { in: inSpec, out: io.out, stream: io.stream };
  const inputs: Ports = Object.fromEntries(Object.entries(inSpec).map(([k, v]) => [k, value(v.schema)]));
  const outputs: Ports = io.stream
    ? { [io.out as string]: stream() }
    : typeof io.out === "string"
      ? { [io.out]: value() }
      : Object.fromEntries(io.out.map((k) => [k, value()]));
  return {
    type,
    title: type,
    description,
    // Control-plane internals — usable, but de-emphasized in the authoring palette.
    reusable: false,
    // The whole control plane is sensitive (read or mutate workflows, runs,
    // settings). Flag it so the validator warns if any admin.* op is wired
    // behind a trigger with no requireAuth — e.g. admin.workflow.delete on a
    // public route.
    sensitivity: "privileged",
    inputs,
    outputs,
    execute: async (ctx) => {
      const keys = Object.keys(inSpec);
      const args: Record<string, unknown> = {};
      await Promise.all(keys.map(async (k) => void (args[k] = await ctx.input.value(k))));
      try {
        const result = await handler(args, adminServices(ctx), ctx);
        return typeof io.out === "string" ? { [io.out]: result } : (result as Record<string, unknown>);
      } catch (err) {
        // A DOMAIN error (not-found, bad input) becomes a collision-proof
        // outcome the route's boundary.http.status maps to a 4xx — the op stays
        // network-unaware. Real failures rethrow (→ 500). Multi-output ops have
        // no domain-error case, so they always rethrow.
        if (err instanceof DomainError && typeof io.out === "string") return { [io.out]: httpOutcome(err.code, { error: err.code, message: err.message }) };
        throw err;
      }
    },
  };
}

/** A domain error with an outcome code (not_found, forbidden, invalid, conflict…). */
class DomainError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** A display author for version snapshots: name, else email, else the id. */
function authorOf(principal: { kind: string; id?: string; claims?: Record<string, unknown> }): string | undefined {
  if (principal.kind !== "user") return undefined;
  const name = typeof principal.claims?.name === "string" ? principal.claims.name : undefined;
  const email = typeof principal.claims?.email === "string" ? principal.claims.email : undefined;
  return name || email || principal.id;
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v) throw new DomainError("invalid", `missing "${name}"`);
  return v;
};

// ── Workflows ──

const workflowList = adminOp("admin.workflow.list", "List all workflows (code + stored), with provenance + versions.", { out: "workflows" }, (_args, { engine, controlPlane }) =>
  catalog(engine, controlPlane.store, parkedCode),
);

const workflowGet = adminOp("admin.workflow.get", "Get a workflow's meta + live doc (+ latest saved version).", { in: { slug: P() }, out: "workflow" }, async (args, { engine, controlPlane }) => {
  const slug = str(args.slug, "slug");
  const metas = await catalog(engine, controlPlane.store, parkedCode);
  const meta = metas.find((m) => m.slug === slug) ?? null;
  let liveDoc: Workflow | null = null;
  if (meta?.source === "code") {
    liveDoc = engine.workflows.get(slug) ?? parkedCode.get(slug) ?? null;
  } else if (meta?.live) {
    liveDoc = await controlPlane.store.getVersion(slug, meta.live);
  }
  // The newest saved version — what the editor should reopen on a workflow
  // that was saved but never deployed (live pointer still null).
  const newest = meta?.versions[meta.versions.length - 1];
  const latestDoc =
    meta?.source === "code"
      ? liveDoc
      : newest
        ? newest.id === meta?.live
          ? liveDoc
          : await controlPlane.store.getVersion(slug, newest.id)
        : null;
  // Redact secrets in the live doc's node configs (P4) where it is registered.
  const safeConfigs = engine.workflows.has(slug) ? safeNodeConfigs(engine, slug) : undefined;
  return { meta, liveDoc, latestDoc, safeConfigs };
});

const workflowSave = adminOp("admin.workflow.save", "Validate a doc + mint an immutable version snapshot.", { in: { slug: P(), doc: Bd(objSchema), note: Bd(z.string().optional()) }, out: ["version", "issues"] }, async (args, { controlPlane, engine }, ctx) => {
  const slug = str(args.slug, "slug");
  const doc = args.doc as Workflow;
  if (!doc || typeof doc !== "object") throw new Error('missing "doc"');
  // Block on errors only; warnings (e.g. a privileged op behind no auth) ride
  // along to the editor but don't stop the save.
  const { ok, issues } = collectIssues(doc, engine.ops);
  if (!ok) return { issues };
  // Versions are attributed: who saved this is part of the snapshot's story.
  const version = await controlPlane.store.saveVersion(
    slug,
    { ...doc, source: "file" },
    { note: args.note as string | undefined, author: authorOf(ctx.principal), principal: ctx.principal },
  );
  return { version, issues };
});

const workflowImport = adminOp("admin.workflow.import", "Import a workflow JSON → validate → new file workflow.", { in: { json: Bd(z.unknown()) }, out: ["slug", "issues"] }, async (args, { controlPlane, engine }, ctx) => {
  const raw = typeof args.json === "string" ? (JSON.parse(args.json) as Workflow) : (args.json as Workflow);
  if (!raw || typeof raw !== "object" || !raw.id) throw new Error("invalid workflow JSON (needs an id)");
  // The imported id becomes a storage path segment — reject path-like ids here
  // with a friendly message (the store re-checks as a backstop).
  const slug = safeSegment(raw.id, "workflow id");
  const { ok, issues } = collectIssues(raw, engine.ops);
  if (ok) {
    await controlPlane.store.saveVersion(slug, { ...raw, source: "file" }, { note: "imported", author: authorOf(ctx.principal), principal: ctx.principal });
  }
  return { slug, issues };
});

/**
 * Code workflows a user undeployed in THIS process: slug → the doc the mod
 * registered, parked so re-enabling needs no restart. Mods re-register at boot,
 * so a code undeploy lasts until restart — by design: a safety net against
 * permanently bricking the admin from inside itself.
 */
const parkedCode = new Map<string, Workflow>();

const workflowSetEnabled = adminOp("admin.workflow.setEnabled", "Enable (register) or disable/undeploy (unregister) a workflow — code ones park until restart.", { in: { slug: P(), enabled: Bd(z.boolean()) }, out: "result" }, async (args, { controlPlane, engine }) => {
  const slug = str(args.slug, "slug");
  const enabled = Boolean(args.enabled);
  if (enabled) {
    const parked = parkedCode.get(slug);
    if (parked) {
      await engine.registerWorkflowAsync(parked);
      parkedCode.delete(slug);
      return { ok: true };
    }
    const meta = await controlPlane.store.getMeta(slug);
    if (!meta?.live) throw new DomainError("invalid", `"${slug}" has no live version to enable`);
    const res = await controlPlane.deploy(slug, meta.live);
    return { ok: res.ok, ...(res.ok ? {} : { conflicts: res.conflicts }) };
  }
  // Undeploy. A code workflow has no store meta — park its doc (so it can come
  // back without a restart) and unregister: routes/schedules drop immediately.
  const meta = await controlPlane.store.getMeta(slug);
  if (!meta) {
    const doc = engine.workflows.get(slug);
    if (!doc) throw new DomainError("not_found", `workflow "${slug}" not found`);
    parkedCode.set(slug, doc);
    engine.unregisterWorkflow(slug);
    return { ok: true };
  }
  await controlPlane.disable(slug);
  return { ok: true };
});

const workflowDeploy = adminOp("admin.workflow.deploy", "Activate a version (route-conflict checked).", { in: { slug: P(), version: Bd(S), swap: Bd(z.boolean().optional()) }, out: "result" }, (args, { controlPlane }, ctx) =>
  controlPlane.deploy(str(args.slug, "slug"), str(args.version, "version"), { swap: Boolean(args.swap), principal: ctx.principal }),
);

const workflowDelete = adminOp("admin.workflow.delete", "Disable + remove a workflow from the store.", { in: { slug: P() }, out: "result" }, async (args, { controlPlane }) => {
  const slug = str(args.slug, "slug");
  await controlPlane.disable(slug).catch(() => {});
  await controlPlane.store.delete(slug);
  return { ok: true };
});

const workflowExplain = adminOp("admin.workflow.explain", "Deterministic structural summary of a workflow.", { in: { slug: P() }, out: "explanation" }, async (args, { engine, controlPlane }) => {
  const slug = str(args.slug, "slug");
  const doc = engine.workflows.get(slug) ?? (await loadLive(controlPlane, slug));
  if (!doc) throw new DomainError("not_found", `workflow "${slug}" not found`);
  return { text: explain(engine, doc) };
});

// ── Versions ──

const versionList = adminOp("admin.version.list", "List a workflow's version history.", { in: { slug: P() }, out: "versions" }, async (args, { controlPlane }) => {
  const meta = await controlPlane.store.getMeta(str(args.slug, "slug"));
  return meta?.versions ?? [];
});

const versionGet = adminOp("admin.version.get", "Get a specific version snapshot.", { in: { slug: P(), v: P() }, out: "version" }, async (args, { controlPlane }) => {
  const version = await controlPlane.store.getVersion(str(args.slug, "slug"), str(args.v, "v"));
  if (!version) throw new DomainError("not_found", "version not found");
  return version;
});

const versionDiff = adminOp("admin.version.diff", "Structural JSON diff between two versions.", { in: { slug: P(), a: Q(S), b: Q(S), ignoreUi: Q(z.boolean().optional()) }, out: "diff" }, async (args, { controlPlane }) => {
  const slug = str(args.slug, "slug");
  const [a, b] = [await controlPlane.store.getVersion(slug, str(args.a, "a")), await controlPlane.store.getVersion(slug, str(args.b, "b"))];
  if (!a || !b) throw new DomainError("not_found", "one or both versions not found");
  return diffWorkflows(a, b, Boolean(args.ignoreUi));
});

// ── Ops / ports ──

const opListOp = adminOp("admin.op.list", "List all ops (base + mod) with ports + config schema.", { out: "ops" }, (_args, { engine }) => opList(engine));
const opGetOp = adminOp("admin.op.get", "Get one op's definition (config → JSON Schema).", { in: { type: P() }, out: "op" }, (args, { engine }) => {
  const info = opGet(engine, str(args.type, "type"));
  if (!info) throw new DomainError("not_found", "unknown op type");
  return info;
});
const portsCompatibleOp = adminOp("admin.ports.compatible", "Check whether two ports can connect (T2).", { in: { from: Bd(z.unknown()), to: Bd(z.unknown()) }, out: "result" }, (args, { engine }) =>
  portsCompatible(engine, args.from as never, args.to as never),
);

// ── Runs / metrics ──

const runList = adminOp("admin.run.list", "Recent runs from the trace store.", { in: { workflow: Q(z.string().optional()), status: Q(z.string().optional()), limit: Q(z.number().optional()) }, out: "runs" }, (args, { sink }) =>
  sink.list({ workflow: args.workflow as string | undefined, status: args.status as string | undefined, limit: args.limit ? Number(args.limit) : undefined }),
);
const runGet = adminOp("admin.run.get", "One run's spans (+ I/O samples if captured).", { in: { runId: P() }, out: "run" }, async (args, { sink, engine }) => {
  const detail = await sink.get(str(args.runId, "runId"));
  if (!detail) return detail;
  // Live control state: is the run still in flight, and is it paused?
  const paused = engine.runPaused(str(args.runId, "runId"));
  // Sub-runs this run started via ctx.invoke — the "invoked by" link's mirror.
  const children = await sink.children(str(args.runId, "runId"));
  return { ...detail, inflight: paused !== undefined, paused: paused ?? false, children };
});

// ── In-flight run control (cancel works on any entry path; pause needs the
// in-process transport — a worker pool has no pause channel yet) ──
const runCancel = adminOp("admin.run.cancel", "Abort an in-flight run.", { in: { runId: P() }, out: "result" }, (args, { engine }) => ({
  ok: engine.cancelRun(str(args.runId, "runId")),
}));
const runPause = adminOp("admin.run.pause", "Pause an in-flight run: no new node starts; running ops finish.", { in: { runId: P() }, out: "result" }, (args, { engine }) => ({
  ok: engine.pauseRun(str(args.runId, "runId")),
}));
const runResume = adminOp("admin.run.resume", "Resume a paused run.", { in: { runId: P() }, out: "result" }, (args, { engine }) => ({
  ok: engine.resumeRun(str(args.runId, "runId")),
}));
const metricsSummary = adminOp("admin.metrics.summary", "Windowed run/error counters + per-workflow latency.", { in: { window: Q(z.unknown().optional()) }, out: "metrics" }, (args, { sink }) =>
  sink.metrics(args.window ? { minutes: Number((args.window as { minutes?: number }).minutes ?? args.window) } : undefined),
);

/** Live span tail as a stream (wired to an SSE response out-gate). */
const runTail = adminOp(
  "admin.run.tail",
  "Stream live node spans, optionally filtered to a workflow (SSE).",
  { in: { workflow: Q(z.string().optional()) }, out: "events", stream: true },
  (args, { sink }) => sink.tail(args.workflow as string | undefined),
);

// ── Mods / templates ──

const modListOp = adminOp("admin.mod.list", "List installed mods + their contributions.", { out: "mods" }, (_args, { engine }) => modList(engine));
const systemMapOp = adminOp("admin.system.map", "Routes, schedules, hooks, events, WS across registered workflows.", { out: "system" }, (_args, { engine }) => systemMap(engine));
const systemStatsOp = adminOp("admin.system.stats", "Host/process/event-loop/transport snapshot (the Process page; deltas since last poll).", { out: "stats" }, (_args, { engine }) =>
  processStats(engine),
);
const systemBenchOp = adminOp("admin.system.bench", "Worker-efficiency benchmark: the same CPU-bound workload inline vs on a worker pool.", { in: { n: Bd(z.number().optional()), runs: Bd(z.number().optional()), workers: Bd(z.number().optional()) }, out: "benchmark" }, (args) =>
  workerBench({
    n: args.n != null ? Number(args.n) : undefined,
    runs: args.runs != null ? Number(args.runs) : undefined,
    workers: args.workers != null ? Number(args.workers) : undefined,
  }),
);

// ── Server-side admin settings (observability) ──

const settingsGet = adminOp("admin.settings.get", "Server-side admin settings (run retention, exclusion, I/O sampling).", { out: "settings" }, (_args, { sink, engine }) => ({
  observability: { ...sink.config(), sampleIo: engine.ioSampling() },
}));

const settingsSet = adminOp(
  "admin.settings.set",
  "Update server-side admin settings: { capacity?, exclude?, sampleIo? }. Applies live; persisted with the workflow store.",
  { in: { observability: Bd(z.unknown().optional()), capacity: Bd(z.unknown().optional()), exclude: Bd(z.unknown().optional()), sampleIo: Bd(z.unknown().optional()) }, out: "result" },
  async (args, { sink, controlPlane, engine }) => {
    const obs = (args.observability ?? args) as { capacity?: unknown; exclude?: unknown; sampleIo?: unknown };
    if (obs.capacity != null) {
      const n = Number(obs.capacity);
      if (!Number.isFinite(n) || n < 10 || n > 10_000) throw new DomainError("invalid", "capacity must be between 10 and 10000");
      sink.setCapacity(n);
    }
    if (obs.exclude !== undefined) {
      const pattern = obs.exclude === null || obs.exclude === "" ? null : String(obs.exclude);
      try {
        sink.setExclude(pattern);
      } catch (err) {
        throw new DomainError("invalid", `invalid exclude regex: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Sample every run's node I/O (bounded + secret-masked previews, T1) —
    // editor runs always sample; this extends it to host-served traffic.
    if (obs.sampleIo !== undefined) engine.setIoSampling(Boolean(obs.sampleIo));
    const applied = { ...sink.config(), sampleIo: engine.ioSampling() };
    await controlPlane.store.saveAdminConfig({ observability: applied });
    return { ok: true, observability: applied };
  },
);

/** The aggregated frontend manifest (serializable) the shell builds its nav from. */
const uiManifest = adminOp("admin.ui.manifest", "Aggregated frontend manifest (menu, pages, commands).", { out: "manifest" }, (_args, { engine }) => {
  const fe = engine.frontend();
  const pages = (fe.pages ?? []).map((p) => {
    // Mod-controlled header chrome carries through to the shell (admin-spec §6).
    const chrome = { title: p.title, subtitle: p.subtitle, header: p.header };
    if ("view" in p) return { path: p.path, ...chrome, view: p.view };
    if ("views" in p) return { path: p.path, ...chrome, views: p.views };
    if ("remote" in p) return { path: p.path, ...chrome, remote: p.remote };
    return { path: p.path, ...chrome, tier2: true }; // function-loaded; not serializable over HTTP
  });
  // `authProvider` lets the editor tell authors that a declared requireAuth
  // won't actually be enforced until an auth provider (e.g. identity) is added.
  return { menu: fe.menu ?? [], commands: fe.commands ?? [], assets: fe.assets ?? [], pages, settings: fe.settings ?? [], authProvider: engine.hasAuthProvider() };
});
/** Replace non-serializable run outputs (live streams) with a marker. */
function sanitizeOutputs(outputs: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [node, payload] of Object.entries(outputs)) {
    const p: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) p[k] = v instanceof ReadableStream ? "[stream]" : v;
    out[node] = p;
  }
  return out;
}

/**
 * Run a workflow (a draft doc, or a live slug) from a chosen trigger and record
 * the run (§13). Powers "test from the editor". Validates first; runs in-process
 * with I/O sampling so the run replays in the Runs view.
 */
const runOp = adminOp("admin.run", "Run a workflow (draft or live) from a trigger; records the run.", { in: { doc: Bd(objSchema.optional()), slug: Bd(z.string().optional()), trigger: Bd(z.string().optional()), input: Bd(z.unknown().optional()), params: Bd(objSchema.optional()), runId: Bd(z.string().optional()) }, out: "result" }, async (args, { engine }, ctx) => {
  const doc = args.doc as Workflow | undefined;
  const slug = args.slug as string | undefined;
  const raw = doc ?? (slug ? engine.workflows.get(slug) : undefined);
  if (!raw) throw new DomainError("invalid", "provide a `doc` or a known `slug`");
  const { ok, issues } = collectIssues(raw, engine.ops);
  if (!ok) return { ok: false, issues };
  // A draft doc never went through registration — run the resolve phase here so
  // boundary config ports (e.g. a schema wired into http.request's `body`) are
  // frozen in and the run behaves exactly like its deployed self would.
  const wf = doc ? await engine.resolveWorkflowDoc(doc) : raw;
  // A caller-chosen run id lets the UI cancel a run it JUST started (the
  // result — and with it the server-minted id — only arrives at completion).
  const runId = typeof args.runId === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(args.runId) ? args.runId : undefined;
  const res = await engine.run(wf, {
    trigger: args.trigger as string | undefined,
    input: (args.input as Record<string, unknown>) ?? {},
    params: (args.params as Record<string, unknown>) ?? {},
    sampleIo: true,
    runId,
    // Run as the CALLER (§9): editor runs carry the signed-in admin, so a
    // trigger's `user` port behaves exactly like a host-served request.
    principal: ctx.principal,
  });
  return {
    ok: true,
    runId: res.runId,
    status: res.status,
    outputs: sanitizeOutputs(res.outputs),
    error: res.error ? (res.error instanceof Error ? res.error.message : String(res.error)) : undefined,
  };
});

/** Per-node ports for a doc, config-resolved — the editor's dynamic-port source. */
const docPortsOp = adminOp("admin.doc.ports", "Resolve every node's ports against its config (dynamic-port ops).", { in: { doc: Bd(objSchema) }, out: "ports" }, (args, { engine }) => {
  const doc = args.doc as { nodes: Array<{ id: string; op: string; config?: unknown }> } | undefined;
  if (!doc || !Array.isArray(doc.nodes)) throw new DomainError("invalid", 'missing "doc"');
  return docPorts(engine, doc);
});

const templateList = adminOp("admin.template.list", "List built-in workflow templates.", { out: "templates" }, () =>
  builtinTemplates.map((t) => ({ id: t.id, name: t.name, description: t.description, doc: t.doc })),
);

// ── Fixtures ──

const fixtureList = adminOp("admin.fixture.list", "List a workflow's saved test fixtures.", { in: { slug: P() }, out: "fixtures" }, (args, { controlPlane }) => controlPlane.store.listFixtures(str(args.slug, "slug")));
const fixtureGet = adminOp("admin.fixture.get", "Get a saved fixture.", { in: { slug: P(), name: P() }, out: "fixture" }, async (args, { controlPlane }) => {
  const fixture = await controlPlane.store.getFixture(str(args.slug, "slug"), str(args.name, "name"));
  if (!fixture) throw new DomainError("not_found", "fixture not found");
  return fixture;
});
const fixtureSave = adminOp("admin.fixture.save", "Save a test fixture.", { in: { slug: P(), name: P(), fixture: Bd(z.unknown().optional()) }, out: "result" }, async (args, { controlPlane }) => {
  await controlPlane.store.saveFixture(str(args.slug, "slug"), str(args.name, "name"), (args.fixture ?? {}) as never);
  return { ok: true };
});
const fixtureDelete = adminOp("admin.fixture.delete", "Delete a test fixture.", { in: { slug: P(), name: P() }, out: "result" }, async (args, { controlPlane }) => {
  await controlPlane.store.deleteFixture(str(args.slug, "slug"), str(args.name, "name"));
  return { ok: true };
});

// ── The admin app node ──

/**
 * The Pattern Admin application as a graph node (§11): outputs the admin SPA
 * bundle as an app object for `boundary.http.app.serve`. This is "the app the
 * admin mod brings" — drop it on a canvas, wire a `boundary.http.app` trigger
 * in front and the serve out-gate behind, and the host mounts the admin UI.
 */
const adminApp: OpDefinition = {
  type: "admin.app",
  title: "Pattern Admin app",
  description:
    "The Pattern Admin SPA as an app object. Wire `app` into `boundary.http.app.serve` under a " +
    "`boundary.http.app` mount to serve the admin UI.",
  // The one admin op that IS meant for authoring: it represents the app itself.
  reusable: true,
  inputs: {},
  outputs: { app: value(boundaries.appDescriptorSchema) },
  config: z.object({
    /** The filesystem the mod registered its built bundle on. */
    filesystem: z.string().default(ASSETS_FS),
    /** Served on a miss when the client accepts HTML (client-side routing). */
    spaFallback: z.string().default("index.html"),
    /** The admin bundle uses hashed filenames — immutable caching is safe. */
    immutableAssets: z.boolean().default(true),
  }),
  execute: (ctx) => ({ app: { ...(ctx.config as object) } }),
};

async function loadLive(controlPlane: ReturnType<typeof adminServices>["controlPlane"], slug: string): Promise<Workflow | null> {
  const meta = await controlPlane.store.getMeta(slug);
  return meta?.live ? controlPlane.store.getVersion(slug, meta.live) : null;
}

/** Every admin op, contributed by the mod. */
export const adminOps: OpDefinition[] = [
  workflowList,
  workflowGet,
  workflowSave,
  workflowImport,
  workflowSetEnabled,
  workflowDeploy,
  workflowDelete,
  workflowExplain,
  versionList,
  versionGet,
  versionDiff,
  opListOp,
  opGetOp,
  portsCompatibleOp,
  runList,
  runGet,
  runCancel,
  runPause,
  runResume,
  runTail,
  metricsSummary,
  modListOp,
  systemMapOp,
  systemStatsOp,
  systemBenchOp,
  settingsGet,
  settingsSet,
  uiManifest,
  runOp,
  docPortsOp,
  templateList,
  fixtureList,
  fixtureGet,
  fixtureSave,
  fixtureDelete,
  adminApp,
];
