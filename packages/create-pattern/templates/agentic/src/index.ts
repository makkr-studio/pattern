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
 * The agent runs on a model from an `ai.model` node, or the "default" alias you
 * set in admin → Settings → AI Providers. Each alias carries its own provider
 * key, sourced from the vault (admin → System → Secrets) or an env var you name.
 */
import { loadProject } from "@pattern-js/runtime-node";

const { start } = await loadProject();
const { ports } = await start();
const base = `http://localhost:${ports[0]}`;

console.log(`◆ {{name}}`);
console.log(`  Admin   ${base}/admin`);
console.log(`  → add a "default" model in admin → Settings → AI Providers (each alias brings its own key, from the vault or an env var)`);
