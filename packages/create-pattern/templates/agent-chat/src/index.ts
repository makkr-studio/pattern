/**
 * {{name}} — a complete agent chat on Pattern.
 *
 * `pattern.config.json` wires the stack: mod-store (conversations, blobs,
 * leases), mod-vault (your provider keys, encrypted), mod-agents + mod-ai (the
 * agent stack + AI capabilities on any provider), mod-chat (the app at /chat)
 * and mod-admin (the kitchen at /admin — the chat's turn pipeline IS a workflow
 * you can fork and rewire).
 *
 * The agent runs on the default model (admin → Settings → AI Providers). Its
 * provider key resolves by name: set OPENAI_API_KEY in your environment, or
 * store it on the admin's Secrets page (System → Secrets) — no wiring needed.
 */
import { loadProject } from "@pattern-js/runtime-node";

const { start } = await loadProject();
const { ports } = await start();
const base = `http://localhost:${ports[0]}`;

console.log(`◆ {{name}}`);
console.log(`  Chat    ${base}/chat`);
console.log(`  Admin   ${base}/admin`);
if (!process.env.OPENAI_API_KEY) {
  console.log(`  ⚠ OPENAI_API_KEY is not set — turns will fail until you set it (or use the vault).`);
}
