/**
 * @pattern/mod-admin — backend service wiring (mod-admin-spec §3).
 *
 * The admin registers three in-process services on the engine; its ops reach
 * them via `ctx.services.<name>`. Bundled access through `adminServices(ctx)`
 * keeps the ops terse and the casts in one place. In-process only (P5): mod ops,
 * `ctx.services`, hooks/events are unavailable on the worker pool, so admin runs
 * use the default in-process transport.
 */

import type { Engine, OpContext } from "@pattern/core";
import type { ControlPlane } from "./control-plane/types.js";
import { ADMIN_CONTROL_PLANE } from "./control-plane/types.js";
import type { MemoryTraceSink } from "./trace/memory-sink.js";

export const ADMIN_TRACE_SINK = "adminTraceSink";
export const ADMIN_ENGINE = "adminEngine";

/** Name of the filesystem the admin SPA assets are served from. */
export const ASSETS_FS = "admin-assets";

export interface AdminBackend {
  controlPlane: ControlPlane;
  sink: MemoryTraceSink;
  engine: Engine;
}

/** Register the admin backend services on an engine. */
export function registerAdminServices(engine: Engine, backend: AdminBackend): void {
  engine.provideService(ADMIN_CONTROL_PLANE, backend.controlPlane);
  engine.provideService(ADMIN_TRACE_SINK, backend.sink);
  engine.provideService(ADMIN_ENGINE, backend.engine);
}

/** Read the admin backend out of an op's context (throws if not installed). */
export function adminServices(ctx: OpContext): AdminBackend {
  const controlPlane = ctx.services[ADMIN_CONTROL_PLANE] as ControlPlane | undefined;
  const sink = ctx.services[ADMIN_TRACE_SINK] as MemoryTraceSink | undefined;
  const engine = ctx.services[ADMIN_ENGINE] as Engine | undefined;
  if (!controlPlane || !sink || !engine) {
    throw new Error("admin backend services are not registered (use the mod-admin mod)");
  }
  return { controlPlane, sink, engine };
}
