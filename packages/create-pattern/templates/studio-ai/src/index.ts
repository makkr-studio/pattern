/**
 * {{name}} — build AI workflows on Pattern, with the visual admin.
 *
 * `pattern.config.json` wires the AI stack WITHOUT the agent layer: mod-vault
 * (your encrypted provider keys), mod-store (blobs for generated media),
 * mod-ai (the capability ops — `ai.text.*`, `ai.object.*`, `ai.embed*`,
 * `ai.image.*`, `ai.speech.*`, `ai.transcribe`, `ai.video.*` — across any
 * provider) and mod-admin (the editor + run traces at /admin). Plain AI
 * workflows: text in, text/image/audio out, no agent loop required.
 *
 * Models come from a named ALIAS you configure in admin → Settings → AI
 * Providers (an `ai.alias` node resolves it). The provider key resolves from a
 * vault secret or an env var you pick per alias — e.g. OPENAI_API_KEY in `.env`
 * (loaded on boot, real env wins) or stored in the vault (admin → Secrets).
 */
import { loadProject } from "@pattern-js/runtime-node";

const { start } = await loadProject();
const { ports } = await start();
const base = `http://localhost:${ports[0]}`;

console.log(`◆ {{name}}`);
console.log(`  Admin   ${base}/admin`);
console.log(`  POST    ${base}/summarize`);
