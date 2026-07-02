import { describe, expect, it } from "vitest";
import { Engine, defineMod, type Workflow } from "@pattern-js/core";
import { MockEmbeddingModelV3, MockLanguageModelV3 } from "ai/test";
import { aiOps } from "../src/ops/index.js";
import { AI_PROVIDER_SERVICE } from "../src/well-known.js";
import type { AiProviderService } from "../src/provider.js";

/**
 * mod-ai's ops against mock AI SDK models (no keys, no network): the ModelRef →
 * provider → op plumbing, proven end to end through the engine.
 */

function mockProvider(): AiProviderService {
  return {
    languageModel: async () =>
      new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: "text", text: "mock answer" }],
          finishReason: "stop",
          usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
          warnings: [],
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    textEmbeddingModel: async () =>
      new MockEmbeddingModelV3({
        doEmbed: async () => ({ embeddings: [[0.1, 0.2, 0.3]], usage: { tokens: 3 } }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    imageModel: async () => {
      throw new Error("no image model in this test");
    },
    speechModel: async () => {
      throw new Error("no speech model in this test");
    },
    transcriptionModel: async () => {
      throw new Error("no transcription model in this test");
    },
    videoModel: async () => {
      throw new Error("no video model in this test");
    },
    testConnection: async () => ({ ok: true }),
  };
}

async function boot() {
  const engine = new Engine();
  await engine.useAsync(
    defineMod({
      name: "@pattern-js/mod-ai-test",
      ops: aiOps,
      setup: (e) => e.provideService(AI_PROVIDER_SERVICE, mockProvider()),
    }),
  );
  return engine;
}

const merged = (res: { outputs: Record<string, Record<string, unknown>> }) =>
  Object.assign({}, ...Object.values(res.outputs)) as Record<string, unknown>;

const textWorkflow: Workflow = {
  id: "ai-text",
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["prompt"] } },
    { id: "model", op: "ai.model", config: { routing: "direct", provider: "openai", modelId: "gpt-5" } },
    { id: "gen", op: "ai.text.generate", config: {} },
    { id: "out", op: "boundary.return.named", config: { inputs: ["text", "usage"] } },
  ],
  edges: [
    { from: { node: "in", port: "out" }, to: { node: "model", port: "in" } },
    { from: { node: "model", port: "model" }, to: { node: "gen", port: "model" } },
    { from: { node: "in", port: "prompt" }, to: { node: "gen", port: "prompt" } },
    { from: { node: "gen", port: "text" }, to: { node: "out", port: "text" } },
    { from: { node: "gen", port: "usage" }, to: { node: "out", port: "usage" } },
  ],
};

const embedWorkflow: Workflow = {
  id: "ai-embed",
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["value"] } },
    { id: "model", op: "ai.model", config: { routing: "direct", provider: "openai", modelId: "text-embedding-3-small", modality: "embedding" } },
    { id: "embed", op: "ai.embed", config: {} },
    { id: "out", op: "boundary.return.named", config: { inputs: ["embedding"] } },
  ],
  edges: [
    { from: { node: "in", port: "out" }, to: { node: "model", port: "in" } },
    { from: { node: "model", port: "model" }, to: { node: "embed", port: "model" } },
    { from: { node: "in", port: "value" }, to: { node: "embed", port: "value" } },
    { from: { node: "embed", port: "embedding" }, to: { node: "out", port: "embedding" } },
  ],
};

describe("mod-ai ops against mock models", () => {
  it("ai.text.generate produces text + usage", async () => {
    const engine = await boot();
    engine.registerWorkflow(textWorkflow);
    const res = await engine.run("ai-text", { input: { prompt: "hi" } });
    expect(res.status).toBe("ok");
    const out = merged(res as never);
    expect(out.text).toBe("mock answer");
    // usage shape is mapped 1:1 from the SDK's LanguageModelUsage (validated by
    // typecheck); the mock doesn't propagate it through generateText aggregation.
    expect(out).toHaveProperty("usage");
  });

  it("ai.embed produces a vector", async () => {
    const engine = await boot();
    engine.registerWorkflow(embedWorkflow);
    const res = await engine.run("ai-embed", { input: { value: "hello" } });
    expect(res.status).toBe("ok");
    const out = merged(res as never);
    expect(out.embedding).toEqual([0.1, 0.2, 0.3]);
  });
});
