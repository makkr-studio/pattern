/**
 * @pattern/mod-chat — the shipped workflows.
 *
 * CRUD routes are thin `http.request → chat.* → http.response` wirings. The
 * interesting two are PIPELINES with the agent in the visible middle:
 *
 *   turn:    begin ─ok→ tools → agent → run ─events→ SSE response
 *                 │                      └─events→ sink (store + notify)
 *                 └conflict→ 409 response
 *
 *   approve: same shape, with agents.run.resume continuing an interrupted
 *            turn from its stored stateToken.
 *
 * Fork `chat.turn.pipeline` in the admin (and disable the built-in from the
 * catalog) to rewire the middle: swap models, add guardrails, compaction,
 * more toolsets — it's just a workflow.
 */

import type { Workflow } from "@pattern/core";
import type { ResolvedChatOptions } from "./options.js";

interface RouteSpec {
  id: string;
  method: string;
  path: string;
  op: string;
}

function route(spec: RouteSpec, requireAuth?: unknown): Workflow {
  return {
    id: spec.id,
    name: `Chat · ${spec.method} ${spec.path}`,
    source: "code",
    nodes: [
      {
        id: "in",
        op: "boundary.http.request",
        config: { method: spec.method, path: spec.path, ...(requireAuth !== undefined ? { requireAuth } : {}) },
      },
      { id: "call", op: spec.op },
      { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
    ],
    edges: [
      { from: { node: "in", port: "params" }, to: { node: "call", port: "params" } },
      { from: { node: "in", port: "query" }, to: { node: "call", port: "query" } },
      { from: { node: "in", port: "body" }, to: { node: "call", port: "body" } },
      { from: { node: "in", port: "headers" }, to: { node: "call", port: "headers" } },
      { from: { node: "in", port: "user" }, to: { node: "call", port: "user" } },
      { from: { node: "call", port: "status" }, to: { node: "out", port: "status" } },
      { from: { node: "call", port: "headers" }, to: { node: "out", port: "headers" } },
      { from: { node: "call", port: "body" }, to: { node: "out", port: "body" } },
    ],
  };
}

export function crudWorkflows(opts: ResolvedChatOptions): Workflow[] {
  const api = `${opts.mount}/api`;
  const specs: RouteSpec[] = [
    { id: "chat.route.conversations.create", method: "POST", path: `${api}/conversations`, op: "chat.conversations.create" },
    { id: "chat.route.conversations.list", method: "GET", path: `${api}/conversations`, op: "chat.conversations.list" },
    { id: "chat.route.conversations.get", method: "GET", path: `${api}/conversations/:id`, op: "chat.conversations.get" },
    { id: "chat.route.conversations.delete", method: "DELETE", path: `${api}/conversations/:id`, op: "chat.conversations.delete" },
    { id: "chat.route.turns.list", method: "GET", path: `${api}/conversations/:id/turns`, op: "chat.turns.list" },
    { id: "chat.route.turn.stop", method: "POST", path: `${api}/conversations/:id/turns/:turnId/stop`, op: "chat.turn.stop" },
  ];
  return [
    // /me is ALWAYS open: it answers "who am I / is auth required?" so the
    // SPA can render its own sign-in instead of bouncing off a raw 401.
    route({ id: "chat.route.me", method: "GET", path: `${api}/me`, op: "chat.me" }),
    ...specs.map((s) => route(s, opts.requireAuth)),
  ];
}

/** POST {mount}/api/blobs — raw bytes in (streamed), blob id out. Pure wiring. */
export function blobUploadWorkflow(opts: ResolvedChatOptions): Workflow {
  return {
    id: "chat.route.blobs",
    name: `Chat · POST ${opts.mount}/api/blobs`,
    source: "code",
    nodes: [
      {
        id: "in",
        op: "boundary.http.request",
        config: {
          method: "POST",
          path: `${opts.mount}/api/blobs`,
          bodyMode: "stream",
          ...(opts.requireAuth !== undefined ? { requireAuth: opts.requireAuth } : {}),
        },
      },
      { id: "mime", op: "core.object.get", config: { path: "content-type" } },
      { id: "put", op: "store.blob.put" },
      { id: "build", op: "core.object.build", config: { keys: ["id", "meta"] } },
      { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
    ],
    edges: [
      { from: { node: "in", port: "headers" }, to: { node: "mime", port: "object" } },
      { from: { node: "in", port: "body" }, to: { node: "put", port: "bytes" } },
      { from: { node: "mime", port: "out" }, to: { node: "put", port: "mime" } },
      { from: { node: "put", port: "id" }, to: { node: "build", port: "id" } },
      { from: { node: "put", port: "meta" }, to: { node: "build", port: "meta" } },
      { from: { node: "build", port: "out" }, to: { node: "out", port: "body" } },
    ],
  };
}

/** The tool name the guardrail node resolves, and this workflow declares. */
export const GUARDRAIL_TOOL_NAME = "professional_conduct";

/**
 * The professional-conduct guardrail: a `boundary.tool` workflow (marked
 * `guardrail: true` so it's NOT offered to the model as a callable tool) that
 * runs a small classifier model on the user's message and returns
 * `{ tripwire, info }`. `agents.guardrail` wraps it; a trip surfaces as an
 * inline card in the chat instead of an answer. Always shipped; the turn
 * pipeline only WIRES it when `opts.guardrail.enabled`.
 */
export function guardrailToolWorkflow(opts: ResolvedChatOptions): Workflow {
  return {
    id: "chat.guardrail.professional",
    name: "Chat · guardrail · professional conduct",
    description:
      "Input guardrail: a small model decides whether the user's message raises a subject not permitted in a " +
      "professional environment. Returns { tripwire, info }. Wired into the turn pipeline when CHAT_GUARDRAIL is on.",
    source: "code",
    nodes: [
      {
        id: "in",
        op: "boundary.tool",
        config: {
          name: GUARDRAIL_TOOL_NAME,
          description: "Classify whether a message is appropriate for a professional environment.",
          guardrail: true,
          params: {
            type: "object",
            properties: {
              input: { type: "string", description: "The message to classify." },
              direction: { type: "string", description: "input | output" },
            },
            required: ["input"],
          },
        },
        ui: { x: 40, y: 160, pair: "out" },
      },
      {
        id: "text",
        op: "core.object.get",
        config: { path: "input" },
        comment: "Pull the message text out of the guardrail args.",
        ui: { x: 300, y: 160 },
      },
      {
        id: "agent",
        op: "agents.agent",
        config: { name: "Conduct classifier", instructions: opts.guardrail.instructions, model: opts.guardrail.model },
        comment: "Small, fast classifier (gpt-4.1-mini by default). Replies ALLOW or BLOCK: <reason>.",
        ui: { x: 300, y: 340 },
      },
      {
        id: "run",
        op: "agents.run",
        comment: "One-shot classification; apiKey resolves from env/vault like the main run.",
        ui: { x: 560, y: 240 },
      },
      { id: "upper", op: "core.string.upper", comment: "Case-fold the verdict.", ui: { x: 820, y: 120 } },
      { id: "flag", op: "core.const.json", config: { value: "BLOCK" }, comment: "The trip token to look for.", ui: { x: 820, y: 280 } },
      {
        id: "verdict",
        op: "core.string.includes",
        comment: "tripwire = the verdict contains BLOCK (fails open: no BLOCK ⇒ allowed).",
        ui: { x: 1060, y: 160 },
      },
      {
        id: "result",
        op: "core.object.build",
        config: { keys: ["tripwire", "info"] },
        comment: "{ tripwire, info } — info carries the model's one-line reason for the chat card.",
        ui: { x: 1300, y: 240 },
      },
      { id: "out", op: "boundary.tool.return", ui: { x: 1540, y: 240, pair: "in" } },
    ],
    edges: [
      { from: { node: "in", port: "args" }, to: { node: "text", port: "object" } },
      { from: { node: "text", port: "out" }, to: { node: "run", port: "input" } },
      { from: { node: "agent", port: "agent" }, to: { node: "run", port: "agent" } },
      { from: { node: "run", port: "output" }, to: { node: "upper", port: "value" } },
      { from: { node: "upper", port: "out" }, to: { node: "verdict", port: "value" } },
      { from: { node: "flag", port: "out" }, to: { node: "verdict", port: "search" } },
      { from: { node: "verdict", port: "out" }, to: { node: "result", port: "tripwire" } },
      { from: { node: "run", port: "output" }, to: { node: "result", port: "info" } },
      { from: { node: "result", port: "out" }, to: { node: "out", port: "result" } },
    ],
  };
}

/** The flagship: the user-visible agent pipeline behind every chat turn. */
export function turnPipelineWorkflow(opts: ResolvedChatOptions): Workflow {
  const guard = opts.guardrail.enabled;
  return {
    id: "chat.turn.pipeline",
    name: "Chat · turn pipeline",
    description:
      "POST a message → lease the conversation → run the agent with its tools → stream turn events out (SSE) " +
      "while the sink persists them. Fork me to customize the agent.",
    source: "code",
    nodes: [
      {
        id: "in",
        op: "boundary.http.request",
        config: {
          method: "POST",
          path: `${opts.mount}/api/conversations/:id/turns`,
          ...(opts.requireAuth !== undefined ? { requireAuth: opts.requireAuth } : {}),
        },
        ui: { x: 40, y: 200, pair: "ok" },
      },
      {
        id: "begin",
        op: "chat.turn.begin",
        config: { ttlMs: opts.turnTtlMs },
        comment: "Scope check + conversation lease + turn doc. Conflict → 409 path.",
        ui: { x: 320, y: 200 },
      },
      { id: "gate", op: "core.flow.branch", ui: { x: 600, y: 120 } },
      {
        id: "tools",
        op: "agents.tools.workflows",
        config: { tools: [] },
        comment: "Every boundary.tool workflow in the app. Name them here to narrow.",
        ui: { x: 820, y: 40 },
      },
      {
        id: "agent",
        op: "agents.agent",
        config: {
          name: opts.agent.name,
          instructions: opts.agent.instructions,
          ...(opts.agent.model ? { model: opts.agent.model } : {}),
        },
        comment: "THE agent. Edit instructions/model here; wire guardrails/handoffs in.",
        ui: { x: 1080, y: 40 },
      },
      ...(guard
        ? [
            {
              id: "guard",
              op: "agents.guardrail",
              config: { tool: GUARDRAIL_TOOL_NAME, direction: "input" as const },
              comment: "Professional-conduct input guardrail (CHAT_GUARDRAIL=off to drop this).",
              ui: { x: 1080, y: 300 },
            },
          ]
        : []),
      {
        id: "run",
        op: "agents.run",
        config: { maxTurns: opts.maxTurns },
        comment: "Streams turn events; needs OPENAI_API_KEY (or wire vault.read → apiKey).",
        ui: { x: 1340, y: 200 },
      },
      {
        id: "sink",
        op: "chat.events.sink",
        comment: "Persists events + history; notifies WS rooms; guarantees a terminal state.",
        ui: { x: 1620, y: 80 },
      },
      { id: "ok", op: "boundary.http.response", config: { mode: "sse" }, ui: { x: 1620, y: 320, pair: "in" } },
      { id: "err", op: "boundary.http.response", config: { mode: "buffered" }, ui: { x: 600, y: 420 } },
    ],
    edges: [
      { from: { node: "in", port: "params" }, to: { node: "begin", port: "params" } },
      { from: { node: "in", port: "body" }, to: { node: "begin", port: "body" } },
      { from: { node: "in", port: "headers" }, to: { node: "begin", port: "headers" } },
      { from: { node: "in", port: "user" }, to: { node: "begin", port: "user" } },
      { from: { node: "begin", port: "ok" }, to: { node: "gate", port: "condition" } },
      // ok path
      { from: { node: "gate", port: "then" }, to: { node: "tools", port: "in" } },
      { from: { node: "tools", port: "toolset" }, to: { node: "agent", port: "tools" } },
      // Guardrail (when enabled): gated on the ok path like tools, its descriptor
      // wires into the agent — the classifier model only runs once the agent does.
      ...(guard
        ? [
            { from: { node: "gate", port: "then" }, to: { node: "guard", port: "in" } },
            { from: { node: "guard", port: "guardrail" }, to: { node: "agent", port: "guardrails" } },
          ]
        : []),
      { from: { node: "agent", port: "agent" }, to: { node: "run", port: "agent" } },
      { from: { node: "begin", port: "input" }, to: { node: "run", port: "input" } },
      { from: { node: "begin", port: "history" }, to: { node: "run", port: "history" } },
      { from: { node: "begin", port: "turnId" }, to: { node: "run", port: "turnId" } },
      // The SSE gate is control-gated on the ok path: an out-gate with only a
      // stream input would otherwise capture instantly — even on the conflict
      // path, where its producer is skipped and the stream never flows.
      { from: { node: "gate", port: "then" }, to: { node: "ok", port: "in" } },
      { from: { node: "gate", port: "then" }, to: { node: "sink", port: "in" } },
      { from: { node: "run", port: "events" }, to: { node: "ok", port: "stream" } },
      { from: { node: "run", port: "events" }, to: { node: "sink", port: "events" } },
      { from: { node: "begin", port: "turn" }, to: { node: "sink", port: "turn" } },
      { from: { node: "run", port: "history" }, to: { node: "sink", port: "history" } },
      // conflict / not-found path
      { from: { node: "gate", port: "else" }, to: { node: "err", port: "in" } },
      { from: { node: "begin", port: "status" }, to: { node: "err", port: "status" } },
      { from: { node: "begin", port: "error" }, to: { node: "err", port: "body" } },
    ],
  };
}

/** HITL: approve/deny an interrupted turn → the SAME turn resumes streaming. */
export function approvalPipelineWorkflow(opts: ResolvedChatOptions): Workflow {
  return {
    id: "chat.approval.pipeline",
    name: "Chat · approval pipeline",
    source: "code",
    nodes: [
      {
        id: "in",
        op: "boundary.http.request",
        config: {
          method: "POST",
          path: `${opts.mount}/api/conversations/:id/turns/:turnId/approve`,
          ...(opts.requireAuth !== undefined ? { requireAuth: opts.requireAuth } : {}),
        },
      },
      { id: "begin", op: "chat.approval.begin", config: { ttlMs: opts.turnTtlMs } },
      { id: "gate", op: "core.flow.branch" },
      { id: "tools", op: "agents.tools.workflows", config: { tools: [] } },
      {
        id: "agent",
        op: "agents.agent",
        config: {
          name: opts.agent.name,
          instructions: opts.agent.instructions,
          ...(opts.agent.model ? { model: opts.agent.model } : {}),
        },
        comment: "Must reify the same agent shape as the turn pipeline.",
      },
      { id: "resume", op: "agents.run.resume" },
      { id: "sink", op: "chat.events.sink" },
      { id: "ok", op: "boundary.http.response", config: { mode: "sse" } },
      { id: "err", op: "boundary.http.response", config: { mode: "buffered" } },
    ],
    edges: [
      { from: { node: "in", port: "params" }, to: { node: "begin", port: "params" } },
      { from: { node: "in", port: "body" }, to: { node: "begin", port: "body" } },
      { from: { node: "in", port: "headers" }, to: { node: "begin", port: "headers" } },
      { from: { node: "in", port: "user" }, to: { node: "begin", port: "user" } },
      { from: { node: "begin", port: "ok" }, to: { node: "gate", port: "condition" } },
      { from: { node: "gate", port: "then" }, to: { node: "tools", port: "in" } },
      { from: { node: "tools", port: "toolset" }, to: { node: "agent", port: "tools" } },
      { from: { node: "agent", port: "agent" }, to: { node: "resume", port: "agent" } },
      { from: { node: "begin", port: "stateToken" }, to: { node: "resume", port: "stateToken" } },
      { from: { node: "begin", port: "decisions" }, to: { node: "resume", port: "decisions" } },
      { from: { node: "begin", port: "turnId" }, to: { node: "resume", port: "turnId" } },
      { from: { node: "gate", port: "then" }, to: { node: "ok", port: "in" } },
      { from: { node: "gate", port: "then" }, to: { node: "sink", port: "in" } },
      { from: { node: "resume", port: "events" }, to: { node: "ok", port: "stream" } },
      { from: { node: "resume", port: "events" }, to: { node: "sink", port: "events" } },
      { from: { node: "begin", port: "turn" }, to: { node: "sink", port: "turn" } },
      { from: { node: "resume", port: "history" }, to: { node: "sink", port: "history" } },
      { from: { node: "gate", port: "else" }, to: { node: "err", port: "in" } },
      { from: { node: "begin", port: "status" }, to: { node: "err", port: "status" } },
      { from: { node: "begin", port: "error" }, to: { node: "err", port: "body" } },
    ],
  };
}

/** The SPA: `boundary.http.app` (where) → `chat.app` (what) → serve. */
export function spaWorkflow(mount: string): Workflow {
  return {
    id: "chat.spa",
    name: "Chat · SPA",
    source: "code",
    nodes: [
      { id: "mount", op: "boundary.http.app", config: { mount }, ui: { x: 60, y: 60, pair: "serve" } },
      { id: "chat", op: "chat.app", ui: { x: 340, y: 60 } },
      { id: "serve", op: "boundary.http.app.serve", ui: { x: 620, y: 60, pair: "mount" } },
    ],
    edges: [
      { from: { node: "mount", port: "out" }, to: { node: "chat", port: "in" } },
      { from: { node: "chat", port: "app" }, to: { node: "serve", port: "app" } },
    ],
  };
}
