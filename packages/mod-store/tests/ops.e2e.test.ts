import { afterEach, describe, expect, it } from "vitest";
import { Engine, type Workflow } from "@pattern/core";
import { createHttpHost } from "@pattern/runtime-node";
import { storeMod } from "../src/mod.js";
import { STORE_SERVICE } from "../src/well-known.js";
import type { PatternStores } from "../src/store/types.js";

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

async function boot() {
  const engine = new Engine();
  await engine.useAsync(storeMod({ storage: "memory" }));
  const stores = engine.service<PatternStores>(STORE_SERVICE)!;
  await stores.docs.ensureCollection({ name: "notes", indexes: ["owner"] });
  return { engine, stores };
}

const putGet: Workflow = {
  id: "put-get",
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["id", "data"] } },
    { id: "put", op: "store.put", config: { collection: "notes" } },
    { id: "get", op: "store.get", config: { collection: "notes" } },
    { id: "out", op: "boundary.return" },
  ],
  edges: [
    { from: { node: "in", port: "id" }, to: { node: "put", port: "id" } },
    { from: { node: "in", port: "data" }, to: { node: "put", port: "data" } },
    // run-after: read only once the write landed
    { from: { node: "put", port: "out" }, to: { node: "get", port: "in" } },
    { from: { node: "in", port: "id" }, to: { node: "get", port: "id" } },
    { from: { node: "get", port: "data" }, to: { node: "out", port: "value" } },
  ],
};

describe("store ops over the engine", () => {
  it("store.put → store.get round-trips through a workflow", async () => {
    const { engine } = await boot();
    engine.registerWorkflow(putGet);
    const res = await engine.run("put-get", { input: { id: "n1", data: { owner: "ben", text: "hi" } } });
    expect(res.status).toBe("ok");
    const merged = Object.assign({}, ...Object.values(res.outputs));
    expect(merged.value).toEqual({ owner: "ben", text: "hi" });
  });

  it("leases owned by the run are auto-released when it settles", async () => {
    const { engine, stores } = await boot();
    engine.registerWorkflow({
      id: "hold-lease",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["key"] } },
        { id: "lease", op: "store.lease.acquire", config: { ttlMs: 60_000 } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "key" }, to: { node: "lease", port: "key" } },
        { from: { node: "lease", port: "ok" }, to: { node: "out", port: "value" } },
      ],
    });
    const res = await engine.run("hold-lease", { input: { key: "conv:42" } });
    expect(res.status).toBe("ok");
    const merged = Object.assign({}, ...Object.values(res.outputs));
    expect(merged.value).toBe(true);
    // The run settled → its lease is gone (TraceSink auto-release).
    expect(await stores.leases.get("conv:42")).toBeNull();
  });

  it("explicitly-owned leases survive the run (auto-release only matches the runId)", async () => {
    const { engine, stores } = await boot();
    engine.registerWorkflow({
      id: "hold-lease-manual",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["key", "owner"] } },
        { id: "lease", op: "store.lease.acquire", config: { ttlMs: 60_000 } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "key" }, to: { node: "lease", port: "key" } },
        { from: { node: "in", port: "owner" }, to: { node: "lease", port: "owner" } },
        { from: { node: "lease", port: "ok" }, to: { node: "out", port: "value" } },
      ],
    });
    const res = await engine.run("hold-lease-manual", { input: { key: "job:1", owner: "external" } });
    expect(res.status).toBe("ok");
    expect((await stores.leases.get("job:1"))?.owner).toBe("external");
  });

  it("lease conflict is a value, not an error — and carries the holder", async () => {
    const { engine, stores } = await boot();
    await stores.leases.acquire("conv:busy", "someone-else", 60_000);
    engine.registerWorkflow({
      id: "try-lease",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["key"] } },
        { id: "lease", op: "store.lease.acquire", config: { ttlMs: 60_000 } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "key" }, to: { node: "lease", port: "key" } },
        { from: { node: "lease", port: "ok" }, to: { node: "out", port: "value" } },
      ],
    });
    const res = await engine.run("try-lease", { input: { key: "conv:busy" } });
    expect(res.status).toBe("ok");
    const merged = Object.assign({}, ...Object.values(res.outputs));
    expect(merged.value).toBe(false);
  });

  it("serves blobs over HTTP with the stored mime type", async () => {
    const { engine, stores } = await boot();
    const meta = await stores.blobs.put(new TextEncoder().encode("blob over http"), {
      mime: "text/plain",
    });
    const host = createHttpHost(engine, { defaultPort: 4961 });
    const { close } = await host.start();
    closer = close;
    const res = await fetch(`http://localhost:4961/store/blobs/${meta.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("blob over http");

    const miss = await fetch(`http://localhost:4961/store/blobs/${crypto.randomUUID()}`);
    expect(miss.status).toBe(404);
  });
});
