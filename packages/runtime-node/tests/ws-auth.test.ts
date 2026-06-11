import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { Engine, type AuthProvider, type Workflow } from "@pattern/core";
import { WsHost, NodeConnectionRegistry } from "@pattern/runtime-node";

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

/** Token-header auth provider: `x-token: <user>` → user principal. */
const tokenProvider: AuthProvider = {
  name: "test-token",
  authenticate: async (ctx) => {
    const token = ctx.headers.get("x-token");
    if (!token) return null;
    return {
      kind: "user",
      id: token,
      provider: "test",
      scopes: token === "root" ? ["admin"] : [],
      claims: { sessionId: `sess-${token}`, email: `${token}@test` },
    };
  },
};

/** Echo workflow whose message trigger requires an authenticated user. */
function protectedEcho(requireAuth: unknown): Workflow {
  return {
    id: "ws-protected",
    nodes: [
      { id: "in", op: "boundary.ws.message", config: { requireAuth } },
      { id: "up", op: "core.string.upper" },
      { id: "out", op: "boundary.ws.send" },
    ],
    edges: [
      { from: { node: "in", port: "message" }, to: { node: "up", port: "value" } },
      { from: { node: "up", port: "out" }, to: { node: "out", port: "message" } },
    ],
  };
}

async function listen(s: Server): Promise<number> {
  return new Promise<number>((r) => s.listen(0, () => r((s.address() as any).port)));
}

function connect(port: number, headers?: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`, { headers });
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
    ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    setTimeout(() => reject(new Error("timeout")), 5000);
  });
}

describe("WebSocket auth at upgrade (§9)", () => {
  it("rejects an unauthenticated upgrade for a protected trigger with 401", async () => {
    const connections = new NodeConnectionRegistry();
    const engine = new Engine({ connections });
    engine.registerAuthProvider(tokenProvider);
    engine.registerWorkflow(protectedEcho(true));

    server = createServer();
    new WsHost(engine, { onMessage: { workflow: "ws-protected" } }, connections).attach(server);
    const port = await listen(server);

    await expect(connect(port)).rejects.toThrow("HTTP 401");
  });

  it("rejects missing scopes, accepts sufficient ones", async () => {
    const connections = new NodeConnectionRegistry();
    const engine = new Engine({ connections });
    engine.registerAuthProvider(tokenProvider);
    engine.registerWorkflow(protectedEcho({ scopes: ["admin"] }));

    server = createServer();
    new WsHost(engine, { onMessage: { workflow: "ws-protected" } }, connections).attach(server);
    const port = await listen(server);

    // Authenticated but missing the scope → still 401 at upgrade.
    await expect(connect(port, { "x-token": "mortal" })).rejects.toThrow("HTTP 401");

    // Admin connects and the echo round-trips.
    const ws = await connect(port, { "x-token": "root" });
    const reply = await new Promise<string>((resolve, reject) => {
      ws.on("message", (d) => resolve(d.toString()));
      ws.on("error", reject);
      ws.send("hi");
      setTimeout(() => reject(new Error("timeout")), 5000);
    });
    expect(reply).toBe("HI");
    ws.close();
  });

  it("auto-joins user:{id} and session:{sid} rooms; closeRoom severs the socket", async () => {
    const connections = new NodeConnectionRegistry();
    const engine = new Engine({ connections });
    engine.registerAuthProvider(tokenProvider);
    engine.registerWorkflow(protectedEcho(true));

    server = createServer();
    new WsHost(engine, { onMessage: { workflow: "ws-protected" } }, connections).attach(server);
    const port = await listen(server);

    const ws = await connect(port, { "x-token": "ada" });
    // Rooms are joined during onConnection — settle the microtask.
    await new Promise((r) => setTimeout(r, 50));
    expect(connections.members("user:ada")).toHaveLength(1);
    expect(connections.members("session:sess-ada")).toHaveLength(1);

    const id = connections.members("session:sess-ada")[0]!;
    expect(connections.principalOf(id)).toMatchObject({ kind: "user", id: "ada" });

    // Session revocation closes the room → the client sees the socket close.
    const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
    await connections.closeRoom("session:sess-ada", 4001, "session revoked");
    expect(await closed).toBe(4001);
    expect(connections.members("session:sess-ada")).toHaveLength(0);
    expect(connections.members("user:ada")).toHaveLength(0);
  });

  it("anonymous connections still work on unprotected triggers and join no rooms", async () => {
    const connections = new NodeConnectionRegistry();
    const engine = new Engine({ connections });
    engine.registerWorkflow({ ...protectedEcho(undefined), id: "ws-open-echo" });

    server = createServer();
    new WsHost(engine, { onMessage: { workflow: "ws-open-echo" } }, connections).attach(server);
    const port = await listen(server);

    const ws = await connect(port);
    const reply = await new Promise<string>((resolve, reject) => {
      ws.on("message", (d) => resolve(d.toString()));
      ws.send("ok");
      setTimeout(() => reject(new Error("timeout")), 5000);
    });
    expect(reply).toBe("OK");
    ws.close();
  });
});

describe("WS trigger `user` port (§9)", () => {
  it("seeds the resolved user (and null for anonymous)", async () => {
    const connections = new NodeConnectionRegistry();
    const engine = new Engine({ connections });
    engine.registerAuthProvider(tokenProvider);
    // Reflects the `user` port straight back at the sender.
    engine.registerWorkflow({
      id: "ws-whoami",
      nodes: [
        { id: "in", op: "boundary.ws.message" },
        { id: "out", op: "boundary.ws.send" },
      ],
      edges: [{ from: { node: "in", port: "user" }, to: { node: "out", port: "message" } }],
    });

    server = createServer();
    new WsHost(engine, { onMessage: { workflow: "ws-whoami" } }, connections).attach(server);
    const port = await listen(server);

    const ask = async (headers?: Record<string, string>) => {
      const ws = await connect(port, headers);
      const reply = await new Promise<string>((resolve, reject) => {
        ws.on("message", (d) => resolve(d.toString()));
        ws.send("who am i");
        setTimeout(() => reject(new Error("timeout")), 5000);
      });
      ws.close();
      return JSON.parse(reply);
    };

    expect(await ask({ "x-token": "ada" })).toMatchObject({
      id: "ada",
      provider: "test",
      email: "ada@test",
      claims: { sessionId: "sess-ada" },
    });
    expect(await ask()).toBeNull();
  });
});
