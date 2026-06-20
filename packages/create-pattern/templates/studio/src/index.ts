/**
 * {{name}} — a Pattern engine wearing its admin.
 *
 * `pattern.config.json` lists the mods: `@pattern-js/mod-admin` (the visual
 * control plane — editor, runs, observability) and `./mods/quotes.mjs` (an
 * app-local mod that adds ops AND extends the admin with a page). `loadProject`
 * installs both, then `start()` opens a server per declared port.
 *
 * Workflows authored in the admin are versioned into `./.pattern` — commit that
 * directory: it IS your deployable workflow store (drafts, versions, audit).
 */
import { loadProject } from "@pattern-js/runtime-node";
import { seedExamples } from "./examples.ts";

const { engine, start } = await loadProject();

// First boot only (empty store): three editable example workflows.
await seedExamples(engine);

const { ports } = await start();
const base = `http://localhost:${ports[0]}`;

console.log(`◆ {{name}}`);
console.log(`  Admin   ${base}/admin`);
console.log(`  Try     curl ${base}/hello/world`);
console.log(`          curl ${base}/quote`);
