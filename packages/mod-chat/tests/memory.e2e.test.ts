/**
 * Cross-conversation memory e2e (0.4): a completed turn triggers extraction
 * (its own event-driven run) which indexes provenance-stamped memories; the
 * next turn recalls them into the system prompt; guests never extract; the
 * admin ops list + forget. Scripted model turns keep it deterministic: the
 * agent's reply pops turns[0], the extraction call pops turns[1].
 *
 * Ports: 4981+ (chat.e2e holds 4941+, the crash test 4966).
 */
import { describe, it, expect, afterEach } from "vitest";
import { Engine, type OpContext } from "@pattern-js/core";
import { createHttpHost } from "@pattern-js/runtime-node";
import { storeMod } from "@pattern-js/mod-store";
import { agentsMod, AI_MODEL_SERVICE } from "@pattern-js/mod-agents";
import { aiMod } from "../../mod-ai/src/index.js";
import { vectorsMod, VECTORS_SERVICE, type VectorsService } from "../../mod-vectors/src/index.js";
import { scriptedModelService, type ScriptedTurn } from "../../mod-agents/tests/scripted-model-service.js";
import { chatMod } from "../src/backend/mod.js";

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

/** Char-frequency embedder — deterministic, no vocab assumptions. */
const fakeEmbed = (text: string): number[] => {
  const v = new Array(26).fill(0);
  for (const ch of text.toLowerCase()) {
    const i = ch.charCodeAt(0) - 97;
    if (i >= 0 && i < 26) v[i] += 1;
  }
  return v;
};
const fakeProvider = {
  textEmbeddingModel: async () => ({
    doEmbed: async ({ values }: { values: string[] }) => ({ embeddings: values.map(fakeEmbed) }),
  }),
};
/** Just enough of mod-ai's alias config: the "embeddings" alias exists. */
const fakeAiConfig = {
  aliases: () => [],
  alias: (name: string) => (name === "embeddings" ? { name, modality: "embedding" } : undefined),
  resolveAlias: () => undefined,
  defaultModel: () => undefined,
};

let port = 4980;

async function boot(turns: ScriptedTurn[], opts: { vectors?: boolean } = {}) {
  port += 1;
  const engine = new Engine();
  engine.registerAuthProvider({
    name: "header",
    async authenticate({ headers }) {
      const id = headers.get("x-user");
      return id ? { kind: "user", id, provider: "header", claims: { name: id } } : null;
    },
  });
  await engine.useAsync(storeMod({ storage: "memory" }), { deferReady: true });
  await engine.useAsync(agentsMod(), { deferReady: true });
  await engine.useAsync(aiMod(), { deferReady: true });
  if (opts.vectors !== false) await engine.useAsync(vectorsMod({ path: ":memory:" }), { deferReady: true });
  const chat = chatMod({ guardrail: false });
  await engine.useAsync(chat, { deferReady: true });
  await chat.ready?.(engine);
  const scripted = scriptedModelService(turns);
  engine.provideService(AI_MODEL_SERVICE, scripted);
  engine.provideService("aiProviderService", fakeProvider);
  engine.provideService("aiConfig", fakeAiConfig);
  const { close } = await createHttpHost(engine, { defaultPort: port }).start();
  closer = close;
  const vectors = engine.service<VectorsService>(VECTORS_SERVICE);
  return { engine, base: `http://localhost:${port}`, scripted, vectors };
}

async function conversationAs(base: string, user?: string): Promise<{ id: string; headers: Record<string, string> }> {
  const headers: Record<string, string> = user ? { "x-user": user } : {};
  const res = await fetch(`${base}/chat/api/default/conversations`, { method: "POST", body: "{}", headers });
  expect(res.status).toBe(201);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  return { id: ((await res.json()) as { id: string }).id, headers: { ...headers, cookie, "content-type": "application/json" } };
}

async function runTurn(base: string, conv: { id: string; headers: Record<string, string> }, text: string): Promise<void> {
  const res = await fetch(`${base}/chat/api/default/conversations/${conv.id}/turns`, {
    method: "POST",
    headers: conv.headers,
    body: JSON.stringify({ content: [{ type: "text", text }] }),
  });
  expect(res.status).toBe(200);
  await res.text(); // drain the SSE — the turn (and the sink) settle
}

/** The extraction run is fire-and-forget — poll for its effect. */
async function until<T>(probe: () => Promise<T | undefined>, ms = 4000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const got = await probe().catch(() => undefined);
    if (got !== undefined) return got;
    if (Date.now() > deadline) throw new Error("condition not reached in time");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const opCtx = (services: Record<string, unknown>): OpContext =>
  ({ services, env: {}, principal: { kind: "anonymous" }, signal: undefined }) as unknown as OpContext;

describe("chat memory (per-user, cross-conversation, with receipts)", () => {
  it("a completed turn extracts memories with provenance meta pointing at the turn's run", async () => {
    const { base, vectors, engine } = await boot([
      { kind: "text", text: "Bonjour Ada! Nice to meet Rex." },
      { kind: "text", text: '["User\'s dog is called Rex", "User prefers answers in French"]' },
    ]);
    const conv = await conversationAs(base, "ada");
    await runTurn(base, conv, "My dog is called Rex, and please always answer me in French.");

    const rows = await until(async () => {
      const r = await vectors!.list("chat.memories");
      return r.length >= 2 ? r : undefined;
    });
    const rex = rows.find((r) => r.text?.includes("Rex"))!;
    expect(rex.meta).toMatchObject({ userId: "ada", conversationId: conv.id });

    // The receipt: sourceRunId is the TURN's run — the moment it was learned.
    const stores = engine.service<{ docs: { query(q: object): Promise<Array<{ data: { runId?: string } }>> } }>("storeService")!;
    const turns = await stores.docs.query({ collection: "chat.turns", where: { conversationId: conv.id }, limit: 10 });
    expect(rex.meta?.sourceRunId).toBe(turns[0]!.data.runId);

    // The admin surface: list shows it, forget removes it.
    const listOp = engine.ops.get("chat.admin.memories")!;
    const listed = (await listOp.execute(opCtx({ vectorsService: vectors }))) as {
      memories: Array<{ id: string; user: string; memory: string; sourceRunId: string }>;
    };
    expect(listed.memories.some((m) => m.user === "ada" && m.memory.includes("Rex"))).toBe(true);

    const forgetOp = engine.ops.get("chat.admin.memory.forget")!;
    const bag = { id: rex.id };
    await forgetOp.execute({
      ...opCtx({ vectorsService: vectors }),
      input: { has: (k: string) => k in bag, value: async (k: string) => (bag as Record<string, string>)[k] },
    } as unknown as OpContext);
    expect((await vectors!.list("chat.memories")).some((r) => r.id === rex.id)).toBe(false);
  });

  it("the next turn — in a NEW conversation — recalls the memory into the system prompt", async () => {
    const { base, vectors, scripted } = await boot([
      { kind: "text", text: "Your dog is called Rex!" },
      { kind: "text", text: "[]" }, // the post-turn extraction call — learns nothing new here
    ]);
    await vectors!.ensureCollection({ name: "chat.memories", alias: "embeddings", metric: "cosine", filterables: ["userId"] });
    await vectors!.upsert(
      "chat.memories",
      [
        { id: "m1", text: "User's dog is called Rex", meta: { userId: "ada" } },
        { id: "m2", text: "User's cat is called Mia", meta: { userId: "grace" } }, // someone else's — must not leak
      ],
      opCtx({ aiProviderService: fakeProvider }),
    );

    const conv = await conversationAs(base, "ada");
    await runTurn(base, conv, "Remind me what my dog is called?");

    // calls[0] is the AGENT's turn (calls[1] is the post-turn extraction).
    const system = String(scripted.calls[0]?.system ?? "");
    expect(system).toContain("Things you remember about this user");
    expect(system).toContain("Rex");
    expect(system).not.toContain("Mia"); // filter-pruned: grace's memories never rank for ada
  });

  it("guest turns never extract — no durable identity, no memory, no model call", async () => {
    const { base, scripted } = await boot([
      { kind: "text", text: "Hello stranger." },
      { kind: "text", text: "POISON — extraction must never pop this turn" },
    ]);
    const conv = await conversationAs(base); // no x-user: device-scoped guest
    await runTurn(base, conv, "My dog is called Rex.");
    await new Promise((r) => setTimeout(r, 400)); // give a wrong extraction time to happen
    expect(scripted.calls.length).toBe(1); // only the agent's own turn
  });
});
