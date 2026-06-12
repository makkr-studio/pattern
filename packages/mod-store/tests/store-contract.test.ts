import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryPatternStores } from "../src/store/memory.js";
import { sqlitePatternStores } from "../src/store/sqlite.js";
import type { PatternStores } from "../src/store/types.js";

/**
 * Driver contract suite: both drivers run the exact same assertions so the
 * race paths production hits (CAS, lease steal) are tested where they run.
 */

const drivers: Array<[string, () => Promise<PatternStores>]> = [
  ["memory", async () => memoryPatternStores()],
];
if (process.getBuiltinModule?.("node:sqlite")) {
  drivers.push([
    "sqlite",
    () => sqlitePatternStores(":memory:", mkdtempSync(join(tmpdir(), "pattern-blobs-"))),
  ]);
}

describe.each(drivers)("pattern stores (%s)", (_name, open) => {
  it("documents: put/get round-trip, upsert bumps version", async () => {
    const s = await open();
    await s.docs.ensureCollection({ name: "things", indexes: ["kind"] });
    const v1 = await s.docs.put("things", "a", { kind: "x", n: 1 });
    expect(v1?.version).toBe(1);
    const v2 = await s.docs.put("things", "a", { kind: "x", n: 2 });
    expect(v2?.version).toBe(2);
    const got = await s.docs.get("things", "a");
    expect(got?.data).toEqual({ kind: "x", n: 2 });
    expect(got?.createdAt).toBe(v1?.createdAt);
  });

  it("documents: CAS put returns null on a stale version", async () => {
    const s = await open();
    await s.docs.ensureCollection({ name: "things", indexes: [] });
    await s.docs.put("things", "a", { n: 1 });
    const ok = await s.docs.put("things", "a", { n: 2 }, 1);
    expect(ok?.version).toBe(2);
    const stale = await s.docs.put("things", "a", { n: 99 }, 1);
    expect(stale).toBeNull();
    expect((await s.docs.get("things", "a"))?.data).toEqual({ n: 2 });
  });

  it("documents: concurrent CAS puts — exactly one wins", async () => {
    const s = await open();
    await s.docs.ensureCollection({ name: "race", indexes: [] });
    await s.docs.put("race", "doc", { n: 0 });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_v, i) => s.docs.put("race", "doc", { n: i }, 1)),
    );
    expect(results.filter((r) => r != null)).toHaveLength(1);
  });

  it("documents: query by indexed field, orderBy, paging; unindexed throws", async () => {
    const s = await open();
    await s.docs.ensureCollection({ name: "msgs", indexes: ["owner", "rank"] });
    for (let i = 0; i < 5; i++) {
      await s.docs.put("msgs", `m${i}`, { owner: i % 2 === 0 ? "a" : "b", rank: `r${i}` });
    }
    const a = await s.docs.query({ collection: "msgs", where: { owner: "a" } });
    expect(a.map((d) => d.id).sort()).toEqual(["m0", "m2", "m4"]);
    const desc = await s.docs.query({ collection: "msgs", where: { owner: "a" }, orderBy: "rank", orderDir: "desc" });
    expect(desc.map((d) => d.id)).toEqual(["m4", "m2", "m0"]);
    const paged = await s.docs.query({ collection: "msgs", orderBy: "id", limit: 2, offset: 1 });
    expect(paged.map((d) => d.id)).toEqual(["m1", "m2"]);
    await expect(s.docs.query({ collection: "msgs", where: { nope: 1 } })).rejects.toThrow(/not indexed/);
    expect(await s.docs.count("msgs", { owner: "b" })).toBe(2);
  });

  it("documents: ensureCollection backfills newly declared indexes", async () => {
    const s = await open();
    await s.docs.ensureCollection({ name: "later", indexes: [] });
    await s.docs.put("later", "x", { tag: "blue" });
    await s.docs.ensureCollection({ name: "later", indexes: ["tag"] });
    const hits = await s.docs.query({ collection: "later", where: { tag: "blue" } });
    expect(hits).toHaveLength(1);
  });

  it("documents: patch merges shallowly (CAS), delete removes", async () => {
    const s = await open();
    await s.docs.ensureCollection({ name: "p", indexes: ["k"] });
    await s.docs.put("p", "a", { k: "v", keep: true });
    const patched = await s.docs.patch("p", "a", { k: "w" }, 1);
    expect(patched?.data).toEqual({ k: "w", keep: true });
    expect(await s.docs.patch("p", "a", { k: "z" }, 1)).toBeNull();
    expect(await s.docs.delete("p", "a")).toBe(true);
    expect(await s.docs.get("p", "a")).toBeNull();
    // Index rows are gone too: a query must not resurrect the doc.
    expect(await s.docs.query({ collection: "p", where: { k: "w" } })).toEqual([]);
  });

  it("blobs: put/get round-trip (value + stream), list, delete", async () => {
    const s = await open();
    const bytes = new TextEncoder().encode("hello blobs");
    const meta = await s.blobs.put(bytes, { mime: "text/plain", ownerId: "u1" });
    expect(meta.size).toBe(bytes.byteLength);
    const hit = await s.blobs.get(meta.id);
    expect(hit?.meta.mime).toBe("text/plain");
    const read = new Uint8Array(await new Response(hit!.stream).arrayBuffer());
    expect(new TextDecoder().decode(read)).toBe("hello blobs");

    const streamed = await s.blobs.put(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode("part1-"));
          c.enqueue(new TextEncoder().encode("part2"));
          c.close();
        },
      }),
      { mime: "text/plain" },
    );
    expect(streamed.size).toBe("part1-part2".length);

    expect((await s.blobs.list({ ownerId: "u1" })).map((b) => b.id)).toEqual([meta.id]);
    expect(await s.blobs.delete(meta.id)).toBe(true);
    expect(await s.blobs.get(meta.id)).toBeNull();
  });

  it("leases: acquire/conflict/re-enter/expire/steal/renew/release", async () => {
    const s = await open();
    const a = await s.leases.acquire("conv:1", "run-A", 60_000);
    expect(a.ok).toBe(true);

    const b = await s.leases.acquire("conv:1", "run-B", 60_000);
    expect(b).toMatchObject({ ok: false, owner: "run-A" });

    // Re-entrant for the same owner.
    const again = await s.leases.acquire("conv:1", "run-A", 60_000);
    expect(again.ok).toBe(true);

    // Expired lease is stealable.
    await s.leases.acquire("conv:2", "run-A", -1);
    const steal = await s.leases.acquire("conv:2", "run-B", 60_000);
    expect(steal.ok).toBe(true);

    // Renew only while held.
    expect((await s.leases.renew("conv:1", "run-A", 60_000)).ok).toBe(true);
    expect((await s.leases.renew("conv:1", "run-B", 60_000)).ok).toBe(false);

    await s.leases.release("conv:1", "run-B"); // not the owner — no-op
    expect(await s.leases.get("conv:1")).not.toBeNull();
    await s.leases.release("conv:1", "run-A");
    expect(await s.leases.get("conv:1")).toBeNull();
  });

  it("leases: concurrent acquires — exactly one winner", async () => {
    const s = await open();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_v, i) => s.leases.acquire("hot", `run-${i}`, 60_000)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("leases: releaseAll drops exactly the owner's leases", async () => {
    const s = await open();
    await s.leases.acquire("k1", "run-A", 60_000);
    await s.leases.acquire("k2", "run-A", 60_000);
    await s.leases.acquire("k3", "run-B", 60_000);
    expect(await s.leases.releaseAll("run-A")).toBe(2);
    expect(await s.leases.get("k1")).toBeNull();
    expect(await s.leases.get("k3")).not.toBeNull();
  });
});
