/**
 * admin-sdk — the typed client against the live mod-admin backend (proves the
 * wire contract end-to-end), plus the framework-agnostic extension helpers.
 */

import { describe, it, expect, afterEach } from "vitest";
import { Engine, type Workflow } from "@pattern/core";
import { createHttpHost, memoryFs } from "@pattern/runtime-node";
import { adminMod } from "@pattern/mod-admin";
import { createAdminClient, buildNav, CommandRegistry, type MenuEntry } from "@pattern/admin-sdk";

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

let port = 4970;
async function start() {
  const p = ++port;
  const engine = new Engine();
  await engine.useAsync(adminMod({ storage: memoryFs() }));
  const host = createHttpHost(engine, { defaultPort: p });
  const { close } = await host.start();
  closer = close;
  return createAdminClient({ baseUrl: `http://localhost:${p}/admin` });
}

const wf: Workflow = {
  id: "sdk-demo",
  name: "SDK demo",
  nodes: [
    { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/sdk-demo" } },
    { id: "body", op: "core.const.string", config: { value: "via-sdk" } },
    { id: "out", op: "boundary.http.response" },
  ],
  edges: [
    { from: { node: "in", port: "out" }, to: { node: "out", port: "in" } },
    { from: { node: "body", port: "out" }, to: { node: "out", port: "body" } },
  ],
};

describe("AdminClient against the live backend", () => {
  it("lists ops, mods, templates and the catalog", async () => {
    const api = await start();
    const ops = await api.ops.list();
    expect(ops.find((o) => o.type === "admin.workflow.list")).toBeTruthy();

    const opGet = await api.ops.get("boundary.http.response");
    expect(opGet?.boundary).toBe("outgate");

    const mods = await api.mods();
    expect(mods.some((m) => m.name === "@pattern/mod-admin")).toBe(true);

    const templates = await api.templates();
    expect(templates.length).toBeGreaterThan(0);

    const catalog = await api.workflows.list();
    expect(catalog.some((m) => m.slug === "admin.api.ops.list" && m.source === "code")).toBe(true);
  });

  it("save → deploy → run round-trips, and the run shows up", async () => {
    const api = await start();

    const saved = await api.workflows.save("sdk-demo", wf, "first");
    expect(saved.version?.id).toBe("v1");
    expect(saved.issues).toEqual([]);

    const versions = await api.versions.list("sdk-demo");
    expect(versions).toHaveLength(1);

    const deploy = await api.deploy("sdk-demo", "v1");
    expect(deploy).toEqual({ ok: true, version: "v1" });

    // The deployed route works; then it appears in the runs list + metrics.
    const hit = await fetch(`${(api as unknown as { api: string })["api"].replace("/admin/api", "")}/sdk-demo`);
    expect(await hit.text()).toBe("via-sdk");

    const runs = await api.runs.list({ workflow: "sdk-demo" });
    expect(runs.some((r) => r.workflowId === "sdk-demo")).toBe(true);

    const metrics = await api.metrics();
    expect(metrics.runs).toBeGreaterThan(0);

    const explain = await api.workflows.explain("sdk-demo");
    expect(explain.text).toContain("SDK demo");
  });

  it("checks port compatibility and surfaces fix hints", async () => {
    const api = await start();
    const ok = await api.portsCompatible(
      { op: "core.const.string", port: "out", dir: "out" },
      { op: "boundary.http.response", port: "body", dir: "in" },
    );
    expect(ok.ok).toBe(true);

    const bad = await api.portsCompatible(
      { op: "core.stream.split", port: "out.0", dir: "out" },
      { op: "boundary.http.response", port: "body", dir: "in" },
    );
    expect(bad.ok).toBe(false);
    expect(bad.fix).toBe("accumulate");
  });

  it("diffs two versions", async () => {
    const api = await start();
    await api.workflows.save("d", { ...wf, id: "d", nodes: wf.nodes.map((n) => (n.id === "body" ? { ...n, config: { value: "one" } } : n)) }, "");
    await api.workflows.save("d", { ...wf, id: "d", nodes: wf.nodes.map((n) => (n.id === "body" ? { ...n, config: { value: "two" } } : n)) }, "");
    const diff = await api.versions.diff("d", "v1", "v2");
    expect(diff.equal).toBe(false);
    expect(diff.nodes.changed.some((c) => c.id === "body")).toBe(true);
  });

  it("streams the live span tail (SSE) as parsed spans", async () => {
    const api = await start();
    await api.workflows.save("tailed", { ...wf, id: "tailed", nodes: wf.nodes.map((n) => (n.id === "in" ? { ...n, config: { method: "GET", path: "/tailed" } } : n)) }, "");
    await api.deploy("tailed", "v1");

    const base = (api as unknown as { api: string })["api"].replace("/admin/api", "");
    const collected: unknown[] = [];
    const done = (async () => {
      for await (const span of api.runs.tail("tailed")) {
        collected.push(span);
        if (collected.length >= 1) break;
      }
    })();

    // Give the SSE subscription a moment, then trigger a run on the tailed workflow.
    await new Promise((r) => setTimeout(r, 30));
    await fetch(`${base}/tailed`);
    await Promise.race([done, new Promise((r) => setTimeout(r, 1000))]);
    expect(collected.length).toBeGreaterThanOrEqual(1);
  });
});

describe("extension helpers", () => {
  it("buildNav groups + orders sections by order then label", () => {
    const menu: MenuEntry[] = [
      { category: "B", label: "Two", path: "/2", order: 20 },
      { category: "A", label: "Beta", path: "/b", order: 10 },
      { category: "A", label: "Alpha", path: "/a", order: 10 },
    ];
    const nav = buildNav(menu);
    expect(nav.map((s) => s.category)).toEqual(["A", "B"]);
    expect(nav[0]!.items.map((i) => i.label)).toEqual(["Alpha", "Beta"]);
  });

  it("CommandRegistry searches with recency boost", () => {
    const reg = new CommandRegistry();
    reg.register({ id: "deploy", label: "Deploy workflow" }, { id: "new", label: "New workflow" });
    expect(reg.search("deploy")[0]!.id).toBe("deploy");
    expect(reg.search("", ["new"])[0]!.id).toBe("new");
  });
});
