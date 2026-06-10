import { describe, it, expect, afterEach } from "vitest";
import { Engine, type Workflow } from "@pattern/core";
import { createHttpHost, memoryFs, provideFilesystem } from "@pattern/runtime-node";

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

/** The canonical app trio (§7): mount trigger → core.app.static → serve out-gate. */
function appWorkflow(mount: string): Workflow {
  return {
    id: `app-${mount.replace(/\W/g, "_")}`,
    nodes: [
      { id: "mount", op: "boundary.http.app", config: { mount } },
      {
        id: "assets",
        op: "core.app.static",
        config: { filesystem: "assets", spaFallback: "index.html", immutableAssets: true },
      },
      { id: "serve", op: "boundary.http.app.serve" },
    ],
    edges: [
      { from: { node: "mount", port: "out" }, to: { node: "assets", port: "in" } },
      { from: { node: "assets", port: "app" }, to: { node: "serve", port: "app" } },
    ],
  };
}

describe("boundary.http.app — static asset serving (P1)", () => {
  it("validates the app trio (trigger reaches its serve out-gate)", () => {
    const engine = new Engine();
    expect(() => engine.registerWorkflow(appWorkflow("/admin"))).not.toThrow();
  });

  it("rejects an app trigger with no serve out-gate (boundaries are pairs)", () => {
    const engine = new Engine();
    expect(() =>
      engine.registerWorkflow({
        id: "lonely-app",
        nodes: [{ id: "mount", op: "boundary.http.app", config: { mount: "/x" } }],
        edges: [],
      }),
    ).toThrow(/out-gate/);
  });

  it("serves assets, SPA-fallback, and 404s under a mount", async () => {
    const engine = new Engine();
    const fs = memoryFs();
    await fs.write("index.html", "<!doctype html><title>App</title>");
    await fs.write("assets/app.js", "console.log('hi')");
    provideFilesystem(engine, "assets", fs);
    engine.registerWorkflow(appWorkflow("/admin"));
    await startOn(engine, 4901);

    // Exact asset, with immutable caching + correct mime.
    const js = await fetch("http://localhost:4901/admin/assets/app.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    expect(js.headers.get("cache-control")).toContain("immutable");
    expect(await js.text()).toBe("console.log('hi')");

    // Mount root serves the SPA entry (no immutable caching on the html).
    const root = await fetch("http://localhost:4901/admin");
    expect(root.status).toBe(200);
    expect(await root.text()).toContain("<title>App</title>");
    expect(root.headers.get("cache-control")).toBe("no-cache");

    // Deep client-side route + HTML Accept → SPA fallback.
    const deep = await fetch("http://localhost:4901/admin/workflows/x", {
      headers: { accept: "text/html" },
    });
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain("<title>App</title>");

    // A missing asset (non-HTML) → 404, not the fallback.
    const missing = await fetch("http://localhost:4901/admin/assets/missing.js");
    expect(missing.status).toBe(404);
  });

  it("lets API routes win over the static mount on the same port", async () => {
    const engine = new Engine();
    const fs = memoryFs();
    await fs.write("index.html", "<html>spa</html>");
    provideFilesystem(engine, "assets", fs);
    engine.registerWorkflow(appWorkflow("/admin"));
    engine.registerWorkflow({
      id: "api",
      nodes: [
        { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/admin/api/ping" } },
        { id: "body", op: "core.const.string", config: { value: "pong" } },
        { id: "out", op: "boundary.http.response" },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "out", port: "in" } },
        { from: { node: "body", port: "out" }, to: { node: "out", port: "body" } },
      ],
    });
    await startOn(engine, 4902);

    const api = await fetch("http://localhost:4902/admin/api/ping");
    expect(await api.text()).toBe("pong");
    const spa = await fetch("http://localhost:4902/admin/anything", { headers: { accept: "text/html" } });
    expect(await spa.text()).toContain("spa");
  });

  it("reacts to a workflow added at runtime (live re-derive opens the server)", async () => {
    const engine = new Engine();
    const fs = memoryFs();
    await fs.write("index.html", "<html>late</html>");
    provideFilesystem(engine, "assets", fs);
    // Seed an existing mount so a server is already listening on 4903; adding a
    // second mount at runtime must be picked up live by the same host.
    engine.registerWorkflow(appWorkflow("/early"));
    await startOn(engine, 4903);

    expect((await fetch("http://localhost:4903/late")).status).toBe(404);

    engine.registerWorkflow(appWorkflow("/late"));
    await new Promise((r) => setTimeout(r, 15)); // let the host rebuild

    const res = await fetch("http://localhost:4903/late", { headers: { accept: "text/html" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("late");
  });
});
