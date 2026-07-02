/**
 * {{name}} — a complete agent chat on Pattern.
 *
 * `pattern.config.json` wires the stack: mod-store (conversations, blobs,
 * leases), mod-vault (your provider keys, encrypted), mod-agents + mod-ai (the
 * agent stack + AI capabilities on any provider), mod-chat (the app at /chat)
 * and mod-admin (the kitchen at /admin — the chat's turn pipeline IS a workflow
 * you can fork and rewire).
 *
 * The agent runs on the "default" model alias you configure in admin → Settings →
 * AI Providers. Each alias carries its own provider key, sourced from the vault
 * (admin → System → Secrets) or an env var you name per alias. No global key.
 */
import { loadProject } from "@pattern-js/runtime-node";

const { start } = await loadProject();
const { ports } = await start();
const base = `http://localhost:${ports[0]}`;

console.log(`◆ {{name}}`);
console.log(`  Chat    ${base}/chat`);
console.log(`  Admin   ${base}/admin`);
