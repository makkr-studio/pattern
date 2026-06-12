/**
 * @pattern/mod-chat — the `chat.*` op catalog.
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

import { required, stream, value, z, type Engine, type OpContext, type OpDefinition } from "@pattern/core";
import { AGENTS_SERVICE, messagePartSchema, turnEventSchema, type AgentsService, type TurnEvent } from "@pattern/mod-agents";
import type { DocumentRow, PatternStores } from "@pattern/mod-store";
import {
  CONVERSATIONS,
  DEVICE_COOKIE,
  TURNS,
  conversationView,
  mayAccess,
  scopeOf,
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

interface HttpArgs {
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, string>;
  user: { id?: string } | null;
  scope: Scope;
  ctx: OpContext;
}

interface HttpResult {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

function httpOp(
  type: string,
  description: string,
  handler: (args: HttpArgs) => HttpResult | Promise<HttpResult>,
): OpDefinition {
  return {
    type,
    title: type,
    description,
    reusable: false,
    inputs: {
      params: value(recordSchema),
      query: value(recordSchema),
      body: value(z.unknown()),
      headers: value(stringRecord),
      user: value(),
    },
    outputs: { status: value(z.number()), headers: value(stringRecord), body: value() },
    execute: async (ctx) => {
      const [params, query, body, headers, user] = await Promise.all([
        maybe<Record<string, unknown>>(ctx, "params"),
        maybe<Record<string, unknown>>(ctx, "query"),
        maybe(ctx, "body"),
        maybe<Record<string, string>>(ctx, "headers"),
        maybe<{ id?: string } | null>(ctx, "user"),
      ]);
      const scope = scopeOf(user ?? null, headers);
      const res = await handler({
        params: obj(params),
        query: obj(query),
        body,
        headers: headers ?? {},
        user: user ?? null,
        scope,
        ctx,
      });
      return {
        status: res.status,
        headers: { "content-type": "application/json", ...res.headers },
        body: res.body ?? {},
      };
    },
  };
}

/** Load + scope-check a conversation. */
async function loadConversation(
  svc: PatternStores,
  id: string,
  scope: Scope,
): Promise<{ row: DocumentRow; doc: ConversationDoc } | { error: HttpResult }> {
  const row = await svc.docs.get(CONVERSATIONS, id);
  if (!row) return { error: { status: 404, body: { error: "conversation not found" } } };
  const doc = row.data as unknown as ConversationDoc;
  if (!mayAccess(doc, scope)) return { error: { status: 404, body: { error: "conversation not found" } } };
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

function makeOps(getEngine: () => Engine | undefined): OpDefinition[] {
  const create = httpOp(
    "chat.conversations.create",
    "Create a conversation (mints the anonymous device cookie when no user).",
    async ({ body, scope, ctx }) => {
      const svc = stores(ctx);
      let { ownerId, deviceId } = scope;
      const headers: Record<string, string> = {};
      if (ownerId == null && deviceId == null) {
        deviceId = crypto.randomUUID();
        headers["set-cookie"] =
          `${DEVICE_COOKIE}=${deviceId}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`;
      }
      const now = Date.now();
      const id = crypto.randomUUID();
      const doc: ConversationDoc = {
        title: String(obj(body).title ?? "New conversation"),
        ownerId,
        deviceId,
        history: [],
        createdAt: now,
        updatedAt: now,
      };
      const row = await svc.docs.put(CONVERSATIONS, id, doc as never);
      return { status: 201, headers, body: conversationView(row!) };
    },
  );

  const list = httpOp("chat.conversations.list", "List the caller's conversations, newest first.", async ({ scope, ctx }) => {
    const svc = stores(ctx);
    const where =
      scope.ownerId != null
        ? { ownerId: scope.ownerId }
        : scope.deviceId != null
          ? { deviceId: scope.deviceId }
          : undefined;
    if (!where) return { status: 200, body: { conversations: [] } };
    const rows = await svc.docs.query({
      collection: CONVERSATIONS,
      where,
      orderBy: "updatedAt",
      orderDir: "desc",
      limit: 200,
    });
    return { status: 200, body: { conversations: rows.map(conversationView) } };
  });

  const get = httpOp("chat.conversations.get", "One conversation (scope-checked).", async ({ params, scope, ctx }) => {
    const hit = await loadConversation(stores(ctx), String(params.id ?? ""), scope);
    if ("error" in hit) return hit.error;
    return { status: 200, body: conversationView(hit.row) };
  });

  const del = httpOp(
    "chat.conversations.delete",
    "Delete a conversation and its turns (scope-checked).",
    async ({ params, scope, ctx }) => {
      const svc = stores(ctx);
      const id = String(params.id ?? "");
      const hit = await loadConversation(svc, id, scope);
      if ("error" in hit) return hit.error;
      const turns = await svc.docs.query({ collection: TURNS, where: { conversationId: id }, limit: 1000 });
      for (const t of turns) await svc.docs.delete(TURNS, t.id);
      await svc.docs.delete(CONVERSATIONS, id);
      return { status: 200, body: { ok: true } };
    },
  );

  const turnsList = httpOp(
    "chat.turns.list",
    "The conversation's turns with their persisted event logs (replay source).",
    async ({ params, scope, ctx }) => {
      const svc = stores(ctx);
      const id = String(params.id ?? "");
      const hit = await loadConversation(svc, id, scope);
      if ("error" in hit) return hit.error;
      const rows = await svc.docs.query({
        collection: TURNS,
        where: { conversationId: id },
        orderBy: "createdAt",
        orderDir: "asc",
        limit: 500,
      });
      return { status: 200, body: { turns: rows.map(turnView) } };
    },
  );

  const stop = httpOp(
    "chat.turn.stop",
    "Cancel a running turn (the run aborts; the sink writes the terminal state).",
    async ({ params, scope, ctx }) => {
      const svc = stores(ctx);
      const hit = await loadConversation(svc, String(params.id ?? ""), scope);
      if ("error" in hit) return hit.error;
      const turnRow = await svc.docs.get(TURNS, String(params.turnId ?? ""));
      const turn = turnRow?.data as unknown as TurnDoc | undefined;
      if (!turnRow || !turn || turn.conversationId !== String(params.id)) {
        return { status: 404, body: { error: "turn not found" } };
      }
      // Streaming runs settle for the engine before the turn finishes — the
      // provider's turn-abort registry is the live handle; cancelRun covers
      // any non-streaming remainder.
      const agents = ctx.services[AGENTS_SERVICE] as AgentsService | undefined;
      const viaTurn = agents?.abortTurn(String(params.turnId), new Error("stopped from chat")) ?? false;
      const viaRun = getEngine()?.cancelRun(turn.runId, new Error("stopped from chat")) ?? false;
      return { status: 200, body: { ok: true, cancelled: viaTurn || viaRun } };
    },
  );

  /* ── pipeline bookends ───────────────────────────────────────────────── */

  const begin: OpDefinition = {
    type: "chat.turn.begin",
    title: "chat.turn.begin",
    description:
      "Turn pipeline entry: scope-check, claim the conversation lease (owner = this run — auto-released on settle), " +
      "persist the user message, hand history + input to the agent. Conflict → ok:false + 409 payload.",
    reusable: false,
    config: z.object({
      /** Lease TTL (crash backstop) in ms. */
      ttlMs: z.number().int().positive().default(5 * 60 * 1000),
    }),
    inputs: {
      params: value(recordSchema),
      body: value(z.unknown()),
      headers: value(stringRecord),
      user: value(),
    },
    outputs: {
      ok: value(z.boolean()),
      status: value(z.number()),
      error: value(),
      input: value(z.array(messagePartSchema)),
      history: value(z.array(z.unknown())),
      turnId: value(z.string()),
      turn: value(), // meta bundle for the sink
    },
    execute: async (ctx) => {
      const svc = stores(ctx);
      const [params, body, headers, user] = await Promise.all([
        maybe<Record<string, unknown>>(ctx, "params"),
        maybe(ctx, "body"),
        maybe<Record<string, string>>(ctx, "headers"),
        maybe<{ id?: string } | null>(ctx, "user"),
      ]);
      const scope = scopeOf(user ?? null, headers);
      const conversationId = String(obj(params).id ?? "");
      const fail = (status: number, error: Record<string, unknown>) => ({
        ok: false,
        status,
        error,
        input: [],
        history: [],
        turnId: "",
        turn: null,
      });

      const hit = await loadConversation(svc, conversationId, scope);
      if ("error" in hit) return fail(hit.error.status, obj(hit.error.body));

      // Content: parts array (or a bare string for curl-friendliness).
      const raw = obj(body).content;
      const parts = typeof raw === "string" ? [{ type: "text", text: raw }] : raw;
      const parsed = z.array(messagePartSchema).min(1).safeParse(parts);
      if (!parsed.success) {
        return fail(400, { error: "content must be a non-empty array of {text | image_ref} parts" });
      }

      // One turn at a time. Owner is the TURN (not the runId): a streaming
      // run settles for the engine while the SSE tail still flows, so the
      // store's run-settle auto-release would drop the lock mid-turn — the
      // sink releases it at the terminal event instead; TTL is the backstop.
      const { ttlMs } = ctx.config as { ttlMs: number };
      const requestedId = String(obj(body).turnId ?? "");
      const turnId = SAFE_ID.test(requestedId) ? requestedId : crypto.randomUUID();
      const lease = await svc.leases.acquire(`chat:conversation:${conversationId}`, `turn:${turnId}`, ttlMs);
      if (!lease.ok) {
        const running = await svc.docs.query({
          collection: TURNS,
          where: { conversationId, status: "running" },
          limit: 1,
        });
        return fail(409, {
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
        status: 200,
        error: null,
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
      params: value(recordSchema),
      body: value(z.unknown()),
      headers: value(stringRecord),
      user: value(),
    },
    outputs: {
      ok: value(z.boolean()),
      status: value(z.number()),
      error: value(),
      stateToken: value(z.string()),
      decisions: value(),
      turnId: value(z.string()),
      turn: value(),
    },
    execute: async (ctx) => {
      const svc = stores(ctx);
      const [params, body, headers, user] = await Promise.all([
        maybe<Record<string, unknown>>(ctx, "params"),
        maybe(ctx, "body"),
        maybe<Record<string, string>>(ctx, "headers"),
        maybe<{ id?: string } | null>(ctx, "user"),
      ]);
      const scope = scopeOf(user ?? null, headers);
      const conversationId = String(obj(params).id ?? "");
      const turnId = String(obj(params).turnId ?? "");
      const fail = (status: number, error: Record<string, unknown>) => ({
        ok: false,
        status,
        error,
        stateToken: "",
        decisions: [],
        turnId,
        turn: null,
      });

      const hit = await loadConversation(svc, conversationId, scope);
      if ("error" in hit) return fail(hit.error.status, obj(hit.error.body));
      const turnRow = await svc.docs.get(TURNS, turnId);
      const turn = turnRow?.data as unknown as TurnDoc | undefined;
      if (!turn || turn.conversationId !== conversationId) return fail(404, { error: "turn not found" });
      if (turn.status !== "interrupted" || !turn.stateToken) {
        return fail(409, { error: "turn is not awaiting approval", code: "not_interrupted" });
      }

      const decision = obj(body);
      const decisions = Array.isArray(decision.decisions)
        ? decision.decisions
        : [{ id: decision.interruptionId ?? decision.id, approved: Boolean(decision.approved) }];

      const { ttlMs } = ctx.config as { ttlMs: number };
      const lease = await svc.leases.acquire(`chat:conversation:${conversationId}`, `turn:${turnId}`, ttlMs);
      if (!lease.ok) {
        return fail(409, { error: "a turn is already running", code: "turn_in_progress", activeRunId: lease.owner });
      }

      // The resume continues the SAME turn doc (one event log per turn).
      await casPut(svc, TURNS, turnId, (data) => ({ ...data, status: "running", runId: ctx.runId }));
      const rooms: string[] = [];
      if (scope.ownerId) rooms.push(`user:${scope.ownerId}`);
      return {
        ok: true,
        status: 200,
        error: null,
        stateToken: turn.stateToken,
        decisions,
        turnId,
        turn: { conversationId, turnId, rooms, ttlMs },
      };
    },
  };

  return [create, list, get, del, turnsList, stop, begin, sink, approvalBegin];
}

export { makeOps as chatOps };
