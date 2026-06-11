import { describe, it, expect, afterEach } from "vitest";
import { AUTH_LOGIN_URL, Engine, type AuthProvider, type Workflow } from "@pattern/core";
import { createHttpHost, memoryFs, provideFilesystem } from "@pattern/runtime-node";

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
      claims: { email: `${token}@test` },
    };
  },
};

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

describe("HTTP trigger `user` port (§9)", () => {
  it("seeds the resolved user for routes, null when anonymous", async () => {
    const engine = new Engine();
    engine.registerAuthProvider(tokenProvider);
    const wf: Workflow = {
      id: "whoami",
      nodes: [
        { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/whoami" } },
        { id: "out", op: "boundary.http.response" },
      ],
      edges: [{ from: { node: "in", port: "user" }, to: { node: "out", port: "body" } }],
    };
    engine.registerWorkflow(wf);
    await startOn(engine, 4821);

    const authed = await fetch("http://localhost:4821/whoami", { headers: { "x-token": "ada" } });
    expect(await authed.json()).toMatchObject({ id: "ada", provider: "test", email: "ada@test" });

    // Anonymous → the port seeds null → the response body is empty (host convention).
    const anon = await fetch("http://localhost:4821/whoami");
    expect(anon.status).toBe(200);
    expect(await anon.text()).toBe("");
  });
});

describe("app-mount login redirect (§9)", () => {
  function spaApp(): Workflow {
    return {
      id: "app",
      nodes: [
        { id: "mount", op: "boundary.http.app", config: { mount: "/admin", requireAuth: { scopes: ["admin"] } } },
        { id: "static", op: "core.app.static", config: { filesystem: "test-assets" } },
        { id: "serve", op: "boundary.http.app.serve" },
      ],
      edges: [
        { from: { node: "mount", port: "out" }, to: { node: "static", port: "in" } },
        { from: { node: "static", port: "app" }, to: { node: "serve", port: "app" } },
      ],
    };
  }

  async function boot(port: number, withLoginUrl: boolean) {
    const engine = new Engine();
    engine.registerAuthProvider(tokenProvider);
    const fs = memoryFs();
    await fs.write("index.html", "<h1>app</h1>");
    provideFilesystem(engine, "test-assets", fs);
    if (withLoginUrl) engine.provideService(AUTH_LOGIN_URL, "/auth/login");
    await engine.registerWorkflowAsync(spaApp());
    await startOn(engine, port);
    return engine;
  }

  it("302s HTML requests to the advertised login page with ?next=", async () => {
    await boot(4822, true);
    const res = await fetch("http://localhost:4822/admin", {
      headers: { accept: "text/html" },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login?next=%2Fadmin");
  });

  it("keeps the bare 401 for non-HTML requests and when no login URL is advertised", async () => {
    await boot(4823, true);
    const xhr = await fetch("http://localhost:4823/admin", { headers: { accept: "application/json" } });
    expect(xhr.status).toBe(401);

    await closer?.();
    closer = undefined;

    await boot(4824, false);
    const res = await fetch("http://localhost:4824/admin", {
      headers: { accept: "text/html" },
      redirect: "manual",
    });
    expect(res.status).toBe(401);
  });

  it("serves the app normally for an authorized user", async () => {
    await boot(4825, true);
    const res = await fetch("http://localhost:4825/admin", {
      headers: { accept: "text/html", "x-token": "root" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("app");
  });
});
