/**
 * @pattern/mod-admin — the `admin.*` op catalog (mod-admin-spec §10).
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
  resolvePorts,
  stream,
  value,
  z,
  type OpContext,
  type OpDefinition,
  type Workflow,
} from "@pattern/core";
import { adminServices, ASSETS_FS } from "../services.js";
import { processStats, workerBench } from "../system-stats.js";
import { catalog, docPorts, explain, modList, opGet, opList, portsCompatible, safeNodeConfigs, systemMap } from "../introspect.js";
import { diffWorkflows } from "../control-plane/versioning.js";
import { safeSegment } from "../control-plane/store.js";
import { builtinTemplates } from "../templates.js";

const recordSchema = z.record(z.string(), z.unknown());

/** Merge an HTTP request's query/params/body into one args object. */
function mergeArgs(query: unknown, params: unknown, body: unknown): Record<string, unknown> {
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const bodyObj = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : body === undefined ? {} : { body };
  return { ...obj(query), ...obj(params), ...bodyObj };
}

type Handler = (args: Record<string, unknown>, backend: ReturnType<typeof adminServices>, ctx: OpContext) => unknown | Promise<unknown>;

/**
 * Build an admin op: optional `params`/`query`/`body` value inputs (wired from an
 * HTTP trigger), a single `out` value output, and a handler over the merged args.
 */
function adminOp(type: string, description: string, handler: Handler): OpDefinition {
  return {
    type,
    title: type,
    description,
    // Control-plane internals — usable, but de-emphasized in the authoring palette.
    reusable: false,
    inputs: {
      params: value(recordSchema),
      query: value(recordSchema),
      body: value(z.unknown()),
    },
    outputs: { out: value() },
    execute: async (ctx) => {
      const [params, query, body] = await Promise.all([
        ctx.input.value("params"),
        ctx.input.value("query"),
        ctx.input.value("body"),
      ]);
      const args = mergeArgs(query, params, body);
      return { out: await handler(args, adminServices(ctx), ctx) };
    },
  };
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v) throw new Error(`missing "${name}"`);
  return v;
};

// ── Workflows ──

const workflowList = adminOp("admin.workflow.list", "List all workflows (code + stored), with provenance + versions.", (_args, { engine, controlPlane }) =>
  catalog(engine, controlPlane.store, parkedCode),
);

const workflowGet = adminOp("admin.workflow.get", "Get a workflow's meta + live doc (+ latest saved version).", async (args, { engine, controlPlane }) => {
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

const workflowSave = adminOp("admin.workflow.save", "Validate a doc + mint an immutable version snapshot.", async (args, { controlPlane, engine }) => {
  const slug = str(args.slug, "slug");
  const doc = args.doc as Workflow;
  if (!doc || typeof doc !== "object") throw new Error('missing "doc"');
  const issues = collectIssues(doc, engine.ops).issues;
  if (issues.length) return { issues };
  const version = await controlPlane.store.saveVersion(slug, { ...doc, source: "file" }, { note: args.note as string | undefined });
  return { version, issues: [] };
});

const workflowImport = adminOp("admin.workflow.import", "Import a workflow JSON → validate → new file workflow.", async (args, { controlPlane, engine }) => {
  const raw = typeof args.json === "string" ? (JSON.parse(args.json) as Workflow) : (args.json as Workflow);
  if (!raw || typeof raw !== "object" || !raw.id) throw new Error("invalid workflow JSON (needs an id)");
  // The imported id becomes a storage path segment — reject path-like ids here
  // with a friendly message (the store re-checks as a backstop).
  const slug = safeSegment(raw.id, "workflow id");
  const issues = collectIssues(raw, engine.ops).issues;
  if (!issues.length) {
    await controlPlane.store.saveVersion(slug, { ...raw, source: "file" }, { note: "imported" });
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

const workflowSetEnabled = adminOp("admin.workflow.setEnabled", "Enable (register) or disable/undeploy (unregister) a workflow — code ones park until restart.", async (args, { controlPlane, engine }) => {
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
    if (!meta?.live) throw new Error(`"${slug}" has no live version to enable`);
    const res = await controlPlane.deploy(slug, meta.live);
    return { ok: res.ok, ...(res.ok ? {} : { conflicts: res.conflicts }) };
  }
  // Undeploy. A code workflow has no store meta — park its doc (so it can come
  // back without a restart) and unregister: routes/schedules drop immediately.
  const meta = await controlPlane.store.getMeta(slug);
  if (!meta) {
    const doc = engine.workflows.get(slug);
    if (!doc) throw new Error(`workflow "${slug}" not found`);
    parkedCode.set(slug, doc);
    engine.unregisterWorkflow(slug);
    return { ok: true };
  }
  await controlPlane.disable(slug);
  return { ok: true };
});

const workflowDeploy = adminOp("admin.workflow.deploy", "Activate a version (route-conflict checked).", (args, { controlPlane }) =>
  controlPlane.deploy(str(args.slug, "slug"), str(args.version, "version"), { swap: Boolean(args.swap) }),
);

const workflowDelete = adminOp("admin.workflow.delete", "Disable + remove a workflow from the store.", async (args, { controlPlane }) => {
  const slug = str(args.slug, "slug");
  await controlPlane.disable(slug).catch(() => {});
  await controlPlane.store.delete(slug);
  return { ok: true };
});

const workflowExplain = adminOp("admin.workflow.explain", "Deterministic structural summary of a workflow.", async (args, { engine, controlPlane }) => {
  const slug = str(args.slug, "slug");
  const doc = engine.workflows.get(slug) ?? (await loadLive(controlPlane, slug));
  if (!doc) throw new Error(`workflow "${slug}" not found`);
  return { text: explain(engine, doc) };
});

// ── Versions ──

const versionList = adminOp("admin.version.list", "List a workflow's version history.", async (args, { controlPlane }) => {
  const meta = await controlPlane.store.getMeta(str(args.slug, "slug"));
  return meta?.versions ?? [];
});

const versionGet = adminOp("admin.version.get", "Get a specific version snapshot.", (args, { controlPlane }) =>
  controlPlane.store.getVersion(str(args.slug, "slug"), str(args.v, "v")),
);

const versionDiff = adminOp("admin.version.diff", "Structural JSON diff between two versions.", async (args, { controlPlane }) => {
  const slug = str(args.slug, "slug");
  const [a, b] = [await controlPlane.store.getVersion(slug, str(args.a, "a")), await controlPlane.store.getVersion(slug, str(args.b, "b"))];
  if (!a || !b) throw new Error("one or both versions not found");
  return diffWorkflows(a, b, Boolean(args.ignoreUi));
});

// ── Ops / ports ──

const opListOp = adminOp("admin.op.list", "List all ops (base + mod) with ports + config schema.", (_args, { engine }) => opList(engine));
const opGetOp = adminOp("admin.op.get", "Get one op's definition (config → JSON Schema).", (args, { engine }) => opGet(engine, str(args.type, "type")));
const portsCompatibleOp = adminOp("admin.ports.compatible", "Check whether two ports can connect (T2).", (args, { engine }) =>
  portsCompatible(engine, args.from as never, args.to as never),
);

// ── Runs / metrics ──

const runList = adminOp("admin.run.list", "Recent runs from the in-memory sink.", (args, { sink }) =>
  sink.list({ workflow: args.workflow as string | undefined, status: args.status as string | undefined, limit: args.limit ? Number(args.limit) : undefined }),
);
const runGet = adminOp("admin.run.get", "One run's spans (+ I/O samples if captured).", (args, { sink, engine }) => {
  const detail = sink.get(str(args.runId, "runId"));
  if (!detail) return detail;
  // Live control state: is the run still in flight, and is it paused?
  const paused = engine.runPaused(str(args.runId, "runId"));
  // Sub-runs this run started via ctx.invoke — the "invoked by" link's mirror.
  const children = sink.children(str(args.runId, "runId"));
  return { ...detail, inflight: paused !== undefined, paused: paused ?? false, children };
});

// ── In-flight run control (cancel works on any entry path; pause needs the
// in-process transport — a worker pool has no pause channel yet) ──
const runCancel = adminOp("admin.run.cancel", "Abort an in-flight run.", (args, { engine }) => ({
  ok: engine.cancelRun(str(args.runId, "runId")),
}));
const runPause = adminOp("admin.run.pause", "Pause an in-flight run: no new node starts; running ops finish.", (args, { engine }) => ({
  ok: engine.pauseRun(str(args.runId, "runId")),
}));
const runResume = adminOp("admin.run.resume", "Resume a paused run.", (args, { engine }) => ({
  ok: engine.resumeRun(str(args.runId, "runId")),
}));
const metricsSummary = adminOp("admin.metrics.summary", "Windowed run/error counters + per-workflow latency.", (args, { sink }) =>
  sink.metrics(args.window ? { minutes: Number((args.window as { minutes?: number }).minutes ?? args.window) } : undefined),
);

/** Live span tail as a stream (wired to an SSE response out-gate). */
const runTail: OpDefinition = {
  type: "admin.run.tail",
  title: "admin.run.tail",
  description: "Stream live node spans, optionally filtered to a workflow (SSE).",
  reusable: false,
  inputs: { params: value(recordSchema), query: value(recordSchema), body: value(z.unknown()) },
  outputs: { out: stream() },
  execute: async (ctx) => {
    const [params, query] = await Promise.all([ctx.input.value("params"), ctx.input.value("query")]);
    const args = mergeArgs(query, params, undefined);
    return { out: adminServices(ctx).sink.tail(args.workflow as string | undefined) };
  },
};

// ── Mods / templates ──

const modListOp = adminOp("admin.mod.list", "List installed mods + their contributions.", (_args, { engine }) => modList(engine));
const systemMapOp = adminOp("admin.system.map", "Routes, schedules, hooks, events, WS across registered workflows.", (_args, { engine }) => systemMap(engine));
const systemStatsOp = adminOp("admin.system.stats", "Host/process/event-loop/transport snapshot (the Process page; deltas since last poll).", (_args, { engine }) =>
  processStats(engine),
);
const systemBenchOp = adminOp("admin.system.bench", "Worker-efficiency benchmark: the same CPU-bound workload inline vs on a worker pool.", (args) =>
  workerBench({
    n: args.n != null ? Number(args.n) : undefined,
    runs: args.runs != null ? Number(args.runs) : undefined,
    workers: args.workers != null ? Number(args.workers) : undefined,
  }),
);

// ── Server-side admin settings (observability) ──

const settingsGet = adminOp("admin.settings.get", "Server-side admin settings (run retention, exclusion, I/O sampling).", (_args, { sink, engine }) => ({
  observability: { ...sink.config(), sampleIo: engine.ioSampling() },
}));

const settingsSet = adminOp(
  "admin.settings.set",
  "Update server-side admin settings: { capacity?, exclude?, sampleIo? }. Applies live; persisted with the workflow store.",
  async (args, { sink, controlPlane, engine }) => {
    const obs = (args.observability ?? args) as { capacity?: unknown; exclude?: unknown; sampleIo?: unknown };
    if (obs.capacity != null) {
      const n = Number(obs.capacity);
      if (!Number.isFinite(n) || n < 10 || n > 10_000) throw new Error("capacity must be between 10 and 10000");
      sink.setCapacity(n);
    }
    if (obs.exclude !== undefined) {
      const pattern = obs.exclude === null || obs.exclude === "" ? null : String(obs.exclude);
      try {
        sink.setExclude(pattern);
      } catch (err) {
        throw new Error(`invalid exclude regex: ${err instanceof Error ? err.message : String(err)}`);
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
const uiManifest = adminOp("admin.ui.manifest", "Aggregated frontend manifest (menu, pages, commands).", (_args, { engine }) => {
  const fe = engine.frontend();
  const pages = (fe.pages ?? []).map((p) => {
    if ("view" in p) return { path: p.path, view: p.view };
    if ("views" in p) return { path: p.path, views: p.views };
    if ("remote" in p) return { path: p.path, remote: p.remote };
    return { path: p.path, tier2: true }; // function-loaded; not serializable over HTTP
  });
  return { menu: fe.menu ?? [], commands: fe.commands ?? [], assets: fe.assets ?? [], pages, settings: fe.settings ?? [] };
});
/**
 * Run a "source" op one-shot and return its output — the data backend for
 * declarative pages (§6). Wraps the op in a synthetic manual→op→return workflow
 * so any catalog op can feed a table/chart/json view.
 */
const invokeOp = adminOp("admin.invoke", "Run a source op once and return its output (backs declarative pages).", async (args, { engine }, ctx) => {
  const source = str(args.source, "source");
  const op = engine.ops.get(source);
  if (!op) throw new Error(`unknown op "${source}"`);
  // ACL: this endpoint backs declarative-page *data sources*. Refuse control-plane
  // internals (every `admin.*` op mutates or reads privileged state — the purpose-
  // built routes own those), boundaries (meaningless to invoke), and any op an
  // author marked `reusable: false` (declared "not meant to be wired arbitrarily").
  if (source.startsWith("admin.") || source.startsWith("boundary.") || op.reusable === false) {
    throw new Error(`op "${source}" cannot be invoked as a page data source`);
  }
  const valueInputs = Object.entries(resolvePorts(op.inputs, {})).filter(([, s]) => s.kind === "value").map(([n]) => n);
  const firstOut = Object.keys(resolvePorts(op.outputs, {}))[0] ?? "out";
  const wf: Workflow = {
    id: `__invoke_${source}`,
    nodes: [
      { id: "t", op: "boundary.manual", config: { outputs: ["input"] } },
      { id: "s", op: source },
      { id: "r", op: "boundary.return" },
    ],
    edges: [
      { from: { node: "t", port: "out" }, to: { node: "s", port: "in" } },
      ...valueInputs.map((p) => ({ from: { node: "t", port: "input" }, to: { node: "s", port: p } })),
      { from: { node: "s", port: firstOut }, to: { node: "r", port: "value" } },
    ],
  };
  // Run as the CALLER's principal: ops guarding scopes in-op (e.g. identity.*)
  // see who's really asking, not an anonymous synthetic run.
  const res = await engine.run(wf, { trigger: "t", input: { input: args.input }, principal: ctx.principal });
  if (res.status === "error") throw res.error;
  return (Object.values(res.outputs)[0] as { value?: unknown } | undefined)?.value ?? null;
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
const runOp = adminOp("admin.run", "Run a workflow (draft or live) from a trigger; records the run.", async (args, { engine }, ctx) => {
  const doc = args.doc as Workflow | undefined;
  const slug = args.slug as string | undefined;
  const raw = doc ?? (slug ? engine.workflows.get(slug) : undefined);
  if (!raw) throw new Error("provide a `doc` or a known `slug`");
  const issues = collectIssues(raw, engine.ops).issues;
  if (issues.length) return { ok: false, issues };
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
const docPortsOp = adminOp("admin.doc.ports", "Resolve every node's ports against its config (dynamic-port ops).", (args, { engine }) => {
  const doc = args.doc as { nodes: Array<{ id: string; op: string; config?: unknown }> } | undefined;
  if (!doc || !Array.isArray(doc.nodes)) throw new Error('missing "doc"');
  return docPorts(engine, doc);
});

const templateList = adminOp("admin.template.list", "List built-in workflow templates.", () =>
  builtinTemplates.map((t) => ({ id: t.id, name: t.name, description: t.description, doc: t.doc })),
);

// ── Fixtures ──

const fixtureList = adminOp("admin.fixture.list", "List a workflow's saved test fixtures.", (args, { controlPlane }) => controlPlane.store.listFixtures(str(args.slug, "slug")));
const fixtureGet = adminOp("admin.fixture.get", "Get a saved fixture.", (args, { controlPlane }) => controlPlane.store.getFixture(str(args.slug, "slug"), str(args.name, "name")));
const fixtureSave = adminOp("admin.fixture.save", "Save a test fixture.", async (args, { controlPlane }) => {
  await controlPlane.store.saveFixture(str(args.slug, "slug"), str(args.name, "name"), (args.fixture ?? {}) as never);
  return { ok: true };
});
const fixtureDelete = adminOp("admin.fixture.delete", "Delete a test fixture.", async (args, { controlPlane }) => {
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
  invokeOp,
  runOp,
  docPortsOp,
  templateList,
  fixtureList,
  fixtureGet,
  fixtureSave,
  fixtureDelete,
  adminApp,
];
