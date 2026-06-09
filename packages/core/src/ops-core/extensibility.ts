/**
 * §8 / §12 — Hooks & events ops.
 *
 *  - `core.event.emit`  — fire-and-forget pub/sub; no outputs.
 *  - `core.hook.invoke` — blocking, priority-ordered filter chain; returns the
 *                         threaded payload.
 */

import { defineOp, required, value, z } from "./helpers.js";
import type { OpDefinition } from "../types.js";

export const eventEmit: OpDefinition = defineOp({
  type: "core.event.emit",
  title: "core.event.emit",
  description: "Emit a fire-and-forget event onto the bus (§8).",
  inputs: { payload: value() },
  outputs: {},
  config: z.object({ event: z.string() }),
  execute: async (ctx) => {
    const payload = await ctx.input.value("payload");
    ctx.services.events.emit((ctx.config as { event: string }).event, payload);
    return {};
  },
});

export const hookInvoke: OpDefinition = defineOp({
  type: "core.hook.invoke",
  title: "core.hook.invoke",
  description: "Invoke a hook chain and return the (possibly modified) payload (§8). Blocks until complete.",
  inputs: { payload: required() },
  outputs: { payload: value() },
  config: z.object({ hook: z.string() }),
  execute: async (ctx) => {
    const payload = await ctx.input.value("payload");
    const result = await ctx.services.hooks.invoke((ctx.config as { hook: string }).hook, payload);
    return { payload: result };
  },
});

export const extensibilityOps: OpDefinition[] = [eventEmit, hookInvoke];
