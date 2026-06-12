/**
 * {{name}} — a complete agent chat on Pattern.
 *
 * `pattern.config.json` wires the stack: mod-store (conversations, blobs,
 * leases), mod-vault (your API key, encrypted), mod-agents (+ the OpenAI
 * provider), mod-chat (the app at /chat) and mod-admin (the kitchen at
 * /admin — the chat's turn pipeline IS a workflow you can fork and rewire).
 *
 * The agent needs an OpenAI API key: set OPENAI_API_KEY in your environment,
 * or store one on the admin's Secrets page (System → Secrets) and wire a
 * `vault.read` node into the pipeline's `apiKey` input.
 */
import { loadProject } from "@pattern/runtime-node";

const { start } = await loadProject();
const { ports } = await start();
const base = `http://localhost:${ports[0]}`;

console.log(`◆ {{name}}`);
console.log(`  Chat    ${base}/chat`);
console.log(`  Admin   ${base}/admin`);
if (!process.env.OPENAI_API_KEY) {
  console.log(`  ⚠ OPENAI_API_KEY is not set — turns will fail until you set it (or use the vault).`);
}
