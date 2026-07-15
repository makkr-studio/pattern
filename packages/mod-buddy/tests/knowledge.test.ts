/**
 * Buddy's two-engine knowledge: lexical baseline always answers; after the
 * boot indexer runs with mod-vectors + an embedding alias present, the SAME
 * op answers semantically — identical output shape either way.
 */

import { describe, expect, it, vi } from "vitest";
import { Engine, type OpContext, type PatternMod } from "@pattern-js/core";
import { docsMod } from "@pattern-js/mod-docs";
import { vectorsMod } from "@pattern-js/mod-vectors";
import { KnowledgeService, DOCS_COLLECTION } from "../src/knowledge.js";

/** Char-frequency embedder: deterministic, no vocab assumptions. */
const fakeProvider = {
  textEmbeddingModel: async () => ({
    doEmbed: async ({ values }: { values: string[] }) => ({
      embeddings: values.map((text) => {
        const v = new Array(26).fill(0.01) as number[];
        for (const ch of text.toLowerCase()) {
          const i = ch.charCodeAt(0) - 97;
          if (i >= 0 && i < 26) v[i] = (v[i] ?? 0) + 1;
        }
        return v;
      }),
    }),
  }),
};

const fakeAiConfig = { aliases: () => [{ name: "buddy", modality: "embedding" }] };

async function install(engine: Engine, mods: PatternMod[]) {
  for (const mod of mods) await engine.useAsync(mod, { deferReady: true });
}

describe("buddy knowledge (two engines, one shape)", () => {
  it("lexical answers without vectors; the boot indexer upgrades to semantic", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const engine = new Engine();
    await install(engine, [docsMod(), vectorsMod({ path: ":memory:" })]);
    engine.provideService("aiProviderService", fakeProvider);
    engine.provideService("aiConfig", fakeAiConfig);

    const knowledge = new KnowledgeService(() => engine);
    const ctx = {
      services: {
        vectorsService: engine.service("vectorsService"),
        aiProviderService: fakeProvider,
        aiConfig: fakeAiConfig,
      },
      env: {},
      principal: { kind: "anonymous" },
    } as unknown as OpContext;

    // Before indexing: lexical, and it already answers (the docs chapters ship in-repo).
    expect(knowledge.isSemantic()).toBe(false);
    const lexical = await knowledge.search("embedding collection alias", 5, ctx);
    expect(lexical.length).toBeGreaterThan(0);
    expect(lexical[0]).toMatchObject({ title: expect.any(String), path: expect.any(String), score: expect.any(Number) });

    // The boot indexer fills buddy.docs and flips the engine.
    await knowledge.indexDocs(ctx);
    expect(knowledge.isSemantic()).toBe(true);
    const vectors = engine.service<{ listCollections(): Promise<Array<{ name: string; rows: number }>> }>("vectorsService")!;
    const collection = (await vectors.listCollections()).find((c) => c.name === DOCS_COLLECTION);
    expect(collection?.rows ?? 0).toBeGreaterThan(0);

    // Same call, same shape — now semantic (guide hits carry guide/ paths).
    const semantic = await knowledge.search("declare an embedding collection with an alias", 5, ctx);
    expect(semantic.length).toBeGreaterThan(0);
    expect(semantic.some((r) => r.path.startsWith("guide/"))).toBe(true);
    expect(semantic[0]).toMatchObject({ title: expect.any(String), snippet: expect.any(String) });

    // Re-indexing is a content-hash no-op (nothing re-embedded).
    const before = (await vectors.listCollections()).find((c) => c.name === DOCS_COLLECTION)?.rows;
    await knowledge.indexDocs(ctx);
    const after = (await vectors.listCollections()).find((c) => c.name === DOCS_COLLECTION)?.rows;
    expect(after).toBe(before);
    vi.restoreAllMocks();
  });
});
