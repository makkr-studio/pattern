import { describe, it, expect, afterEach } from "vitest";
import type { IncomingMessage } from "node:http";
import { Engine, type AuthProvider, type Workflow } from "@pattern-js/core";
import { createHttpHost } from "@pattern-js/runtime-node";
import { clientIp } from "../src/http.js";

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

const echoIp = (rateLimit: Record<string, unknown>): Workflow => ({
  id: "limited",
  nodes: [
    { id: "in", op: "boundary.http.request", config: { method: "POST", path: "/limited", rateLimit } },
    { id: "out", op: "boundary.http.response" },
  ],
  edges: [{ from: { node: "in", port: "ip" }, to: { node: "out", port: "body" } }],
});

describe("route rateLimit (boundary.http.request config)", () => {
  it("answers 429 + Retry-After past the budget, before the run starts", async () => {
    const engine = new Engine();
    engine.registerWorkflow(echoIp({ max: 2, window: "1m" }));
    const { close } = await createHttpHost(engine, { defaultPort: 4841 }).start();
    closer = close;

    const hit = () => fetch("http://localhost:4841/limited", { method: "POST" });
    const a = await hit();
    expect(a.status).toBe(200);
    expect(await a.text()).toMatch(/127\.0\.0\.1|::1/);
    expect((await hit()).status).toBe(200);
    const c = await hit();
    expect(c.status).toBe(429);
    expect(Number(c.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await c.json()).toMatchObject({ error: "rate_limited" });
    // A browser form post reads a sentence instead of JSON.
    const d = await fetch("http://localhost:4841/limited", { method: "POST", headers: { accept: "text/html" } });
    expect(d.status).toBe(429);
    expect(await d.text()).toMatch(/Too many requests/);
  });

  it('by: "user" budgets each signed-in user separately', async () => {
    const engine = new Engine();
    const provider: AuthProvider = {
      name: "hdr",
      authenticate: async (ctx) => {
        const id = ctx.headers.get("x-user");
        return id ? { kind: "user", id, provider: "t", scopes: [], claims: {} } : null;
      },
    };
    engine.registerAuthProvider(provider);
    engine.registerWorkflow(echoIp({ max: 1, window: 60_000, by: "user" }));
    const { close } = await createHttpHost(engine, { defaultPort: 4842 }).start();
    closer = close;
    const as = (u: string) => fetch("http://localhost:4842/limited", { method: "POST", headers: { "x-user": u } });
    expect((await as("ada")).status).toBe(200);
    expect((await as("ada")).status).toBe(429);
    expect((await as("bob")).status).toBe(200);
  });
});

describe("clientIp", () => {
  const req = (peer: string, xff?: string) =>
    ({ socket: { remoteAddress: peer }, headers: xff ? { "x-forwarded-for": xff } : {} }) as unknown as IncomingMessage;

  it("ignores X-Forwarded-For unless proxies are trusted", () => {
    expect(clientIp(req("::ffff:10.0.0.2", "6.6.6.6"), 0)).toBe("10.0.0.2");
  });

  it("believes only the hops the trusted proxies appended (the client can't forge the rightmost)", () => {
    // Client sent "6.6.6.6" itself; the one trusted proxy appended the real peer 1.2.3.4.
    expect(clientIp(req("10.0.0.2", "6.6.6.6, 1.2.3.4"), 1)).toBe("1.2.3.4");
    expect(clientIp(req("10.0.0.2", "6.6.6.6, 1.2.3.4, 10.0.0.9"), 2)).toBe("1.2.3.4");
    // Fewer hops than trusted: fall back to the socket peer.
    expect(clientIp(req("10.0.0.2"), 1)).toBe("10.0.0.2");
  });
});
