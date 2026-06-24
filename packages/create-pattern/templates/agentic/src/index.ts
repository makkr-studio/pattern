/**
 * {{name}} — build agentic workflows on Pattern, with the visual admin.
 *
 * `pattern.config.json` wires the agent stack: mod-store (durable state —
 * conversations, blobs, leases), mod-vault (your encrypted provider keys),
 * mod-agents + mod-ai (the `agents.agent` / `agents.run` / `agents.tools.*`
 * ops + `ai.model`, on any provider) and mod-admin (the editor + run traces at
 * /admin). An "agentic workflow" is just a graph that wires an agent into a
 * runner — no chat UI required; you build and run them in the editor.
 *
 * The agent runs on a model picked by an `ai.model` node (or the default set in
 * admin → Settings → AI Providers). Its provider key resolves by name:
 * OPENAI_API_KEY in the environment (a .env next to pattern.config.json is
 * loaded on boot) → a vault secret NAMED OPENAI_API_KEY (admin → Secrets).
 */
import { loadProject } from "@pattern-js/runtime-node";

const { start } = await loadProject();
const { ports } = await start();
const base = `http://localhost:${ports[0]}`;

console.log(`◆ {{name}}`);
console.log(`  Admin   ${base}/admin`);
if (!process.env.OPENAI_API_KEY) {
  console.log(`  ⚠ OPENAI_API_KEY is not set — agent runs fail until you set it (or store it in the vault).`);
}
