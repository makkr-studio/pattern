import { describe, it, expect, afterEach } from "vitest";
import { AUTH_LOGIN_URL, Engine, type AuthProvider, type Workflow } from "@pattern-js/core";
import { createHttpHost } from "@pattern-js/runtime-node";

/** `x-user: <id>` → a signed-in user with no scopes. */
const provider: AuthProvider = {
  name: "hdr",
  authenticate: async (ctx) => {
    const id = ctx.headers.get("x-user");
    return id ? { kind: "user", id, provider: "t", scopes: [], claims: {} } : null;
  },
};

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

const gated: Workflow = {
  id: "pro",
  nodes: [
    { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/pro", requireAuth: { scopes: ["pro"] } } },
    { id: "out", op: "boundary.http.response" },
  ],
  edges: [{ from: { node: "in", port: "path" }, to: { node: "out", port: "body" } }],
};

async function boot(port: number, wf: Workflow, login = true) {
  const engine = new Engine();
  engine.registerAuthProvider(provider);
  if (login) engine.provideService(AUTH_LOGIN_URL, "/auth/login");
  engine.registerWorkflow(wf);
  const { close } = await createHttpHost(engine, { defaultPort: port }).start();
  closer = close;
  return `http://localhost:${port}`;
}

describe("refusing a gated route", () => {
  it("anonymous → 401; signed in without the scope → 403 (sign in vs upgrade)", async () => {
    const base = await boot(4846, gated);
    expect((await fetch(`${base}/pro`)).status).toBe(401);
    const free = await fetch(`${base}/pro`, { headers: { "x-user": "ada" } });
    expect(free.status).toBe(403);
    expect(await free.json()).toMatchObject({ error: "forbidden", reason: expect.stringMatching(/pro/) });
  });

  it("a browser GET while signed out is sent to the login page with next", async () => {
    const base = await boot(4847, gated);
    const res = await fetch(`${base}/pro?x=1`, { headers: { accept: "text/html" }, redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/auth/login?next=${encodeURIComponent("/pro?x=1")}`);
    // A signed-in browser lacking the scope is NOT bounced to login.
    const free = await fetch(`${base}/pro`, { headers: { accept: "text/html", "x-user": "ada" }, redirect: "manual" });
    expect(free.status).toBe(403);
    expect(await free.text()).toMatch(/^Forbidden: .*pro/);
  });
});

describe("a failed run's answer", () => {
  const failing: Workflow = {
    id: "boom",
    nodes: [
      { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/boom" } },
      { id: "t", op: "core.flow.throw", config: { message: "account \"default\" secret STRIPE_API_KEY missing" } },
      { id: "out", op: "boundary.http.response" },
    ],
    edges: [
      { from: { node: "in", port: "out" }, to: { node: "t", port: "in" } },
      { from: { node: "t", port: "out" }, to: { node: "out", port: "in" } },
    ],
  };

  it("names the error in development and hides it in production (the run id stays)", async () => {
    const base = await boot(4848, failing, false);
    const dev = await (await fetch(`${base}/boom`)).json();
    expect(dev.error).toMatch(/STRIPE_API_KEY/);
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await fetch(`${base}/boom`);
      expect(res.status).toBe(500);
      const prod = await res.json();
      expect(prod).toMatchObject({ error: "internal_error" });
      expect(typeof prod.runId).toBe("string");
      expect(JSON.stringify(prod)).not.toMatch(/STRIPE/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
