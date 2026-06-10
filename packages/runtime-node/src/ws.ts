/**
 * @pattern/runtime-node — WebSocket host (§7).
 *
 * Node has no built-in WS *server*, so this host uses `ws` on the HTTP upgrade
 * (an adapter-level dependency; core stays clean). It fires a run **per inbound
 * message** through `boundary.ws.message`, plus optional `boundary.ws.open` /
 * `boundary.ws.close` lifecycle workflows, and sends `boundary.ws.send` results
 * back on the originating connection.
 */

import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { jsonSchemaToZod, type Engine, type RunResult, type Workflow } from "@pattern/core";
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
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
    });
    return this;
  }

  private onConnection(ws: WebSocket): void {
    const ref = this.connections.add(ws);

    if (this.opts.onOpen) void this.fire(this.opts.onOpen, "boundary.ws.open", { connection: ref });

    ws.on("message", (data, isBinary) => {
      const message = isBinary ? new Uint8Array(data as Buffer) : tryJson(data.toString());
      if (this.opts.onMessage) {
        void this.fireAndSend(this.opts.onMessage, ref, { message, connection: ref });
      }
    });

    ws.on("close", (code, reason) => {
      if (this.opts.onClose) {
        void this.fire(this.opts.onClose, "boundary.ws.close", {
          connection: ref,
          code,
          reason: reason.toString(),
        });
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

  private async fire(binding: WsBinding, defaultOp: string, input: Record<string, unknown>): Promise<RunResult | undefined> {
    const r = this.resolve(binding, defaultOp);
    if (!r) return undefined;
    return this.engine.runFrom(r.workflow, r.trigger, input, { kind: "anonymous" });
  }

  private async fireAndSend(binding: WsBinding, ref: { id: string }, input: Record<string, unknown>): Promise<void> {
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

    const result = await this.engine.runFrom(r.workflow, r.trigger, input, { kind: "anonymous" });
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
