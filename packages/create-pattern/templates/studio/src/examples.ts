/**
 * First-boot examples — seeded through the admin control plane so they are
 * fully **editable** in the admin (versions, deploy, rollback, audit), unlike
 * code/file workflows which are read-only there.
 *
 * Seeding happens only when the workflow store (`./.pattern`) is empty: your
 * edits always win. Factory reset: stop the app, delete `./.pattern`, restart.
 */
import type { Engine, Workflow } from "@pattern-js/core";
import { ADMIN_CONTROL_PLANE, type ControlPlane } from "@pattern-js/mod-admin";

const hello: Workflow = {
  id: "hello",
  name: "Hello endpoint",
  description: "GET /hello/:name, the smallest possible route: trigger → template → response.",
  nodes: [
    {
      id: "in",
      op: "boundary.http.request",
      title: "GET /hello/:name",
      comment: "The route lives HERE, in config; no route table anywhere. `:name` is captured into the **params** output.",
      config: { method: "GET", path: "/hello/:name", cors: true },
      ui: { x: 40, y: 120 },
    },
    {
      id: "greet",
      op: "core.string.template",
      title: "Build greeting",
      comment: "Interpolates `{{ name }}` from params. Value edges are barriers, so this waits for the request.",
      config: { template: "Hello, {{ name }}! 👋" },
      ui: { x: 360, y: 120 },
    },
    {
      id: "out",
      op: "boundary.http.response",
      title: "Reply",
      comment: "Out-gate: its resolved inputs become the HTTP response.",
      ui: { x: 680, y: 120 },
    },
  ],
  edges: [
    { from: { node: "in", port: "params" }, to: { node: "greet", port: "data" } },
    { from: { node: "greet", port: "out" }, to: { node: "out", port: "body" } },
  ],
};

const quote: Workflow = {
  id: "quote",
  name: "Quote endpoint",
  description: "GET /quote, using an op contributed by the app-local mod (mods/quotes.mjs).",
  nodes: [
    {
      id: "in",
      op: "boundary.http.request",
      title: "GET /quote",
      config: { method: "GET", path: "/quote", cors: true },
      ui: { x: 40, y: 120 },
    },
    {
      id: "pick",
      op: "app.quotes.random",
      title: "Random quote",
      comment: "An op from `mods/quotes.mjs`: your own code, first-class next to `core.*`. Objects serialize to JSON automatically.",
      ui: { x: 360, y: 120 },
    },
    {
      id: "out",
      op: "boundary.http.response",
      title: "Reply",
      ui: { x: 680, y: 120 },
    },
  ],
  edges: [
    { from: { node: "in", port: "out" }, to: { node: "pick", port: "in" } },
    { from: { node: "pick", port: "out" }, to: { node: "out", port: "body" } },
  ],
};

const showcase: Workflow = {
  id: "showcase",
  name: "Observability showcase",
  description: "Run me from the editor ▶, then open Runs: an 800ms await followed by CPU-heavy fibonacci. The waterfall + graph replay tell the story.",
  nodes: [
    {
      id: "go",
      op: "boundary.manual",
      title: "Manual trigger",
      comment: "Run from the editor ▶. `n` is the fibonacci index (defaults to 34 when empty).",
      config: { outputs: ["n"] },
      ui: { x: 40, y: 120 },
    },
    {
      id: "wait",
      op: "core.time.delay",
      title: "Wait 800ms",
      comment: "An **idle** span: long bar on the waterfall, zero CPU.",
      config: { ms: 800 },
      ui: { x: 340, y: 120 },
    },
    {
      id: "fib",
      op: "core.math.fib",
      title: "Crunch",
      comment: "Naive recursive fibonacci, a **busy** span: the CPU-bound bar.",
      ui: { x: 640, y: 120 },
    },
    {
      id: "done",
      op: "boundary.return",
      title: "Result",
      ui: { x: 940, y: 120 },
    },
  ],
  edges: [
    { from: { node: "go", port: "n" }, to: { node: "wait", port: "value" } },
    { from: { node: "wait", port: "out" }, to: { node: "fib", port: "n" } },
    { from: { node: "fib", port: "out" }, to: { node: "done", port: "value" } },
  ],
};

/** Seed the examples into an EMPTY workflow store, save → deploy each. */
export async function seedExamples(engine: Engine): Promise<void> {
  const cp = engine.service<ControlPlane>(ADMIN_CONTROL_PLANE);
  if (!cp) return; // admin mod not installed — nothing to seed into
  if ((await cp.store.list()).length > 0) return; // store has content: user's world now

  for (const doc of [hello, quote, showcase]) {
    const v = await cp.store.saveVersion(doc.id, { ...doc, source: "file" }, { note: "example (seeded on first boot)" });
    await cp.deploy(doc.id, v.id);
  }
  console.log("  Seeded 3 example workflows (hello, quote, showcase) — edit them in the admin.");
}
