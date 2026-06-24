/**
 * Regression fixture (run by no-key-crash.e2e.test.ts in a CHILD process):
 * a chat turn with no API key must NOT crash the host process — under plain
 * `node`, an unhandled rejection is fatal by default, which is exactly how
 * Benoit's `pattern dev` died. Exits 42 on any unhandled rejection.
 */
// Built dist via relative paths — the fixture runs OUTSIDE the workspace
// alias map (a child process with default Node resolution).
import { Engine } from "../../../core/dist/index.js";
import { createHttpHost } from "../../../runtime-node/dist/index.js";
import { storeMod, STORE_SERVICE } from "../../../mod-store/dist/index.js";
import { agentsMod } from "../../../mod-agents/dist/index.js";
import aiMod from "../../../mod-ai/dist/index.js";
import { chatMod, TURNS } from "../../dist/index.js";

delete process.env.OPENAI_API_KEY;
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED_REJECTION:", String(err).slice(0, 160));
  process.exit(42);
});

const port = Number(process.argv[2] ?? 4966);
const engine = new Engine({ env: process.env });
await engine.useAsync(storeMod({ storage: "memory" }), { deferReady: true });
await engine.useAsync(agentsMod(), { deferReady: true });
await engine.useAsync(aiMod, { deferReady: true });
const chat = chatMod();
await engine.useAsync(chat, { deferReady: true });
await chat.ready?.(engine);

// A default model resolves (so the turn streams), but the provider key is
// missing — the failure fires MID-STREAM (after result-ready), the exact crash
// shape. In-memory only (no persisted file).
engine.service("aiConfig").settings = {
  defaultModel: { kind: "model", routing: "direct", modality: "language", provider: "openai", modelId: "gpt-5-mini" },
};

const host = createHttpHost(engine, { defaultPort: port });
const { close } = await host.start();

const create = await fetch(`http://localhost:${port}/chat/api/default/conversations`, { method: "POST", body: "{}" });
const cookie = (create.headers.get("set-cookie") ?? "").split(";")[0];
const { id } = await create.json();
const res = await fetch(`http://localhost:${port}/chat/api/default/conversations/${id}/turns`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ content: [{ type: "text", text: "hi" }] }),
});
await res.text().catch(() => {});

// Give the failed producer + sink time to settle; any unhandled rejection
// fires within this window.
await new Promise((r) => setTimeout(r, 600));

const stores = engine.service(STORE_SERVICE);
const turns = await stores.docs.query({ collection: TURNS, where: { conversationId: id } });
const turn = turns[0]?.data;
console.log(
  "RESULT",
  JSON.stringify({
    httpStatus: res.status,
    turnStatus: turn?.status ?? null,
    lastEvent: turn?.events?.at(-1)?.type ?? null,
    errorMentionsKey: JSON.stringify(turn?.events ?? []).includes("OPENAI_API_KEY"),
  }),
);
await close();
console.log("PROCESS_SURVIVED");
