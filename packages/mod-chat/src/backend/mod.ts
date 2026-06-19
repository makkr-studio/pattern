/**
 * @pattern/mod-chat — the mod.
 *
 * Needs @pattern/mod-store (conversations, blobs, leases) and an agents
 * provider (@pattern/mod-agents + @pattern/mod-agents-openai) installed
 * alongside. `setup` registers the SPA assets filesystem; `ready` ensures
 * the chat collections (mod-store's setup has run by then, whatever the
 * listing order).
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { boundaries, defineMod, value, z, type Engine, type OpDefinition, type PatternMod } from "@pattern/core";
import { localFs, memoryFs, provideFilesystem, type Filesystem } from "@pattern/runtime-node";
import { STORE_SERVICE, type PatternStores } from "@pattern/mod-store";
import { resolveOptions, type ChatModOptions } from "./options.js";
import { chatOps } from "./ops.js";
import { chatAdminOps, chatFrontend } from "./admin.js";
import { chatAdminRoutes } from "./admin-routes.js";
import { ensureChatCollections } from "./data.js";
import {
  approvalPipelineWorkflow,
  blobUploadWorkflow,
  crudWorkflows,
  guardrailToolWorkflow,
  spaWorkflow,
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
    "`accent`/`title` brand THIS instance — they ride the app descriptor's `manifest`, which the host injects as " +
    "`window.__APP__` into the served index.html, so the same bundle can be hosted many times with different looks.",
  reusable: true,
  inputs: {},
  outputs: { app: value(boundaries.appDescriptorSchema) },
  config: z.object({
    filesystem: z.string().default(CHAT_ASSETS_FS),
    spaFallback: z.string().default("index.html"),
    immutableAssets: z.boolean().default(true),
    /** Brand accent (any CSS color) — themes the chat UI's `--accent`. */
    accent: z.string().optional(),
    /** Document title + sidebar wordmark for this instance. */
    title: z.string().optional(),
  }),
  execute: (ctx) => {
    const { filesystem, spaFallback, immutableAssets, accent, title } = ctx.config as {
      filesystem: string;
      spaFallback: string;
      immutableAssets: boolean;
      accent?: string;
      title?: string;
    };
    // The host injects `manifest` (+ the resolved mount/apiBase it knows) as
    // window.__APP__. Its mere presence opts this app into bootstrap injection.
    const manifest: Record<string, unknown> = {};
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
  const opts = resolveOptions(options);
  let engineRef: Engine | undefined;

  // Build ops FIRST — they register their route I/O (chatOpRoutes), which the
  // CRUD route factory then reads to decompose each request.
  const ops = [...chatOps(() => engineRef, opts), ...chatAdminOps, chatAppOp];

  const workflows = [
    spaWorkflow(opts.mount),
    ...crudWorkflows(opts),
    // The admin Conversations screens' dedicated routes (one purposeful endpoint
    // per screen and action, replacing the invoke path).
    ...chatAdminRoutes(),
    blobUploadWorkflow(opts),
    ...(opts.turnPipeline
      ? [turnPipelineWorkflow(opts), approvalPipelineWorkflow(opts), guardrailToolWorkflow(opts)]
      : []),
  ];

  return defineMod({
    name: "@pattern/mod-chat",
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
        throw new Error('@pattern/mod-chat needs @pattern/mod-store — add it to your pattern.config.json mods');
      }
      await ensureChatCollections(svc);
    },
  });
}

/** A ready-to-use chat mod with defaults (for `loadMods`/`engine.use`). */
export default chatMod();
