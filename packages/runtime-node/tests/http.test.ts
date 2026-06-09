import { describe, it, expect, afterEach } from "vitest";
import { Engine, defineOp, stream, value, z, iterableToStream, type Workflow } from "@pattern/core";
import { createHttpHost } from "@pattern/runtime-node";

/** An op that emits a fixed token stream — stands in for an agent. */
const tokensOp = defineOp({
  type: "test.tokens",
  inputs: {},
  outputs: { tokens: stream(z.string()) },
  execute: () => ({ tokens: iterableToStream(["a", "b", "c"]) }),
});

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

async function startOn(engine: Engine, port: number) {
  const host = createHttpHost(engine, { defaultPort: port });
  const { close } = await host.start();
  closer = close;
  return host;
}

const tick = () => new Promise((r) => setTimeout(r, 15));

describe("HTTP host — declarative routing", () => {
  it("derives a buffered route from the op config and echoes the body", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "echo",
      nodes: [
        { id: "in", op: "boundary.http.request", config: { method: "POST", path: "/echo" } },
        { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
      ],
      edges: [{ from: { node: "in", port: "body" }, to: { node: "out", port: "body" } }],
    };
    engine.registerWorkflow(wf);
    await startOn(engine, 4801);

    const res = await fetch("http://localhost:4801/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hi: 1 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hi: 1 });
  });

  it("matches :params and method from config", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "hello",
      nodes: [
        { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/hello/:name" } },
        { id: "msg", op: "core.string.template", config: { template: "Hi {{ name }}" } },
        { id: "out", op: "boundary.http.response" },
      ],
      edges: [
        { from: { node: "in", port: "params" }, to: { node: "msg", port: "data" } },
        { from: { node: "msg", port: "out" }, to: { node: "out", port: "body" } },
      ],
    };
    engine.registerWorkflow(wf);
    await startOn(engine, 4802);
    const res = await fetch("http://localhost:4802/hello/ada");
    expect(await res.text()).toBe("Hi ada");
  });

  it("validates the body against the declared JSON Schema (400 on mismatch)", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "create",
      nodes: [
        {
          id: "in",
          op: "boundary.http.request",
          config: {
            method: "POST",
            path: "/users",
            body: { type: "object", properties: { name: { type: "string" }, age: { type: "integer" } }, required: ["name"] },
          },
        },
        { id: "out", op: "boundary.http.response" },
      ],
      edges: [{ from: { node: "in", port: "body" }, to: { node: "out", port: "body" } }],
    };
    engine.registerWorkflow(wf);
    await startOn(engine, 4803);

    const ok = await fetch("http://localhost:4803/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada", age: 36 }),
    });
    expect(ok.status).toBe(200);

    const bad = await fetch("http://localhost:4803/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ age: 36 }),
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("body");
  });

  it("coerces & validates query params", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "search",
      nodes: [
        {
          id: "in",
          op: "boundary.http.request",
          config: { path: "/search", query: { type: "object", properties: { limit: { type: "integer" } } } },
        },
        { id: "out", op: "boundary.http.response" },
      ],
      edges: [{ from: { node: "in", port: "query" }, to: { node: "out", port: "body" } }],
    };
    engine.registerWorkflow(wf);
    await startOn(engine, 4804);
    const res = await fetch("http://localhost:4804/search?limit=5");
    expect(await res.json()).toEqual({ limit: 5 }); // coerced to a number
  });

  it("applies CORS and answers preflight", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "cors",
      nodes: [
        { id: "in", op: "boundary.http.request", config: { method: "POST", path: "/api", cors: true } },
        { id: "out", op: "boundary.http.response" },
      ],
      edges: [{ from: { node: "in", port: "body" }, to: { node: "out", port: "body" } }],
    };
    engine.registerWorkflow(wf);
    await startOn(engine, 4805);

    const pre = await fetch("http://localhost:4805/api", { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("omits the CORS allow-origin header for origins outside an allowlist", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "cors-list",
      nodes: [
        {
          id: "in",
          op: "boundary.http.request",
          config: { method: "POST", path: "/api", cors: { origin: ["https://app.example.com"] } },
        },
        { id: "out", op: "boundary.http.response" },
      ],
      edges: [{ from: { node: "in", port: "body" }, to: { node: "out", port: "body" } }],
    };
    engine.registerWorkflow(wf);
    await startOn(engine, 4815);

    // Allowlisted origin is echoed back.
    const ok = await fetch("http://localhost:4815/api", { method: "OPTIONS", headers: { origin: "https://app.example.com" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://app.example.com");

    // Unlisted origin gets NO allow-origin header (echoing any allowlisted
    // value back would open CORS to everyone).
    const evil = await fetch("http://localhost:4815/api", { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("streams an SSE response (agent → split → SSE + TTS)", async () => {
    const engine = new Engine();
    engine.registerOp(tokensOp);
    const wf: Workflow = {
      id: "chat",
      nodes: [
        { id: "in", op: "boundary.http.request", config: { path: "/chat" } },
        { id: "agent", op: "test.tokens" },
        { id: "split", op: "core.stream.split", config: { branches: 2 } },
        { id: "tts", op: "core.stream.accumulate", config: { mode: "concat" } },
        { id: "out", op: "boundary.http.response", config: { mode: "sse" } },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "agent", port: "in" } },
        { from: { node: "agent", port: "tokens" }, to: { node: "split", port: "in" } },
        { from: { node: "split", port: "out.0" }, to: { node: "out", port: "stream" } },
        { from: { node: "split", port: "out.1" }, to: { node: "tts", port: "in" } },
      ],
    };
    engine.registerWorkflow(wf);
    await startOn(engine, 4806);
    const text = await (await fetch("http://localhost:4806/chat")).text();
    expect(text).toContain("data: a");
    expect(text).toContain("data: c");
  });
});

describe("HTTP host — port resolution", () => {
  const route = (id: string, path: string, msg: string, port?: number): Workflow => ({
    id,
    nodes: [
      { id: "in", op: "boundary.http.request", config: port ? { path, port } : { path } },
      { id: "k", op: "core.const.string", config: { value: msg } },
      { id: "out", op: "boundary.http.response" },
    ],
    edges: [
      { from: { node: "in", port: "out" }, to: { node: "out", port: "in" } },
      { from: { node: "k", port: "out" }, to: { node: "out", port: "body" } },
    ],
  });

  it("opens a server per declared port (op config.port wins)", async () => {
    const engine = new Engine();
    engine.registerWorkflow(route("main", "/main", "on-default")); // host default
    engine.registerWorkflow(route("admin", "/admin", "on-3001", 4831)); // explicit port
    const host = createHttpHost(engine, { defaultPort: 4830 });
    const { ports, close } = await host.start();
    closer = close;
    expect(ports.sort()).toEqual([4830, 4831]);
    expect(await (await fetch("http://localhost:4830/main")).text()).toBe("on-default");
    expect(await (await fetch("http://localhost:4831/admin")).text()).toBe("on-3001");
  });

  it("serves on a port fed by a core.env config port (resolve phase)", async () => {
    const engine = new Engine({ env: { SVC_PORT: "4833" } });
    const wf: Workflow = {
      id: "envport",
      nodes: [
        { id: "p", op: "core.env", config: { name: "SVC_PORT", type: "number", default: 3000 } },
        { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/ping" } },
        { id: "k", op: "core.const.string", config: { value: "pong" } },
        { id: "out", op: "boundary.http.response" },
      ],
      edges: [
        { from: { node: "p", port: "out" }, to: { node: "in", port: "port" } }, // config port
        { from: { node: "in", port: "out" }, to: { node: "out", port: "in" } },
        { from: { node: "k", port: "out" }, to: { node: "out", port: "body" } },
      ],
    };
    await engine.registerWorkflowAsync(wf);
    const host = createHttpHost(engine);
    const { ports, close } = await host.start();
    closer = close;
    expect(ports).toEqual([4833]);
    expect(await (await fetch("http://localhost:4833/ping")).text()).toBe("pong");
  });

  it("falls back to the PORT env var when no default is given", async () => {
    const prev = process.env.PORT;
    process.env.PORT = "4832";
    try {
      const engine = new Engine();
      engine.registerWorkflow(route("p", "/p", "via-env"));
      const host = createHttpHost(engine); // no defaultPort → uses PORT
      const { ports, close } = await host.start();
      closer = close;
      expect(ports).toEqual([4832]);
      expect(await (await fetch("http://localhost:4832/p")).text()).toBe("via-env");
    } finally {
      if (prev === undefined) delete process.env.PORT;
      else process.env.PORT = prev;
    }
  });
});

describe("HTTP host — runtime workflow changes", () => {
  it("adds and removes routes live as workflows change", async () => {
    const engine = new Engine();
    const mk = (id: string, path: string, msg: string): Workflow => ({
      id,
      nodes: [
        { id: "in", op: "boundary.http.request", config: { path } },
        { id: "k", op: "core.const.string", config: { value: msg } },
        { id: "out", op: "boundary.http.response" },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "out", port: "in" } },
        { from: { node: "k", port: "out" }, to: { node: "out", port: "body" } },
      ],
    });
    engine.registerWorkflow(mk("static", "/static", "always")); // keeps the port open
    await startOn(engine, 4807);

    expect((await fetch("http://localhost:4807/dynamic")).status).toBe(404);

    engine.registerWorkflow(mk("dyn", "/dynamic", "now-here")); // DB-loaded-at-runtime shape
    await tick();
    expect(await (await fetch("http://localhost:4807/dynamic")).text()).toBe("now-here");

    engine.unregisterWorkflow("dyn");
    await tick();
    expect((await fetch("http://localhost:4807/dynamic")).status).toBe(404);
    // The static route still works — the server stayed up.
    expect(await (await fetch("http://localhost:4807/static")).text()).toBe("always");
  });
});
