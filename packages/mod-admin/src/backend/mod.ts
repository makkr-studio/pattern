/**
 * @pattern/mod-admin — the mod (mod-admin-spec §1, §3, §16).
 *
 * `engine.use()`-able brick that adds the authorable, self-reflecting control
 * surface: it contributes the `admin.*` ops, the endpoint workflows that expose
 * them over HTTP, and a `boundary.http.app` workflow that serves the SPA. Its
 * `setup` registers the in-process backend services (control plane, store, trace
 * sink), subscribes the sink, registers the assets filesystem, and bootstraps
 * the stored workflows.
 *
 * Install it with `await engine.useAsync(adminMod())` (or via loadMods/loadProject)
 * so `setup` — which is async — completes before you start the host.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineMod, type Engine, type PatternMod, type Workflow } from "@pattern/core";
import {
  localFs,
  memoryFs,
  toFilesystem,
  provideFilesystem,
  type Filesystem,
} from "@pattern/runtime-node";
import { DefaultControlPlane } from "./control-plane/control-plane.js";
import { FlystorageWorkflowStore } from "./control-plane/store.js";
import { MemoryTraceSink } from "./trace/memory-sink.js";
import { adminOps } from "./ops/index.js";
import { endpointWorkflows, stampRequireAuth } from "./workflows/index.js";
import { registerAdminServices } from "./services.js";
import { adminFrontend } from "./frontend.js";

export interface AdminModOptions {
  /** Where to mount the admin (UI + API live under here). Default "/admin". */
  mount?: string;
  /** Workflow store filesystem (or a local dir path). Default "./.pattern". */
  storage?: Filesystem | string;
  /** Path prefix inside the store filesystem. Default "workflows". */
  storePrefix?: string;
  /** SPA assets filesystem (or a local dir path). Default a built-in placeholder. */
  assets?: Filesystem | string;
  /** Auth requirement stamped onto every admin endpoint (P6). Default false. */
  auth?: boolean | { scopes: string[] };
  /** Max runs retained in the in-memory trace sink. Default 500. */
  traceCapacity?: number;
}

/** Name of the filesystem the SPA assets are served from. */
const ASSETS_FS = "admin-assets";

function resolveFs(fs: Filesystem | string | undefined, fallback: () => Filesystem): Filesystem {
  return fs ? toFilesystem(fs) : fallback();
}

/** The mod's built SPA at dist-app/ (relative to the compiled dist/backend/mod.js). */
function bundledAssets(mount: string): Filesystem {
  try {
    const distApp = fileURLToPath(new URL("../../dist-app", import.meta.url));
    if (existsSync(`${distApp}/index.html`)) return localFs(distApp);
  } catch {
    /* fall through to placeholder */
  }
  return placeholderAssets(mount);
}

/** A tiny placeholder SPA so `/admin` shows something before the UI is built. */
function placeholderAssets(mount: string): Filesystem {
  const fs = memoryFs();
  void fs.write(
    "index.html",
    `<!doctype html><html><head><meta charset="utf-8"><title>Pattern Admin</title>
<style>body{font:16px system-ui;margin:0;display:grid;place-items:center;height:100vh;background:#0b0d12;color:#e6e9ef}
.card{padding:2rem 2.5rem;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(12px)}
code{color:#7cf}</style></head>
<body><div class="card"><h1>Pattern Admin</h1>
<p>The control plane is live. API is under <code>${mount}/api</code>.</p>
<p>Build the SPA into the mod's <code>dist-app/</code> to replace this page.</p></div></body></html>`,
  );
  return fs;
}

/** The workflow that mounts the SPA via the app boundary (admin-spec §11). */
function spaWorkflow(mount: string): Workflow {
  return {
    id: "admin.app",
    name: "Admin · SPA",
    source: "code",
    nodes: [
      {
        id: "app",
        op: "boundary.http.app",
        config: { mount, filesystem: ASSETS_FS, spaFallback: "index.html", immutableAssets: true },
        comment: "Serves the admin SPA; API routes under /admin/api win on the same port.",
      },
    ],
    edges: [],
  };
}

/** Create the admin mod (a configured `PatternMod`). */
export function adminMod(options: AdminModOptions = {}): PatternMod {
  const mount = (options.mount ?? "/admin").replace(/\/$/, "") || "/admin";
  const auth = options.auth === true ? true : typeof options.auth === "object" ? options.auth : undefined;

  // The SPA workflow is auth-stamped like every API route — without this the
  // admin UI itself would stay publicly reachable when `auth` is configured.
  const spa = auth ? stampRequireAuth(spaWorkflow(mount), auth) : spaWorkflow(mount);

  return defineMod({
    name: "@pattern/mod-admin",
    ops: adminOps,
    workflows: [...endpointWorkflows(auth), spa],
    frontend: adminFrontend(mount),
    setup: async (engine: Engine) => {
      const storageFs = resolveFs(options.storage, () => localFs("./.pattern"));
      const assetsFs = resolveFs(options.assets, () => bundledAssets(mount));
      provideFilesystem(engine, ASSETS_FS, assetsFs);

      const store = new FlystorageWorkflowStore(storageFs, { prefix: options.storePrefix });
      const sink = new MemoryTraceSink({ capacity: options.traceCapacity });
      const controlPlane = new DefaultControlPlane(engine, store);
      registerAdminServices(engine, { controlPlane, sink, engine });
      engine.onTrace(sink);
      await controlPlane.bootstrap();
    },
  });
}

/** A ready-to-use admin mod with defaults (for `loadMods`/`engine.use`). */
export default adminMod();
