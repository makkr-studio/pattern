/**
 * mod-admin — security regressions: path traversal, invoke ACL, SPA auth stamping.
 *
 * These guard the control plane's trust boundary: slugs/version ids/fixture
 * names become storage path segments, `admin.invoke` runs arbitrary catalog
 * ops, and the SPA workflow must be auth-stamped like every API route.
 */

import { describe, it, expect, afterEach } from "vitest";
import { Engine, value, type Workflow } from "@pattern/core";
import { createHttpHost, memoryFs } from "@pattern/runtime-node";
import { adminMod, FlystorageWorkflowStore } from "@pattern/mod-admin";

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

let port = 4960;
let BASE = "";
const api = (p: string) => `${BASE}/admin/api${p}`;

async function startAdmin() {
  BASE = `http://localhost:${++port}`;
  const engine = new Engine();
  await engine.useAsync(adminMod({ storage: memoryFs() }));
  const host = createHttpHost(engine, { defaultPort: port });
  const { close } = await host.start();
  closer = close;
  return engine;
}

const okDoc: Workflow = {
  id: "ok",
  nodes: [
    { id: "t", op: "boundary.manual", config: { outputs: ["v"] } },
    { id: "out", op: "boundary.return" },
  ],
  edges: [{ from: { node: "t", port: "v" }, to: { node: "out", port: "value" } }],
};

describe("path traversal is rejected at the store boundary", () => {
  const store = new FlystorageWorkflowStore(memoryFs());

  it.each(["../evil", "..", "a/b", "a\\b", ".hidden", ""])('rejects slug "%s"', async (slug) => {
    await expect(store.saveVersion(slug, okDoc, {})).rejects.toThrow(/invalid slug/);
  });

  it("rejects traversal in version ids and fixture names", async () => {
    await store.saveVersion("ok", okDoc, {});
    await expect(store.getVersion("ok", "../_meta")).rejects.toThrow(/invalid version/);
    await expect(store.saveFixture("ok", "../../escape", { input: {} } as never)).rejects.toThrow(/invalid fixture name/);
    await expect(store.getFixture("ok", "a/b")).rejects.toThrow(/invalid fixture name/);
    await expect(store.delete("../ok")).rejects.toThrow(/invalid slug/);
  });

  it("rejects a path-like id on the import endpoint", async () => {
    await startAdmin();
    const res = await fetch(api("/import"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: { ...okDoc, id: "../../escape" } }),
    });
    expect(res.ok).toBe(false);
    const txt = await res.text();
    expect(txt).toContain("invalid workflow id");
  });
});

describe("admin.invoke ACL", () => {
  it("refuses control-plane, boundary, and non-reusable ops as data sources", async () => {
    await startAdmin();
    for (const source of ["admin.workflow.delete", "admin.workflow.list", "boundary.http.request"]) {
      const res = await fetch(api("/invoke"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source }),
      });
      expect(res.ok).toBe(false);
      expect(await res.text()).toContain("cannot be invoked");
    }
  });

  it("still runs ordinary source ops", async () => {
    const engine = await startAdmin();
    engine.registerOp({
      type: "test.source",
      inputs: {},
      outputs: { out: value() },
      execute: () => ({ out: [{ id: 1 }] }),
    });
    const res = await fetch(api("/invoke"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "test.source" }),
    });
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual([{ id: 1 }]);
  });
});

describe("SPA auth stamping (P6)", () => {
  it("stamps requireAuth onto the SPA app workflow when auth is configured", () => {
    const mod = adminMod({ auth: true, storage: memoryFs() });
    const spa = mod.workflows?.find((w) => w.id === "admin.app");
    expect(spa).toBeDefined();
    const app = spa!.nodes.find((n) => n.op === "boundary.http.app");
    expect((app?.config as { requireAuth?: unknown })?.requireAuth).toBe(true);
  });

  it("leaves the SPA anonymous by default", () => {
    const mod = adminMod({ storage: memoryFs() });
    const spa = mod.workflows?.find((w) => w.id === "admin.app");
    const app = spa!.nodes.find((n) => n.op === "boundary.http.app");
    expect((app?.config as { requireAuth?: unknown })?.requireAuth).toBeUndefined();
  });
});
