import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { Engine, type Workflow } from "@pattern/core";
import { WsHost, NodeConnectionRegistry } from "@pattern/runtime-node";

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

/** Echo workflow: uppercases the inbound message and sends it back. */
const echo: Workflow = {
  id: "ws-echo",
  nodes: [
    { id: "in", op: "boundary.ws.message" },
    { id: "up", op: "core.string.upper" },
    { id: "out", op: "boundary.ws.send" },
  ],
  edges: [
    { from: { node: "in", port: "message" }, to: { node: "up", port: "value" } },
    { from: { node: "up", port: "out" }, to: { node: "out", port: "message" } },
  ],
};

describe("WebSocket host (§7)", () => {
  it("round-trips a message through ws.message → ws.send", async () => {
    const connections = new NodeConnectionRegistry();
    const engine = new Engine({ connections });
    engine.registerWorkflow(echo);

    server = createServer();
    new WsHost(engine, { onMessage: { workflow: "ws-echo" } }, connections).attach(server);
    const port = await new Promise<number>((r) => server!.listen(0, () => r((server!.address() as any).port)));

    const reply = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      ws.on("open", () => ws.send("hello"));
      ws.on("message", (data) => {
        resolve(data.toString());
        ws.close();
      });
      ws.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 5000);
    });
    expect(reply).toBe("HELLO");
  });

  it("refuses messages failing the trigger's schema (no run; error reply)", async () => {
    const connections = new NodeConnectionRegistry();
    const engine = new Engine({ connections });
    // Same echo graph, but the trigger declares a message schema: strings only.
    engine.registerWorkflow({
      ...echo,
      id: "ws-echo-typed",
      nodes: echo.nodes.map((n) => (n.id === "in" ? { ...n, config: { message: { type: "string" } } } : n)),
    });

    server = createServer();
    new WsHost(engine, { onMessage: { workflow: "ws-echo-typed" } }, connections).attach(server);
    const port = await new Promise<number>((r) => server!.listen(0, () => r((server!.address() as any).port)));

    const replies = await new Promise<string[]>((resolve, reject) => {
      const got: string[] = [];
      const ws = new WebSocket(`ws://localhost:${port}`);
      ws.on("open", () => {
        ws.send(JSON.stringify({ nope: 1 })); // object → schema refuses
        ws.send("hello"); // string → runs
      });
      ws.on("message", (data) => {
        got.push(data.toString());
        if (got.length === 2) {
          resolve(got);
          ws.close();
        }
      });
      ws.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 5000);
    });

    const errorReply = JSON.parse(replies[0]!);
    expect(errorReply.error).toBe("invalid message");
    expect(errorReply.issues.length).toBeGreaterThan(0);
    expect(replies[1]).toBe("HELLO");
  });

  it("broadcasts to a room via the connection registry", async () => {
    const reg = new NodeConnectionRegistry();
    const received: string[] = [];
    // Two fake sockets capturing what they're sent.
    const mkSocket = () => ({ send: (d: any) => received.push(String(d)), close: () => {} }) as any;
    const a = reg.add(mkSocket());
    const b = reg.add(mkSocket());
    await reg.join(a, "room1");
    await reg.join(b, "room1");
    await reg.broadcast("room1", "ping");
    expect(received).toEqual(["ping", "ping"]);
    expect(reg.members("room1")).toHaveLength(2);
  });
});
