/**
 * §12 — App ops.
 *
 * An "app" is a serveable asset bundle described by an `AppDescriptor` (§7):
 * which registered filesystem holds the assets plus serving hints. App ops
 * *produce* that descriptor; the `boundary.http.app` trigger / `…app.serve`
 * out-gate pair carries it to the host, which mounts static serving. Mods ship
 * their own app ops (e.g. the admin's `admin.app`) that point at their bundles.
 */

import { z } from "zod";
import { appDescriptorSchema } from "../boundaries/index.js";
import { value } from "./helpers.js";
import type { OpDefinition } from "../types.js";

/** Serve a registered filesystem as a static app (SPA-fallback aware). */
export const staticApp: OpDefinition = {
  type: "core.app.static",
  title: "core.app.static",
  description:
    "Builds an app object serving a registered filesystem's assets: { filesystem, spaFallback, " +
    "immutableAssets }. `filesystem` is a NAME registered via provideFilesystem, not a path; the " +
    "host resolves it once at registration (rebuilt assets need a restart). Wire its `app` output " +
    "into `boundary.http.app.serve`.",
  inputs: {},
  outputs: { app: value(appDescriptorSchema) },
  config: z.object({
    /** Name of a filesystem registered on the engine (host resolves it). */
    filesystem: z.string(),
    /** Served on a miss when the client accepts HTML (client-side routing). "" disables. */
    spaFallback: z.string().default("index.html"),
    /** Send long-lived immutable cache headers (use with hashed filenames). */
    immutableAssets: z.boolean().default(false),
  }),
  execute: (ctx) => ({ app: { ...(ctx.config as object) } }),
};

export const appOps: OpDefinition[] = [staticApp];
