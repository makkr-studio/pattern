/**
 * mod-vectors (0.4.0): the chunker, the local engine (cosine correctness,
 * dims locking, durability, cross-instance visibility = the offload
 * property), declared filterables (pre-scan pruning + located errors), and
 * the three query modes incl. RRF hybrid — with and without FTS5.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine, type OpContext, type Workflow } from "@pattern-js/core";
import { chunkText, chunkDoc } from "../src/chunk.js";
import { LocalVectorsEngine, normalize, rrfFuse } from "../src/engine-local.js";
import { DefaultVectorsService, VECTORS_SERVICE } from "../src/service.js";
import { vectorsMod } from "../src/mod.js";

/* ── a deterministic fake embedder: token-count vector over a tiny vocab ── */

const VOCAB = ["cat", "dog", "car", "engine", "moon", "cheese", "pattern", "workflow"];
const fakeEmbed = (text: string): number[] => {
  const tokens = text.toLowerCase().split(/[^a-z]+/);
  return VOCAB.map((w) => tokens.filter((t) => t === w).length + 0.01); // never the zero vector
};

const fakeProvider = {
  textEmbeddingModel: async () => ({
    doEmbed: async ({ values }: { values: string[] }) => ({ embeddings: values.map(fakeEmbed) }),
  }),
};

/** A minimal ctx for direct service calls (services + env + signal). */
const fakeCtx = (services: Record<string, unknown>): OpContext =>
  ({ services, env: {}, signal: undefined, principal: { kind: "anonymous" } }) as unknown as OpContext;

const dir = () => mkdtempSync(join(tmpdir(), "pattern-vectors-"));

async function seededService(opts: { disableFts?: boolean; path?: string } = {}) {
  const engine = new LocalVectorsEngine({ path: opts.path ?? ":memory:", disableFts: opts.disableFts });
  const svc = new DefaultVectorsService(engine);
  const ctx = fakeCtx({ [VECTORS_SERVICE]: svc, aiProviderService: fakeProvider });
  await svc.ensureCollection({ name: "kb", alias: "test-embed", metric: "cosine", filterables: ["product", "lang"] });
  await svc.upsert(
    "kb",
    [
      { id: "a", text: "the cat and the dog", meta: { product: "zoo", lang: "en" } },
      { id: "b", text: "a car with a strong engine", meta: { product: "garage", lang: "en" } },
      { id: "c", text: "the moon is made of cheese", meta: { product: "space", lang: "fr" } },
      { id: "d", text: "pattern workflow engine ERR-4711", meta: { product: "garage", lang: "en" } },
    ],
    ctx,
  );
  return { engine, svc, ctx };
}

describe("chunker", () => {
  it("splits on paragraph/sentence boundaries and respects maxChars", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} sentence one. Sentence two of ${i}.`).join("\n\n");
    const chunks = chunkText(text, { maxChars: 120, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(120);
    expect(chunks.join(" ")).toContain("Paragraph 11");
  });

  it("carries overlap across boundaries and stamps doc ids + meta", () => {
    const text = `${"alpha ".repeat(30)}\n\n${"beta ".repeat(30)}`;
    const [first, second] = chunkText(text, { maxChars: 200, overlap: 40 });
    expect(second).toContain(first!.slice(-10).trim()); // the tail of chunk 1 seeds chunk 2

    const chunks = chunkDoc({ id: "doc9", text, meta: { product: "zoo" } }, { maxChars: 200, overlap: 40 });
    expect(chunks[0]).toMatchObject({ id: "doc9#0", meta: { product: "zoo" } });
    expect(chunks[1]?.id).toBe("doc9#1");
  });

  it("hard-cuts pathological unbroken runs instead of overflowing", () => {
    const chunks = chunkText("x".repeat(5000), { maxChars: 1000, overlap: 0 });
    expect(chunks.length).toBe(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
  });
});

describe("local engine", () => {
  it("ranks by cosine, matching a hand-computed fixture", async () => {
    const { svc, ctx } = await seededService();
    const matches = await svc.query("kb", { text: "cat dog", k: 2 }, ctx);
    expect(matches[0]?.id).toBe("a"); // exact token overlap in embedding space

    // Hand-check: normalized dot of query "cat dog" with row a beats row b.
    const q = normalize(fakeEmbed("cat dog"));
    const a = normalize(fakeEmbed("the cat and the dog"));
    const b = normalize(fakeEmbed("a car with a strong engine"));
    const dot = (x: Float32Array, y: Float32Array) => x.reduce((s, v, i) => s + v * y[i]!, 0);
    expect(dot(q, a)).toBeGreaterThan(dot(q, b));
    expect(matches[0]!.score).toBeCloseTo(dot(q, a), 5);
  });

  it("locks dims on first write; a mismatch names the collection", async () => {
    const engine = new LocalVectorsEngine({ path: ":memory:" });
    const svc = new DefaultVectorsService(engine);
    const ctx = fakeCtx({ aiProviderService: fakeProvider });
    await svc.ensureCollection({ name: "locked", alias: "test-embed", metric: "cosine", filterables: [] });
    await svc.upsert("locked", [{ id: "x", vector: [1, 0, 0] }], ctx);
    await expect(svc.upsert("locked", [{ id: "y", vector: [1, 0, 0, 0] }], ctx)).rejects.toThrow(/locked.*3-dim|3-dim/);
    await expect(svc.upsert("locked", [{ id: "y", vector: [1, 0, 0, 0] }], ctx)).rejects.toThrow(/test-embed/);
  });

  it("content-hash skips unchanged rows (no re-embed, no re-write)", async () => {
    const { svc, ctx } = await seededService();
    const again = await svc.upsert("kb", [{ id: "a", text: "the cat and the dog", meta: { product: "zoo", lang: "en" } }], ctx);
    expect(again).toEqual({ count: 0, embedded: 0 });
    const changed = await svc.upsert("kb", [{ id: "a", text: "the cat and the dog!", meta: { product: "zoo", lang: "en" } }], ctx);
    expect(changed).toEqual({ count: 1, embedded: 1 });
  });

  it("is durable across reopen AND visible to a second instance on the same file (the offload property)", async () => {
    const path = join(dir(), "vectors.db");
    const { svc, ctx } = await seededService({ path });

    // A SECOND service instance over the same file — exactly what an offloaded
    // worker's own mod setup produces — sees the host's writes live.
    const worker = new DefaultVectorsService(new LocalVectorsEngine({ path }));
    const workerCtx = fakeCtx({ aiProviderService: fakeProvider });
    const fromWorker = await worker.query("kb", { text: "moon cheese", k: 1 }, workerCtx);
    expect(fromWorker[0]?.id).toBe("c");

    // And writes flow the other way too.
    await worker.upsert("kb", [{ id: "e", text: "another cat", meta: { product: "zoo", lang: "en" } }], workerCtx);
    const fromHost = await svc.query("kb", { text: "cat", k: 3, filter: { product: "zoo" } }, ctx);
    expect(fromHost.map((m) => m.id).sort()).toEqual(["a", "e"]);
  });
});

describe("filterables", () => {
  it("prunes to matching taxonomy rows before scoring (equality + any-of AND)", async () => {
    const { svc, ctx } = await seededService();
    const garage = await svc.query("kb", { text: "cat", k: 10, filter: { product: "garage" } }, ctx);
    expect(garage.map((m) => m.id).sort()).toEqual(["b", "d"]); // "a" scores best but is pruned out

    const anyOf = await svc.query("kb", { text: "cat", k: 10, filter: { product: ["zoo", "space"], lang: "en" } }, ctx);
    expect(anyOf.map((m) => m.id)).toEqual(["a"]); // c is fr → AND eliminates it

    const none = await svc.query("kb", { text: "cat", k: 10, filter: { product: "nope" } }, ctx);
    expect(none).toEqual([]);
  });

  it("filtering on an undeclared field is a located error naming field and fix", async () => {
    const { svc, ctx } = await seededService();
    await expect(svc.query("kb", { text: "cat", k: 3, filter: { tenant: "x" } }, ctx)).rejects.toThrow(
      /"tenant".*not a filterable.*product, lang/s,
    );
  });
});

describe("query modes", () => {
  it("keyword mode surfaces exact identifiers (FTS5 path)", async () => {
    const { engine, svc, ctx } = await seededService();
    if (!engine.hasFts) return; // covered by the fallback test below on such builds
    const matches = await svc.query("kb", { text: "ERR-4711", k: 3, mode: "keyword" }, ctx);
    expect(matches[0]?.id).toBe("d");
  });

  it("keyword mode works without FTS5 (forced fallback scorer)", async () => {
    const { svc, ctx } = await seededService({ disableFts: true });
    const matches = await svc.query("kb", { text: "ERR-4711 engine", k: 3, mode: "keyword" }, ctx);
    expect(matches[0]?.id).toBe("d");
  });

  it("hybrid fuses both rankings deterministically (RRF)", async () => {
    const { svc, ctx } = await seededService();
    // "cheese ERR-4711": semantically → c (cheese), keyword-exactly → d.
    const matches = await svc.query("kb", { text: "cheese ERR-4711", k: 4, mode: "hybrid" }, ctx);
    const ids = matches.map((m) => m.id);
    expect(ids).toContain("c");
    expect(ids).toContain("d");
    // Deterministic across runs.
    const again = await svc.query("kb", { text: "cheese ERR-4711", k: 4, mode: "hybrid" }, ctx);
    expect(again.map((m) => m.id)).toEqual(ids);
  });

  it("rrfFuse math: 1/(k+rank+1) summed across rankings", () => {
    const fused = rrfFuse([["a", "b"], ["b", "c"]], 60);
    expect(fused.get("b")).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(fused.get("a")).toBeCloseTo(1 / 61, 10);
    expect(fused.get("c")).toBeCloseTo(1 / 62, 10);
  });
});

describe("ops on the engine (port 5063 not needed — in-process run)", () => {
  it("vectors.index → vectors.query round-trip as a workflow", async () => {
    const engine = new Engine();
    await engine.useAsync(vectorsMod({ path: ":memory:" }), { deferReady: true });
    engine.provideService("aiProviderService", fakeProvider);

    const ensure: Workflow = {
      id: "ensure",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["go"] } },
        { id: "mk", op: "vectors.collection.ensure", config: { name: "docs", alias: "test-embed", filterables: ["kind"] } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "mk", port: "in" } },
        { from: { node: "mk", port: "collection" }, to: { node: "out", port: "value" } },
      ],
    };
    const ingest: Workflow = {
      id: "ingest",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["docs"] } },
        { id: "idx", op: "vectors.index", config: { collection: "docs", maxChars: 200, overlap: 20 } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "docs" }, to: { node: "idx", port: "docs" } },
        { from: { node: "idx", port: "count" }, to: { node: "out", port: "value" } },
      ],
    };
    const ask: Workflow = {
      id: "ask",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["text"] } },
        { id: "q", op: "vectors.query", config: { collection: "docs", k: 2, mode: "hybrid", filter: { kind: "guide" } } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "text" }, to: { node: "q", port: "text" } },
        { from: { node: "q", port: "matches" }, to: { node: "out", port: "value" } },
      ],
    };
    engine.registerWorkflow(ensure).registerWorkflow(ingest).registerWorkflow(ask);

    await engine.run(ensure, { input: { go: 1 } });
    const ingested = await engine.run(ingest, {
      input: {
        docs: [
          { id: "g1", text: "the pattern workflow engine runs graphs. the cat sleeps.", meta: { kind: "guide" } },
          { id: "n1", text: "the dog chases the car", meta: { kind: "note" } },
        ],
      },
    });
    expect((ingested.outputs.out as { value: number }).value).toBeGreaterThan(0);

    const res = await engine.run(ask, { input: { text: "pattern workflow" } });
    const matches = (res.outputs.out as { value: Array<{ id: string; meta: { kind: string } }> }).value;
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => m.meta.kind === "guide")).toBe(true);
    expect(matches[0]?.id.startsWith("g1#")).toBe(true);
  });
});
