/**
 * §12 — WebSocket ops. These route through `ctx.services.connections`, the
 * connection registry behind an interface (§7), so outbound messaging works the
 * same in-process and—later—across a pub/sub backplane for distribution.
 */

import { defineOp, required, stream, value, z } from "./helpers.js";
import type { ConnectionRef, OpDefinition } from "../types.js";

const connectionSchema = z.union([z.string(), z.object({ id: z.string() }).loose()]);

const asConn = (v: unknown): ConnectionRef | string => v as ConnectionRef | string;

export const wsEmit: OpDefinition = defineOp({
  type: "core.ws.emit",
  title: "core.ws.emit",
  description: "Send a message to a connection (value, or wire the `messages` stream for chunked sends).",
  inputs: { connection: required(connectionSchema), message: value(), messages: stream() },
  outputs: {},
  execute: async (ctx) => {
    const connection = asConn(await ctx.input.value("connection"));
    if (ctx.input.has("messages")) {
      await ctx.services.connections.sendStream(connection, ctx.input.stream("messages"));
    } else {
      await ctx.services.connections.send(connection, await ctx.input.value("message"));
    }
    return {};
  },
});

export const wsBroadcast: OpDefinition = defineOp({
  type: "core.ws.broadcast",
  title: "core.ws.broadcast",
  description: "Send a message to all connections in a room/topic.",
  inputs: { room: required(z.string()), message: required() },
  outputs: {},
  execute: async (ctx) => {
    const [room, message] = await Promise.all([ctx.input.value<string>("room"), ctx.input.value("message")]);
    await ctx.services.connections.broadcast(room, message);
    return {};
  },
});

export const wsJoin: OpDefinition = defineOp({
  type: "core.ws.join",
  title: "core.ws.join",
  description: "Add a connection to a room/topic.",
  inputs: { connection: required(connectionSchema), room: required(z.string()) },
  outputs: {},
  execute: async (ctx) => {
    const [connection, room] = await Promise.all([ctx.input.value("connection"), ctx.input.value<string>("room")]);
    await ctx.services.connections.join(asConn(connection), room);
    return {};
  },
});

export const wsLeave: OpDefinition = defineOp({
  type: "core.ws.leave",
  title: "core.ws.leave",
  description: "Remove a connection from a room/topic.",
  inputs: { connection: required(connectionSchema), room: required(z.string()) },
  outputs: {},
  execute: async (ctx) => {
    const [connection, room] = await Promise.all([ctx.input.value("connection"), ctx.input.value<string>("room")]);
    await ctx.services.connections.leave(asConn(connection), room);
    return {};
  },
});

export const wsClose: OpDefinition = defineOp({
  type: "core.ws.close",
  title: "core.ws.close",
  description: "Close a connection.",
  inputs: { connection: required(connectionSchema) },
  outputs: {},
  config: z.object({ code: z.number().optional(), reason: z.string().optional() }),
  execute: async (ctx) => {
    const connection = asConn(await ctx.input.value("connection"));
    const { code, reason } = ctx.config as { code?: number; reason?: string };
    await ctx.services.connections.close(connection, code, reason);
    return {};
  },
});

/**
 * The notification envelope every `core.ws.notify` push wears. Frontends
 * filter on `kind === "notify"` and dispatch on `type` — THE convention for
 * server-initiated "something changed" pings (the WS side of the
 * SSE-for-streams / WS-for-notifications split).
 */
export interface NotifyEnvelope {
  kind: "notify";
  type: string;
  payload: unknown;
  ts: number;
}

export const wsNotify: OpDefinition = defineOp({
  type: "core.ws.notify",
  title: "core.ws.notify",
  description:
    'Push a typed notification to a room (conventionally "user:{id}"): envelope {kind:"notify", type, payload, ts}.',
  inputs: { room: required(z.string()), type: required(z.string()), payload: value() },
  outputs: {},
  execute: async (ctx) => {
    const [room, type, payload] = await Promise.all([
      ctx.input.value<string>("room"),
      ctx.input.value<string>("type"),
      ctx.input.has("payload") ? ctx.input.value("payload") : Promise.resolve(null),
    ]);
    const envelope: NotifyEnvelope = { kind: "notify", type, payload: payload ?? null, ts: Date.now() };
    await ctx.services.connections.broadcast(room, envelope);
    return {};
  },
});

export const wsOps: OpDefinition[] = [wsEmit, wsBroadcast, wsJoin, wsLeave, wsClose, wsNotify];
