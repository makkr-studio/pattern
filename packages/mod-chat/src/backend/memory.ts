/**
 * @pattern-js/mod-chat — cross-conversation, per-user memory (0.4).
 *
 * Two ops and one event-triggered workflow, and NO new dependencies: vectors
 * and the model service are duck-typed by well-known key, so without
 * @pattern-js/mod-vectors (or an embedding alias) chat runs exactly as before.
 *
 *  - `chat.memory.extract` runs AFTER a turn, in its own run (triggered by the
 *    `chat.turn.completed` event the sink emits): a one-shot model call decides
 *    whether the exchange taught us something durable about the user, and
 *    indexes each statement with provenance meta — { userId, conversationId,
 *    sourceRunId } — so every memory can answer "where did you learn that?"
 *    with a link to the exact run.
 *  - `chat.memory.recall` sits in the turn pipeline in front of the agent's
 *    `instructions` port: top-k memories for THIS user (filterable pre-scan
 *    pruning — one user's memories never rank against another's), appended to
 *    the system prompt. It must never break a turn: any failure falls back to
 *    the plain instructions.
 *
 * Signed-in users only — guests have no durable identity to remember.
 */

import { value, z, type OpContext, type OpDefinition, type Workflow } from "@pattern-js/core";
import { aiModelService } from "@pattern-js/mod-agents";
import { stores, TURNS, type TurnDoc } from "./data.js";
import type { ResolvedChatOptions } from "./options.js";

/** Duck-typed slice of @pattern-js/mod-vectors' service (never a package dep). */
export interface VectorsLike {
  ensureCollection(spec: { name: string; alias: string; metric: "cosine"; filterables: string[] }): Promise<void>;
  listCollections(): Promise<Array<{ name: string }>>;
  upsert(
    collection: string,
    items: Array<{ id?: string; text: string; meta?: Record<string, unknown> }>,
    ctx: OpContext,
  ): Promise<{ count: number; embedded: number }>;
  query(
    collection: string,
    input: { text?: string; k?: number; filter?: Record<string, unknown>; mode?: string },
    ctx: OpContext,
  ): Promise<Array<{ id: string; score: number; text: string | null; meta: Record<string, unknown> | null }>>;
  list(
    collection: string,
    q?: { filter?: Record<string, unknown>; limit?: number; offset?: number },
  ): Promise<Array<{ id: string; text: string | null; meta: Record<string, unknown> | null; updatedAt: number }>>;
  delete(collection: string, ids: string[]): Promise<number>;
}

export const vectorsOf = (ctx: OpContext): VectorsLike | undefined =>
  ctx.services["vectorsService"] as VectorsLike | undefined;

/** Duck-typed slice of mod-ai's alias config — enough to probe for the embedding alias. */
interface AiConfigLike {
  alias(name: string): { modality?: string } | undefined;
}

const EXTRACT_SYSTEM =
  "You maintain long-term memory about a user, extracted from their conversations with an assistant. " +
  "You receive the exchange AND the user's existing nearby memories (with ids). Reconcile them: answer with " +
  "ONLY a JSON array of operations —\n" +
  '- {"op":"add","text":"…"} for a NEW durable fact worth keeping in FUTURE conversations (stable preferences, ' +
  "personal facts, ongoing projects, standing constraints), written as a short standalone third-person statement;\n" +
  '- {"op":"supersede","id":"…","text":"…"} when an existing memory is now outdated, refined or contradicted — ' +
  "the new text replaces it;\n" +
  '- {"op":"forget","id":"…"} when the user asked to forget it or it is plainly no longer true.\n' +
  "Never store small talk, one-off requests, sensitive data (passwords, card numbers), or things only the " +
  "assistant said. Never add a fact an existing memory already states — supersede or leave it. " +
  "Answer [] when nothing qualifies. Five operations maximum.";

type MemoryOp = { op: "add"; text: string } | { op: "supersede"; id: string; text: string } | { op: "forget"; id: string };

/** Text of the user's message parts (images etc. are skipped). */
function partsText(parts: unknown[]): string {
  return parts
    .map((p) => (typeof (p as { text?: string }).text === "string" ? (p as { text: string }).text : ""))
    .filter(Boolean)
    .join("\n");
}

/** The assistant's reply, reassembled from the turn's coalesced text deltas. */
function assistantText(events: Array<{ type?: string; delta?: string }>): string {
  return events
    .filter((e) => e.type === "text.delta" && typeof e.delta === "string")
    .map((e) => e.delta)
    .join("");
}

/** Deterministic per-user statement id — re-learning the same fact is an upsert, not a duplicate. */
function memoryId(ownerId: string, statement: string): string {
  let h = 5381;
  const s = `${ownerId}::${statement}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `mem-${h.toString(36)}`;
}

/** Parse the model's answer defensively: first JSON array wins, junk is
 *  dropped; a bare string is treated as an `add` (older prompt shape). */
function parseOps(text: string, max: number): MemoryOp[] {
  const raw = /\[[\s\S]*\]/.exec(text)?.[0];
  if (!raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const okText = (t: unknown): t is string => typeof t === "string" && t.trim().length > 0 && t.length <= 300;
  const out: MemoryOp[] = [];
  for (const item of arr) {
    if (okText(item)) out.push({ op: "add", text: item.trim() });
    else if (item && typeof item === "object") {
      const o = item as { op?: string; id?: string; text?: string };
      if (o.op === "add" && okText(o.text)) out.push({ op: "add", text: o.text.trim() });
      else if (o.op === "supersede" && typeof o.id === "string" && okText(o.text)) out.push({ op: "supersede", id: o.id, text: o.text.trim() });
      else if (o.op === "forget" && typeof o.id === "string") out.push({ op: "forget", id: o.id });
    }
    if (out.length >= max) break;
  }
  return out;
}

export function memoryOps(opts: ResolvedChatOptions): OpDefinition[] {
  const cfg = opts.memory;

  const ensured = { done: false };
  async function ensureCollection(vec: VectorsLike): Promise<void> {
    if (ensured.done) return;
    const exists = (await vec.listCollections()).some((c) => c.name === cfg.collection);
    if (!exists) await vec.ensureCollection({ name: cfg.collection, alias: cfg.alias, metric: "cosine", filterables: ["userId"] });
    ensured.done = true;
  }

  const extract: OpDefinition = {
    type: "chat.memory.extract",
    title: "chat.memory.extract",
    description:
      "Turn-end memory extraction: a one-shot model call picks the durable facts about the user out of the " +
      "completed exchange and indexes them (collection declared with filterables: [userId]) with provenance meta " +
      "{ userId, conversationId, sourceRunId }. Skips guests, and no-ops without mod-vectors, a model, or the " +
      "embedding alias — chat never depends on memory being possible.",
    reusable: false,
    inputs: { payload: value() },
    outputs: { result: value() },
    execute: async (ctx) => {
      const skip = (reason: string) => ({ result: { ok: true, skipped: reason } });
      if (!cfg.enabled) return skip("memory disabled");
      const payload = ((await ctx.input.value("payload")) ?? {}) as {
        conversationId?: string;
        turnId?: string;
        ownerId?: string | null;
        runId?: string;
      };
      const ownerId = payload.ownerId ?? null;
      if (!ownerId) return skip("guest turn — no durable user identity");
      const vec = vectorsOf(ctx);
      if (!vec) return skip("mod-vectors not installed");
      const aiConfig = ctx.services["aiConfig"] as AiConfigLike | undefined;
      if (aiConfig && !aiConfig.alias(cfg.alias)) return skip(`no "${cfg.alias}" embedding alias configured`);

      const turnRow = await stores(ctx).docs.get(TURNS, String(payload.turnId ?? ""));
      if (!turnRow) return skip("turn doc not found");
      const turn = turnRow.data as unknown as TurnDoc;
      const userText = partsText(turn.input ?? []).slice(0, 2000);
      const reply = assistantText((turn.events ?? []) as Array<{ type?: string; delta?: string }>).slice(0, 4000);
      if (!userText.trim()) return skip("no user text in this turn");

      // Reconciliation context: the user's memories NEAR this exchange, ids
      // included, so the model can supersede/forget instead of duplicating.
      const neighbors = await vec
        .query(cfg.collection, { text: userText.slice(0, 1000), k: 6, filter: { userId: ownerId }, mode: "hybrid" }, ctx)
        .catch(() => []); // collection not created yet — no neighbors
      const neighborIds = new Set(neighbors.map((n) => n.id));
      const existing = neighbors.length
        ? `Existing memories about this user (nearby):\n${neighbors.map((n) => `- [${n.id}] ${n.text ?? ""}`).join("\n")}\n\n`
        : "";

      // A "memory" alias (point it at a mini model — this is classification,
      // not prose) wins; otherwise the app's default model.
      const aiCfgFull = ctx.services["aiConfig"] as (AiConfigLike & { resolveAlias?(name: string): unknown }) | undefined;
      const modelRef = aiCfgFull?.resolveAlias?.("memory");

      const { text } = await aiModelService(ctx).generateText({
        ctx,
        signal: ctx.signal,
        system: EXTRACT_SYSTEM,
        messages: [{ role: "user", content: `${existing}User message:\n${userText}\n\nAssistant reply:\n${reply}` }],
        ...(modelRef ? { modelRef: modelRef as never } : {}),
      });
      const ops = parseOps(text, cfg.maxPerTurn);
      if (!ops.length) return { result: { ok: true, memories: 0 } };

      await ensureCollection(vec);
      const learnedAt = new Date().toISOString();
      const meta = (revises?: string) => ({
        userId: ownerId,
        conversationId: payload.conversationId ?? "",
        sourceRunId: payload.runId ?? "",
        learnedAt,
        ...(revises ? { revises } : {}),
      });
      let added = 0;
      let superseded = 0;
      let forgotten = 0;
      for (const op of ops) {
        // Ids must come from the neighbor set — a hallucinated id must never
        // touch another user's (or a random) row.
        if (op.op === "forget" && neighborIds.has(op.id)) {
          forgotten += await vec.delete(cfg.collection, [op.id]);
        } else if (op.op === "supersede" && neighborIds.has(op.id)) {
          await vec.delete(cfg.collection, [op.id]);
          await vec.upsert(cfg.collection, [{ id: memoryId(ownerId, op.text), text: op.text, meta: meta(op.id) }], ctx);
          superseded++;
        } else if (op.op === "add") {
          await vec.upsert(cfg.collection, [{ id: memoryId(ownerId, op.text), text: op.text, meta: meta() }], ctx);
          added++;
        }
      }

      // The growth cap: keep the newest maxMemories per user (list is
      // newest-first) — memory is a working set, not an archive.
      const rows = await vec.list(cfg.collection, { filter: { userId: ownerId }, limit: cfg.maxMemories + 50 });
      if (rows.length > cfg.maxMemories) {
        await vec.delete(cfg.collection, rows.slice(cfg.maxMemories).map((r) => r.id));
      }

      return { result: { ok: true, user: ownerId, added, superseded, forgotten } };
    },
  };

  const recall: OpDefinition = {
    type: "chat.memory.recall",
    title: "chat.memory.recall",
    description:
      "Per-user memory recall in the turn pipeline: top-k memories for THIS user (hybrid search, filter-pruned " +
      "by userId) appended to the system prompt. Guests, missing mod-vectors, or ANY retrieval failure fall back " +
      "to the plain instructions — memory may enrich a turn, never break one. Config { fallback } is the base " +
      "instructions used when nothing is wired in.",
    reusable: false,
    config: z.object({ fallback: z.string().default("") }),
    inputs: {
      instructions: value(z.string().optional()),
      user: value(),
      content: value(),
    },
    outputs: { instructions: value(z.string()) },
    execute: async (ctx) => {
      const fallback = (ctx.config as { fallback: string }).fallback;
      const incoming = ctx.input.has("instructions") ? await ctx.input.value("instructions") : undefined;
      const base = typeof incoming === "string" && incoming.trim() ? incoming : fallback;
      try {
        if (!cfg.enabled) return { instructions: base };
        // The trigger's `user` port is the sanitized principal: null for
        // guests, { id, provider, … } (no `kind`) for signed-in users.
        const user = ctx.input.has("user")
          ? ((await ctx.input.value("user")) as { id?: string } | null)
          : null;
        const ownerId = user && typeof user.id === "string" && user.id ? user.id : null;
        const vec = vectorsOf(ctx);
        if (!ownerId || !vec) return { instructions: base };
        const query = partsText(((ctx.input.has("content") ? await ctx.input.value("content") : []) as unknown[]) ?? []);
        if (!query.trim()) return { instructions: base };
        const matches = await vec.query(
          cfg.collection,
          { text: query.slice(0, 1000), k: cfg.recallK, filter: { userId: ownerId }, mode: "hybrid" },
          ctx,
        );
        if (!matches.length) return { instructions: base };
        // Hard prompt budget: whatever recallK says, the block never exceeds
        // ~1200 chars (≈300 tokens) — memory must never crowd the context.
        const lines: string[] = [];
        let budget = 1200;
        for (const m of matches) {
          const line = `- ${m.text ?? ""}`;
          if (line.length > budget) break;
          budget -= line.length;
          lines.push(line);
        }
        if (!lines.length) return { instructions: base };
        const block =
          "\n\n## Things you remember about this user (from earlier conversations)\n" +
          lines.join("\n") +
          "\nUse them naturally when relevant — don't recite them.";
        return { instructions: base + block };
      } catch {
        // Unknown collection (nothing extracted yet), embedder down, anything:
        // the turn proceeds without memories.
        return { instructions: base };
      }
    },
  };

  const save: OpDefinition = {
    type: "chat.memory.save",
    title: "chat.memory.save",
    description:
      "The body of the `remember` tool: save one durable fact about the CURRENT user (the tool sub-run inherits " +
      "the chat principal) with provenance meta — sourceRunId is the tool call's own run, so the memory's receipt " +
      "is the very moment the agent decided to remember. Signed-in users only.",
    reusable: false,
    inputs: { fact: value(z.string()) },
    outputs: { result: value() },
    execute: async (ctx) => {
      const fact = String((await ctx.input.value("fact")) ?? "").trim();
      if (!fact) return { result: { ok: false, error: "nothing to remember" } };
      if (!cfg.enabled) return { result: { ok: false, error: "memory is disabled" } };
      const vec = vectorsOf(ctx);
      if (!vec) return { result: { ok: false, error: "memory is not available (mod-vectors is not installed)" } };
      const p = ctx.principal as { kind?: string; id?: string };
      const ownerId = p?.kind === "user" && p.id ? p.id : null;
      if (!ownerId) return { result: { ok: false, error: "guests have no long-term memory — sign in first" } };
      // Same probe as the extractor: without the embedding alias, answer with
      // words the agent can relay — never a stack trace in the chat.
      const aiConfig = ctx.services["aiConfig"] as AiConfigLike | undefined;
      if (aiConfig && !aiConfig.alias(cfg.alias)) {
        return { result: { ok: false, error: `memory needs an "${cfg.alias}" embedding alias — add it in admin → Settings → AI Providers` } };
      }
      try {
        await ensureCollection(vec);
        await vec.upsert(
          cfg.collection,
          [
            {
              id: memoryId(ownerId, fact),
              text: fact.slice(0, 300),
              meta: { userId: ownerId, conversationId: "", sourceRunId: ctx.runId, learnedAt: new Date().toISOString(), via: "remember" },
            },
          ],
          ctx,
        );
        return { result: { ok: true, remembered: fact.slice(0, 300) } };
      } catch (err) {
        return { result: { ok: false, error: `couldn't save the memory: ${(err as Error).message}` } };
      }
    },
  };

  const memoriesList: OpDefinition = {
    type: "chat.admin.memories",
    title: "chat.admin.memories",
    description:
      "Every remembered fact, newest first (admin): who it's about, the statement, when it was learned — and the " +
      "provenance ids (source run, conversation) that answer \"where did you learn that?\". Empty without mod-vectors.",
    reusable: false,
    sensitivity: "privileged",
    inputs: {},
    outputs: { memories: value() },
    execute: async (ctx) => {
      const vec = vectorsOf(ctx);
      if (!vec || !cfg.enabled) return { memories: [] };
      try {
        const rows = await vec.list(cfg.collection, { limit: 500 });
        return {
          memories: rows.map((r) => ({
            id: r.id,
            user: String(r.meta?.userId ?? "—"),
            memory: r.text ?? "",
            learned: String(r.meta?.learnedAt ?? new Date(r.updatedAt).toISOString()),
            conversation: String(r.meta?.conversationId ?? ""),
            sourceRunId: String(r.meta?.sourceRunId ?? ""),
          })),
        };
      } catch {
        return { memories: [] }; // collection not created yet — nothing remembered
      }
    },
  };

  const memoryForget: OpDefinition = {
    type: "chat.admin.memory.forget",
    title: "chat.admin.memory.forget",
    description: "Delete one remembered fact (admin) — the right to be forgotten, one row at a time. Args { id }.",
    reusable: false,
    sensitivity: "privileged",
    inputs: { id: value(z.string()) },
    outputs: { result: value() },
    execute: async (ctx) => {
      const vec = vectorsOf(ctx);
      if (!vec) throw new Error("mod-vectors is not installed — there is no memory to forget");
      const id = String((await ctx.input.value("id")) ?? "");
      const deleted = await vec.delete(cfg.collection, [id]);
      return { result: { ok: true, deleted } };
    },
  };

  return [extract, recall, save, memoriesList, memoryForget];
}

/**
 * The `remember` tool: remembering as a VISIBLE act. The chat UI already
 * renders tool calls live, so the user watches the agent decide to remember —
 * and the agent can acknowledge it in the same breath. Auto-extraction stays
 * as the backstop for what the agent didn't think to save.
 */
export function rememberToolWorkflow(): Workflow {
  return {
    id: "chat.tool.remember",
    name: "remember (chat memory tool)",
    description: "Agent-invoked memory: save one durable fact about the current user, visibly, mid-conversation.",
    source: "code",
    internal: false,
    nodes: [
      {
        id: "in",
        op: "boundary.tool",
        config: {
          name: "remember",
          description:
            "Save one durable fact about the user to your long-term memory (persists across conversations). " +
            "Use it when the user shares a stable preference, personal fact or standing constraint — or asks you " +
            "to remember something. Phrase the fact as a short standalone third-person statement.",
          params: {
            type: "object",
            properties: { fact: { type: "string", description: 'e.g. "User\'s dog is called Rex"' } },
            required: ["fact"],
          },
        },
        ui: { x: 60, y: 120, pair: "out" },
      },
      { id: "args", op: "core.object.extract", config: { keys: ["fact"] }, ui: { x: 320, y: 120 } },
      { id: "save", op: "chat.memory.save", ui: { x: 580, y: 120 } },
      { id: "out", op: "boundary.tool.return", ui: { x: 840, y: 120, pair: "in" } },
    ],
    edges: [
      { from: { node: "in", port: "args" }, to: { node: "args", port: "object" } },
      { from: { node: "args", port: "fact" }, to: { node: "save", port: "fact" } },
      { from: { node: "save", port: "result" }, to: { node: "out", port: "result" } },
    ],
  };
}

/** The packaged extraction pipeline: turn completed → extract. Fork it to reshape what "memorable" means. */
export function memoryPipelineWorkflow(): Workflow {
  return {
    id: "chat.memory.pipeline",
    name: "Chat · memory extraction (chat.turn.completed)",
    description:
      "Runs after every completed chat turn: decides whether the exchange taught us something durable about the " +
      "user and indexes it with provenance. Each execution is an ordinary run — open it to see exactly what was " +
      "learned, from what.",
    source: "code",
    internal: false,
    nodes: [
      { id: "in", op: "boundary.event", config: { event: "chat.turn.completed" } },
      { id: "extract", op: "chat.memory.extract" },
    ],
    edges: [{ from: { node: "in", port: "payload" }, to: { node: "extract", port: "payload" } }],
  };
}
