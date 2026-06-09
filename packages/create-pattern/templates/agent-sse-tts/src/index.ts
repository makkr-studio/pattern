/**
 * agent-sse-tts — the canonical streaming workflow: one agent token stream
 * fanned out to two consumers at different speeds.
 *
 *   agent.tokens ──▶ core.stream.split ──▶ SSE response   (tokens, live)
 *                                     └──▶ accumulate ──▶ agent.tts (full text)
 *
 * `workflows/chat.json` declares the whole thing — including the HTTP route —
 * and `mods/agent.mjs` provides the two app ops (mock agent + mock TTS, each a
 * one-line swap for real providers).
 *
 * Try it:   curl -N 'http://localhost:3000/chat?prompt=hello'
 */
import { loadProject } from "@pattern/runtime-node";

const { start } = await loadProject();
const { ports } = await start();

console.log(`▶ listening on ${ports.map((p) => `http://localhost:${p}`).join(", ")}`);
console.log("  GET /chat?prompt=…   — SSE token stream (curl -N to watch it flow)");
