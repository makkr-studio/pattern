/**
 * @pattern-js/runtime-node — WebSocket host (§7, §9).
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
} from "@pattern-js/core";
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

const WS_TRIGGER_OPS = ["boundary.ws.open", "boundary.ws.message", "boundary.ws.close"] as const;

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
    for (const op of WS_TRIGGER_OPS) {
      for (const r of this.resolved(op)) {
        const cfg = r.workflow.nodes.find((n) => n.id === r.trigger)?.config as
          | { requireAuth?: AuthRequirement }
          | undefined;
        if (!cfg?.requireAuth) continue;
        const auth = this.engine.authorize(principal, cfg.requireAuth);
        if (!auth.ok) return `Unauthorized: ${auth.reason}`;
      }
    }
    return undefined;
  }

  /** Explicit binding (when configured) or auto mode is on for this host. */
  private get auto(): boolean {
    return !this.opts.onMessage && !this.opts.onOpen && !this.opts.onClose;
  }

  /**
   * Bindings to enforce/fire for a trigger op. Explicit options win; auto mode
   * resolves LIVE from the workflow registry (workflows deployed from the
   * admin bind without a restart, mirroring HttpHost's declarative routing).
   * Auth enforces ALL matching workflows' requirements; firing uses the first
   * (one socket, no path dispatch — multi-handler WS is an explicit-options
   * setup).
   */
  private resolved(opType: string): Array<{ workflow: Workflow; trigger: string }> {
    const explicit =
      opType === "boundary.ws.open"
        ? this.opts.onOpen
        : opType === "boundary.ws.message"
          ? this.opts.onMessage
          : this.opts.onClose;
    if (explicit) {
      const r = this.resolve(explicit, opType);
      return r ? [r] : [];
    }
    if (!this.auto) return [];
    const out: Array<{ workflow: Workflow; trigger: string }> = [];
    for (const workflow of this.engine.workflows.list()) {
      const node = workflow.nodes.find((n) => n.op === opType);
      if (node) out.push({ workflow, trigger: node.id });
    }
    return out;
  }

  private bindingFor(opType: string): WsBinding | undefined {
    const r = this.resolved(opType)[0];
    return r ? { workflow: r.workflow, trigger: r.trigger } : undefined;
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
    // Fire-and-forget MUST swallow into a log — an unhandled rejection here
    // would take the whole process down under plain `node`.
    const logFail = (err: unknown) => console.error("[pattern] ws workflow failed:", err);
    const onOpen = this.bindingFor("boundary.ws.open");
    if (onOpen) {
      void this.fire(onOpen, "boundary.ws.open", { connection: ref, user }, principal).catch(logFail);
    }

    ws.on("message", (data, isBinary) => {
      const message = isBinary ? new Uint8Array(data as Buffer) : tryJson(data.toString());
      const onMessage = this.bindingFor("boundary.ws.message");
      if (onMessage) {
        void this.fireAndSend(onMessage, ref, { message, connection: ref, user }, principal).catch(logFail);
      }
    });

    ws.on("close", (code, reason) => {
      const onClose = this.bindingFor("boundary.ws.close");
      if (onClose) {
        void this.fire(
          onClose,
          "boundary.ws.close",
          { connection: ref, user, code, reason: reason.toString() },
          principal,
        ).catch(logFail);
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
