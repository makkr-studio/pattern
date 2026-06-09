/**
 * Dev server: an engine with the admin mod serving the built SPA from dist-app,
 * plus a couple of sample workflows so the catalog/editor/runs have content.
 * Run after `pnpm build:backend && pnpm build:app`:  node scripts/serve-dev.mjs
 */
import { Engine } from "@pattern/core";
import { createHttpHost, memoryFs } from "@pattern/runtime-node";
import { adminMod } from "@pattern/mod-admin";
import sampleMod from "@pattern/mod-sample";
import { fileURLToPath } from "node:url";

const distApp = fileURLToPath(new URL("../dist-app", import.meta.url));
const engine = new Engine({ env: process.env });

// In-memory store so the dev server is stateless between restarts.
await engine.useAsync(adminMod({ storage: memoryFs(), assets: distApp }));
// The M10 sample mod — extends the admin (Examples menu, Tier-1 + Tier-2 pages).
await engine.useAsync(sampleMod);

// A couple of sample user workflows for the catalog + editor + runs.
const cp = engine.service("adminControlPlane");
await cp.store.saveVersion(
  "greeting",
  {
    id: "greeting",
    name: "Greeting endpoint",
    description: "Returns a templated greeting for GET /hello/:name.",
    nodes: [
      { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/hello/:name" }, ui: { x: 40, y: 120 } },
      { id: "msg", op: "core.string.template", config: { template: "Hello, {{ name }}! 👋" }, ui: { x: 360, y: 120 } },
      { id: "out", op: "boundary.http.response", ui: { x: 680, y: 120 } },
    ],
    edges: [
      { from: { node: "in", port: "params" }, to: { node: "msg", port: "data" } },
      { from: { node: "msg", port: "out" }, to: { node: "out", port: "body" } },
    ],
  },
  { note: "seed" },
);
await cp.deploy("greeting", "v1");

await cp.store.saveVersion(
  "adder",
  {
    id: "adder",
    name: "Adder",
    description: "Adds two numbers from a manual trigger.",
    nodes: [
      { id: "in", op: "boundary.manual", config: { outputs: ["a", "b"] }, ui: { x: 40, y: 120 } },
      { id: "add", op: "core.math.add", ui: { x: 360, y: 120 } },
      { id: "out", op: "boundary.return", ui: { x: 680, y: 120 } },
    ],
    edges: [
      { from: { node: "in", port: "a" }, to: { node: "add", port: "a" } },
      { from: { node: "in", port: "b" }, to: { node: "add", port: "b" } },
      { from: { node: "add", port: "out" }, to: { node: "out", port: "value" } },
    ],
  },
  { note: "seed" },
);
await cp.deploy("adder", "v1");

// Fire a few runs so Runs + Metrics have data.
for (let i = 0; i < 5; i++) {
  await engine.run("greeting", { trigger: "in", input: { params: { name: `dev${i}` }, query: {}, body: undefined }, sampleIo: true }).catch(() => {});
  await engine.run("adder", { input: { a: i, b: i * 2 }, sampleIo: true }).catch(() => {});
}

const host = createHttpHost(engine, { defaultPort: 3000 });
await host.start();
console.log("Pattern Admin → http://localhost:3000/admin");
