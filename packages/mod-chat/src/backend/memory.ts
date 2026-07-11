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
  "From the exchange, pick out durable facts worth remembering in FUTURE conversations: stable preferences, " +
  "personal facts they shared, ongoing projects, standing constraints. Never keep small talk, one-off requests, " +
  "sensitive data (passwords, card numbers), or things only the assistant said. " +
  'Answer with ONLY a JSON array of short, standalone, third-person statements (e.g. ["User\'s dog is called Rex"]). ' +
  "Answer [] when nothing qualifies. Five statements maximum.";

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

/** Parse the model's answer defensively: first JSON array wins, junk is dropped. */
function parseStatements(text: string, max: number): string[] {
  const raw = /\[[\s\S]*?\]/.exec(text)?.[0];
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 300)
      .slice(0, max);
  } catch {
    return [];
  }
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

      const { text } = await aiModelService(ctx).generateText({
        ctx,
        signal: ctx.signal,
        system: EXTRACT_SYSTEM,
        messages: [{ role: "user", content: `User message:\n${userText}\n\nAssistant reply:\n${reply}` }],
        // modelRef omitted → the app's default alias
      });
      const statements = parseStatements(text, cfg.maxPerTurn);
      if (!statements.length) return { result: { ok: true, memories: 0 } };

      await ensureCollection(vec);
      const learnedAt = new Date().toISOString();
      await vec.upsert(
        cfg.collection,
        statements.map((s) => ({
          id: memoryId(ownerId, s),
          text: s,
          meta: {
            userId: ownerId,
            conversationId: payload.conversationId ?? "",
            sourceRunId: payload.runId ?? "",
            learnedAt,
          },
        })),
        ctx,
      );
      return { result: { ok: true, memories: statements.length, user: ownerId } };
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
        const block =
          "\n\n## Things you remember about this user (from earlier conversations)\n" +
          matches.map((m) => `- ${m.text ?? ""}`).join("\n") +
          "\nUse them naturally when relevant — don't recite them.";
        return { instructions: base + block };
      } catch {
        // Unknown collection (nothing extracted yet), embedder down, anything:
        // the turn proceeds without memories.
        return { instructions: base };
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

  return [extract, recall, memoriesList, memoryForget];
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
