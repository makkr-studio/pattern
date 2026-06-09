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
  collectIssues,
  resolvePorts,
  stream,
  value,
  z,
  type OpContext,
  type OpDefinition,
  type Workflow,
} from "@pattern/core";
import { adminServices } from "../services.js";
import { catalog, explain, modList, opGet, opList, portsCompatible, safeNodeConfigs, systemMap } from "../introspect.js";
import { diffWorkflows } from "../control-plane/versioning.js";
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
  catalog(engine, controlPlane.store),
);

const workflowGet = adminOp("admin.workflow.get", "Get a workflow's meta + live doc (+ draft).", async (args, { engine, controlPlane }) => {
  const slug = str(args.slug, "slug");
  const metas = await catalog(engine, controlPlane.store);
  const meta = metas.find((m) => m.slug === slug) ?? null;
  let liveDoc: Workflow | null = null;
  if (meta?.source === "code") {
    liveDoc = engine.workflows.get(slug) ?? null;
  } else if (meta?.live) {
    liveDoc = await controlPlane.store.getVersion(slug, meta.live);
  }
  // Redact secrets in the live doc's node configs (P4) where it is registered.
  const safeConfigs = engine.workflows.has(slug) ? safeNodeConfigs(engine, slug) : undefined;
  return { meta, liveDoc, safeConfigs };
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
  const issues = collectIssues(raw, engine.ops).issues;
  const slug = raw.id;
  if (!issues.length) {
    await controlPlane.store.saveVersion(slug, { ...raw, source: "file" }, { note: "imported" });
  }
  return { slug, issues };
});

const workflowSetEnabled = adminOp("admin.workflow.setEnabled", "Enable (register) or disable (unregister) a workflow.", async (args, { controlPlane }) => {
  const slug = str(args.slug, "slug");
  const enabled = Boolean(args.enabled);
  if (enabled) {
    const meta = await controlPlane.store.getMeta(slug);
    if (!meta?.live) throw new Error(`"${slug}" has no live version to enable`);
    const res = await controlPlane.deploy(slug, meta.live);
    return { ok: res.ok, ...(res.ok ? {} : { conflicts: res.conflicts }) };
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
const runGet = adminOp("admin.run.get", "One run's spans (+ I/O samples if captured).", (args, { sink }) => sink.get(str(args.runId, "runId")));
const metricsSummary = adminOp("admin.metrics.summary", "Windowed run/error counters + per-workflow latency.", (args, { sink }) =>
  sink.metrics(args.window ? { minutes: Number((args.window as { minutes?: number }).minutes ?? args.window) } : undefined),
);

/** Live span tail as a stream (wired to an SSE response out-gate). */
const runTail: OpDefinition = {
  type: "admin.run.tail",
  title: "admin.run.tail",
  description: "Stream live node spans, optionally filtered to a workflow (SSE).",
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

/** The aggregated frontend manifest (serializable) the shell builds its nav from. */
const uiManifest = adminOp("admin.ui.manifest", "Aggregated frontend manifest (menu, pages, commands).", (_args, { engine }) => {
  const fe = engine.frontend();
  const pages = (fe.pages ?? []).map((p) => {
    if ("view" in p) return { path: p.path, view: p.view };
    if ("remote" in p) return { path: p.path, remote: p.remote };
    return { path: p.path, tier2: true }; // function-loaded; not serializable over HTTP
  });
  return { menu: fe.menu ?? [], commands: fe.commands ?? [], assets: fe.assets ?? [], pages };
});
/**
 * Run a "source" op one-shot and return its output — the data backend for
 * declarative pages (§6). Wraps the op in a synthetic manual→op→return workflow
 * so any catalog op can feed a table/chart/json view.
 */
const invokeOp = adminOp("admin.invoke", "Run a source op once and return its output (backs declarative pages).", async (args, { engine }) => {
  const source = str(args.source, "source");
  const op = engine.ops.get(source);
  if (!op) throw new Error(`unknown op "${source}"`);
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
  const res = await engine.run(wf, { trigger: "t", input: { input: args.input } });
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
const runOp = adminOp("admin.run", "Run a workflow (draft or live) from a trigger; records the run.", async (args, { engine }) => {
  const doc = args.doc as Workflow | undefined;
  const slug = args.slug as string | undefined;
  const wf = doc ?? (slug ? engine.workflows.get(slug) : undefined);
  if (!wf) throw new Error("provide a `doc` or a known `slug`");
  const issues = collectIssues(wf, engine.ops).issues;
  if (issues.length) return { ok: false, issues };
  const res = await engine.run(wf, {
    trigger: args.trigger as string | undefined,
    input: (args.input as Record<string, unknown>) ?? {},
    params: (args.params as Record<string, unknown>) ?? {},
    sampleIo: true,
  });
  return {
    ok: true,
    runId: res.runId,
    status: res.status,
    outputs: sanitizeOutputs(res.outputs),
    error: res.error ? (res.error instanceof Error ? res.error.message : String(res.error)) : undefined,
  };
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
  runTail,
  metricsSummary,
  modListOp,
  systemMapOp,
  uiManifest,
  invokeOp,
  runOp,
  templateList,
  fixtureList,
  fixtureGet,
  fixtureSave,
  fixtureDelete,
];
