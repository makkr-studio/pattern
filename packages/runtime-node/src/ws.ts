/**
 * @pattern/runtime-node — WebSocket host (§7, §9).
 *
 * Node has no built-in WS *server*, so this host uses `ws` on the HTTP upgrade
 * (an adapter-level dependency; core stays clean). It fires a run **per inbound
 * message** through `boundary.ws.message`, plus optional `boundary.ws.open` /
 * `boundary.ws.close` lifecycle workflows, and sends `boundary.ws.send` results
 * back on the originating connection.
 *
 * Auth (§9) happens **at upgrade time**: the provider chain resolves a principal
 * from the upgrade request's headers (same cookie the HTTP host sees), every
 * bound trigger's `requireAuth` is enforced *before* the socket is accepted
 * (raw 401 + destroy on failure), and the principal is fixed to the connection
 * for its lifetime — open/message/close runs all execute as it and see it on
 * their `user` port. Authenticated connections auto-join the `user:{id}` and
 * `session:{sessionId}` rooms, so "message all of this user's devices" is a
 * broadcast and session revocation is a `closeRoom`.
 */

import type { Server } from "node:http";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  jsonSchemaToZod,
  principalToUser,
  type AuthRequirement,
  type Engine,
  type Principal,
  type RunResult,
  type Workflow,
} from "@pattern/core";
import { NodeConnectionRegistry } from "./ws-registry.js";

export interface WsBinding {
  workflow: Workflow | string;
  trigger?: string;
}

export interface WsHostOptions {
  /** Run per inbound message (boundary.ws.message). */
  onMessage?: WsBinding;
  /** Run on connection open (boundary.ws.open). */
  onOpen?: WsBinding;
  /** Run on connection close (boundary.ws.close). */
  onClose?: WsBinding;
  /** Restrict to a path (e.g. "/ws"). */
  path?: string;
}

export class WsHost {
  readonly wss: WebSocketServer;
  readonly connections: NodeConnectionRegistry;

  constructor(
    private readonly engine: Engine,
    private readonly opts: WsHostOptions,
    connections?: NodeConnectionRegistry,
  ) {
    // Reuse the engine's connection registry if it is a node one, so `core.ws.*`
    // ops mid-run reach the same sockets as the host.
    this.connections =
      connections ??
      (engine.connections instanceof NodeConnectionRegistry
        ? (engine.connections as NodeConnectionRegistry)
        : new NodeConnectionRegistry());
    this.wss = new WebSocketServer({ noServer: true });
  }

  /** Attach to an HTTP server's upgrade event. */
  attach(server: Server): this {
    server.on("upgrade", (req, socket, head) => {
      if (this.opts.path) {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== this.opts.path) {
          socket.destroy();
          return;
        }
      }
      // Auth is async; the upgrade listener tolerates a detached promise.
      void (async () => {
        const principal = await this.authenticate(req);
        const denied = this.deniedReason(principal);
        if (denied) {
          // Reject BEFORE the WS handshake: the socket never becomes a connection.
          socket.write(
            "HTTP/1.1 401 Unauthorized\r\n" +
              "Connection: close\r\n" +
              `Content-Length: ${Buffer.byteLength(denied)}\r\n` +
              "Content-Type: text/plain\r\n\r\n" +
              denied,
          );
          socket.destroy();
          return;
        }
        this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, principal));
      })().catch(() => socket.destroy());
    });
    return this;
  }

  /** Resolve a principal from the upgrade request via the provider chain (§9). */
  private async authenticate(req: IncomingMessage): Promise<Principal> {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(", "));
    }
    return this.engine.authenticate({ headers, raw: req });
  }

  /**
   * Enforce every bound trigger's `requireAuth` (§9). One socket serves all
   * three lifecycle triggers, so the connection must satisfy the union of
   * their requirements — a protected message handler protects the upgrade.
   */
  private deniedReason(principal: Principal): string | undefined {
    const bindings = [
      [this.opts.onOpen, "boundary.ws.open"],
      [this.opts.onMessage, "boundary.ws.message"],
      [this.opts.onClose, "boundary.ws.close"],
    ] as const;
    for (const [binding, op] of bindings) {
      if (!binding) continue;
      const r = this.resolve(binding, op);
      if (!r) continue;
      const cfg = r.workflow.nodes.find((n) => n.id === r.trigger)?.config as
        | { requireAuth?: AuthRequirement }
        | undefined;
      if (!cfg?.requireAuth) continue;
      const auth = this.engine.authorize(principal, cfg.requireAuth);
      if (!auth.ok) return `Unauthorized: ${auth.reason}`;
    }
    return undefined;
  }

  private onConnection(ws: WebSocket, principal: Principal): void {
    const ref = this.connections.add(ws, undefined, principal);

    // Identity rooms (§9): broadcast to all of a user's devices via `user:{id}`;
    // revoking a session closes its sockets via `session:{sessionId}`.
    if (principal.kind === "user") {
      void this.connections.join(ref, `user:${principal.id}`);
      const sid = principal.claims?.sessionId;
      if (typeof sid === "string") void this.connections.join(ref, `session:${sid}`);
    }

    const user = principalToUser(principal);
    if (this.opts.onOpen) {
      void this.fire(this.opts.onOpen, "boundary.ws.open", { connection: ref, user }, principal);
    }

    ws.on("message", (data, isBinary) => {
      const message = isBinary ? new Uint8Array(data as Buffer) : tryJson(data.toString());
      if (this.opts.onMessage) {
        void this.fireAndSend(this.opts.onMessage, ref, { message, connection: ref, user }, principal);
      }
    });

    ws.on("close", (code, reason) => {
      if (this.opts.onClose) {
        void this.fire(
          this.opts.onClose,
          "boundary.ws.close",
          { connection: ref, user, code, reason: reason.toString() },
          principal,
        );
      }
      this.connections.remove(ref.id);
    });
  }

  private resolve(binding: WsBinding, defaultOp: string): { workflow: Workflow; trigger: string } | undefined {
    const workflow =
      typeof binding.workflow === "string" ? this.engine.workflows.get(binding.workflow) : binding.workflow;
    if (!workflow) return undefined;
    const trigger = binding.trigger ?? workflow.nodes.find((n) => n.op === defaultOp)?.id;
    if (!trigger) return undefined;
    return { workflow, trigger };
  }

  private async fire(
    binding: WsBinding,
    defaultOp: string,
    input: Record<string, unknown>,
    principal: Principal,
  ): Promise<RunResult | undefined> {
    const r = this.resolve(binding, defaultOp);
    if (!r) return undefined;
    return this.engine.runFrom(r.workflow, r.trigger, input, principal);
  }

  private async fireAndSend(
    binding: WsBinding,
    ref: { id: string },
    input: Record<string, unknown>,
    principal: Principal,
  ): Promise<void> {
    const r = this.resolve(binding, "boundary.ws.message");
    if (!r) return;

    // Declarative message validation (§7): the trigger's `message` schema
    // (often wired in from a `core.schema.define` node) gates the run — an
    // invalid message gets an error reply instead of executing the graph.
    const trigger = r.workflow.nodes.find((n) => n.id === r.trigger);
    const schema = (trigger?.config as { message?: Record<string, unknown> } | undefined)?.message;
    if (schema) {
      const parsed = jsonSchemaToZod(schema as never).safeParse(input.message);
      if (!parsed.success) {
        await this.connections.send(ref, {
          error: "invalid message",
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
        return;
      }
      input = { ...input, message: parsed.data };
    }

    const result = await this.engine.runFrom(r.workflow, r.trigger, input, principal);
    if (result.status !== "ok") return;
    const payload = firstOutgate(result, r.workflow, "boundary.ws.send");
    if (!payload) return;
    if (payload.stream instanceof ReadableStream) {
      await this.connections.sendStream(ref, payload.stream);
    } else if (payload.message !== undefined) {
      await this.connections.send(ref, payload.message);
    }
  }
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function firstOutgate(
  result: RunResult,
  workflow: Workflow,
  opType: string,
): { message?: unknown; stream?: ReadableStream<unknown> } | undefined {
  for (const [nodeId, payload] of Object.entries(result.outputs)) {
    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (node?.op === opType) return payload as any;
  }
  return undefined;
}

/** Create a WS host (attach it to an HTTP server with `.attach(server)`). */
export function createWsHost(engine: Engine, opts: WsHostOptions, connections?: NodeConnectionRegistry): WsHost {
  return new WsHost(engine, opts, connections);
}
