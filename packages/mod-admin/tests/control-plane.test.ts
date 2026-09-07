/**
 * mod-admin — control plane + store + versioning (admin internals M2).
 */

import { describe, it, expect } from "vitest";
import { Engine, type Workflow } from "@pattern-js/core";
import { memoryFs } from "@pattern-js/runtime-node";
import {
  DefaultControlPlane,
  FlystorageWorkflowStore,
  diffWorkflows,
  contentHash,
} from "@pattern-js/mod-admin";

function httpWorkflow(id: string, path: string, body = "ok"): Workflow {
  return {
    id,
    name: id,
    nodes: [
      { id: "in", op: "boundary.http.request", config: { method: "GET", path } },
      { id: "body", op: "core.const.string", config: { value: body } },
      { id: "out", op: "boundary.http.response" },
    ],
    edges: [
      { from: { node: "in", port: "out" }, to: { node: "out", port: "in" } },
      { from: { node: "body", port: "out" }, to: { node: "out", port: "body" } },
    ],
  };
}

function setup() {
  const engine = new Engine();
  const store = new FlystorageWorkflowStore(memoryFs());
  const cp = new DefaultControlPlane(engine, store);
  return { engine, store, cp };
}

describe("M2 — save → version → activate → disable round-trip", () => {
  it("persists versions and registers/unregisters on deploy/disable", async () => {
    const { engine, store, cp } = setup();

    const v1 = await store.saveVersion("greet", httpWorkflow("greet", "/greet"), { note: "first" });
    expect(v1.id).toBe("v1");
    expect(engine.workflows.has("greet")).toBe(false); // saved, not yet live

    const deploy = await cp.deploy("greet", "v1");
    expect(deploy).toEqual({ ok: true, version: "v1" });
    expect(engine.workflows.has("greet")).toBe(true);

    const meta = await store.getMeta("greet");
    expect(meta?.enabled).toBe(true);
    expect(meta?.live).toBe("v1");
    expect(meta?.route).toEqual({ method: "GET", path: "/greet", port: undefined });
    expect(meta?.audit.some((a) => a.action === "activate")).toBe(true);

    await cp.disable("greet");
    expect(engine.workflows.has("greet")).toBe(false);
    expect((await store.getMeta("greet"))?.enabled).toBe(false);
  });

  it("attributes versions to their author and audits the real principal", async () => {
    const { store } = setup();
    const benoit = { kind: "user" as const, id: "u1", provider: "test", claims: { name: "Benoit", email: "b@x.dev" } };
    const v1 = await store.saveVersion("a", httpWorkflow("a", "/a"), { author: "Benoit", principal: benoit });
    expect(v1.author).toBe("Benoit");
    const meta = await store.getMeta("a");
    expect(meta!.versions[0]!.author).toBe("Benoit");
    expect(meta!.audit.at(-1)).toMatchObject({ action: "save", principal: { kind: "user", id: "u1" } });
    // No principal → anonymous audit, no author (legacy/headless saves).
    const v2 = await store.saveVersion("a", httpWorkflow("a", "/a", "other"), {});
    expect(v2.author).toBeUndefined();
  });

  it("rolls back instantly by repointing live to a prior version", async () => {
    const { engine, store, cp } = setup();
    await store.saveVersion("p", httpWorkflow("p", "/p", "one"), {});
    const v2 = await store.saveVersion("p", httpWorkflow("p", "/p", "two"), {});
    expect(v2.id).toBe("v2");
    await cp.deploy("p", "v2");
    expect(engine.workflows.get("p")!.nodes.find((n) => n.id === "body")!.config).toMatchObject({ value: "two" });
    await cp.deploy("p", "v1"); // rollback
    expect(engine.workflows.get("p")!.nodes.find((n) => n.id === "body")!.config).toMatchObject({ value: "one" });
  });

  it("dedupes identical snapshots by content hash", async () => {
    const { store } = setup();
    const a = await store.saveVersion("d", httpWorkflow("d", "/d"), {});
    const b = await store.saveVersion("d", httpWorkflow("d", "/d"), {}); // identical body
    expect(b.id).toBe(a.id);
    const meta = await store.getMeta("d");
    expect(meta?.versions).toHaveLength(1);
  });
});

describe("M2 — route-conflict on activation", () => {
  it("returns ok:false with conflicts, and swap resolves it", async () => {
    const { engine, store, cp } = setup();
    await store.saveVersion("a", httpWorkflow("a", "/dup"), {});
    await store.saveVersion("b", httpWorkflow("b", "/dup"), {});
    await cp.deploy("a", "v1");

    const blocked = await cp.deploy("b", "v1");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.conflicts[0]!.conflictsWith).toBe("a");
    expect(engine.workflows.has("b")).toBe(false);

    const swapped = await cp.deploy("b", "v1", { swap: true });
    expect(swapped.ok).toBe(true);
    expect(engine.workflows.has("a")).toBe(false); // disabled by swap
    expect(engine.workflows.has("b")).toBe(true);
  });
});

describe("M2 — bootstrap registers enabled workflows", () => {
  it("registers enabled file workflows on boot, skips disabled", async () => {
    const fs = memoryFs();
    {
      const engine = new Engine();
      const store = new FlystorageWorkflowStore(fs);
      const cp = new DefaultControlPlane(engine, store);
      await store.saveVersion("on", httpWorkflow("on", "/on"), {});
      await store.saveVersion("off", httpWorkflow("off", "/off"), {});
      await cp.deploy("on", "v1");
      await cp.deploy("off", "v1");
      await cp.disable("off");
    }
    // Fresh engine, same storage → bootstrap.
    const engine2 = new Engine();
    const cp2 = new DefaultControlPlane(engine2, new FlystorageWorkflowStore(fs));
    await cp2.bootstrap();
    expect(engine2.workflows.has("on")).toBe(true);
    expect(engine2.workflows.has("off")).toBe(false);
  });
});

describe("versioning helpers", () => {
  it("contentHash ignores data-only ui/title/comment", () => {
    const a = httpWorkflow("h", "/h");
    const b: Workflow = { ...a, nodes: a.nodes.map((n) => ({ ...n, ui: { x: 1, y: 2 }, comment: "note" })) };
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it("diffWorkflows reports node/config/edge changes", () => {
    const a = httpWorkflow("h", "/h", "one");
    const b = httpWorkflow("h", "/h", "two");
    const d = diffWorkflows(a, b);
    expect(d.equal).toBe(false);
    expect(d.nodes.changed.some((c) => c.id === "body")).toBe(true);
  });

  it("the content hash covers BEHAVIOR beyond the graph — offload, durable, retry each mint a version; layout never does", async () => {
    const a = httpWorkflow("h", "/h");
    const offloaded: Workflow = { ...a, offload: true };
    const durable: Workflow = { ...a, durable: true };
    const retried: Workflow = { ...a, nodes: a.nodes.map((n) => (n.id === "body" ? { ...n, retry: { attempts: 3 } } : n)) };
    const moved: Workflow = { ...a, nodes: a.nodes.map((n) => ({ ...n, ui: { x: 999, y: 999 }, title: "renamed", comment: "note" })) };
    // Anything the engine READS changes the hash…
    for (const changed of [offloaded, durable, retried]) expect(contentHash(changed)).not.toBe(contentHash(a));
    // …layout, titles, and comments never do (a nudge is not a version).
    expect(contentHash(moved)).toBe(contentHash(a));
    // The diff surfaces each change so the version history explains itself.
    expect(diffWorkflows(a, offloaded).meta.some((m) => m.field === "offload" && m.after === true)).toBe(true);
    expect(diffWorkflows(a, durable).meta.some((m) => m.field === "durable" && m.after === true)).toBe(true);
    const r = diffWorkflows(a, retried, true);
    expect(r.equal).toBe(false);
    expect(r.nodes.changed.find((c) => c.id === "body")?.after.retry).toEqual({ attempts: 3 });
    expect(diffWorkflows(a, moved, true).equal).toBe(true);

    // And the store agrees: a reliability change is a NEW immutable snapshot,
    // not a rewrite of the version already deployed.
    const { store, cp } = setup();
    const v1 = await store.saveVersion("h", a, {});
    await cp.deploy("h", v1.id);
    const v2 = await store.saveVersion("h", durable, {});
    expect(v2.id).toBe("v2");
    expect((await store.getVersion("h", "v1"))?.durable).toBeUndefined(); // v1 untouched — rollback still means v1
    expect((await store.getVersion("h", "v2"))?.durable).toBe(true);
    expect((await store.getMeta("h"))?.live).toBe("v1"); // save ≠ deploy
    // A pure layout save reuses the version id (positions refresh, no bump).
    const v1again = await store.saveVersion("h", moved, {});
    expect(v1again.id).toBe("v1");
  });
});
