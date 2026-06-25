/**
 * @pattern-js/mod-chat — the shipped workflows.
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

import type { Workflow } from "@pattern-js/core";
import { chatOpRoutes, type ChatInSpec } from "./ops.js";
import { DEVICE_COOKIE } from "./data.js";
import type { ChatModel, ResolvedChatOptions, ResolvedInstance, ResolvedPin } from "./options.js";

/**
 * Pin a chat agent's model: an `ai.model` node feeding the agent's `model`
 * INPUT (agents.agent takes a ModelRef there — a `model` in its config is
 * silently dropped). With no pin, the agent falls through to the app's
 * configured default model. Needs `@pattern-js/mod-ai` installed.
 */
function modelInjection(
  model: ChatModel | undefined,
  agentNodeId: string,
  ui: { x: number; y: number },
): { nodes: Workflow["nodes"]; edges: Workflow["edges"] } {
  if (!model) return { nodes: [], edges: [] };
  const id = `${agentNodeId}Model`;
  return {
    nodes: [
      {
        id,
        op: "ai.model",
        config: {
          routing: model.routing ?? "gateway",
          provider: model.provider,
          modelId: model.modelId,
          ...(model.credential ? { credential: model.credential } : {}),
        },
        comment: "Pin this agent's model; remove to use the app's default model.",
        ui,
      },
    ],
    edges: [{ from: { node: id, port: "model" }, to: { node: agentNodeId, port: "model" } }],
  };
}

interface RouteSpec {
  id: string;
  method: string;
  path: string;
  op: string;
}

/**
 * A CRUD route: decompose the request (params/body → discrete op ports, `user`
 * straight through, the device id read from the `cookies` port), run the pure
 * op, map its outcome via boundary.http.status, and set the device-session
 * cookie when the op mints one. The op never touches HTTP.
 */
function route(spec: RouteSpec, requireAuth?: unknown): Workflow {
  const io = chatOpRoutes[spec.op];
  if (!io) throw new Error(`chat route "${spec.id}": no I/O for op "${spec.op}"`);
  const groups: Record<"params" | "body", Array<[string, ChatInSpec]>> = { params: [], body: [] };
  const userPorts: string[] = [];
  const devicePorts: string[] = [];
  for (const [name, s] of Object.entries(io.in)) {
    if (s.src === "user") userPorts.push(name);
    else if (s.src === "device") devicePorts.push(name);
    else groups[s.src].push([name, s]);
  }

  const nodes: Workflow["nodes"] = [
    { id: "in", op: "boundary.http.request", config: { method: spec.method, path: spec.path, ...(requireAuth !== undefined ? { requireAuth } : {}) } },
    { id: "call", op: spec.op },
    { id: "status", op: "boundary.http.status", config: io.ok && io.ok !== 200 ? { ok: io.ok } : {} },
    { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
  ];
  const edges: Workflow["edges"] = [];

  let wired = false;
  for (const src of ["params", "body"] as const) {
    const ports = groups[src];
    if (!ports.length) continue;
    wired = true;
    const ex = `ex_${src}`;
    nodes.push({ id: ex, op: "core.object.extract", config: { keys: ports.map(([n]) => n) } });
    edges.push({ from: { node: "in", port: src }, to: { node: ex, port: "object" } });
    for (const [name] of ports) edges.push({ from: { node: ex, port: name }, to: { node: "call", port: name } });
  }
  for (const p of userPorts) {
    wired = true;
    edges.push({ from: { node: "in", port: "user" }, to: { node: "call", port: p } });
  }
  if (devicePorts.length) {
    wired = true;
    nodes.push({ id: "ex_cookie", op: "core.object.get", config: { path: DEVICE_COOKIE } });
    edges.push({ from: { node: "in", port: "cookies" }, to: { node: "ex_cookie", port: "object" } });
    for (const p of devicePorts) edges.push({ from: { node: "ex_cookie", port: "out" }, to: { node: "call", port: p } });
  }
  if (!wired) edges.push({ from: { node: "in", port: "out" }, to: { node: "call", port: "in" } });

  edges.push({ from: { node: "call", port: io.out }, to: { node: "status", port: "result" } });
  edges.push({ from: { node: "status", port: "status" }, to: { node: "out", port: "status" } });
  edges.push({ from: { node: "status", port: "body" }, to: { node: "out", port: "body" } });
  if (io.cookiesPort) edges.push({ from: { node: "call", port: io.cookiesPort }, to: { node: "out", port: "cookies" } });

  return { id: spec.id, name: `Chat · ${spec.method} ${spec.path}`, source: "code", nodes, edges };
}

export function crudWorkflows(opts: ResolvedChatOptions): Workflow[] {
  const api = `${opts.mount}/api`;
  // Conversation routes carry a `:ns` segment: the SPA sends its (path-decoupled)
  // namespace there, and the ops partition the store by it. So ONE shared backend
  // serves every branded instance — no per-instance route duplication. `/me` has
  // no scoped data, so it stays bare.
  const specs: RouteSpec[] = [
    { id: "chat.route.conversations.create", method: "POST", path: `${api}/:ns/conversations`, op: "chat.conversations.create" },
    { id: "chat.route.conversations.list", method: "GET", path: `${api}/:ns/conversations`, op: "chat.conversations.list" },
    { id: "chat.route.conversations.get", method: "GET", path: `${api}/:ns/conversations/:id`, op: "chat.conversations.get" },
    { id: "chat.route.conversations.delete", method: "DELETE", path: `${api}/:ns/conversations/:id`, op: "chat.conversations.delete" },
    { id: "chat.route.turns.list", method: "GET", path: `${api}/:ns/conversations/:id/turns`, op: "chat.turns.list" },
    { id: "chat.route.turn.stop", method: "POST", path: `${api}/:ns/conversations/:id/turns/:turnId/stop`, op: "chat.turn.stop" },
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
  const gModel = modelInjection(opts.guardrail.model, "agent", { x: 300, y: 520 });
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
        config: { name: "Conduct classifier", instructions: opts.guardrail.instructions },
        comment: "Conduct classifier. Pin a small model via guardrail.model, else the app default. Replies ALLOW or BLOCK.",
        ui: { x: 300, y: 340 },
      },
      ...gModel.nodes,
      {
        id: "run",
        op: "agents.run",
        comment: "One-shot classification on the agent's model (pinned or the app default).",
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
      ...gModel.edges,
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

/** The flagship: the user-visible agent pipeline behind every chat turn. The
 *  generic form serves every namespace via a `:ns` segment; pass a `pin` to mint
 *  a per-namespace fork whose hardwired `:ns` path out-ranks the generic route
 *  (most-specific-wins) — pipeline selection by forking alone, no extra config. */
export function turnPipelineWorkflow(opts: ResolvedChatOptions, pin?: ResolvedPin): Workflow {
  const guard = opts.guardrail.enabled && !pin; // forks opt out of the shared guardrail tool
  const agent = pin?.agent ?? opts.agent;
  const aModel = modelInjection(agent.model, "agent", { x: 1140, y: 240 });
  const seg = pin ? pin.namespace : ":ns";
  return {
    id: pin ? `chat.turn.pipeline.${pin.namespace}` : "chat.turn.pipeline",
    name: pin ? `Chat · turn pipeline (${pin.namespace})` : "Chat · turn pipeline",
    description:
      "POST a message → lease the conversation → run the agent with its tools → stream turn events out (SSE) " +
      "while the sink persists them. Fork me (hardwire the :ns segment) to give one namespace its own agent.",
    source: "code",
    nodes: [
      {
        id: "in",
        op: "boundary.http.request",
        config: {
          method: "POST",
          path: `${opts.mount}/api/${seg}/conversations/:id/turns`,
          ...(opts.requireAuth !== undefined ? { requireAuth: opts.requireAuth } : {}),
        },
        ui: { x: 40, y: 240, pair: "ok" },
      },
      {
        id: "begin",
        op: "chat.turn.begin",
        config: { ttlMs: opts.turnTtlMs },
        comment: "Scope check + conversation lease + turn doc. Conflict → 409 path.",
        ui: { x: 460, y: 240 },
      },
      { id: "gate", op: "core.flow.branch", ui: { x: 680, y: 240 } },
      {
        id: "tools",
        op: "agents.tools.workflows",
        config: { tools: [] },
        comment: "Every boundary.tool workflow in the app. Name them here to narrow.",
        ui: { x: 900, y: 60 },
      },
      {
        id: "agent",
        op: "agents.agent",
        config: {
          name: agent.name,
          instructions: agent.instructions,
        },
        comment: "THE agent. Edit instructions here; pin a model via the ai.model node; wire guardrails/handoffs in.",
        ui: { x: 1140, y: 60 },
      },
      ...aModel.nodes,
      ...(guard
        ? [
            {
              id: "guard",
              op: "agents.guardrail",
              config: { tool: GUARDRAIL_TOOL_NAME, direction: "input" as const },
              comment: "Professional-conduct input guardrail (CHAT_GUARDRAIL=off to drop this).",
              ui: { x: 1140, y: 420 },
            },
          ]
        : []),
      {
        id: "run",
        op: "agents.run",
        config: { maxTurns: opts.maxTurns },
        comment: "Streams turn events; runs on the wired ai.model or the app's default model.",
        ui: { x: 1380, y: 200 },
      },
      {
        id: "sink",
        op: "chat.events.sink",
        comment: "Persists events + history; notifies WS rooms; guarantees a terminal state.",
        ui: { x: 1620, y: 80 },
      },
      { id: "ok", op: "boundary.http.response", config: { mode: "sse" }, ui: { x: 1620, y: 300, pair: "in" } },
      { id: "err", op: "boundary.http.response", config: { mode: "buffered" }, ui: { x: 900, y: 440 } },
      // Decompose the request into chat.turn.begin's pure ports (the op never
      // sees HTTP): id from params, content + turnId from the body, the device
      // id from the cookies port. The conflict/not-found path maps begin's
      // httpOutcome to a status.
      { id: "ex_params", op: "core.object.extract", config: { keys: ["id"] }, ui: { x: 240, y: 60 } },
      { id: "ex_body", op: "core.object.extract", config: { keys: ["content", "turnId"] }, ui: { x: 240, y: 180 } },
      { id: "ex_cookie", op: "core.object.get", config: { path: "chat_device" }, ui: { x: 240, y: 300 } },
      { id: "errStatus", op: "boundary.http.status", ui: { x: 680, y: 440 } },
    ],
    edges: [
      { from: { node: "in", port: "params" }, to: { node: "ex_params", port: "object" } },
      { from: { node: "ex_params", port: "id" }, to: { node: "begin", port: "conversationId" } },
      { from: { node: "in", port: "body" }, to: { node: "ex_body", port: "object" } },
      { from: { node: "ex_body", port: "content" }, to: { node: "begin", port: "content" } },
      { from: { node: "ex_body", port: "turnId" }, to: { node: "begin", port: "turnId" } },
      { from: { node: "in", port: "user" }, to: { node: "begin", port: "user" } },
      { from: { node: "in", port: "cookies" }, to: { node: "ex_cookie", port: "object" } },
      { from: { node: "ex_cookie", port: "out" }, to: { node: "begin", port: "device" } },
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
      ...aModel.edges,
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
      // conflict / not-found path: begin's httpOutcome → status → response.
      { from: { node: "gate", port: "else" }, to: { node: "err", port: "in" } },
      { from: { node: "begin", port: "outcome" }, to: { node: "errStatus", port: "result" } },
      { from: { node: "errStatus", port: "status" }, to: { node: "err", port: "status" } },
      { from: { node: "errStatus", port: "body" }, to: { node: "err", port: "body" } },
    ],
  };
}

/** HITL: approve/deny an interrupted turn → the SAME turn resumes streaming. */
export function approvalPipelineWorkflow(opts: ResolvedChatOptions): Workflow {
  const aModel = modelInjection(opts.agent.model, "agent", { x: 1080, y: 220 });
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
          path: `${opts.mount}/api/:ns/conversations/:id/turns/:turnId/approve`,
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
        },
        comment: "Must reify the same agent shape as the turn pipeline.",
      },
      ...aModel.nodes,
      { id: "resume", op: "agents.run.resume" },
      { id: "sink", op: "chat.events.sink" },
      { id: "ok", op: "boundary.http.response", config: { mode: "sse" } },
      { id: "err", op: "boundary.http.response", config: { mode: "buffered" } },
      // Decompose into chat.approval.begin's pure ports: id + turnId from
      // params, the decision from the body, the device id from cookies.
      { id: "ex_params", op: "core.object.extract", config: { keys: ["id", "turnId"] } },
      { id: "ex_cookie", op: "core.object.get", config: { path: "chat_device" } },
      { id: "errStatus", op: "boundary.http.status" },
    ],
    edges: [
      { from: { node: "in", port: "params" }, to: { node: "ex_params", port: "object" } },
      { from: { node: "ex_params", port: "id" }, to: { node: "begin", port: "conversationId" } },
      { from: { node: "ex_params", port: "turnId" }, to: { node: "begin", port: "turnId" } },
      { from: { node: "in", port: "body" }, to: { node: "begin", port: "decision" } },
      { from: { node: "in", port: "user" }, to: { node: "begin", port: "user" } },
      { from: { node: "in", port: "cookies" }, to: { node: "ex_cookie", port: "object" } },
      { from: { node: "ex_cookie", port: "out" }, to: { node: "begin", port: "device" } },
      { from: { node: "begin", port: "ok" }, to: { node: "gate", port: "condition" } },
      { from: { node: "gate", port: "then" }, to: { node: "tools", port: "in" } },
      { from: { node: "tools", port: "toolset" }, to: { node: "agent", port: "tools" } },
      ...aModel.edges,
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
      { from: { node: "begin", port: "outcome" }, to: { node: "errStatus", port: "result" } },
      { from: { node: "errStatus", port: "status" }, to: { node: "err", port: "status" } },
      { from: { node: "errStatus", port: "body" }, to: { node: "err", port: "body" } },
    ],
  };
}

/**
 * A callable tool: the chat agent generates an image from a prompt. Resolves the
 * "image" alias (create it in admin → Settings → AI Providers, e.g. openai ·
 * gpt-image-1), generates the image, and returns a MediaRef the chat UI renders
 * inline. Auto-discovered by `agents.tools.workflows`.
 */
export function imageToolWorkflow(_opts: ResolvedChatOptions): Workflow {
  return {
    id: "chat.tool.image",
    name: "Chat · tool · generate image",
    description:
      'A tool the chat agent can call to generate an image from a prompt. Resolves the "image" alias, generates ' +
      "the image, and returns a MediaRef the chat UI shows inline. Configure an image alias in Settings → AI Providers.",
    source: "code",
    nodes: [
      {
        id: "in",
        op: "boundary.tool",
        config: {
          name: "generate_image",
          description: "Generate an image from a text prompt. The image is shown to the user automatically.",
          params: { type: "object", properties: { prompt: { type: "string", description: "What to draw." } }, required: ["prompt"] },
        },
        ui: { x: 40, y: 180, pair: "out" },
      },
      { id: "prompt", op: "core.object.get", config: { path: "prompt" }, comment: "Pull the prompt out of the tool args.", ui: { x: 300, y: 80 } },
      {
        id: "model",
        op: "ai.alias",
        config: { alias: "image" },
        comment: 'The "image" alias — create it in Settings → AI Providers (e.g. openai · gpt-image-1).',
        ui: { x: 300, y: 300 },
      },
      { id: "gen", op: "ai.image.generate", config: { n: 1 }, comment: "Generate the image; bytes land in the blob store.", ui: { x: 580, y: 180 } },
      { id: "out", op: "boundary.tool.return", ui: { x: 860, y: 180, pair: "in" } },
    ],
    edges: [
      { from: { node: "in", port: "args" }, to: { node: "prompt", port: "object" } },
      { from: { node: "prompt", port: "out" }, to: { node: "gen", port: "prompt" } },
      { from: { node: "model", port: "model" }, to: { node: "gen", port: "model" } },
      { from: { node: "gen", port: "image" }, to: { node: "out", port: "result" } },
    ],
  };
}

/**
 * Agents-as-tools, the reference example: a focused "researcher" sub-agent
 * exposed as a callable tool. The chat agent delegates a topic; the sub-agent
 * runs its own `agents.run` (a linked sub-run, deep-linked in the admin) and
 * returns a briefing. No model wired ⇒ it runs on the app's default model.
 */
export function researcherToolWorkflow(_opts: ResolvedChatOptions): Workflow {
  return {
    id: "chat.tool.researcher",
    name: "Chat · tool · researcher (agent-as-tool)",
    description:
      "A sub-agent exposed as a callable tool: the chat agent delegates a topic to a focused 'researcher' agent " +
      "(its own agents.run, a linked sub-run) and gets back a briefing. The reference example for agents-as-tools.",
    source: "code",
    nodes: [
      {
        id: "in",
        op: "boundary.tool",
        config: {
          name: "research",
          description: "Delegate a topic to a focused research sub-agent; returns a concise briefing.",
          params: { type: "object", properties: { topic: { type: "string", description: "The topic to research." } }, required: ["topic"] },
        },
        ui: { x: 40, y: 180, pair: "out" },
      },
      { id: "topic", op: "core.object.get", config: { path: "topic" }, comment: "Pull the topic out of the tool args.", ui: { x: 300, y: 80 } },
      {
        id: "agent",
        op: "agents.agent",
        config: {
          name: "Researcher",
          instructions:
            "You are a focused research assistant. Given a topic, produce a concise, well-structured briefing: the key " +
            "points, useful distinctions, and any caveats. Be accurate and say so when you are uncertain.",
        },
        comment: "The sub-agent. No model wired ⇒ it runs on the app's default model.",
        ui: { x: 300, y: 300 },
      },
      { id: "run", op: "agents.run", config: { maxTurns: 4 }, comment: "Runs the sub-agent as a linked sub-run (deep-links in the admin).", ui: { x: 580, y: 200 } },
      { id: "out", op: "boundary.tool.return", ui: { x: 860, y: 200, pair: "in" } },
    ],
    edges: [
      { from: { node: "in", port: "args" }, to: { node: "topic", port: "object" } },
      { from: { node: "topic", port: "out" }, to: { node: "run", port: "input" } },
      { from: { node: "agent", port: "agent" }, to: { node: "run", port: "agent" } },
      { from: { node: "run", port: "output" }, to: { node: "out", port: "result" } },
    ],
  };
}

/**
 * Speech-to-text for the composer mic: the SPA uploads the recording via the
 * blob route, then POSTs { blobId, mime } here. We rebuild a MediaRef and run
 * `ai.transcribe` (the "transcription" alias) → { text }.
 */
export function transcribeRouteWorkflow(opts: ResolvedChatOptions): Workflow {
  return {
    id: "chat.route.transcribe",
    name: `Chat · POST ${opts.mount}/api/:ns/transcribe`,
    description: 'Speech-to-text: an uploaded audio blob → ai.transcribe → { text }. Resolves the "transcription" alias.',
    source: "code",
    nodes: [
      {
        id: "in",
        op: "boundary.http.request",
        config: { method: "POST", path: `${opts.mount}/api/:ns/transcribe`, ...(opts.requireAuth !== undefined ? { requireAuth: opts.requireAuth } : {}) },
        ui: { x: 40, y: 160 },
      },
      { id: "ex", op: "core.object.extract", config: { keys: ["blobId", "mime"] }, ui: { x: 280, y: 160 } },
      { id: "audio", op: "core.object.build", config: { keys: ["blobId", "mime"] }, comment: "Rebuild a MediaRef from the uploaded blob.", ui: { x: 520, y: 160 } },
      { id: "model", op: "ai.alias", config: { alias: "transcription" }, comment: 'The "transcription" alias (e.g. openai · whisper-1).', ui: { x: 520, y: 340 } },
      { id: "tr", op: "ai.transcribe", ui: { x: 780, y: 240 } },
      { id: "body", op: "core.object.build", config: { keys: ["text"] }, ui: { x: 1040, y: 240 } },
      { id: "out", op: "boundary.http.response", config: { mode: "buffered" }, ui: { x: 1280, y: 240 } },
    ],
    edges: [
      { from: { node: "in", port: "body" }, to: { node: "ex", port: "object" } },
      { from: { node: "ex", port: "blobId" }, to: { node: "audio", port: "blobId" } },
      { from: { node: "ex", port: "mime" }, to: { node: "audio", port: "mime" } },
      { from: { node: "audio", port: "out" }, to: { node: "tr", port: "audio" } },
      { from: { node: "model", port: "model" }, to: { node: "tr", port: "model" } },
      { from: { node: "tr", port: "text" }, to: { node: "body", port: "text" } },
      { from: { node: "body", port: "out" }, to: { node: "out", port: "body" } },
    ],
  };
}

/**
 * Text-to-speech for assistant messages: { text } → `ai.speech.generate` (the
 * "speech" alias) → a MediaRef the SPA plays from /store/blobs/:id.
 */
export function speechRouteWorkflow(opts: ResolvedChatOptions): Workflow {
  return {
    id: "chat.route.speech",
    name: `Chat · POST ${opts.mount}/api/:ns/speech`,
    description: 'Text-to-speech: { text } → ai.speech.generate → a MediaRef the SPA plays. Resolves the "speech" alias.',
    source: "code",
    nodes: [
      {
        id: "in",
        op: "boundary.http.request",
        config: { method: "POST", path: `${opts.mount}/api/:ns/speech`, ...(opts.requireAuth !== undefined ? { requireAuth: opts.requireAuth } : {}) },
        ui: { x: 40, y: 160 },
      },
      { id: "text", op: "core.object.get", config: { path: "text" }, ui: { x: 280, y: 160 } },
      { id: "model", op: "ai.alias", config: { alias: "speech" }, comment: 'The "speech" alias (e.g. openai · gpt-4o-mini-tts).', ui: { x: 280, y: 340 } },
      { id: "sp", op: "ai.speech.generate", ui: { x: 540, y: 240 } },
      { id: "out", op: "boundary.http.response", config: { mode: "buffered" }, ui: { x: 800, y: 240 } },
    ],
    edges: [
      { from: { node: "in", port: "body" }, to: { node: "text", port: "object" } },
      { from: { node: "text", port: "out" }, to: { node: "sp", port: "text" } },
      { from: { node: "model", port: "model" }, to: { node: "sp", port: "model" } },
      { from: { node: "sp", port: "audio" }, to: { node: "out", port: "body" } },
    ],
  };
}

/** The SPA: `boundary.http.app` (where) → `chat.app` (what, branded) → serve.
 *  One per instance; the chat.app node carries the namespace + the backend api
 *  root, which the host injects as window.__APP__ for the bundle to read. */
export function spaWorkflow(inst: ResolvedInstance): Workflow {
  const cfg: Record<string, string> = { api: inst.api, namespace: inst.namespace };
  if (inst.brand.accent) cfg.accent = inst.brand.accent;
  if (inst.brand.title) cfg.title = inst.brand.title;
  const suffix = inst.namespace === "default" ? "" : `.${inst.namespace}`;
  return {
    id: `chat.spa${suffix}`,
    name: `Chat · SPA${suffix ? ` (${inst.namespace})` : ""}`,
    source: "code",
    nodes: [
      { id: "mount", op: "boundary.http.app", config: { mount: inst.mount }, ui: { x: 60, y: 60, pair: "serve" } },
      { id: "chat", op: "chat.app", config: cfg, ui: { x: 340, y: 60 } },
      { id: "serve", op: "boundary.http.app.serve", ui: { x: 620, y: 60, pair: "mount" } },
    ],
    edges: [
      { from: { node: "mount", port: "out" }, to: { node: "chat", port: "in" } },
      { from: { node: "chat", port: "app" }, to: { node: "serve", port: "app" } },
    ],
  };
}
