/**
 * @pattern-js/mod-buddy — the turn pipeline (Buddy's backend half).
 *
 * POST /buddy/api/turn → buddy.turn.begin (thread + instructions + model) →
 * agents.agent + the ten pattern_* tools → agents.run → SSE out, while
 * buddy.turn.save persists the updated history back to the thread. The
 * pipeline is an ordinary editable workflow — Buddy is built from Pattern
 * workflows, all the way down.
 *
 * The dock reads tool calls (incl. proposed docs) straight from the SSE
 * turn events: `tool.activity` carries the tool's name and args.
 */

import { fromBody, fromParams, fromQuery, httpEndpoint, value, z, type OpDefinition, type Workflow } from "@pattern-js/core";
import { AGENTS_SERVICE, type AgentsService } from "@pattern-js/mod-agents";
import { BUDDY_INSTRUCTIONS, contextBlock } from "./prompts.js";
import { clearThread, hasThreadStore, loadThread, saveThread } from "./threads.js";
import { CONTROL_PLANE_TOOLS } from "./tools.js";
import type { KnowledgeService } from "./knowledge.js";

const AI_CONFIG_SERVICE = "aiConfig";

interface AiConfigLike {
  aliases(): Array<{ name: string; modality?: string }>;
}

/** The language alias Buddy runs on: "buddy" when configured, else the agent default. */
function buddyModelRef(services: Record<string, unknown>): { alias: string } | undefined {
  const config = services[AI_CONFIG_SERVICE] as AiConfigLike | undefined;
  if (!config || typeof config.aliases !== "function") return undefined;
  const buddy = config.aliases().find((a) => a.name === "buddy" && (a.modality ?? "language") === "language");
  return buddy ? { alias: "buddy" } : undefined;
}

const GLOBAL_SLUG = "~app";

/* ── ops ─────────────────────────────────────────────────────────────────── */

const turnBegin: OpDefinition = {
  type: "buddy.turn.begin",
  title: "buddy.turn.begin",
  description:
    "Start a Buddy turn: load the caller's thread for this workflow, assemble instructions (system prompt + canvas/run " +
    "context), resolve the model (alias \"buddy\" → agent default). Outputs feed agents.agent/agents.run.",
  reusable: false,
  sensitivity: "privileged",
  inputs: {
    message: value(z.string()),
    slug: value(z.string().optional()),
    doc: value(z.record(z.string(), z.unknown()).optional()),
    runId: value(z.string().optional()),
    turnId: value(z.string().optional()),
  },
  outputs: {
    input: value(z.string()),
    history: value(),
    instructions: value(z.string()),
    model: value(),
    turnId: value(z.string()),
    slug: value(z.string()),
  },
  execute: async (ctx) => {
    const [message, slug, doc, runId, turnId] = await Promise.all([
      ctx.input.value<string>("message"),
      ctx.input.has("slug") ? ctx.input.value<string>("slug") : undefined,
      ctx.input.has("doc") ? ctx.input.value<Record<string, unknown>>("doc") : undefined,
      ctx.input.has("runId") ? ctx.input.value<string>("runId") : undefined,
      ctx.input.has("turnId") ? ctx.input.value<string>("turnId") : undefined,
    ]);
    if (!message?.trim()) throw new Error("buddy: an empty message is not a turn");
    const threadSlug = slug?.trim() || GLOBAL_SLUG;
    return {
      input: message,
      history: await loadThread(ctx, threadSlug),
      instructions: BUDDY_INSTRUCTIONS + contextBlock({ slug: slug ?? undefined, doc, runId: runId ?? undefined }),
      model: buddyModelRef(ctx.services),
      turnId: turnId?.trim() || crypto.randomUUID(),
      slug: threadSlug,
    };
  },
};

const turnSave: OpDefinition = {
  type: "buddy.turn.save",
  title: "buddy.turn.save",
  description:
    "Persist a finished turn: agents.run's updated history replaces the thread's messages (CAS-retried). " +
    "Without mod-store this is a graceful no-op — Buddy just stays stateless.",
  reusable: false,
  inputs: { history: value(), slug: value(z.string()) },
  outputs: { saved: value(z.boolean()) },
  execute: async (ctx) => {
    const [history, slug] = await Promise.all([ctx.input.value<unknown[]>("history"), ctx.input.value<string>("slug")]);
    if (!Array.isArray(history)) return { saved: false };
    return { saved: await saveThread(ctx, slug, history) };
  },
};

const turnAbort: OpDefinition = {
  type: "buddy.turn.abort",
  title: "buddy.turn.abort",
  description: "Stop an in-flight Buddy turn by turnId (the dock's Stop button). Idempotent.",
  reusable: false,
  sensitivity: "privileged",
  inputs: { turnId: value(z.string()) },
  outputs: { result: value() },
  execute: async (ctx) => {
    const turnId = await ctx.input.value<string>("turnId");
    const agents = ctx.services[AGENTS_SERVICE] as AgentsService | undefined;
    const aborted = agents?.abortTurn(turnId) ?? false;
    return { result: { ok: true, aborted } };
  },
};

const threadGet: OpDefinition = {
  type: "buddy.thread.get",
  title: "buddy.thread.get",
  description: "The caller's Buddy thread for a workflow slug: { messages } (empty without mod-store).",
  reusable: false,
  sensitivity: "privileged",
  inputs: { slug: value(z.string().optional()) },
  outputs: { thread: value() },
  execute: async (ctx) => {
    const slug = ctx.input.has("slug") ? await ctx.input.value<string>("slug") : undefined;
    const messages = await loadThread(ctx, slug?.trim() || GLOBAL_SLUG);
    return { thread: { slug: slug?.trim() || GLOBAL_SLUG, messages, persistent: hasThreadStore(ctx.services) } };
  },
};

const threadClear: OpDefinition = {
  type: "buddy.thread.clear",
  title: "buddy.thread.clear",
  description: "Forget the caller's Buddy thread for a workflow slug (the dock's New conversation).",
  reusable: false,
  sensitivity: "privileged",
  inputs: { slug: value(z.string().optional()) },
  outputs: { result: value() },
  execute: async (ctx) => {
    const slug = ctx.input.has("slug") ? await ctx.input.value<string>("slug") : undefined;
    return { result: { ok: true, cleared: await clearThread(ctx, slug?.trim() || GLOBAL_SLUG) } };
  },
};

/** The dock's boot probe: what Buddy can do in THIS app. */
export function statusOp(knowledge: () => KnowledgeService): OpDefinition {
  return {
    type: "buddy.status",
    title: "buddy.status",
    description:
      "Buddy's capabilities in this app: tool count, model alias in use, semantic-vs-lexical knowledge, thread persistence.",
    reusable: false,
    sensitivity: "privileged",
    inputs: {},
    outputs: { status: value() },
    execute: async (ctx) => ({
      status: {
        ok: true,
        tools: CONTROL_PLANE_TOOLS.length,
        model: buddyModelRef(ctx.services)?.alias ?? "default",
        knowledge: knowledge().isSemantic() ? "semantic" : "lexical",
        threads: hasThreadStore(ctx.services),
      },
    }),
  };
}

export function turnOps(knowledge: () => KnowledgeService): OpDefinition[] {
  return [turnBegin, turnSave, turnAbort, threadGet, threadClear, statusOp(knowledge)];
}

/* ── the pipeline + routes ───────────────────────────────────────────────── */

const admin = { scopes: ["admin"] };

/** POST /buddy/api/turn → SSE turn events (the dock's one streaming call). */
export function turnPipelineWorkflow(): Workflow {
  return {
    id: "buddy.turn",
    name: "Buddy · turn pipeline",
    description:
      "A Buddy turn: message + editor context in → thread + instructions assembled → the agent runs with the ten " +
      "pattern_* control-plane tools → turn events stream out (SSE) while the thread persists. Edit me to reshape " +
      "Buddy — it is a workflow like any other.",
    source: "code",
    nodes: [
      {
        id: "in",
        op: "boundary.http.request",
        config: { method: "POST", path: "/buddy/api/turn", requireAuth: admin },
        ui: { x: 40, y: 200, pair: "ok" },
      },
      {
        id: "ex_body",
        op: "core.object.extract",
        config: { keys: ["message", "slug", "doc", "runId", "turnId"] },
        ui: { x: 280, y: 200 },
      },
      {
        id: "begin",
        op: "buddy.turn.begin",
        comment: "Thread + system prompt + canvas/run context + model resolution.",
        ui: { x: 540, y: 200 },
      },
      {
        id: "tools",
        op: "agents.tools.workflows",
        config: { tools: CONTROL_PLANE_TOOLS },
        comment: "The ten restricted pattern_* tools, by explicit name.",
        ui: { x: 800, y: 40 },
      },
      {
        id: "agent",
        op: "agents.agent",
        config: { name: "Buddy", instructions: "(overridden per turn by buddy.turn.begin)" },
        ui: { x: 1060, y: 120 },
      },
      {
        id: "run",
        op: "agents.run",
        config: { maxTurns: 16 },
        comment: "Streams turn events; tool calls are linked sub-runs.",
        ui: { x: 1320, y: 200 },
      },
      {
        id: "save",
        op: "buddy.turn.save",
        comment: "The updated history replaces the thread (CAS).",
        ui: { x: 1580, y: 60 },
      },
      { id: "ok", op: "boundary.http.response", config: { mode: "sse" }, ui: { x: 1580, y: 280, pair: "in" } },
    ],
    edges: [
      { from: { node: "in", port: "body" }, to: { node: "ex_body", port: "object" } },
      { from: { node: "ex_body", port: "message" }, to: { node: "begin", port: "message" } },
      { from: { node: "ex_body", port: "slug" }, to: { node: "begin", port: "slug" } },
      { from: { node: "ex_body", port: "doc" }, to: { node: "begin", port: "doc" } },
      { from: { node: "ex_body", port: "runId" }, to: { node: "begin", port: "runId" } },
      { from: { node: "ex_body", port: "turnId" }, to: { node: "begin", port: "turnId" } },
      // Control-thread the collector + the SSE gate onto the begin path (an
      // out-gate with only a stream input would otherwise capture instantly).
      { from: { node: "begin", port: "out" }, to: { node: "tools", port: "in" } },
      { from: { node: "begin", port: "out" }, to: { node: "ok", port: "in" } },
      { from: { node: "tools", port: "toolset" }, to: { node: "agent", port: "tools" } },
      { from: { node: "begin", port: "instructions" }, to: { node: "agent", port: "instructions" } },
      { from: { node: "begin", port: "model" }, to: { node: "agent", port: "model" } },
      { from: { node: "agent", port: "agent" }, to: { node: "run", port: "agent" } },
      { from: { node: "begin", port: "input" }, to: { node: "run", port: "input" } },
      { from: { node: "begin", port: "history" }, to: { node: "run", port: "history" } },
      { from: { node: "begin", port: "turnId" }, to: { node: "run", port: "turnId" } },
      { from: { node: "run", port: "events" }, to: { node: "ok", port: "stream" } },
      { from: { node: "run", port: "history" }, to: { node: "save", port: "history" } },
      { from: { node: "begin", port: "slug" }, to: { node: "save", port: "slug" } },
    ],
  };
}

/** The dock's plumbing routes (thread load/clear, stop, status). */
export function buddyRoutes(): Workflow[] {
  return [
    httpEndpoint({
      id: "buddy.route.thread.get",
      name: "Buddy · GET /buddy/api/thread",
      method: "GET",
      path: "/buddy/api/thread",
      op: "buddy.thread.get",
      io: { in: { slug: fromQuery() }, out: "thread" },
      auth: admin,
    }),
    httpEndpoint({
      id: "buddy.route.thread.clear",
      name: "Buddy · POST /buddy/api/thread/clear",
      method: "POST",
      path: "/buddy/api/thread/clear",
      op: "buddy.thread.clear",
      io: { in: { slug: fromBody() }, out: "result" },
      auth: admin,
    }),
    httpEndpoint({
      id: "buddy.route.turn.abort",
      name: "Buddy · POST /buddy/api/turn/:turnId/abort",
      method: "POST",
      path: "/buddy/api/turn/:turnId/abort",
      op: "buddy.turn.abort",
      io: { in: { turnId: fromParams() }, out: "result" },
      auth: admin,
    }),
    httpEndpoint({
      id: "buddy.route.status",
      name: "Buddy · GET /buddy/api/status",
      method: "GET",
      path: "/buddy/api/status",
      op: "buddy.status",
      io: { out: "status" },
      auth: admin,
    }),
  ];
}
