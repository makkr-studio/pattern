/**
 * mod-admin — the self-reflecting API over HTTP, end-to-end (admin internals M3).
 * Every admin.* endpoint is a workflow; the sink records runs + aggregates.
 */

import { describe, it, expect, afterEach } from "vitest";
import { Engine, type Workflow } from "@pattern/core";
import { createHttpHost, memoryFs } from "@pattern/runtime-node";
import { adminMod } from "@pattern/mod-admin";

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

// Each test gets its own port; Node's fetch keep-alive otherwise reuses a dead
// pooled socket against a just-closed server and throws ECONNRESET.
let port = 4920;
let BASE = "";
const api = (p: string) => `${BASE}/admin/api${p}`;

async function startAdmin() {
  BASE = `http://localhost:${++port}`;
  const engine = new Engine();
  // Omit `assets` so the built-in placeholder SPA (with index.html) is used.
  await engine.useAsync(adminMod({ storage: memoryFs(), auth: false }));
  const host = createHttpHost(engine, { defaultPort: port });
  const { close } = await host.start();
  closer = close;
  return engine;
}

const customWorkflow: Workflow = {
  id: "custom",
  name: "Custom endpoint",
  nodes: [
    { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/custom" } },
    { id: "body", op: "core.const.string", config: { value: "from-admin" } },
    { id: "out", op: "boundary.http.response" },
  ],
  edges: [
    { from: { node: "in", port: "out" }, to: { node: "out", port: "in" } },
    { from: { node: "body", port: "out" }, to: { node: "out", port: "body" } },
  ],
};

describe("M3 — admin endpoints respond over HTTP", () => {
  it("lists ops, mods, templates, and the self-reflecting catalog", async () => {
    await startAdmin();

    const ops = await (await fetch(api("/ops"))).json();
    expect(Array.isArray(ops)).toBe(true);
    expect(ops.some((o: { type: string }) => o.type === "admin.workflow.list")).toBe(true);

    // The catalog includes the admin's own endpoint workflows as code (self-reflection).
    const catalog = await (await fetch(api("/workflows"))).json();
    expect(catalog.some((m: { slug: string; source: string }) => m.slug === "admin.api.ops.list" && m.source === "code")).toBe(true);

    const mods = await (await fetch(api("/mods"))).json();
    expect(mods.some((m: { name: string }) => m.name === "@pattern/mod-admin")).toBe(true);

    const templates = await (await fetch(api("/templates"))).json();
    expect(templates.length).toBeGreaterThan(0);
  });

  it("checks port compatibility (T2)", async () => {
    await startAdmin();
    const res = await fetch(api("/ports/compatible"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: { op: "core.const.string", port: "out", dir: "out" },
        to: { op: "boundary.http.response", port: "body", dir: "in" },
      }),
    });
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("saves → deploys → serves a new workflow, and records the run", async () => {
    await startAdmin();

    const save = await fetch(api("/workflows/custom"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc: customWorkflow, note: "first" }),
    });
    const saved = await save.json();
    expect(saved.version?.id).toBe("v1");
    expect(saved.issues).toEqual([]);

    const deploy = await fetch(api("/deploy/custom"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "v1" }),
    });
    expect(await deploy.json()).toEqual({ ok: true, version: "v1" });

    // The newly-deployed route is live on the same host.
    const hit = await fetch(`${BASE}/custom`);
    expect(await hit.text()).toBe("from-admin");

    // The sink recorded runs (the admin endpoints + the custom hit).
    const runs = await (await fetch(api("/runs"))).json();
    expect(runs.some((r: { workflowId: string }) => r.workflowId === "custom")).toBe(true);

    const metrics = await (await fetch(api("/metrics"))).json();
    expect(metrics.runs).toBeGreaterThan(0);
    expect(metrics.perWorkflow.some((w: { workflowId: string }) => w.workflowId === "custom")).toBe(true);

    // Versions + explain reflect the saved workflow.
    const versions = await (await fetch(api("/workflows/custom/versions"))).json();
    expect(versions).toHaveLength(1);
    const explain = await (await fetch(api("/workflows/custom/explain"))).json();
    expect(explain.text).toContain("Custom endpoint");
  });

  it("settings toggle host-run I/O sampling; run.get carries samples + children", async () => {
    const engine = await startAdmin();

    // sampleIo rides the observability settings (off by default, applies live).
    const before = await (await fetch(api("/settings"))).json();
    expect(before.observability.sampleIo).toBe(false);
    const set = await (await fetch(api("/settings"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ observability: { sampleIo: true } }),
    })).json();
    expect(set.observability.sampleIo).toBe(true);
    expect(engine.ioSampling()).toBe(true);

    // A HOST-served run (not an editor run) now samples node I/O…
    await engine.registerWorkflowAsync(customWorkflow);
    await fetch(`${BASE}/custom`);
    const runs = await (await fetch(api("/runs"))).json();
    const run = runs.find((r: { workflowId: string }) => r.workflowId === "custom");
    const detail = await (await fetch(api(`/runs/${run.runId}`))).json();
    const bodySpan = detail.spans.find(
      (s: { attributes: Record<string, unknown> }) => s.attributes["pattern.node.id"] === "body",
    );
    expect(bodySpan.io.outputs.out).toMatchObject({ kind: "value", preview: "from-admin" });
    // …and run.get exposes the (empty here) sub-run list for the detail view.
    expect(detail.children).toEqual([]);
  });

  it("serves the SPA placeholder at the mount root", async () => {
    await startAdmin();
    const res = await fetch(`${BASE}/admin`, { headers: { accept: "text/html" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Pattern Admin");
  });

  it("rejects a save with validation issues", async () => {
    await startAdmin();
    const bad: Workflow = { id: "bad", nodes: [{ id: "x", op: "core.does.not.exist" }], edges: [] };
    const res = await fetch(api("/workflows/bad"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc: bad }),
    });
    const out = await res.json();
    expect(out.issues.length).toBeGreaterThan(0);
    expect(out.version).toBeUndefined();
  });
});
