/**
 * Buddy's turn pipeline end-to-end (0.4.0, port 5064) with a SCRIPTED model:
 * SSE carries tool.activity with the proposed doc in its args (what the
 * dock's Apply card reads), threads persist + reload + clear via mod-store,
 * and abort settles a hanging turn.
 */

import { describe, it, expect, afterAll, vi } from "vitest";
import { Engine, type PatternMod } from "@pattern-js/core";
import { createHttpHost } from "@pattern-js/runtime-node";
import { identityMod, type IdentityService } from "@pattern-js/mod-identity";
import { IDENTITY_SERVICE } from "@pattern-js/core";
import { adminMod } from "@pattern-js/mod-admin";
import { agentsMod, AI_MODEL_SERVICE } from "@pattern-js/mod-agents";
import { aiMod } from "@pattern-js/mod-ai";
import { docsMod } from "@pattern-js/mod-docs";
import { storeMod } from "@pattern-js/mod-store";
import { scriptedModelService, type ScriptedTurn } from "../../mod-agents/tests/scripted-model-service.js";
import { buddyMod } from "../src/mod.js";

// One port per boot (undici's keep-alive pool poisons a same-port server swap).
const PORTS = [5064, 5074, 5075];
let bootCount = 0;
let closer: (() => Promise<void>) | undefined;
afterAll(async () => {
  await closer?.();
  closer = undefined;
});

async function install(engine: Engine, mods: PatternMod[]) {
  for (const mod of mods) await engine.useAsync(mod, { deferReady: true });
}

const proposedDoc = {
  id: "auto-reply",
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["value"] } },
    { id: "out", op: "boundary.return" },
  ],
  edges: [{ from: { node: "in", port: "value" }, to: { node: "out", port: "value" } }],
};

let base = "";
let service: IdentityService;
let admin = "";

async function boot(turns: ScriptedTurn[]) {
  await closer?.();
  const port = PORTS[bootCount++]!;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const engine = new Engine();
  await install(engine, [
    identityMod({ storage: "memory" }),
    adminMod(),
    agentsMod(),
    aiMod(),
    docsMod(),
    storeMod({ storage: "memory" }),
    buddyMod({ indexOnBoot: false }),
  ]);
  // AFTER install: the scripted model replaces mod-ai's real model service.
  engine.provideService(AI_MODEL_SERVICE, scriptedModelService(turns));
  const host = createHttpHost(engine, { defaultPort: port });
  const { close } = await host.start();
  closer = close;
  vi.restoreAllMocks();
  service = engine.service<IdentityService>(IDENTITY_SERVICE)!;
  base = `http://localhost:${port}`;
  // An admin token plays the signed-in admin session (root scope).
  admin = (await service.createApiToken({ name: "admin", scopes: ["admin"] })).token;
  return engine;
}

const auth = () => ({ authorization: `Bearer ${admin}` });

async function postTurn(body: object): Promise<string> {
  const res = await fetch(`${base}/buddy/api/turn`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth() },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return res.text(); // the full SSE stream, drained
}

/** Parse `data:` SSE lines into events. */
const sseEvents = (raw: string): Array<Record<string, unknown>> =>
  raw
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => JSON.parse(l.slice(5)) as Record<string, unknown>);

describe("buddy turn pipeline (port 5064)", () => {
  it("streams tool.activity with the proposed doc, answers, and persists the thread", async () => {
    await boot([
      { kind: "tool_call", name: "pattern_propose_workflow", callId: "c1", args: { doc: proposedDoc, summary: "echo workflow" } },
      { kind: "text", text: "Proposed! Apply it from the card above." },
    ]);

    const raw = await postTurn({ message: "build me an echo workflow", slug: "auto-reply" });
    const events = sseEvents(raw);

    // The Apply card's data rides the stream: tool.activity carries the args.
    const activity = events.filter((e) => e.type === "tool.activity");
    const start = activity.find((e) => e.phase === "start");
    expect(start?.toolName).toBe("pattern_propose_workflow");
    expect((start?.args as { doc: { id: string } }).doc.id).toBe("auto-reply");
    // The tool ran for real: validate said ok.
    const done = activity.find((e) => e.phase === "done");
    expect(JSON.stringify(done?.result ?? "")).toContain('"ok":true');
    // Terminal done, with the final text somewhere before it.
    expect(events.at(-1)?.type).toBe("done");
    expect(raw).toContain("Apply it from the card above");

    // The thread persisted: reload finds user + assistant messages.
    const thread = (await (await fetch(`${base}/buddy/api/thread?slug=auto-reply`, { headers: auth() })).json()) as {
      messages: Array<{ role: string }>;
      persistent: boolean;
    };
    expect(thread.persistent).toBe(true);
    expect(thread.messages.map((m) => m.role)).toContain("assistant");

    // Clear forgets it.
    await fetch(`${base}/buddy/api/thread/clear`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth() },
      body: JSON.stringify({ slug: "auto-reply" }),
    });
    const cleared = (await (await fetch(`${base}/buddy/api/thread?slug=auto-reply`, { headers: auth() })).json()) as {
      messages: unknown[];
    };
    expect(cleared.messages).toEqual([]);
  });

  it("status probe reports capabilities; abort settles a hanging turn", async () => {
    await boot([{ kind: "hang" }]);

    const status = (await (await fetch(`${base}/buddy/api/status`, { headers: auth() })).json()) as Record<string, unknown>;
    expect(status).toMatchObject({ ok: true, tools: 10, knowledge: "lexical", threads: true, model: "default" });

    // Start a turn that hangs in the model, then abort it by turnId.
    const turnId = "t-abort-1";
    const pending = postTurn({ message: "hang please", turnId });
    await new Promise((r) => setTimeout(r, 150));
    const abort = await fetch(`${base}/buddy/api/turn/${turnId}/abort`, { method: "POST", headers: auth() });
    expect(abort.status).toBe(200);
    expect((await abort.json()) as object).toMatchObject({ ok: true, aborted: true });

    // The stream settles with a terminal event instead of hanging forever.
    const raw = await pending;
    const last = sseEvents(raw).at(-1);
    expect(last?.type).toBe("done");
  }, 15_000);

  it("turns are token-gated like the rest of the control plane", async () => {
    await boot([{ kind: "text", text: "hi" }]);
    const res = await fetch(`${base}/buddy/api/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(401);
  });
});
