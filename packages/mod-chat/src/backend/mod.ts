/**
 * @pattern-js/mod-chat — the mod.
 *
 * Needs @pattern-js/mod-store (conversations, blobs, leases) and the agents
 * stack (@pattern-js/mod-agents + @pattern-js/mod-ai for the model provider)
 * installed alongside. `setup` registers the SPA assets filesystem; `ready` ensures
 * the chat collections (mod-store's setup has run by then, whatever the
 * listing order).
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { boundaries, defineMod, value, z, type Engine, type OpDefinition, type PatternMod } from "@pattern-js/core";
import { localFs, memoryFs, provideFilesystem, type Filesystem } from "@pattern-js/runtime-node";
import { STORE_SERVICE, type PatternStores } from "@pattern-js/mod-store";
import { resolveInstances, resolveOptions, type ChatModOptions } from "./options.js";
import { chatOps } from "./ops.js";
import { memoryOps, memoryPipelineWorkflow } from "./memory.js";
import { chatAdminOps, chatFrontend } from "./admin.js";
import { chatAdminRoutes } from "./admin-routes.js";
import { ensureChatCollections } from "./data.js";
import {
  approvalPipelineWorkflow,
  blobUploadWorkflow,
  crudWorkflows,
  guardrailToolWorkflow,
  imageToolWorkflow,
  researcherToolWorkflow,
  speechRouteWorkflow,
  spaWorkflow,
  transcribeRouteWorkflow,
  turnPipelineWorkflow,
} from "./workflows.js";

export const CHAT_ASSETS_FS = "chat-assets";

/** The mod's built SPA at dist-app/ (relative to the compiled dist/backend/mod.js). */
function bundledAssets(mount: string): Filesystem {
  try {
    const distApp = fileURLToPath(new URL("../../dist-app", import.meta.url));
    if (existsSync(`${distApp}/index.html`)) return localFs(distApp);
  } catch {
    /* fall through to placeholder */
  }
  const fs = memoryFs();
  void fs.write(
    "index.html",
    `<!doctype html><html><head><meta charset="utf-8"><title>Pattern Chat</title>
<style>body{font:16px system-ui;margin:0;display:grid;place-items:center;height:100vh;background:#faf9f7;color:#1c1917}
.card{padding:2rem 2.5rem;border-radius:14px;background:#fff;border:1px solid #e7e5e4}</style></head>
<body><div class="card"><h1>Pattern Chat</h1>
<p>The chat API is live under <code>${mount}/api</code>.</p>
<p>Build the SPA into the mod's <code>dist-app/</code> to replace this page.</p></div></body></html>`,
  );
  return fs;
}

const chatAppOp: OpDefinition = {
  type: "chat.app",
  title: "Pattern Chat app",
  description:
    "The chat SPA as an app object. Wire `app` into `boundary.http.app.serve` under a `boundary.http.app` mount. " +
    "`namespace` scopes this instance's data on the SHARED backend at `api` (decoupled from where the SPA mounts); " +
    "`accent`/`title` brand it. All ride the app descriptor's `manifest`, injected as `window.__APP__` into the " +
    "served index.html, so one bundle is hosted many times, each branded and data-partitioned, no route duplication.",
  reusable: true,
  inputs: {},
  outputs: { app: value(boundaries.appDescriptorSchema) },
  config: z.object({
    filesystem: z.string().default(CHAT_ASSETS_FS),
    spaFallback: z.string().default("index.html"),
    immutableAssets: z.boolean().default(true),
    /** The shared backend mount this SPA calls (its API lives at `${api}/api`). */
    api: z.string().default("/chat"),
    /** Logical data partition (decoupled from the mount). Default "default". */
    namespace: z.string().default("default"),
    /** Brand accent (any CSS color) — themes the chat UI's `--accent`. */
    accent: z.string().optional(),
    /** Document title + sidebar wordmark for this instance. */
    title: z.string().optional(),
  }),
  execute: (ctx) => {
    const { filesystem, spaFallback, immutableAssets, api, namespace, accent, title } = ctx.config as {
      filesystem: string;
      spaFallback: string;
      immutableAssets: boolean;
      api: string;
      namespace: string;
      accent?: string;
      title?: string;
    };
    // The host injects `manifest` as window.__APP__ (its presence opts in). We set
    // apiBase to the SHARED backend's api root — NOT this SPA's mount — so a SPA at
    // /sales talks to /chat/api; the SPA appends the namespace per scoped route.
    const manifest: Record<string, unknown> = { namespace, apiBase: `${api}/api` };
    if (accent) manifest.accent = accent;
    if (title) manifest.title = title;
    return { app: { filesystem, spaFallback, immutableAssets, manifest } };
  },
};


/** The packaged docs/ chapter (the `docs` contribution points at "chat-docs"). */
function packagedDocs(engine: Engine): void {
  try {
    const dir = fileURLToPath(new URL("../../docs", import.meta.url));
    if (existsSync(dir)) provideFilesystem(engine, "chat-docs", localFs(dir));
  } catch {
    /* packaged without docs — the contribution is simply skipped */
  }
}

export function chatMod(options: ChatModOptions = {}): PatternMod {
  // ONE shared backend (ops, store, admin screens, CRUD + turn routes), fronted
  // by MANY branded SPA instances. The backend's conversation/turn routes carry
  // a `:ns` segment; each instance's SPA sends its namespace there, so there's no
  // per-instance route duplication. An instance with its own `agent` mints a
  // namespace-pinned fork of the turn pipeline (its hardwired :ns path wins).
  const opts = resolveOptions(options);
  const { instances, pins } = resolveInstances(options);
  let engineRef: Engine | undefined;

  // Build ops FIRST — they register their route I/O (chatOpRoutes), which the
  // CRUD route factory then reads to decompose each request.
  const ops = [...chatOps(() => engineRef, opts), ...memoryOps(opts), ...chatAdminOps, chatAppOp];

  const workflows = [
    // The shared backend — one set of routes + pipeline for every instance.
    ...crudWorkflows(opts),
    ...chatAdminRoutes(),
    blobUploadWorkflow(opts),
    ...(opts.turnPipeline
      ? [
          turnPipelineWorkflow(opts), // generic /:ns pipeline (the fallback)
          ...pins.map((pin) => turnPipelineWorkflow(opts, pin)), // per-namespace forks
          approvalPipelineWorkflow(opts),
          guardrailToolWorkflow(opts),
          // Capability showcases (auto-discovered as agent tools / SPA routes):
          imageToolWorkflow(opts), // generate_image tool → rendered inline in chat
          researcherToolWorkflow(opts), // research tool: an agent-as-tool example
          transcribeRouteWorkflow(opts), // mic → speech-to-text
          speechRouteWorkflow(opts), // assistant message → text-to-speech
          // Cross-conversation memory: extraction runs after every completed
          // turn, as its own (inspectable) run. No-ops without mod-vectors.
          ...(opts.memory.enabled ? [memoryPipelineWorkflow()] : []),
        ]
      : []),
    // One branded SPA per instance, all talking to the shared backend.
    ...instances.map((inst) => spaWorkflow(inst)),
  ];

  return defineMod({
    name: "@pattern-js/mod-chat",
    docs: { filesystem: "chat-docs", title: "Chat", order: 52 },
    ops,
    workflows,
    frontend: chatFrontend(),
    setup: (engine: Engine) => {
      packagedDocs(engine);
      engineRef = engine;
      const assets = opts.assets ? localFs(opts.assets) : bundledAssets(opts.mount);
      provideFilesystem(engine, CHAT_ASSETS_FS, assets);
    },
    ready: async (engine: Engine) => {
      const svc = engine.service<PatternStores>(STORE_SERVICE);
      if (!svc) {
        throw new Error('@pattern-js/mod-chat needs @pattern-js/mod-store — add it to your pattern.config.json mods');
      }
      await ensureChatCollections(svc);
    },
  });
}

/** A ready-to-use chat mod with defaults (for `loadMods`/`engine.use`). */
export default chatMod();
