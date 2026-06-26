/**
 * @pattern-js/mod-chat — the `chat.*` op catalog.
 *
 * Two families:
 *  - **http ops** (conversations CRUD, turns list, stop) — identity-style:
 *    params/query/body/headers/user in, status/headers/body out. Scoping is
 *    the wired `user` port when identity is present, else the anonymous
 *    `chat_device` cookie.
 *  - **pipeline ops** (`chat.turn.begin`, `chat.events.sink`,
 *    `chat.approval.begin`) — the bookkeeping bookends of the turn pipeline
 *    workflow. The interesting middle (agent, tools, guardrails, compaction)
 *    stays visible, editable nodes.
 */

import {
  httpOutcome,
  required,
  resolveAuthRequirement,
  stream,
  value,
  z,
  type AuthRequirement,
  type Engine,
  type OpContext,
  type OpDefinition,
} from "@pattern-js/core";
import { AGENTS_SERVICE, messagePartSchema, modelRefSchema, turnEventSchema, type AgentsService, type ModelRef, type TurnEvent } from "@pattern-js/mod-agents";
import type { DocumentRow, PatternStores } from "@pattern-js/mod-store";
import {
  CONVERSATIONS,
  DEFAULT_NS,
  DEVICE_COOKIE,
  TURNS,
  conversationView,
  mayAccess,
  nsOf,
  scopeFrom,
  stores,
  turnView,
  type ConversationDoc,
  type Scope,
  type TurnDoc,
  type TurnStatus,
} from "./data.js";

const recordSchema = z.record(z.string(), z.unknown());
const stringRecord = z.record(z.string(), z.string());

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

async function maybe<T>(ctx: OpContext, port: string): Promise<T | undefined> {
  return ctx.input.has(port) ? ((await ctx.input.value(port)) as T) : undefined;
}

// ── Route I/O: how each op's discrete ports map to the request (consumed by the
// route workflows). The op is a PURE domain function — it gets `user` + the
// device id (read from the request `cookies` port in the workflow), never
// headers; it returns domain data or an httpOutcome. The workflow decomposes the
// request, maps outcomes via boundary.http.status, and sets the device cookie. ──
type Src = "params" | "body" | "user" | "device";
export interface ChatInSpec {
  src: Src;
  schema: z.ZodType;
}
export interface ChatRouteIO {
  in: Record<string, ChatInSpec>;
  out: string;
  /** Response status for the happy path (default 200). */
  ok?: number;
  /** An extra output port whose value → response cookies (the session mint). */
  cookiesPort?: string;
}
export const chatOpRoutes: Record<string, ChatRouteIO> = {};

const P = (schema: z.ZodType = z.string()): ChatInSpec => ({ src: "params", schema });
const B = (schema: z.ZodType): ChatInSpec => ({ src: "body", schema });
const U = (): ChatInSpec => ({ src: "user", schema: z.unknown() });
const Dev = (): ChatInSpec => ({ src: "device", schema: z.string().optional() });

function chatOp(
  type: string,
  description: string,
  io: { in?: Record<string, ChatInSpec>; out: string; ok?: number; cookiesPort?: string },
  handler: (inputs: Record<string, unknown>, ctx: OpContext) => unknown | Promise<unknown>,
): OpDefinition {
  const inSpec = io.in ?? {};
  chatOpRoutes[type] = { in: inSpec, out: io.out, ok: io.ok, cookiesPort: io.cookiesPort };
  const outputs = io.cookiesPort
    ? { [io.out]: value(), [io.cookiesPort]: value(z.record(z.string(), z.unknown())) }
    : { [io.out]: value() };
  return {
    type,
    title: type,
    description,
    reusable: false,
    inputs: Object.fromEntries(Object.entries(inSpec).map(([k, v]) => [k, value(v.schema)])),
    outputs,
    execute: async (ctx) => {
      const inputs: Record<string, unknown> = {};
      await Promise.all(Object.keys(inSpec).map(async (k) => void (inputs[k] = ctx.input.has(k) ? await ctx.input.value(k) : undefined)));
      const result = await handler(inputs, ctx);
      return io.cookiesPort ? (result as Record<string, unknown>) : { [io.out]: result };
    },
  };
}

/** Load + scope-check a conversation. Null when missing OR not the caller's. */
async function loadConversation(
  svc: PatternStores,
  id: string,
  scope: Scope,
): Promise<{ row: DocumentRow; doc: ConversationDoc } | null> {
  const row = await svc.docs.get(CONVERSATIONS, id);
  if (!row) return null;
  const doc = row.data as unknown as ConversationDoc;
  if (!mayAccess(doc, scope)) return null;
  return { row, doc };
}

/** CAS-retry a document mutation (last-writer merges over a fresh read). */
async function casPut(
  svc: PatternStores,
  collection: string,
  id: string,
  mutate: (data: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await svc.docs.get(collection, id);
    if (!row) return;
    const next = mutate({ ...row.data });
    if (await svc.docs.put(collection, id, next, row.version)) return;
  }
  console.error(`[pattern/mod-chat] CAS update on ${collection}/${id} kept losing — giving up`);
}

/* ── conversations CRUD ────────────────────────────────────────────────── */

const SAFE_ID = /^[a-zA-Z0-9-]{8,64}$/;

function makeOps(getEngine: () => Engine | undefined, opts: MeOptions): OpDefinition[] {
  /* ── identity ──────────────────────────────────────────────────────────── */

  // Always-open: the SPA's first question — "who am I, and is auth required?".
  // The auth policy is resolved HERE (same {env} semantics as the routes) so
  // the app can render the sign-in card instead of bouncing off raw 401s.
  const me = chatOp("chat.me", "Caller identity + the resolved auth policy for the chat app.", { in: { user: U() }, out: "info" }, (inputs, ctx) => {
    const u = inputs.user as { id?: string; name?: string; email?: string; provider?: string } | null;
    const requirement = resolveAuthRequirement(opts.requireAuth as AuthRequirement | undefined, ctx.env);
    return {
      user: u?.id ? { id: u.id, name: u.name ?? null, email: u.email ?? null, provider: u.provider ?? null } : null,
      authRequired: requirement !== undefined && requirement !== false,
      login: { kind: "magic-link", requestPath: opts.loginRequestPath, logoutPath: opts.logoutPath },
    };
  });

  const create = chatOp(
    "chat.conversations.create",
    "Create a conversation (mints the anonymous device session for guests).",
    { in: { user: U(), device: Dev(), ns: P(), title: B(z.string().optional()) }, out: "conversation", ok: 201, cookiesPort: "cookies" },
    async (inputs, ctx) => {
      const svc = stores(ctx);
      const user = inputs.user as { id?: string } | null;
      const ownerId = user?.id ?? null;
      const incoming = typeof inputs.device === "string" && inputs.device ? (inputs.device as string) : null;
      // Guests get a stable device id (minted on first contact); the workflow
      // sets it as the chat_device cookie. Signed-in users scope by ownerId.
      const deviceId = ownerId ? null : (incoming ?? crypto.randomUUID());
      const now = Date.now();
      const id = crypto.randomUUID();
      const doc: ConversationDoc = {
        title: String(inputs.title ?? "New conversation"),
        ownerId,
        deviceId,
        namespace: String(inputs.ns ?? DEFAULT_NS),
        history: [],
        createdAt: now,
        updatedAt: now,
      };
      const row = await svc.docs.put(CONVERSATIONS, id, doc as never);
      const cookies = deviceId ? { [DEVICE_COOKIE]: { value: deviceId, maxAge: 31_536_000 } } : {};
      return { conversation: conversationView(row!), cookies };
    },
  );

  const list = chatOp("chat.conversations.list", "List the caller's conversations in this namespace, newest first.", { in: { user: U(), device: Dev(), ns: P() }, out: "list" }, async (inputs, ctx) => {
    const svc = stores(ctx);
    const scope = scopeFrom(inputs.user as { id?: string } | null, inputs.device as string | undefined);
    const where = scope.ownerId != null ? { ownerId: scope.ownerId } : scope.deviceId != null ? { deviceId: scope.deviceId } : undefined;
    if (!where) return { conversations: [] };
    const ns = String(inputs.ns ?? DEFAULT_NS);
    const rows = await svc.docs.query({ collection: CONVERSATIONS, where, orderBy: "updatedAt", orderDir: "desc", limit: 200 });
    // Partition by namespace in memory (legacy/absent reads as "default"), so the
    // shared backend keeps each branded instance's list separate without an index.
    return { conversations: rows.filter((r) => nsOf(r.data as unknown as ConversationDoc) === ns).map(conversationView) };
  });

  const get = chatOp("chat.conversations.get", "One conversation (scope-checked).", { in: { user: U(), device: Dev(), id: P() }, out: "conversation" }, async (inputs, ctx) => {
    const scope = scopeFrom(inputs.user as { id?: string } | null, inputs.device as string | undefined);
    const hit = await loadConversation(stores(ctx), String(inputs.id ?? ""), scope);
    return hit ? conversationView(hit.row) : httpOutcome("not_found", { error: "conversation not found" });
  });

  const del = chatOp("chat.conversations.delete", "Delete a conversation and its turns (scope-checked).", { in: { user: U(), device: Dev(), id: P() }, out: "result" }, async (inputs, ctx) => {
    const svc = stores(ctx);
    const id = String(inputs.id ?? "");
    const scope = scopeFrom(inputs.user as { id?: string } | null, inputs.device as string | undefined);
    const hit = await loadConversation(svc, id, scope);
    if (!hit) return httpOutcome("not_found", { error: "conversation not found" });
    const turns = await svc.docs.query({ collection: TURNS, where: { conversationId: id }, limit: 1000 });
    for (const t of turns) await svc.docs.delete(TURNS, t.id);
    await svc.docs.delete(CONVERSATIONS, id);
    return { ok: true };
  });

  const turnsList = chatOp(
    "chat.turns.list",
    "The conversation's turns with their persisted event logs (replay source).",
    { in: { user: U(), device: Dev(), id: P() }, out: "turns" },
    async (inputs, ctx) => {
      const svc = stores(ctx);
      const id = String(inputs.id ?? "");
      const scope = scopeFrom(inputs.user as { id?: string } | null, inputs.device as string | undefined);
      const hit = await loadConversation(svc, id, scope);
      if (!hit) return httpOutcome("not_found", { error: "conversation not found" });
      const rows = await svc.docs.query({ collection: TURNS, where: { conversationId: id }, orderBy: "createdAt", orderDir: "asc", limit: 500 });
      return { turns: rows.map(turnView) };
    },
  );

  const stop = chatOp(
    "chat.turn.stop",
    "Cancel a running turn (the run aborts; the sink writes the terminal state).",
    { in: { user: U(), device: Dev(), id: P(), turnId: P() }, out: "result" },
    async (inputs, ctx) => {
      const svc = stores(ctx);
      const id = String(inputs.id ?? "");
      const scope = scopeFrom(inputs.user as { id?: string } | null, inputs.device as string | undefined);
      const hit = await loadConversation(svc, id, scope);
      if (!hit) return httpOutcome("not_found", { error: "conversation not found" });
      const turnId = String(inputs.turnId ?? "");
      const turnRow = await svc.docs.get(TURNS, turnId);
      const turn = turnRow?.data as unknown as TurnDoc | undefined;
      if (!turnRow || !turn || turn.conversationId !== id) return httpOutcome("not_found", { error: "turn not found" });
      // Streaming runs settle for the engine before the turn finishes — the
      // provider's turn-abort registry is the live handle; cancelRun covers
      // any non-streaming remainder.
      const agents = ctx.services[AGENTS_SERVICE] as AgentsService | undefined;
      const viaTurn = agents?.abortTurn(turnId, new Error("stopped from chat")) ?? false;
      const viaRun = getEngine()?.cancelRun(turn.runId, new Error("stopped from chat")) ?? false;
      return { ok: true, cancelled: viaTurn || viaRun };
    },
  );

  // The language-model aliases the chat model switcher offers. Read duck-typed
  // off mod-ai's "aiConfig" service (no hard dep on mod-ai) — names + display
  // fields only, never the sourced secrets. Empty list if mod-ai isn't installed.
  const modelsList = chatOp(
    "chat.models.list",
    "Language-model aliases offered in the chat model switcher (display fields only, never secrets).",
    { in: { ns: P() }, out: "models" },
    (_inputs, ctx) => {
      const cfg = ctx.services["aiConfig"] as
        | { aliases(): Array<{ name: string; provider: string; modelId: string; modality?: string }> }
        | undefined;
      const models = (cfg?.aliases() ?? [])
        .filter((a) => (a.modality ?? "language") === "language")
        .map((a) => ({ name: a.name, provider: a.provider, modelId: a.modelId }));
      return { models };
    },
  );

  /* ── pipeline bookends ───────────────────────────────────────────────── */

  // Resolve the model for a turn: a per-turn language alias selected in the UI
  // (the request `model`) overrides the configured pin (`fallback`), which itself
  // overrides the app default (an undefined output). Fails soft — an unknown or
  // non-language alias falls through to the fallback, never throwing. This is the
  // single producer of the agent's `model` input in the turn pipeline.
  const resolveModel: OpDefinition = {
    type: "chat.model.resolve",
    title: "chat.model.resolve",
    description:
      "Resolve a turn's model: a per-turn language alias overrides the configured pin, which overrides the app " +
      "default. Fails soft: an unknown or non-language alias falls back rather than throwing.",
    reusable: false,
    inputs: { alias: value(z.string()), fallback: value(modelRefSchema) },
    outputs: { model: value(modelRefSchema) },
    execute: async (ctx) => {
      const [alias, fallback] = await Promise.all([maybe<string>(ctx, "alias"), maybe<ModelRef>(ctx, "fallback")]);
      const cfg = ctx.services["aiConfig"] as
        | { alias(name: string): { modality?: string } | undefined; resolveAlias(name: string): ModelRef | undefined }
        | undefined;
      if (alias && cfg) {
        const a = cfg.alias(alias);
        if (a && (a.modality ?? "language") === "language") {
          const resolved = cfg.resolveAlias(alias);
          if (resolved) return { model: resolved };
        }
      }
      return { model: fallback ?? null };
    },
  };

  const begin: OpDefinition = {
    type: "chat.turn.begin",
    title: "chat.turn.begin",
    description:
      "Turn pipeline entry: scope-check, claim the conversation lease (owner = this run — auto-released on settle), " +
      "persist the user message, hand history + input to the agent. Conflict → ok:false + an httpOutcome the workflow maps.",
    reusable: false,
    config: z.object({
      /** Lease TTL (crash backstop) in ms. */
      ttlMs: z.number().int().positive().default(5 * 60 * 1000),
    }),
    // Pure inputs: the workflow extracts conversationId/content/turnId from the
    // request and reads the device id from the cookies port — the op never sees
    // headers/HTTP. `outcome` carries an httpOutcome on the conflict/not-found
    // path, which the pipeline maps to a status via boundary.http.status.
    inputs: {
      user: value(),
      device: value(z.string()),
      conversationId: value(z.string()),
      content: value(),
      turnId: value(z.string()),
    },
    outputs: {
      ok: value(z.boolean()),
      outcome: value(),
      input: value(z.array(messagePartSchema)),
      history: value(z.array(z.unknown())),
      turnId: value(z.string()),
      turn: value(), // meta bundle for the sink
    },
    execute: async (ctx) => {
      const svc = stores(ctx);
      const [user, device, conversationIdIn, content, turnIdIn] = await Promise.all([
        maybe<{ id?: string } | null>(ctx, "user"),
        maybe<string>(ctx, "device"),
        maybe<string>(ctx, "conversationId"),
        maybe(ctx, "content"),
        maybe<string>(ctx, "turnId"),
      ]);
      const scope = scopeFrom(user ?? null, device);
      const conversationId = String(conversationIdIn ?? "");
      const fail = (code: string, error: Record<string, unknown>) => ({
        ok: false,
        outcome: httpOutcome(code, error),
        input: [],
        history: [],
        turnId: "",
        turn: null,
      });

      const hit = await loadConversation(svc, conversationId, scope);
      if (!hit) return fail("not_found", { error: "conversation not found" });

      // Content: parts array (or a bare string for curl-friendliness).
      const parts = typeof content === "string" ? [{ type: "text", text: content }] : content;
      const parsed = z.array(messagePartSchema).min(1).safeParse(parts);
      if (!parsed.success) {
        return fail("invalid", { error: "content must be a non-empty array of {text | image_ref} parts" });
      }

      // One turn at a time. Owner is the TURN (not the runId): a streaming
      // run settles for the engine while the SSE tail still flows, so the
      // store's run-settle auto-release would drop the lock mid-turn — the
      // sink releases it at the terminal event instead; TTL is the backstop.
      const { ttlMs } = ctx.config as { ttlMs: number };
      const requestedId = String(turnIdIn ?? "");
      const turnId = SAFE_ID.test(requestedId) ? requestedId : crypto.randomUUID();
      const lease = await svc.leases.acquire(`chat:conversation:${conversationId}`, `turn:${turnId}`, ttlMs);
      if (!lease.ok) {
        const running = await svc.docs.query({
          collection: TURNS,
          where: { conversationId, status: "running" },
          limit: 1,
        });
        return fail("conflict", {
          error: "a turn is already running on this conversation",
          code: "turn_in_progress",
          activeTurnId: running[0]?.id ?? null,
          activeRunId: lease.owner,
        });
      }

      const now = Date.now();
      const turnDoc: TurnDoc = {
        conversationId,
        runId: ctx.runId,
        input: parsed.data,
        events: [],
        status: "running",
        stateToken: null,
        createdAt: now,
        endedAt: null,
      };
      await svc.docs.put(TURNS, turnId, turnDoc as never);

      // First message titles the conversation.
      const firstText = parsed.data.find((p) => p.type === "text") as { text?: string } | undefined;
      await casPut(svc, CONVERSATIONS, conversationId, (data) => ({
        ...data,
        title:
          (data.title === "New conversation" || !data.title) && firstText?.text
            ? firstText.text.slice(0, 60)
            : data.title,
        updatedAt: now,
      }));

      const rooms: string[] = [];
      if (scope.ownerId) rooms.push(`user:${scope.ownerId}`);

      return {
        ok: true,
        outcome: null,
        input: parsed.data,
        history: hit.doc.history ?? [],
        turnId,
        turn: { conversationId, turnId, rooms, ttlMs },
      };
    },
  };

  const sink: OpDefinition = {
    type: "chat.events.sink",
    title: "chat.events.sink",
    description:
      "Turn pipeline exit: persists the event stream into the turn doc as it flows (deltas coalesced), renews the lease, " +
      "notifies WS rooms, ALWAYS writes a terminal status, and saves the updated history on the conversation.",
    reusable: false,
    inputs: {
      events: stream(turnEventSchema),
      turn: required(), // meta from chat.turn.begin
      history: value(z.array(z.unknown())),
    },
    outputs: { status: value(z.string()) },
    execute: async (ctx) => {
      const svc = stores(ctx);
      const meta = (await ctx.input.value("turn")) as {
        conversationId: string;
        turnId: string;
        rooms: string[];
        ttlMs: number;
      };
      const notify = async (status: TurnStatus | "running") => {
        const envelope = {
          kind: "notify",
          type: "chat.turn.updated",
          payload: { conversationId: meta.conversationId, turnId: meta.turnId, status },
          ts: Date.now(),
        };
        for (const room of meta.rooms) {
          await ctx.services.connections.broadcast(room, envelope).catch(() => {});
        }
      };

      let status: TurnStatus = "error";
      let stateToken: string | null = null;
      let pendingDelta = "";
      let buffer: TurnEvent[] = [];
      let lastFlush = 0;

      // Move the accumulated delta into the buffer IN ORDER (before any
      // following non-delta event).
      const materialize = () => {
        if (!pendingDelta) return;
        buffer.push({
          type: "text.delta",
          delta: pendingDelta,
          turnId: meta.turnId,
          runId: ctx.runId,
        } as TurnEvent);
        pendingDelta = "";
      };

      const flush = async (force = false) => {
        const now = Date.now();
        if (!force && now - lastFlush < 150) return;
        materialize();
        if (buffer.length === 0) return;
        const chunk = buffer;
        buffer = [];
        lastFlush = now;
        await casPut(svc, TURNS, meta.turnId, (data) => ({
          ...data,
          events: [...((data.events as TurnEvent[]) ?? []), ...chunk],
        }));
        await svc.leases.renew(`chat:conversation:${meta.conversationId}`, `turn:${meta.turnId}`, meta.ttlMs);
        await notify("running");
      };

      try {
        const reader = ctx.input.stream<TurnEvent>("events").getReader();
        for (;;) {
          const { done, value: ev } = await reader.read();
          if (done) break;
          if (ev.type === "text.delta") {
            pendingDelta += ev.delta;
            await flush();
            continue;
          }
          materialize();
          if (ev.type === "approval.request") stateToken = ev.stateToken;
          if (ev.type === "done") {
            status =
              ev.stopReason === "complete"
                ? "complete"
                : ev.stopReason === "interrupted"
                  ? "interrupted"
                  : ev.stopReason === "cancelled"
                    ? "cancelled"
                    : "error";
          }
          buffer.push(ev);
          await flush(ev.type === "done");
        }
        await flush(true);
      } catch (err) {
        // The terminal state is a PROMISE: even a sink crash records one.
        buffer.push(
          {
            type: "error",
            message: err instanceof Error ? err.message : String(err),
            turnId: meta.turnId,
            runId: ctx.runId,
          } as TurnEvent,
          { type: "done", stopReason: "error", turnId: meta.turnId, runId: ctx.runId } as TurnEvent,
        );
        status = "error";
        await flush(true).catch(() => {});
      }

      // Terminal bookkeeping: turn status + conversation history + the lease.
      await casPut(svc, TURNS, meta.turnId, (data) => ({
        ...data,
        status,
        stateToken,
        endedAt: Date.now(),
      }));
      await svc.leases.release(`chat:conversation:${meta.conversationId}`, `turn:${meta.turnId}`);
      // The history slot REJECTS when the producing run-node failed — the
      // terminal bookkeeping above must still have happened, so swallow.
      const history = await maybe<unknown[]>(ctx, "history").catch(() => undefined);
      if (status === "complete" && Array.isArray(history) && history.length > 0) {
        await casPut(svc, CONVERSATIONS, meta.conversationId, (data) => ({
          ...data,
          history,
          updatedAt: Date.now(),
        }));
      }
      await notify(status);
      return { status };
    },
  };

  const approvalBegin: OpDefinition = {
    type: "chat.approval.begin",
    title: "chat.approval.begin",
    description:
      "Approval pipeline entry: validates the interrupted turn, re-claims the lease for the resume run, " +
      "and hands the stateToken + decisions to agents.run.resume.",
    reusable: false,
    config: z.object({ ttlMs: z.number().int().positive().default(5 * 60 * 1000) }),
    inputs: {
      user: value(),
      device: value(z.string()),
      conversationId: value(z.string()),
      turnId: value(z.string()),
      decision: value(),
    },
    outputs: {
      ok: value(z.boolean()),
      outcome: value(),
      stateToken: value(z.string()),
      decisions: value(),
      turnId: value(z.string()),
      turn: value(),
    },
    execute: async (ctx) => {
      const svc = stores(ctx);
      const [user, device, conversationIdIn, turnIdIn, decisionIn] = await Promise.all([
        maybe<{ id?: string } | null>(ctx, "user"),
        maybe<string>(ctx, "device"),
        maybe<string>(ctx, "conversationId"),
        maybe<string>(ctx, "turnId"),
        maybe(ctx, "decision"),
      ]);
      const scope = scopeFrom(user ?? null, device);
      const conversationId = String(conversationIdIn ?? "");
      const turnId = String(turnIdIn ?? "");
      const fail = (code: string, error: Record<string, unknown>) => ({
        ok: false,
        outcome: httpOutcome(code, error),
        stateToken: "",
        decisions: [],
        turnId,
        turn: null,
      });

      const hit = await loadConversation(svc, conversationId, scope);
      if (!hit) return fail("not_found", { error: "conversation not found" });
      const turnRow = await svc.docs.get(TURNS, turnId);
      const turn = turnRow?.data as unknown as TurnDoc | undefined;
      if (!turn || turn.conversationId !== conversationId) return fail("not_found", { error: "turn not found" });
      if (turn.status !== "interrupted" || !turn.stateToken) {
        return fail("conflict", { error: "turn is not awaiting approval", code: "not_interrupted" });
      }

      const decision = obj(decisionIn);
      const decisions = Array.isArray(decision.decisions)
        ? decision.decisions
        : [{ id: decision.interruptionId ?? decision.id, approved: Boolean(decision.approved) }];

      const { ttlMs } = ctx.config as { ttlMs: number };
      const lease = await svc.leases.acquire(`chat:conversation:${conversationId}`, `turn:${turnId}`, ttlMs);
      if (!lease.ok) {
        return fail("conflict", { error: "a turn is already running", code: "turn_in_progress", activeRunId: lease.owner });
      }

      // The resume continues the SAME turn doc (one event log per turn).
      await casPut(svc, TURNS, turnId, (data) => ({ ...data, status: "running", runId: ctx.runId }));
      const rooms: string[] = [];
      if (scope.ownerId) rooms.push(`user:${scope.ownerId}`);
      return {
        ok: true,
        outcome: null,
        stateToken: turn.stateToken,
        decisions,
        turnId,
        turn: { conversationId, turnId, rooms, ttlMs },
      };
    },
  };

  return [me, create, list, get, del, turnsList, stop, modelsList, resolveModel, begin, sink, approvalBegin];
}

/** The slice of resolved options `chat.me` reports to the SPA. */
interface MeOptions {
  requireAuth?: unknown;
  loginRequestPath: string;
  logoutPath: string;
}

export { makeOps as chatOps };
