/**
 * @pattern/mod-admin — the mod (mod-admin-spec §1, §3, §16).
 *
 * `engine.use()`-able brick that adds the authorable, self-reflecting control
 * surface: it contributes the `admin.*` ops, the endpoint workflows that expose
 * them over HTTP, and a `boundary.http.app` workflow that serves the SPA. Its
 * `setup` registers the in-process backend services (control plane, store, trace
 * sink), subscribes the sink, and registers the assets filesystem; `ready` —
 * which runs after every mod of the install batch — bootstraps the stored
 * workflows, so they may use ops from mods loaded after the admin.
 *
 * Install it with `await engine.useAsync(adminMod())` (or via loadMods/loadProject)
 * so `setup` — which is async — completes before you start the host.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AUTH_HOME_URL, defineMod, type Engine, type PatternMod, type Workflow } from "@pattern/core";
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
import { ASSETS_FS, registerAdminServices } from "./services.js";
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
  /**
   * Auth requirement stamped onto every admin endpoint + the SPA (P6).
   * Unset: open — UNLESS the identity mod is installed, in which case the
   * admin defaults to `{ scopes: ["admin"] }` (secure-by-default). Pass
   * `false` to explicitly keep it open even with identity present.
   */
  auth?: boolean | { scopes: string[] };
  /** Max runs retained in the in-memory trace sink. Default 500. */
  traceCapacity?: number;
}

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

/**
 * The workflow that mounts the SPA via the app boundary (admin-spec §11) — the
 * canonical boundary *pair* plus the admin's own app node between them:
 * `boundary.http.app` (where) → `admin.app` (what) → `…app.serve` (serve it).
 */
function spaWorkflow(mount: string): Workflow {
  return {
    id: "admin.spa",
    name: "Admin · SPA",
    source: "code",
    nodes: [
      {
        id: "mount",
        op: "boundary.http.app",
        config: { mount },
        comment: "Serves the admin SPA; API routes under /admin/api win on the same port.",
        ui: { x: 60, y: 60, pair: "serve" },
      },
      {
        id: "admin",
        op: "admin.app",
        comment: "The Pattern Admin application bundle.",
        ui: { x: 340, y: 60 },
      },
      {
        id: "serve",
        op: "boundary.http.app.serve",
        ui: { x: 620, y: 60, pair: "mount" },
      },
    ],
    edges: [
      { from: { node: "mount", port: "out" }, to: { node: "admin", port: "in" } },
      { from: { node: "admin", port: "app" }, to: { node: "serve", port: "app" } },
    ],
  };
}

/** Create the admin mod (a configured `PatternMod`). */

/** The packaged docs/ chapter (the `docs` contribution points at "admin-docs"). */
function packagedDocs(engine: Engine): void {
  try {
    const dir = fileURLToPath(new URL("../../docs", import.meta.url));
    if (existsSync(dir)) provideFilesystem(engine, "admin-docs", localFs(dir));
  } catch {
    /* packaged without docs — the contribution is simply skipped */
  }
}

export function adminMod(options: AdminModOptions = {}): PatternMod {
  const mount = (options.mount ?? "/admin").replace(/\/$/, "") || "/admin";
  const auth = options.auth === true ? true : typeof options.auth === "object" ? options.auth : undefined;

  // The SPA workflow is auth-stamped like every API route — without this the
  // admin UI itself would stay publicly reachable when `auth` is configured.
  const spa = auth ? stampRequireAuth(spaWorkflow(mount), auth) : spaWorkflow(mount);

  // Created in `setup`, bootstrapped in `ready` (after the whole mod batch).
  let controlPlane: DefaultControlPlane | undefined;

  return defineMod({
    name: "@pattern/mod-admin",
    docs: { filesystem: "admin-docs", title: "Admin", order: 20 },
    ops: adminOps,
    workflows: [...endpointWorkflows(auth), spa],
    frontend: adminFrontend(mount),
    setup: async (engine: Engine) => {
      packagedDocs(engine);
      const storageFs = resolveFs(options.storage, () => localFs("./.pattern"));
      const assetsFs = resolveFs(options.assets, () => bundledAssets(mount));
      provideFilesystem(engine, ASSETS_FS, assetsFs);

      // The admin is the app's natural landing spot: logins without an explicit
      // `next` (bootstrap included) redirect here instead of a bare "/".
      engine.provideService(AUTH_HOME_URL, mount);

      const store = new FlystorageWorkflowStore(storageFs, { prefix: options.storePrefix });
      const sink = new MemoryTraceSink({ capacity: options.traceCapacity });
      const cp = new DefaultControlPlane(engine, store);
      registerAdminServices(engine, { controlPlane: cp, sink, engine });
      engine.onTrace(sink);
      controlPlane = cp;
      // Re-apply persisted admin settings (run retention / exclusion regex /
      // I/O sampling) — best-effort: a bad stored pattern must never block boot.
      const saved = await store.getAdminConfig();
      const obs = (saved?.observability ?? null) as { capacity?: number; exclude?: string | null; sampleIo?: boolean } | null;
      if (obs) {
        try {
          if (obs.capacity != null) sink.setCapacity(obs.capacity);
          sink.setExclude(obs.exclude ?? null);
          if (obs.sampleIo != null) engine.setIoSampling(Boolean(obs.sampleIo));
        } catch (err) {
          console.error("[pattern] ignoring bad persisted observability settings:", err);
        }
      }
    },
    // Bootstrap in `ready`, not `setup`: stored workflows may use ops from mods
    // listed *after* the admin in the project config — `ready` runs once every
    // mod of the batch is installed, so all their ops resolve.
    ready: async (engine) => {
      await controlPlane?.bootstrap();
      // Secure-by-default (§9). With no explicit `auth` option, the policy keys
      // on whether auth is *enforceable* — i.e. any auth provider is registered
      // (identity, or any future auth mod — not a specific service):
      //  - a provider exists → lock the whole admin (API + SPA) to the admin
      //    scope. Re-registering upserts by id, so the host re-derives the routes
      //    with requireAuth.
      //  - none → the admin CAN'T be secured (stamping would brick it: every
      //    principal is anonymous with no login). So it serves OPEN, but says so
      //    loudly on every boot. `auth: false` is the explicit acknowledgment
      //    that silences this; `auth: true | { scopes }` forces a requirement.
      if (options.auth === undefined) {
        if (engine.hasAuthProvider()) {
          const requirement = { scopes: ["admin"] };
          for (const wf of [...endpointWorkflows(requirement), stampRequireAuth(spaWorkflow(mount), requirement)]) {
            await engine.registerWorkflowAsync(wf);
          }
        } else {
          console.warn(
            `\n[pattern] ⚠ Pattern Admin is serving UNAUTHENTICATED at ${mount} — anyone who can reach this port\n` +
              `[pattern]   has full control of your workflows, runs, and data. Add an auth provider\n` +
              `[pattern]   (e.g. @pattern/mod-identity) to secure it, or pass admin's \`auth: false\` to\n` +
              `[pattern]   acknowledge an intentionally-open local admin and silence this warning.\n`,
          );
        }
      }
    },
  });
}

/** A ready-to-use admin mod with defaults (for `loadMods`/`engine.use`). */
export default adminMod();
