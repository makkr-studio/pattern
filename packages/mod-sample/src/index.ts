/**
 * @pattern/mod-sample — the mod-admin-spec **M10** proof.
 *
 * Installing this mod extends the admin with **zero admin-core changes**:
 *  - an op (`sample.greetings.list`) used as a declarative data source,
 *  - a **Tier-1** declarative table page + a menu entry + a ⌘K command,
 *  - a **Tier-2** ESM-remote page whose bundle the mod serves itself via a
 *    `boundary.http.app` mount at `/ext`.
 *
 * If the admin renders all of this without being touched, the extension surface
 * (mod-admin-spec §6) works.
 */

import { defineMod, value, z, type OpDefinition, type Workflow } from "@pattern/core";
import { memoryFs, provideFilesystem } from "@pattern/runtime-node";

const greetings = [
  { id: "ada", language: "English", text: "Hello, Ada!" },
  { id: "linus", language: "Swedish", text: "Hej, Linus!" },
  { id: "yukihiro", language: "Japanese", text: "こんにちは、まつもとさん!" },
];

const greetingsList: OpDefinition = {
  type: "sample.greetings.list",
  title: "sample.greetings.list",
  description: "Returns a static list of greetings (a declarative-page data source).",
  inputs: {},
  outputs: { out: value(z.array(z.object({ id: z.string(), language: z.string(), text: z.string() }))) },
  execute: async () => ({ out: greetings }),
};

/** Deliberately CPU-bound (naive fibonacci) — a fat bar for the span waterfall. */
const crunch: OpDefinition = {
  type: "sample.crunch",
  title: "sample.crunch",
  description:
    "Burns CPU on purpose: computes fibonacci(n) the naive recursive way (~hundreds of ms at n=36). " +
    "Exists to put a visibly long node span on the Runs waterfall. Outputs { out, tookMs }.",
  inputs: { n: value(z.number()) },
  outputs: { out: value(z.number()), tookMs: value(z.number()) },
  config: z.object({ n: z.number().int().min(1).max(40).default(36) }),
  execute: async (ctx) => {
    const n = (await ctx.input.value<number>("n")) ?? (ctx.config as { n: number }).n;
    const fib = (k: number): number => (k < 2 ? k : fib(k - 1) + fib(k - 2));
    const start = performance.now();
    const out = fib(n);
    return { out, tookMs: Math.round(performance.now() - start) };
  },
};

/**
 * The replay showcase: idle wait → CPU burn. On the Runs waterfall the delay
 * node renders as a long bar that starts at t=0, the crunch as a fat bar that
 * only begins after it — start offset vs duration, in one glance.
 */
const replayShowcase: Workflow = {
  id: "sample.replay",
  name: "Sample · Replay showcase",
  description: "Run me, then open Runs: an 800ms await followed by a CPU-heavy fibonacci. The waterfall + graph replay tell the story.",
  nodes: [
    {
      id: "go",
      op: "boundary.manual",
      config: { outputs: ["n"] },
      ui: { x: 60, y: 80, pair: "done", comment: "Run from the editor ▶ — `n` is the fibonacci index (default 36 if empty)." },
    },
    { id: "wait", op: "core.time.delay", config: { ms: 800 }, ui: { x: 340, y: 80, comment: "Awaits 800ms — an **idle** span: long bar, no CPU." } },
    { id: "fib", op: "sample.crunch", ui: { x: 620, y: 80, comment: "Naive fibonacci — a **busy** span: the CPU-bound bar." } },
    { id: "done", op: "boundary.return", ui: { x: 900, y: 80, pair: "go" } },
  ],
  edges: [
    { from: { node: "go", port: "n" }, to: { node: "wait", port: "value" } },
    { from: { node: "wait", port: "out" }, to: { node: "fib", port: "n" } },
    { from: { node: "fib", port: "out" }, to: { node: "done", port: "value" } },
  ],
};

/** A plain ESM Tier-2 remote: default-exports a component using the admin's
 *  shared React, API client, and glass UI kit (no bundler needed; deps come
 *  from `window.__PATTERN_ADMIN__` — typed as `PatternAdminGlobal` in the SDK). */
const STUDIO_REMOTE = `
const { React, api, ui } = (globalThis).__PATTERN_ADMIN__;
const { GlassPanel, PageHeader, Badge, NeonButton, JsonView } = ui;
const h = React.createElement;

export default function SampleStudio() {
  const [data, setData] = React.useState(null);
  return h(
    "div",
    null,
    h(PageHeader, {
      title: "Sample Studio",
      subtitle: "A Tier-2 ESM remote shipped by @pattern/mod-sample — admin core untouched.",
      actions: h(Badge, { hue: 280 }, "tier 2"),
    }),
    h(
      GlassPanel,
      { className: "p-6 space-y-4" },
      h("p", { className: "text-muted text-sm" },
        "This page renders with the admin's shared UI kit (GlassPanel, PageHeader, NeonButton, JsonView) and calls the live API through the shared client."),
      h(NeonButton, { onClick: () => api.invoke("sample.greetings.list").then(setData) }, "Load greetings via api.invoke"),
      data && h(JsonView, { value: data, className: "max-h-64" }),
    ),
  );
}
`;

const appMount: Workflow = {
  id: "sample.app",
  name: "Sample · Tier-2 assets",
  // The canonical app trio (§7): mount trigger → app op → serve out-gate.
  nodes: [
    { id: "mount", op: "boundary.http.app", config: { mount: "/ext" }, ui: { x: 60, y: 60, pair: "serve" } },
    { id: "assets", op: "core.app.static", config: { filesystem: "sample-assets", spaFallback: "" }, ui: { x: 340, y: 60 } },
    { id: "serve", op: "boundary.http.app.serve", ui: { x: 620, y: 60, pair: "mount" } },
  ],
  edges: [
    { from: { node: "mount", port: "out" }, to: { node: "assets", port: "in" } },
    { from: { node: "assets", port: "app" }, to: { node: "serve", port: "app" } },
  ],
};

export default defineMod({
  name: "@pattern/mod-sample",
  ops: [greetingsList, crunch],
  workflows: [appMount, replayShowcase],
  frontend: {
    menu: [
      { category: "Examples", label: "Greetings", icon: "boxes", path: "/x/greetings", order: 10 },
      { category: "Examples", label: "Studio", icon: "package", path: "/x/studio", order: 20 },
    ],
    commands: [{ id: "sample.greet", label: "Sample: list greetings", group: "Examples", run: "sample.greetings.list" }],
    pages: [
      {
        path: "/x/greetings",
        view: {
          kind: "table",
          source: "sample.greetings.list",
          columns: [
            { key: "id", label: "ID" },
            { key: "language", label: "Language" },
            { key: "text", label: "Greeting" },
          ],
        },
      },
      { path: "/x/studio", remote: "/ext/sample-studio.js" },
    ],
  },
  setup: (engine) => {
    const fs = memoryFs();
    void fs.write("sample-studio.js", STUDIO_REMOTE);
    provideFilesystem(engine, "sample-assets", fs);
  },
});
