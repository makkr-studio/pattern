import { afterEach, describe, expect, it } from "vitest";
import { Engine, type Workflow } from "@pattern/core";
import { createHttpHost } from "@pattern/runtime-node";
import { storeMod, STORE_SERVICE, type PatternStores } from "@pattern/mod-store";
import { agentsMod, type TurnEvent } from "@pattern/mod-agents";
import { agentsOpenAIMod, MODEL_PROVIDER_SERVICE } from "@pattern/mod-agents-openai";
import { chatMod, TURNS, type TurnDoc } from "../src/index.js";
import { scriptedProvider, type ScriptedTurn } from "../../mod-agents-openai/tests/scripted-model.js";

/**
 * The whole chat backend over a REAL HTTP host with a scripted model:
 * cookies, SSE streaming, the persisted event log (refresh recovery), the
 * 409 lease path + Stop, and the HITL approval round-trip.
 */

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

const weatherTool: Workflow = {
  id: "tool-weather",
  nodes: [
    {
      id: "in",
      op: "boundary.tool",
      config: {
        name: "get_weather",
        description: "Current weather for a city",
        params: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      },
    },
    { id: "tpl", op: "core.string.template", config: { template: "sunny in {{city}}" } },
    { id: "out", op: "boundary.tool.return" },
  ],
  edges: [
    { from: { node: "in", port: "args" }, to: { node: "tpl", port: "data" } },
    { from: { node: "tpl", port: "out" }, to: { node: "out", port: "result" } },
  ],
};

let port = 4940;

async function boot(turns: ScriptedTurn[], opts: { gatedTool?: boolean } = {}) {
  port += 1;
  const engine = new Engine();
  await engine.useAsync(storeMod({ storage: "memory" }), { deferReady: true });
  await engine.useAsync(agentsMod(), { deferReady: true });
  await engine.useAsync(agentsOpenAIMod(), { deferReady: true });
  const chat = chatMod();
  await engine.useAsync(chat, { deferReady: true });
  await chat.ready?.(engine);
  engine.provideService(MODEL_PROVIDER_SERVICE, scriptedProvider(turns));
  engine.registerWorkflow(
    opts.gatedTool
      ? {
          ...weatherTool,
          nodes: weatherTool.nodes.map((n) =>
            n.id === "in" ? { ...n, config: { ...(n.config as object), needsApproval: true } } : n,
          ),
        }
      : weatherTool,
  );
  const host = createHttpHost(engine, { defaultPort: port });
  const { close } = await host.start();
  closer = close;
  const base = `http://localhost:${port}`;
  const stores = engine.service<PatternStores>(STORE_SERVICE)!;
  return { engine, base, stores };
}

function sseEvents(text: string): TurnEvent[] {
  return text
    .split("\n\n")
    .filter((b) => b.startsWith("data: "))
    .map((b) => JSON.parse(b.slice(6)) as TurnEvent);
}

async function createConversation(base: string): Promise<{ id: string; cookie: string }> {
  const res = await fetch(`${base}/chat/api/conversations`, { method: "POST", body: "{}" });
  expect(res.status).toBe(201);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  expect(cookie).toContain("chat_device=");
  const body = (await res.json()) as { id: string };
  return { id: body.id, cookie };
}

describe("chat over HTTP (scripted model)", () => {
  it("conversation create → SSE turn → persisted event log → history saved", async () => {
    const { base, stores } = await boot([
      { kind: "text", text: "Bonjour Benoit!", deltas: ["Bon", "jour ", "Benoit!"] },
    ]);
    const { id, cookie } = await createConversation(base);

    const res = await fetch(`${base}/chat/api/conversations/${id}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ content: [{ type: "text", text: "salut" }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = sseEvents(await res.text());
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "complete" });
    expect(events.filter((e) => e.type === "text.delta").length).toBeGreaterThan(0);

    // The store is the source of truth: the turn doc carries the log + status.
    const turns = (await stores.docs.query({ collection: TURNS, where: { conversationId: id } })).map(
      (r) => r.data as unknown as TurnDoc,
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]!.status).toBe("complete");
    expect(turns[0]!.events.at(-1)).toMatchObject({ type: "done", stopReason: "complete" });

    // Replay endpoint (refresh recovery).
    const replay = await fetch(`${base}/chat/api/conversations/${id}/turns`, { headers: { cookie } });
    const replayBody = (await replay.json()) as { turns: Array<{ events: TurnEvent[]; status: string }> };
    expect(replayBody.turns[0]!.status).toBe("complete");

    // History landed on the conversation; the title took the first message.
    const conv = await fetch(`${base}/chat/api/conversations/${id}`, { headers: { cookie } });
    const convBody = (await conv.json()) as { title: string; historyLength: number };
    expect(convBody.title).toBe("salut");
    expect(convBody.historyLength).toBeGreaterThanOrEqual(2);

    // The lease released when the run settled.
    expect(await stores.leases.get(`chat:conversation:${id}`)).toBeNull();
  });

  it("agent tools work end-to-end through the pipeline", async () => {
    const { base } = await boot([
      { kind: "tool_call", name: "get_weather", callId: "c1", args: { city: "Paris" } },
      { kind: "text", text: "Sunny in Paris!" },
    ]);
    const { id, cookie } = await createConversation(base);
    const res = await fetch(`${base}/chat/api/conversations/${id}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ content: [{ type: "text", text: "weather?" }] }),
    });
    const events = sseEvents(await res.text());
    const tool = events.filter((e) => e.type === "tool.activity");
    expect(tool).toMatchObject([
      { phase: "start", toolName: "get_weather" },
      { phase: "done", result: "sunny in Paris" },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "complete" });
  });

  it("second concurrent turn → 409 with the active turn; Stop cancels it", async () => {
    const { base, stores } = await boot([{ kind: "hang" }]);
    const { id, cookie } = await createConversation(base);

    const turnId = crypto.randomUUID();
    // First turn hangs at the model — keep the connection open.
    const first = fetch(`${base}/chat/api/conversations/${id}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ turnId, content: [{ type: "text", text: "hang please" }] }),
    });

    // Wait until the turn doc exists (the pipeline reached begin).
    for (let i = 0; i < 100; i++) {
      const t = await stores.docs.get(TURNS, turnId);
      if (t) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const conflict = await fetch(`${base}/chat/api/conversations/${id}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ content: [{ type: "text", text: "me too" }] }),
    });
    expect(conflict.status).toBe(409);
    const conflictBody = (await conflict.json()) as { code: string; activeTurnId: string };
    expect(conflictBody.code).toBe("turn_in_progress");
    expect(conflictBody.activeTurnId).toBe(turnId);

    // Stop → the run aborts, the sink records the cancelled terminal state.
    const stop = await fetch(`${base}/chat/api/conversations/${id}/turns/${turnId}/stop`, {
      method: "POST",
      headers: { cookie },
    });
    expect(stop.status).toBe(200);
    expect(((await stop.json()) as { cancelled: boolean }).cancelled).toBe(true);

    const firstRes = await first;
    const events = sseEvents(await firstRes.text());
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "cancelled" });

    for (let i = 0; i < 100; i++) {
      const t = (await stores.docs.get(TURNS, turnId))?.data as unknown as TurnDoc;
      if (t.status === "cancelled") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const turn = (await stores.docs.get(TURNS, turnId))!.data as unknown as TurnDoc;
    expect(turn.status).toBe("cancelled");

    // The conversation is reusable immediately (lease auto-released).
    expect(await stores.leases.get(`chat:conversation:${id}`)).toBeNull();
  });

  it("scoping: another device cannot see the conversation", async () => {
    const { base } = await boot([]);
    const { id, cookie } = await createConversation(base);
    const mine = await fetch(`${base}/chat/api/conversations`, { headers: { cookie } });
    expect(((await mine.json()) as { conversations: unknown[] }).conversations).toHaveLength(1);

    const stranger = await fetch(`${base}/chat/api/conversations/${id}`);
    expect(stranger.status).toBe(404);
    const others = await fetch(`${base}/chat/api/conversations`, {
      headers: { cookie: "chat_device=someone-else" },
    });
    expect(((await others.json()) as { conversations: unknown[] }).conversations).toHaveLength(0);
  });

  it("HITL over HTTP: interrupted turn persists its stateToken; approve resumes THE SAME turn", async () => {
    const { base, stores } = await boot(
      [
        { kind: "tool_call", name: "get_weather", callId: "appr_1", args: { city: "Nice" } },
        { kind: "text", text: "Approved — sunny in Nice." },
      ],
      { gatedTool: true },
    );
    const { id, cookie } = await createConversation(base);

    const res = await fetch(`${base}/chat/api/conversations/${id}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ content: [{ type: "text", text: "weather in nice" }] }),
    });
    const events = sseEvents(await res.text());
    const approval = events.find((e) => e.type === "approval.request") as Extract<
      TurnEvent,
      { type: "approval.request" }
    >;
    expect(approval).toBeDefined();
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "interrupted" });

    const turnId = approval.turnId;
    let turn = (await stores.docs.get(TURNS, turnId))!.data as unknown as TurnDoc;
    expect(turn.status).toBe("interrupted");
    expect(turn.stateToken).toBeTruthy();

    // Approve → the resume pipeline streams the rest of the SAME turn.
    const approve = await fetch(`${base}/chat/api/conversations/${id}/turns/${turnId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ interruptionId: approval.interruption.id, approved: true }),
    });
    expect(approve.status).toBe(200);
    const resumeEvents = sseEvents(await approve.text());
    expect(resumeEvents.at(-1)).toMatchObject({ type: "done", stopReason: "complete" });
    const toolDone = resumeEvents.find(
      (e) => e.type === "tool.activity" && (e as { phase: string }).phase === "done",
    );
    expect(toolDone).toMatchObject({ result: "sunny in Nice" });

    // One turn doc, one event log: interruption AND resolution.
    turn = (await stores.docs.get(TURNS, turnId))!.data as unknown as TurnDoc;
    expect(turn.status).toBe("complete");
    const types = turn.events.map((e) => e.type);
    expect(types).toContain("approval.request");
    expect(types.filter((t) => t === "done")).toHaveLength(2);
  });

  it("model failure becomes an error TURN, not an HTTP failure", async () => {
    const { base, stores } = await boot([{ kind: "throw", message: "billing hard cap reached" }]);
    const { id, cookie } = await createConversation(base);
    const res = await fetch(`${base}/chat/api/conversations/${id}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ content: [{ type: "text", text: "hello" }] }),
    });
    expect(res.status).toBe(200); // the SSE channel opened fine
    const events = sseEvents(await res.text());
    expect(events.map((e) => e.type)).toEqual(["error", "done"]);
    expect((events[0] as { message: string }).message).toContain("billing hard cap");

    const turns = await stores.docs.query({ collection: TURNS, where: { conversationId: id } });
    expect((turns[0]!.data as unknown as TurnDoc).status).toBe("error");
  });

  it("uploads a blob and serves it back (image input path)", async () => {
    const { base } = await boot([]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const up = await fetch(`${base}/chat/api/blobs`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: png,
    });
    expect(up.status).toBe(200);
    const { id } = (await up.json()) as { id: string };
    const down = await fetch(`${base}/store/blobs/${id}`);
    expect(down.status).toBe(200);
    expect(down.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await down.arrayBuffer())).toEqual(png);
  });
});
