import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { type Workflow } from "@pattern-js/core";
import { loadProject } from "@pattern-js/runtime-node";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

/** Echo workflow bound declaratively (no explicit WsHost options anywhere). */
const echo: Workflow = {
  id: "ws-auto-echo",
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

/** An HTTP route so the default-port server opens. */
const ping: Workflow = {
  id: "ping",
  nodes: [
    { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/ping" } },
    { id: "out", op: "boundary.http.response" },
  ],
  edges: [{ from: { node: "in", port: "query" }, to: { node: "out", port: "body" } }],
};

function projectDir(workflows: Workflow[]): string {
  const dir = mkdtempSync(join(tmpdir(), "pattern-ws-auto-"));
  mkdirSync(join(dir, "workflows"));
  for (const wf of workflows) writeFileSync(join(dir, "workflows", `${wf.id}.json`), JSON.stringify(wf));
  return dir;
}

async function bootProject(workflows: Workflow[], port: number, ws?: false) {
  const dir = projectDir(workflows);
  const project = await loadProject({ workflows: join(dir, "workflows"), http: { port }, ws });
  const { close } = await project.start();
  closer = close;
  return project;
}

describe("loadProject WS auto-wiring", () => {
  it("binds boundary.ws.message workflows declaratively on the HTTP server", async () => {
    const project = await bootProject([echo, ping], 4955);
    expect(project.ws).toBeDefined();

    const reply = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket("ws://localhost:4955");
      ws.on("open", () => ws.send("auto"));
      ws.on("message", (d) => {
        resolve(d.toString());
        ws.close();
      });
      ws.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 5000);
    });
    expect(reply).toBe("AUTO");
  });

  it("accepts bare connections as a notification channel (no ws workflows at all)", async () => {
    const project = await bootProject([ping], 4956);

    const got = await new Promise<unknown>((resolve, reject) => {
      const ws = new WebSocket("ws://localhost:4956");
      ws.on("message", (d) => resolve(JSON.parse(d.toString())));
      ws.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 5000);

      // Once the socket registers, join it to a room and push a notify
      // envelope through the ENGINE's registry — proving core.ws.* ops and
      // the host share sockets (loadProject wires one NodeConnectionRegistry).
      const tick = setInterval(() => {
        void (async () => {
          const reg = project.ws!.connections;
          const ids = reg.ids();
          if (ids.length === 0) return;
          clearInterval(tick);
          await reg.join(ids[0]!, "user:test");
          await project.engine.connections.broadcast("user:test", {
            kind: "notify",
            type: "demo.ping",
            payload: { n: 1 },
            ts: Date.now(),
          });
        })();
      }, 20);
    });
    expect(got).toMatchObject({ kind: "notify", type: "demo.ping", payload: { n: 1 } });
  });

  it("config.ws === false refuses upgrades", async () => {
    const project = await bootProject([ping], 4957, false);
    expect(project.ws).toBeUndefined();

    const failed = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket("ws://localhost:4957");
      ws.on("open", () => resolve(false));
      ws.on("error", () => resolve(true));
      setTimeout(() => resolve(true), 3000);
    });
    expect(failed).toBe(true);
  });

  it("still enforces requireAuth at upgrade in auto mode", async () => {
    const guarded: Workflow = {
      ...echo,
      id: "ws-auto-guarded",
      nodes: echo.nodes.map((n) =>
        n.id === "in" ? { ...n, config: { requireAuth: { scopes: ["admin"] } } } : n,
      ),
    };
    const project = await bootProject([guarded, ping], 4958);
    // requireAuth is only ENFORCED when auth is enforceable — register a provider
    // so the upgrade is actually gated (without one it degrades to advisory-open).
    project.engine.registerAuthProvider({ name: "deny", authenticate: async () => null });

    const denied = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket("ws://localhost:4958");
      ws.on("open", () => resolve(false));
      ws.on("error", () => resolve(true));
      setTimeout(() => resolve(true), 3000);
    });
    expect(denied).toBe(true);
  });
});
